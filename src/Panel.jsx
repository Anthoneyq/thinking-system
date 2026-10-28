import { useEffect, useRef, useState } from 'react'
import { KIND_LABEL, api, modelName } from './api.js'
import { leavesOf } from './radial.js'

const latest = (run, scope, kind) => run.order.map(i => run.nodes[i]).filter(n => n.scope === scope && n.kind === kind && n.status === 'done').at(-1)

export default function Panel({ run, node, sel, scope, act, setSel, setScope }) {
  // Back to the top whenever the subject changes or a decision lands.
  const ref = useRef(null)
  const decided = latest(run, scope, 'decide')?.id
  useEffect(() => { ref.current?.scrollTo({ top: 0 }) }, [sel, scope, decided])
  const leaf = !node && sel?.match(/^(.+)-l(\d+)$/)
  return (
    <aside className="panel" ref={ref}>
      {leaf && run.nodes[leaf[1]] ? <LeafDetail run={run} parent={run.nodes[leaf[1]]} j={+leaf[2]} setSel={setSel} />
        : node ? <NodeDetail key={node.id} run={run} n={node} act={act} setSel={setSel} setScope={setScope} /> : <Overview run={run} scope={scope} act={act} setSel={setSel} />}
    </aside>
  )
}

function Overview({ run, scope, act, setSel }) {
  const decide = latest(run, scope, 'decide')
  const frame = latest(run, scope, 'frame')
  const waiting = run.order.map(i => run.nodes[i]).filter(n => n.status === 'waiting')
  return (
    <div className="pane">
      {waiting.length > 0 && (
        <button className="callout" onClick={() => setSel(waiting[0].id)}>
          <strong>Waiting for you</strong> {waiting[0].title}: answer to continue, or let it decide.
        </button>
      )}
      {decide && <Decision o={decide.out} runId={run.id} />}
      <OpenPoints run={run} scope={scope} act={act} setSel={setSel} />
      <Trail run={run} scope={scope} setSel={setSel} />
      <Process run={run} scope={scope} setSel={setSel} />
      {frame ? <Frame run={run} frame={frame} act={act} /> : <p className="sub">Framing your thought...</p>}
      <p className="foot sub">Click any box to see its work, mark it stuck, go a level deeper, or redo it.</p>
    </div>
  )
}

// Every version of the question, oldest first: the loop made visible.
function Trail({ run, scope, setSel }) {
  const versions = run.order.map(i => run.nodes[i])
    .filter(n => n.scope === scope && n.status !== 'superseded' && (n.kind === 'frame' || n.kind === 'converge' || n.kind === 'ask') && n.status === 'done')
  if (!versions.some(n => n.out.question)) return null
  return (
    <div className="trail">
      <h3>How the question moved</h3>
      <ol>
        {versions.map((n, i) => n.kind === 'ask'
          ? <li key={n.id} className="t-you"><button onClick={() => setSel(n.id)}><span>You</span>{n.out.skipped ? 'Let it decide' : n.out.answers.map(a => a.a).join(' \u00b7 ')}</button></li>
          : n.out.question && <li key={n.id} className={i === versions.length - 1 ? 't-now' : ''}><button onClick={() => setSel(n.id)}>
            <span>{n.kind === 'frame' ? (n.title === 'Reframe' ? 'Reframed with your answers' : 'First asked') : n.title === 'Restate with your answers' ? 'Restated with your answers' : 'Restated after the branches came back'}</span>{n.out.question}{n.out.changed && <em>{n.out.changed}</em>}
          </button></li>)}
      </ol>
    </div>
  )
}

