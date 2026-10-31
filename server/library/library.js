// Conversations mode: every recorded call read into items, each item filed on the business tree (SOPs within SOPs),
// the same topic tied together across calls, and one short list of what still needs the owner.
// Claude reads and writes; Jev walks the tree level by level as a second reader. An item can touch several branches
// (its links); it lives at one (its home). Whether a home counts as filed is measured: each way of agreeing is a rule,
// your spot checks say how often each rule is right, and a rule files on its own once it is right 95% of the time.
import { EventEmitter } from 'node:events'
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync, statSync } from 'node:fs'
import { join, extname, dirname, basename } from 'node:path'
import { callModel, resolveModel } from '../models.js'
import { config } from '../store.js'
import { JEV_AVAILABLE, jevAsk } from '../jev.js'
import { parseFile, chunks, KINDS } from './parse.js'
import { aiStatus } from '../ai.js'
import { SCHEMAS, SYSTEM, extractPrompt, linksPrompt, threadsPrompt, crosscheckPrompt, askPrompt, suggestPrompt } from './prompts.js'
import { writeMarkdown } from './export.js'
import { questionBranches } from '../../shared/library-questions.js'

export const bus = new EventEmitter()
bus.setMaxListeners(100)

export const TARGET = 0.95 // a rule files on its own once your spot checks find it right this often
const MIN_CHECKS = 20, CHECK_EVERY = 50, SPOT = 10 // checks per rule: 20 to trust it, then one per 50 items it files
const CONCURRENCY = 3, LINK_BATCH = 60

// Libraries come from ~/.thinking-system/config.json: { "libraries": [{ "id", "name", "sources": [folders], "dir", "names"? }] }; "names" maps real names to labels, scrubbed before reading.
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
export function save(id, now = false) {
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
    guessed: items.filter(i => i.placed && !i.filed && i.branch !== 'none').length,
    links: items.reduce((a, i) => a + (i.links?.length || 0), 0),
    threads: Object.keys(s.threads).length,
    open: Object.values(s.threads).filter(t => ['unsettled', 'open', 'assumed'].includes(t.status)).length,
    cost: s.cost,
  }
}
// Every placed item has a home. Topics use every item; the ones not yet filed are counted as best guesses.
const home = i => i.branch
const threadable = i => i.placed && !i.dup && i.branch !== 'none'

// The one list of what still needs the owner: unsettled topics, one spot check of filings, tree overlaps, then the rest.
// Filing is never asked item by item (that grows with every call); the spot check is a sample, sized by how much each rule files.
export function questions(id) {
  const s = load(id), index = flat(s.tree.branches)
  const rank = { unsettled: 0, open: 2, assumed: 3 }
  const fromThreads = Object.values(s.threads)
    .filter(t => rank[t.status] !== undefined && t.question?.q)
    .map(t => ({
      id: 't:' + t.id, kind: 'thread', thread: t.id, status: t.status, q: t.question.q, why: t.question.why, options: t.question.options,
      where: pathName(index, t.branch), ways: t.ways, items: t.items.length, weight: t.weight ?? 0.5,
      order: rank[t.status] - (t.weight ?? 0.5) - Math.min(t.items.length, 10) / 20,
      now: t.status === 'unsettled' || (t.weight ?? 0.5) >= 0.8,
    }))
  // Only items that use one word two ways are asked one by one: no rule can tell which sense was meant.
  const fromItems = Object.values(s.items).filter(i => i.rule === 'mixed' && i.by !== 'owner' && !i.dup).map(i => placeQ(i, index))
  const checks = [spotCheck(s, index), spotCheck(s, index, true)].filter(Boolean)
  return [...fromThreads, ...checks, ...fromItems, ...confusions(s, index)]
    .map(q => s.snoozed[q.id] ? { ...q, now: false, skipped: true } : q)
    .sort((a, b) => a.order - b.order)
}

