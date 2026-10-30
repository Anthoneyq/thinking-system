import { useEffect, useState } from 'react'
import { api, go } from './api.js'
import RunView from './RunView.jsx'
import LibraryView from './LibraryView.jsx'

export default function App() {
  if (import.meta.env.VITE_REPLAY) return <Replay />
  return <Live />
}

// The public demo: one finished run, played back.
function Replay() {
  const [run, setRun] = useState(null)
  useEffect(() => { fetch('/demo-run.json').then(r => r.json()).then(setRun) }, [])
  return run ? <RunView replay={run} /> : <div className="empty">Loading...</div>
}

function Live() {
  const [path, setPath] = useState(location.pathname)
  useEffect(() => {
    const on = () => setPath(location.pathname)
    addEventListener('popstate', on)
    return () => removeEventListener('popstate', on)
  }, [])
  const m = path.match(/^\/run\/([^/]+)/)
  const l = path.match(/^\/library\/([^/]+)/)
  if (l) return <LibraryView key={l[1]} id={decodeURIComponent(l[1])} />
  return m ? <RunView key={m[1]} id={decodeURIComponent(m[1])} /> : <Home />
}

const EFFORTS = [
  { id: 'quick', label: 'Quick', note: '1-2 methods, no follow-up loop' },
  { id: 'normal', label: 'Normal', note: '2-4 methods, one loop, skeptic review' },
  { id: 'deep', label: 'Deep', note: 'Up to 6 methods, two loops, research' },
]

function Home() {
  const [meta, setMeta] = useState(null)
  const [runs, setRuns] = useState([])
  const [libs, setLibs] = useState([])
  const [input, setInput] = useState('')
  const [model, setModel] = useState(() => { try { return localStorage.getItem('think.model') || 'claude-sonnet-5-5' } catch { return 'claude-sonnet-5-5' } })
  const [effort, setEffort] = useState('normal')
  const [jev, setJev] = useState(() => { try { return localStorage.getItem('think.jev') !== 'off' } catch { return true } })
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [drag, setDrag] = useState(false)

  useEffect(() => { api('meta').then(setMeta); api('runs').then(setRuns); api('libraries').then(setLibs).catch(() => {}) }, [])

  async function start() {
    if (!input.trim() || busy) return
    setBusy(true); setErr('')
    try { localStorage.setItem('think.model', model) } catch {}
    try { localStorage.setItem('think.jev', jev ? 'on' : 'off') } catch {}
    try { const { id } = await api('runs', { input, model, effort, ...(meta?.jev ? { jev } : {}) }); go('/run/' + id) } catch (e) { setErr(e.message); setBusy(false) }
  }

  async function drop(e) {
    e.preventDefault(); setDrag(false)
    const texts = await Promise.all([...e.dataTransfer.files].map(async f => `\n\n--- ${f.name} ---\n${await f.text()}`))
    setInput(v => (v + texts.join('')).trim())
  }

  return (
    <main className="home">
      <header className="home-top">
        <span className="brand"><i />Thinking System</span>
        <span className="sub">Incomplete thought in. Clear next action out.</span>
      </header>
      <section className="home-hero">
        <h1>What are you<br />thinking about?</h1>
        <p className="lede">A goal, a mess, a decision, a draft, a name. It doesn't need to be clear. Paste notes or drop files. You'll watch the flowchart work it out, and you can step in at any box.</p>
      </section>
      <section className={'composer' + (drag ? ' drag' : '')} onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={drop}>
        <textarea autoFocus value={input} onChange={e => setInput(e.target.value)} placeholder="e.g. I have four businesses and can't tell which to push first, or what to automate forever."
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) start() }} />
        <div className="composer-bar">
          <label className="field">
            <span>Model</span>
            <select value={model} onChange={e => setModel(e.target.value)}>
              {meta?.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select>
          </label>
          <div className="field">
            <span>Effort</span>
            <div className="seg" role="radiogroup">
              {EFFORTS.map(x => <button key={x.id} role="radio" aria-checked={effort === x.id} title={x.note} onClick={() => setEffort(x.id)}>{x.label}</button>)}
            </div>
          </div>
          {meta?.jev && <div className="field">
            <span>Decisions</span>
            <div className="seg" role="radiogroup">
              <button role="radio" aria-checked={jev} title="Jev makes the routing calls in under a second; Claude steps in when Jev is unsure" onClick={() => setJev(true)}>Jev</button>
              <button role="radio" aria-checked={!jev} title="Claude makes every call" onClick={() => setJev(false)}>Claude</button>
            </div>
          </div>}
          <button className="primary go" disabled={!input.trim() || busy} onClick={start}>{busy ? 'Starting...' : 'Think it through'} <kbd>⌘↵</kbd></button>
        </div>
        {err && <p className="error-line">{err}</p>}
      </section>
      {libs.length > 0 && (
        <section className="recent">
          <h2>Conversations</h2>
          <ul>
            {libs.map(l => (
              <li key={l.id}><a href={'/library/' + l.id} onClick={e => { e.preventDefault(); go('/library/' + l.id) }}>
                <span className="r-title">{l.name}</span>
                {l.open > 0 && <span className="pill s-waiting">{l.open} open topics</span>}
                <span className="sub">{l.calls} calls · {l.items} items · {l.threads} topics</span>
              </a></li>
            ))}
          </ul>
        </section>
      )}
      {runs.length > 0 && (
        <section className="recent">
          <h2>Earlier runs</h2>
          <ul>
            {runs.slice(0, 12).map(r => (
              <li key={r.id}><a href={'/run/' + r.id} onClick={e => { e.preventDefault(); go('/run/' + r.id) }}>
                <span className="r-title">{r.title}</span>
                <span className={'pill s-' + r.status}>{r.status}</span>
                <span className="sub">{new Date(r.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
              </a></li>
            ))}
          </ul>
        </section>
      )}
    </main>
  )
}