function Frame({ run, frame, act }) {
  const f = frame.out
  const fix = (original, action, text = '') => act('correct', { original, action, text, frameId: frame.id })
  return (
    <div className="frame">
      <h3>Goal <Source s={f.goal.source} /></h3>
      <p className="goal">{f.goal.text}</p>

      <h3>You said</h3>
      <ul className="chips stated">{f.stated.map((s, i) => <li key={i}>{s}</li>)}</ul>

      <h3>I inferred <span className="sub">correct anything wrong; the flow redoes itself</span></h3>
      <ul className="inferred">
        {[{ text: f.goal.text, why: 'Goal', goal: true }].filter(() => f.goal.source === 'inferred').concat(f.inferred).map((x, i) =>
          <Fixable key={i} run={run} text={x.text} why={x.why} label={x.goal ? 'Goal: ' : ''} onFix={fix} />)}
      </ul>

      {(f.constraints.length > 0 || run.constraints.length > 0) && <>
        <h3>Constraints</h3>
        <ul className="plain">
          {f.constraints.map((c, i) => <li key={i}>{c.text} {c.hard && <span className="tag">hard</span>} {c.source === 'inferred' && <span className="tag dashed">inferred</span>}</li>)}
          {run.constraints.map((c, i) => <li key={'u' + i} className="red">{c.text} <span className="tag red">you flagged</span></li>)}
        </ul>
      </>}

      {f.unknowns.length > 0 && <>
        <h3>Missing, and what to do about it</h3>
        <table className="unknowns"><tbody>
          {f.unknowns.map((u, i) => <tr key={i}><td>{u.text}<div className="sub">{u.why_it_matters}</div></td><td><span className={'act a-' + u.action}>{u.action}</span><div className="sub">{u.how}</div></td></tr>)}
        </tbody></table>
      </>}

      {f.evidence.length > 0 && <><h3>Evidence</h3><ul className="plain">{f.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></>}
      <p className="sub conf">Confidence: <b>{f.confidence.level}</b> - {f.confidence.basis}</p>
    </div>
  )
}

// One item the system inferred or assumed: mark it right or wrong, or say what is actually true.
function Fixable({ run, text, why, label, kind, onFix }) {
  const c = run.corrections.find(x => x.original === text)
  const [editing, setEditing] = useState(false)
  const [val, setVal] = useState('')
  return (
    <li className={c ? 'c-' + c.action : ''}>
      <div className="inf-text">{kind && <span className="tag">{kind}</span>}{label && <b>{label}</b>}{text}{c?.action === 'edit' && <span className="edit-to"> &rarr; {c.text}</span>}</div>
      {why && <div className="inf-why">{why}</div>}
      {editing ? (
        <form className="inf-edit" onSubmit={e => { e.preventDefault(); if (val.trim()) { setEditing(false); onFix(text, 'edit', val) } }}>
          <input autoFocus value={val} onChange={e => setVal(e.target.value)} placeholder="What's actually true?" />
          <button className="primary">Save</button><button type="button" className="btn" onClick={() => setEditing(false)}>Cancel</button>
        </form>
      ) : !c && (
        <div className="inf-acts">
          <button onClick={() => onFix(text, 'confirm')}>Right</button>
          <button onClick={() => onFix(text, 'reject')}>Wrong</button>
          <button onClick={() => { setEditing(true); setVal('') }}>Change</button>
        </div>
      )}
    </li>
  )
}

// Where a point came up, as a jump to that box.
function placeOf(run, scope, key) {
  const ns = run.order.map(i => run.nodes[i]).filter(n => n.scope === scope && n.status === 'done')
  if (key === 'frame') return ns.filter(n => n.kind === 'frame').at(-1)
  return ns.filter(n => (n.kind === 'method' && n.data.method === key) || (n.kind === 'develop' && n.data.title === key) || n.title === key).at(-1)
}

const ACTION_LABEL = { ask: 'needs you', research: 'look up', test: 'test it', decide: 'it decides' }

// Everything still open, merged across branches, in the order to settle it. One answer covers every place it came up.
function OpenPoints({ run, scope, act, setSel }) {
  // While a pass is being redone, keep showing the last merged list rather than dropping back to the frame's.
  const conv = latest(run, scope, 'converge') || run.order.map(i => run.nodes[i]).filter(n => n.scope === scope && n.kind === 'converge' && n.out).at(-1)
  const frame = latest(run, scope, 'frame')
  const settled = (run.pointAnswers || []).filter(a => (a.scope || 'root') === scope)
  const [open, setOpen] = useState(null)
  const [val, setVal] = useState('')
  let points = conv?.out.open_points
  if (!points && frame) points = frame.out.unknowns.filter(u => u.action !== 'ignore')
    .map((u, i) => ({ id: 'u' + i, text: u.text, raised_in: ['frame'], times: 1, action: u.action, rank: i + 1, unlocks: u.why_it_matters }))
  points = (points || []).filter(p => !settled.some(a => a.point === p.text)).sort((a, b) => a.rank - b.rank)
  if (!points.length && !settled.length) return null
  const send = p => { if (!val.trim()) return; act('settle', { point: p.text, text: val, scope }); setOpen(null); setVal('') }
  return (
    <div className="points">
      <h3>Still open <span className="sub">in the order to settle them; one answer covers every place it came up</span></h3>
      <ol>
        {points.map((p, i) => (
          <li key={p.id}>
            <div className="pt-head"><span className="pt-rank">{i + 1}</span><span className="pt-text">{p.text}</span></div>
            <div className="pt-meta">
              {i === 0 && points.length > 1 && <span className="tag">settle first</span>}
              <span className={'act a-' + p.action}>{ACTION_LABEL[p.action] || p.action}</span>
              <span className="sub">came up {p.times}&times;:</span>
              {p.raised_in.map(k => { const n = placeOf(run, scope, k); return n
                ? <button key={k} className="pt-place" onClick={() => setSel(n.id)}>{k === 'frame' ? 'Frame' : n.title}</button>
                : <span key={k} className="pt-place off">{k}</span> })}
            </div>
            {p.unlocks && <div className="sub">Settles: {p.unlocks}</div>}
            {open === p.id
              ? <form className="inf-edit" onSubmit={e => { e.preventDefault(); send(p) }}>
                  <input autoFocus value={val} onChange={e => setVal(e.target.value)} placeholder="Your answer" />
                  <button className="primary">Settle</button><button type="button" className="btn" onClick={() => setOpen(null)}>Cancel</button>
                </form>
              : <div className="inf-acts"><button onClick={() => { setOpen(p.id); setVal('') }}>Answer this</button></div>}
          </li>
        ))}
      </ol>
      {settled.length > 0 && <><h3>You settled</h3><ul className="plain">{settled.map((a, i) => <li key={i}><b>{a.point}</b><br />{a.text}</li>)}</ul></>}
    </div>
  )
}

const GATE_LABEL = { commit: 'decide', develop: 'grow the top options', research: 'look things up', more: 'try other angles', ask: 'ask you' }

// The loop laid out: which tools ran in each pass, what came back, who made each call.
function Process({ run, scope, setSel }) {
  const ns = run.order.map(i => run.nodes[i]).filter(n => n.scope === scope && n.status !== 'superseded')
  const convs = ns.filter(n => n.kind === 'converge')
  if (!convs.length) return null
  const tools = {}
  ns.filter(n => n.kind === 'method').forEach(n => { tools[n.title] = (tools[n.title] || 0) + 1 })
  const written = ns.filter(n => n.status === 'done' && !['capture', 'ask'].includes(n.kind) && !(n.kind === 'route' && n.data.jev?.scored && !n.data.jev.fallback)).length
  return (
    <details className="process" open>
      <summary>How it's thinking</summary>
      <p className="sub"><b>{modelName(run.model)}</b> wrote {written} step{written === 1 ? '' : 's'}.{run.jev && run.jevStats ? <> <b>Jev</b> made {run.jevStats.calls} routing call{run.jevStats.calls === 1 ? '' : 's'}: picking tools, deciding what next, weighing questions.</> : run.jev ? ' Jev makes the routing calls.' : ''}</p>
      <div className="tools">{Object.entries(tools).map(([t, k]) => <span key={t} className="tag">{t}{k > 1 ? ` \u00d7${k}` : ''}</span>)}</div>
      <ol className="passes">
        {convs.map((c, i) => {
          const from = c.deps.map(d => run.nodes[d]).filter(Boolean)
          const you = from.some(n => n.kind === 'ask')
          const j = c.data.jev
          return (
            <li key={c.id}>
              <span className="ps-n">Pass {i + 1}</span>
              <div>
                {you ? <span>Your answers came in</span>
                  : <>Out to {from.map(n => <button key={n.id} className="pt-place" onClick={() => setSel(n.id)}>{n.title}</button>)}</>}
                <div className="sub">
                  &rarr; back together{c.out ? <>, then <b>{GATE_LABEL[c.out.next]}</b>{j?.kind === 'gate' ? ` (${j.decidedBy === 'jev' ? 'Jev' : 'Claude'}'s call)` : ''}</> : ' ...'}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </details>
  )
}

// An outer leaf: one option a branch surfaced, and what became of it.
function LeafDetail({ run, parent, j, setSel }) {
  const o = leavesOf(parent)[j]
  if (!o) return null
  const same = x => x.toLowerCase().trim() === o.title.toLowerCase().trim()
  const ns = run.order.map(i => run.nodes[i]).filter(n => n.scope === parent.scope && n.status === 'done')
  const conv = ns.filter(n => n.kind === 'converge').at(-1)
  const merged = conv?.out.all.find(x => same(x.title))
  const top = merged && conv.out.top.find(t => t.id === merged.id)
  const grown = ns.find(n => n.kind === 'develop' && same(n.data.title))
  return (
    <div className="pane">
      <button className="back" onClick={() => setSel(null)}>&larr; Overview</button>
      <span className="eyebrow">Option</span>
      <h2 className="node-title">{o.title}</h2>
      <p>{o.detail}</p>
      <h3>Where it came from</h3>
      <p><button className="pt-place" onClick={() => setSel(parent.id)}>{parent.title}</button> <span className="sub">{parent.kind === 'develop' ? 'a variant grown from this direction' : parent.data.focus}</span></p>
      <h3>What became of it</h3>
      {grown ? <p>Grown further. <button className="pt-place" onClick={() => setSel(grown.id)}>Open "{grown.title}"</button></p>
        : top ? <p><span className="tag">top 3</span>{top.why}</p>
        : merged ? <p className="sub">Considered when the branches came back; not shortlisted.</p>
        : <p className="sub">Merged into another option or not carried forward.</p>}
    </div>
  )
}

// Eisenhower or impact/effort: the items laid out in their four boxes.
const QUAD_NAMES = { urgent: [['Do now', 'Schedule'], ['Delegate', 'Drop']], effort: [['Quick wins', 'Big bets'], ['Fill-ins', 'Skip']] }
function Quadrant({ q }) {
  const effort = /effort/i.test(q.x)
  const cols = effort ? [false, true] : [true, false]
  const names = effort ? QUAD_NAMES.effort : /urgent/i.test(q.x) ? QUAD_NAMES.urgent : null
  const lab = (axis, h) => effort || !names ? `${h ? 'High' : 'Low'} ${axis.toLowerCase()}` : h ? axis : 'Not ' + axis.toLowerCase()
  return (
    <div className="quad">
      <div className="q-axis-x">{cols.map(h => <span key={'' + h}>{lab(q.x, h)}</span>)}</div>
      {[true, false].map((yh, r) => (
        <div className="q-row" key={'' + yh}>
          <span className="q-axis-y">{lab(q.y, yh)}</span>
          {cols.map((xh, c) => (
            <div key={'' + xh} className={'q-cell' + (r === 0 && c === 0 ? ' hot' : '')}>
              {names && <span className="q-name">{names[r][c]}</span>}
              <ul>{q.items.filter(i => i.y_high === yh && i.x_high === xh).map((i, k) => <li key={k}><b>{i.text}</b>{i.note && <span className="sub"> {i.note}</span>}</li>)}</ul>
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function Matrix({ m }) {
  const rows = [...m.rows].sort((a, b) => b.total - a.total)
  return (
    <div className="matrix-wrap"><table className="matrix">
      <thead><tr><th>Option</th>{m.criteria.map(c => <th key={c.name}>{c.name}<span className="sub"> {Math.round(c.weight * 100)}%</span></th>)}<th>Total</th></tr></thead>
      <tbody>{rows.map((r, i) => <tr key={r.option} className={i === 0 ? 'best' : ''}><td>{r.option}</td>{r.scores.map((x, k) => <td key={k}>{x}</td>)}<td><b>{Number(r.total.toFixed(2))}</b></td></tr>)}</tbody>
    </table><p className="sub">Scores aid judgment; options breaking a hard rule were left out, not scored low.</p></div>
  )
}

const Source = ({ s }) => <span className={'tag' + (s === 'stated' ? '' : ' dashed')}>{s}</span>

const CALL_LABEL = { decide: 'Decide', test: 'Test first', defer: 'Defer', ask: 'Your call' }

function Decision({ o, runId }) {
  return (
    <div className="decision">
      <span className="eyebrow">Decision</span>
      {o.call && <p><span className="tag">{CALL_LABEL[o.call]}</span><span className="tag dashed">{o.door === 'one-way' ? 'hard to undo' : 'easy to undo'}</span></p>}
      <h2 className={o.recommendation.length > 160 ? 'long' : ''}>{o.recommendation}</h2>
      <div className="next">
        <span>Next action</span>
        <strong>{o.next_action.what}</strong>
        <em>{o.next_action.owner} &middot; {o.next_action.when}</em>
      </div>
      <p><b>Goal served:</b> {o.goal_served}</p>
      {o.test && <p><b>Smallest test:</b> {o.test}</p>}
      {o.revisit_if && <p><b>Revisit if:</b> {o.revisit_if}</p>}
      {o.displaces && <p><b>Displaces:</b> {o.displaces}</p>}
      {o.rule && <RuleOffer text={o.rule} runId={runId} />}
      <List title="Why" items={o.reasons} />
      <List title="Tradeoffs" items={o.tradeoffs} />
      <List title="Cut" items={o.cuts.map(c => <><b>{c.what}</b> - {c.why}</>)} />
      <List title="Still uncertain" items={o.uncertainty} />
      <List title="Would change the answer" items={o.would_change} />
    </div>
  )
}

// A proposed if-then rule only becomes standing once the user saves it.
function RuleOffer({ text, runId }) {
  const [saved, setSaved] = useState(null)
  const save = () => api('rules', { text, from: runId }).then(r => setSaved(r.file), e => setSaved('Failed: ' + e.message))
  return (
    <div className="rule-offer">
      <p><b>Rule to reuse?</b> {text}</p>
      {saved ? <p className="sub">{saved.startsWith('Failed') ? saved : 'Saved. Future runs apply it.'}</p>
        : <button type="button" className="btn" onClick={save}>Save as standing rule</button>}
    </div>
  )
}

const List = ({ title, items }) => items?.length ? <><h3>{title}</h3><ul className="plain">{items.map((x, i) => <li key={i}>{x}</li>)}</ul></> : null

function NodeDetail({ run, n, act, setSel, setScope }) {
  const [mode, setMode] = useState(null)
  const [note, setNote] = useState('')
  const o = n.out
  const unstick = n.stuck?.explained && run.nodes[n.stuck.explained]
  const canAct = n.status === 'done' && n.kind !== 'capture'
  return (
    <div className="pane">
      <button className="back" onClick={() => setSel(null)}>&larr; Overview</button>
      <span className="eyebrow">{KIND_LABEL[n.kind]}{n.scope !== 'root' ? ' · level 2+' : ''}</span>
      <h2 className="node-title">{n.title}</h2>
      {n.status === 'superseded' && <p className="sub">An earlier pass. Something upstream changed, so this was redone.</p>}
      {n.status === 'error' && <div className="err"><p>{n.error}</p><button className="primary" onClick={() => act('rerun', { nodeId: n.id })}>Try again</button></div>}
      {(n.status === 'running' || n.status === 'queued') && <p className="status-line"><span className="spinner" />{n.status === 'running' ? 'Working on this now' : 'Waiting for earlier steps'}</p>}

      {n.status !== 'superseded' && (canAct || n.kind === 'capture') && (
        <div className="node-acts">
          {canAct && <button className="stuck-btn" onClick={() => setMode(mode === 'stuck' ? null : 'stuck')}>Stuck / don't get this</button>}
          {(canAct || n.kind === 'capture') && !n.child && n.kind !== 'unstick' && <button className="btn" onClick={() => setMode(mode === 'deeper' ? null : 'deeper')}>Go a level deeper</button>}
          {n.child && <button className="btn" onClick={() => { setScope(n.child); setSel(null) }}>Open level below &rarr;</button>}
          {canAct && <button className="btn" onClick={() => act('rerun', { nodeId: n.id })}>Redo from here</button>}
        </div>
      )}
      {mode && (
        <form className="mini" onSubmit={e => { e.preventDefault(); act(mode, mode === 'stuck' ? { nodeId: n.id, note } : { nodeId: n.id, focus: note }); setMode(null); setNote('') }}>
          <textarea autoFocus value={note} onChange={e => setNote(e.target.value)}
            placeholder={mode === 'stuck' ? "What's unclear or blocking? (optional)" : 'What should the level below focus on? (optional)'} />
          <button className={mode === 'stuck' ? 'stuck-btn solid' : 'primary'}>{mode === 'stuck' ? 'Mark stuck' : 'Open a level below'}</button>
        </form>
      )}
      {n.stuck && <div className="stuck-note"><b>You marked this stuck.</b> {n.stuck.note}{unstick?.out && <p>{unstick.out.plain}</p>}{!unstick && <p className="sub">Explaining...</p>}</div>}
      {n.childResult && <div className="child-result"><span className="eyebrow">Level below found</span><p>{n.childResult.recommendation}</p><p className="sub">Next: {n.childResult.next}</p></div>}

      {n.kind === 'ask' && n.status === 'waiting' && <AskForm n={n} act={(...a) => { setSel(null); return act(...a) }} />}
      {o && <Body run={run} n={n} act={act} setSel={setSel} />}
    </div>
  )
}

function AskForm({ n, act }) {
  const [vals, setVals] = useState({})
  const unclear = n.data.unclear
  const qs = unclear ? n.data.questions.filter(q => unclear.questions.includes(q.q)) : n.data.questions
  const send = (skip, asIs = false) => act('answer', { nodeId: n.id, skip, asIs, answers: qs.map(q => ({ q: q.q, a: vals[q.id] || '' })) })
  const first = q => unclear?.first.find(a => a.q === q.q || a.q.includes(q.q))?.a
  return (
    <form className="ask" onSubmit={e => { e.preventDefault(); send(false) }}>
      {unclear
        ? <p className="jev-note"><b>Jev couldn't use part of your answer.</b> Add a line below, keep what you said, or let it decide.</p>
        : <p className="sub">Only questions whose answer changes the result. Skip any you don't care about.</p>}
      {qs.map(q => (
        <fieldset key={q.id}>
          <legend>{q.q}{q.blocking && <span className="tag">matters most</span>}</legend>
          <p className="sub">{q.why}</p>
          {first(q) && <p className="said">You said: {first(q)}</p>}
          {q.options.length > 0 && <div className="opts">{q.options.map(op => (
            <button type="button" key={op} aria-pressed={vals[q.id] === op} onClick={() => setVals(v => ({ ...v, [q.id]: v[q.id] === op ? '' : op }))}>{op}</button>
          ))}</div>}
          <input value={vals[q.id] || ''} onChange={e => setVals(v => ({ ...v, [q.id]: e.target.value }))} placeholder="Or say it your way" />
        </fieldset>
      ))}
      <div className="row">
        <button className="primary">{unclear ? 'Add this' : 'Continue'}</button>
        {unclear && <button type="button" className="btn" onClick={() => send(false, true)}>Keep what I said</button>}
        <button type="button" className="btn" onClick={() => send(true)}>You decide</button>
      </div>
    </form>
  )
}

function Body({ run, n, act, setSel }) {
  const o = n.out
  switch (n.kind) {
    case 'capture': return <pre className="raw">{o.text}</pre>
    case 'frame': return <Frame run={run} frame={n} act={act} />
    case 'ask': return o.skipped ? <p>You let the system decide.</p> : <ul className="plain">{o.answers.map((a, i) => <li key={i}><b>{a.q}</b><br />{a.a}</li>)}</ul>
    case 'route': return <>
      <p>{o.summary}</p>
      {n.data.jev?.scored && <JevScores j={n.data.jev} picked={o.plan.map(p => p.method)} />}
      {o.plan.length === 0 && <p className="sub">No extra methods needed.</p>}
      <ul className="plain">{o.plan.map((p, i) => <li key={i}><b>{p.method}</b>: {p.focus}<div className="sub">{p.why}</div></li>)}</ul>
    </>
    case 'method': return <>
      <p className="sub">Focus: {n.data.focus}</p>
      <p>{o.summary}</p>
      {o.quadrant?.items?.length > 0 && <Quadrant q={o.quadrant} />}
      {o.matrix?.rows?.length > 0 && <Matrix m={o.matrix} />}
      {o.findings.length > 0 && <><h3>Findings <span className="sub">mark anything wrong; this branch redoes itself</span></h3><ul className="inferred">
        {o.findings.map((f, i) => <Fixable key={i} run={run} text={f.text} kind={f.kind} onFix={(original, action, text = '') => act('correct', { original, action, text, nodeId: n.id })} />)}
      </ul></>}
      <List title="Options it surfaced" items={o.options.map(x => <><b>{x.title}</b> - {x.detail}</>)} />
      <List title="Cut" items={o.cuts.map(c => <><b>{c.what}</b> - {c.why}</>)} />
      <List title="Risks" items={o.risks} />
      <List title="New unknowns" items={o.unknowns} />
    </>
    case 'narrow': return <Narrow run={run} n={n} act={act} />
    case 'converge': return <>
      <p className="restated"><span className="sub">Question now</span>{o.question}</p>
      {o.changed && <p className="sub">Changed: {o.changed}</p>}
      <Narrow run={run} n={n} act={act} />
      <h3>Gate</h3>
      <p><span className={'tag' + (o.enough ? '' : ' dashed')}>{o.enough ? 'enough to commit' : 'not enough yet'}</span> Next: <b>{o.next}</b> &middot; confidence {o.confidence.level}</p>
      {n.data.jev?.kind === 'gate' && <JevGate j={n.data.jev} />}
      <p className="sub">{o.stop_reason}</p>
    </>
    case 'develop': return <>
      <p><span className={'tag v-' + o.verdict}>{o.verdict}</span>{o.summary}</p>
      <h3>In practice</h3><p>{o.practice}</p>
      <h3>Fit to the goal</h3><p>{o.fit}</p>
      <List title="What it takes" items={o.takes} />
      <List title="Risks" items={o.risks} />
      {o.test && <><h3>Smallest test</h3><p>{o.test}</p></>}
      <List title="Variants it grew" items={o.sub_options.map(x => <><b>{x.title}</b> - {x.detail}</>)} />
    </>
    case 'assess': return <>
      <p>{o.summary}</p>
      <p><span className={'tag' + (o.enough ? '' : ' dashed')}>{o.enough ? 'enough to commit' : 'not enough yet'}</span> Confidence <b>{o.confidence.level}</b> - {o.confidence.basis}</p>
      {o.gaps.length > 0 && <table className="unknowns"><tbody>{o.gaps.map((g, i) => <tr key={i}><td>{g.text}</td><td><span className={'act a-' + g.action}>{g.action}</span></td></tr>)}</tbody></table>}
      <p className="sub">{o.stop_reason}</p>
    </>
    case 'research': return <>
      <p>{o.summary}</p>
      {!o.verified && <p className="tag dashed">not verified online</p>}
      <ul className="plain">{o.findings.map((f, i) => <li key={i}>{f.text}{f.source && <> <a href={f.source} target="_blank" rel="noreferrer">source</a></>}</li>)}</ul>
    </>
    case 'review': return <>
      <p>{o.summary}</p>
      <ul className="findings">{o.objections.map((x, i) => <li key={i} className={'sev-' + x.severity}><span className="tag">{x.severity}</span>{x.text}<div className="sub">Fix: {x.fix}</div></li>)}</ul>
      <List title="Not backed by evidence" items={o.unsupported} />
    </>
    case 'decide': return <Decision o={o} runId={run.id} />
    case 'unstick': {
      const target = run.nodes[n.data.target]
      return <>
        <p className="big">{o.plain}</p>
        <p><b>What was blocking:</b> {o.blocker}</p>
        <p><b>Now a constraint:</b> {o.constraint}</p>
        {target && target.status === 'done' && <div className="row">
          <button className="primary" onClick={() => { act('rerun', { nodeId: target.id }); setSel(null) }}>Redo "{target.title}" with this</button>
        </div>}
      </>
    }
    default: return <pre className="raw">{JSON.stringify(o, null, 2)}</pre>
  }
}

function Narrow({ run, n, act }) {
  const o = n.out
  const top = Object.fromEntries(o.top.map(t => [t.id, t.why]))
  const jev = Object.fromEntries((n.data.jev?.options || []).map(x => [x.id, x]))
  const [picks, setPicks] = useState(n.data.userPicks || [])
  const [combine, setCombine] = useState('')
  const toggle = id => setPicks(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id])
  return <>
    <p>{o.summary}</p>
    <h3>Everything considered ({o.all.length}) <span className="sub">top 3 marked; pick your own to override</span></h3>
    <ul className="options">
      {o.all.map(x => (
        <li key={x.id} className={top[x.id] ? 'top' : ''}>
          <label>
            <input type="checkbox" checked={picks.includes(x.id)} onChange={() => toggle(x.id)} />
            <span><b>{x.title}</b> {top[x.id] && <span className="tag">top 3</span>}{jev[x.id]?.breaks >= 0.7 && <span className="tag red">breaks a hard rule</span>}<br />{x.detail}{top[x.id] && <span className="sub why">Why: {top[x.id]}</span>}
              {jev[x.id] && <Meter p={jev[x.id].fit} label="fit" />}</span>
          </label>
        </li>
      ))}
    </ul>
    {o.combine && <p><b>Combination:</b> {o.combine}</p>}
    {n.status === 'done' && <div className="pickbar">
      <input value={combine} onChange={e => setCombine(e.target.value)} placeholder="Combine parts? e.g. A's speed with C's price (optional)" />
      <button className="primary" disabled={!picks.length && !combine.trim()} onClick={() => act('pick', { nodeId: n.id, picks, combine })}>Use my picks</button>
    </div>}
    {run.picks[n.scope] && <p className="sub">Your pick in effect: {run.picks[n.scope]}</p>}
  </>
}

function Meter({ p, label }) {
  return <span className="meter" title={`${label} ${Math.round(p * 100)}%`}><span className="track"><i style={{ width: `${Math.round(p * 100)}%` }} /></span><em>{label ? label + ' ' : ''}{Math.round(p * 100)}%</em></span>
}

function JevScores({ j, picked }) {
  return <div className="jev-box">
    <span className="eyebrow">Jev weighed all the methods in {(j.ms / 1000).toFixed(1)}s</span>
    {j.fallback && <p className="sub">{j.fallback}.</p>}
    <ul className="plain">{j.scored.map(s => <li key={s.id} className={picked.includes(s.id) ? '' : 'dim'}><span><b>{s.id}</b>{s.lead >= 0.1 && <span className="tag">lead {Math.round(s.lead * 100)}%</span>}</span> <Meter p={s.p} label="helps" /></li>)}</ul>
  </div>
}

const NEXT_LABEL = { commit: 'Decide now', develop: 'Grow the top options', research: 'Look things up', more: 'Try other angles', ask: 'Ask you' }

function JevGate({ j }) {
  const ps = Object.entries(j.probabilities || {}).sort((a, b) => b[1] - a[1])
  return <div className="jev-box">
    <span className="eyebrow">Jev's call &middot; {(j.ms / 1000).toFixed(1)}s</span>
    {j.next
      ? <p>{j.decidedBy === 'jev' ? <><b>{NEXT_LABEL[j.next]}</b>, {Math.round(j.confidence * 100)}% sure.</> : <>Too unsure ({Math.round(j.confidence * 100)}%), so Claude's call stood: <b>{NEXT_LABEL[j.claude.next]}</b>.</>}
        {j.decidedBy === 'jev' && j.claude.next !== j.next && <span className="sub"> Claude had said: {NEXT_LABEL[j.claude.next]}.</span>}</p>
      : <p className="sub">Only one way forward was open, so Jev just scored the options.</p>}
    {ps.length > 1 && <ul className="plain">{ps.map(([k, p]) => <li key={k}>{NEXT_LABEL[k]} <Meter p={p} label="" /></li>)}</ul>}
    {j.dropped?.length > 0 && <p className="sub">Dropped from the shortlist for breaking a hard rule: {j.dropped.length}.</p>}
  </div>
}