// Branches items keep landing between: the tree has a hole or an overlap there. Ask once; the answer sharpens every filing.
function confusions(s, index) {
  const pairs = {}
  for (const i of Object.values(s.items)) {
    // Only where the two readers truly split; an item that touches both branches is a link, not an overlap.
    if (i.by === 'owner' || !['split', 'shared'].includes(i.rule)) continue
    const g = i.guess, other = i.claudeBranch
    if (!other || other === 'none' || g === 'none' || !index.has(other) || !index.has(g) || within(index, g, other) || within(index, other, g)) continue
    const key = [g, other].sort().join('|')
    ;(pairs[key] ||= []).push(i)
  }
  return Object.entries(pairs).filter(([k, list]) => list.length >= 5 && !s.resolvedPairs[k])
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
const reviewWhy = i => `Uses a word two ways: ${i.mixed}`

// ---------- filing rules: how Jev's and Claude's picks relate decides the home; spot checks decide if that rule files ----------
export const RULES = {
  same: 'Jev and Claude picked the same branch, Jev 50% sure or more',
  'same-low': 'Jev and Claude picked the same branch, Jev under 50% sure',
  nested: "One picked a part of the other's branch: filed at the part",
  shared: 'Same area, different parts: filed at the area',
  linked: "Different branches, and Claude says it touches both: home at Claude's, linked to Jev's",
  split: "Jev and Claude disagree: Claude's pick",
  none: 'Both say it is not about this business',
  claude: 'Claude alone (Jev was not available)',
}
const related = (index, a, b) => a === b || within(index, a, b) || within(index, b, a)
const common = (index, a, b) => { const pa = pathOf(index, a).map(n => n.id); return pathOf(index, b).map(n => n.id).filter(x => pa.includes(x)).at(-1) || null }

// Home and links from the two readers' picks. Pure: re-running it on stored picks costs nothing.
function settle(i, index) {
  if (i.by === 'owner') return
  const c = index.has(i.claudeBranch) ? i.claudeBranch : 'none'
  const j = i.by === 'claude' ? null : index.has(i.guess) ? i.guess : 'none'
  const also = (i.also || []).filter(x => index.has(x))
  const both = j && j !== 'none' && c !== 'none'
  let rule, branch
  if (i.mixed) [rule, branch] = ['mixed', c !== 'none' ? c : j || 'none']
  else if (!j) [rule, branch] = ['claude', c]
  else if (j === 'none' && c === 'none') [rule, branch] = ['none', 'none']
  else if (j === c) [rule, branch] = [i.guessConf >= 0.5 ? 'same' : 'same-low', c]
  else if (both && related(index, j, c)) [rule, branch] = ['nested', index.get(j).depth >= index.get(c).depth ? j : c]
  else if (both && common(index, j, c)) [rule, branch] = ['shared', common(index, j, c)]
  else if (j !== 'none' && also.some(a => related(index, a, j))) [rule, branch] = ['linked', c]
  else [rule, branch] = ['split', c !== 'none' ? c : j]
  const links = branch === 'none' ? [] : [...new Set([...also, ...(rule === 'linked' ? [j] : [])])].filter(x => !related(index, x, branch))
  Object.assign(i, { rule, branch, links, placed: true })
  delete i.finer; delete i.disagree
}

// How often each rule has been right in your spot checks. A checked item counts under the rule it was filed by.
export function ruleStats(s) {
  const st = Object.fromEntries(Object.entries(RULES).map(([rule, label]) => [rule, { rule, label, items: 0, checked: 0, wrong: 0 }]))
  for (const i of Object.values(s.items)) {
    const x = !i.dup && i.placed && st[i.check?.rule || i.rule]
    if (!x) continue
    x.items++
    if (i.check) { x.checked++; if (!i.check.ok) x.wrong++ }
  }
  for (const x of Object.values(st)) {
    x.need = Math.max(MIN_CHECKS, Math.ceil(x.items / CHECK_EVERY))
    x.right = x.checked ? (x.checked - x.wrong) / x.checked : null
    x.trusted = x.checked >= MIN_CHECKS && x.right >= TARGET
  }
  return st
}
function applyTrust(s) {
  const st = ruleStats(s)
  for (const i of Object.values(s.items)) {
    if (!i.placed || i.by === 'owner') continue
    i.filed = i.branch !== 'none' && !!st[i.rule]?.trusted
    i.offtopic = i.branch === 'none' && !!st.none.trusted
  }
}
function resettle(s) {
  const index = flat(s.tree.branches)
  for (const i of Object.values(s.items)) if (i.placed) settle(i, index)
  applyTrust(s)
}

// A stable sample (same items until answered), taken across rules so each one gets measured.
const hash = x => { let h = 2166136261; for (const ch of x) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0 }
function spotCheck(s, index, deferred = false) {
  const st = ruleStats(s)
  const pools = Object.values(st).filter(x => x.checked < x.need).sort((a, b) => b.items - a.items).map(x => ({
    x, list: Object.values(s.items).filter(i => i.rule === x.rule && i.by !== 'owner' && !i.dup && !!s.snoozed['s:' + i.id] === deferred)
      .sort((a, b) => hash(a.id) - hash(b.id)).slice(0, x.need - x.checked),
  })).filter(p => p.list.length)
  if (!pools.length) return null
  const pick = []
  for (let k = 0; pick.length < SPOT && pools.some(p => p.list[k]); k++) for (const p of pools) if (p.list[k] && pick.length < SPOT) pick.push(p.list[k])
  const left = pools.reduce((a, p) => a + p.list.length, 0)
  return {
    id: deferred ? 'spot:later' : 'spot', kind: 'spot', q: deferred ? 'Skipped filings: are these in the right place?' : 'Are these in the right place? Review the filings you know; skip the rest.',
    items: pick.map(i => ({ id: i.id, text: i.text, context: i.context, file: i.file, at: i.at, branch: i.branch, where: pathName(index, i.branch), rule: i.rule, links: (i.links || []).map(l => ({ id: l, name: pathName(index, l) })) })),
    rules: Object.values(st).filter(x => x.items), left, order: -5, now: !deferred, skipped: deferred,
  }
}

export function view(id) {
  const s = load(id), lib = LIBS.get(id), index = flat(s.tree.branches)
  // Per branch, counted up to every parent: filed items, and the question cards waiting on you there (same cards as the list).
  const byBranch = {}
  const bump = (bid, key) => { for (const p of pathOf(index, bid)) { const b = (byBranch[p.id] ||= { items: 0, filed: 0, need: 0, now: 0 }); b[key]++ } }
  for (const i of Object.values(s.items)) if (i.placed && !i.dup && i.branch !== 'none') { bump(i.branch, 'items'); if (i.filed) bump(i.branch, 'filed') }
  const qs = questions(id)
  // Someone else has this question open: it shows who, so two people don't answer it.
  const fresh = Date.now() - CLAIM_MIN * 60000
  for (const q of qs) { const c = s.claims?.[q.id]; if (c && c.by !== me(id) && Date.parse(c.at) > fresh) q.claimedBy = c.by }
  for (const q of qs) {
    const ancestors = new Set(questionBranches(q, s.threads).flatMap(bid => pathOf(index, bid).map(n => n.id)))
    for (const bid of ancestors) {
      const b = (byBranch[bid] ||= { items: 0, filed: 0, need: 0, now: 0 })
      b.need++; if (q.now) b.now++
    }
  }
  return {
    id, name: lib.name, dir: lib.dir, sources: lib.sources, target: TARGET, jev: JEV_AVAILABLE, rules: Object.values(ruleStats(s)).filter(x => x.items),
    tree: s.tree, byBranch, counts: counts(s), calls: Object.values(s.calls).sort((a, b) => b.date.localeCompare(a.date)),
    items: s.items, threads: s.threads, crosslinks: s.crosslinks, answers: s.answers.slice(-50), questions: qs,
    job: s.job, version: s.version, estimate: estimate(s, id),
    me: me(id), member: lib.sync?.role === 'member', ai: lib.sync?.role === 'member' ? aiStatus() : { installed: true, loggedIn: true },
    proposals: proposals(s, index), sync: lib.sync ? { repo: lib.sync.repo, role: lib.sync.role, last: s.syncState?.last, error: s.syncState?.error, waiting: (s.outbox || []).length + (s.outfiles || []).length } : null,
    log: (s.log || []).slice(-300).reverse(),
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
      try { c = parseFile(join(dir, f), lib.names) } catch (e) { if (!known) s.calls['err-' + f] = { id: 'err-' + f, file: f, dir, date: '', status: 'error', error: e.message }; continue }
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

// Reading pulls items out (Haiku does it well at a fifth of Sonnet's price); topics weigh what was settled, so Sonnet.
const readModel = id => resolveModel(LIBS.get(id).readModel || 'claude-haiku-5-5')
const topicModel = id => resolveModel(LIBS.get(id).topicModel || 'claude-sonnet-5-5')

// Rough cost of the new calls, from measured runs: reading per 1,000 characters on each model, plus filing and topics per call.
const READ_PER_K = { 'claude-haiku-5-5': 0.0007, 'claude-sonnet-5-5': 0.0037, 'claude-opus-5-5': 0.0185 }
function estimate(s, id) {
  const calls = Object.values(s.calls).filter(c => c.status === 'new')
  const chars = calls.filter(c => !preRead(id, c)).reduce((a, c) => a + c.chars, 0)
  return { calls: calls.length, usd: Math.round((chars / 1000 * (READ_PER_K[readModel(id)] ?? 0.0037) + calls.length * 0.05) * 100) / 100 }
}

// ---------- process: read new calls, file their items, rebuild threads where items landed, weigh questions ----------
// `only`: read just the calls whose file name contains this text (a test run on one call).
export function processLibrary(id, { model, only } = {}) {
  const s = load(id)
  if (s.job?.running) throw new Error('Already processing')
  model = model ? resolveModel(model) : readModel(id)
  s.job = { running: true, stage: 'Reading calls', done: 0, total: 0, started: new Date().toISOString(), log: [], model }
  save(id)
  pipeline(id, model, only).catch(e => note(id, `Stopped: ${e.message}`)).finally(() => { s.job.running = false; s.job.stage = 'Done'; save(id, true); bus.emit('jobdone', id) })
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
    // A teammate already read it with their own AI: take their reading, no model call here.
    const pre = preRead(id, c)
    if (pre) return [{ call: c, part: 1, parts: 1, pre }]
    const text = parseFile(join(c.dir, c.file), lib.names).text
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
      const res = p.pre ? { out: { items: p.pre.items, summary: p.pre.summary, title: p.pre.title }, cost: 0 } : await callModel({
        model, system: SYSTEM, kind: 'extract', schema: SCHEMAS.extract,
        prompt: extractPrompt({ library: lib, call: p.call, part: p.part, parts: p.parts, text: p.text, tree: s.tree.branches, glossary: glossary(s) }),
      })
      if (p.pre) p.call.readBy = p.pre.by
      s.cost += res.cost
      const idx = index()
      for (const it of res.out.items) {
        const iid = `${p.call.hash.slice(0, 6)}-${++s.seq}`
        const branch = idx.has(it.branch) ? it.branch : 'none'
        s.items[iid] = {
          id: iid, call: p.call.id, file: p.call.file, date: p.call.date, part: p.part, ...(p.call.note ? { note: true } : {}), ...it,
          also: it.also.filter(x => idx.has(x) && x !== branch).slice(0, 3),
          claudeBranch: branch, claudeConf: it.confidence, branch, conf: it.confidence, placed: false, filed: false,
        }
        fresh.push(iid)
      }
      // A file named only by its time ("2026-10-29 1427") takes its title from the reading.
      if (p.part === 1 && res.out.title && /^[\d\s-]*$/.test(p.call.title)) p.call.title = res.out.title
      p.call.summary = [p.call.summary, res.out.summary].filter(Boolean).join(' ')
      p.call.items = (p.call.items || 0) + res.out.items.length
      done.set(p.call.id, (done.get(p.call.id) || 0) + 1)
      if (done.get(p.call.id) === p.parts) p.call.status = 'done'
      s.job.done++
      note(id, `${p.call.title}${p.parts > 1 ? ` (${p.part}/${p.parts})` : ''}: ${res.out.items.length} items${p.pre ? ` (read by ${p.pre.by})` : ''}`)
    } catch (e) {
      p.call.status = 'error'; p.call.error = String(e.message || e).slice(0, 300)
      s.job.done++
      note(id, `${p.call.title}: failed (${p.call.error.slice(0, 120)})`)
    }
  })
  // A call that failed part-way keeps the items it got and is read again next time.
  for (const c of todo) if (c.status === 'error') for (const i of Object.values(s.items)) if (i.call === c.id) delete s.items[i.id]

  await placeItems(id, fresh.filter(i => s.items[i]))
  await rebuildThreads(id, topicModel(id), changedScopes(s, index()))
  await weighQuestions(id)
  note(id, `Done: ${fresh.length} new items, ${counts(s).filed} filed, ${counts(s).guessed} best guesses, ${counts(s).open} open threads. Spent $${s.cost.toFixed(2)} so far.`)
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
    for (const iid of ids) { Object.assign(s.items[iid], { by: 'claude', ctx: ctxKey(s) }); settle(s.items[iid], index) }
    applyTrust(s)
    note(id, 'Placed by Claude alone (no Jev key set)')
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
  applyTrust(s)
  function finish(w) {
    const i = s.items[w.iid]
    if (w.fail) { i.by = 'claude'; return settle(i, index) }
    let alts = w.alts.filter(a => a.branch && a.branch !== '_root').sort((a, b) => b.p - a.p).slice(0, 3)
    const c = i.claudeBranch
    if (c !== 'none' && c !== w.at && !alts.some(a => a.branch === c)) alts = [...alts, { branch: c, p: i.claudeConf ?? 0, by: 'claude' }]
    Object.assign(i, { guess: w.at || 'none', guessConf: Math.round(w.p * 1000) / 1000, conf: Math.round(w.p * 1000) / 1000, alts, by: 'jev' })
    settle(i, index)
  }
  save(id)
}

