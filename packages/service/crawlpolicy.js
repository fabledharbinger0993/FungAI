import { get, put } from "./db.js";
import {
  parseRobotsTxt,
  pickRule,
  isPathBlocked,
  parseRetryAfter,
  isPlaceholderContact,
  isGovDomain,
  effectiveDelaySeconds
} from "./robots.js";

export { parseRobotsTxt };

const domainQueues = new Map();
const domainNextAt = new Map();
const domainPaused = new Map();

const ROBOTS_AGENT = "archivelens";
const ROBOTS_TTL_MS = 24 * 60 * 60 * 1000;      // re-read robots.txt daily
const ROBOTS_DENIED_TTL_MS = 60 * 60 * 1000;    // a 401/403 on robots.txt is re-checked hourly
const DEFAULT_DAILY_CAP_GOV = 300;
const DEFAULT_DAILY_CAP = 2000;

function contactFor(settings) {
  const candidates = [settings.contactEmail, process.env.fungai_CONTACT_EMAIL];
  return candidates.find((c) => !isPlaceholderContact(c)) || "";
}

function userAgentFor(contact) {
  return `ArchiveLens/1.0 (Research Extension; respectful crawl; contact: ${contact || "unset"})`;
}

// Returns { allowed, crawlDelay } for a URL. Throws RobotsUnavailableError when robots.txt
// could not be read (server error / network), rather than assuming everything is allowed.
export async function getRobotsInfo(url, userAgent = ROBOTS_AGENT, contact = "") {
  const target = new URL(url);
  const key = `robots2:${target.origin}`;
  let cached = await get("crawlCache", key);
  const ttl = cached?.denied ? ROBOTS_DENIED_TTL_MS : ROBOTS_TTL_MS;

  if (!cached || Date.now() - (cached.fetchedAt || 0) > ttl) {
    let res;
    try {
      res = await fetch(`${target.origin}/robots.txt`, {
        method: "GET",
        headers: { "User-Agent": userAgentFor(contact) },
        credentials: "omit",
        cache: "no-store",
        signal: AbortSignal.timeout(15_000)
      });
    } catch (err) {
      throw new RobotsUnavailableError(`Could not read robots.txt for ${target.origin}: ${err.message}`);
    }

    if (res.status >= 500) {
      throw new RobotsUnavailableError(`robots.txt for ${target.origin} returned ${res.status}`);
    }
    if (res.status === 401 || res.status === 403) {
      // The site refuses to show its rules to us: treat that as "stay out".
      cached = { key, parsed: {}, denied: true, fetchedAt: Date.now() };
    } else {
      const body = res.ok ? await res.text() : ""; // 404/410: no robots.txt, no restrictions
      cached = { key, parsed: parseRobotsTxt(body), denied: false, fetchedAt: Date.now() };
    }
    await put("crawlCache", cached);
  }

  if (cached.denied) return { allowed: false, crawlDelay: null };

  const rule = pickRule(cached.parsed, [String(userAgent).toLowerCase(), ROBOTS_AGENT, "fungai"]);
  const targetPath = `${target.pathname || "/"}${target.search || ""}`;
  return { allowed: !isPathBlocked(targetPath, rule), crawlDelay: rule?.crawlDelay ?? null };
}

export async function isAllowedByRobots(url, userAgent = ROBOTS_AGENT) {
  return (await getRobotsInfo(url, userAgent)).allowed;
}

// Counts requests per domain per UTC day (persisted, so restarts don't reset it).
async function takeDailyRequest(domain, settings) {
  const cap = Number(settings.dailyRequestCap) || (isGovDomain(domain) ? DEFAULT_DAILY_CAP_GOV : DEFAULT_DAILY_CAP);
  const key = `daily:${domain}:${new Date().toISOString().slice(0, 10)}`;
  const row = (await get("crawlCache", key)) || { key, count: 0 };
  if (row.count >= cap) {
    throw new DailyCapError(`Daily request cap (${cap}) reached for ${domain}; resumes tomorrow (UTC)`);
  }
  row.count += 1;
  await put("crawlCache", row);
}

