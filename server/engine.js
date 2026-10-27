import { EventEmitter } from 'node:events'
import { callModel, modelById, resolveModel } from './models.js'
import { SCHEMAS, SYSTEM, stepPrompt } from './prompts.js'
import { methodById } from './methods.js'
import { loadRuns, saveRun, writeRunFile } from './store.js'
import { recordMarkdown } from './record.js'

export const bus = new EventEmitter()
bus.setMaxListeners(100)

// Budgets per effort level. Loops = growth rounds after the branches first come back together.
const EFFORT = {
  quick: { methods: 2, loops: 0, asks: 1, review: false },
  normal: { methods: 4, loops: 1, asks: 2, review: true },
  deep: { methods: 6, loops: 2, asks: 3, review: true },
}
const CONCURRENCY = 3
const TITLES = {
  capture: 'Your thought', frame: 'Frame it', ask: 'Your input', route: 'Pick methods', narrow: 'Show all, keep 3',
  assess: 'Enough to commit?', review: 'Skeptic review', decide: 'Decision', unstick: 'Plain explanation',
  converge: 'Come back together',
}
const GROW = ['develop', 'research', 'more']

const runs = new Map()
for (const run of loadRuns()) {
  // A restart interrupts in-flight calls; queue them again but wait for Resume so nothing spends by surprise.
  let interrupted = false
  for (const n of Object.values(run.nodes)) if (n.status === 'running') { n.status = 'queued'; interrupted = true }
  if (interrupted) run.paused = true
  runs.set(run.id, run)
}

export const getRun = id => runs.get(id)
export const listRuns = () => [...runs.values()]
  .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  .map(r => ({ id: r.id, title: r.title, createdAt: r.createdAt, status: r.status, model: r.model, effort: r.effort }))

// ---------- graph helpers ----------
const nodes = run => run.order.map(id => run.nodes[id])
const active = run => nodes(run).filter(n => n.status !== 'superseded')
const inScope = (run, scope) => active(run).filter(n => n.scope === scope)
const latest = (run, scope, kind) => inScope(run, scope).filter(n => n.kind === kind && n.status === 'done').at(-1)
const effortOf = (run, scope) => EFFORT[scope === 'root' ? run.effort : 'quick']
const asksUsed = (run, scope) => inScope(run, scope).filter(n => n.kind === 'ask').length
const loopsUsed = (run, scope) => inScope(run, scope).filter(n => n.data.grew || (n.kind === 'route' && n.data.followup && n.data.legacy)).length
const passOf = (run, scope) => inScope(run, scope).filter(n => n.kind === 'converge').length

// The question as it currently stands: first from the frame, then restated each time the branches come back.
export function questionTrail(run, scope) {
  return inScope(run, scope).filter(n => (n.kind === 'frame' || n.kind === 'converge') && n.status === 'done' && n.out.question)
    .map(n => ({ node: n.id, text: n.out.question, changed: n.out.changed || '' }))
}

// Which branch surfaced an option, so the tree grows from it. Prefer a branch no sibling has taken yet,
// so growth spreads in several directions when an option came from many branches.
const norm = s => s.toLowerCase().replace(/[^a-z0-9]/g, '')
function sourceOf(run, scope, option, used) {
  const methods = inScope(run, scope).filter(n => n.kind === 'method')
  const hits = (option?.from || []).map(f => methods.find(n => [n.data.method, n.title].some(x => norm(x) === norm(f) || norm(x).includes(norm(f)) || norm(f).includes(norm(x))))).filter(Boolean)
  const pick = hits.find(m => !used.has(m.id)) || hits[0]
  if (pick) used.add(pick.id)
  return pick?.id || null
}

function log(run, text) {
  run.activity.push({ t: new Date().toISOString(), text })
  if (run.activity.length > 40) run.activity.shift()
}

function add(run, { kind, scope, title, deps = [], data = {}, status = 'queued', out = null }) {
  const id = 'n' + ++run.seq
  run.nodes[id] = { id, kind, scope, title: title || TITLES[kind], deps, data, status, out, error: null, createdAt: new Date().toISOString() }
  run.order.push(id)
  return run.nodes[id]
}

function changed(run, now = false) {
  run.status = statusOf(run)
  run.updatedAt = new Date().toISOString()
  saveRun(run, now)
  bus.emit('run', run)
}

function statusOf(run) {
  const a = active(run)
  if (run.paused && a.some(n => n.status === 'queued')) return 'paused'
  if (a.some(n => n.status === 'running' || n.status === 'queued')) return 'running'
  if (a.some(n => n.status === 'waiting')) return 'waiting'
  if (latest(run, 'root', 'decide')) return 'done'
  if (a.some(n => n.status === 'error')) return 'error'
  return 'idle'
}

