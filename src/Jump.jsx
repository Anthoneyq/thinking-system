import { useEffect, useMemo, useRef, useState } from 'react'

const KINDS = [['branch', 'Branches'], ['topic', 'Topics'], ['item', 'Said']]

// Everything that matches, so the map can light up where it lives; the list itself shows the first few of each.
export function matches(v, index, text) {
  const ws = text.toLowerCase().split(/\s+/).filter(Boolean)
  if (!ws.length) return []
  const has = t => ws.every(w => t.includes(w))
  const nameFirst = (a, b) => (b.name.toLowerCase().includes(ws[0]) ? 1 : 0) - (a.name.toLowerCase().includes(ws[0]) ? 1 : 0)
  const branches = [...index.values()].filter(n => has(`${n.name} ${n.desc || ''}`.toLowerCase())).sort(nameFirst)
    .map(n => ({ kind: 'branch', id: n.id, branch: n.id, text: n.name }))
  const topics = Object.values(v.threads).filter(t => has(`${t.title} ${t.summary || ''} ${t.decision || ''}`.toLowerCase()))
    .map(t => ({ kind: 'topic', id: t.id, branch: t.branch, text: t.title, topic: t.id }))
  const inTopic = new Map(Object.values(v.threads).flatMap(t => t.items.map(i => [i, t.id])))
  const items = Object.values(v.items).filter(i => !i.dup && i.branch !== 'none' && index.has(i.branch) && has(`${i.text} ${i.quote || ''}`.toLowerCase()))
    .map(i => ({ kind: 'item', id: i.id, branch: i.branch, text: i.text, topic: inTopic.get(i.id) }))
  return [...branches, ...topics, ...items]
}

export default function Jump({ v, index, onHits, onGo, onClose }) {
  const [text, setText] = useState('')
  const [at, setAt] = useState(0)
  const box = useRef(null)
  useEffect(() => { box.current?.focus(); return () => onHits(null) }, [])
  const all = useMemo(() => matches(v, index, text), [text])
  const shown = KINDS.flatMap(([k]) => all.filter(r => r.kind === k).slice(0, 5))
  useEffect(() => {
    setAt(0)
    if (!text.trim()) return onHits(null)
    const lit = new Set()
    for (const r of all) for (let n = index.get(r.branch); n && !lit.has(n.id); n = index.get(n.parent)) lit.add(n.id)
    onHits(lit)
  }, [all])
  const where = id => { const p = []; for (let n = index.get(id); n; n = index.get(n.parent)) p.unshift(n.name); return p.join(' › ') }
  const key = e => {
    if (e.key === 'Escape') onClose()
    if (e.key === 'ArrowDown') { e.preventDefault(); setAt(Math.min(at + 1, shown.length - 1)) }
    if (e.key === 'ArrowUp') { e.preventDefault(); setAt(Math.max(at - 1, 0)) }
    if (e.key === 'Enter' && shown[at]) onGo(shown[at])
  }
  return (
    <div className="jump" role="dialog" aria-label="Jump anywhere">
      <input ref={box} value={text} onChange={e => setText(e.target.value)} onKeyDown={key} placeholder="Jump to a branch, topic or anything said" />
      {text.trim() && <div className="jump-list">
        {!shown.length && <p className="sub">Nothing matches.</p>}
        {KINDS.map(([k, label]) => {
          const rows = shown.filter(r => r.kind === k), total = all.filter(r => r.kind === k).length
          return rows.length > 0 && <section key={k}>
            <h4>{label} <span className="sub">{total}</span></h4>
            {rows.map(r => <button key={r.kind + r.id} className={shown[at] === r ? 'on' : ''} onMouseEnter={() => setAt(shown.indexOf(r))} onClick={() => onGo(r)}>
              <span>{r.text}</span>{r.kind !== 'branch' && <span className="sub">{where(r.branch)}</span>}</button>)}
          </section>
        })}
      </div>}
      <p className="jump-keys sub">Arrow keys move, Enter opens, Esc closes</p>
    </div>
  )
}
