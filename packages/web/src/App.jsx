import { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import MyceliumCanvas from './MyceliumCanvas.jsx'
import ConnectionsGraph from './ConnectionsGraph.jsx'
import {
  emptyNetwork, mergeNetwork, networkContext, networkSynthesisInput,
  networkSynopsis, networkIndex, filterSection, SECTION_DEFS,
} from './network.js'

// ─── Palette ──────────────────────────────────────────────────────────────────

const C = {
  bgDeep:  '#08080f',
  bgMain:  '#0f0f1a',
  bgCard:  '#161624',
  bgPanel: '#1e1e2a',
  gold:    '#c9a84c',
  violet:  '#9b72d8',
  amber:   '#e8a23a',
  purple:  '#6b3fa0',
  cream:   '#e8e4d8',
  warm:    '#585450',
  dim:     '#8884a0',
  border:  '#2a2a3a',
  red:     '#d45a5a',
}

// ─── System prompts ───────────────────────────────────────────────────────────

const SYS_MAP = `You are FUNGA.I., an adaptive investigative intelligence system. \
Your role is to map the investigation space for the given topic.

Analyse what you know and extract: key entities (people, organisations, events, \
documents, locations, government bodies, programs, financial nodes, media assets), \
known relationships, timeline anchors, and the best archive search vectors.

Return ONLY valid JSON — no markdown, no explanation, no code fences:
{
  "subject": "string",
  "entities": [
    { "name": "string", "type": "person|org|event|document|location|government_body|program|financial|media", "notes": "string" }
  ],
  "relationships": [
    { "from": "string", "to": "string", "relation": "string" }
  ],
  "timeline": [
    { "date": "string", "event": "string" }
  ],
  "searchVectors": ["string"],
  "archiveSources": ["blackvault","ciaCrest","wikileaks","nsarchive","internetArchive"]
}`

const SYS_EXPAND = `You are FUNGA.I. extending an investigation network. Given an \
initial entity map, identify the second-degree connections that are structurally \
implied but not yet named — adjacent government bodies, intelligence programs, \
financial nodes, media assets, institutional affiliations, predecessor and successor \
operations, cross-network patterns.

Think in systems: who funds this, who oversees it, who benefits, what preceded it, \
what ran in parallel, what was suppressed and by whom. Follow the money, the \
jurisdiction, and the timeline.

Return ONLY valid JSON — no markdown, no explanation, no code fences, no preamble. \
Your response must begin with '{' and end with '}'.
{
  "expandedEntities": [
    {
      "name": "string",
      "type": "government_body|program|financial|media|person|org|network",
      "connection": "string (which known entity links here and how)",
      "priority": "high|medium|low"
    }
  ],
  "systemicPatterns": ["string (cross-cutting structural patterns)"],
  "suggestedThreads": ["string (specific investigation threads to pursue)"]
}`

const SYS_RESEARCH = `You are FUNGA.I. conducting deep investigative research. You have \
been provided an entity map, a second-degree network expansion, and where available, \
archive document excerpts.

For each entity — primary and expanded — trace one level outward: who funded it, \
who oversaw it, what preceded or followed it, what parallel programs or operations \
existed, and what institutional affiliations connect it to broader power structures.

Analyse all evidence. Extract claims with confidence scores (0.0–1.0). Identify \
corroborated patterns. Flag inconsistencies and evidence gaps.

Return ONLY valid JSON — no markdown, no explanation, no code fences:
{
  "subject": "string",
  "findings": [
    {
      "claim": "string",
      "confidence": 0.0,
      "sources": ["string"],
      "entities": ["string"],
      "date": "string"
    }
  ],
  "entities": [
    {
      "name": "string",
      "type": "string",
      "confidence": 0.0,
      "aliases": ["string"],
      "notes": "string"
    }
  ],
  "inconsistencies": [
    { "entity": "string", "detail": "string" }
  ],
  "gaps": ["string"],
  "corroborated": ["string"]
}`

const SYS_SYNTH = `You are FUNGA.I. synthesizing a completed investigation. \
Using the entity map and research findings provided, produce a comprehensive, \
sourced intelligence brief.

Return ONLY valid JSON — no markdown, no explanation, no code fences, no preamble. \
Your response must begin with '{' and end with '}'. Nothing before or after the JSON object.
{
  "subject": "string",
  "summary": "string",
  "timeline": [
    { "date": "string", "event": "string", "confidence": 0.0, "sources": ["string"] }
  ],
  "cast": [
    { "name": "string", "role": "string", "notes": "string" }
  ],
  "keyFindings": ["string"],
  "subplots": ["string"],
  "inconsistencies": [
    { "entity": "string", "detail": "string", "citations": ["string"] }
  ],
  "followUpDirectives": ["string"],
  "confidence": 0.0
}`

// ─── Example prompts ──────────────────────────────────────────────────────────

const EXAMPLES = [
  'MKUltra program key figures and documents',
  'Operation Paperclip scientist recruitment 1945–1955',
  'COINTELPRO targets and methods 1956–1971',
  'TWA Flight 800 investigation inconsistencies',
  'Missing scientists 2022–2026 pattern',
  'GEC-Marconi SDI scientist deaths 1982–1990',
  'COINTELPRO',
]

// ─── Models ───────────────────────────────────────────────────────────────────

const EXTRACT_MODEL = 'claude-haiku-4-5-20251001'
const SYNTH_MODEL   = 'claude-sonnet-4-6'

// ─── Style object ─────────────────────────────────────────────────────────────

const S = {
  root: {
    minHeight: '100vh',
    background: `radial-gradient(ellipse at 20% 0%, #120827 0%, #0a0810 40%, ${C.bgDeep} 65%)`,
    color: C.cream,
    fontFamily: '"Space Mono", monospace',
    fontSize: '14px',
    lineHeight: 1.6,
  },

  header: {
    position: 'relative',
    height: '176px',
    overflow: 'hidden',
    borderBottom: `1px solid ${C.border}`,
    display: 'flex',
    alignItems: 'center',
    padding: '0 36px',
  },

  headerBg: {
    position: 'absolute',
    inset: 0,
    zIndex: 0,
  },

  headerContent: {
    position: 'relative',
    zIndex: 1,
    display: 'flex',
    alignItems: 'center',
    gap: '22px',
  },

  logo: {
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    border: `2px solid ${C.amber}`,
    objectFit: 'cover',
    flexShrink: 0,
    mixBlendMode: 'screen',
    boxShadow: `0 0 28px #823cff66, 0 0 12px ${C.amber}44`,
  },

  logoPlaceholder: {
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    border: `2px solid ${C.amber}`,
    background: `radial-gradient(circle at 40% 35%, #823cff55, ${C.bgPanel})`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '32px',
    flexShrink: 0,
    boxShadow: `0 0 28px #823cff66, 0 0 12px ${C.amber}44`,
  },

  wordmarkBlock: {
    display: 'flex',
    flexDirection: 'column',
    gap: '5px',
  },

  eyebrow: {
    fontFamily: '"Space Mono", monospace',
    fontSize: '9px',
    color: C.purple,
    letterSpacing: '0.3em',
    textTransform: 'uppercase',
  },

  wordmark: {
    fontFamily: '"Orbitron", sans-serif',
    fontSize: '32px',
    fontWeight: 700,
    color: '#e8e4d8',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    lineHeight: 1,
    textShadow: '0 0 18px rgba(130,60,255,0.5), 0 0 36px rgba(130,60,255,0.2)',
  },

  subhead: {
    fontFamily: '"Space Mono", monospace',
    fontStyle: 'italic',
    fontSize: '12px',
    color: C.warm,
  },

  main: {
    maxWidth: '920px',
    margin: '0 auto',
    padding: '32px 24px',
  },

  section: {
    marginBottom: '28px',
  },

  label: {
    display: 'block',
    fontSize: '10px',
    color: C.dim,
    letterSpacing: '0.22em',
    textTransform: 'uppercase',
    marginBottom: '8px',
    fontFamily: '"Orbitron", sans-serif',
  },

  input: {
    width: '100%',
    background: C.bgCard,
    border: `1px solid ${C.border}`,
    borderRadius: '6px',
    color: C.cream,
    fontFamily: '"Space Mono", monospace',
    fontSize: '15px',
    padding: '14px 16px',
    outline: 'none',
    boxSizing: 'border-box',
    resize: 'vertical',
    minHeight: '84px',
    transition: 'border-color 0.2s',
  },

  row: {
    display: 'flex',
    gap: '12px',
    alignItems: 'flex-start',
  },

  btnPrimary: {
    background: `linear-gradient(135deg, ${C.purple} 0%, ${C.violet} 100%)`,
    color: '#fff',
    border: 'none',
    borderRadius: '6px',
    padding: '14px 28px',
    fontFamily: '"Orbitron", sans-serif',
    fontSize: '13px',
    letterSpacing: '0.12em',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    fontWeight: 700,
    boxShadow: `0 0 16px ${C.purple}44`,
  },

  btnSecondary: {
    background: 'transparent',
    color: C.dim,
    border: `1px solid ${C.border}`,
    borderRadius: '6px',
    padding: '14px 20px',
    fontFamily: '"Space Mono", monospace',
    fontSize: '13px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
  },

  btnGhost: {
    background: 'transparent',
    color: C.amber,
    border: `1px solid ${C.amber}44`,
    borderRadius: '4px',
    padding: '7px 14px',
    fontFamily: '"Space Mono", monospace',
    fontSize: '11px',
    cursor: 'pointer',
  },

  networkBar: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '10px',
    alignItems: 'center',
    marginBottom: '24px',
    padding: '12px 14px',
    background: C.bgPanel,
    border: `1px solid ${C.border}`,
    borderRadius: '6px',
  },

  networkField: {
    background: C.bgCard,
    border: `1px solid ${C.border}`,
    borderRadius: '4px',
    color: C.cream,
    fontFamily: '"Space Mono", monospace',
    fontSize: '13px',
    padding: '8px 10px',
    outline: 'none',
    minWidth: 0,
  },

  exampleGrid: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginTop: '14px',
  },

  exampleChip: {
    background: C.bgPanel,
    border: `1px solid ${C.border}`,
    borderRadius: '999px',
    color: C.dim,
    padding: '6px 14px',
    fontSize: '12px',
    cursor: 'pointer',
    fontFamily: '"Space Mono", monospace',
  },

  phases: {
    display: 'flex',
    gap: '8px',
    marginBottom: '20px',
  },

  phaseStep: {
    flex: 1,
    padding: '13px 16px',
    borderRadius: '7px',
    border: `1px solid ${C.border}`,
    background: C.bgCard,
    transition: 'border-color 0.3s, box-shadow 0.3s',
  },

  phaseNum: {
    fontFamily: '"Orbitron", sans-serif',
    fontSize: '10px',
    letterSpacing: '0.15em',
    marginBottom: '4px',
  },

  phaseLabel: {
    fontFamily: '"Orbitron", sans-serif',
    fontSize: '11px',
    letterSpacing: '0.1em',
  },

  phaseMeta: {
    fontSize: '10px',
    marginTop: '5px',
    fontFamily: '"Space Mono", monospace',
  },

  status: {
    background: C.bgCard,
    border: `1px solid ${C.border}`,
    borderRadius: '6px',
    padding: '14px 16px',
    color: C.dim,
    fontFamily: '"Space Mono", monospace',
    fontSize: '13px',
    minHeight: '48px',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    marginBottom: '20px',
  },

  spinner: {
    display: 'inline-block',
    width: '12px',
    height: '12px',
    border: `2px solid ${C.border}`,
    borderTopColor: C.amber,
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    flexShrink: 0,
  },

  errorBox: {
    background: '#200e0e',
    border: `1px solid ${C.red}66`,
    borderRadius: '6px',
    padding: '14px 16px',
    color: C.red,
    fontFamily: '"Space Mono", monospace',
    fontSize: '13px',
    marginBottom: '20px',
  },

  card: {
    background: C.bgCard,
    border: `1px solid ${C.border}`,
    borderRadius: '8px',
    padding: '16px',
    marginBottom: '10px',
  },

  tag: {
    display: 'inline-block',
    padding: '2px 9px',
    borderRadius: '999px',
    fontSize: '10px',
    letterSpacing: '0.08em',
    fontFamily: '"Orbitron", sans-serif',
    textTransform: 'uppercase',
  },

  tagPerson:   { background: `${C.violet}22`, color: C.violet, border: `1px solid ${C.violet}44` },
  tagOrg:      { background: `${C.amber}22`,  color: C.amber,  border: `1px solid ${C.amber}44` },
  tagEvent:    { background: `${C.gold}22`,   color: C.gold,   border: `1px solid ${C.gold}44` },
  tagLocation: { background: `${C.purple}22`, color: C.purple, border: `1px solid ${C.purple}44` },
  tagDocument: { background: '#1e2e1e',       color: '#6ab88a', border: '1px solid #3a5a3a' },

  confBar: {
    height: '3px',
    borderRadius: '999px',
    background: C.border,
    marginTop: '10px',
    overflow: 'hidden',
  },

  tabs: {
    display: 'flex',
    gap: '2px',
    borderBottom: `1px solid ${C.border}`,
    marginBottom: '22px',
    overflowX: 'auto', // four tabs outgrow phone width; scroll the bar, not the page
  },

  tab: {
    padding: '10px 18px',
    fontFamily: '"Orbitron", sans-serif',
    fontSize: '10px',
    letterSpacing: '0.12em',
    cursor: 'pointer',
    color: C.dim,
    background: 'transparent',
    border: 'none',
    borderBottom: '2px solid transparent',
    textTransform: 'uppercase',
  },

  tabActive: {
    color: C.amber,
    borderBottomColor: C.amber,
  },

  resultSection: {
    marginBottom: '28px',
  },

  resultHeader: {
    fontFamily: '"Orbitron", sans-serif',
    fontSize: '12px',
    color: C.cream,
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
    marginBottom: '14px',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },

  badge: {
    background: C.bgPanel,
    border: `1px solid ${C.border}`,
    borderRadius: '999px',
    padding: '2px 10px',
    fontSize: '11px',
    color: C.dim,
    fontFamily: '"Space Mono", monospace',
    fontWeight: 'normal',
  },

  timelineDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
    background: C.amber,
    position: 'absolute',
    left: '-5px',
    top: '5px',
    flexShrink: 0,
  },

  timelineDate: {
    fontFamily: '"Orbitron", sans-serif',
    fontSize: '11px',
    color: C.gold,
    minWidth: '88px',
    paddingTop: '1px',
    flexShrink: 0,
  },

  timelineEvent: {
    color: C.cream,
    fontSize: '13px',
    lineHeight: 1.5,
  },

  // ─── Collapsible, searchable sections ──────────────────────────────────────

  disclosure: {
    background: C.bgCard,
    border: `1px solid ${C.border}`,
    borderRadius: '8px',
    marginBottom: '10px',
    overflow: 'hidden',
  },

  disclosureHead: {
    width: '100%',
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '13px 16px',
    background: 'transparent',
    border: 'none',
    cursor: 'pointer',
    textAlign: 'left',
    fontFamily: '"Orbitron", sans-serif',
    fontSize: '11px',
    letterSpacing: '0.15em',
    textTransform: 'uppercase',
  },

  disclosureCaret: {
    fontSize: '11px',
    width: '11px',
    flexShrink: 0,
  },

  disclosureLabel: {
    flex: 1,
    minWidth: 0,
  },

  disclosureNote: {
    fontFamily: '"Space Mono", monospace',
    fontSize: '11px',
    letterSpacing: 0,
    textTransform: 'none',
    color: C.dim,
  },

  disclosureBody: {
    padding: '12px 16px 14px',
    borderTop: `1px solid ${C.border}`,
  },

  filterInput: {
    width: '100%',
    background: C.bgMain,
    border: `1px solid ${C.border}`,
    borderRadius: '6px',
    color: C.cream,
    fontFamily: '"Space Mono", monospace',
    fontSize: '13px',
    padding: '8px 12px',
    outline: 'none',
    boxSizing: 'border-box',
  },

  filterMeta: {
    fontSize: '11px',
    color: C.dim,
    margin: '9px 0 4px',
    fontFamily: '"Space Mono", monospace',
  },

  emptyNote: {
    fontSize: '12px',
    color: C.warm,
    padding: '8px 0 2px',
    fontStyle: 'italic',
  },

  refRow: {
    borderTop: `1px solid ${C.border}`,
  },

  refRowHead: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '9px 2px',
    fontFamily: '"Space Mono", monospace',
    fontSize: '13px',
  },

  refRowCaret: {
    color: C.dim,
    fontSize: '10px',
    width: '10px',
    flexShrink: 0,
  },

  refRowTitle: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },

  refRowMeta: {
    flexShrink: 0,
    fontFamily: '"Orbitron", sans-serif',
    fontSize: '11px',
  },

  refRowDetail: {
    padding: '0 2px 12px 22px',
  },

  globalSearchRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '12px',
  },

  matchRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '8px',
    marginBottom: '16px',
  },

  // ─── Case synopsis ─────────────────────────────────────────────────────────

  synEntry: {
    display: 'flex',
    gap: '12px',
    padding: '12px 0 14px',
    borderTop: `1px solid ${C.border}`,
  },

  synOrdinal: {
    fontFamily: '"Orbitron", sans-serif',
    fontSize: '11px',
    color: C.violet,
    flexShrink: 0,
    width: '20px',
    paddingTop: '2px',
  },

  synTopic: {
    fontFamily: '"Orbitron", sans-serif',
    fontSize: '12px',
    color: C.cream,
    letterSpacing: '0.06em',
    marginBottom: '5px',
  },

  synLine: {
    fontSize: '12px',
    color: C.dim,
    lineHeight: 1.6,
  },

  synDelta: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '12px',
    marginTop: '8px',
    fontSize: '11px',
    fontFamily: '"Orbitron", sans-serif',
    letterSpacing: '0.06em',
  },

  synNames: {
    fontSize: '11px',
    color: C.warm,
    marginTop: '6px',
    lineHeight: 1.7,
  },

  synLink: {
    fontSize: '11px',
    color: C.amber,
    marginTop: '5px',
  },

  synDate: {
    fontSize: '11px',
    color: C.warm,
    flexShrink: 0,
    fontFamily: '"Orbitron", sans-serif',
    paddingTop: '2px',
  },

  synTotals: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '16px',
    marginTop: '14px',
    paddingTop: '13px',
    borderTop: `1px solid ${C.violet}44`,
    fontFamily: '"Orbitron", sans-serif',
    fontSize: '11px',
    letterSpacing: '0.1em',
    textTransform: 'uppercase',
    color: C.amber,
  },

  footer: {
    textAlign: 'center',
    padding: '20px 0 36px',
    color: C.warm,
    fontSize: '11px',
    fontFamily: '"Space Mono", monospace',
    opacity: 0.45,
    borderTop: `1px solid ${C.border}`,
    marginTop: '20px',
  },
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function safeJSON(raw) {
  if (!raw) return null
  const cleaned = raw
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim()
  try { return JSON.parse(cleaned) } catch { /* fall through */ }
  // Extract outermost {...} block in case Claude added preamble/postamble text
  const match = cleaned.match(/\{[\s\S]*\}/)
  if (match) {
    try { return JSON.parse(match[0]) } catch { /* fall through */ }
  }
  return null
}

