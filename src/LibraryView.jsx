import { useEffect, useMemo, useRef, useState } from 'react'
import { api, go } from './api.js'
import Theme from './Theme.jsx'
import { questionsInBranch } from '../shared/library-questions.js'

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
  const setFocus = f => { setFocusRaw(f); setSelected(null); setTab('needs') }
  const [tab, setTab] = useState('needs')
  const [link, setLink] = useState(null)
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
  const pick = bid => { const n = index.get(bid); if (n?.children?.length) setFocus(bid); else { setFocusRaw(n ? n.parent : null); setSelected(bid) } setTab('needs') }

  const scope = selected || focus
  const scopedQuestions = questionsInBranch(v.questions, v.threads, index, scope)

  return (
    <main className="lib">
      <header className="lib-top">
        {!v.member && <a className="brand" href="/" onClick={e => { e.preventDefault(); go('/') }}><i />Thinking System</a>}
        <div className="lib-title">
          <h1>{v.name}</h1>
          <span className="sub">{c.calls} calls · {c.items} items · {c.filed} filed · {c.guessed} best guesses · {c.links} links · {c.threads} topics · ${c.cost.toFixed(2)} spent</span>
        </div>
        <div className="lib-actions">
          {v.member && !v.ai?.loggedIn && <ConnectAI v={v} act={act} busy={busy} />}
          {v.sync && <Sync v={v} busy={busy} act={act} />}
          {!v.member && <>
          <button className="btn" disabled={running || !!busy} onClick={() => act('scan')}>Check for new transcripts</button>
          {v.estimate.calls > 0 && <button className="primary" disabled={running || !!busy} onClick={() => act('process')}>Read {v.estimate.calls} new transcript{v.estimate.calls > 1 ? 's' : ''} (~${v.estimate.usd.toFixed(2)})</button>}
          {v.pending > 0 && <button className="primary" disabled={running || !!busy} title="Places everything not yet filed again with your answers as examples, then rewrites only the topics whose items moved" onClick={() => act('refresh')}>Update with {v.pending} change{v.pending > 1 ? 's' : ''}</button>}
          </>}
          <Theme />
        </div>
      </header>
      {v.job && (running || v.job.log.length > 0) && <Job job={v.job} onStop={() => act('stop')} />}
      <div className="lib-body">
        <section className="lib-map">
          <Crumbs index={index} focus={focus} setFocus={setFocus} name={v.name} />
          <Web v={v} index={index} focus={focus} selected={selected} setFocus={setFocus} onPick={pick} link={link} onLink={l => { setLink(l); setTab('link') }} />
          <WebList v={v} index={index} focus={focus} setFocus={setFocus} onPick={pick} />
          <p className="lib-legend sub"><b className="dot red" /> questions waiting on you there <b className="dot" /> items that live there <b className="line" /> items that touch both branches. Click a branch to step into it; click the middle to step back out.</p>
        </section>
        <aside className="lib-panel">
          <div className="seg lib-tabs" role="tablist">
            {[['needs', `Needs you${scopedQuestions.length ? ` (${scopedQuestions.length})` : ''}`], ['branch', 'Branch'], ...(link ? [['link', 'Connection']] : []), ['cats', `Categories${v.proposals?.length ? ` (${v.proposals.length} proposed)` : ''}`], ['find', 'Find'], ['links', 'Applies elsewhere'], ['calls', 'Transcripts'], ...(v.sync || v.log?.length ? [['changes', 'Changes']] : [])].map(([k, label]) =>
              <button key={k} role="tab" aria-checked={tab === k} onClick={() => setTab(k)}>{label}</button>)}
          </div>
          {tab === 'needs' && <Needs key={scope || 'all'} v={v} questions={scopedQuestions} scope={scope} onAll={() => setFocus(null)} index={index} id={id} reload={reload} onPlace={pick} />}
          {tab === 'branch' && <Branch v={v} index={index} focus={selected || focus} setFocus={pick} edit={body => act('change', body)} />}
          {tab === 'find' && <Find v={v} id={id} index={index} />}
          {tab === 'links' && <Links v={v} running={running} onRun={() => act('crosscheck')} />}
          {tab === 'calls' && <Calls v={v} />}
          {tab === 'changes' && <Changes v={v} />}
          {tab === 'link' && link && <Connection v={v} index={index} link={link} onClose={() => { setLink(null); setTab('branch') }} />}
          {tab === 'cats' && <Categories v={v} index={index} act={act} busy={busy} onPick={pick} />}
        </aside>
      </div>
    </main>
  )
}

