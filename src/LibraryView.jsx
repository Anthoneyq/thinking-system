import { useEffect, useMemo, useRef, useState } from 'react'
import { api, go } from './api.js'

// Conversations mode: the business tree as a spider web you can step into, and one list of what it still needs from you.
const STATUS = { unsettled: 'Never settled', open: 'Open', assumed: 'Assumed', decided: 'Decided', done: 'Done' }
const ORDER = ['unsettled', 'open', 'assumed', 'decided', 'done']
const TYPE = { decision: 'Decision', open: 'Question', assumption: 'Assumption', todo: 'To do', idea: 'Idea', fact: 'Fact', preference: 'Preference' }
const pct = x => Math.round((x || 0) * 100) + '%'

function useLibrary(id) {
  const [v, setV] = useState(null)
  const [err, setErr] = useState('')
  const ver = useRef(-1)
  useEffect(() => {
    let alive = true
    const load = () => api('library/' + id).then(x => { if (alive) { ver.current = x.version; setV(x) } }).catch(e => setErr(e.message))
    load()
    const es = new EventSource(`/api/library/${id}/events`)
    es.onmessage = e => { const m = JSON.parse(e.data); if (m.version !== ver.current) load() }
    return () => { alive = false; es.close() }
  }, [id])
  return [v, err, () => api('library/' + id).then(setV)]
}

export default function LibraryView({ id }) {
  const [v, err, reload] = useLibrary(id)
  const [focus, setFocusRaw] = useState(null)
  const [selected, setSelected] = useState(null)
  const setFocus = f => { setFocusRaw(f); setSelected(null) }
  const [tab, setTab] = useState('needs')
  const [busy, setBusy] = useState('')
  const index = useMemo(() => {
    const m = new Map()
    const walk = (ns, parent, depth) => ns.forEach(n => { m.set(n.id, { ...n, parent, depth }); walk(n.children || [], n.id, depth + 1) })
    if (v) walk(v.tree.branches, null, 0)
    return m
  }, [v?.tree])
  if (err) return <div className="empty">{err}</div>
  if (!v) return <div className="empty">Loading...</div>

  const act = async (what, body = {}) => {
    setBusy(what)
    try { await api(`library/${id}/${what}`, body); await reload() } catch (e) { alert(e.message) } finally { setBusy('') }
  }
  const running = v.job?.running
  const c = v.counts
  // A branch with parts opens as its own web; one without parts is selected in place and shown in the panel.
  const pick = bid => { const n = index.get(bid); if (n?.children?.length) setFocus(bid); else { setFocusRaw(n ? n.parent : null); setSelected(bid) } setTab('branch') }

  return (
    <main className="lib">
      <header className="lib-top">
        <a className="brand" href="/" onClick={e => { e.preventDefault(); go('/') }}><i />Thinking System</a>
        <div className="lib-title">
          <h1>{v.name}</h1>
          <span className="sub">{c.calls} calls · {c.items} items · {c.filed} filed · {c.threads} topics · ${c.cost.toFixed(2)} spent</span>
        </div>
        <div className="lib-actions">
          <button className="btn" disabled={running || !!busy} onClick={() => act('scan')}>Check for new calls</button>
          {v.estimate.calls > 0 && <button className="primary" disabled={running || !!busy} onClick={() => act('process')}>Read {v.estimate.calls} new call{v.estimate.calls > 1 ? 's' : ''} (~${v.estimate.usd.toFixed(2)})</button>}
          {v.pending > 0 && <button className="primary" disabled={running || !!busy} title="Files everything you haven't confirmed again, then rewrites only the topics whose items moved" onClick={() => act('refresh')}>Update with {v.pending} change{v.pending > 1 ? 's' : ''}</button>}
        </div>
      </header>
      {v.job && (running || v.job.log.length > 0) && <Job job={v.job} onStop={() => act('stop')} />}
      <div className="lib-body">
        <section className="lib-map">
          <Crumbs index={index} focus={focus} setFocus={setFocus} name={v.name} />
          <Web v={v} index={index} focus={focus} selected={selected} setFocus={setFocus} onPick={pick} />
          <WebList v={v} index={index} focus={focus} setFocus={setFocus} onPick={pick} />
          <p className="lib-legend sub"><b className="dot red" /> questions waiting on you there <b className="dot" /> items filed there. Click a branch to step into it; click the middle to step back out.</p>
        </section>
        <aside className="lib-panel">
          <div className="seg lib-tabs" role="tablist">
            {[['needs', `Needs you${v.questions.length ? ` (${v.questions.filter(q => q.now).length || v.questions.length})` : ''}`], ['branch', 'Branch'], ['find', 'Find'], ['links', 'Applies elsewhere'], ['calls', 'Calls']].map(([k, label]) =>
              <button key={k} role="tab" aria-checked={tab === k} onClick={() => setTab(k)}>{label}</button>)}
          </div>
          {tab === 'needs' && <Needs v={v} index={index} id={id} reload={reload} onPlace={pick} />}
          {tab === 'branch' && <Branch v={v} index={index} focus={selected || focus} setFocus={pick} />}
          {tab === 'find' && <Find v={v} id={id} index={index} />}
          {tab === 'links' && <Links v={v} running={running} onRun={() => act('crosscheck')} />}
          {tab === 'calls' && <Calls v={v} />}
        </aside>
      </div>
    </main>
  )
}