// ---------- context handed to every step ----------
const list = (items, f) => items.map(f).filter(Boolean).join('\n')

function context(run, scope) {
  const parts = []
  if (scope === 'root') parts.push(`USER'S THOUGHT (verbatim):\n${run.input}`)
  else {
    const cap = inScope(run, scope).find(n => n.kind === 'capture')
    const rootFrame = latest(run, 'root', 'frame')
    parts.push(`GOING ONE LEVEL DEEPER ON:\n${cap.out.text}`,
      `ORIGINAL THOUGHT (for context):\n${run.input.slice(0, 2000)}`)
    if (rootFrame) parts.push(`OVERALL GOAL: ${rootFrame.out.goal.text} (${rootFrame.out.goal.source})`)
  }
  if (run.corrections.length) parts.push('CORRECTIONS FROM THE USER (these override any inference):\n' +
    list(run.corrections, c => c.action === 'reject' ? `- NOT TRUE: ${c.original}` : c.action === 'edit' ? `- Instead of "${c.original}": ${c.text}` : `- CONFIRMED: ${c.original}`))
  if (run.constraints.length) parts.push('CONSTRAINTS THE USER FLAGGED:\n' + list(run.constraints, c => `- ${c.text}`))
  const answers = inScope(run, scope).filter(n => n.kind === 'ask' && n.status === 'done')
  const qa = answers.flatMap(n => n.out.skipped ? [{ q: '(user skipped questions)', a: 'Decide yourself.' }] : n.out.answers)
  if (qa.length) parts.push('ANSWERS FROM THE USER:\n' + list(qa, x => `- Q: ${x.q}\n  A: ${x.a}`))
  const frame = latest(run, scope, 'frame')
  if (frame) {
    const f = frame.out
    parts.push(`CURRENT FRAME:\nGoal (${f.goal.source}): ${f.goal.text}\nStated: ${f.stated.join('; ')}\nInferred: ${f.inferred.map(i => i.text).join('; ')}\n` +
      `Constraints: ${f.constraints.map(c => `${c.text}${c.hard ? ' [hard]' : ''}`).join('; ')}\nUnknowns: ${f.unknowns.map(u => `${u.text} -> ${u.action}`).join('; ')}`)
  }
  const trail = questionTrail(run, scope)
  if (trail.length) parts.push(`CURRENT QUESTION: ${trail.at(-1).text}` + (trail.length > 1 ? `\nEarlier versions: ${trail.slice(0, -1).map(q => q.text).join(' | ')}` : ''))
  const methods = inScope(run, scope).filter(n => n.kind === 'method' && n.status === 'done')
  if (methods.length) parts.push('METHOD RESULTS:\n' + list(methods, n => [
    `## ${n.title} [${n.data.method}] (focus: ${n.data.focus})`, n.out.summary,
    ...n.out.findings.map(f => `- [${f.kind}] ${f.text}`),
    n.out.options.length ? 'Options: ' + n.out.options.map(o => `${o.title}: ${o.detail}`).join(' | ') : '',
    n.out.cuts.length ? 'Cut: ' + n.out.cuts.map(c => `${c.what} (${c.why})`).join(' | ') : '',
    n.out.risks.length ? 'Risks: ' + n.out.risks.join('; ') : '',
  ].filter(Boolean).join('\n')))
  const research = inScope(run, scope).filter(n => n.kind === 'research' && n.status === 'done')
  if (research.length) parts.push('RESEARCH:\n' + list(research, n => `## ${n.data.query}${n.out.verified ? '' : ' (unverified)'}\n` +
    n.out.findings.map(f => `- ${f.text}${f.source ? ` [${f.source}]` : ''}`).join('\n')))
  const developed = inScope(run, scope).filter(n => n.kind === 'develop' && n.status === 'done')
  if (developed.length) parts.push('DEVELOPED DIRECTIONS:\n' + list(developed, n => `## ${n.data.title} (verdict: ${n.out.verdict})\n${n.out.practice}\nFit: ${n.out.fit}\n` +
    `Takes: ${n.out.takes.join('; ')}\nRisks: ${n.out.risks.join('; ')}\nTest: ${n.out.test}` +
    (n.out.sub_options.length ? `\nVariants: ${n.out.sub_options.map(o => o.title).join('; ')}` : '')))
  const narrow = latest(run, scope, 'converge') || latest(run, scope, 'narrow')
  if (narrow) {
    const byId = Object.fromEntries(narrow.out.all.map(o => [o.id, o]))
    parts.push('SHORTLIST:\n' + list(narrow.out.top, t => `- ${byId[t.id]?.title || t.id}: ${byId[t.id]?.detail || ''} (why: ${t.why})`) +
      (narrow.out.combine ? `\nCombination: ${narrow.out.combine}` : ''))
  }
  if (run.picks[scope]) parts.push(`USER PICKED (this wins over the shortlist): ${run.picks[scope]}`)
  const assess = latest(run, scope, 'assess')
  if (assess) parts.push(`LATEST ASSESSMENT: ${assess.out.summary} Gaps: ${assess.out.gaps.map(g => g.text).join('; ') || 'none'}`)
  const review = latest(run, scope, 'review')
  if (review) parts.push('SKEPTIC OBJECTIONS:\n' + list(review.out.objections, o => `- [${o.severity}] ${o.text} Fix: ${o.fix}`))
  return parts.join('\n\n')
}

