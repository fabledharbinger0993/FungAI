// hyphae.js — turns a case's searches into a mycelium-ring graph.
//
// buildHyphae()  searches → { nodes, links } (deduplicated entities, weighted links, sub-nodes)
// layoutHyphae() assigns each search its own ring (first search innermost, like a fairy ring
//                growing outward) and fans sub-nodes out from their parents.
//
// Kept free of DOM and React so the logic can be checked with plain node.

const TAU = Math.PI * 2
export const norm = s => String(s ?? '').trim().toLowerCase()

const STOP = new Set(['the', 'of', 'and', 'a', 'an', 'for', 'in', 'on', 'to', 'at', 'by', 'with', 'as', 'or', 'from'])

// At most `maxWords` keywords: filler words dropped, parentheses/quotes stripped.
export function shortLabel(name, maxWords = 5) {
  const words = String(name ?? '').replace(/[()"“”]/g, ' ').split(/\s+/).filter(Boolean)
  const keep = words.filter(w => !STOP.has(w.toLowerCase()))
  const pool = keep.length ? keep : words
  let s = pool.slice(0, maxWords).join(' ')
  if (s.length > 34) s = s.slice(0, 33).trimEnd() + '…'
  else if (pool.length > maxWords) s += '…'
  return s
}

const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`)

export function buildHyphae(searches = [], memoryData = null) {
  const nodes = new Map()
  const links = new Map()

  function touch(name, type, conf, searchIdx, { fromMemory = false, notes } = {}) {
    const label = String(name ?? '').trim()
    if (!label) return null
    const id = norm(label)
    let n = nodes.get(id)
    if (!n) {
      n = { id, label, type: type || 'entity', conf: Number(conf ?? 0.7), notes: '', searches: new Set(), fromMemory, subs: [] }
      nodes.set(id, n)
    }
    if (!fromMemory) {
      n.fromMemory = false
      if (searchIdx != null) n.searches.add(searchIdx)
    }
    if ((!n.type || n.type === 'entity') && type && type !== 'entity') n.type = type
    if (conf != null) n.conf = Math.max(n.conf, Number(conf))
    if (notes && !n.notes) {
      n.notes = notes
      n.subs.push({ kind: 'note', text: notes, conf: n.conf, sources: [] })
    }
    return n
  }

  function link(a, b, kind, label, weight) {
    if (!a || !b || a.id === b.id) return
    const key = pairKey(a.id, b.id)
    const cur = links.get(key)
    if (!cur) {
      links.set(key, { source: a.id, target: b.id, kind, label: label || '', weight })
      return
    }
    cur.weight += weight
    // A mapped relationship outranks a co-occurrence or a recalled memory.
    if (kind === 'mapped' && cur.kind !== 'mapped') { cur.kind = 'mapped'; cur.label = label || cur.label }
    else if (kind === 'inferred' && cur.kind === 'memory') cur.kind = 'inferred'
  }

  searches.forEach((s, i) => {
    for (const e of s.map?.entities || []) touch(e.name, e.type, e.confidence ?? 0.8, i, { notes: e.notes })
    for (const r of s.map?.relationships || []) {
      link(touch(r.from, 'entity', 0.7, i), touch(r.to, 'entity', 0.7, i), 'mapped', r.relation, 1)
    }
    for (const e of s.res?.entities || []) touch(e.name, e.type, e.confidence, i, { notes: e.notes })
    for (const c of s.synth?.cast || []) touch(c.name, 'person', 0.8, i)

    // Second-degree expansion: hang it off the known entity named in its "connection" text;
    // when none is named it becomes a main node of its own.
    for (const x of s.expand?.expandedEntities || []) {
      const text = norm(x.connection)
      let host = null
      for (const n of nodes.values()) {
        if (n.fromMemory || n.id.length < 3 || !text.includes(n.id)) continue
        if (!host || n.id.length > host.id.length) host = n
      }
      if (host) host.subs.push({ kind: 'expanded', text: `${x.name} — ${x.connection}`, conf: null, sources: [], priority: x.priority })
      else touch(x.name, x.type, 0.5, i)
    }

    for (const f of s.res?.findings || []) {
      const ents = [...new Set((f.entities || []).filter(Boolean))].slice(0, 6)
        .map(name => touch(name, 'entity', f.confidence, i)).filter(Boolean)
      if (!ents.length || !f.claim) continue
      ents[0].subs.push({
        kind: 'finding',
        text: f.claim,
        conf: Number(f.confidence ?? 0.5),
        sources: (f.sources || []).filter(Boolean),
        date: f.date || '',
        others: ents.slice(1).map(n => n.id),
      })
      for (let a = 0; a < ents.length; a++) {
        for (let b = a + 1; b < ents.length; b++) link(ents[a], ents[b], 'inferred', 'co-occurs', Number(f.confidence ?? 0.5))
      }
    }
  })

  // Recalled memory: dormant nodes and links, never overriding fresh data.
  for (const n of memoryData?.nodes || []) touch(n.name, n.type, n.confidence ?? 0.5, null, { fromMemory: true })
  for (const e of memoryData?.edges || []) {
    link(touch(e.from, 'entity', 0.5, null, { fromMemory: true }), touch(e.to, 'entity', 0.5, null, { fromMemory: true }),
      'memory', e.relation || 'recalled', 0.3)
  }

  const degree = new Map()
  for (const l of links.values()) {
    if (l.kind === 'memory') continue
    degree.set(l.source, (degree.get(l.source) || 0) + 1)
    degree.set(l.target, (degree.get(l.target) || 0) + 1)
  }
  for (const n of nodes.values()) {
    n.degree = degree.get(n.id) || 0
    n.fused = n.searches.size > 1
    n.nested = n.subs.some(s => s.sources?.length)
    // Beacon = new growth: only meaningful once the case has more than one search.
    n.isNew = searches.length > 1 && !n.fromMemory && n.searches.size === 1 && n.searches.has(searches.length - 1)
  }

  return { nodes: [...nodes.values()], links: [...links.values()], searchCount: searches.length }
}

// ─── Geometry ────────────────────────────────────────────────────────────────

function angleOf(p) { return Math.atan2(p.y, p.x) }
function angDiff(a, b) {
  const d = Math.abs(angleOf(a) - angleOf(b)) % TAU
  return Math.min(d, TAU - d)
}

// Threads bend toward the ring's centre in proportion to how far apart their ends are,
// so a thread between opposite sides runs straight across the middle.
export function curvePath(a, b) {
  const mx = (a.x + b.x) / 2
  const my = (a.y + b.y) / 2
  const f = Math.max(0.04, 1 - (0.95 * angDiff(a, b)) / Math.PI)
  return `M${a.x},${a.y} Q${mx * f},${my * f} ${b.x},${b.y}`
}

// Connected nodes end up next to each other on their ring (BFS from the busiest node).
function orderRing(list, adj) {
  const left = new Set(list.map(n => n.id))
  const byId = new Map(list.map(n => [n.id, n]))
  const out = []
  const seeds = [...list].sort((a, b) => b.degree - a.degree)
  for (const seed of seeds) {
    if (!left.has(seed.id)) continue
    const queue = [seed]
    left.delete(seed.id)
    while (queue.length) {
      const cur = queue.shift()
      out.push(cur)
      const next = [...(adj.get(cur.id) || [])]
        .filter(id => left.has(id)).map(id => byId.get(id)).sort((a, b) => b.degree - a.degree)
      for (const n of next) { left.delete(n.id); queue.push(n) }
    }
  }
  return out
}

const MAX_SUBS = 6
const MAX_NESTED = 3

export function layoutHyphae(graph, { spacing = 56, ringGap = 130, minRadius = 120 } = {}) {
  const { nodes, links, searchCount } = graph
  const byId = new Map(nodes.map(n => [n.id, n]))
  const adj = new Map()
  for (const l of links) {
    if (l.kind === 'memory') continue
    if (!adj.has(l.source)) adj.set(l.source, new Set())
    if (!adj.has(l.target)) adj.set(l.target, new Set())
    adj.get(l.source).add(l.target)
    adj.get(l.target).add(l.source)
  }

  const memRing = searchCount // dormant, recalled-from-memory nodes sit outside every search
  const byRing = new Map()
  for (const n of nodes) {
    n.ring = n.fromMemory || !n.searches.size ? memRing : Math.min(...n.searches)
    if (!byRing.has(n.ring)) byRing.set(n.ring, [])
    byRing.get(n.ring).push(n)
  }

  const ringKeys = [...byRing.keys()].sort((a, b) => a - b)
  const radius = new Map()
  let prev = null
  for (const k of ringKeys) {
    const need = (byRing.get(k).length * spacing) / TAU
    const r = prev == null ? Math.max(minRadius, need) : Math.max(prev + ringGap, need)
    radius.set(k, r)
    prev = r
  }
  const ringR = k => {
    if (radius.has(k)) return radius.get(k)
    const lower = ringKeys.filter(x => x < k).pop()
    return lower == null ? minRadius : radius.get(lower) + (k - lower) * ringGap
  }

  for (const k of ringKeys) {
    const list = orderRing(byRing.get(k), adj)
    const off = -Math.PI / 2 + k * 0.61 // stagger rings so they don't line up spoke for spoke
    list.forEach((n, j) => {
      n.theta = off + (TAU * j) / list.length
      const base = radius.get(k)
      // A node found by several searches sits on the seam between its first and last ring.
      n.radius = n.fused ? base + (ringR(Math.max(...n.searches)) - base) / 2 : base
      n.x = n.radius * Math.cos(n.theta)
      n.y = n.radius * Math.sin(n.theta)
      n.size = 7 + Math.min(6, n.degree * 0.8)
    })
  }

  // Sub-nodes fan outward from their parent like hyphal branches; sources hang off a sub-node.
  const subs = []
  for (const n of nodes) {
    const u = { x: Math.cos(n.theta), y: Math.sin(n.theta) }
    const t = { x: -u.y, y: u.x }
    const shown = n.subs.slice(0, MAX_SUBS)
    n.moreSubs = n.subs.length - shown.length
    shown.forEach((s, i) => {
      const side = i % 2 === 0 ? -1 : 1
      const dist = 32 + i * 10
      const off = side * (7 + 4 * Math.floor(i / 2))
      const sub = {
        ...s,
        id: `${n.id}#${i}`,
        parent: n.id,
        x: n.x + u.x * dist + t.x * off,
        y: n.y + u.y * dist + t.y * off,
        nested: (s.sources || []).slice(0, MAX_NESTED).map((text, j, arr) => ({
          text,
          x: 0, y: 0,
          _j: j, _m: arr.length,
        })),
      }
      for (const c of sub.nested) {
        const spread = (c._j - (c._m - 1) / 2) * 11
        c.x = sub.x + u.x * 20 + t.x * spread
        c.y = sub.y + u.y * 20 + t.y * spread
        delete c._j; delete c._m
      }
      subs.push(sub)
    })
  }

  const laidLinks = links.map(l => {
    const a = byId.get(l.source)
    const b = byId.get(l.target)
    return {
      ...l,
      d: curvePath(a, b),
      // Opposite sides of the ring: the thread crosses the middle and carries the pulse.
      across: l.kind !== 'memory' && angDiff(a, b) >= (2 * Math.PI) / 3,
    }
  })

  // Findings that name several entities tie their sub-node to the others.
  const bridges = []
  for (const s of subs) {
    for (const id of (s.others || []).slice(0, 3)) {
      const to = byId.get(id)
      if (to) bridges.push({ d: curvePath(s, to), from: s.id, to: id })
    }
  }

  const rings = ringKeys.filter(k => k !== memRing).map(k => ({ index: k, r: radius.get(k) }))
  if (byRing.has(memRing)) rings.push({ index: memRing, r: radius.get(memRing), dormant: true })

  const pts = [...nodes, ...subs, ...subs.flatMap(s => s.nested)]
  const xs = pts.map(p => p.x), ys = pts.map(p => p.y)
  const bounds = pts.length
    ? { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) }
    : { minX: -1, maxX: 1, minY: -1, maxY: 1 }

  return { nodes, subs, links: laidLinks, bridges, rings, bounds }
}
