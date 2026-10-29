// Conversations mode: every recorded call read into items, each item filed on the business tree (SOPs within SOPs),
// the same topic tied together across calls, and one short list of what still needs the owner.
// Claude reads and writes; Jev files each item level by level and gives the confidence. Below the bar, a person decides.
import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from 'node:fs'
import { join, extname, dirname, basename } from 'node:path'
import { callModel, resolveModel } from '../models.js'
import { config } from '../store.js'
import { JEV_AVAILABLE, jevAsk } from '../jev.js'
import { parseFile, chunks, KINDS } from './parse.js'
import { SCHEMAS, SYSTEM, extractPrompt, threadsPrompt, crosscheckPrompt, askPrompt } from './prompts.js'
import { writeMarkdown } from './export.js'

export const bus = new EventEmitter()
bus.setMaxListeners(100)

export const FILE_AT = 0.95 // at or above: filed on its own; below: a person checks it
const CONCURRENCY = 3
const SONNET_IN = 3 / 1e6, SONNET_OUT = 15 / 1e6

// Libraries come from ~/.thinking-system/config.json: { "libraries": [{ "id", "name", "sources": [folders], "dir" }] }.
const LIBS = new Map((config.libraries || []).map(l => [l.id, { ...l, sources: [].concat(l.sources || l.source || []) }]))
const states = new Map()

export const listLibraries = () => [...LIBS.values()].map(l => ({ id: l.id, name: l.name, ...counts(load(l.id)) }))
export const getLibrary = id => LIBS.get(id)

// ---------- state on disk: <dir>/library.json (record) and <dir>/tree.json (the branches) ----------
export function load(id) {
  if (states.has(id)) return states.get(id)
  const lib = LIBS.get(id)
  if (!lib) return null
  const read = (f, d) => { try { return JSON.parse(readFileSync(join(lib.dir, f), 'utf8')) } catch { return d } }
  const tree = read('tree.json', { name: lib.name, branches: [] })
  const s = {
    calls: {}, items: {}, threads: {}, answers: [], corrections: [], crosslinks: [], snoozed: {}, scopeSig: {}, resolvedPairs: {}, cost: 0, seq: 0,
    ...read('library.json', {}),
    tree, job: null, version: 0,
  }
  states.set(id, s)
  return s
}

let timers = {}
function save(id, now = false) {
  const s = states.get(id), lib = LIBS.get(id)
  s.version++
  bus.emit('library', id)
  const write = () => {
    delete timers[id]
    mkdirSync(lib.dir, { recursive: true })
    const { tree, job, version, ...rest } = s
    writeFileSync(join(lib.dir, 'library.json'), JSON.stringify(rest, null, 1))
    writeFileSync(join(lib.dir, 'tree.json'), JSON.stringify(tree, null, 2))
    writeMarkdown(lib, s, view(id))
  }
  clearTimeout(timers[id])
  if (now) return write()
  timers[id] = setTimeout(write, 800)
}

// ---------- the tree ----------
const flat = (nodes, parent = null, depth = 0, out = new Map()) => {
  for (const n of nodes) { out.set(n.id, { ...n, parent, depth }); flat(n.children || [], n.id, depth + 1, out) }
  return out
}
export const pathOf = (index, id) => { const p = []; for (let n = index.get(id); n; n = index.get(n.parent)) p.unshift(n); return p }
const pathName = (index, id) => id === 'none' ? 'Not this business' : pathOf(index, id).map(n => n.name).join(' › ') || id
const within = (index, id, top) => pathOf(index, id).some(n => n.id === top)
// Threads are grouped two levels down (e.g. Running a job › Marketing), so each group is one Claude call.
const scopeOf = (index, id) => pathOf(index, id).slice(0, 2).at(-1)?.id || 'none'

// ---------- what a viewer sees: counts, questions, threads by branch ----------
function counts(s) {
  const items = Object.values(s.items).filter(i => !i.dup)
  return {
    calls: Object.values(s.calls).filter(c => !c.dupOf).length,
    newCalls: Object.values(s.calls).filter(c => !c.dupOf && c.status !== 'done').length,
    items: items.length,
    filed: items.filter(i => i.filed && i.branch !== 'none').length,
    review: items.filter(needsReview).length,
    threads: Object.keys(s.threads).length,
    open: Object.values(s.threads).filter(t => ['unsettled', 'open', 'assumed'].includes(t.status)).length,
    cost: s.cost,
  }
}
const needsReview = i => !i.filed && i.placed && !i.offtopic
// Where an item sits for topics: your call, else Jev's best guess. Topics use every item; unconfirmed ones are counted.
const home = i => i.by === 'owner' ? i.branch : i.finer?.branch || i.branch
const threadable = i => i.placed && !i.offtopic && !i.dup && home(i) !== 'none'

