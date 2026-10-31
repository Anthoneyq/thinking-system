import { memo, useEffect, useMemo, useState } from 'react'
import { useFx, useCountUp, useDecode } from './fx.js'

// The spider web: the focus in the middle, its branches around it, and each branch's own parts as small satellites.
// Stepping in carries the clicked bubble to the centre; the level you left zooms away behind it.
const W = 900, H = 640, cx = W / 2, cy = H / 2
const radius = n => n > 10 ? 250 : 220
const kidsOf = (v, index, focus) => (focus ? index.get(focus)?.children : v.tree.branches) || []
const place = kids => {
  const R = radius(kids.length)
  return kids.map((k, i) => { const a = -Math.PI / 2 + (i / kids.length) * Math.PI * 2; return { a, x: cx + Math.cos(a) * R * 1.45, y: cy + Math.sin(a) * R } })
}

export default function Web({ v, index, focus, selected, setFocus, onPick, link, onLink, hits, landed }) {
  const fx = useFx()
  const [every, setEvery] = useState(false)
  const [shown, setShown] = useState({ cur: focus, prev: null, how: null })
  if (shown.cur !== focus) {
    const parent = id => (id ? index.get(id)?.parent ?? null : undefined)
    const how = !fx.zoom ? null : focus && parent(focus) === shown.cur ? 'in' : shown.cur && parent(shown.cur) === focus ? 'out' : 'jump'
    setShown({ cur: focus, prev: shown.cur, how })
  }
  useEffect(() => {
    if (!shown.how) return
    const t = setTimeout(() => setShown(s => ({ ...s, how: null })), 640)
    return () => clearTimeout(t)
  }, [shown])

  const origin = useMemo(() => {
    if (shown.how !== 'in' && shown.how !== 'out') return {}
    const outer = shown.how === 'in' ? shown.prev : shown.cur, inner = shown.how === 'in' ? shown.cur : shown.prev
    const kids = kidsOf(v, index, outer), p = place(kids)[kids.findIndex(k => k.id === inner)]
    return p ? { '--ox': p.x + 'px', '--oy': p.y + 'px', '--dx': cx - p.x + 'px', '--dy': cy - p.y + 'px' } : {}
  }, [shown])

  const R = radius(kidsOf(v, index, focus).length)
  const pairs = useLinks(v, index, focus)
  return (
    <>
      {pairs.length > 18 && <div className="lib-map-bar"><span className="sub">Click a line to see what connects two branches; point at a branch to light up its lines.</span>
        <button className="ghost" onClick={() => setEvery(!every)}>{every ? 'Strongest links only' : `Show all ${pairs.length} links`}</button></div>}
      <svg className="lib-web" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Business tree" style={origin}>
        <defs>
          <radialGradient id="web-halo"><stop offset=".55" stopColor="var(--accent)" stopOpacity=".34" /><stop offset="1" stopColor="var(--accent)" stopOpacity="0" /></radialGradient>
        </defs>
        {[0.55, 1, 1.32].map(f => <ellipse key={f} cx={cx} cy={cy} rx={R * f * 1.45} ry={R * f} className="web-ring" />)}
        {fx.sweep && <g transform={`translate(${cx} ${cy}) scale(1.45 1)`}><foreignObject x={-R * 1.32} y={-R * 1.32} width={R * 2.64} height={R * 2.64}><div className="web-sweep" /></foreignObject></g>}
        {shown.how && <Level key={'old' + shown.prev} ghost how={shown.how} {...{ v, index, focus: shown.prev, every }} />}
        <Level key={'lvl' + focus} how={shown.how} {...{ v, index, focus, selected, setFocus, onPick, link, onLink, every, hits, landed }} />
      </svg>
    </>
  )
}

function useLinks(v, index, focus) {
  return useMemo(() => {
    const kids = kidsOf(v, index, focus), slot = new Map(kids.map((k, i) => [k.id, i]))
    const kidOf = id => { for (let n = index.get(id); n; n = index.get(n.parent)) if (slot.has(n.id)) return slot.get(n.id); return -1 }
    const pairs = {}
    for (const i of Object.values(v.items)) for (const l of i.links || []) {
      const a = kidOf(i.branch), b = kidOf(l)
      if (a < 0 || b < 0 || a === b) continue
      const key = Math.min(a, b) + '|' + Math.max(a, b)
      pairs[key] = (pairs[key] || 0) + 1
    }
    return Object.entries(pairs).sort((x, y) => y[1] - x[1])
  }, [v.items, v.tree, focus])
}

