import { useRef, useEffect, useState } from 'react'
import * as d3 from 'd3'
import { buildHyphae, layoutHyphae, curvePath, shortLabel } from './hyphae.js'

// ─── Palette (matches App.jsx) ────────────────────────────────────────────────
// Shape, thickness and motion carry the meaning; colour is only the glow.
const C = {
  bgCard: '#0e0e1a',
  border: '#2a2a3a',
  cream:  '#e8e4d8',
  dim:    '#8884a0',
  purple: '#9b72d8',
  gold:   '#e0b84c',
  white:  '#f6f2e8',
  black:  '#07070d',
}

const PULSE_EVERY_MS  = 10000
const PULSE_TRAVEL_MS = 2600

// Beacon flash for new growth; motion is dropped for people who ask for less of it.
const CSS = `
  .beacon { animation: beacon 1.9s ease-out infinite; transform-box: fill-box; transform-origin: center; }
  @keyframes beacon { 0% { transform: scale(1); opacity: .75; } 100% { transform: scale(3.2); opacity: 0; } }
  @media (prefers-reduced-motion: reduce) { .beacon { animation: none; opacity: .35; } }
`

function nodeFill(n) {
  if (n.fromMemory) return `${C.dim}33`
  if (n.degree === 0 && !n.subs.length) return C.black   // a statement standing alone
  if (n.subs.length || n.fused) return n.fused ? C.gold : C.purple
  return C.white                                          // connected, no branches
}

function nodeStroke(n) {
  if (n.fromMemory) return C.dim
  if (n.degree === 0 && !n.subs.length) return `${C.dim}aa`
  return n.degree > 0 ? C.white : (n.fused ? C.gold : C.purple)
}

function nodeGlow(n) {
  if (n.fromMemory || (n.degree === 0 && !n.subs.length)) return null
  return n.fused ? C.gold : (n.degree > 0 ? C.white : C.purple)
}