// What else each item touches, for items read before links existed (new reads get them from the first pass).
async function linkItems(id, ids, model) {
  const s = load(id), lib = LIBS.get(id)
  if (!ids.length) return
  s.job.stage = `Finding what ${ids.length} item(s) also touch`
  const batches = []
  for (let b = 0; b < ids.length; b += LINK_BATCH) batches.push(ids.slice(b, b + LINK_BATCH))
  s.job.total += batches.length
  await pool(batches, CONCURRENCY, async batch => {
    if (s.job.stop) return
    const index = flat(s.tree.branches)
    try {
      const res = await callModel({ model, system: SYSTEM, kind: 'links', schema: SCHEMAS.links, prompt: linksPrompt({ library: lib, tree: s.tree.branches, items: batch.map(x => s.items[x]) }) })
      s.cost += res.cost
      for (const r of res.out.items) { const i = s.items[r.id]; if (i) i.also = r.also.filter(x => index.has(x) && x !== i.claudeBranch).slice(0, 3) }
      for (const x of batch) s.items[x].also ||= []
    } catch (e) { note(id, `Links failed for ${batch.length} item(s): ${String(e.message).slice(0, 100)}`) }
    s.job.done++
  })
  save(id)
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
      const edited = new Map(existing.filter(t => t.editedAt).map(t => [t.id, t]))
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
        // What a person wrote into a topic stays; the rewrite only adds what was said since.
        const ed = edited.get(t.id)
        if (ed) Object.assign(s.threads[t.id], { title: ed.title, summary: ed.summary, decision: ed.decision, status: ed.status, editedBy: ed.editedBy, editedAt: ed.editedAt })
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
  const at = now()
  if (skip) {
    if (items?.length) for (const x of items) s.snoozed[(qid === 'spot' ? 's:' : 'i:') + x] = at
    else s.snoozed[qid] = at
    save(id); return { ok: true }
  }
  if (qid === 'spot') return spotAnswer(id, arguments[1].checks || [])
  const [kind, key] = [qid.slice(0, 1), qid.slice(2)]
  if (kind === 'b') return sharpen(id, key, arguments[1])
  if (kind === 't') {
    const t = s.threads[key]
    if (!t) throw new Error('No such thread')
    if (!text?.trim()) throw new Error('Write an answer, or skip')
    Object.assign(t, { status: 'decided', decision: text.trim(), answeredBy: actor || 'owner', answeredAt: at })
    s.answers.push({ at, by: actor, thread: key, title: t.title, q: t.question?.q, a: text.trim(), where: pathName(index, t.branch) })
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
    Object.assign(i, { branch: target, conf: 1, by: 'owner', rule: 'owner', filed: target !== 'none', offtopic: target === 'none', links: (i.links || []).filter(l => l !== target) })
    s.corrections.push({ at, text: i.text, branch: target })
    s.answers.push({ at, by: actor, item: key, q: i.text, a: pathName(flat(s.tree.branches), target) })
  }
  save(id)
  return { ok: true }
}
// A spot check: each item is right where it is, or moves where you say. Either way it is now yours, it teaches
// the filing, and it counts toward how often the rule that placed it is right.
function spotAnswer(id, checks) {
  const s = load(id), index = flat(s.tree.branches), at = now()
  let right = 0, moved = 0
  for (const ck of checks) {
    const i = s.items[ck.id]
    const to = ck.ok ? i?.branch : ck.branch
    if (!i || i.by === 'owner' || !to || (to !== 'none' && !index.has(to))) continue
    i.check = { at, rule: i.rule, ok: !!ck.ok, was: i.branch }
    Object.assign(i, { branch: to, conf: 1, by: 'owner', rule: 'owner', filed: to !== 'none', offtopic: to === 'none', links: (i.links || []).filter(l => l !== to) })
    s.corrections.push({ at, text: i.text, branch: to })
    ck.ok ? right++ : moved++
  }
  s.answers.push({ at, by: actor, q: `Spot check of ${right + moved} filing(s)`, a: `${right} right, ${moved} moved` })
  applyTrust(s)
  save(id)
  return { right, moved, ...counts(s) }
}

