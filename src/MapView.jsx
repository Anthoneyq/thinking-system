import { useEffect, useMemo, useRef } from 'react'
import { ReactFlow, Handle, Position, useReactFlow, Controls } from '@xyflow/react'
import { radial } from './radial.js'
import { summary, KIND_LABEL } from './api.js'

const hidden = { top: '50%', left: '50%', transform: 'translate(-50%,-50%)', opacity: 0, pointerEvents: 'none' }
const Hs = () => <><Handle type="target" position={Position.Top} style={hidden} /><Handle type="source" position={Position.Bottom} style={hidden} /></>

function CenterNode({ data }) {
  const { trail, decision, waiting, passes, selected } = data
  const now = trail.at(-1), before = trail.at(-2)
  const mode = decision ? 'decided' : waiting ? 'asking' : 'question'
  return (
    <div className={`cnode m-${mode}${selected ? ' is-selected' : ''}`}>
      <Hs />
      <div className="c-top">
        <span>{decision ? 'Decision' : waiting ? 'Back to you' : 'The question'}</span>
        {trail.length > 1 && !decision && <span className="c-ver">restated {trail.length - 1}&times;</span>}
        {decision && <span className="c-ver">{passes} pass{passes === 1 ? '' : 'es'}</span>}
      </div>
      <div key={decision ? 'd' : waiting ? 'w' + waiting.id : now?.node || 'none'} className="c-text">
        {decision ? decision.recommendation : waiting ? waiting.data.questions[0]?.q : now?.text || 'Reading your thought...'}
      </div>
      {decision ? <div className="c-next">Next: {decision.next_action.what}</div>
        : waiting ? <div className="c-was">{waiting.data.questions.length > 1 ? `+${waiting.data.questions.length - 1} more. ` : ''}Answer on the right, or let it decide.</div>
        : before && <div className="c-was" key={'was' + now.node}><s>{before.text}</s>{now.changed && <em>{now.changed}</em>}</div>}
    </div>
  )
}

function BranchNode({ data }) {
  const { n, selected } = data
  const cls = ['bnode', 'k-' + n.kind, 'st-' + n.status, n.stuck && 'is-stuck', selected && 'is-selected', n.kind === 'develop' && n.out && 'v-' + n.out.verdict].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      <Hs />
      <div className="b-head"><span>{n.kind === 'method' ? 'Branch' : KIND_LABEL[n.kind]}</span><i /></div>
      <div className="b-title">{n.title}</div>
      {n.out?.quadrant?.items?.length > 0 && <MiniQuad q={n.out.quadrant} />}
      <div className="b-sum">{n.status === 'running' ? <span className="thinking"><b /><b /><b /></span> : summary(n)}</div>
    </div>
  )
}

// Tiny 2x2 with the count in each box, so a grid branch reads as a grid from the map.
function MiniQuad({ q }) {
  const hiFirst = !/effort/i.test(q.x)
  const cell = (yh, xh) => q.items.filter(i => i.y_high === yh && i.x_high === xh).length
  const cols = hiFirst ? [true, false] : [false, true]
  return <div className="b-quad" title={`${q.y} by ${q.x}`}>{[true, false].flatMap(yh => cols.map(xh => <span key={'' + yh + xh} className={yh && xh === hiFirst ? 'hot' : ''}>{cell(yh, xh) || ''}</span>))}</div>
}

const LeafNode = ({ data }) => <div className={'lnode' + (data.selected ? ' is-selected' : '')} style={{ animationDelay: data.i * 90 + 'ms' }}><Hs />{data.title}</div>

function RingsNode({ data }) {
  const { radii, squash, size } = data
  return (
    <svg className="rings" width={size * 2} height={size * 2} viewBox={`${-size} ${-size} ${size * 2} ${size * 2}`}>
      {radii.map((r, i) => <ellipse key={i} cx="0" cy="0" rx={r * squash} ry={r} />)}
    </svg>
  )
}

const nodeTypes = { center: CenterNode, branch: BranchNode, leaf: LeafNode, rings: RingsNode }

// Out along one side of a petal, back along the other.
function curve(sx, sy, tx, ty, bend) {
  const mx = (sx + tx) / 2, my = (sy + ty) / 2, dx = tx - sx, dy = ty - sy
  return `M${sx},${sy} Q${mx - dy * bend},${my + dx * bend} ${tx},${ty}`
}
const Dots = ({ d, dur = 1.6, n = 3 }) => Array.from({ length: n }, (_, i) => (
  <circle key={i} r="3.2" className="dot"><animateMotion dur={dur + 's'} begin={(i * dur / n) + 's'} repeatCount="indefinite" path={d} /></circle>
))

