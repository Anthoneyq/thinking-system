import { useEffect, useMemo, useRef, useState } from 'react'
import { ReactFlow, ReactFlowProvider, Background, Controls, MiniMap, Handle, Position, MarkerType, useReactFlow } from '@xyflow/react'
import { layout } from '../shared/layout.js'
import { api, go, summary, KIND_LABEL } from './api.js'
import Panel from './Panel.jsx'

const STATUS = {
  queued: 'Up next', running: 'Working', done: 'Done', waiting: 'Waiting for you', error: 'Failed', superseded: 'Earlier pass',
}

function FlowNode({ data }) {
  const { n, selected, onOpenChild } = data
  const cls = ['fnode', 'k-' + n.kind, 'st-' + n.status, n.stuck && 'is-stuck', selected && 'is-selected'].filter(Boolean).join(' ')
  return (
    <div className={cls}>
      <Handle type="target" position={Position.Left} />
      <div className="fn-head">
        <span className="fn-kind">{KIND_LABEL[n.kind]}</span>
        <span className="fn-status">{n.stuck ? 'Stuck' : STATUS[n.status]}</span>
      </div>
      <div className="fn-title">{n.title}</div>
      <div className="fn-sum">{summary(n)}</div>
      {n.child && <button className="fn-child nodrag" onClick={e => { e.stopPropagation(); onOpenChild(n) }}>Level down &rarr;</button>}
      {n.status === 'running' && <span className="fn-bar" />}
      <Handle type="source" position={Position.Right} />
    </div>
  )
}
const nodeTypes = { step: FlowNode }

export default function RunView({ id }) {
  const [run, setRun] = useState(null)
  const [gone, setGone] = useState(false)
  const [scope, setScope] = useState('root')
  const [sel, setSel] = useState(null)
  const [showOld, setShowOld] = useState(false)
  const autoSel = useRef(new Set())

  useEffect(() => {
    const es = new EventSource(`/api/runs/${id}/events`)
    es.onmessage = e => setRun(JSON.parse(e.data))
    es.onerror = () => fetch(`/api/runs/${id}`).then(r => { if (r.status === 404) { setGone(true); es.close() } })
    return () => es.close()
  }, [id])

  // Jump to anything that needs the user, once per step.
  useEffect(() => {
    if (!run) return
    const w = run.order.map(i => run.nodes[i]).find(n => n.status === 'waiting' && !autoSel.current.has(n.id))
    if (w) { autoSel.current.add(w.id); setScope(w.scope); setSel(w.id) }
    if (run.title) document.title = run.title + ' - Thinking System'
  }, [run])

  if (gone) return <div className="empty">That run doesn't exist. <a href="/" onClick={e => { e.preventDefault(); go('/') }}>Start a new one</a></div>
  if (!run) return <div className="empty">Loading...</div>

  const act = (action, body) => api(`runs/${run.id}/${action}`, body)
  const scopes = scopeTrail(run, scope)
  const node = sel && run.nodes[sel]

  return (
    <div className="runview">
      <header className="run-top">
        <a className="brand" href="/" onClick={e => { e.preventDefault(); go('/') }}><i />Thinking System</a>
        <div className="run-title">
          <h1>{run.title}</h1>
          <span className="sub">{run.model} &middot; {run.effort} effort{run.cost > 0 ? ` · $${run.cost.toFixed(2)}` : ''}</span>
        </div>
        <span className={'pill s-' + run.status}>{run.status === 'waiting' ? 'waiting for you' : run.status}</span>
        {run.status === 'paused' && <button className="primary" onClick={() => act('resume', {})}>Resume</button>}
        <label className="check"><input type="checkbox" checked={showOld} onChange={e => setShowOld(e.target.checked)} /> Earlier passes</label>
        <a className="btn" href={`/api/runs/${run.id}/excalidraw?scope=${scope}`}>Excalidraw</a>
        <button className="btn" onClick={() => go('/')}>New thought</button>
      </header>
      <div className="run-body">
        <section className="canvas">
          <nav className="levels">
            {scopes.map((s, i) => (
              <button key={s.scope} aria-current={s.scope === scope} onClick={() => { setScope(s.scope); setSel(null) }}>
                {i > 0 && <span className="sep">/</span>}Level {i + 1}{i > 0 ? `: ${s.label}` : ''}
              </button>
            ))}
          </nav>
          <ReactFlowProvider>
            <Flow run={run} scope={scope} showOld={showOld} sel={sel} setSel={setSel} onOpenChild={n => { setScope(n.child); setSel(null) }} />
          </ReactFlowProvider>
          <Activity run={run} />
        </section>
        <Panel run={run} node={node} scope={scope} act={act} setSel={setSel} setScope={setScope} />
      </div>
    </div>
  )
}