// Merge two branches into one, or write how they differ into both descriptions. Then "Update" files everything again.
function sharpen(id, key, { merge, describe }) {
  const s = load(id), index = flat(s.tree.branches), at = now()
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
      if (i.also) i.also = [...new Set(i.also.map(move))]
      if (i.links) i.links = [...new Set(i.links.map(move))].filter(l => l !== i.branch)
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

// ---------- teammates read what they add, with their own AI ----------
// The reading travels with the transcript (data/reads/<file>.json); the reader takes it instead of reading again.
export function preRead(id, c) {
  const f = join(LIBS.get(id).dir, 'reads', c.file + '.json')
  try { return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null } catch { return null }
}
export async function readUpload(id, path, name) {
  const s = load(id), lib = LIBS.get(id)
  const model = readModel(id)
  const c = parseFile(path, lib.names)
  const call = { title: c.title, date: c.date, speakers: c.speakers }
  const parts = chunks(c.text)
  s.job = { running: true, stage: `Reading ${name} with your AI`, done: 0, total: parts.length, started: new Date().toISOString(), log: [], model }
  save(id)
  const read = { file: name, title: '', summary: '', items: [], cost: 0, by: me(id), at: new Date().toISOString(), model }
  try {
    for (const [k, text] of parts.entries()) {
      const res = await callModel({ model, system: SYSTEM, kind: 'extract', schema: SCHEMAS.extract, prompt: extractPrompt({ library: lib, call, part: k + 1, parts: parts.length, text, tree: s.tree.branches, glossary: glossary(s) }) })
      read.items.push(...res.out.items)
      read.summary = [read.summary, res.out.summary].filter(Boolean).join(' ')
      read.title ||= res.out.title
      read.cost += res.cost
      s.job.done++
    }
    const dir = join(lib.dir, 'outreads')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, name + '.json'), JSON.stringify(read))
    ;(s.outreads ||= []).push({ name, path: join(dir, name + '.json') })
    note(id, `${name}: ${read.items.length} items, read with your AI. They show up for everyone after the next update.`)
  } catch (e) {
    note(id, `${name}: could not read it with your AI (${String(e.message).slice(0, 120)}). It goes up unread.`)
  } finally {
    s.job.running = false; s.job.stage = 'Done'; save(id, true); bus.emit('change', id)
  }
}