function confColor(c) {
  const v = Number(c || 0)
  if (v >= 0.75) return C.amber
  if (v >= 0.50) return C.gold
  return C.warm
}

function confFill(pct, color) {
  return {
    height: '100%',
    width: `${Math.min(100, Math.round(Number(pct || 0) * 100))}%`,
    background: color || C.violet,
    borderRadius: '999px',
  }
}

function tagVariant(type) {
  switch ((type || '').toLowerCase()) {
    case 'person':   return S.tagPerson
    case 'org':      return S.tagOrg
    case 'event':    return S.tagEvent
    case 'location': return S.tagLocation
    default:         return S.tagDocument
  }
}

// ─── API helpers ──────────────────────────────────────────────────────────────

async function callClaude(model, system, prompt, maxTokens = 16000) {
  const resp = await fetch('/claude', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ system, prompt, model, maxTokens }),
  })
  if (!resp.ok) {
    const err = await resp.json().catch(() => ({}))
    throw new Error(`Claude proxy ${resp.status}: ${err?.error || resp.statusText}`)
  }
  const data = await resp.json()
  if (!data.ok) throw new Error(data.error || 'Claude proxy error')
  return { text: data.text || '', truncated: !!data.truncated }
}

// Retries once if safeJSON parse fails — catches transient formatting errors.
// A truncated reply (hit the output cap) is retried with a brevity instruction instead,
// since repeating the same prompt would just overflow again.
async function callClaudeJSON(model, system, prompt, maxTokens = 16000) {
  const first = await callClaude(model, system, prompt, maxTokens)
  const parsed = safeJSON(first.text)
  if (parsed) return parsed
  const reminder = first.truncated
    ? '\n\nIMPORTANT: Your previous answer was too long and was cut off. Be concise: at most 12 findings, ' +
      'short strings, no repetition. Your response must be valid JSON only. Begin with { and end with }.'
    : '\n\nIMPORTANT: Your response must be valid JSON only. Begin with { and end with }.'
  const second = await callClaude(model, system, prompt + reminder, maxTokens)
  return safeJSON(second.text)
}

