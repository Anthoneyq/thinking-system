import { createContext, useContext, useLayoutEffect, useRef, useState } from 'react'

// The map's effects, each switchable on this computer. Reduced motion in the system settings turns the moving ones off.
export const EFFECTS = [
  ['zoom', 'Zoom between levels'], ['draw', 'Threads draw in'], ['pulses', 'Pulses along threads'], ['sweep', 'Radar sweep'],
  ['grid', 'Background grid'], ['count', 'Numbers count up'], ['decode', 'Title decode'], ['packets', 'Answers fly to the map'],
]
const KEY = 'think.fx'
const STILL = new Set(['grid'])
const reduced = () => { try { return matchMedia('(prefers-reduced-motion: reduce)').matches } catch { return false } }

export const Fx = createContext({})
export const useFx = () => useContext(Fx)

export function useFxState() {
  const [saved, setSaved] = useState(() => { try { return JSON.parse(localStorage.getItem(KEY)) || {} } catch { return {} } })
  const set = next => { setSaved(next); try { localStorage.setItem(KEY, JSON.stringify(next)) } catch {} }
  const still = reduced()
  const fx = Object.fromEntries(EFFECTS.map(([k]) => [k, saved[k] !== false && (!still || STILL.has(k))]))
  return [fx, saved, set, still]
}

// Runs a number up to its value by writing the text directly, so a bubble never re-renders per frame.
export function useCountUp(value, on) {
  const ref = useRef(null), last = useRef(on ? 0 : value)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const from = last.current
    last.current = value
    if (!on || from === value || document.hidden) { el.textContent = value || ''; return }
    const start = performance.now()
    let raf
    const tick = t => {
      const k = Math.min(1, (t - start) / 700), eased = 1 - (1 - k) ** 3
      el.textContent = Math.round(from + (value - from) * eased) || ''
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); el.textContent = value || '' }
  }, [value, on])
  return ref
}

const GLYPHS = 'ABCDEFGHKMNPRSTUVXYZ0123456789/+-'
// A title resolving letter by letter out of noise.
export function useDecode(text, on) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    if (!on || document.hidden) { el.textContent = text; return }
    const start = performance.now(), length = 520
    let raf
    const tick = t => {
      const k = Math.min(1, (t - start) / length), solved = Math.floor(text.length * k)
      el.textContent = [...text].map((c, i) => i < solved || c === ' ' ? c : GLYPHS[(i * 7 + Math.floor(t / 40)) % GLYPHS.length]).join('')
      if (k < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => { cancelAnimationFrame(raf); el.textContent = text }
  }, [text, on])
  return ref
}

// A saved answer leaves the panel (from: where it was on screen) and lands on the bubble it belongs to; resolves on landing.
export function fly(from, branch, index, text, on) {
  if (!on || !from) return Promise.resolve()
  let bubble = null, node = null
  for (let n = index.get(branch); n && !bubble; n = index.get(n.parent)) {
    node = document.querySelector(`.lvl:not(.ghost) [data-bid="${CSS.escape(n.id)}"]`)
    bubble = node?.querySelector('.web-bubble')
  }
  const target = bubble || document.querySelector('.web-center ellipse')
  if (!target) return Promise.resolve()
  const a = from, b = target.getBoundingClientRect()
  const el = document.createElement('div')
  el.className = 'packet'
  el.textContent = text
  el.style.left = a.left + 'px'; el.style.top = a.top + 'px'; el.style.width = Math.min(a.width, 320) + 'px'
  document.body.append(el)
  const dx = b.left + b.width / 2 - a.left - Math.min(a.width, 320) / 2, dy = b.top + b.height / 2 - a.top - el.offsetHeight / 2
  const lift = Math.min(70, Math.abs(dx) / 5)
  const anim = el.animate([
    { transform: 'none', opacity: 1, offset: 0 },
    { transform: `translate(${dx * .45}px, ${dy * .45 - lift}px) scale(.45)`, opacity: 1, offset: .45 },
    { transform: `translate(${dx}px, ${dy}px) scale(.05)`, opacity: .9, offset: 1 },
  ], { duration: 640, easing: 'cubic-bezier(.45,0,.2,1)', fill: 'forwards' })
  return anim.finished.catch(() => {}).then(() => {
    el.remove()
    if (node) { node.dataset.landed = '1'; setTimeout(() => node.removeAttribute('data-landed'), 800) }
  })
}