function scopeTrail(run, scope) {
  const trail = []
  let s = scope
  while (s && s !== 'root') {
    const parent = run.nodes[s.slice(1)]
    trail.unshift({ scope: s, label: parent?.title || s })
    s = parent?.scope
  }
  return [{ scope: 'root', label: '' }, ...trail]
}

function Flow({ run, scope, showOld, sel, setSel, onOpenChild }) {
  const { setViewport } = useReactFlow()
  const box = useRef(null)
  const { visible, edges, positions } = useMemo(() => layout(run, scope, showOld), [run, scope, showOld])
  const nodes = visible.map(n => ({
    id: n.id, type: 'step', position: { x: positions[n.id].x, y: positions[n.id].y }, width: positions[n.id].w, height: positions[n.id].h,
    data: { n, selected: n.id === sel, onOpenChild }, draggable: false,
  }))
  const flowEdges = edges.map(e => {
    const t = run.nodes[e.target]
    return {
      id: e.id, source: e.source, target: e.target, type: 'smoothstep',
      animated: t.status === 'running' || t.status === 'queued',
      className: e.stuck ? 'edge-stuck' : t.status === 'superseded' ? 'edge-old' : '',
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    }
  })
  // Camera: show the whole level if it stays readable, otherwise follow the step that is working or waiting.
  const live = visible.find(n => n.status === 'running' || n.status === 'waiting') || visible.at(-1)
  const focusId = live?.id
  useEffect(() => {
    const el = box.current
    if (!el || !visible.length) return
    const W = el.clientWidth, H = el.clientHeight, ps = visible.map(n => positions[n.id])
    const x0 = Math.min(...ps.map(p => p.x)), y0 = Math.min(...ps.map(p => p.y))
    const x1 = Math.max(...ps.map(p => p.x + p.w)), y1 = Math.max(...ps.map(p => p.y + p.h))
    const fit = Math.min((W - 80) / (x1 - x0), (H - 160) / (y1 - y0), 1)
    if (fit >= 0.72) return void setViewport({ x: (W - (x1 - x0) * fit) / 2 - x0 * fit, y: (H - (y1 - y0) * fit) / 2 - y0 * fit, zoom: fit }, { duration: 500 })
    const f = positions[focusId], zoom = 0.85
    setViewport({ x: W * 0.62 - (f.x + f.w / 2) * zoom, y: H / 2 - (f.y + f.h / 2) * zoom, zoom }, { duration: 600 })
  }, [visible.length, focusId, scope]) // eslint-disable-line
  return (
    <div className="flow" ref={box}>
      <ReactFlow nodes={nodes} edges={flowEdges} nodeTypes={nodeTypes} onNodeClick={(_, n) => setSel(n.id)} onPaneClick={() => setSel(null)}
        nodesConnectable={false} minZoom={0.25} maxZoom={1.6} proOptions={{ hideAttribution: true }}>
        <Background gap={24} size={1.2} />
        <Controls showInteractive={false} />
        {visible.length > 7 && <MiniMap pannable zoomable nodeBorderRadius={6} nodeClassName={n => n.data.n.stuck ? 'mm-stuck' : n.data.n.status === 'waiting' || n.data.n.status === 'running' ? 'mm-live' : 'mm-node'} maskColor="rgba(120,125,140,.14)" position="top-right" style={{ width: 180, height: 110 }} />}
      </ReactFlow>
    </div>
  )
}

function Activity({ run }) {
  const last = run.activity.slice(-3).reverse()
  return (
    <div className="activity" aria-live="polite">
      {last.map((a, i) => <div key={a.t + i} className={i ? 'old' : ''}><time>{new Date(a.t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })}</time>{a.text}</div>)}
    </div>
  )
}