// ---------- scheduler ----------
function tick(run) {
  if (run.paused) return changed(run)
  let running = active(run).filter(n => n.status === 'running').length
  for (const n of active(run)) {
    if (running >= CONCURRENCY) break
    if (n.status !== 'queued') continue
    if (!n.deps.every(d => run.nodes[d]?.status === 'done')) continue
    running++
    start(run, n)
  }
  changed(run)
}

async function start(run, node) {
  node.status = 'running'
  node.startedAt = new Date().toISOString()
  log(run, `${node.title}: started`)
  const scope = node.scope
  const E = effortOf(run, scope)
  const model = modelById(run.model)
  const opts = {
    effort: scope === 'root' ? run.effort : 'quick',
    // The opening frame gets one round of questions; the rest are saved for when the branches come back.
    askAllowed: !run.handsOff && (node.kind === 'frame' ? asksUsed(run, scope) === 0 : asksUsed(run, scope) < E.asks),
    loopsLeft: E.loops - loopsUsed(run, scope),
    researchAllowed: E.loops - loopsUsed(run, scope) > 0,
    web: model.web,
    picks: run.picks[scope],
    pass: passOf(run, scope),
  }
  try {
    const prompt = stepPrompt(node.kind, node, context(run, scope), opts)
    const { out, cost } = await callModel({
      model: run.model, system: SYSTEM, prompt, schema: SCHEMAS[node.kind], kind: node.kind,
      web: node.kind === 'research' && model.web,
    })
    run.cost += cost
    if (node.status !== 'running') return // superseded while the call was in flight
    node.out = out
    node.status = 'done'
    node.endedAt = new Date().toISOString()
    log(run, `${node.title}: ${out.summary || 'done'}`)
    after(run, node, E, opts)
  } catch (e) {
    if (node.status !== 'running') return
    node.status = 'error'
    node.error = String(e.message || e).slice(0, 600)
    log(run, `${node.title}: failed`)
  }
  tick(run)
}