async function fetchPriorIntelligence(topic) {
  const [memR, neighborsR] = await Promise.allSettled([
    fetch('/memory/query', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: topic, top_k: 5, min_confidence: 0.4 }),
    }).then(r => r.json()),
    fetch(`/memory/neighbors?concept=${encodeURIComponent(topic)}&depth=2`).then(r => r.json()),
  ])
  const memories  = memR.status       === 'fulfilled' ? (memR.value?.results   || []) : []
  const neighbors = neighborsR.status === 'fulfilled' ? (neighborsR.value?.neighbors || []) : []

  // Parse stored memories: "[relation] A — rel → B" → graph edges,
  // "[type] name: context" → graph nodes (the formats written by runSearch)
  const memNodes = []
  const memEdges = []
  for (const r of memories) {
    if (typeof r.content !== 'string') continue
    const rel = r.content.match(/^\[relation\]\s+(.+?)\s+—\s+(.+?)\s+→\s+(.+)$/)
    if (rel) {
      memEdges.push({ from: rel[1].trim(), to: rel[3].trim(), relation: rel[2].trim(), fromMemory: true })
      continue
    }
    const m = r.content.match(/^\[([^\]]+)\]\s+([^:]+)/)
    if (m) memNodes.push({ name: m[2].trim(), type: m[1].toLowerCase(), confidence: r.confidence, fromMemory: true })
  }

  const memCtx      = memories.map(r => r.content).join('\n').slice(0, 2000)
  const neighborCtx = neighbors.slice(0, 20).map(n => n.concept).join(', ')

  return { memories, neighbors, memNodes, memEdges, memCtx, neighborCtx }
}

async function listNetworks() {
  const resp = await fetch('/networks')
  if (!resp.ok) throw new Error(`Could not list networks (${resp.status})`)
  return resp.json()
}

async function fetchNetwork(id) {
  const resp = await fetch(`/networks/${encodeURIComponent(id)}`)
  if (!resp.ok) throw new Error(`Could not open network (${resp.status})`)
  return resp.json()
}

