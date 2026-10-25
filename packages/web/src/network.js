// network.js — a saved investigation network ("case") built from consecutive searches.
//
// Each search's raw phase output is stored as-is in network.searches; the merged view
// (deduplicated entities, relationships, findings, ...) is derived on read by
// mergeNetwork(), so a merge rule can change without rewriting saved data.

export function emptyNetwork(name = 'Untitled network') {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    name,
    createdAt: now,
    updatedAt: now,
    searches: [],        // [{ id, topic, at, map, expand, res, synth }]
    networkBrief: null,  // { at, searchCount, synth } — whole-network synthesis, on demand
  }
}

const norm = s => String(s ?? '').trim().toLowerCase()

// Dedupe by key, keeping first occurrence order. merge(existing, incoming) may update in place.
function dedupe(items, keyOf, merge) {
  const byKey = new Map()
  for (const item of items) {
    const key = keyOf(item)
    if (!key) continue
    if (byKey.has(key)) merge?.(byKey.get(key), item)
    else byKey.set(key, { ...item })
  }
  return [...byKey.values()]
}

function mergeEntities(tagged) {
  return dedupe(
    tagged,
    e => norm(e.name),
    (cur, e) => {
      if ((!cur.type || cur.type === 'entity') && e.type) cur.type = e.type
      if (!cur.notes && e.notes) cur.notes = e.notes
      if (e.confidence != null) cur.confidence = Math.max(Number(cur.confidence ?? 0), Number(e.confidence))
      if (e.aliases?.length) cur.aliases = [...new Set([...(cur.aliases || []), ...e.aliases])]
      for (const t of e.foundIn) if (!cur.foundIn.includes(t)) cur.foundIn.push(t)
    },
  )
}

const uniqueStrings = list => dedupe(list.filter(Boolean).map(s => ({ s })), x => norm(x.s)).map(x => x.s)

// Merge the searches (plus an optional in-progress one) into one map / research / cast view.
export function mergeNetwork(searches) {
  const tag = (items, topic) => (items || []).map(x => ({ ...x, foundIn: [topic] }))

  const mapEntities = [], relationships = [], timeline = [], searchVectors = [], archiveSources = []
  const findings = [], resEntities = [], inconsistencies = [], gaps = [], corroborated = [], cast = []

  for (const s of searches) {
    const { topic, map, res, synth } = s
    mapEntities.push(...tag(map?.entities, topic))
    relationships.push(...(map?.relationships || []))
    timeline.push(...(map?.timeline || []))
    searchVectors.push(...(map?.searchVectors || []))
    archiveSources.push(...(map?.archiveSources || []))
    findings.push(...(res?.findings || []).map(f => ({ ...f, topic })))
    resEntities.push(...tag(res?.entities, topic))
    inconsistencies.push(...(res?.inconsistencies || []))
    gaps.push(...(res?.gaps || []))
    corroborated.push(...(res?.corroborated || []))
    cast.push(...(synth?.cast || []))
  }

  const hasMap = searches.some(s => s.map)
  const hasRes = searches.some(s => s.res)
  const hasSynth = searches.some(s => s.synth)

  return {
    map: hasMap ? {
      entities:       mergeEntities(mapEntities),
      relationships:  dedupe(relationships, r => r.from && r.to && `${norm(r.from)}|${norm(r.relation)}|${norm(r.to)}`),
      timeline:       dedupe(timeline, t => (t.date || t.event) && `${norm(t.date)}|${norm(t.event)}`),
      searchVectors:  uniqueStrings(searchVectors),
      archiveSources: uniqueStrings(archiveSources),
    } : null,
    res: hasRes ? {
      findings:        dedupe(findings, f => norm(f.claim)),
      entities:        mergeEntities(resEntities),
      inconsistencies: dedupe(inconsistencies, i => `${norm(i.entity)}|${norm(i.detail)}`),
      gaps:            uniqueStrings(gaps),
      corroborated:    uniqueStrings(corroborated),
    } : null,
    synth: hasSynth ? { cast: dedupe(cast, c => norm(c.name)) } : null,
  }
}