function Job({ job, onStop }) {
  const [open, setOpen] = useState(false)
  const last = job.log.at(-1)
  return (
    <div className={'lib-job' + (job.running ? ' on' : '')}>
      <span className="pill s-running">{job.running ? job.stage : 'Last run'}</span>
      {job.total > 0 && job.running && <span className="sub">{job.done} of {job.total}</span>}
      <span className="lib-job-line">{last?.text}</span>
      <button className="ghost" onClick={() => setOpen(!open)}>{open ? 'Hide log' : 'Log'}</button>
      {job.running && <button className="ghost" onClick={onStop}>Stop</button>}
      {open && <ol className="lib-log">{job.log.slice().reverse().map((l, k) => <li key={k}><span className="sub">{l.t.slice(11, 19)}</span> {l.text}</li>)}</ol>}
    </div>
  )
}

function Crumbs({ index, focus, setFocus, name }) {
  const trail = []
  for (let n = index.get(focus); n; n = index.get(n.parent)) trail.unshift(n)
  return (
    <nav className="lib-crumbs">
      <button className="ghost" onClick={() => setFocus(null)}>{name}</button>
      {trail.map(n => <span key={n.id}>›<button className="ghost" onClick={() => setFocus(n.id)}>{n.name}</button></span>)}
    </nav>
  )
}

