import dagre from '@dagrejs/dagre'

export const SIZE = { w: 250, h: 92 }
const sizeOf = n => n.kind === 'decide' ? { w: 300, h: 112 } : SIZE

// Nodes and edges for one level of the flow, laid out left to right.
export function layout(run, scope = 'root', showOld = false) {
  const visible = run.order.map(id => run.nodes[id])
    .filter(n => n.scope === scope && (showOld || n.status !== 'superseded'))
  const ids = new Set(visible.map(n => n.id))
  const edges = []
  for (const n of visible) {
    const from = n.kind === 'unstick' ? [n.data.target] : n.deps
    for (const d of from) if (ids.has(d)) edges.push({ id: `${d}-${n.id}`, source: d, target: n.id, stuck: n.kind === 'unstick' })
  }
  const g = new dagre.graphlib.Graph()
  g.setGraph({ rankdir: 'LR', nodesep: 28, ranksep: 70, marginx: 20, marginy: 20 })
  g.setDefaultEdgeLabel(() => ({}))
  for (const n of visible) g.setNode(n.id, { width: sizeOf(n).w, height: sizeOf(n).h })
  for (const e of edges) g.setEdge(e.source, e.target)
  dagre.layout(g)
  const positions = {}
  for (const n of visible) {
    const p = g.node(n.id), s = sizeOf(n)
    positions[n.id] = { x: p.x - s.w / 2, y: p.y - s.h / 2, w: s.w, h: s.h }
  }
  return { visible, edges, positions }
}