// The one list of what still needs the owner: unsettled first, then filing checks, then open and assumed.
export function questions(id) {
  const s = load(id), index = flat(s.tree.branches)
  const rank = { unsettled: 0, open: 2, assumed: 3 }
  const fromThreads = Object.values(s.threads)
    .filter(t => rank[t.status] !== undefined && t.question?.q && !s.snoozed['t:' + t.id])
    .map(t => ({
      id: 't:' + t.id, kind: 'thread', thread: t.id, status: t.status, q: t.question.q, why: t.question.why, options: t.question.options,
      where: pathName(index, t.branch), ways: t.ways, items: t.items.length, weight: t.weight ?? 0.5,
      order: rank[t.status] - (t.weight ?? 0.5) - Math.min(t.items.length, 10) / 20,
      now: t.status === 'unsettled' || (t.weight ?? 0.5) >= 0.8,
    }))
  // Filing checks come grouped by the branch they look like, so twenty alike items take one click.
  const groups = {}
  for (const i of Object.values(s.items)) {
    if (needsReview(i) && !s.snoozed['i:' + i.id]) (groups['r:' + i.branch] ||= []).push(i)
    else if (i.finer && i.by !== 'owner' && !s.snoozed['f:' + i.id]) (groups['f:' + i.finer.branch] ||= []).push(i)
  }
  const fromItems = []
  for (const [key, list] of Object.entries(groups)) {
    const finer = key.startsWith('f:'), branch = key.slice(2)
    if (list.length === 1 && !finer) { fromItems.push(placeQ(list[0], index)); continue }
    fromItems.push({
      id: key, kind: 'group', finer, branch, name: pathName(index, branch), q: finer
        ? `${list.length} item(s) filed under ${pathName(index, list[0].branch)} look like they belong one level in, in ${pathName(index, branch)}.`
        : `${list.length} items look like they belong in ${pathName(index, branch)}.`,
      items: list.sort((a, b) => (b.finer?.p ?? b.conf) - (a.finer?.p ?? a.conf)).map(i => ({ id: i.id, text: i.text, conf: i.finer?.p ?? i.conf, why: finer ? '' : reviewWhy(i), file: i.file, at: i.at })),
      order: finer ? 5 - list.length / 100 : 1 - list.length / 100,
      now: !finer && list.length >= 10,
    })
  }
  return [...fromThreads, ...fromItems, ...confusions(s, index)].sort((a, b) => a.order - b.order)
}

// Branches items keep landing between: the tree has a hole or an overlap there. Ask once; the answer sharpens every filing.
function confusions(s, index) {
  const pairs = {}
  for (const i of Object.values(s.items)) {
    if (!(needsReview(i) || i.finer) || i.by === 'owner') continue
    const g = i.finer?.branch || i.branch
    const other = i.disagree ? i.claudeBranch : i.alts?.[0]?.p >= 0.15 ? i.alts[0].branch : null
    if (!other || other === 'none' || g === 'none' || !index.has(other) || !index.has(g) || within(index, g, other) || within(index, other, g)) continue
    const key = [g, other].sort().join('|')
    ;(pairs[key] ||= []).push(i)
  }
  return Object.entries(pairs).filter(([k, list]) => list.length >= 5 && !s.resolvedPairs[k] && !s.snoozed['b:' + k])
    .sort((a, b) => b[1].length - a[1].length).slice(0, 8)
    .map(([k, list]) => {
      const [a, b] = k.split('|').map(x => ({ id: x, name: pathName(index, x), desc: index.get(x).desc || '' }))
      return {
        id: 'b:' + k, kind: 'tree', a, b, count: list.length,
        q: `${list.length} items keep landing between ${a.name.split(' › ').at(-1)} and ${b.name.split(' › ').at(-1)}. Are they the same thing, or how do they differ?`,
        examples: list.slice(0, 5).map(i => i.text),
        order: 0.5 - list.length / 1000, now: true,
      }
    })
}
const placeQ = (i, index) => ({
  id: 'i:' + i.id, kind: 'place', item: i.id, q: i.text, context: i.context, quote: i.quote, call: i.call, at: i.at, date: i.date,
  guess: i.branch, guessName: pathName(index, i.branch), conf: i.conf, why: reviewWhy(i), mixed: i.mixed,
  alts: (i.alts || []).map(a => ({ ...a, name: pathName(index, a.branch) })), newBranch: i.new_branch,
  order: 1.5 + (1 - (i.conf || 0)) * 0.5,
})
const reviewWhy = i => i.mixed ? `Uses a word two ways: ${i.mixed}`
  : i.disagree ? `Two readers disagree: Jev says one branch, Claude another`
  : `${Math.round((i.conf || 0) * 100)}% sure, under the ${Math.round(FILE_AT * 100)}% bar`