// The spider web: the focus in the middle, its branches around it, and each branch's own parts as small satellites.
function Web({ v, index, focus, selected, setFocus, onPick }) {
  const node = focus ? index.get(focus) : null
  const kids = (node ? node.children : v.tree.branches) || []
  const W = 900, H = 640, cx = W / 2, cy = H / 2
  const R = kids.length > 10 ? 250 : 220
  const stat = id => v.byBranch[id] || { items: 0, need: 0, now: 0 }
  const here = focus ? stat(focus) : { items: v.counts.filed, need: v.questions.length }
  const max = Math.max(1, ...kids.map(k => stat(k.id).items))
  return (
    <svg className="lib-web" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Business tree">
      {[0.55, 1, 1.32].map(f => <ellipse key={f} cx={cx} cy={cy} rx={R * f * 1.45} ry={R * f} className="web-ring" />)}
      {kids.map((k, i) => {
        const a = -Math.PI / 2 + (i / kids.length) * Math.PI * 2
        const x = cx + Math.cos(a) * R * 1.45, y = cy + Math.sin(a) * R
        const st = stat(k.id), need = st.need
        const r = 16 + 22 * Math.sqrt(st.items / max)
        const sub = k.children || []
        return (
          <g key={k.id} className={'web-node' + (st.items ? '' : ' empty')} onClick={() => sub.length ? setFocus(k.id) : onPick(k.id)} tabIndex={0}
            onKeyDown={e => e.key === 'Enter' && (sub.length ? setFocus(k.id) : onPick(k.id))}>
            <line x1={cx} y1={cy} x2={x} y2={y} className="web-spoke" />
            {sub.map((g, j) => {
              const b = a + ((j + 0.5) / sub.length - 0.5) * Math.min(1.1, sub.length * 0.14)
              const gx = x + Math.cos(b) * (r + 26), gy = y + Math.sin(b) * (r + 26)
              const gs = stat(g.id)
              return <g key={g.id}><line x1={x} y1={y} x2={gx} y2={gy} className="web-thread" /><circle cx={gx} cy={gy} r={gs.items ? 4.5 : 3} className={gs.need ? 'web-sat red' : gs.items ? 'web-sat on' : 'web-sat'} /></g>
            })}
            <circle cx={x} cy={y} r={r} className={'web-bubble' + (selected === k.id ? ' sel' : '')} />
            <text x={x} y={y + 4} className="web-count">{st.items || ''}</text>
            {need > 0 && <g><rect x={x + r * 0.72 - (6 + String(need).length * 3.6)} y={y - r * 0.72 - 10} width={12 + String(need).length * 7.2} height={20} rx={10} className="web-need" /><text x={x + r * 0.72} y={y - r * 0.72 + 4} className="web-need-n">{need}</text></g>}
            <text x={x} y={Math.sin(a) > 0.3 ? y - r - 10 : y + r + 18} className="web-label">{k.name}</text>
            <title>{k.name}: {st.items} items filed, {st.need} question(s) for you ({st.now} now){k.desc ? '\n' + k.desc : ''}</title>
          </g>
        )
      })}
      <g className="web-center" onClick={() => focus && setFocus(node.parent)} style={{ cursor: focus ? 'pointer' : 'default' }}>
        <ellipse cx={cx} cy={cy} rx={118} ry={66} />
        <text x={cx} y={cy - 8} className="web-center-name">{(node?.name || v.name).slice(0, 26)}</text>
        <text x={cx} y={cy + 14} className="web-center-sub">{here.items} filed · {here.need} question{here.need === 1 ? '' : 's'} for you</text>
        {focus && <text x={cx} y={cy + 34} className="web-center-sub">← step out</text>}
      </g>
    </svg>
  )
}

// On a phone the web is too small to read, so its branches also come as a plain list.
function WebList({ v, index, focus, setFocus, onPick }) {
  const node = focus ? index.get(focus) : null
  const kids = (node ? node.children : v.tree.branches) || []
  return (
    <ul className="web-list">
      {kids.map(k => { const st = v.byBranch[k.id] || {}; return (
        <li key={k.id}><button className="btn" onClick={() => k.children?.length ? setFocus(k.id) : onPick(k.id)}>
          <span>{k.name}</span><span className="sub">{st.items || 0} filed{st.need ? <b className="web-list-need"> · {st.need} for you</b> : ''}</span>
        </button></li>) })}
    </ul>
  )
}