// Compact description of the existing network, fed to later searches so the model links
// new findings to nodes already in the case instead of starting cold.
export function networkContext(merged, { maxEntities = 120, maxRelationships = 80 } = {}) {
  const entities = [...(merged.map?.entities || []), ...(merged.res?.entities || [])]
  const seen = new Set()
  const names = []
  for (const e of entities) {
    const key = norm(e.name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    names.push(e.type ? `${e.name} (${e.type})` : e.name)
  }
  if (!names.length) return ''
  const rels = (merged.map?.relationships || [])
    .slice(0, maxRelationships)
    .map(r => `${r.from} — ${r.relation} → ${r.to}`)
  return [
    `Entities: ${names.slice(0, maxEntities).join('; ')}`,
    rels.length ? `Relationships:\n${rels.join('\n')}` : '',
  ].filter(Boolean).join('\n')
}

// Input for a whole-network brief, capped so the synthesis prompt stays bounded as the case grows.
export function networkSynthesisInput(network, merged, { maxFindings = 100 } = {}) {
  const findings = [...(merged.res?.findings || [])]
    .sort((a, b) => Number(b.confidence || 0) - Number(a.confidence || 0))
    .slice(0, maxFindings)
  return {
    searches: network.searches.map(s => ({ topic: s.topic, summary: s.synth?.summary || '' })),
    entities: merged.map?.entities || [],
    relationships: merged.map?.relationships || [],
    timeline: merged.map?.timeline || [],
    findings,
    inconsistencies: merged.res?.inconsistencies || [],
  }
}

// ─── Growing case synopsis ────────────────────────────────────────────────────
// A search's contribution is the set difference against everything the case already
// held, so the synopsis grows as searches accumulate while staying derived from the
// saved raw searches — nothing extra is persisted, and a changed merge rule cannot
// leave a stale note behind. Keys match mergeNetwork()'s dedupe keys so the counts
// here and the merged lists on screen can never disagree.

const relKey   = r => (r.from && r.to ? `${norm(r.from)}|${norm(r.relation)}|${norm(r.to)}` : '')
const eventKey = t => (t.date || t.event ? `${norm(t.date)}|${norm(t.event)}` : '')

export function networkSynopsis(searches) {
  const firstSeen  = new Map() // entity key -> ordinal of the search that introduced it
  const seenRel    = new Set()
  const seenClaim  = new Set()
  const seenEvent  = new Set()
  const entries    = []

  ;(searches || []).forEach((s, idx) => {
    const ordinal    = idx + 1
    const newNames   = []
    const reinforced = new Map() // earlier ordinal -> how many of its entities recur here
    const thisSearch = new Set()

    for (const e of [...(s.map?.entities || []), ...(s.res?.entities || [])]) {
      const key = norm(e.name)
      if (!key || thisSearch.has(key)) continue
      thisSearch.add(key)
      const from = firstSeen.get(key)
      if (from == null) {
        firstSeen.set(key, ordinal)
        newNames.push(e.name)
      } else if (from !== ordinal) {
        reinforced.set(from, (reinforced.get(from) || 0) + 1)
      }
    }

    const countNew = (items, keyOf, seen) => {
      let n = 0
      for (const item of items || []) {
        const key = keyOf(item)
        if (!key || seen.has(key)) continue
        seen.add(key)
        n++
      }
      return n
    }

    entries.push({
      id:      s.id,
      ordinal,
      topic:   s.topic,
      at:      s.at,
      summary: s.synth?.summary || '',
      pending: !s.synth,
      added: {
        entities:      newNames,
        relationships: countNew(s.map?.relationships, relKey, seenRel),
        findings:      countNew(s.res?.findings, f => norm(f.claim), seenClaim),
        timeline:      countNew(s.map?.timeline, eventKey, seenEvent),
      },
      reinforced: [...reinforced.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([from, count]) => ({ from, count })),
    })
  })

  return {
    entries,
    totals: {
      entities:      firstSeen.size,
      relationships: seenRel.size,
      findings:      seenClaim.size,
      timeline:      seenEvent.size,
    },
  }
}

// ─── Searchable reference index ───────────────────────────────────────────────
// One flat index over the merged view, read by both the synopsis counts and every
// drop-down's search bar, so a reference is matched the same way wherever it shows.
// `label` and `tab` name which collection an entry belongs to; styling stays in App's S.

export const SECTION_DEFS = [
  { key: 'mapEntities', tab: 'map', label: 'Entities',
    from: m => m.map?.entities,
    text: e => [e.name, e.type, e.notes, ...(e.aliases || []), ...(e.foundIn || [])] },
  { key: 'relationships', tab: 'map', label: 'Relationships',
    from: m => m.map?.relationships,
    text: r => [r.from, r.relation, r.to] },
  { key: 'timeline', tab: 'map', label: 'Timeline',
    from: m => m.map?.timeline,
    text: t => [t.date, t.event] },
  { key: 'searchVectors', tab: 'map', label: 'Search Vectors',
    from: m => m.map?.searchVectors,
    text: v => [v] },
  { key: 'findings', tab: 'res', label: 'Findings',
    from: m => m.res?.findings,
    text: f => [f.claim, f.date, f.topic, ...(f.entities || [])] },
  { key: 'resEntities', tab: 'res', label: 'Resolved Entities',
    from: m => m.res?.entities,
    text: e => [e.name, e.type, e.notes, ...(e.aliases || []), ...(e.foundIn || [])] },
  { key: 'inconsistencies', tab: 'res', label: 'Inconsistencies',
    from: m => m.res?.inconsistencies,
    text: i => [i.entity, i.detail] },
  { key: 'gaps', tab: 'res', label: 'Evidence Gaps',
    from: m => m.res?.gaps,
    text: g => [g] },
  { key: 'corroborated', tab: 'res', label: 'Corroborated',
    from: m => m.res?.corroborated,
    text: c => [c] },
  { key: 'cast', tab: 'synth', label: 'Cast',
    from: m => m.synth?.cast,
    text: c => [c.name, c.role, c.notes] },
]

// { [sectionKey]: [{ item, haystack }] } — haystack is pre-lowercased for filtering.
export function networkIndex(merged) {
  const index = {}
  for (const def of SECTION_DEFS) {
    index[def.key] = (def.from(merged) || []).map(item => ({
      item,
      haystack: def.text(item).filter(Boolean).map(norm).join(' \u0000 '),
    }))
  }
  return index
}

// Every whitespace-separated term must appear somewhere in the entry (AND search).
export function filterSection(entries, query) {
  const terms = norm(query).split(/\s+/).filter(Boolean)
  if (!terms.length) return entries || []
  return (entries || []).filter(e => terms.every(t => e.haystack.includes(t)))
}

export function summarize(network) {
  return {
    id: network.id,
    name: network.name,
    updatedAt: network.updatedAt,
    searchCount: network.searches?.length || 0,
  }
}