const Level = memo(function Level({ v, index, focus, selected, setFocus, onPick, link, onLink, every, ghost, how, hits, landed }) {
  const fx = useFx()
  const [hover, setHover] = useState(-1)
  const node = focus ? index.get(focus) : null
  const kids = kidsOf(v, index, focus)
  const pos = place(kids)
  const all = useLinks(v, index, focus)
  const links = all.slice(0, every ? 999 : 18)
  const most = Math.max(1, ...links.map(l => l[1]))
  const stat = id => { const s = v.byBranch[id] || { items: 0, need: 0, now: 0 }; return landed?.[id] ? { ...s, need: Math.max(0, s.need - landed[id]) } : s }
  const max = Math.max(1, ...kids.map(k => stat(k.id).items))
  const here = focus ? stat(focus) : { items: v.counts.filed + v.counts.guessed, need: v.questions.length - (landed?.[''] || 0) }
  const curve = (p, q) => { const mx = cx + ((p.x + q.x) / 2 - cx) * 0.35, my = cy + ((p.y + q.y) / 2 - cy) * 0.35; return `M${p.x},${p.y} Q${mx},${my} ${q.x},${q.y}` }
  const motion = how ? (ghost ? `${how}-old ghost` : `${how}-new`) : 'still'
  return (
    <g className={'lvl ' + motion} aria-hidden={ghost || undefined}>
      {links.map(([key, n], j) => {
        const [a, b] = key.split('|').map(Number), p = pos[a], q = pos[b]
        const on = link && [kids[a].id, kids[b].id].sort().join('|') === [link.a, link.b].sort().join('|')
        const dim = hover >= 0 && hover !== a && hover !== b
        const d = curve(p, q)
        // A wide invisible line on top, so a thin link is still easy to click.
        return <g key={key} className="web-link-g" onClick={ghost ? undefined : () => onLink({ a: kids[a].id, b: kids[b].id })}>
          <path d={d} pathLength="1" className={'web-link' + (on ? ' on' : dim ? ' dim' : '') + (fx.draw ? ' draws' : '')} style={{ strokeWidth: 2 + 7 * Math.sqrt(n / most), opacity: 0.25 + 0.6 * n / most, '--j': j }} />
          <path d={d} className="web-hit"><title>{n} item(s) touch both {kids[a].name} and {kids[b].name}. Click to see them.</title></path>
          {fx.pulses && !ghost && j < 10 && <circle r={2.2 + 2 * n / most} className={'web-pulse' + (dim ? ' dim' : '')}>
            <animateMotion dur={`${6 - 3 * n / most}s`} begin={`${-j * .9}s`} repeatCount="indefinite" path={d} {...(j % 2 ? { keyPoints: '1;0', keyTimes: '0;1', calcMode: 'linear' } : {})} />
          </circle>}
        </g>
      })}
      {kids.map((k, i) => <Bubble key={k.id} k={k} i={i} p={pos[i]} st={stat(k.id)} max={max} stat={stat} ghost={ghost} selected={selected === k.id}
        lit={hits?.has(k.id)} searching={!!hits} setHover={setHover} open={() => k.children?.length ? setFocus(k.id) : onPick(k.id)} />)}
      <g className="web-center" onClick={ghost ? undefined : () => focus && setFocus(node.parent)} style={{ cursor: focus ? 'pointer' : 'default' }}>
        <ellipse cx={cx} cy={cy} rx={118} ry={66} />
        <Center name={(node?.name || v.name).slice(0, 26)} here={here} focus={focus} />
      </g>
    </g>
  )
})

function Center({ name, here, focus }) {
  const fx = useFx()
  const title = useDecode(name, fx.decode)
  const items = useCountUp(here.items, fx.count)
  const need = useCountUp(here.need, fx.count)
  return <>
    <text ref={title} x={cx} y={cy - 8} className="web-center-name" />
    <text x={cx} y={cy + 14} className="web-center-sub"><tspan ref={items} /> items · <tspan ref={need} /> question{here.need === 1 ? '' : 's'} for you</text>
    {focus && <text x={cx} y={cy + 34} className="web-center-sub">← step out</text>}
  </>
}

function Bubble({ k, i, p, st, max, stat, ghost, selected, lit, searching, setHover, open }) {
  const fx = useFx()
  const { a, x, y } = p
  const count = useCountUp(st.items, fx.count && !ghost)
  const need = useCountUp(st.need, false)
  const r = 16 + 22 * Math.sqrt(st.items / max)
  const sub = k.children || []
  return (
    <g className={'web-node' + (st.items ? '' : ' empty') + (lit ? ' lit' : searching ? ' miss' : '')} data-bid={k.id} style={{ '--i': i }} onClick={ghost ? undefined : open} tabIndex={ghost ? -1 : 0}
      onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(-1)} onKeyDown={e => e.key === 'Enter' && open()}>
      <line x1={cx} y1={cy} x2={x} y2={y} className="web-spoke" />
      {sub.map((g, j) => {
        const b = a + ((j + 0.5) / sub.length - 0.5) * Math.min(1.1, sub.length * 0.14)
        const gx = x + Math.cos(b) * (r + 26), gy = y + Math.sin(b) * (r + 26)
        const gs = stat(g.id)
        return <g key={g.id}><line x1={x} y1={y} x2={gx} y2={gy} className="web-thread" /><circle cx={gx} cy={gy} r={gs.items ? 4.5 : 3} className={gs.need ? 'web-sat red' : gs.items ? 'web-sat on' : 'web-sat'} /></g>
      })}
      <circle cx={x} cy={y} r={r + 16} className="web-halo" fill="url(#web-halo)" />
      <circle cx={x} cy={y} r={r} className={'web-bubble' + (selected ? ' sel' : '')} />
      <text ref={count} x={x} y={y + 4} className="web-count" />
      {st.need > 0 && <g className="web-badge"><rect x={x + r * 0.72 - (6 + String(st.need).length * 3.6)} y={y - r * 0.72 - 10} width={12 + String(st.need).length * 7.2} height={20} rx={10} className="web-need" /><text ref={need} x={x + r * 0.72} y={y - r * 0.72 + 4} className="web-need-n" /></g>}
      <text x={x} y={Math.sin(a) > 0.3 ? y - r - 10 : y + r + 18} className="web-label">{k.name}</text>
      <title>{k.name}: {st.items} items ({st.filed || 0} filed), {st.need} question(s) for you ({st.now} now){k.desc ? '\n' + k.desc : ''}</title>
    </g>
  )
}