export default function ConnectionsGraph({ searches = [], memoryData }) {
  const containerRef   = useRef(null)
  const manualLinksRef = useRef([])  // persists across renders: [{ source, target }]
  const pendingRef     = useRef(null)
  const nodeSelRef     = useRef(null)
  const [linkMode, setLinkMode] = useState(false)
  const linkModeRef = useRef(false)
  const [selected, setSelected] = useState(null)

  useEffect(() => { linkModeRef.current = linkMode }, [linkMode])

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    pendingRef.current = null
    setSelected(null)
    el.innerHTML = ''

    const graph = buildHyphae(searches, memoryData)
    if (!graph.nodes.length) {
      const msg = document.createElement('div')
      Object.assign(msg.style, {
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        height: '100%', color: C.dim, fontFamily: "'Space Mono',monospace", fontSize: '12px',
      })
      msg.textContent = 'No entities mapped yet'
      el.appendChild(msg)
      return
    }

    const L = layoutHyphae(graph)
    const byId = new Map(L.nodes.map(n => [n.id, n]))
    const topicOf = i => searches[i]?.topic || `search ${i + 1}`
    const W = el.clientWidth || 800
    const H = el.clientHeight || 520

    const svg = d3.select(el).append('svg')
      .attr('width', W).attr('height', H)
      .style('background', C.bgCard).style('border-radius', '8px')
    svg.append('defs').append('style').text(CSS)
    const root = svg.append('g')

    // ── Rings: one per search, labelled with its topic ─────────────────────────
    const ringG = root.append('g')
    for (const ring of L.rings) {
      ringG.append('circle').attr('r', ring.r)
        .attr('fill', 'none').attr('stroke', ring.dormant ? C.dim : C.purple)
        .attr('stroke-opacity', 0.35).attr('stroke-width', 1).attr('stroke-dasharray', ring.dormant ? '2,6' : '3,6')
      ringG.append('text').attr('y', -ring.r - 7).attr('text-anchor', 'middle')
        .attr('fill', ring.dormant ? C.dim : C.purple).attr('fill-opacity', 0.6)
        .attr('font-family', '"Space Mono", monospace').attr('font-size', 9).attr('letter-spacing', '0.12em')
        .text(ring.dormant ? 'RECALLED' : shortLabel(topicOf(ring.index), 3).toUpperCase())
    }

    // ── Threads between main nodes: thicker where more evidence agrees ─────────
    const linkG = root.append('g').attr('fill', 'none')
    const linkSel = linkG.selectAll('path').data(L.links).join('path')
      .attr('d', d => d.d)
      .attr('stroke', d => d.kind === 'memory' ? C.dim : d.across ? C.gold : d.kind === 'mapped' ? C.white : C.purple)
      .attr('stroke-opacity', d => d.kind === 'memory' ? 0.3 : d.across ? 0.5 : d.kind === 'mapped' ? 0.4 : 0.28)
      .attr('stroke-width', d => d.kind === 'memory' ? 0.6 : 0.8 + Math.min(3.2, d.weight * 1.1))
      .attr('stroke-dasharray', d => d.kind === 'memory' ? '4,4' : d.kind === 'inferred' ? '3,3' : null)
      .attr('stroke-linecap', 'round')

    // Branches from each node to its sub-nodes, and from sub-nodes to their sources.
    const branchG = root.append('g').attr('fill', 'none').attr('stroke', C.purple).attr('stroke-opacity', 0.35)
    for (const s of L.subs) {
      const p = byId.get(s.parent)
      branchG.append('path').attr('d', `M${p.x},${p.y} L${s.x},${s.y}`).attr('stroke-width', 0.9)
      for (const c of s.nested) branchG.append('path').attr('d', `M${s.x},${s.y} L${c.x},${c.y}`).attr('stroke-width', 0.6)
    }
    // A finding that names several entities ties its sub-node to the others.
    const bridgeG = root.append('g').attr('fill', 'none').attr('stroke', C.gold)
      .attr('stroke-opacity', 0.35).attr('stroke-width', 0.7).attr('stroke-dasharray', '2,3')
    bridgeG.selectAll('path').data(L.bridges).join('path').attr('d', d => d.d)

    // Manual threads the user drew.
    const manualG = root.append('g').attr('fill', 'none').attr('stroke', C.gold)
      .attr('stroke-opacity', 0.6).attr('stroke-width', 1.5).attr('stroke-dasharray', '6,2')
    const renderManual = () => {
      manualG.selectAll('path')
        .data(manualLinksRef.current.filter(m => byId.has(m.source) && byId.has(m.target)))
        .join('path').attr('d', m => curvePath(byId.get(m.source), byId.get(m.target)))
    }
    renderManual()

    // ── Pulse: a spark runs along each cross-ring thread every 10 s ────────────
    const pulseG = root.append('g')
    const crossLinks = []
    linkSel.each(function (d) {
      if (!d.across) return
      crossLinks.push({ len: this.getTotalLength(), path: this, dot: null })
    })
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
    crossLinks.forEach((c, i) => {
      c.dot = pulseG.append('circle').attr('r', 3.4).attr('fill', C.gold).attr('opacity', 0)
        .style('filter', `drop-shadow(0 0 5px ${C.gold})`)
      c.offset = (i * 700) % PULSE_EVERY_MS  // staggered so they don't all fire at once
    })
    const timer = reduceMotion ? null : d3.timer(elapsed => {
      for (const c of crossLinks) {
        const t = ((elapsed + c.offset) % PULSE_EVERY_MS) / PULSE_TRAVEL_MS
        if (t >= 1) { c.dot.attr('opacity', 0); continue }
        const pt = c.path.getPointAtLength(t * c.len)
        c.dot.attr('cx', pt.x).attr('cy', pt.y).attr('opacity', Math.sin(Math.PI * t))
      }
    })

    // ── Sub-nodes: text only on click ──────────────────────────────────────────
    const subG = root.append('g')
    const subSel = subG.selectAll('g').data(L.subs).join('g')
      .attr('transform', d => `translate(${d.x},${d.y})`).style('cursor', 'pointer')
    subSel.append('circle')
      .attr('r', d => d.nested.length ? 4.6 : 3.4)
      .attr('fill', d => d.nested.length ? C.gold : C.purple)
      .attr('fill-opacity', 0.9)
      .style('filter', d => `drop-shadow(0 0 3px ${d.nested.length ? C.gold : C.purple})`)
    subSel.on('click', (e, d) => {
      if (linkModeRef.current) return
      e.stopPropagation()
      const parent = byId.get(d.parent)
      setSelected({
        title: { finding: 'Finding', note: 'Note', expanded: 'Second-degree lead' }[d.kind] || 'Branch',
        sub: `on ${parent.label}`,
        body: d.text,
        conf: d.conf,
        date: d.date,
        sources: d.sources,
      })
    })
    for (const s of L.subs) {
      subG.append('g').selectAll('circle').data(s.nested).join('circle')
        .attr('cx', c => c.x).attr('cy', c => c.y).attr('r', 2.4)
        .attr('fill', C.purple).attr('fill-opacity', 0.8)
    }

    // ── Main nodes ─────────────────────────────────────────────────────────────
    const nodeG = root.append('g')
    const node = nodeG.selectAll('g').data(L.nodes).join('g')
      .attr('transform', d => `translate(${d.x},${d.y})`).style('cursor', 'pointer')
    nodeSelRef.current = node

    node.filter(d => d.isNew).append('circle').classed('beacon', true)
      .attr('r', d => d.size).attr('fill', 'none')
      .attr('stroke', d => nodeFill(d)).attr('stroke-width', 2)

    node.append('circle').classed('main-circle', true)
      .attr('r', d => d.size)
      .attr('fill', nodeFill)
      .attr('stroke', nodeStroke)
      .attr('stroke-width', d => (d.degree === 0 && !d.subs.length) ? 1 : 1.6)
      .attr('stroke-dasharray', d => d.fromMemory ? '3,3' : null)
      .style('filter', d => nodeGlow(d) ? `drop-shadow(0 0 6px ${nodeGlow(d)})` : null)

    node.append('title').text(d => d.label)

    // Labels: at most 5 keywords, on the inward side so they stay clear of outward branches.
    // Zoomed out, only the busiest nodes carry a label; the rest appear as you zoom in.
    const score = d => d.degree * 2 + d.subs.length + (d.isNew ? 2 : 0) + (d.fused ? 2 : 0)
    L.nodes.forEach(n => { n._score = score(n) })
    const ranked = [...L.nodes].sort((a, b) => b._score - a._score)
    ranked.forEach((n, i) => { n._rank = i })
    const labelLimit = k => (k < 0.7 ? 8 : k < 1.5 ? 30 : Infinity)
    const label = node.append('text')
      .attr('x', d => -Math.cos(d.theta) * (d.size + 7))
      .attr('y', d => -Math.sin(d.theta) * (d.size + 7) + 3)
      .attr('text-anchor', d => { const c = Math.cos(d.theta); return c > 0.3 ? 'end' : c < -0.3 ? 'start' : 'middle' })
      .attr('fill', d => d.fromMemory ? C.dim : C.cream)
      .attr('font-family', '"Orbitron", sans-serif')
      .attr('letter-spacing', '0.04em')
      .attr('paint-order', 'stroke').attr('stroke', C.bgCard).attr('stroke-width', 3).attr('stroke-linejoin', 'round')
      .style('pointer-events', 'none')
      .text(d => shortLabel(d.label, 5))

    const applyZoom = k => {
      const size = Math.max(7, Math.min(15, 11 / k))
      label.attr('font-size', size)
        .attr('display', d => (d._rank < labelLimit(k) ? null : 'none'))
    }

    node.on('click', (e, d) => {
      e.stopPropagation()
      if (!linkModeRef.current) {
        setSelected({
          title: d.label,
          sub: `${d.type}${d.fromMemory ? ' · recalled from memory' : ''}`,
          body: d.notes || '',
          conf: d.conf,
          found: [...d.searches].sort().map(topicOf),
          extra: `${d.degree} connection${d.degree === 1 ? '' : 's'} · ${d.subs.length} branch${d.subs.length === 1 ? '' : 'es'}${d.moreSubs > 0 ? ` (${d.moreSubs} not drawn)` : ''}`,
        })
        return
      }
      // Link mode: click two nodes to draw a thread.
      if (!pendingRef.current) {
        pendingRef.current = d.id
        d3.select(e.currentTarget).select('.main-circle').attr('stroke', C.gold).attr('stroke-width', 3)
      } else {
        const srcId = pendingRef.current
        pendingRef.current = null
        node.filter(n => n.id === srcId).select('.main-circle').attr('stroke', nodeStroke).attr('stroke-width', 1.6)
        if (srcId !== d.id) {
          manualLinksRef.current.push({ source: srcId, target: d.id })
          renderManual()
        }
      }
    })
    svg.on('click', () => setSelected(null))

    // ── Zoom / pan, fitted to the whole network on load ────────────────────────
    const { minX, maxX, minY, maxY } = L.bounds
    const bw = maxX - minX + 140, bh = maxY - minY + 140
    const k0 = Math.min(W / bw, H / bh, 1.3)
    const zoom = d3.zoom().scaleExtent([0.1, 6]).on('zoom', e => {
      root.attr('transform', e.transform)
      applyZoom(e.transform.k)
    })
    svg.call(zoom)
    svg.call(zoom.transform, d3.zoomIdentity
      .translate(W / 2 - ((minX + maxX) / 2) * k0, H / 2 - ((minY + maxY) / 2) * k0).scale(k0))

    // ── Legend ─────────────────────────────────────────────────────────────────
    const legendRows = [
      [C.white,  'connected node'],
      [C.purple, 'branches / one search'],
      [C.gold,   'spans several searches'],
      [C.black,  'standalone statement'],
      [C.gold,   'pulse: thread across rings'],
    ]
    const legend = svg.append('g').attr('transform', 'translate(14,14)').style('pointer-events', 'none')
    legendRows.forEach(([col, text], i) => {
      const g = legend.append('g').attr('transform', `translate(0,${i * 16})`)
      g.append('circle').attr('r', 4).attr('cx', 5).attr('cy', 5).attr('fill', col)
        .attr('stroke', col === C.black ? C.dim : col).attr('stroke-width', 1)
      g.append('text').attr('x', 16).attr('y', 8.5).attr('fill', C.dim)
        .attr('font-family', '"Space Mono", monospace').attr('font-size', 9).text(text)
    })

    return () => { timer?.stop() }
  }, [searches, memoryData])

  function toggleLinkMode() {
    if (linkMode && pendingRef.current && nodeSelRef.current) {
      const id = pendingRef.current
      nodeSelRef.current.filter(n => n.id === id).select('.main-circle')
        .attr('stroke', nodeStroke).attr('stroke-width', 1.6)
    }
    pendingRef.current = null
    setLinkMode(m => !m)
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={toggleLinkMode}
        title={linkMode ? 'Cancel — click to exit link mode' : 'Link Nodes — click two nodes to draw a thread'}
        style={{
          position: 'absolute', top: 8, right: 8, zIndex: 10,
          background: linkMode ? C.gold : 'transparent',
          color: linkMode ? C.bgCard : C.dim,
          border: `1px solid ${linkMode ? C.gold : C.border}`,
          borderRadius: '4px', fontFamily: '"Space Mono", monospace',
          fontSize: '10px', padding: '4px 10px', cursor: 'pointer', letterSpacing: '0.05em',
        }}
      >
        {linkMode ? '✕ CANCEL' : '⊕ LINK NODES'}
      </button>
      <div ref={containerRef} style={{ width: '100%', height: '520px', borderRadius: '8px', overflow: 'hidden' }} />
      {selected && (
        <div style={{
          marginTop: 10, padding: '12px 14px', background: C.bgCard, border: `1px solid ${C.border}`,
          borderRadius: 8, fontFamily: '"Space Mono", monospace', fontSize: 12, color: C.cream, lineHeight: 1.5,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
            <strong style={{ color: C.gold }}>{selected.title}</strong>
            <button onClick={() => setSelected(null)} aria-label="Close details"
              style={{ background: 'none', border: 'none', color: C.dim, cursor: 'pointer', fontSize: 14 }}>✕</button>
          </div>
          {selected.sub && <div style={{ color: C.dim, fontSize: 11 }}>{selected.sub}</div>}
          {selected.body && <p style={{ margin: '8px 0 0' }}>{selected.body}</p>}
          {selected.conf != null && <div style={{ color: C.dim, fontSize: 11, marginTop: 6 }}>confidence {Math.round(selected.conf * 100)}%{selected.date ? ` · ${selected.date}` : ''}</div>}
          {selected.extra && <div style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>{selected.extra}</div>}
          {selected.found?.length > 0 && <div style={{ color: C.dim, fontSize: 11, marginTop: 4 }}>found in: {selected.found.join(' · ')}</div>}
          {selected.sources?.length > 0 && (
            <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: C.dim, fontSize: 11 }}>
              {selected.sources.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}