async function saveNetwork(network) {
  const resp = await fetch(`/networks/${encodeURIComponent(network.id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(network),
  })
  const data = await resp.json().catch(() => ({}))
  if (!resp.ok || !data.ok) throw new Error(data.error || `Save failed (${resp.status})`)
  return data
}

async function callfungai(subject, sources) {
  try {
    const resp = await fetch('/search', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subject, sources: sources || [], depth: 1 }),
    })
    if (!resp.ok) return ''
    const data = await resp.json()
    if (!data?.ok) return ''
    return ''
  } catch {
    return ''
  }
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function PhaseStep({ num, label, active, done }) {
  const color       = done ? C.amber : active ? C.violet : C.dim
  const borderColor = done ? `${C.amber}88` : active ? `${C.violet}88` : C.border
  const shadow      = active ? `0 0 14px ${C.violet}33` : 'none'
  return (
    <div style={{ ...S.phaseStep, borderColor, boxShadow: shadow }}>
      <div style={{ ...S.phaseNum, color }}>{num}</div>
      <div style={{ ...S.phaseLabel, color }}>{label}</div>
      {done   && <div style={{ ...S.phaseMeta, color: C.amber }}>✓ complete</div>}
      {active && <div style={{ ...S.phaseMeta, color: C.violet }}>● active</div>}
    </div>
  )
}

// A collapsible section. Collapsed by default so a long case stays one screen tall.
function Disclosure({ label, count, note, accent = C.cream, open, onToggle, children }) {
  return (
    <div style={S.disclosure}>
      <button type="button" style={S.disclosureHead} onClick={onToggle} aria-expanded={open}>
        <span style={{ ...S.disclosureCaret, color: accent }}>{open ? '▾' : '▸'}</span>
        <span style={{ ...S.disclosureLabel, color: accent }}>{label}</span>
        {count != null && <span style={S.badge}>{count}</span>}
        {note && <span style={S.disclosureNote}>{note}</span>}
      </button>
      {open && <div style={S.disclosureBody}>{children}</div>}
    </div>
  )
}

// One line per reference; click to expand that one in place. Nothing from the old
// cards is lost — it just stays folded until asked for.
function RefRow({ title, titleColor, meta, detail }) {
  const [open, setOpen] = useState(false)
  const expandable = Boolean(detail)
  const toggle = () => expandable && setOpen(o => !o)
  return (
    <div style={S.refRow}>
      <div
        style={{ ...S.refRowHead, cursor: expandable ? 'pointer' : 'default' }}
        onClick={toggle}
        role={expandable ? 'button' : undefined}
        tabIndex={expandable ? 0 : undefined}
        aria-expanded={expandable ? open : undefined}
        onKeyDown={e => {
          if (expandable && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); toggle() }
        }}
      >
        <span style={S.refRowCaret}>{expandable ? (open ? '▾' : '▸') : '·'}</span>
        <span style={{ ...S.refRowTitle, color: titleColor || C.cream }}>{title}</span>
        {meta}
      </div>
      {expandable && open && <div style={S.refRowDetail}>{detail}</div>}
    </div>
  )
}

// A searchable collection: its own filter bar over the shared reference index.
function RefSection({ sectionKey, label, accent, entries, query, onQuery, open, onToggle, children }) {
  const shown = useMemo(() => filterSection(entries, query), [entries, query])
  if (!entries.length) return null
  const q = query.trim()
  return (
    <Disclosure
      label={label}
      count={entries.length}
      accent={accent}
      open={open}
      onToggle={onToggle}
      note={q ? `${shown.length} matching` : null}
    >
      <input
        style={S.filterInput}
        value={query}
        placeholder={`Search ${label.toLowerCase()}…`}
        onChange={e => onQuery(sectionKey, e.target.value)}
        aria-label={`Search ${label}`}
      />
      <div style={S.filterMeta}>
        {q ? `${shown.length} of ${entries.length} match` :
             `${entries.length} reference${entries.length === 1 ? '' : 's'}`}
      </div>
      {shown.length === 0
        ? <div style={S.emptyNote}>Nothing in {label.toLowerCase()} matches “{q}”.</div>
        : children(shown.map(e => e.item))}
    </Disclosure>
  )
}

function Delta({ n, label, color }) {
  return (
    <span style={{ color: n ? color : C.warm }}>
      {n ? `+${n}` : '—'} {label}
    </span>
  )
}

const fmtDay = at => {
  const d = new Date(Number(at) || 0)
  return Number.isNaN(d.getTime()) || !at
    ? ''
    : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// The growing cliff notes: per search, what it was first to establish, derived from
// the saved searches rather than stored, so it can never drift from the evidence.
function CaseSynopsis({ synopsis, open, onToggle }) {
  const { entries, totals } = synopsis
  if (!entries.length) return null
  return (
    <Disclosure
      label="Case synopsis"
      accent={C.violet}
      open={open}
      onToggle={onToggle}
      note={`${entries.length} search${entries.length === 1 ? '' : 'es'} · ${totals.entities} entities · ${totals.findings} findings`}
    >
      {entries.map(e => (
        <div key={e.id} style={S.synEntry}>
          <div style={S.synOrdinal}>{String(e.ordinal).padStart(2, '0')}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={S.synTopic}>{e.topic}</div>
            <div style={S.synLine}>
              {e.summary || (e.pending
                ? 'Search still running — no brief yet.'
                : 'No brief was synthesized for this search.')}
            </div>
            <div style={S.synDelta}>
              <Delta n={e.added.entities.length} label="entities" color={C.amber} />
              <Delta n={e.added.relationships}   label="links"    color={C.violet} />
              <Delta n={e.added.findings}        label="findings" color={C.gold} />
              <Delta n={e.added.timeline}        label="events"   color={C.purple} />
            </div>
            {e.added.entities.length > 0 && (
              <div style={S.synNames}>
                {e.added.entities.slice(0, 8).join(' · ')}
                {e.added.entities.length > 8 ? ` · +${e.added.entities.length - 8} more` : ''}
              </div>
            )}
            {e.reinforced.map(r => (
              <div key={r.from} style={S.synLink}>
                ↗ {r.count} {r.count === 1 ? 'entity' : 'entities'} also in search {String(r.from).padStart(2, '0')}
              </div>
            ))}
          </div>
          <div style={S.synDate}>{fmtDay(e.at)}</div>
        </div>
      ))}
      <div style={S.synTotals}>
        <span>Case total</span>
        <span>{totals.entities} entities</span>
        <span>{totals.relationships} links</span>
        <span>{totals.findings} findings</span>
        <span>{totals.timeline} events</span>
      </div>
    </Disclosure>
  )
}

// ─── Reference detail bodies (folded out of a RefRow) ─────────────────────────

// A row is only expandable when there is something folded inside it.
const entityHasDetail = e => Boolean(
  e.notes || e.aliases?.length || (e.foundIn?.length || 0) > 1 || Number(e.confidence ?? -1) >= 0,
)
const castHasDetail = c => Boolean(c.role || c.notes)

function EntityDetail({ entity }) {
  const conf = Number(entity.confidence ?? -1)
  return (
    <div>
      {entity.notes && (
        <div style={{ fontSize: '12px', color: C.dim, lineHeight: 1.6 }}>{entity.notes}</div>
      )}
      {entity.aliases?.length > 0 && (
        <div style={{ marginTop: '6px', fontSize: '11px', color: C.warm }}>
          aka: {entity.aliases.join(', ')}
        </div>
      )}
      {entity.foundIn?.length > 1 && (
        <div style={{ marginTop: '6px', fontSize: '11px', color: C.amber }}>
          ↔ linked across: {entity.foundIn.join(' · ')}
        </div>
      )}
      {conf >= 0 && (
        <div style={S.confBar}>
          <div style={confFill(conf, confColor(conf))} />
        </div>
      )}
    </div>
  )
}

function FindingDetail({ finding, showTopic }) {
  const conf = Number(finding.confidence || 0)
  return (
    <div>
      <div style={{ fontSize: '13px', color: C.cream, lineHeight: 1.65 }}>{finding.claim}</div>
      {showTopic && finding.topic && (
        <div style={{ fontSize: '10px', color: C.purple, marginTop: '7px', letterSpacing: '0.1em' }}>
          from: {finding.topic}
        </div>
      )}
      {finding.date && (
        <div style={{ marginTop: '6px', fontSize: '11px', color: C.gold, fontFamily: '"Orbitron", sans-serif' }}>
          {finding.date}
        </div>
      )}
      {finding.entities?.length > 0 && (
        <div style={{ marginTop: '8px', display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
          {finding.entities.map((e, i) => (
            <span key={i} style={{ ...S.tag, ...S.tagPerson }}>{e}</span>
          ))}
        </div>
      )}
      <div style={S.confBar}>
        <div style={confFill(conf, confColor(conf))} />
      </div>
    </div>
  )
}

function CastDetail({ person }) {
  if (!person.role && !person.notes) return null
  return (
    <div>
      {person.role && (
        <div style={{ fontSize: '11px', color: C.violet, fontFamily: '"Orbitron", sans-serif', letterSpacing: '0.08em' }}>
          {person.role}
        </div>
      )}
      {person.notes && (
        <div style={{ fontSize: '12px', color: C.dim, marginTop: '7px', lineHeight: 1.6 }}>
          {person.notes}
        </div>
      )}
    </div>
  )
}

// ─── App ──────────────────────────────────────────────────────────────────────

export default function App() {
  const [topic,        setTopic]        = useState('')
  const [phase,        setPhase]        = useState('idle')
  const [network,      setNetwork]      = useState(() => emptyNetwork())
  const [networks,     setNetworks]     = useState([])   // saved network summaries
  const [live,         setLive]         = useState(null) // search in progress (not yet saved)
  const [memoryData,   setMemoryData]   = useState(null)
  const [briefChoice,  setBriefChoice]  = useState(null) // search id, 'network', or null = latest
  const [netBusy,      setNetBusy]      = useState(false)
  const [error,        setError]        = useState('')
  const [statusMsg,    setStatusMsg]    = useState('')
  const [activeTab,    setActiveTab]    = useState('map')
  const [openSections, setOpenSections] = useState(() => new Set(['synopsis']))
  const [sectionQuery, setSectionQuery] = useState({})   // sectionKey -> its own filter
  const [globalQuery,  setGlobalQuery]  = useState('')   // filters the whole case
  const [logoError,    setLogoError]    = useState(false)
  const networkRef = useRef(network)
  const runIdRef   = useRef(0) // bumped to cancel an in-flight search (clear / switch network)

  const replaceNetwork = useCallback(next => {
    networkRef.current = next
    setNetwork(next)
  }, [])

  const refreshList = useCallback(() => {
    listNetworks().then(setNetworks).catch(() => {})
  }, [])

  // Save, then record the server's timestamps without clobbering edits made meanwhile.
  const persist = useCallback(async next => {
    try {
      const { updatedAt, createdAt } = await saveNetwork(next)
      if (networkRef.current.id === next.id) {
        replaceNetwork({ ...networkRef.current, updatedAt, createdAt })
      }
      refreshList()
    } catch (err) {
      setError(`Network not saved: ${err.message}`)
    }
  }, [replaceNetwork, refreshList])

  // Open the most recently updated network on load.
  useEffect(() => {
    listNetworks()
      .then(list => {
        setNetworks(list)
        if (list.length) return fetchNetwork(list[0].id).then(replaceNetwork)
      })
      .catch(err => setError(err.message))
  }, [replaceNetwork])

  const searches = useMemo(
    () => (live ? [...network.searches, live] : network.searches),
    [network.searches, live],
  )
  const merged  = useMemo(() => mergeNetwork(searches), [searches])
  const mapData = merged.map
  const resData = merged.res

  // One derivation feeds both the growing synopsis and every section's search bar.
  const synopsis = useMemo(() => networkSynopsis(searches), [searches])
  const index    = useMemo(() => networkIndex(merged), [merged])

  // A section's effective filter is its own if typed, otherwise the whole-case one.
  const queryFor = useCallback(
    key => sectionQuery[key] ?? globalQuery,
    [sectionQuery, globalQuery],
  )
  const setQueryFor = useCallback(
    (key, value) => setSectionQuery(prev => ({ ...prev, [key]: value })),
    [],
  )
  const toggleSection = useCallback(key => setOpenSections(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  }), [])
  const isOpen = useCallback(key => openSections.has(key), [openSections])

  // Whole-case search: per-section hit counts, so a name can be found without
  // knowing which collection holds it.
  const globalHits = useMemo(() => {
    const q = globalQuery.trim()
    if (!q) return null
    return SECTION_DEFS
      .map(def => ({ def, count: filterSection(index[def.key], q).length }))
      .filter(hit => hit.count > 0)
  }, [globalQuery, index])

  // Typing in the whole-case bar opens the sections that actually hold matches.
  // Keyed on the query alone, deliberately: if it also watched the index, every
  // merge during a running search would re-open a section the user just closed.
  const indexRef = useRef(index)
  useEffect(() => { indexRef.current = index }, [index])
  useEffect(() => {
    const q = globalQuery.trim()
    if (!q) return
    const hits = SECTION_DEFS
      .filter(def => filterSection(indexRef.current[def.key], q).length > 0)
      .map(def => def.key)
    if (hits.length) setOpenSections(prev => new Set([...prev, ...hits]))
  }, [globalQuery])

  const onGlobalQuery = useCallback(value => {
    setGlobalQuery(value)
    setSectionQuery({})   // a new whole-case query supersedes per-section filters
  }, [])

  const briefs = searches.filter(s => s.synth)
  const synthData =
    briefChoice === 'network'
      ? network.networkBrief?.synth || null
      : (briefs.find(s => s.id === briefChoice) || briefs[briefs.length - 1])?.synth || null
  const multiSearch = searches.length > 1

  const entityCount =
    (mapData?.entities?.length  || 0) +
    (resData?.entities?.length  || 0) +
    (merged.synth?.cast?.length || 0)

  const runSearch = useCallback(async () => {
    if (!topic.trim()) return
    const runId = ++runIdRef.current
    const cancelled = () => runIdRef.current !== runId
    const prior = networkRef.current
    const searchTopic = topic.trim()
    let search = { id: crypto.randomUUID(), topic: searchTopic, at: Date.now() }
    const update = patch => { search = { ...search, ...patch }; setLive(search) }

    setError('')
    setLive(search)
    setBriefChoice(null)
    setActiveTab('map')

    // Searches build on the case: the existing network goes into every phase prompt.
    const existingCtx = networkContext(mergeNetwork(prior.searches))
    const networkBlock = existingCtx
      ? `\n\nExisting network in this case (from ${prior.searches.length} prior search` +
        `${prior.searches.length === 1 ? '' : 'es'}):\n${existingCtx}\n\n` +
        'Where this topic genuinely connects to existing nodes, reuse their exact names and ' +
        'state those relationships. Do not invent connections that the evidence does not support.'
      : ''

    // ── Phase 1: SPORE CAST ──────────────────────────────────────────────────
    try {
      setPhase('mapping')
      setStatusMsg('Querying memory network for prior intelligence…')
      const { memories, neighbors, memNodes, memEdges } = await fetchPriorIntelligence(searchTopic)
      if (cancelled()) return
      setMemoryData({ nodes: memNodes, edges: memEdges })
      const memCtx      = memories.map(r => r.content).join('\n')
      const neighborCtx = neighbors.map(n => n.concept).join(', ')

      setStatusMsg(prior.searches.length
        ? 'Casting spores — extending the existing network…'
        : 'Casting spores — mapping the investigation space…')

      const map = await callClaudeJSON(
        EXTRACT_MODEL,
        SYS_MAP,
        `Investigation topic: ${searchTopic}` +
        (memCtx      ? `\n\nPrior intelligence from memory:\n${memCtx}`                          : '') +
        (neighborCtx ? `\n\nRelated concepts from prior investigations: ${neighborCtx}` : '') +
        networkBlock,
      )
      if (cancelled()) return
      if (!map) throw new Error('SPORE CAST returned unparseable JSON. Please retry the investigation.')
      update({ map })

      // Store SPORE CAST entities + relationships to memory so future maps inherit the graph
      for (const e of map.entities || []) {
        fetch('/memory/store', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: `[${e.type || 'entity'}] ${e.name}${e.notes ? ': ' + e.notes : ''}`, confidence: 0.75, source: searchTopic, tags: [e.type, searchTopic].filter(Boolean) }),
        }).catch(() => {})
      }
      for (const r of map.relationships || []) {
        fetch('/memory/store', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content: `[relation] ${r.from} — ${r.relation} → ${r.to}`, confidence: 0.8, source: searchTopic, tags: [r.from, r.to, r.relation, searchTopic].filter(Boolean) }),
        }).catch(() => {})
      }

      // ── Web Expansion: second-degree network trace ───────────────────────
      setStatusMsg('Extending the web — tracing second-degree connections…')
      const expand = await callClaudeJSON(
        EXTRACT_MODEL,
        SYS_EXPAND,
        `Investigation topic: ${searchTopic}\n\nEntity map:\n${JSON.stringify(map, null, 2)}`,
        2048,
      ) || {}
      if (cancelled()) return
      update({ expand })

      // ── Phase 2: MYCELIUM SPREAD ─────────────────────────────────────────
      setPhase('researching')
      setStatusMsg('Spreading mycelium — querying archive sources…')

      let archiveCtx = ''
      archiveCtx = await callfungai(searchTopic, map.archiveSources || [])
      if (archiveCtx) setStatusMsg('Spreading mycelium — analysing archive context…')

      const resPrompt = [
        `Investigation topic: ${searchTopic}`,
        '',
        'Entity map from SPORE CAST:',
        JSON.stringify(map, null, 2),
        expand.expandedEntities?.length
          ? `\nSecond-degree network expansion:\n${JSON.stringify(expand, null, 2)}`
          : '',
        archiveCtx ? `\nArchive context:\n${archiveCtx}` : '',
        networkBlock,
        '',
        'Conduct deep research. For each entity — primary and expanded — trace ' +
        'funding, oversight, predecessors, successors, and parallel operations. ' +
        'Extract findings with confidence scores. Flag all inconsistencies.',
      ].filter(Boolean).join('\n')

      const res = await callClaudeJSON(EXTRACT_MODEL, SYS_RESEARCH, resPrompt)
      if (cancelled()) return
      if (!res) throw new Error('MYCELIUM SPREAD returned unparseable JSON.')
      update({ res })

      // ── Phase 3: FRUITING BODY ───────────────────────────────────────────
      setPhase('synthesizing')
      setStatusMsg('Forming fruiting body — synthesising intelligence brief…')

      const synthPrompt = [
        `Investigation topic: ${searchTopic}`,
        '',
        'Entity map (SPORE CAST):',
        JSON.stringify(map, null, 2),
        '',
        'Research findings (MYCELIUM SPREAD):',
        JSON.stringify(res, null, 2),
        '',
        'Produce the final intelligence brief with timeline, cast, key findings, ' +
        'subplots, inconsistencies, and follow-up directives.',
      ].join('\n')

      const synth = await callClaudeJSON(SYNTH_MODEL, SYS_SYNTH, synthPrompt)
      if (cancelled()) return
      if (!synth) throw new Error('FRUITING BODY returned unparseable JSON.')
      update({ synth })

      // Persist synthesis to the memory pool (fire-and-forget)
      if (synth.summary) {
        fetch('/memory/store', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            content:    `[${searchTopic}] ${synth.summary}`,
            confidence: synth.confidence ?? 0.7,
            source:     searchTopic,
            tags:       (synth.cast || []).map(c => c.name).slice(0, 10),
          }),
        }).catch(() => {})
      }

      setPhase('done')
      setStatusMsg(`Added to network — ${networkRef.current.searches.length + 1} searches in this case.`)
      setActiveTab('synth')
      setTopic('')
    } catch (err) {
      if (cancelled()) return
      setError(err.message)
      setPhase('error')
      setStatusMsg('')
    }

    // Keep whatever phases completed (a failed search can still add its spore map).
    if (cancelled() || !search.map) { setLive(null); return }
    const next = { ...networkRef.current, searches: [...networkRef.current.searches, search] }
    replaceNetwork(next)
    setLive(null)
    persist(next)
  }, [topic, replaceNetwork, persist])

  const synthesizeNetwork = useCallback(async () => {
    const current = networkRef.current
    if (current.searches.length < 2) return
    setNetBusy(true)
    setError('')
    try {
      const input = networkSynthesisInput(current, mergeNetwork(current.searches))
      const synth = await callClaudeJSON(
        SYNTH_MODEL,
        SYS_SYNTH,
        `This case combines ${current.searches.length} searches: ` +
        `${current.searches.map(s => s.topic).join(' | ')}\n\n` +
        `Combined network:\n${JSON.stringify(input, null, 2)}\n\n` +
        'Produce one intelligence brief for the whole network. Focus on connections ' +
        'that span searches: shared actors, overlapping timelines, and patterns that only ' +
        'appear when the searches are read together.',
      )
      if (!synth) throw new Error('Network synthesis returned unparseable JSON.')
      if (networkRef.current.id !== current.id) return
      const next = {
        ...networkRef.current,
        networkBrief: { at: Date.now(), searchCount: current.searches.length, synth },
      }
      replaceNetwork(next)
      setBriefChoice('network')
      persist(next)
    } catch (err) {
      setError(err.message)
    } finally {
      setNetBusy(false)
    }
  }, [replaceNetwork, persist])

  // Leave the current network as saved and reset the run state.
  function resetRun() {
    runIdRef.current++
    setLive(null)
    setPhase('idle')
    setMemoryData(null)
    setBriefChoice(null)
    setError('')
    setStatusMsg('')
    setActiveTab('map')
  }

  // Clear Substrate: start a fresh network; the current one stays saved and reopenable.
  function handleReset() {
    resetRun()
    setTopic('')
    replaceNetwork(emptyNetwork())
  }

  async function handleOpenNetwork(id) {
    if (id === networkRef.current.id) return
    resetRun()
    try {
      replaceNetwork(await fetchNetwork(id))
    } catch (err) {
      setError(err.message)
    }
  }

  function handleRename(name) {
    const next = { ...networkRef.current, name }
    replaceNetwork(next)
  }

  function commitRename() {
    const current = networkRef.current
    if (!current.name.trim()) replaceNetwork({ ...current, name: 'Untitled network' })
    // Unsaved drafts get their name on first save; saved networks save the rename now.
    if (current.searches.length) persist(networkRef.current)
  }

  // Follow-up directives extend the current network instead of resetting it.
  function handleFollowUp(directive) {
    setTopic(directive)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const isActive = ['mapping', 'researching', 'synthesizing'].includes(phase)
  const hasResults = Boolean(mapData || resData || synthData || briefs.length)
  const isSaved = networks.some(n => n.id === network.id)

  const TABS = [
    { id: 'map',   label: 'Spore Map',     data: mapData  },
    { id: 'res',   label: 'Mycelium',      data: resData  },
    { id: 'synth', label: 'Fruiting Body', data: briefs.length || network.networkBrief },
    { id: 'graph', label: 'Connections',   data: mapData || resData || merged.synth },
  ]

  return (
    <div style={S.root}>
      <style>{`
        * { box-sizing: border-box; }
        @keyframes spin { to { transform: rotate(360deg); } }
        textarea:focus, input:focus { border-color: ${C.violet} !important; }
        button:hover { opacity: 0.88; }
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-track { background: ${C.bgMain}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
      `}</style>

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <header style={S.header}>
        <div style={S.headerBg}>
          <MyceliumCanvas activeEntityCount={entityCount} />
        </div>
        <div style={S.headerContent}>
          {logoError ? (
            <div style={S.logoPlaceholder}>🍄</div>
          ) : (
            <img
              src="/logo.png"
              alt="FungAI P.I."
              style={S.logo}
              onError={() => setLogoError(true)}
            />
          )}
          <div style={S.wordmarkBlock}>
            <div style={S.eyebrow}>Adaptive Investigative Intelligence</div>
            <div style={S.wordmark}>FUNGA.I. P.I.</div>
            <div style={S.subhead}>Mycelium maps the hidden network. So do we.</div>
          </div>
        </div>
      </header>

      {/* ── Main ─────────────────────────────────────────────────────────── */}
      <main style={S.main}>

        {/* Error */}
        {error && (
          <div style={S.errorBox}>⚠ {error}</div>
        )}

        {/* ── Network: pick, name, or start a new one ──────────────────── */}
        <div style={S.networkBar}>
          <label htmlFor="network-picker" style={{ ...S.label, marginBottom: 0 }}>Network</label>
          <select
            id="network-picker"
            style={{ ...S.networkField, flex: '1 1 160px' }}
            value={network.id}
            disabled={isActive}
            onChange={e => handleOpenNetwork(e.target.value)}
          >
            {!isSaved && <option value={network.id}>{network.name} (new)</option>}
            {networks.map(n => (
              <option key={n.id} value={n.id}>
                {n.id === network.id ? network.name : n.name} · {n.searchCount} search{n.searchCount === 1 ? '' : 'es'}
              </option>
            ))}
          </select>
          <input
            aria-label="Network name"
            style={{ ...S.networkField, flex: '1 1 160px' }}
            value={network.name}
            maxLength={200}
            onChange={e => handleRename(e.target.value)}
            onBlur={commitRename}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }}
          />
          <button
            style={{ ...S.btnSecondary, padding: '8px 14px' }}
            onClick={handleReset}
            title="Start a new network. The current one stays saved."
          >
            ↺ Clear Substrate
          </button>
        </div>

        {/* ── Topic input: always available between searches ───────────── */}
        {!isActive && (
          <div style={S.section}>
            <label htmlFor="topic-input" style={S.label}>
              {network.searches.length ? 'Extend this network' : 'Investigation Topic'}
            </label>
            <textarea
              id="topic-input"
              style={S.input}
              placeholder={network.searches.length
                ? 'Add another search — new findings link into the existing network…'
                : 'Describe what you want to investigate…'}
              value={topic}
              onChange={e => setTopic(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runSearch() }}
            />
            {!network.searches.length && (
              <div style={S.exampleGrid}>
                {EXAMPLES.map((ex, i) => (
                  <button key={i} style={S.exampleChip} onClick={() => setTopic(ex)}>
                    {ex}
                  </button>
                ))}
              </div>
            )}
            <div style={{ ...S.row, marginTop: '14px' }}>
              <button style={S.btnPrimary} onClick={runSearch} disabled={!topic.trim()}>
                ◉ Inoculate
              </button>
            </div>
          </div>
        )}

        {(isActive || hasResults || phase === 'done') && (
          <>
            {/* ── Phase indicators for the current search ──────────────── */}
            {(isActive || phase === 'done') && (
              <div style={S.phases}>
                <PhaseStep
                  num="01" label="SPORE CAST"
                  active={phase === 'mapping'}
                  done={['researching', 'synthesizing', 'done'].includes(phase)}
                />
                <PhaseStep
                  num="02" label="MYCELIUM SPREAD"
                  active={phase === 'researching'}
                  done={['synthesizing', 'done'].includes(phase)}
                />
                <PhaseStep
                  num="03" label="FRUITING BODY"
                  active={phase === 'synthesizing'}
                  done={phase === 'done'}
                />
              </div>
            )}

            {/* Status line */}
            {(isActive || statusMsg) && (
              <div style={S.status}>
                {isActive && <div style={S.spinner} />}
                <span style={{ color: isActive ? C.violet : C.amber }}>
                  {isActive && live ? `${live.topic} — ` : ''}{statusMsg}
                </span>
              </div>
            )}

            {/* ── Results ───────────────────────────────────────────────── */}
            {hasResults && (
              <>
                {/* Growing case synopsis — the running cliff notes, above every tab */}
                <CaseSynopsis
                  synopsis={synopsis}
                  open={isOpen('synopsis')}
                  onToggle={() => toggleSection('synopsis')}
                />

                {/* Whole-case search — finds a reference without knowing its section */}
                <div style={S.globalSearchRow}>
                  <input
                    style={{ ...S.filterInput, flex: 1 }}
                    value={globalQuery}
                    placeholder="Search the whole case — names, claims, dates, places…"
                    onChange={e => onGlobalQuery(e.target.value)}
                    aria-label="Search the whole case"
                  />
                  {globalQuery.trim() && (
                    <button type="button" style={S.btnGhost} onClick={() => onGlobalQuery('')}>
                      clear
                    </button>
                  )}
                </div>
                {globalHits && (
                  <div style={S.matchRow}>
                    {globalHits.length === 0 ? (
                      <span style={S.emptyNote}>
                        No reference in this case matches “{globalQuery.trim()}”.
                      </span>
                    ) : globalHits.map(({ def, count }) => (
                      <button
                        key={def.key}
                        type="button"
                        style={{
                          ...S.btnGhost,
                          ...(activeTab === def.tab ? { borderColor: C.violet, color: C.violet } : {}),
                        }}
                        onClick={() => {
                          setActiveTab(def.tab)
                          setOpenSections(prev => new Set([...prev, def.key]))
                        }}
                      >
                        {def.label} <span style={S.badge}>{count}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Tab bar */}
                <div style={S.tabs}>
                  {TABS.map(t => (
                    <button
                      key={t.id}
                      style={{
                        ...S.tab,
                        ...(activeTab === t.id ? S.tabActive : {}),
                        opacity: t.data ? 1 : 0.35,
                        cursor: t.data ? 'pointer' : 'default',
                      }}
                      onClick={() => t.data && setActiveTab(t.id)}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {/* ── MAP tab ─────────────────────────────────────────── */}
                {activeTab === 'map' && mapData && (
                  <div>
                    <RefSection
                      sectionKey="mapEntities" label="Entities"
                      entries={index.mapEntities}
                      query={queryFor('mapEntities')} onQuery={setQueryFor}
                      open={isOpen('mapEntities')} onToggle={() => toggleSection('mapEntities')}
                    >
                      {items => items.map(e => (
                        <RefRow
                          key={e.name}
                          title={e.name}
                          meta={
                            <>
                              <span style={{ ...S.tag, ...tagVariant(e.type) }}>{e.type || 'entity'}</span>
                              {Number(e.confidence ?? -1) >= 0 && (
                                <span style={{ ...S.refRowMeta, color: confColor(Number(e.confidence)) }}>
                                  {Math.round(Number(e.confidence) * 100)}%
                                </span>
                              )}
                            </>
                          }
                          detail={entityHasDetail(e) ? <EntityDetail entity={e} /> : null}
                        />
                      ))}
                    </RefSection>

                    <RefSection
                      sectionKey="relationships" label="Relationships"
                      entries={index.relationships}
                      query={queryFor('relationships')} onQuery={setQueryFor}
                      open={isOpen('relationships')} onToggle={() => toggleSection('relationships')}
                    >
                      {items => items.map(r => (
                        <RefRow
                          key={`${r.from}|${r.relation}|${r.to}`}
                          title={
                            <>
                              {r.from}
                              <span style={{ color: C.amber, fontSize: '11px' }}> — {r.relation} → </span>
                              {r.to}
                            </>
                          }
                        />
                      ))}
                    </RefSection>

                    <RefSection
                      sectionKey="timeline" label="Timeline"
                      accent={C.gold}
                      entries={index.timeline}
                      query={queryFor('timeline')} onQuery={setQueryFor}
                      open={isOpen('timeline')} onToggle={() => toggleSection('timeline')}
                    >
                      {items => items.map(t => (
                        <RefRow
                          key={`${t.date}|${t.event}`}
                          title={t.event}
                          meta={<span style={{ ...S.refRowMeta, color: C.gold }}>{t.date}</span>}
                        />
                      ))}
                    </RefSection>

                    <RefSection
                      sectionKey="searchVectors" label="Search Vectors"
                      entries={index.searchVectors}
                      query={queryFor('searchVectors')} onQuery={setQueryFor}
                      open={isOpen('searchVectors')} onToggle={() => toggleSection('searchVectors')}
                    >
                      {items => items.map(v => <RefRow key={v} title={v} />)}
                    </RefSection>
                  </div>
                )}

                {/* ── RESEARCH tab ─────────────────────────────────────── */}
                {activeTab === 'res' && resData && (
                  <div>
                    <RefSection
                      sectionKey="findings" label="Findings"
                      entries={index.findings}
                      query={queryFor('findings')} onQuery={setQueryFor}
                      open={isOpen('findings')} onToggle={() => toggleSection('findings')}
                    >
                      {items => items.map(f => {
                        const conf = Number(f.confidence || 0)
                        return (
                          <RefRow
                            key={f.claim}
                            title={f.claim}
                            meta={<span style={{ ...S.refRowMeta, color: confColor(conf) }}>
                              {Math.round(conf * 100)}%
                            </span>}
                            detail={<FindingDetail finding={f} showTopic={multiSearch} />}
                          />
                        )
                      })}
                    </RefSection>

                    <RefSection
                      sectionKey="resEntities" label="Resolved Entities"
                      entries={index.resEntities}
                      query={queryFor('resEntities')} onQuery={setQueryFor}
                      open={isOpen('resEntities')} onToggle={() => toggleSection('resEntities')}
                    >
                      {items => items.map(e => (
                        <RefRow
                          key={e.name}
                          title={e.name}
                          meta={
                            <>
                              <span style={{ ...S.tag, ...tagVariant(e.type) }}>{e.type || 'entity'}</span>
                              {Number(e.confidence ?? -1) >= 0 && (
                                <span style={{ ...S.refRowMeta, color: confColor(Number(e.confidence)) }}>
                                  {Math.round(Number(e.confidence) * 100)}%
                                </span>
                              )}
                            </>
                          }
                          detail={entityHasDetail(e) ? <EntityDetail entity={e} /> : null}
                        />
                      ))}
                    </RefSection>

                    <RefSection
                      sectionKey="inconsistencies" label="Inconsistencies"
                      accent={C.red}
                      entries={index.inconsistencies}
                      query={queryFor('inconsistencies')} onQuery={setQueryFor}
                      open={isOpen('inconsistencies')} onToggle={() => toggleSection('inconsistencies')}
                    >
                      {items => items.map(inc => (
                        <RefRow
                          key={`${inc.entity}|${inc.detail}`}
                          title={inc.entity}
                          titleColor={C.cream}
                          detail={
                            <div>
                              <div style={{ fontSize: '13px', color: C.dim, lineHeight: 1.6 }}>{inc.detail}</div>
                              {inc.citations?.length > 0 && (
                                <div style={{ marginTop: '8px', fontSize: '11px', color: C.warm }}>
                                  {inc.citations.join(' · ')}
                                </div>
                              )}
                            </div>
                          }
                        />
                      ))}
                    </RefSection>

                    <RefSection
                      sectionKey="gaps" label="Evidence Gaps"
                      entries={index.gaps}
                      query={queryFor('gaps')} onQuery={setQueryFor}
                      open={isOpen('gaps')} onToggle={() => toggleSection('gaps')}
                    >
                      {items => items.map(g => <RefRow key={g} title={g} titleColor={C.dim} />)}
                    </RefSection>

                    <RefSection
                      sectionKey="corroborated" label="Corroborated"
                      accent={C.amber}
                      entries={index.corroborated}
                      query={queryFor('corroborated')} onQuery={setQueryFor}
                      open={isOpen('corroborated')} onToggle={() => toggleSection('corroborated')}
                    >
                      {items => items.map(c => <RefRow key={c} title={c} />)}
                    </RefSection>
                  </div>
                )}

                {/* ── CONNECTIONS tab ──────────────────────────────────── */}
                {activeTab === 'graph' && (
                  <div style={S.resultSection}>
                    <div style={S.resultHeader}>
                      Entity Network
                      <span style={S.badge}>
                        {(mapData?.entities?.length || 0) + (resData?.entities?.length || 0)} nodes
                      </span>
                    </div>
                    <div style={{ fontSize: '11px', color: C.dim, marginBottom: '12px', fontFamily: '"Space Mono", monospace' }}>
                      Each ring is one search, oldest in the middle · scroll to zoom · click a node or branch for detail · thick = well supported · flashing = new this search
                    </div>
                    <ConnectionsGraph searches={searches} memoryData={memoryData} />
                  </div>
                )}

                {/* ── SYNTHESIS tab ─────────────────────────────────────── */}
                {activeTab === 'synth' && (
                  <Disclosure
                    label="Briefs"
                    accent={C.violet}
                    open={isOpen('briefs')}
                    onToggle={() => toggleSection('briefs')}
                    note={briefChoice === 'network'
                      ? 'reading: network brief'
                      : `reading: ${(synthData && briefs.find(b => b.synth === synthData)?.topic) || 'latest'}`}
                  >
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
                      {briefs.map((s, i) => {
                        const selected = briefChoice === s.id || (briefChoice == null && i === briefs.length - 1)
                        return (
                          <button
                            key={s.id}
                            style={{ ...S.btnGhost, ...(selected ? { background: `${C.amber}22`, borderColor: C.amber } : {}) }}
                            onClick={() => setBriefChoice(s.id)}
                            title={s.topic}
                          >
                            {String(i + 1).padStart(2, '0')} · {s.topic.length > 40 ? `${s.topic.slice(0, 40)}…` : s.topic}
                          </button>
                        )
                      })}
                      {network.networkBrief && (
                        <button
                          style={{ ...S.btnGhost, color: C.violet, borderColor: `${C.violet}66`,
                                   ...(briefChoice === 'network' ? { background: `${C.violet}22`, borderColor: C.violet } : {}) }}
                          onClick={() => setBriefChoice('network')}
                        >
                          ◈ Network brief ({network.networkBrief.searchCount} searches)
                        </button>
                      )}
                      {network.searches.length >= 2 && (
                        <button
                          style={{ ...S.btnGhost, color: C.violet, borderColor: `${C.violet}66` }}
                          onClick={synthesizeNetwork}
                          disabled={netBusy || isActive}
                        >
                          {netBusy ? '… synthesizing network' : network.networkBrief ? '↻ Re-synthesize network' : '◈ Synthesize network'}
                        </button>
                      )}
                    </div>
                  </Disclosure>
                )}

                {activeTab === 'synth' && synthData && (
                  <div>
                    {/* Summary stays open — it is the headline of the brief */}
                    {synthData.summary && (
                      <div style={{ ...S.card, background: C.bgPanel, borderColor: `${C.violet}55`, marginBottom: '14px' }}>
                        <div style={{ fontFamily: '"Orbitron", sans-serif', fontSize: '10px', color: C.violet, letterSpacing: '0.2em', marginBottom: '10px' }}>
                          INTELLIGENCE SUMMARY
                        </div>
                        <div style={{ fontSize: '15px', color: C.cream, lineHeight: 1.75 }}>
                          {synthData.summary}
                        </div>
                        {synthData.confidence != null && (
                          <div style={{ marginTop: '14px' }}>
                            <div style={{ fontSize: '11px', color: C.dim, marginBottom: '5px' }}>
                              Overall confidence:{' '}
                              <span style={{ color: confColor(synthData.confidence) }}>
                                {Math.round(Number(synthData.confidence) * 100)}%
                              </span>
                            </div>
                            <div style={S.confBar}>
                              <div style={confFill(synthData.confidence, confColor(synthData.confidence))} />
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {synthData.keyFindings?.length > 0 && (
                      <Disclosure
                        label="Key Findings" count={synthData.keyFindings.length}
                        open={isOpen('keyFindings')} onToggle={() => toggleSection('keyFindings')}
                      >
                        <ol style={{ color: C.cream, fontSize: '13px', paddingLeft: '22px', lineHeight: 2.1, margin: 0 }}>
                          {synthData.keyFindings.map((f, i) => (
                            <li key={i} style={{ marginBottom: '8px' }}>{f}</li>
                          ))}
                        </ol>
                      </Disclosure>
                    )}

                    {synthData.timeline?.length > 0 && (
                      <Disclosure
                        label="Verified Timeline" count={synthData.timeline.length} accent={C.gold}
                        open={isOpen('verifiedTimeline')} onToggle={() => toggleSection('verifiedTimeline')}
                      >
                        <div style={{ borderLeft: `2px solid ${C.amber}44`, paddingLeft: '24px' }}>
                          {synthData.timeline.map((t, i) => (
                            <div key={i} style={{ display: 'flex', gap: '14px', marginBottom: '18px', position: 'relative' }}>
                              <div style={{ ...S.timelineDot, background: confColor(t.confidence ?? 0.5) }} />
                              <div style={S.timelineDate}>{t.date}</div>
                              <div>
                                <div style={S.timelineEvent}>{t.event}</div>
                                {t.confidence != null && (
                                  <div style={{ fontSize: '11px', color: confColor(t.confidence), marginTop: '3px' }}>
                                    {Math.round(Number(t.confidence) * 100)}% confidence
                                  </div>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      </Disclosure>
                    )}

                    {/* Cast is the case roster: merged across searches, like entities */}
                    <RefSection
                      sectionKey="cast" label="Cast"
                      entries={index.cast}
                      query={queryFor('cast')} onQuery={setQueryFor}
                      open={isOpen('cast')} onToggle={() => toggleSection('cast')}
                    >
                      {items => items.map(c => (
                        <RefRow
                          key={c.name}
                          title={c.name}
                          meta={c.role
                            ? <span style={{ ...S.refRowMeta, color: C.violet }}>{c.role}</span>
                            : null}
                          detail={castHasDetail(c) ? <CastDetail person={c} /> : null}
                        />
                      ))}
                    </RefSection>

                    {synthData.subplots?.length > 0 && (
                      <Disclosure
                        label="Sub-plots" count={synthData.subplots.length}
                        open={isOpen('subplots')} onToggle={() => toggleSection('subplots')}
                      >
                        <ul style={{ color: C.dim, fontSize: '13px', paddingLeft: '20px', lineHeight: 2.2, margin: 0 }}>
                          {synthData.subplots.map((s, i) => <li key={i}>{s}</li>)}
                        </ul>
                      </Disclosure>
                    )}

                    {synthData.inconsistencies?.length > 0 && (
                      <Disclosure
                        label="Unresolved Inconsistencies" count={synthData.inconsistencies.length} accent={C.red}
                        open={isOpen('synthInconsistencies')} onToggle={() => toggleSection('synthInconsistencies')}
                      >
                        {synthData.inconsistencies.map((inc, i) => (
                          <RefRow
                            key={`${inc.entity}|${i}`}
                            title={inc.entity}
                            detail={
                              <div>
                                <div style={{ fontSize: '13px', color: C.dim, lineHeight: 1.6 }}>{inc.detail}</div>
                                {inc.citations?.length > 0 && (
                                  <div style={{ marginTop: '8px', fontSize: '11px', color: C.warm }}>
                                    {inc.citations.join(' · ')}
                                  </div>
                                )}
                              </div>
                            }
                          />
                        ))}
                      </Disclosure>
                    )}

                    {synthData.followUpDirectives?.length > 0 && (
                      <Disclosure
                        label="Follow-up Directives" count={synthData.followUpDirectives.length} accent={C.amber}
                        open={isOpen('followUps')} onToggle={() => toggleSection('followUps')}
                      >
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                          {synthData.followUpDirectives.map((d, i) => (
                            <button key={i} style={S.btnGhost} onClick={() => handleFollowUp(d)}>
                              → {d}
                            </button>
                          ))}
                        </div>
                      </Disclosure>
                    )}
                  </div>
                )}
              </>
            )}
          </>
        )}
      </main>

      <footer style={S.footer}>
        FUNGA.I. P.I. — Adaptive Investigative Intelligence — Mycelium maps the hidden network
      </footer>
    </div>
  )
}