// One question at a time: the system says what it still needs, you answer, the next one comes.
function Needs({ v, index, id, reload, onPlace }) {
  const [k, setK] = useState(0)
  const [all, setAll] = useState(false)
  const [later, setLater] = useState(false)
  const nowCount = v.questions.filter(q => q.now).length
  const qs = later || !nowCount ? v.questions.filter(q => !q.now || !nowCount) : v.questions.filter(q => q.now)
  if (!v.questions.length) return <div className="lib-done"><h3>Nothing needs you.</h3><p className="sub">Every topic is settled and every item is filed. New calls bring new questions.</p></div>
  const q = qs[Math.min(k, qs.length - 1)] || {}
  const send = async body => { await api(`library/${id}/answer`, { qid: q.id, ...body }); await reload() }
  return (
    <div className="lib-needs">
      <div className="seg lib-now" role="radiogroup">
        <button role="radio" aria-checked={!later} onClick={() => { setLater(false); setK(0) }} title="Never settled, overlaps in the tree, big filing batches, and the questions Jev says change the most">Now ({nowCount})</button>
        <button role="radio" aria-checked={later} onClick={() => { setLater(true); setK(0) }}>Later ({v.questions.length - nowCount})</button>
      </div>
      {!qs.length ? <p className="sub">Nothing here.</p> : <>
      <div className="lib-needs-bar">
        <span className="sub">{qs.length} left{all ? '' : `, showing ${Math.min(k, qs.length - 1) + 1}`}</span>
        <button className="ghost" onClick={() => setAll(!all)}>{all ? 'One at a time' : 'See the list'}</button>
      </div>
      {all
        ? <ol className="lib-qlist">{qs.map((x, j) => <li key={x.id}><button className="ghost" onClick={() => { setK(j); setAll(false) }}>
            <span className={'tag' + (x.kind !== 'thread' ? ' dashed' : x.status === 'unsettled' ? ' red' : '')}>{x.kind === 'thread' ? STATUS[x.status] : x.kind === 'group' ? `Where? ${x.items.length}` : x.kind === 'tree' ? 'Tree' : 'Where?'}</span>{x.q}</button></li>)}</ol>
        : q.kind === 'thread' ? <ThreadQ key={q.id} q={q} v={v} send={send} skip={() => send({ skip: true })} />
        : q.kind === 'group' ? <GroupQ key={q.id + q.items.length} q={q} id={id} index={index} reload={reload} />
        : q.kind === 'tree' ? <TreeQ key={q.id} q={q} send={send} skip={() => send({ skip: true })} />
        : <PlaceQ key={q.id} q={q} v={v} index={index} send={send} skip={() => send({ skip: true })} onPlace={onPlace} />}
      </>}
    </div>
  )
}

function ThreadQ({ q, v, send, skip }) {
  const [a, setA] = useState('')
  const [ev, setEv] = useState(false)
  const t = v.threads[q.thread]
  return (
    <div className="lib-q">
      <span className={'tag' + (q.status === 'unsettled' ? ' red' : '')}>{STATUS[q.status]}</span><span className="sub">{q.where}</span>
      <h3>{q.q}</h3>
      <p className="sub">{q.why}</p>
      <p className="lib-sum"><b>{t.title}.</b> {t.summary}</p>
      {q.ways?.length > 0 && <div className="lib-ways"><span className="sub">The ways it was talked about</span><ul>{q.ways.map((w, j) => <li key={j}>{w}</li>)}</ul></div>}
      {q.options?.length > 0 && <div className="lib-opts">{q.options.map(o => <button key={o} className={'btn' + (a === o ? ' on' : '')} onClick={() => setA(o)}>{o}</button>)}</div>}
      <textarea value={a} onChange={e => setA(e.target.value)} placeholder="Your answer, in your words. It becomes the decision on this topic." rows={3} />
      <div className="lib-q-bar">
        <button className="primary" disabled={!a.trim()} onClick={() => send({ text: a })}>Save decision</button>
        <button className="ghost" onClick={skip}>Skip for now</button>
        <button className="ghost" onClick={() => setEv(!ev)}>{ev ? 'Hide' : 'Show'} what was said ({t.items.length})</button>
      </div>
      {ev && <Items ids={t.items} v={v} />}
    </div>
  )
}

// Two branches keep catching the same items: merge them, or say how they differ.
function TreeQ({ q, send, skip }) {
  const [d, setD] = useState({ [q.a.id]: q.a.desc, [q.b.id]: q.b.desc })
  const last = x => x.name.split(' › ').at(-1)
  return (
    <div className="lib-q">
      <span className="tag red">The tree has an overlap</span><span className="sub">One answer sharpens every filing</span>
      <h3>{q.q}</h3>
      <p className="sub">For example:</p>
      <ul className="lib-ways">{q.examples.map((e, k) => <li key={k}>{e}</li>)}</ul>
      <div className="lib-place">
        <button className="btn" onClick={() => send({ merge: q.a.id })}>Same thing: keep {last(q.a)}</button>
        <button className="btn" onClick={() => send({ merge: q.b.id })}>Same thing: keep {last(q.b)}</button>
      </div>
      <p className="sub">Or say what belongs in each:</p>
      {[q.a, q.b].map(x => <label key={x.id} className="lib-desc"><b>{x.name}</b><textarea rows={2} value={d[x.id]} onChange={e => setD({ ...d, [x.id]: e.target.value })} /></label>)}
      <div className="lib-q-bar">
        <button className="primary" onClick={() => send({ describe: d })}>Save how they differ</button>
        <button className="ghost" onClick={skip}>Skip for now</button>
      </div>
    </div>
  )
}

