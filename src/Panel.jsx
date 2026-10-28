import { useEffect, useRef, useState } from 'react'
import { KIND_LABEL } from './api.js'

const latest = (run, scope, kind) => run.order.map(i => run.nodes[i]).filter(n => n.scope === scope && n.kind === kind && n.status === 'done').at(-1)

export default function Panel({ run, node, scope, act, setSel, setScope }) {
  // Back to the top whenever the subject changes or a decision lands.
  const ref = useRef(null)
  const decided = latest(run, scope, 'decide')?.id
  useEffect(() => { ref.current?.scrollTo({ top: 0 }) }, [node?.id, scope, decided])
  return (
    <aside className="panel" ref={ref}>
      {node ? <NodeDetail key={node.id} run={run} n={node} act={act} setSel={setSel} setScope={setScope} /> : <Overview run={run} scope={scope} act={act} setSel={setSel} />}
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
      {decide && <Decision o={decide.out} />}
      <Trail run={run} scope={scope} setSel={setSel} />
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
  const corr = Object.fromEntries(run.corrections.map(c => [c.original, c]))
  const [editing, setEditing] = useState(null)
  const [text, setText] = useState('')
  const fix = (original, action, t = '') => { setEditing(null); act('correct', { original, action, text: t, frameId: frame.id }) }
  return (
    <div className="frame">
      <h3>Goal <Source s={f.goal.source} /></h3>
      <p className="goal">{f.goal.text}</p>

      <h3>You said</h3>
      <ul className="chips stated">{f.stated.map((s, i) => <li key={i}>{s}</li>)}</ul>

      <h3>I inferred <span className="sub">correct anything wrong; the flow redoes itself</span></h3>
      <ul className="inferred">
        {[{ text: f.goal.text, why: 'Goal', goal: true }].filter(() => f.goal.source === 'inferred').concat(f.inferred).map((x, i) => {
          const c = corr[x.text]
          return (
            <li key={i} className={c ? 'c-' + c.action : ''}>
              <div className="inf-text">{x.goal && <b>Goal: </b>}{x.text}{c?.action === 'edit' && <span className="edit-to"> &rarr; {c.text}</span>}</div>
              <div className="inf-why">{x.why}</div>
              {editing === i ? (
                <form className="inf-edit" onSubmit={e => { e.preventDefault(); text.trim() && fix(x.text, 'edit', text) }}>
                  <input autoFocus value={text} onChange={e => setText(e.target.value)} placeholder="What's actually true?" />
                  <button className="primary">Save</button><button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
                </form>
              ) : !c && (
                <div className="inf-acts">
                  <button onClick={() => fix(x.text, 'confirm')}>Right</button>
                  <button onClick={() => fix(x.text, 'reject')}>Wrong</button>
                  <button onClick={() => { setEditing(i); setText('') }}>Change</button>
                </div>
              )}
            </li>
          )
        })}
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

const Source = ({ s }) => <span className={'tag' + (s === 'stated' ? '' : ' dashed')}>{s}</span>

function Decision({ o }) {
  return (
    <div className="decision">
      <span className="eyebrow">Decision</span>
      <h2 className={o.recommendation.length > 160 ? 'long' : ''}>{o.recommendation}</h2>
      <div className="next">
        <span>Next action</span>
        <strong>{o.next_action.what}</strong>
        <em>{o.next_action.owner} &middot; {o.next_action.when}</em>
      </div>
      <p><b>Goal served:</b> {o.goal_served}</p>
      {o.test && <p><b>Smallest test:</b> {o.test}</p>}
      <List title="Why" items={o.reasons} />
      <List title="Tradeoffs" items={o.tradeoffs} />
      <List title="Cut" items={o.cuts.map(c => <><b>{c.what}</b> - {c.why}</>)} />
      <List title="Still uncertain" items={o.uncertainty} />
      <List title="Would change the answer" items={o.would_change} />
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
      {o.findings.length > 0 && <><h3>Findings</h3><ul className="findings">{o.findings.map((f, i) => <li key={i} className={'f-' + f.kind}><span className="tag">{f.kind}</span>{f.text}</li>)}</ul></>}
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
    </>
    case 'decide': return <Decision o={o} />
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