export function view(id) {
  const s = load(id), lib = LIBS.get(id), index = flat(s.tree.branches)
  // Per branch, counted up to every parent: filed items, and the question cards waiting on you there (same cards as the list).
  const byBranch = {}
  const bump = (bid, key) => { for (const p of pathOf(index, bid)) { const b = (byBranch[p.id] ||= { items: 0, need: 0, now: 0 }); b[key]++ } }
  for (const i of Object.values(s.items)) if (i.filed && !i.dup && i.branch !== 'none') bump(i.branch, 'items')
  const qs = questions(id)
  for (const q of qs) for (const bid of q.kind === 'thread' ? [s.threads[q.thread].branch] : q.kind === 'tree' ? [q.a.id, q.b.id] : q.kind === 'group' ? [q.branch] : [q.guess]) {
    bump(bid, 'need'); if (q.now) bump(bid, 'now')
  }
  return {
    id, name: lib.name, dir: lib.dir, sources: lib.sources, fileAt: FILE_AT, jev: JEV_AVAILABLE,
    tree: s.tree, byBranch, counts: counts(s), calls: Object.values(s.calls).sort((a, b) => b.date.localeCompare(a.date)),
    items: s.items, threads: s.threads, crosslinks: s.crosslinks, answers: s.answers.slice(-50), questions: qs,
    job: s.job, version: s.version, estimate: estimate(s),
    pending: s.corrections.filter(c => c.at > (s.refreshedAt || '')).length + (s.treeChangedAt > (s.refreshedAt || '') ? 1 : 0),
  }
}

// ---------- scan: find new conversation files, skip exact duplicates ----------
export function scan(id) {
  const s = load(id), lib = LIBS.get(id)
  const seen = new Map(Object.values(s.calls).filter(c => !c.dupOf).map(c => [c.hash, c.file]))
  let added = 0
  // A source is a folder of calls, or one file (e.g. a project note that records decisions made off the record).
  const files = lib.sources.filter(existsSync).flatMap(src => statSync(src).isDirectory()
    ? readdirSync(src).filter(f => KINDS.includes(extname(f).toLowerCase()) && !f.startsWith('.')).sort().map(f => [src, f])
    : [[dirname(src), basename(src)]])
  for (const [dir, f] of files) {
    {
      const known = Object.values(s.calls).find(c => c.file === f && c.dir === dir)
      let c
      try { c = parseFile(join(dir, f)) } catch (e) { if (!known) s.calls['err-' + f] = { id: 'err-' + f, file: f, dir, date: '', status: 'error', error: e.message }; continue }
      if (known && known.hash === c.hash) continue
      // A file that changed (a project note gets updated) replaces its earlier reading.
      if (known) { for (const i of Object.values(s.items)) if (i.call === known.id) delete s.items[i.id]; delete s.calls[known.id]; seen.delete(known.hash) }
      const { text, ...meta } = c
      const dupOf = seen.get(c.hash)
      const callId = dupOf && dupOf !== f ? `${c.hash}~${f}` : c.hash
      if (s.calls[callId]) continue
      s.calls[callId] = { id: callId, ...meta, dir, chars: text.length, note: !meta.speakers.length && /\.(md|txt)$/i.test(f), status: dupOf && dupOf !== f ? 'dup' : 'new', dupOf: dupOf && dupOf !== f ? dupOf : null, items: 0 }
      if (!dupOf) { seen.set(c.hash, f); added++ }
    }
  }
  save(id)
  return { added, ...counts(s) }
}

// Rough cost of reading the new calls on Sonnet: the transcript plus the tree in, about a fifth back out.
function estimate(s) {
  const calls = Object.values(s.calls).filter(c => c.status === 'new')
  const tree = JSON.stringify(s.tree.branches).length / 3
  const chars = calls.reduce((a, c) => a + c.chars, 0)
  const tokens = chars / 4 + calls.length * tree / 4
  return { calls: calls.length, usd: Math.round((tokens * SONNET_IN + chars / 4 * 0.25 * SONNET_OUT + calls.length * 0.05) * 100) / 100 }
}

// ---------- process: read new calls, file their items, rebuild threads where items landed, weigh questions ----------
// `only`: read just the calls whose file name contains this text (a test run on one call).
export function processLibrary(id, { model, only } = {}) {
  const s = load(id)
  if (s.job?.running) throw new Error('Already processing')
  model = resolveModel(model || 'claude-sonnet-5-5')
  s.job = { running: true, stage: 'Reading calls', done: 0, total: 0, started: new Date().toISOString(), log: [], model }
  save(id)
  pipeline(id, model, only).catch(e => note(id, `Stopped: ${e.message}`)).finally(() => { s.job.running = false; s.job.stage = 'Done'; save(id, true) })
  return s.job
}

export function stop(id) { const s = load(id); if (s.job?.running) { s.job.stop = true; note(id, 'Stopping after the calls in flight') } }

function note(id, text) {
  const s = load(id)
  s.job.log.push({ t: new Date().toISOString(), text })
  if (s.job.log.length > 60) s.job.log.shift()
  save(id)
}

async function pool(list, n, fn) {
  const queue = [...list]
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => { while (queue.length) await fn(queue.shift()) }))
}

