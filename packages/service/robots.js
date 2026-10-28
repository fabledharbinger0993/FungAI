// robots.js — pure helpers for polite crawling (robots.txt parsing, Retry-After, contact checks).
// No I/O here, so the rules can be tested with plain node.

export function parseRobotsTxt(text) {
  const rules = {};
  let currentAgents = [];
  let lastWasAgent = false;

  const lines = (text || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/#.*$/, "").trim())
    .filter(Boolean);

  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx < 1) continue;

    const directive = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (directive === "user-agent") {
      const agent = value.toLowerCase() || "*";
      // Consecutive User-agent lines share one group of rules.
      currentAgents = lastWasAgent ? [...currentAgents, agent] : [agent];
      for (const a of currentAgents) {
        if (!rules[a]) rules[a] = { allow: [], disallow: [], crawlDelay: null };
      }
      lastWasAgent = true;
      continue;
    }
    lastWasAgent = false;

    for (const agent of currentAgents) {
      if (directive === "allow") rules[agent].allow.push(value);
      else if (directive === "disallow") rules[agent].disallow.push(value);
      else if (directive === "crawl-delay") {
        const n = Number(value);
        if (Number.isFinite(n) && n >= 0) rules[agent].crawlDelay = n;
      }
    }
  }

  return rules;
}

// The most specific group wins (our own name first, then "*"); groups are not merged.
export function pickRule(rules, agents = []) {
  for (const agent of agents) {
    const rule = rules?.[String(agent).toLowerCase()];
    if (rule) return rule;
  }
  return rules?.["*"] || null;
}

function patternToRegExp(pattern) {
  const anchored = pattern.endsWith("$");
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .replace(/[.+?^{}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  return new RegExp(`^${body}${anchored ? "$" : ""}`);
}

function longestMatch(target, patterns) {
  let best = -1;
  for (const pattern of patterns) {
    if (!pattern) continue; // an empty Disallow means "allow everything"
    if (patternToRegExp(pattern).test(target) && pattern.length > best) best = pattern.length;
  }
  return best;
}

// target is path + query string, as robots.txt patterns are matched against both.
export function isPathBlocked(target, rule) {
  if (!rule) return false;
  const blocked = longestMatch(target, rule.disallow || []);
  if (blocked < 0) return false;
  const allowed = longestMatch(target, rule.allow || []);
  return blocked > allowed; // a tie goes to Allow
}

// Retry-After is either whole seconds or an HTTP date. Returns milliseconds, capped.
export function parseRetryAfter(header, now = Date.now(), capMs = 10 * 60 * 1000) {
  if (!header) return null;
  const value = String(header).trim();
  let ms = null;
  if (/^\d+$/.test(value)) ms = Number(value) * 1000;
  else {
    const at = Date.parse(value);
    if (!Number.isNaN(at)) ms = at - now;
  }
  if (ms == null) return null;
  return Math.min(Math.max(ms, 0), capMs);
}

export function isPlaceholderContact(email) {
  const e = String(email || "").trim().toLowerCase();
  if (!e || !e.includes("@")) return true;
  return /@(example\.(com|org|net)|localhost)$/.test(e) || e.startsWith("unset@");
}

export const isGovDomain = (domain) => /\.(gov|mil)$/i.test(domain);

// Our own floor, raised to whatever the site asks for in Crawl-delay.
export function effectiveDelaySeconds(domain, userSetting, robotsDelay = null) {
  const base = isGovDomain(domain)
    ? Math.max(6, userSetting || 3)
    : Math.min(10, Math.max(1, userSetting || 3));
  return Math.min(120, Math.max(base, robotsDelay || 0));
}