function PetalEdge({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, data }) {
  const { n, merge, outHidden } = data
  const out = curve(sx, sy, tx, ty, 0.2), back = curve(tx, ty, sx, sy, 0.2)
  const st = n.status
  return <g className={'petal st-' + st}>
    {!outHidden && <path d={out} pathLength="1" className="p-out" />}
    {st === 'running' && !outHidden && <Dots d={out} />}
    {st === 'done' && <path d={back} pathLength="1" className={'p-back m-' + merge} />}
    {st === 'done' && merge === 'running' && <Dots d={back} dur={1.2} />}
  </g>
}
function GrowEdge({ sourceX: sx, sourceY: sy, targetX: tx, targetY: ty, data }) {
  const d = curve(sx, sy, tx, ty, -0.08)
  return <g className={'grow st-' + data.n.status}><path d={d} pathLength="1" className="g-path" />{data.n.status === 'running' && <Dots d={d} n={2} />}</g>
}
const LeafEdge = ({ sourceX, sourceY, targetX, targetY }) => <path className="leaf-edge" pathLength="1" d={`M${sourceX},${sourceY} L${targetX},${targetY}`} />
const StuckEdge = ({ sourceX, sourceY, targetX, targetY }) => <path className="stuck-edge" d={curve(sourceX, sourceY, targetX, targetY, 0.2)} />
const edgeTypes = { petal: PetalEdge, grow: GrowEdge, leaf: LeafEdge, stuck: StuckEdge }

export default function MapView({ run, scope, sel, setSel }) {
  const { setViewport } = useReactFlow()
  const box = useRef(null)
  const { all, nodes: laid, edges: laidEdges, ringRadii, squash } = useMemo(() => radial(run, scope), [run, scope])

  const trail = all.filter(n => (n.kind === 'frame' || n.kind === 'converge') && n.status === 'done' && n.out.question)
    .map(n => ({ node: n.id, text: n.out.question, changed: n.out.changed || '' }))
  const decideNode = all.filter(n => n.kind === 'decide' && n.status === 'done').at(-1)
  const waiting = all.find(n => n.status === 'waiting')
  const passes = all.filter(n => n.kind === 'converge' && n.status === 'done').length
  // What each branch is flowing back into, so returning curves can animate while the merge runs.
  const mergeOf = id => all.find(x => x.deps.includes(id))?.status || 'none'

  const maxR = Math.max(...ringRadii) + 260
  const rfNodes = [
    { id: 'rings', type: 'rings', position: { x: -maxR * squash, y: -maxR * squash }, data: { radii: ringRadii, squash, size: maxR * squash }, selectable: false, draggable: false, zIndex: -1, width: maxR * 2 * squash, height: maxR * 2 * squash },
    ...laid.map(p => ({
      id: p.id, type: p.type, position: { x: p.x - p.w / 2, y: p.y - p.h / 2 }, width: p.w, height: p.h, draggable: false,
      data: p.type === 'center' ? { trail, decision: decideNode?.out, waiting, passes, selected: !sel }
        : p.type === 'leaf' ? { title: p.title, i: p.i, parent: p.parentNode, selected: sel === p.id }
        : { n: p.n, selected: sel === p.id },
    })),
  ]
  const rfEdges = laidEdges.map(e => ({ id: e.id, source: e.source, target: e.target, type: e.type, data: { n: e.n, outHidden: e.outHidden, merge: e.n ? mergeOf(e.n.id) : null } }))

  // Camera: frame the centre plus whatever is working now; otherwise the whole map.
  const live = laid.filter(p => p.type === 'branch' && ['running', 'queued', 'waiting'].includes(p.n.status))
  // When it comes back to ask you, close in on the question itself.
  const focus = waiting ? [laid[0]] : live.length ? [laid[0], ...live, ...live.map(p => laid.find(q => q.id === p.n.data.parent)).filter(Boolean)] : laid
  const sig = (waiting ? 'ask' + waiting.id : focus.map(p => p.id).join(',')) + '|' + laid.length
  useEffect(() => {
    const el = box.current
    if (!el) return
    const W = el.clientWidth, H = el.clientHeight
    const x0 = Math.min(...focus.map(p => p.x - p.w / 2)), x1 = Math.max(...focus.map(p => p.x + p.w / 2))
    const y0 = Math.min(...focus.map(p => p.y - p.h / 2)), y1 = Math.max(...focus.map(p => p.y + p.h / 2))
    const zoom = Math.max(0.4, Math.min(waiting ? 0.82 : 1, (W - 80) / (x1 - x0), (H - 190) / (y1 - y0)))
    setViewport({ x: W / 2 - ((x0 + x1) / 2) * zoom, y: (H + 90) / 2 - ((y0 + y1) / 2) * zoom, zoom }, { duration: 800 })
  }, [sig]) // eslint-disable-line

  return (
    <div className="flow map" ref={box}>
      <ReactFlow nodes={rfNodes} edges={rfEdges} nodeTypes={nodeTypes} edgeTypes={edgeTypes} nodesConnectable={false} elementsSelectable
        onNodeClick={(_, n) => setSel(n.type === 'center' ? null : n.type === 'rings' ? sel : n.id)}
        minZoom={0.25} maxZoom={1.6} proOptions={{ hideAttribution: true }}>
        <Controls showInteractive={false} />
      </ReactFlow>
    </div>
  )
}