async function pipeline(id, model, only) {
  const s = load(id), lib = LIBS.get(id)
  const todo = Object.values(s.calls).filter(c => (c.status === 'new' || c.status === 'error' && c.hash) && (!only || c.file.includes(only)))
  const parts = todo.flatMap(c => {
    const text = parseFile(join(c.dir, c.file)).text
    const cs = chunks(text)
    return cs.map((t, i) => ({ call: c, part: i + 1, parts: cs.length, text: t }))
  })
  s.job.total = parts.length
  s.job.stage = `Reading ${todo.length} call(s)`
  note(id, `Reading ${todo.length} call(s) in ${parts.length} part(s) with ${model}`)
  const fresh = []
  const index = () => flat(s.tree.branches)
  const done = new Map()
  await pool(parts, CONCURRENCY, async p => {
    if (s.job.stop) return
    try {
      const res = await callModel({
        model, system: SYSTEM, kind: 'extract', schema: SCHEMAS.extract,
        prompt: extractPrompt({ library: lib, call: p.call, part: p.part, parts: p.parts, text: p.text, tree: s.tree.branches, glossary: glossary(s) }),
      })
      s.cost += res.cost
      const idx = index()
      for (const it of res.out.items) {
        const iid = `${p.call.hash.slice(0, 6)}-${++s.seq}`
        const branch = idx.has(it.branch) ? it.branch : 'none'
        s.items[iid] = {
          id: iid, call: p.call.id, file: p.call.file, date: p.call.date, part: p.part, ...(p.call.note ? { note: true } : {}), ...it,
          claudeBranch: branch, claudeConf: it.confidence, branch, conf: it.confidence, placed: false, filed: false,
        }
        fresh.push(iid)
      }
      p.call.summary = [p.call.summary, res.out.summary].filter(Boolean).join(' ')
      p.call.items = (p.call.items || 0) + res.out.items.length
      done.set(p.call.id, (done.get(p.call.id) || 0) + 1)
      if (done.get(p.call.id) === p.parts) p.call.status = 'done'
      s.job.done++
      note(id, `${p.call.title}${p.parts > 1 ? ` (${p.part}/${p.parts})` : ''}: ${res.out.items.length} items`)
    } catch (e) {
      p.call.status = 'error'; p.call.error = String(e.message || e).slice(0, 300)
      s.job.done++
      note(id, `${p.call.title}: failed (${p.call.error.slice(0, 120)})`)
    }
  })
  // A call that failed part-way keeps the items it got and is read again next time.
  for (const c of todo) if (c.status === 'error') for (const i of Object.values(s.items)) if (i.call === c.id) delete s.items[i.id]

  await placeItems(id, fresh.filter(i => s.items[i]))
  await rebuildThreads(id, model, changedScopes(s, index()))
  await weighQuestions(id)
  note(id, `Done: ${fresh.length} new items, ${counts(s).review} to check, ${counts(s).open} open threads. Spent $${s.cost.toFixed(2)} so far.`)
}

// Words used in more than one sense across the record, so the next read keeps them apart.
function glossary(s) {
  const senses = {}
  for (const i of Object.values(s.items)) for (const t of i.terms || []) {
    const k = t.term.toLowerCase().trim()
    ;(senses[k] ||= new Set()).add(t.sense.toLowerCase().trim())
  }
  return Object.entries(senses).filter(([, v]) => v.size > 1).slice(0, 40).map(([term, v]) => ({ term, senses: [...v].slice(0, 4) }))
}