// ---------- categories: what the readers say is missing from the tree ----------
// When nothing fits, the reader names the branch that should exist; the same name from several items is a proposal.
function proposals(s, index) {
  const gone = s.dismissed || {}, groups = {}
  const add = (key, x, ids) => { if (gone[key]) return; const g = (groups[key] ||= { key, ...x, items: [] }); g.items.push(...ids) }
  for (const i of Object.values(s.items)) {
    const raw = i.new_branch?.trim()
    if (!raw || i.dup || i.by === 'owner' || index.has(raw)) continue
    const m = raw.match(/^([a-z0-9-]+(?:\.[a-z0-9-]+)*)\.([a-z0-9-]+)(?::\s*(.+))?$/i)
    const parent = m && index.has(m[1]) ? m[1] : scopeOf(index, i.branch) === 'none' ? '' : scopeOf(index, i.branch)
    let name = (m && index.has(m[1]) ? m[3] || m[2].replace(/-/g, ' ') : raw.replace(/^[a-z0-9.-]+:\s*/i, '')).trim()
    name = name.charAt(0).toUpperCase() + name.slice(1)
    add(`${parent}|${name.toLowerCase()}`, { name, parent, from: 'reading' }, [i.id])
  }
  for (const p of s.proposals || []) add(`${p.parent}|${p.name.toLowerCase()}`, { name: p.name, parent: p.parent, desc: p.desc, why: p.why, from: 'ai' }, p.items.filter(x => s.items[x]))
  const exists = (parent, name) => [...index.values()].some(n => (n.parent || '') === parent && n.name.toLowerCase() === name.toLowerCase())
  return Object.values(groups).filter(g => !exists(g.parent, g.name)).map(g => ({ ...g, items: [...new Set(g.items)], where: g.parent ? pathName(index, g.parent) : 'Top level' }))
    .sort((a, b) => b.items.length - a.items.length)
}