// What happens after each step: this is the dynamic routing.
function after(run, node, E, opts) {
  const s = node.scope
  const o = node.out
  const toReview = deps => add(run, { kind: E.review ? 'review' : 'decide', scope: s, deps })
  const followup = deps => add(run, { kind: 'route', scope: s, title: 'Fill the gaps', deps, data: { followup: true, legacy: true } })

  switch (node.kind) {
    case 'capture':
      add(run, { kind: 'frame', scope: s, deps: [node.id] })
      break
    case 'frame': {
      if (s === 'root' && o.title) run.title = o.title
      if (s !== 'root' && o.title) node.title = 'Frame: ' + o.title
      if (!opts.askAllowed) o.questions = []
      const blocking = o.questions.some(q => q.blocking)
      if (blocking) add(run, { kind: 'ask', scope: s, deps: [node.id], status: 'waiting', data: { from: 'frame', questions: o.questions } })
      else add(run, { kind: 'route', scope: s, deps: [node.id] })
      break
    }
    case 'ask':
      if (node.data.from === 'frame' && !node.out.skipped) add(run, { kind: 'frame', scope: s, title: 'Reframe', deps: [node.id] })
      else if (node.data.from === 'frame') add(run, { kind: 'route', scope: s, deps: [node.id] })
      else if (node.data.from === 'converge') add(run, { kind: 'converge', scope: s, title: 'Restate with your answers', deps: [node.id] })
      else followup([node.id])
      break
    case 'route': {
      let plan = o.plan.slice(0, E.methods)
      if (!plan.length && !node.data.followup) plan = [{ method: 'possibilities', focus: 'What directions exist?', why: 'Fallback', checks: [] }]
      const ids = plan.map(p => {
        const m = methodById(p.method)
        return add(run, { kind: 'method', scope: s, title: m.name, deps: [node.id], data: { method: m.id, name: m.name, how: m.how, focus: p.focus, why: p.why, checks: p.checks, ring: node.data.ring || 1 } }).id
      })
      add(run, { kind: 'converge', scope: s, deps: ids.length ? ids : [node.id] })
      break
    }
    case 'converge': {
      const grow = GROW.includes(o.next) && !o.enough && opts.loopsLeft > 0
      if (!grow && !o.enough && o.next === 'ask' && o.questions.length && opts.askAllowed)
        add(run, { kind: 'ask', scope: s, deps: [node.id], status: 'waiting', data: { from: 'converge', questions: o.questions } })
      else if (grow) {
        node.data.grew = true
        const ring = loopsUsed(run, s) + 1
        const byId = Object.fromEntries(o.all.map(x => [x.id, x]))
        const used = new Set()
        let ids = []
        if (o.next === 'develop') ids = o.top.slice(0, 3).map(t => {
          const opt = byId[t.id] || { title: t.id, detail: '' }
          return add(run, { kind: 'develop', scope: s, title: opt.title, deps: [node.id], data: { title: opt.title, detail: opt.detail, why: t.why, parent: sourceOf(run, s, opt, used), ring } }).id
        })
        if (o.next === 'research') ids = o.research.slice(0, 3).map(r => add(run, { kind: 'research', scope: s, title: 'Look up: ' + r.query, deps: [node.id], data: { ...r, ring } }).id)
        if (ids.length) add(run, { kind: 'converge', scope: s, deps: ids })
        else add(run, { kind: 'route', scope: s, title: 'Find other angles', deps: [node.id], data: { followup: true, ring } })
      } else toReview([node.id])
      break
    }
    case 'narrow':
      add(run, { kind: 'assess', scope: s, deps: [node.id] })
      break
    case 'assess': {
      const commit = o.next === 'commit' || o.enough || opts.loopsLeft <= 0
      if (commit) toReview([node.id])
      else if (o.next === 'ask' && o.questions.length && opts.askAllowed)
        add(run, { kind: 'ask', scope: s, deps: [node.id], status: 'waiting', data: { from: 'assess', questions: o.questions } })
      else if (o.next === 'research' && o.research.length)
        followup(o.research.slice(0, 3).map(r => add(run, { kind: 'research', scope: s, title: 'Look up: ' + r.query, deps: [node.id], data: r }).id))
      else followup([node.id])
      break
    }
    case 'review':
      if (o.fatal && opts.loopsLeft > 0) {
        node.data.grew = true
        add(run, { kind: 'route', scope: s, title: 'Answer the objections', deps: [node.id], data: { followup: true, ring: loopsUsed(run, s) + 1 } })
      }
      else add(run, { kind: 'decide', scope: s, deps: [node.id] })
      break
    case 'decide':
      if (s === 'root') {
        run.title = o.title || run.title
        writeRunFile(run, 'record.md', recordMarkdown(run))
      } else {
        const parent = run.nodes[s.slice(1)]
        if (parent) parent.childResult = { recommendation: o.recommendation, next: o.next_action.what }
      }
      break
    case 'unstick': {
      const target = run.nodes[node.data.target]
      if (o.constraint) run.constraints.push({ text: o.constraint, from: node.data.target })
      if (target?.stuck) target.stuck.explained = node.id
      break
    }
  }
}

// ---------- public actions ----------
export function createRun({ input, model, effort, handsOff = false }) {
  const now = new Date()
  const words = input.split('\n').filter(l => !l.startsWith('--- ')).join(' ').toLowerCase().match(/[a-z0-9]+/g)
  const slug = (words || ['thought']).slice(0, 5).join('-').slice(0, 40)
  model = resolveModel(model)
  const id = `${now.toISOString().slice(0, 10)}-${slug}-${Math.random().toString(36).slice(2, 6)}`
  const run = {
    id, title: input.trim().split('\n').find(l => l.trim() && !l.startsWith('--- '))?.slice(0, 70) || 'Thought', input, model,
    effort: EFFORT[effort] ? effort : 'normal', handsOff: !!handsOff, createdAt: now.toISOString(), status: 'running',
    seq: 0, nodes: {}, order: [], corrections: [], constraints: [], picks: {}, cost: 0, activity: [],
  }
  runs.set(id, run)
  const cap = add(run, { kind: 'capture', scope: 'root', status: 'done', out: { text: input } })
  after(run, cap, EFFORT[run.effort], {})
  log(run, 'Run started on ' + modelById(run.model).label)
  tick(run)
  return run
}