// ---------- place: Jev walks the tree one level at a time; the path's probability is the confidence ----------
const PLACE_BATCH = 20
async function placeItems(id, ids) {
  const s = load(id)
  if (!ids.length) return
  s.job.stage = `Filing ${ids.length} item(s)`
  const index = flat(s.tree.branches)
  if (!JEV_AVAILABLE) {
    for (const iid of ids) { settle(s.items[iid], s.items[iid].claudeBranch, s.items[iid].claudeConf ?? 0, [], 'claude', index); s.items[iid].ctx = ctxKey(s) }
    note(id, 'Filed with Claude\'s own confidence (no Jev key set)')
    return save(id)
  }
  // Your corrections teach the filing: a few per branch, newest first, so one big batch doesn't drown the rest.
  const per = {}
  const examples = s.corrections.slice().reverse().filter(c => index.has(c.branch) && ((per[c.branch] = (per[c.branch] || 0) + 1) <= 2)).slice(0, 40)
    .map(c => `"${c.text}" belongs in ${pathName(index, c.branch)}`)
  // Each item starts at the top with probability 1 and walks down while the best child is clearer than "right here".
  let walking = ids.map(iid => ({ iid, at: null, p: 1, path: [], alts: [] }))
  for (let depth = 0; walking.length && depth < 8; depth++) {
    const groups = {}
    for (const w of walking) (groups[w.at ?? '_root'] ||= []).push(w)
    const next = []
    for (const [at, ws] of Object.entries(groups)) {
      const node = at === '_root' ? null : index.get(at)
      const kids = node ? node.children || [] : s.tree.branches
      if (!kids.length) { ws.forEach(w => finish(w)); continue }
      const criteria = Object.fromEntries(kids.map(k => [k.id, `${k.name}${k.desc ? ': ' + k.desc : ''}`]))
      if (node) criteria.here = `${node.name} in general, not one particular part of it`
      else criteria.none = 'Not about this business (personal, small talk, other ventures)'
      for (let b = 0; b < ws.length; b += PLACE_BATCH) {
        const batch = ws.slice(b, b + PLACE_BATCH)
        const state = {
          business: s.tree.name, branch: node ? pathName(index, node.id) : 'the whole business',
          items: batch.map(w => { const i = s.items[w.iid]; return `${i.text} (context: ${i.context})` }),
          ...(examples.length ? { past_corrections: examples } : {}),
        }
        const questions = Object.fromEntries(batch.map((w, k) => [`q${k}`, { type: 'choice', instructions: `Where in \`branch\` does \`items[${k}]\` belong?`, criteria }]))
        let r
        try { r = await jevAsk(state, questions) } catch (e) { note(id, `Jev failed, Claude's filing stands for ${batch.length} item(s): ${e.message.slice(0, 80)}`); batch.forEach(w => (w.fail = true, finish(w))); continue }
        s.cost += r.cost
        batch.forEach((w, k) => {
          const probs = Object.entries(r.a[`q${k}`].probabilities).sort((a, b) => b[1] - a[1])
          const [best, pb] = probs[0]
          if (probs[1] && probs[1][1] > 0.02) w.alts.push({ branch: probs[1][0] === 'here' ? at : probs[1][0], p: w.p * probs[1][1] })
          w.p *= pb
          if (best === 'here' || best === 'none') { w.at = best === 'none' ? 'none' : at; return finish(w) }
          w.at = best; w.path.push({ id: best, p: w.p })
          next.push(w)
        })
      }
    }
    walking = next
  }
  walking.forEach(finish)
  const ctx = ctxKey(s)
  for (const iid of ids) if (s.items[iid]) s.items[iid].ctx = ctx
  function finish(w) {
    const i = s.items[w.iid]
    if (w.fail) return settle(i, i.claudeBranch, i.claudeConf ?? 0, [], 'claude', index)
    settle(i, w.at || 'none', w.p, w.alts.filter(a => a.branch && a.branch !== '_root').sort((a, b) => b.p - a.p).slice(0, 3), 'jev', index, w.path)
  }
  save(id)
}

// Nothing is filed below the bar: an item files at the deepest branch its path clears it at. If Jev's best branch sits
// deeper than that, it is kept as the finer guess for a quick confirm; if no level clears the bar, a person decides.
function settle(i, guess, conf, alts, by, index, path = []) {
  const c = i.claudeBranch
  const agree = by === 'claude' || guess === c || (guess !== 'none' && c !== 'none' && (within(index, guess, c) || within(index, c, guess)))
  if (c !== guess && !alts.some(a => a.branch === c) && c !== 'none') alts = [...alts, { branch: c, p: i.claudeConf ?? 0, by: 'claude' }].slice(0, 4)
  const clears = by === 'jev' ? path.filter(x => x.p >= FILE_AT).at(-1) : (conf >= FILE_AT ? { id: guess, p: conf } : null)
  const top = guess === 'none' ? (conf >= FILE_AT ? { id: 'none', p: conf } : null) : clears
  Object.assign(i, { guess, guessConf: Math.round(conf * 1000) / 1000, alts, by, placed: true, disagree: !agree })
  i.offtopic = guess === 'none' && conf >= FILE_AT && c === 'none'
  i.filed = !i.offtopic && !!top && agree && !i.mixed
  i.branch = i.filed ? top.id : guess
  i.conf = Math.round((i.filed ? top.p : conf) * 1000) / 1000
  i.finer = i.filed && top.id !== guess ? { branch: guess, p: i.guessConf } : null
}