// Ask the AI which branches are missing, from the items the two readers keep splitting on or that fit nowhere.
export async function suggestCategories(id) {
  const s = load(id), lib = LIBS.get(id), index = flat(s.tree.branches)
  const pick = Object.values(s.items).filter(i => !i.dup && i.by !== 'owner' && (['split', 'shared', 'none'].includes(i.rule) || i.new_branch))
    .sort((a, b) => hash(a.id) - hash(b.id)).slice(0, 300)
  const res = await callModel({ model: topicModel(id), system: SYSTEM, kind: 'suggest', schema: SCHEMAS.suggest, prompt: suggestPrompt({ library: lib, tree: s.tree.branches, items: pick.map(i => ({ id: i.id, where: pathName(index, i.branch), text: i.text })) }) })
  s.cost += res.cost
  const list = res.out.categories.filter(c => c.name?.trim() && (!c.parent || index.has(c.parent))).map(c => ({ ...c, items: c.items.filter(x => s.items[x]) }))
  return change(id, { kind: 'proposals', list })
}

// ---------- changes: every edit is a change with who, when and what it was before, so a team can share one record ----------
// Each person's changes go to their own log (data/changes/<who>.jsonl in the shared repo), so two people never write
// the same file. Applying a change is deterministic, so any copy can replay everyone's changes on the last shared record.
let clock = null, actor = null
const now = () => clock || new Date().toISOString()
export const me = id => LIBS.get(id)?.sync?.me || 'owner'
const CLAIM_MIN = 30