export async function policyFetch(url, options = {}, settings = {}) {
  const target = new URL(url);
  const domain = target.hostname;
  const contact = contactFor(settings);

  // Government sites get a real, reachable contact in the User-Agent or no request at all.
  if (isGovDomain(domain) && !contact) {
    throw new ContactRequiredError(
      `Set a real contact email (Settings → contactEmail, or the fungai_CONTACT_EMAIL variable) before crawling ${domain}`
    );
  }

  if (domainPaused.get(domain)) {
    throw new Error(`Domain ${domain} is paused due to CAPTCHA challenge`);
  }

  const robots = await getRobotsInfo(url, ROBOTS_AGENT, contact);
  if (!robots.allowed) {
    throw new RobotsBlockedError(`Robots policy blocks URL: ${url}`);
  }
  const minDelay = effectiveDelaySeconds(domain, settings.crawlDelaySeconds, robots.crawlDelay) * 1000;

  return enqueueDomainRequest(domain, async () => {
    await enforceDelay(domain, minDelay);
    await takeDailyRequest(domain, settings);

    const headers = new Headers(options.headers || {});
    headers.set("User-Agent", userAgentFor(contact));
    headers.set("Accept", headers.get("Accept") || "text/html,application/pdf,*/*");
    headers.delete("Referer");
    headers.delete("Cookie");

    const fetchOptions = {
      ...options,
      method: options.method || "GET",
      headers,
      credentials: "omit",
      referrerPolicy: "no-referrer",
      redirect: "follow",
      cache: "no-store"
    };

    const response = await fetch(url, fetchOptions);
    const status = response.status;

    if (status === 429 || status === 503) {
      // Honour the server's own Retry-After when it sends one.
      const retryMs = parseRetryAfter(response.headers.get("retry-after"));
      if (status === 429) {
        const waitMs = Math.max(60_000, retryMs ?? 0);
        await backoffDomain(domain, waitMs);
        throw new RetryableHttpError("Too Many Requests", 429, waitMs, 1);
      }
      const waitMs = Math.max(2_000, retryMs ?? 0);
      await backoffDomain(domain, waitMs);
      throw new RetryableHttpError("Service unavailable", 503, waitMs, 3);
    }

    if (status === 403) {
      throw new PermanentHttpError("Access denied", 403);
    }

    const clone = response.clone();
    const bodyText = await safeReadText(clone);
    if (containsCaptcha(bodyText)) {
      domainPaused.set(domain, true);
      throw new CaptchaDetectedError(`CAPTCHA detected for ${domain}`);
    }

    return response;
  });
}

export function resumeDomain(domain) {
  domainPaused.delete(domain);
}

function containsCaptcha(text) {
  if (!text) {
    return false;
  }
  const checks = [/captcha/i, /g-recaptcha/i, /hcaptcha/i, /i am not a robot/i];
  return checks.some((re) => re.test(text));
}

async function safeReadText(response) {
  try {
    const ctype = response.headers.get("content-type") || "";
    if (ctype.includes("text") || ctype.includes("html") || ctype.includes("json")) {
      return await response.text();
    }
  } catch (_err) {
    return "";
  }
  return "";
}

function enqueueDomainRequest(domain, fn) {
  if (!domainQueues.has(domain)) {
    domainQueues.set(domain, Promise.resolve());
  }

  const chain = domainQueues
    .get(domain)
    .then(fn)
    .catch((err) => {
      throw err;
    });

  domainQueues.set(domain, chain.catch(() => undefined));
  return chain;
}

async function enforceDelay(domain, minDelayMs) {
  const now = Date.now();
  const nextAt = domainNextAt.get(domain) || 0;
  if (now < nextAt) {
    await delay(nextAt - now);
  }
  domainNextAt.set(domain, Date.now() + minDelayMs);
}

async function backoffDomain(domain, delayMs) {
  const nextAt = domainNextAt.get(domain) || 0;
  domainNextAt.set(domain, Math.max(nextAt, Date.now() + delayMs));
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class RetryableHttpError extends Error {
  constructor(message, status, baseDelayMs, maxRetries) {
    super(message);
    this.name = "RetryableHttpError";
    this.status = status;
    this.baseDelayMs = baseDelayMs;
    this.maxRetries = maxRetries;
  }
}

export class PermanentHttpError extends Error {
  constructor(message, status) {
    super(message);
    this.name = "PermanentHttpError";
    this.status = status;
  }
}

export class CaptchaDetectedError extends Error {
  constructor(message) {
    super(message);
    this.name = "CaptchaDetectedError";
  }
}

// The site's robots.txt disallows this URL. Final: never retried.
export class RobotsBlockedError extends Error {
  constructor(message) {
    super(message);
    this.name = "RobotsBlockedError";
  }
}

// robots.txt could not be read (server error or network). Retry later; never assume allowed.
export class RobotsUnavailableError extends Error {
  constructor(message) {
    super(message);
    this.name = "RobotsUnavailableError";
  }
}

export class DailyCapError extends Error {
  constructor(message) {
    super(message);
    this.name = "DailyCapError";
  }
}

export class ContactRequiredError extends Error {
  constructor(message) {
    super(message);
    this.name = "ContactRequiredError";
  }
}