// ---------- threads: the same topic across every call, with where it stands ----------
async function rebuildThreads(id, model, scopes) {
  const s = load(id), lib = LIBS.get(id)
  const index = flat(s.tree.branches)
  scopes.delete('none')
  if (!scopes.size) return
  s.job.stage = `Tying topics together in ${scopes.size} branch(es)`
  s.job.total += scopes.size
  await pool([...scopes], CONCURRENCY, async scope => {
    if (s.job.stop) return
    const items = Object.values(s.items).filter(i => threadable(i) && scopeOf(index, home(i)) === scope)
      .sort((a, b) => a.date.localeCompare(b.date))
    const existing0 = Object.values(s.threads).filter(t => t.scope === scope)
    if (!items.length) { existing0.forEach(t => delete s.threads[t.id]); delete s.scopeSig[scope]; s.job.done++; return }
    const existing = Object.values(s.threads).filter(t => t.scope === scope)
    try {
      const res = await callModel({ model, system: SYSTEM, kind: 'threads', schema: SCHEMAS.threads, prompt: threadsPrompt({ library: lib, path: pathName(index, scope), items, existing }) })
      s.cost += res.cost
      const answered = new Map(existing.filter(t => t.answeredBy).map(t => [t.id, t]))
      for (const t of existing) delete s.threads[t.id]
      for (const t of res.out.threads) {
        const its = t.items.filter(x => s.items[x])
        if (!its.length) continue
        // The thread sits at the branch most of its items sit at.
        const tally = {}
        its.forEach(x => (tally[home(s.items[x])] = (tally[home(s.items[x])] || 0) + 1))
        const branch = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0]
        const prev = answered.get(t.id)
        s.threads[t.id] = {
          ...t, items: its, scope, branch, unconfirmed: its.filter(x => !s.items[x].filed).length,
          first: s.items[its[0]].date, last: its.map(x => s.items[x].date).sort().at(-1),
          ...(prev && t.status !== 'decided' ? { status: 'decided', decision: prev.decision, answeredBy: prev.answeredBy, answeredAt: prev.answeredAt } : {}),
          ...(prev && t.status === 'decided' ? { answeredBy: prev.answeredBy, answeredAt: prev.answeredAt } : {}),
        }
      }
      s.scopeSig[scope] = sig(items)
      s.job.done++
      note(id, `${pathName(index, scope)}: ${res.out.threads.length} thread(s)`)
    } catch (e) {
      s.job.done++
      note(id, `${pathName(index, scope)}: threads failed (${String(e.message).slice(0, 120)})`)
    }
  })
  save(id)
}

const sig = items => items.map(i => i.id).sort().join(',')
// Topic groups whose items changed since their topics were last written (new, moved or confirmed elsewhere).
function changedScopes(s, index) {
  const now = {}
  for (const i of Object.values(s.items)) if (threadable(i)) (now[scopeOf(index, home(i))] ||= []).push(i)
  const out = new Set(Object.keys(now).filter(k => s.scopeSig[k] !== sig(now[k])))
  for (const k of Object.keys(s.scopeSig)) if (!now[k]) out.add(k)
  for (const t of Object.values(s.threads)) if (!now[t.scope]) out.add(t.scope)
  return out
}

// Jev drops the weight of questions whose answer would not change anything.
async function weighQuestions(id) {
  const s = load(id)
  if (!JEV_AVAILABLE) return
  const ts = Object.values(s.threads).filter(t => ['unsettled', 'open', 'assumed'].includes(t.status) && t.question?.q && t.weight === undefined)
  for (let b = 0; b < ts.length; b += 25) {
    const batch = ts.slice(b, b + 25)
    const questions = Object.fromEntries(batch.map((t, k) => [`w${k}`, { type: 'noul', instructions: `Would the owner's answer to \`questions[${k}]\` change what ${s.tree.name} builds, sends, charges or decides next?` }]))
    try {
      const r = await jevAsk({ business: s.tree.name, questions: batch.map(t => `${t.question.q} (topic: ${t.title}; ${t.summary})`) }, questions)
      s.cost += r.cost
      batch.forEach((t, k) => (t.weight = r.a[`w${k}`].noul))
    } catch { break }
  }
  save(id)
}