export function change(id, op) {
  const s = load(id)
  // Skipping is personal: it hides a question for you, not for the team.
  if (op.kind === 'answer' && op.body?.skip) return answer(id, op.body)
  op = { ...op, id: `${me(id)}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`, at: new Date().toISOString(), by: me(id) }
  const r = applyChange(id, op)
  ;(s.outbox ||= []).push(op)
  save(id)
  bus.emit('change', id)
  return r
}

export function applyChange(id, op) {
  const s = load(id)
  s.log ||= []
  if (op.kind === 'claim') { if (!s.claims?.[op.qid] || s.claims[op.qid].at < op.at) (s.claims ||= {})[op.qid] = { by: op.by, at: op.at }; return { ok: true } }
  if (s.log.some(x => x.id === op.id)) return { ok: true }
  ;[clock, actor] = [op.at, op.by]
  const entry = { id: op.id, at: op.at, by: op.by, kind: op.kind }
  let r
  try { r = APPLY[op.kind](s, op, entry, id) } catch (e) { entry.error = e.message; r = { error: e.message } } finally { clock = actor = null }
  s.log.push(entry)
  return r
}

// Each change says what it did, and what was there before, for the Changes list.
const APPLY = {
  answer(s, op, e, id) {
    const b = op.body, index = flat(s.tree.branches), [kind, key] = [b.qid.slice(0, 1), b.qid.slice(2)]
    if (b.qid === 'spot') { const r = answer(id, b); e.what = `Spot check: ${r.right} right, ${r.moved} moved`; return r }
    if (kind === 't') { const t = s.threads[key]; Object.assign(e, { what: `Decided: ${t?.title || key}`, before: t?.decision || STATUS_WORD[t?.status] || '', after: b.text }) }
    else if (kind === 'b') Object.assign(e, { what: b.merge ? `Merged ${key.split('|').filter(x => x !== b.merge).map(x => pathName(index, x))} into ${pathName(index, b.merge)}` : `Described ${key.split('|').map(x => pathName(index, x)).join(' and ')}`, after: b.merge ? '' : Object.values(b.describe || {}).join(' / ') })
    else { const i = s.items[key]; Object.assign(e, { what: `Filed: ${i?.text || key}`, before: i ? pathName(index, i.branch) : '', after: b.newBranch?.name || pathName(index, b.branch) }) }
    return answer(id, b)
  },
  editThread(s, op, e, id) {
    const t = s.threads[op.thread]
    if (!t) throw new Error('That topic is gone')
    const f = Object.fromEntries(['title', 'summary', 'decision', 'status'].filter(k => op[k] !== undefined && op[k] !== t[k]).map(k => [k, op[k]]))
    Object.assign(e, { what: `Edited topic: ${t.title}`, before: Object.keys(f).map(k => `${k}: ${t[k] || ''}`).join('\n'), after: Object.entries(f).map(([k, v]) => `${k}: ${v}`).join('\n') })
    Object.assign(t, f, { editedBy: op.by, editedAt: op.at })
    save(id); return { ok: true }
  },
  editBranch(s, op, e, id) {
    const n = findNode(s.tree.branches, op.branch)
    if (!n) throw new Error('That branch is gone')
    const f = Object.fromEntries(['name', 'desc'].filter(k => op[k] !== undefined && op[k] !== n[k]).map(k => [k, op[k]]))
    Object.assign(e, { what: `Edited branch: ${n.name}`, before: Object.keys(f).map(k => `${k}: ${n[k] || ''}`).join('\n'), after: Object.entries(f).map(([k, v]) => `${k}: ${v}`).join('\n') })
    Object.assign(n, f)
    s.treeChangedAt = op.at
    save(id); return { ok: true }
  },
  addBranch(s, op, e, id) {
    const parent = op.parent ? findNode(s.tree.branches, op.parent) : null
    if (op.parent && !parent) throw new Error('That branch is gone')
    const slug = op.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24)
    const bid = parent ? `${parent.id}.${slug}` : slug
    if (!flat(s.tree.branches).has(bid)) (parent ? (parent.children ||= []) : s.tree.branches).push({ id: bid, name: op.name.trim(), desc: op.desc || '', from: op.by, added: op.at.slice(0, 10) })
    const index = flat(s.tree.branches)
    // From a proposal: its items move to the new branch as best guesses, until spot checks say otherwise.
    for (const x of op.items || []) { const i = s.items[x]; if (i && i.by !== 'owner') { Object.assign(i, { claudeBranch: bid, guess: bid, guessConf: 1 }); settle(i, index) } }
    if (op.key) (s.dismissed ||= {})[op.key] = op.at
    Object.assign(e, { what: `Added branch: ${pathName(index, bid)}${op.items?.length ? ` (${op.items.length} items moved in)` : ''}`, after: op.desc || '' })
    s.treeChangedAt = op.at
    save(id); return { ok: true, id: bid }
  },
  transcript(s, op, e) { e.what = `Added transcript: ${op.file}`; return { ok: true } },
  proposals(s, op, e, id) { s.proposals = op.list; e.what = `Suggested ${op.list.length} new categories`; e.after = op.list.map(c => c.name).join(', '); save(id); return { ok: true, count: op.list.length } },
  dismissProposal(s, op, e, id) { (s.dismissed ||= {})[op.key] = op.at; e.what = `Dismissed proposed category: ${op.name}`; save(id); return { ok: true } },
}
const STATUS_WORD = { unsettled: 'Never settled', open: 'Open', assumed: 'Assumed', decided: 'Decided', done: 'Done' }