function need(run, nodeId) {
  const n = run.nodes[nodeId]
  if (!n) throw new Error('No such step')
  return n
}

export function answer(run, { nodeId, answers = [], skip = false }) {
  const n = need(run, nodeId)
  if (n.kind !== 'ask' || n.status !== 'waiting') throw new Error('That step is not waiting for you')
  n.out = { answers: answers.filter(a => a.a?.trim()), skipped: skip || !answers.some(a => a.a?.trim()) }
  n.status = 'done'
  n.out.summary = n.out.skipped ? 'You said: decide yourself' : `${n.out.answers.length} answer(s)`
  log(run, 'Your input: ' + n.out.summary)
  after(run, n, effortOf(run, n.scope), {})
  tick(run)
}

function descendants(run, rootIds) {
  const set = new Set(rootIds)
  let grew = true
  while (grew) {
    grew = false
    for (const n of active(run)) {
      if (set.has(n.id)) continue
      const hit = n.deps.some(d => set.has(d)) || (n.kind === 'unstick' && set.has(n.data.target)) || set.has(n.scope.slice(1))
      if (hit) { set.add(n.id); grew = true }
    }
  }
  return set
}

export function rerun(run, { nodeId }) {
  const n = need(run, nodeId)
  if (n.kind === 'capture') throw new Error('Start a new run to change the thought itself')
  for (const id of descendants(run, [n.id])) run.nodes[id].status = 'superseded'
  // Constraints raised against superseded steps still apply; they are the user's.
  add(run, { kind: n.kind, scope: n.scope, title: n.title, deps: n.deps, data: { ...n.data, grew: undefined }, status: n.kind === 'ask' ? 'waiting' : 'queued' })
  run.paused = false
  log(run, `${n.title}: redoing this step and everything after it`)
  tick(run)
}

export function correct(run, { original, action, text = '', frameId }) {
  run.corrections = run.corrections.filter(c => c.original !== original)
  run.corrections.push({ original, action, text })
  log(run, action === 'confirm' ? `Confirmed: ${original}` : `Corrected: ${original}`)
  const scope = run.nodes[frameId]?.scope || 'root'
  const frame = inScope(run, scope).filter(n => n.kind === 'frame' && n.status === 'done').at(-1)
  if (action !== 'confirm' && frame) return rerun(run, { nodeId: frame.id })
  changed(run)
}

export function stuck(run, { nodeId, note = '' }) {
  const n = need(run, nodeId)
  n.stuck = { note, at: new Date().toISOString() }
  add(run, { kind: 'unstick', scope: n.scope, deps: [], data: { target: n.id, targetTitle: n.title, targetSummary: summarize(n), note } })
  log(run, `Marked stuck: ${n.title}`)
  tick(run)
}

export function deeper(run, { nodeId, focus = '' }) {
  const n = need(run, nodeId)
  const scope = 'S' + n.id
  if (inScope(run, scope).length) return
  n.child = scope
  const text = focus.trim() || `${n.title}: ${summarize(n)}`
  const cap = add(run, { kind: 'capture', scope, title: 'Go deeper', status: 'done', out: { text, summary: text.slice(0, 120) }, data: { parent: n.id } })
  after(run, cap, EFFORT.quick, {})
  log(run, `Going deeper on ${n.title}`)
  tick(run)
}

export function pick(run, { nodeId, picks = [], combine = '' }) {
  const n = need(run, nodeId)
  if (!['narrow', 'converge'].includes(n.kind) || !n.out) throw new Error('Picks apply to the shortlist step')
  const byId = Object.fromEntries(n.out.all.map(o => [o.id, o]))
  run.picks[n.scope] = [...picks.map(id => byId[id]?.title || id), combine && `combine: ${combine}`].filter(Boolean).join('; ')
  n.data.userPicks = picks
  log(run, 'You picked: ' + run.picks[n.scope])
  if (n.kind === 'converge') return rerun(run, { nodeId: n.id })
  const next = active(run).find(x => x.deps.includes(n.id))
  if (next) return rerun(run, { nodeId: next.id })
  changed(run)
}

export function resume(run) {
  run.paused = false
  log(run, 'Resumed')
  tick(run)
}

export function summarize(n) {
  const o = n.out
  if (!o) return n.error || ''
  if (n.kind === 'capture') return o.text.slice(0, 160)
  if (n.kind === 'decide') return o.recommendation
  if (n.kind === 'unstick') return o.plain
  return o.summary || ''
}