// ---------- answers: settle a thread, or confirm where an item belongs (and teach the filing) ----------
export function answer(id, { qid, text, branch, newBranch, skip, items }) {
  const s = load(id), index = flat(s.tree.branches)
  const at = new Date().toISOString()
  if (skip) {
    if (items?.length) for (const x of items) s.snoozed[(qid.startsWith('f:') ? 'f:' : 'i:') + x] = at
    else s.snoozed[qid] = at
    save(id); return { ok: true }
  }
  const [kind, key] = [qid.slice(0, 1), qid.slice(2)]
  if (kind === 'b') return sharpen(id, key, arguments[1])
  if (kind === 't') {
    const t = s.threads[key]
    if (!t) throw new Error('No such thread')
    if (!text?.trim()) throw new Error('Write an answer, or skip')
    Object.assign(t, { status: 'decided', decision: text.trim(), answeredBy: 'owner', answeredAt: at })
    s.answers.push({ at, thread: key, title: t.title, q: t.question?.q, a: text.trim(), where: pathName(index, t.branch) })
  } else {
    const i = s.items[key]
    if (!i) throw new Error('No such item')
    let target = branch
    if (newBranch?.name) {
      const parent = index.get(newBranch.parent)
      if (!parent) throw new Error('Pick where the new branch goes')
      const slug = newBranch.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)
      target = `${parent.id}.${slug}`
      const node = findNode(s.tree.branches, parent.id)
      if (!index.has(target)) (node.children ||= []).push({ id: target, name: newBranch.name.trim(), desc: newBranch.desc || '', from: 'review', added: at.slice(0, 10) })
      s.treeChangedAt = at
    }
    if (!target || (target !== 'none' && !flat(s.tree.branches).has(target))) throw new Error('Pick a branch')
    Object.assign(i, { branch: target, conf: 1, by: 'owner', filed: target !== 'none', offtopic: target === 'none', disagree: false, finer: null })
    s.corrections.push({ at, text: i.text, branch: target })
    s.answers.push({ at, item: key, q: i.text, a: pathName(flat(s.tree.branches), target) })
  }
  save(id)
  return { ok: true }
}
// Merge two branches into one, or write how they differ into both descriptions. Then "Update" files everything again.
function sharpen(id, key, { merge, describe }) {
  const s = load(id), index = flat(s.tree.branches), at = new Date().toISOString()
  const [a, b] = key.split('|')
  if (merge) {
    const keep = merge, gone = merge === a ? b : a
    const parentOf = index.get(gone).parent
    const list = parentOf ? findNode(s.tree.branches, parentOf).children : s.tree.branches
    const node = list.splice(list.findIndex(n => n.id === gone), 1)[0]
    const into = findNode(s.tree.branches, keep)
    ;(into.children ||= []).push(...(node.children || []))
    into.desc = [into.desc, `Includes what was "${node.name}".`].filter(Boolean).join(' ')
    const move = x => x === gone ? keep : x
    for (const i of Object.values(s.items)) {
      i.branch = move(i.branch); i.guess = move(i.guess); i.claudeBranch = move(i.claudeBranch)
      if (i.finer) i.finer.branch = move(i.finer.branch)
      i.alts = (i.alts || []).map(x => ({ ...x, branch: move(x.branch) }))
    }
    for (const t of Object.values(s.threads)) t.branch = move(t.branch)
    for (const c of s.corrections) c.branch = move(c.branch)
    s.answers.push({ at, q: `Merge ${node.name} into ${into.name}?`, a: 'Merged' })
  } else {
    for (const [bid, text] of Object.entries(describe || {})) {
      if (!text?.trim() || ![a, b].includes(bid)) continue
      const n = findNode(s.tree.branches, bid)
      n.desc = text.trim()
    }
    s.answers.push({ at, q: `How do ${pathName(index, a)} and ${pathName(index, b)} differ?`, a: Object.values(describe || {}).join(' / ') })
  }
  s.resolvedPairs[key] = at
  s.treeChangedAt = at
  save(id)
  return { ok: true }
}

const findNode = (nodes, id) => { for (const n of nodes) { if (n.id === id) return n; const f = findNode(n.children || [], id); if (f) return f } return null }

// What filing again retries: items still waiting, and items whose branch is gone. Filed items stay put, so scores
// that wobble near the bar never un-file something; your answers and tree changes are what move them.
// A waiting item is judged again only when what it is judged against changed (the tree, or your corrections);
// asking the same question twice would just re-roll the score until noise crosses the bar.
const ctxKey = s => `${s.treeChangedAt || ''}|${s.corrections.length}`
const retry = s => {
  const index = flat(s.tree.branches), ctx = ctxKey(s)
  return Object.values(s.items).filter(i => i.by !== 'owner' && i.placed &&
    ((!i.filed && i.ctx !== ctx) || !index.has(i.branch) || (i.finer && !index.has(i.finer.branch)))).map(i => i.id)
}

// File again what is still waiting, e.g. after the tree changed.
export async function refile(id) {
  const s = load(id)
  if (s.job?.running) throw new Error('Already processing')
  s.tree = (() => { try { return JSON.parse(readFileSync(join(LIBS.get(id).dir, 'tree.json'), 'utf8')) } catch { return s.tree } })()
  const ids = retry(s)
  s.job = { running: true, stage: 'Filing again', done: 0, total: 0, started: new Date().toISOString(), log: [], model: '' }
  try { await placeItems(id, ids); note(id, `Filed ${ids.length} item(s) again: ${counts(s).filed} filed, ${counts(s).review} to check`) }
  finally { s.job.running = false; s.job.stage = 'Done'; save(id, true) }
  return counts(s)
}

// Confirm many at once: every item in the list goes where it was guessed.
export function confirmAll(id, { items }) {
  const s = load(id), at = new Date().toISOString()
  for (const key of items || []) {
    const i = s.items[key]
    if (!i || !(needsReview(i) || i.finer)) continue
    const branch = i.finer ? i.finer.branch : i.branch
    Object.assign(i, { branch, conf: 1, by: 'owner', filed: branch !== 'none', offtopic: branch === 'none', disagree: false, finer: null })
    s.corrections.push({ at, text: i.text, branch })
  }
  s.answers.push({ at, q: `${(items || []).length} items confirmed together`, a: 'as guessed' })
  save(id)
  return counts(s)
}