// Everyone's changes on top of the last shared record, oldest first; ones already in it are skipped.
export function applyRemote(id, ops) {
  const s = load(id), seen = new Set((s.log || []).map(x => x.id))
  const todo = ops.filter(o => o.kind === 'claim' || !seen.has(o.id)).sort((a, b) => a.at.localeCompare(b.at))
  for (const op of todo) applyChange(id, op)
  if (todo.some(o => o.kind !== 'claim')) applyTrust(s)
  if (todo.length) save(id)
  return todo.filter(o => o.kind !== 'claim').length
}

// A newer shared record arrived: it replaces this copy, keeping what is only yours (skips, unsent changes).
export function replaceBase(id, record, tree) {
  const old = load(id)
  const keep = { snoozed: old.snoozed, outbox: old.outbox || [], outfiles: old.outfiles || [], outreads: old.outreads || [], claims: old.claims || {}, syncState: old.syncState, job: old.job?.running ? old.job : null }
  states.delete(id)
  const s = load(id)
  Object.assign(s, { calls: {}, items: {}, threads: {}, answers: [], corrections: [], crosslinks: [], resolvedPairs: {}, log: [] }, record, { tree, job: null }, keep)
  s.version = old.version + 1
  save(id, true)
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
    ((!i.filed && i.ctx !== ctx) || (i.branch !== 'none' && !index.has(i.branch)) || (i.guess && i.guess !== 'none' && !index.has(i.guess)))).map(i => i.id)
}

// File again what is still waiting, e.g. after the tree changed.
export async function refile(id) {
  const s = load(id)
  if (s.job?.running) throw new Error('Already processing')
  s.tree = (() => { try { return JSON.parse(readFileSync(join(LIBS.get(id).dir, 'tree.json'), 'utf8')) } catch { return s.tree } })()
  const ids = retry(s)
  s.job = { running: true, stage: 'Filing again', done: 0, total: 0, started: new Date().toISOString(), log: [], model: '' }
  try { resettle(s); await placeItems(id, ids); note(id, `Placed ${ids.length} item(s) again: ${counts(s).filed} filed, ${counts(s).guessed} best guesses`) }
  finally { s.job.running = false; s.job.stage = 'Done'; save(id, true); bus.emit('jobdone', id) }
  return counts(s)
}

// After answers or tree changes: file again what you haven't confirmed (Jev, cheap), then rewrite only the topics whose items moved.
export async function refresh(id, { model } = {}) {
  const s = load(id)
  if (s.job?.running) throw new Error('Already processing')
  s.job = { running: true, stage: 'Filing again', done: 0, total: 0, started: new Date().toISOString(), log: [], model: model ? resolveModel(model) : readModel(id) }
  save(id)
  ;(async () => {
    await linkItems(id, Object.values(s.items).filter(i => !i.dup && !i.also).map(i => i.id), s.job.model)
    resettle(s)
    await placeItems(id, retry(s))
    note(id, `Filed again: ${counts(s).filed} filed, ${counts(s).guessed} best guesses, ${counts(s).links} links`)
    await rebuildThreads(id, topicModel(id), changedScopes(s, flat(s.tree.branches)))
    await weighQuestions(id)
    s.refreshedAt = new Date().toISOString()
  })().catch(e => note(id, `Stopped: ${e.message}`)).finally(() => { s.job.running = false; s.job.stage = 'Done'; save(id, true); bus.emit('jobdone', id) })
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
  })().catch(e => note(id, `Cross-check failed: ${e.message}`)).finally(() => { s.job.running = false; s.job.stage = 'Done'; save(id, true); bus.emit('jobdone', id) })
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