// Many alike items, one click: untick any that don't fit, confirm the rest or move them together.
function GroupQ({ q, id, index, reload }) {
  const [off, setOff] = useState(new Set())
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState(false)
  const on = q.items.filter(i => !off.has(i.id)).map(i => i.id)
  const flip = x => setOff(o => { const n = new Set(o); n.has(x) ? n.delete(x) : n.add(x); return n })
  const run = async fn => { setBusy(true); try { await fn(); await reload() } finally { setBusy(false) } }
  const options = [...index.values()].map(n => ({ id: n.id, label: `${'  '.repeat(n.depth)}${n.name}` }))
  return (
    <div className="lib-q">
      <span className="tag dashed">{q.finer ? 'One level in?' : 'Where do these belong?'}</span><span className="sub">{q.finer ? 'Already filed one level up; this only sharpens it' : `Under the ${Math.round(0.95 * 100)}% bar`}</span>
      <h3>{q.q}</h3>
      <ul className="lib-group">
        {q.items.map(i => (
          <li key={i.id}><label>
            <input type="checkbox" checked={!off.has(i.id)} onChange={() => flip(i.id)} />
            <span>{i.text} <span className="sub">{pct(i.conf)}{i.why && !i.why.includes('% sure') ? ` · ${i.why}` : ''} · {i.file}{i.at ? ' ' + i.at : ''}</span></span>
          </label></li>
        ))}
      </ul>
      <div className="lib-q-bar">
        <button className="primary" disabled={!on.length || busy} onClick={() => run(() => api(`library/${id}/confirm`, { items: on }))}>Yes, {on.length} belong in {q.name.split(' › ').at(-1)}</button>
        <button className="ghost" disabled={busy} onClick={() => run(() => api(`library/${id}/answer`, { qid: q.id, skip: true, items: q.items.map(i => i.id) }))}>Skip for now</button>
      </div>
      <div className="lib-q-bar">
        <select value={to} onChange={e => setTo(e.target.value)}><option value="">…or move the ticked ones to</option><option value="none">Not this business</option>{options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        <button className="btn" disabled={!to || !on.length || busy} onClick={() => run(async () => { for (const x of on) await api(`library/${id}/answer`, { qid: 'i:' + x, branch: to }) })}>Move {on.length}</button>
      </div>
    </div>
  )
}

function PlaceQ({ q, v, index, send, skip }) {
  const [other, setOther] = useState('')
  const [fresh, setFresh] = useState({ name: q.newBranch || '', parent: index.get(q.guess)?.parent || q.guess })
  const [mode, setMode] = useState('')
  const options = [...index.values()].map(n => ({ id: n.id, label: `${'  '.repeat(n.depth)}${n.name}` }))
  return (
    <div className="lib-q">
      <span className="tag dashed">Where does this belong?</span><span className="sub">{q.why}</span>
      <h3>{q.q}</h3>
      {q.context && <p className="sub">{q.context}</p>}
      {q.quote && <blockquote>“{q.quote}”<cite>{v.calls.find(c => c.id === q.call)?.file} {q.at}</cite></blockquote>}
      <div className="lib-place">
        <button className="primary" onClick={() => send({ branch: q.guess })}>Yes: {q.guessName} <span className="sub-on">{pct(q.conf)}</span></button>
        {q.alts.filter(a => a.branch !== q.guess).map(a => <button key={a.branch} className="btn" onClick={() => send({ branch: a.branch })}>{a.name} <span className="sub">{pct(a.p)}{a.by === 'claude' ? ' Claude' : ''}</span></button>)}
        <button className="btn" onClick={() => send({ branch: 'none' })}>Not this business</button>
        <button className="ghost" onClick={() => setMode(mode === 'pick' ? '' : 'pick')}>Somewhere else…</button>
        <button className="ghost" onClick={() => setMode(mode === 'new' ? '' : 'new')}>New branch…</button>
        <button className="ghost" onClick={skip}>Skip for now</button>
      </div>
      {mode === 'pick' && <div className="lib-q-bar"><select value={other} onChange={e => setOther(e.target.value)}><option value="">Pick a branch</option>{options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>
        <button className="primary" disabled={!other} onClick={() => send({ branch: other })}>File it here</button></div>}
      {mode === 'new' && <div className="lib-q-bar"><input value={fresh.name} onChange={e => setFresh({ ...fresh, name: e.target.value })} placeholder="New branch name" />
        <select value={fresh.parent} onChange={e => setFresh({ ...fresh, parent: e.target.value })}>{options.map(o => <option key={o.id} value={o.id}>under {o.label.trim()}</option>)}</select>
        <button className="primary" disabled={!fresh.name.trim()} onClick={() => send({ newBranch: fresh })}>Add and file</button></div>}
    </div>
  )
}

function Items({ ids, v }) {
  return (
    <ul className="lib-items">
      {ids.map(x => v.items[x]).filter(Boolean).sort((a, b) => b.date.localeCompare(a.date)).map(i => (
        <li key={i.id}>
          <span className="tag dashed">{TYPE[i.type]}</span><span className="sub">{i.date}{i.who ? ' · ' + i.who : ''}</span>
          <p>{i.text}</p>
          {i.quote && <blockquote>“{i.quote}”<cite>{i.file}{i.at ? ' at ' + i.at : ''}</cite></blockquote>}
        </li>
      ))}
    </ul>
  )
}

function Branch({ v, index, focus, setFocus }) {
  const [open, setOpen] = useState(null)
  const under = id => id === focus || !focus || id.startsWith(focus + '.')
  const ts = Object.values(v.threads).filter(t => under(t.branch))
  const node = focus ? index.get(focus) : null
  const loose = Object.values(v.items).filter(i => i.filed && i.branch !== 'none' && under(i.branch) && !Object.values(v.threads).some(t => t.items.includes(i.id)))
  return (
    <div className="lib-branch">
      <h3>{node?.name || v.name}</h3>
      {node?.desc && <p className="sub">{node.desc}</p>}
      {node?.children?.length > 0 && <div className="lib-chips">{node.children.map(ch => <button key={ch.id} className="btn" onClick={() => setFocus(ch.id)}>{ch.name} <span className="sub">{v.byBranch[ch.id]?.items || 0}</span></button>)}</div>}
      {!ts.length && <p className="sub">No topics here yet.</p>}
      {ORDER.map(st => {
        const list = ts.filter(t => t.status === st).sort((a, b) => (b.last || '').localeCompare(a.last || ''))
        if (!list.length) return null
        return (
          <section key={st}>
            <h4>{STATUS[st]} <span className="sub">{list.length}</span></h4>
            {list.map(t => (
              <article key={t.id} className={'lib-thread' + (open === t.id ? ' open' : '')}>
                <button className="lib-thread-head" onClick={() => setOpen(open === t.id ? null : t.id)}>
                  <b>{t.title}</b><span className="sub">{t.first === t.last ? t.last : `${t.first} → ${t.last}`} · {t.items.length} said{t.unconfirmed ? ` · ${t.unconfirmed} not yet confirmed where they belong` : ''}</span>
                </button>
                <p>{t.summary}</p>
                {t.decision && <p className="lib-decision"><b>Decision{t.answeredBy ? ' (yours)' : ''}:</b> {t.decision}</p>}
                {open === t.id && <>{t.ways?.length > 0 && <ul className="lib-ways">{t.ways.map((w, j) => <li key={j}>{w}</li>)}</ul>}<Items ids={t.items} v={v} /></>}
              </article>
            ))}
          </section>
        )
      })}
      {loose.length > 0 && <section><h4>Filed, not yet in a topic <span className="sub">{loose.length}</span></h4><Items ids={loose.map(i => i.id)} v={v} /></section>}
    </div>
  )
}

function Find({ v, id }) {
  const [q, setQ] = useState('')
  const [res, setRes] = useState(null)
  const [sense, setSense] = useState(null)
  const [answer, setAnswer] = useState(null)
  const [busy, setBusy] = useState(false)
  const find = async () => { if (!q.trim()) return; setSense(null); setAnswer(null); setRes(await api(`library/${id}/search?q=${encodeURIComponent(q)}`)) }
  const askIt = async () => { setBusy(true); try { setAnswer(await api(`library/${id}/ask`, { question: q })) } catch (e) { setAnswer({ answer: e.message, cites: [], gaps: [] }) } finally { setBusy(false) } }
  const shown = res ? (sense ? res.items.filter(i => res.senses.find(s => s.sense === sense).ids.includes(i.id)) : res.items) : []
  return (
    <div className="lib-find">
      <div className="lib-q-bar">
        <input value={q} onChange={e => setQ(e.target.value)} onKeyDown={e => e.key === 'Enter' && find()} placeholder="Where did we talk about… (e.g. ceiling, fee schedule, a client name)" />
        <button className="btn" onClick={find}>Find</button>
        <button className="primary" disabled={!q.trim() || busy} onClick={askIt}>{busy ? 'Reading…' : 'Ask'}</button>
      </div>
      {answer && <div className="lib-answer"><p>{answer.answer}</p>{answer.gaps?.length > 0 && <p className="sub">Not settled by the record: {answer.gaps.join('; ')}</p>}
        {answer.cites?.length > 0 && <Items ids={answer.cites.filter(c => v.items[c])} v={v} />}</div>}
      {res && <>
        {res.senses.length > 1 && <div className="lib-chips"><span className="sub">Used in {res.senses.length} senses:</span>{res.senses.map(s => <button key={s.sense} className={'btn' + (sense === s.sense ? ' on' : '')} onClick={() => setSense(sense === s.sense ? null : s.sense)}>{s.sense} <span className="sub">{s.ids.length}</span></button>)}</div>}
        {!sense && res.threads.length > 0 && <section><h4>Topics</h4>{res.threads.map(t => <article key={t.id} className="lib-thread"><b>{t.title}</b> <span className="tag dashed">{STATUS[t.status]}</span><p className="sub">{t.where}</p><p>{t.summary}</p></article>)}</section>}
        <section><h4>Said <span className="sub">{shown.length}</span></h4><Items ids={shown.map(i => i.id)} v={v} /></section>
      </>}
    </div>
  )
}

function Links({ v, running, onRun }) {
  return (
    <div className="lib-links">
      <p className="sub">Looks across every branch for something worked out in one place that applies somewhere else. Runs on Opus; a few dollars at most. Run it weekly or after a batch of calls.</p>
      <button className="primary" disabled={running || !v.counts.threads} onClick={onRun}>Cross-check everything</button>
      {v.crosslinks.length === 0 ? <p className="sub">No cross-check yet.</p> : v.crosslinks.map(l => (
        <article key={l.id} className="lib-thread">
          <b>{l.fromName} → {l.toName}</b> <span className={'tag' + (l.strength === 'strong' ? '' : ' dashed')}>{l.strength}</span>
          <p>{l.idea}</p><p className="sub">First step: {l.action}</p>
        </article>
      ))}
    </div>
  )
}

function Calls({ v }) {
  return (
    <ul className="lib-calls">
      {v.calls.map(c => (
        <li key={c.id}>
          <div><b>{c.title || c.file}</b> <span className={'pill s-' + (c.status === 'done' ? 'done' : c.status === 'error' ? 'error' : 'paused')}>{c.status === 'dup' ? 'duplicate' : c.status}</span></div>
          <span className="sub">{c.date}{c.speakers?.length ? ' · ' + c.speakers.join(', ') : ''}{c.items ? ` · ${c.items} items` : ''}</span>
          {c.dupOf && <p className="sub">Same words as {c.dupOf}; skipped.</p>}
          {c.error && <p className="error-line">{c.error}</p>}
          {c.summary && <p>{c.summary}</p>}
        </li>
      ))}
    </ul>
  )
}
