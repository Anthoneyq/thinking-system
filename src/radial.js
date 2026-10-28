// Map layout: the question sits at the centre; each pass grows branches outward and they flow back in.
export const SZ = { center: { w: 360, h: 196 }, branch: { w: 236, h: 92 }, leaf: { w: 184, h: 40 } }
const BRANCH = ['method', 'develop', 'research', 'review']
const R1 = 270, RING = 430, LEAF = 175, SQUASH = 1.4 // ellipse: wider than tall to suit the screen
const rad = d => d * Math.PI / 180
const at = (deg, r) => ({ x: Math.cos(rad(deg)) * r * SQUASH, y: Math.sin(rad(deg)) * r })

export function leavesOf(n) {
  if (n.status !== 'done' || !n.out) return []
  if (n.kind === 'method') return n.out.options.slice(0, 4)
  if (n.kind === 'develop') return n.out.sub_options.slice(0, 3)
  return []
}

export function radial(run, scope) {
  const all = run.order.map(id => run.nodes[id]).filter(n => n.scope === scope && n.status !== 'superseded')
  const branches = all.filter(n => BRANCH.includes(n.kind))
  const ringOf = n => n.kind === 'review' ? 0 : n.data.ring || 1
  const angle = {}, radius = {}

  // First ring: evenly around the centre, tilted so no layout collapses into a flat line.
  const first = branches.filter(n => ringOf(n) === 1)
  const step = 360 / Math.max(first.length, 1)
  const offset = first.length === 2 ? 205 : first.length % 2 ? -90 : 180 / first.length + 180
  first.forEach((n, i) => { angle[n.id] = offset + i * step; radius[n.id] = R1 })
  // The skeptic sits in a gap of the first ring, close to the centre it argues with.
  branches.filter(n => ringOf(n) === 0).forEach((n, i) => { angle[n.id] = offset + step / 2 + i * step; radius[n.id] = R1 * 0.95 })

  // Outer rings: grow from the branch that produced them, otherwise fill the gaps.
  const rings = [...new Set(branches.map(ringOf))].filter(r => r > 1).sort((a, b) => a - b)
  for (const r of rings) {
    const here = branches.filter(n => ringOf(n) === r)
    const byParent = {}
    here.forEach(n => { const p = n.data.parent && angle[n.data.parent] !== undefined ? n.data.parent : '_'; (byParent[p] ||= []).push(n) })
    for (const [p, kids] of Object.entries(byParent)) {
      kids.forEach((n, i) => {
        if (p === '_') angle[n.id] = (n.kind === 'review' ? 90 : offset + step / 2) + i * (360 / Math.max(kids.length, 1))
        else angle[n.id] = angle[p] + (i - (kids.length - 1) / 2) * 27
        radius[n.id] = R1 + RING * (r - 1) + (kids.length > 2 && i % 2 ? 90 : 0) // stagger crowded siblings
      })
    }
  }

  const nodes = [{ id: 'center', type: 'center', x: 0, y: 0, ...SZ.center }]
  const edges = []
  for (const n of branches) {
    const p = at(angle[n.id], radius[n.id])
    nodes.push({ id: n.id, type: 'branch', n, x: p.x, y: p.y, ...SZ.branch, angle: angle[n.id] })
    const parent = n.data.parent && angle[n.data.parent] !== undefined ? n.data.parent : null
    if (parent) edges.push({ id: `g-${n.id}`, source: parent, target: n.id, type: 'grow', n })
    edges.push({ id: `p-${n.id}`, source: 'center', target: n.id, type: 'petal', n, outHidden: !!parent })
    const leaves = leavesOf(n)
    const spread = Math.min(step * 0.6, ringOf(n) === 1 ? 70 : 34)
    leaves.forEach(({ title }, j) => {
      const a = angle[n.id] + (leaves.length > 1 ? (j / (leaves.length - 1) - 0.5) * spread : 0)
      const q = at(a, radius[n.id] + LEAF)
      const id = `${n.id}-l${j}`
      nodes.push({ id, type: 'leaf', parentNode: n.id, title, x: q.x, y: q.y, ...SZ.leaf, i: j })
      edges.push({ id: `l-${id}`, source: n.id, target: id, type: 'leaf' })
    })
  }
  for (const n of all.filter(x => x.kind === 'unstick')) {
    const t = nodes.find(x => x.id === n.data.target)
    const base = t || nodes[0]
    const a = rad((t?.angle ?? 90) + 90)
    nodes.push({ id: n.id, type: 'branch', n, x: base.x + Math.cos(a) * 150, y: base.y + Math.sin(a) * 120 + (t ? 0 : 150), ...SZ.branch })
    edges.push({ id: `u-${n.id}`, source: base.id, target: n.id, type: 'stuck', n })
  }
  const ringRadii = [R1, ...rings.map(r => R1 + RING * (r - 1))]
  return { all, nodes, edges, ringRadii, squash: SQUASH }
}
