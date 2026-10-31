import { useMemo, useRef, useState } from 'react'
import { api } from './api.js'
import { fastGroups, startsTicked, batchAnswers } from '../shared/library-questions.js'
import Items from './LibItems.jsx'

const KIND = { owner: 'Who owns it', keep: 'Keep or drop', subject: 'Same subject' }

// Sort fast: similar questions on one screen. Pick an answer per row, or one for the whole group, and save them together.
export default function Fast({ v, id, questions, index, canSort, busy, act, onSaved, flyTo }) {
  const groups = useMemo(() => fastGroups(questions, v.groups), [questions, v.groups])
  const [key, setKey] = useState(null)
  const g = groups.find(x => x.key === key) || groups[0]
  const [drafts, setDrafts] = useState({})
  const [picked, setPicked] = useState({})
  const [open, setOpen] = useState(null)
  const [all, setAll] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const rows = useRef({})
  const isOn = q => !q.claimedBy && (picked[q.id] ?? startsTicked(q))
  const draft = (q, text) => { setDrafts(d => ({ ...d, [q.id]: text })); setPicked(p => ({ ...p, [q.id]: true })) }
  const setAllTo = text => { setAll(text); setDrafts(d => ({ ...d, ...Object.fromEntries(g.questions.filter(isOn).map(q => [q.id, text])) })) }
  const ticked = new Set((g?.questions || []).filter(isOn).map(q => q.id))
  const ready = g ? batchAnswers(g.questions, drafts, ticked) : []

  const save = async () => {
    const list = ready, name = g.name
    setSaving(true); setError('')
    flyTo(list.slice(0, 6).map(a => { const q = g.questions.find(x => x.id === a.qid); return { rect: rows.current[a.qid]?.getBoundingClientRect(), branch: v.threads[q.thread]?.branch, text: q.q } }), list.map(a => a.qid))
    try {
      const r = await api(`library/${id}/change`, { kind: 'answers', answers: list, group: name.replace(/^area:/, '') })
      setDrafts(d => { const n = { ...d }; for (const a of list) delete n[a.qid]; return n })
      setAll('')
      onSaved(r.result, list.map(a => a.qid))
    } catch (e) { setError(e.message); onSaved(null, list.map(a => a.qid)) } finally { setSaving(false) }
  }

  if (!groups.length) return <p className="sub">No open questions here.</p>
  const unsorted = !v.groups?.length
  return (
    <div className="fast">
      <nav className="fast-groups" aria-label="Question groups">
        {unsorted && <p className="sub">{canSort ? 'Grouped by subject for now.' : 'Grouped by subject until someone sorts them.'}</p>}
        {canSort && <button className="btn" disabled={!!busy} onClick={() => act('sortq')}>{busy === 'sortq' ? 'Sorting…' : unsorted ? 'Sort by meaning with AI' : 'Sort again'}</button>}
        {['owner', 'keep', 'subject'].map(kind => {
          const list = groups.filter(x => x.kind === kind)
          return list.length > 0 && <section key={kind}>
            <h4>{KIND[kind]}</h4>
            {list.map(x => <button key={x.key} className={x.key === g.key ? 'on' : ''} onClick={() => { setKey(x.key); setAll(''); setOpen(null) }}><span>{x.name}</span><b>{x.questions.length}</b></button>)}
          </section>
        })}
      </nav>
      <section className="fast-rows">
        <header>
          <h3>{g.name}</h3>
          <div className="fast-all">
            <span className="sub">Set all ticked to</span>
            {g.answers.map(a => <button key={a} className={'btn' + (all === a ? ' on' : '')} onClick={() => setAllTo(a)}>{a}</button>)}
            <input value={all} onChange={e => setAllTo(e.target.value)} placeholder="Or type one answer" />
          </div>
        </header>
        {error && <p role="alert">{error}</p>}
        <ol>
          {g.questions.map(q => {
            const t = v.threads[q.thread]
            return <li key={q.id} ref={el => { rows.current[q.id] = el }} className={isOn(q) ? '' : 'off'}>
              <label className="fast-q"><input type="checkbox" checked={isOn(q)} disabled={!!q.claimedBy} onChange={e => setPicked(p => ({ ...p, [q.id]: e.target.checked }))} /><span>{q.q}</span></label>
              {q.claimedBy && <p className="sub">{q.claimedBy} has this one open, so it is left out.</p>}
              {q.decided && <p className="fast-has"><b>Already has a decision, so it starts unticked:</b> {q.decided}</p>}
              <div className="lib-opts">{(q.options || []).map(o => <button key={o} className={'btn' + (drafts[q.id] === o ? ' on' : '')} onClick={() => draft(q, o)}>{o}</button>)}
                <input value={drafts[q.id] || ''} onChange={e => draft(q, e.target.value)} placeholder="Your words" /></div>
              <div className="fast-meta"><span className="sub">{q.where}</span><button className="ghost" onClick={() => setOpen(open === q.id ? null : q.id)}>{open === q.id ? 'Hide' : 'What was said'} ({t?.items.length || 0})</button></div>
              {open === q.id && t && <><p className="lib-sum"><b>{t.title}.</b> {t.summary}</p><Items ids={t.items} v={v} /></>}
            </li>
          })}
        </ol>
        <footer>
          <span className="sub">{ready.length} of {g.questions.length} ready</span>
          <button className="primary" disabled={!ready.length || saving} onClick={save}>{saving ? 'Saving…' : `Save ${ready.length} answer${ready.length === 1 ? '' : 's'}`}</button>
        </footer>
      </section>
    </div>
  )
}