// Shared through GitHub: what is waiting to send, the last sync, and adding calls for the reader to read.
function Sync({ v, busy, act }) {
  const file = useRef(null)
  const add = async e => {
    const files = await Promise.all([...e.target.files].map(f => new Promise(res => { const r = new FileReader(); r.onload = () => res({ name: f.name, data: r.result.split(',')[1] }); r.readAsDataURL(f) })))
    e.target.value = ''
    if (files.length) act('upload', { files })
  }
  const y = v.sync
  return <>
    <span className={'lib-sync sub' + (y.error ? ' err' : '')} title={y.error || `Shared through ${y.repo}`}>
      {y.error ? 'Offline: changes wait here' : y.waiting ? `${y.waiting} waiting to send` : y.last ? `Synced ${new Date(y.last).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Not synced yet'} · {v.me}
    </span>
    <button className="ghost" disabled={!!busy} onClick={() => act('sync')}>Sync now</button>
    <button className="btn" disabled={!!busy} onClick={() => file.current.click()} title="Scrubbed transcripts (.vtt, .docx, .md, .txt). With your AI connected they're read on this computer; otherwise on the next update.">Add transcripts</button>
    <input ref={file} type="file" multiple accept=".vtt,.docx,.md,.txt" hidden onChange={add} />
  </>
}

// A teammate's own AI (Claude Code on their plan) reads what they add. One click opens a window that installs it and signs in.
function ConnectAI({ v, act, busy }) {
  const [started, setStarted] = useState(false)
  useEffect(() => { if (!started) return; const t = setInterval(() => act('aicheck'), 6000); return () => clearInterval(t) }, [started])
  return (
    <span className="lib-ai">
      {started && <span className="sub">Finish in the window that opened. This updates by itself when you're signed in.</span>}
      <button className="primary" disabled={!!busy} onClick={() => { setStarted(true); act('connect') }} title="Installs Claude on this computer if needed and signs you in, so the transcripts you add are read with your AI">
        {started ? 'Open the window again' : 'Connect your AI'}</button>
    </span>
  )
}

// What links two branches: items that live under one and touch the other.
function Connection({ v, index, link, onClose }) {
  const under = (id, top) => id === top || id.startsWith(top + '.')
  const ids = Object.values(v.items).filter(i => !i.dup && i.links?.length && ((under(i.branch, link.a) && i.links.some(l => under(l, link.b))) || (under(i.branch, link.b) && i.links.some(l => under(l, link.a))))).map(i => i.id)
  const name = id => index.get(id)?.name || id
  return (
    <div className="lib-branch">
      <div className="lib-branch-head"><h3>{name(link.a)} ↔ {name(link.b)}</h3><button className="ghost" onClick={onClose}>Close</button></div>
      <p className="sub">{ids.length} item{ids.length === 1 ? '' : 's'} live in one and touch the other.</p>
      <Items ids={ids} v={v} />
    </div>
  )
}

// The tree's categories, and the ones the readers say are missing. Add a proposal and its items move in.
function Categories({ v, index, act, busy, onPick }) {
  const [open, setOpen] = useState(null)
  const [show, setShow] = useState('proposed')
  const [edit, setEdit] = useState({})
  const props = v.proposals || []
  const canSuggest = !v.member || v.ai?.loggedIn
  const top = [...index.values()]
  return (
    <div className="lib-cats">
      <div className="seg lib-now" role="radiogroup">
        <button role="radio" aria-checked={show === 'proposed'} onClick={() => setShow('proposed')}>Proposed ({props.length})</button>
        <button role="radio" aria-checked={show === 'all'} onClick={() => setShow('all')}>All categories ({index.size})</button>
      </div>
      {show === 'proposed' ? <section>
        <p className="sub">Where filing keeps struggling, the readers name the category that should exist. Add one and its items move in; tidy names and where it goes first.</p>
        {canSuggest && <button className="btn" disabled={!!busy} onClick={() => act('suggest')}>{busy === 'suggest' ? 'Thinking…' : 'Suggest more with AI'}</button>}
        {!props.length && <p className="sub">Nothing proposed right now.</p>}
        {props.map(p => {
          const e = edit[p.key] || { name: p.name, parent: p.parent, desc: p.desc || '' }
          const set = x => setEdit({ ...edit, [p.key]: { ...e, ...x } })
          return (
            <article key={p.key} className={'lib-prop' + (open === p.key ? ' open' : '')}>
              <div className="lib-prop-head"><b>{p.name}</b><span className="sub">under {p.where} · {p.items.length} item{p.items.length === 1 ? '' : 's'}{p.from === 'ai' ? ' · AI' : ''}</span>
                <button className="ghost" onClick={() => setOpen(open === p.key ? null : p.key)}>{open === p.key ? 'Hide' : 'Look'}</button></div>
              {p.why && <p className="sub">{p.why}</p>}
              {open === p.key && <>
                <div className="lib-edit">
                  <input value={e.name} onChange={x => set({ name: x.target.value })} />
                  <select value={e.parent} onChange={x => set({ parent: x.target.value })}><option value="">Top level</option>{top.map(n => <option key={n.id} value={n.id}>{'  '.repeat(n.depth)}{n.name}</option>)}</select>
                  <textarea rows={2} value={e.desc} onChange={x => set({ desc: x.target.value })} placeholder="What belongs here (this steers filing)" />
                  <div className="lib-q-bar">
                    <button className="primary" disabled={!e.name.trim() || !!busy} onClick={() => act('change', { kind: 'addBranch', parent: e.parent, name: e.name.trim(), desc: e.desc, items: p.items, key: p.key })}>Add category</button>
                    <button className="ghost" disabled={!!busy} onClick={() => act('change', { kind: 'dismissProposal', key: p.key, name: p.name })}>Not needed</button>
                  </div>
                </div>
                <Items ids={p.items} v={v} />
              </>}
            </article>
          )
        })}
      </section> : <section>
        <p className="sub">Click one to open it. To rename, describe or add a part, use Edit and Add a part on its Branch page.</p>
        <ul className="lib-tree-list">{top.map(n => <li key={n.id}><button className="ghost" style={{ paddingLeft: 8 + n.depth * 16 }} onClick={() => onPick(n.id)}>{n.name}</button><span className="sub">{v.byBranch[n.id]?.items || 0}</span></li>)}</ul>
      </section>}
    </div>
  )
}

// Who changed what, newest first, with what was there before.
function Changes({ v }) {
  const [who, setWho] = useState('')
  const people = [...new Set(v.log.map(c => c.by))]
  const list = v.log.filter(c => !who || c.by === who)
  return (
    <div className="lib-changes">
      {people.length > 1 && <div className="lib-chips">{people.map(p => <button key={p} className={'btn' + (who === p ? ' on' : '')} onClick={() => setWho(who === p ? '' : p)}>{p}</button>)}</div>}
      {!list.length && <p className="sub">No changes yet. Answers, topic and branch edits, and added calls show here with who made them.</p>}
      <ol className="lib-log-list">{list.map(c => (
        <li key={c.id}>
          <div><b>{c.by}</b> <span className="sub">{new Date(c.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>{c.error && <span className="tag red" title={c.error}>not applied</span>}</div>
          <p>{c.what || c.kind}</p>
          {(c.before || c.after) && <div className="lib-diff">{c.before && <del>{c.before}</del>}{c.after && <ins>{c.after}</ins>}</div>}
        </li>))}</ol>
    </div>
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
function Web({ v, index, focus, selected, setFocus, onPick, link, onLink }) {
  const [hover, setHover] = useState(-1)
  const [every, setEvery] = useState(false)
  const node = focus ? index.get(focus) : null
  const kids = (node ? node.children : v.tree.branches) || []
  const W = 900, H = 640, cx = W / 2, cy = H / 2
  const R = kids.length > 10 ? 250 : 220
  const stat = id => v.byBranch[id] || { items: 0, need: 0, now: 0 }
  const here = focus ? stat(focus) : { items: v.counts.filed + v.counts.guessed, need: v.questions.length }
  const max = Math.max(1, ...kids.map(k => stat(k.id).items))
  const pos = kids.map((k, i) => { const a = -Math.PI / 2 + (i / kids.length) * Math.PI * 2; return { a, x: cx + Math.cos(a) * R * 1.45, y: cy + Math.sin(a) * R } })
  // Items that live under one branch here and touch another: drawn as threads between the two.
  const kidOf = id => { for (let n = index.get(id); n; n = index.get(n.parent)) if ((n.parent || null) === (focus || null)) return kids.findIndex(k => k.id === n.id); return -1 }
  const pairs = {}
  for (const i of Object.values(v.items)) for (const l of i.links || []) {
    const a = kidOf(i.branch), b = kidOf(l)
    if (a < 0 || b < 0 || a === b) continue
    const key = Math.min(a, b) + '|' + Math.max(a, b)
    pairs[key] = (pairs[key] || 0) + 1
  }
  const links = Object.entries(pairs).sort((x, y) => y[1] - x[1]).slice(0, every ? 999 : 18)
  const most = Math.max(1, ...links.map(l => l[1]))
  return (
    <>
    {Object.keys(pairs).length > 18 && <div className="lib-map-bar"><span className="sub">Click a line to see what connects two branches; point at a branch to light up its lines.</span>
      <button className="ghost" onClick={() => setEvery(!every)}>{every ? 'Strongest links only' : `Show all ${Object.keys(pairs).length} links`}</button></div>}
    <svg className="lib-web" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Business tree">
      {[0.55, 1, 1.32].map(f => <ellipse key={f} cx={cx} cy={cy} rx={R * f * 1.45} ry={R * f} className="web-ring" />)}
      {links.map(([key, n]) => {
        const [a, b] = key.split('|').map(Number), p = pos[a], q = pos[b]
        const mx = cx + ((p.x + q.x) / 2 - cx) * 0.35, my = cy + ((p.y + q.y) / 2 - cy) * 0.35
        const on = link && [kids[a].id, kids[b].id].sort().join('|') === [link.a, link.b].sort().join('|')
        const d = `M${p.x},${p.y} Q${mx},${my} ${q.x},${q.y}`
        // A wide invisible line on top, so a thin link is still easy to click.
        return <g key={key} className="web-link-g" onClick={() => onLink({ a: kids[a].id, b: kids[b].id })}>
          <path d={d} className={'web-link' + (on ? ' on' : hover >= 0 && hover !== a && hover !== b ? ' dim' : '')} style={{ strokeWidth: 2 + 7 * Math.sqrt(n / most), opacity: 0.25 + 0.6 * n / most }} />
          <path d={d} className="web-hit"><title>{n} item(s) touch both {kids[a].name} and {kids[b].name}. Click to see them.</title></path>
        </g>
      })}
      {kids.map((k, i) => {
        const { a, x, y } = pos[i]
        const st = stat(k.id), need = st.need
        const r = 16 + 22 * Math.sqrt(st.items / max)
        const sub = k.children || []
        return (
          <g key={k.id} className={'web-node' + (st.items ? '' : ' empty')} onClick={() => sub.length ? setFocus(k.id) : onPick(k.id)} tabIndex={0} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)}
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
            <title>{k.name}: {st.items} items ({st.filed || 0} filed), {st.need} question(s) for you ({st.now} now){k.desc ? '\n' + k.desc : ''}</title>
          </g>
        )
      })}
      <g className="web-center" onClick={() => focus && setFocus(node.parent)} style={{ cursor: focus ? 'pointer' : 'default' }}>
        <ellipse cx={cx} cy={cy} rx={118} ry={66} />
        <text x={cx} y={cy - 8} className="web-center-name">{(node?.name || v.name).slice(0, 26)}</text>
        <text x={cx} y={cy + 14} className="web-center-sub">{here.items} items · {here.need} question{here.need === 1 ? '' : 's'} for you</text>
        {focus && <text x={cx} y={cy + 34} className="web-center-sub">← step out</text>}
      </g>
    </svg>
    </>
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
          <span>{k.name}</span><span className="sub">{st.items || 0} items{st.need ? <b className="web-list-need"> · {st.need} for you</b> : ''}</span>
        </button></li>) })}
    </ul>
  )
}

const claimed = new Map()

// One question at a time: the system says what it still needs, you answer, the next one comes.
function Needs({ v, questions, scope, onAll, index, id, reload, onPlace }) {
  const [k, setK] = useState(0)
  const [all, setAll] = useState(false)
  const [later, setLater] = useState(false)
  const nowCount = questions.filter(q => q.now).length
  const qs = questions.filter(q => later ? !q.now : q.now)
  const q = qs[Math.min(k, qs.length - 1)] || {}
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const send = async body => {
    setBusy(true); setError('')
    try { await api(`library/${id}/answer`, { qid: q.id, ...body }); await reload() }
    catch (e) { setError(e.message) } finally { setBusy(false) }
  }
  // Opening a question tells the team you're on it, so nobody else answers it at the same time.
  useEffect(() => {
    if (!v.sync || !q.id || all) return
    const last = claimed.get(`${id}:${q.id}`)
    if (last && Date.now() - last < 10 * 60000) return
    claimed.set(`${id}:${q.id}`, Date.now())
    api(`library/${id}/change`, { kind: 'claim', qid: q.id }).catch(() => {})
  }, [q.id, all])
  return (
    <div className="lib-needs">
      <div className="lib-needs-bar"><b>{scope ? index.get(scope)?.name : 'All questions'}</b>{scope && <button className="ghost" onClick={onAll}>All questions</button>}</div>
      {scope && <p className="sub">Questions in this branch and its parts.</p>}
      {error && <p role="alert">{error}</p>}
      <div className="seg lib-now" role="radiogroup">
        <button role="radio" aria-checked={!later} onClick={() => { setLater(false); setK(0) }} title="Never settled, the spot check, overlaps in the tree, and the questions Jev says change the most">Now ({nowCount})</button>
        <button role="radio" aria-checked={later} onClick={() => { setLater(true); setK(0) }}>Later ({questions.length - nowCount})</button>
      </div>
      {!qs.length ? <p className="sub">{later ? 'Nothing waiting for later here.' : 'Nothing needs you now here. Check Later or choose another bubble.'}</p> : <>
      {!all && q.claimedBy && <p className="lib-claim">{q.claimedBy} has this one open. <button className="ghost" onClick={() => setK((k + 1) % qs.length)}>Next question</button></p>}
      <div className="lib-needs-bar">
        <span className="sub">{qs.length} left{all ? '' : `, showing ${Math.min(k, qs.length - 1) + 1}`}</span>
        <button className="ghost" onClick={() => setAll(!all)}>{all ? 'One at a time' : 'See the list'}</button>
      </div>
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      {q.skipped && <p className="sub">Skipped for now — still unanswered.</p>}
      {all
        ? <ol className="lib-qlist">{qs.map((x, j) => <li key={x.id}><button className="ghost" onClick={() => { setK(j); setAll(false) }}>
            <span className={'tag' + (x.kind !== 'thread' ? ' dashed' : x.status === 'unsettled' ? ' red' : '')}>{x.kind === 'thread' ? STATUS[x.status] : x.kind === 'spot' ? `Spot check ${x.items.length}` : x.kind === 'tree' ? 'Tree' : 'Where?'}</span>{x.q}{x.claimedBy && <span className="sub"> · {x.claimedBy} has it open</span>}</button></li>)}</ol>
        : q.kind === 'thread' ? <ThreadQ key={q.id} q={q} v={v} send={send} skip={() => send({ skip: true })} />
        : q.kind === 'spot' ? <SpotQ key={q.id} q={q} id={id} index={index} reload={reload} target={v.target} />
        : q.kind === 'tree' ? <TreeQ key={q.id} q={q} send={send} skip={() => send({ skip: true })} />
        : <PlaceQ key={q.id} q={q} v={v} index={index} send={send} skip={() => send({ skip: true })} onPlace={onPlace} />}
      </fieldset>
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

// A sample of filings across every rule. Each is right unless you say otherwise; the answers measure how often each
// rule is right, and a rule that keeps being right files on its own from then on.
function SpotQ({ q, id, index, reload, target }) {
  const [wrong, setWrong] = useState({})
  const [busy, setBusy] = useState(false)
  const options = [...index.values()].map(n => ({ id: n.id, label: `${'  '.repeat(n.depth)}${n.name}` }))
  const mark = (x, b) => setWrong(w => { const n = { ...w }; b === undefined ? delete n[x] : (n[x] = b); return n })
  const moved = q.items.filter(i => i.id in wrong).length
  const [error, setError] = useState('')
  const run = async body => { setBusy(true); setError(''); try { await api(`library/${id}/answer`, body); await reload() } catch (e) { setError(e.message) } finally { setBusy(false) } }
  return (
    <div className="lib-q">
      <span className="tag">Spot check</span><span className="sub">Measures how often filing is right, so it can file on its own</span>
      <h3>{q.q}</h3>
      <p className="sub">Each one is right unless you mark it. Right means the home fits; the links are what else it touches.</p>
      {error && <p role="alert">{error}</p>}
      <fieldset disabled={busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <ol className="lib-spot">
        {q.items.map(i => (
          <li key={i.id} className={i.id in wrong ? 'off' : ''}>
            <p>{i.text}</p>
            <div className="lib-spot-home"><b>{i.where}</b>{i.links.length > 0 && <span className="sub"> · also touches {i.links.map(l => l.name.split(' › ').at(-1)).join(', ')}</span>}</div>
            <div className="lib-q-bar">
              <button className={'btn' + (i.id in wrong ? '' : ' on')} onClick={() => mark(i.id)}>Right</button>
              <button className={'btn' + (i.id in wrong ? ' on' : '')} onClick={() => mark(i.id, wrong[i.id] ?? '')}>Wrong</button>
              {i.id in wrong && <select value={wrong[i.id]} onChange={e => mark(i.id, e.target.value)}><option value="">Where does it belong?</option><option value="none">Not this business</option>{options.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}</select>}
              <button className="ghost" onClick={() => run({ qid: 'spot', skip: true, items: [i.id] })}>Skip for now</button>
              <span className="sub">{i.file}{i.at ? ' ' + i.at : ''}</span>
            </div>
          </li>
        ))}
      </ol>
      <div className="lib-q-bar">
        <button className="primary" disabled={busy || q.items.some(i => i.id in wrong && !wrong[i.id])} onClick={() => run({ qid: 'spot', checks: q.items.map(i => i.id in wrong ? { id: i.id, ok: false, branch: wrong[i.id] } : { id: i.id, ok: true }) })}>
          Save: {q.items.length - moved} right{moved ? `, ${moved} moved` : ''}</button>
        <button className="ghost" disabled={busy} onClick={() => run({ qid: 'spot', skip: true, items: q.items.map(i => i.id) })}>Skip this sample</button>
      </div>
      </fieldset>
      <details className="lib-rules"><summary>How sure each rule is</summary>
        <table><thead><tr><th>Rule</th><th>Items</th><th>Checked</th><th>Right</th></tr></thead>
          <tbody>{q.rules.map(r => <tr key={r.rule}><td>{r.label}</td><td>{r.items}</td><td>{r.checked} of {r.need}</td><td>{r.right == null ? '-' : pct(r.right)}{r.trusted ? ' · files on its own' : ''}</td></tr>)}</tbody></table>
        <p className="sub">A rule files on its own after 20 checks at {pct(target)} or better.</p>
      </details>
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
          <span className="tag dashed">{TYPE[i.type]}</span>{!i.filed && i.branch !== 'none' && <span className="tag dashed" title="Placed by a rule that hasn't yet proven itself in spot checks">best guess</span>}<span className="sub">{i.date}{i.who ? ' · ' + i.who : ''}</span>
          <p>{i.text}</p>
          {i.quote && <blockquote>“{i.quote}”<cite>{i.file}{i.at ? ' at ' + i.at : ''}</cite></blockquote>}
        </li>
      ))}
    </ul>
  )
}

function Branch({ v, index, focus, setFocus, edit }) {
  const [open, setOpen] = useState(null)
  const [form, setForm] = useState(null)
  const under = id => id === focus || !focus || id.startsWith(focus + '.')
  const ts = Object.values(v.threads).filter(t => under(t.branch))
  const node = focus ? index.get(focus) : null
  const inThread = new Set(Object.values(v.threads).flatMap(t => t.items))
  const loose = Object.values(v.items).filter(i => i.placed && !i.dup && i.branch !== 'none' && under(i.branch) && !inThread.has(i.id))
  // What this branch touches elsewhere, either way round, grouped two levels down.
  const area = bid => { const p = []; for (let n = index.get(bid); n; n = index.get(n.parent)) p.unshift(n); return p[Math.min(1, p.length - 1)] }
  const conn = {}
  if (focus) for (const i of Object.values(v.items)) {
    if (i.dup || !i.links?.length) continue
    const ends = under(i.branch) ? i.links.filter(l => !under(l)) : i.links.some(under) ? [i.branch] : []
    for (const e of ends) { const a = area(e); if (a) (conn[a.id] ||= { node: a, ids: new Set() }).ids.add(i.id) }
  }
  const conns = Object.values(conn).sort((a, b) => b.ids.size - a.ids.size)
  return (
    <div className="lib-branch">
      <div className="lib-branch-head">
        <h3>{node?.name || v.name}</h3>
        {node && <button className="ghost" onClick={() => setForm({ kind: 'editBranch', branch: node.id, name: node.name, desc: node.desc || '' })}>Edit</button>}
        <button className="ghost" onClick={() => setForm({ kind: 'addBranch', parent: node?.id || '', name: '', desc: '' })}>Add a part</button>
      </div>
      {form && (form.kind === 'editBranch' || form.kind === 'addBranch') && <div className="lib-edit">
        <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder={form.kind === 'addBranch' ? `New part of ${node?.name || v.name}` : 'Name'} />
        <textarea rows={2} value={form.desc} onChange={e => setForm({ ...form, desc: e.target.value })} placeholder="What belongs here (this steers where things get filed)" />
        <div className="lib-q-bar"><button className="primary" disabled={!form.name.trim()} onClick={() => { edit(form); setForm(null) }}>Save</button><button className="ghost" onClick={() => setForm(null)}>Cancel</button></div>
      </div>}
      {node?.desc && <p className="sub">{node.desc}</p>}
      {node?.children?.length > 0 && <div className="lib-chips">{node.children.map(ch => <button key={ch.id} className="btn" onClick={() => setFocus(ch.id)}>{ch.name} <span className="sub">{v.byBranch[ch.id]?.items || 0}</span></button>)}</div>}
      {conns.length > 0 && <section><h4>Connected to <span className="sub">· items that touch both</span></h4>
        <div className="lib-chips">{conns.slice(0, 12).map(x => <button key={x.node.id} className={'btn' + (open === 'c:' + x.node.id ? ' on' : '')} onClick={() => setOpen(open === 'c:' + x.node.id ? null : 'c:' + x.node.id)}>{x.node.name} <span className="sub">{x.ids.size}</span></button>)}</div>
        {open?.startsWith('c:') && conn[open.slice(2)] && <Items ids={[...conn[open.slice(2)].ids]} v={v} />}</section>}
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
                {form?.thread === t.id ? <div className="lib-edit">
                  <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })} />
                  <textarea rows={3} value={form.summary} onChange={e => setForm({ ...form, summary: e.target.value })} />
                  <select value={form.status} onChange={e => setForm({ ...form, status: e.target.value })}>{ORDER.map(st => <option key={st} value={st}>{STATUS[st]}</option>)}</select>
                  <textarea rows={2} value={form.decision} onChange={e => setForm({ ...form, decision: e.target.value })} placeholder="Decision (if settled)" />
                  <div className="lib-q-bar"><button className="primary" disabled={!form.title.trim()} onClick={() => { edit(form); setForm(null) }}>Save</button><button className="ghost" onClick={() => setForm(null)}>Cancel</button></div>
                </div> : <>
                <p>{t.summary}</p>
                {t.decision && <p className="lib-decision"><b>Decision{t.answeredBy ? ` (${t.answeredBy === 'owner' ? 'yours' : t.answeredBy})` : ''}:</b> {t.decision}</p>}
                {t.editedBy && <p className="sub">Edited by {t.editedBy} {t.editedAt?.slice(0, 10)}</p>}
                <button className="ghost" onClick={() => setForm({ kind: 'editThread', thread: t.id, title: t.title, summary: t.summary, status: t.status, decision: t.decision || '' })}>Edit topic</button>
                </>}
                {open === t.id && <>{t.ways?.length > 0 && <ul className="lib-ways">{t.ways.map((w, j) => <li key={j}>{w}</li>)}</ul>}<Items ids={t.items} v={v} /></>}
              </article>
            ))}
          </section>
        )
      })}
      {loose.length > 0 && <section><h4>Here, not yet in a topic <span className="sub">{loose.length}</span></h4><Items ids={loose.map(i => i.id)} v={v} /></section>}
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
        {(!v.member || v.ai?.loggedIn) && <button className="primary" disabled={!q.trim() || busy} onClick={askIt}>{busy ? 'Reading…' : 'Ask'}</button>}
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
      {!v.member && <button className="primary" disabled={running || !v.counts.threads} onClick={onRun}>Cross-check everything</button>}
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
          <span className="sub">{c.date}{c.speakers?.length ? ' · ' + c.speakers.join(', ') : ''}{c.items ? ` · ${c.items} items` : ''}{c.readBy ? ` · read by ${c.readBy}` : ''}</span>
          {c.dupOf && <p className="sub">Same words as {c.dupOf}; skipped.</p>}
          {c.error && <p className="error-line">{c.error}</p>}
          {c.summary && <p>{c.summary}</p>}
        </li>
      ))}
    </ul>
  )
}