// After answers or tree changes: file again what you haven't confirmed (Jev, cheap), then rewrite only the topics whose items moved.
export async function refresh(id, { model } = {}) {
  const s = load(id)
  if (s.job?.running) throw new Error('Already processing')
  s.job = { running: true, stage: 'Filing again', done: 0, total: 0, started: new Date().toISOString(), log: [], model: resolveModel(model || 'claude-sonnet-5-5') }
  save(id)
  ;(async () => {
    await placeItems(id, retry(s))
    note(id, `Filed again: ${counts(s).filed} filed, ${counts(s).review} to check`)
    await rebuildThreads(id, s.job.model, changedScopes(s, flat(s.tree.branches)))
    await weighQuestions(id)
    s.refreshedAt = new Date().toISOString()
  })().catch(e => note(id, `Stopped: ${e.message}`)).finally(() => { s.job.running = false; s.job.stage = 'Done'; save(id, true) })
  return s.job
}

// ---------- cross-check: what was worked out in one place that applies somewhere else ----------
export function crosscheck(id, { model } = {}) {
  const s = load(id), lib = LIBS.get(id), index = flat(s.tree.branches)
  if (s.job?.running) throw new Error('Already processing')
  model = resolveModel(model || 'claude-opus-5-5')
  s.job = { running: true, stage: 'Cross-checking every branch', done: 0, total: 1, started: new Date().toISOString(), log: [], model }
  save(id)
  ;(async () => {
    const threads = Object.values(s.threads).map(t => ({ ...t, path: pathName(index, t.branch) }))
    const res = await callModel({ model, system: SYSTEM, kind: 'crosscheck', schema: SCHEMAS.crosscheck, prompt: crosscheckPrompt({ library: lib, threads }) })
    s.cost += res.cost
    const at = new Date().toISOString()
    s.crosslinks = res.out.links.map((l, k) => ({ ...l, id: `x${Date.now()}-${k}`, at, fromName: s.threads[l.from]?.title || pathName(index, l.from), toName: s.threads[l.to]?.title || pathName(index, l.to) }))
    s.crosscheckSummary = res.out.summary
    s.job.done = 1
    note(id, `${s.crosslinks.length} link(s) across branches`)
  })().catch(e => note(id, `Cross-check failed: ${e.message}`)).finally(() => { s.job.running = false; s.job.stage = 'Done'; save(id, true) })
  return s.job
}

// ---------- find: where did we talk about X ----------
const words = q => q.toLowerCase().split(/[^a-z0-9$%.-]+/).filter(w => w.length > 2 && !STOP.has(w))
const STOP = new Set('the and for that this with what where when did was were about have has from into our you your are how why who which talk talked said say'.split(' '))
export function search(id, q) {
  const s = load(id), index = flat(s.tree.branches)
  const ws = words(q)
  if (!ws.length) return { items: [], threads: [], senses: [] }
  const score = text => { const t = text.toLowerCase(); return ws.reduce((a, w) => a + (t.includes(w) ? 1 : 0), 0) }
  const items = Object.values(s.items).filter(i => !i.dup)
    .map(i => ({ i, sc: score(`${i.text} ${i.context} ${i.quote} ${(i.terms || []).map(t => t.term + ' ' + t.sense).join(' ')}`) }))
    .filter(x => x.sc > 0).sort((a, b) => b.sc - a.sc || b.i.date.localeCompare(a.i.date)).slice(0, 120)
    .map(({ i }) => ({ ...i, where: pathName(index, i.branch) }))
  const threads = Object.values(s.threads).map(t => ({ t, sc: score(`${t.title} ${t.summary} ${t.decision}`) })).filter(x => x.sc > 0)
    .sort((a, b) => b.sc - a.sc).slice(0, 30).map(({ t }) => ({ ...t, where: pathName(index, t.branch) }))
  // Group by the sense a searched word was used in, so "ceiling" (cost) and "ceiling" (damage) come apart.
  const senses = {}
  for (const i of items) for (const t of i.terms || []) if (ws.some(w => t.term.toLowerCase().includes(w))) (senses[`${t.term.toLowerCase()} — ${t.sense.toLowerCase()}`] ||= []).push(i.id)
  return { items, threads, senses: Object.entries(senses).map(([sense, ids]) => ({ sense, ids })).sort((a, b) => b.ids.length - a.ids.length) }
}

export async function ask(id, question, { model } = {}) {
  const s = load(id), lib = LIBS.get(id)
  const found = search(id, question)
  if (!found.items.length && !found.threads.length) return { answer: 'Nothing in the record matches those words yet.', cites: [], gaps: [question] }
  const res = await callModel({
    model: resolveModel(model || 'claude-sonnet-5-5'), system: SYSTEM, kind: 'ask', schema: SCHEMAS.ask,
    prompt: askPrompt({ library: lib, question, items: found.items.slice(0, 80).map(i => ({ ...i, call: i.file })), threads: found.threads.map(t => ({ ...t, path: t.where })) }),
  })
  s.cost += res.cost
  save(id)
  return res.out
}
