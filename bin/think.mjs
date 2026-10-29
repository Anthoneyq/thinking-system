#!/usr/bin/env node
// think "a thought" | think notes.md | pbpaste | think
//   --model <id>          claude-sonnet-5-5 (default), claude-opus-5-5, claude-haiku-5-5, codex, dry
//   --effort <level>      quick | normal (default) | deep
//   --hands-off           never stop to ask; decide everything itself
//   --no-jev              let Claude make every routing call (Jev is used when TYPESAFE_API_KEY is set)
//   --wait                follow the run; return when it asks you something (exit 3) or finishes with the record (exit 0)
//   --no-open             don't open the browser
// think answer <run-id> "your answer"   answer the questions it is waiting on (--skip to let it decide, --as-is to keep a reply Jev queried)
// think watch <run-id>                  keep following a run after a question
// think rule "If ..., then ..."         save an approved standing rule; every later run applies it
// think library [id] [command]          Conversations mode (libraries are set in ~/.thinking-system/config.json):
//   status (default) | scan | process [--only <file text>] | next | answer "<text>" | file <branch-id> | skip
//   | crosscheck | ask "<question>" | refile | open
// Starts the local app if needed (http://localhost:4477), starts a run, and opens the live map.
import { readFileSync, existsSync, openSync, mkdirSync, realpathSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join, basename } from 'node:path'
import { homedir } from 'node:os'

const ROOT = join(dirname(realpathSync(process.argv[1])), '..')
const VERSION = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/plugin.json'), 'utf8')).version
const PORT = process.env.THINK_PORT || 4477
const BASE = `http://localhost:${PORT}`
const args = process.argv.slice(2)
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined }
const bool = name => { const i = args.indexOf(name); return i >= 0 ? !!args.splice(i, 1) : false }
const model = flag('--model'), effort = flag('--effort')
const noJev = bool('--no-jev')
const handsOff = bool('--hands-off'), wait = bool('--wait'), noOpen = bool('--no-open') || !!process.env.THINK_NO_OPEN

// Save a standing rule the user approved.
if (args[0] === 'rule') {
  const text = args.slice(1).join(' ').trim()
  const res = await fetch(`${BASE}/api/rules`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, from: 'chat' }) }).catch(() => null)
  if (!res) { console.error('The app is not running. Start a run first, or add the line to rules.md by hand.'); process.exit(1) }
  const out = await res.json()
  if (!res.ok) { console.error(out.error); process.exit(1) }
  console.log(`Saved to ${out.file}`)
  process.exit(0)
}

// Answer from the chat instead of the browser.
if (args[0] === 'answer') {
  const [, id, ...rest] = args
  const skip = rest.includes('--skip'), asIs = rest.includes('--as-is'), text = rest.filter(x => !x.startsWith('--')).join(' ').trim()
  const r = await fetch(`${BASE}/api/runs/${id}`).then(x => x.json()).catch(() => null)
  const ask = r?.order?.map(i => r.nodes[i]).find(n => n.status === 'waiting')
  if (!ask) { console.error('That run is not waiting for an answer.'); process.exit(1) }
  const res = await fetch(`${BASE}/api/runs/${id}/answer`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: ask.id, skip: skip || (!text && !asIs), asIs, answers: text ? [{ q: ask.data.questions.map(q => q.q).join(' / '), a: text }] : [] }) })
  const out = await res.json()
  if (!res.ok) { console.error(out.error); process.exit(1) }
  if (out.unclear) {
    console.log('NEEDS A LITTLE MORE. Jev could not use the reply for:')
    for (const q of out.unclear) console.log(`  - ${q}`)
    console.log(`Answer again with: think answer ${id} "..."  (or --as-is to keep the reply, --skip to let it decide)`)
    process.exit(3)
  }
  console.log('Answered. The run carries on.')
  process.exit(0)
}

const parts = args.map(a => existsSync(a) ? `--- ${basename(a)} ---\n${readFileSync(a, 'utf8')}` : a)
if (!process.stdin.isTTY) { try { const piped = readFileSync(0, 'utf8').trim(); if (piped) parts.push(piped) } catch {} }
const input = parts.join('\n\n').trim()

const get = path => fetch(BASE + path).then(r => r.json())
const health = () => get('/api/health').catch(() => null)
const sleep = ms => new Promise(r => setTimeout(r, ms))

let h = await health()
if (h && h.version !== VERSION) { await fetch(BASE + '/api/shutdown', { method: 'POST' }).catch(() => {}); await sleep(400); h = null }
if (!h) {
  const server = existsSync(join(ROOT, 'app/server.mjs')) ? 'app/server.mjs' : 'server/server.js'
  const logDir = join(homedir(), '.thinking-system')
  mkdirSync(logDir, { recursive: true })
  const log = openSync(join(logDir, 'server.log'), 'a')
  spawn(process.execPath, [server], { cwd: ROOT, detached: true, stdio: ['ignore', log, log], env: process.env }).unref()
  for (let i = 0; i < 80 && !h; i++) { await sleep(100); h = await health() }
  if (!h) { console.error(`The app did not start. See ${join(logDir, 'server.log')}`); process.exit(1) }
}

// Conversations mode from the terminal or chat: the same record and questions as the page.
if (args[0] === 'library') {
  const libs = await get('/api/libraries')
  const id = libs.find(l => l.id === args[1]) ? args[1] : libs[0]?.id
  if (!id) { console.error('No libraries. Add one under "libraries" in ~/.thinking-system/config.json'); process.exit(1) }
  const rest = args.slice(libs.find(l => l.id === args[1]) ? 2 : 1)
  const cmd = rest[0] || 'status', text = rest.slice(1).join(' ').trim()
  const post = (what, b = {}) => fetch(`${BASE}/api/library/${id}/${what}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) })
    .then(async r => { const o = await r.json(); if (!r.ok) { console.error(o.error); process.exit(1) } return o.result })
  const v = await get(`/api/library/${id}`)
  const page = `${BASE}/library/${id}`
  const c = v.counts
  const show = q => {
    if (!q) return console.log('Nothing needs you. Every topic is settled and every item is filed.')
    console.log(`${v.questions.filter(x => x.now).length} matter now, ${v.questions.length} in all. Next (${q.id}):`)
    if (q.kind === 'thread') {
      console.log(`  [${q.status}] ${q.where}\n  ${q.q}\n  why: ${q.why}`)
      if (q.ways?.length) console.log(`  ways it was talked about:\n${q.ways.map(w => '    - ' + w).join('\n')}`)
      if (q.options?.length) console.log(`  options: ${q.options.join(' | ')}`)
      console.log(`Answer with: think library ${id} answer "..."  (or skip)`)
    } else if (q.kind === 'group') {
      console.log(`  ${q.q}\n${q.items.map(i => `    - ${i.text} (${Math.round(i.conf * 100)}%)`).join('\n')}`)
      console.log(`Confirm all with: think library ${id} answer yes  (or file <branch-id>, or skip)`)
    } else {
      console.log(`  Where does this belong? "${q.q}"\n  best guess: ${q.guessName} (${q.why})${q.alts.length ? `\n  others: ${q.alts.map(a => `${a.branch} ${a.name}`).join('; ')}` : ''}`)
      console.log(`Answer with: think library ${id} answer yes | file <branch-id> | file none | skip`)
    }
  }
  if (cmd === 'status') {
    console.log(`${v.name}: ${c.calls} calls (${c.newCalls} unread), ${c.items} items, ${c.filed} filed, ${c.review} to check, ${c.threads} topics (${c.open} not settled). $${c.cost.toFixed(2)} spent.`)
    if (v.job?.running) console.log(`Working: ${v.job.stage} ${v.job.done}/${v.job.total}. ${v.job.log.at(-1)?.text || ''}`)
    console.log(`Record: ${v.dir}/INDEX.md\nMap: ${page}`)
  } else if (cmd === 'scan') { const r = await post('scan'); console.log(`${r.added} new call(s). ${r.newCalls} unread in all. Read them with: think library ${id} process`) }
  else if (cmd === 'process') { const only = rest.indexOf('--only') > 0 ? rest[rest.indexOf('--only') + 1] : undefined; await post('process', { only, model }); console.log(`Reading. Follow it on ${page} or with: think library ${id} status`) }
  else if (cmd === 'refile') { const r = await post('refile'); console.log(`${r.filed} filed, ${r.review} to check.`) }
  else if (cmd === 'crosscheck') { await post('crosscheck', { model }); console.log(`Cross-checking on Opus. Results on ${page} (Applies elsewhere) and in INDEX.md.`) }
  else if (cmd === 'ask') { const r = await post('ask', { question: text }); console.log(r.answer); if (r.gaps?.length) console.log(`Not settled: ${r.gaps.join('; ')}`) }
  else if (cmd === 'next') show(v.questions.find(x => x.now) || v.questions[0])
  else if (['answer', 'file', 'skip'].includes(cmd)) {
    const q = v.questions.find(x => x.now) || v.questions[0]
    if (!q) { show(null); process.exit(0) }
    if (cmd === 'skip') await post('answer', { qid: q.id, skip: true, items: q.items?.map(i => i.id) })
    else if (q.kind === 'thread') { if (!text) { console.error('Write the answer.'); process.exit(1) } await post('answer', { qid: q.id, text }) }
    else if (cmd === 'file') { const ids = q.kind === 'group' ? q.items.map(i => i.id) : [q.item]; for (const x of ids) await post('answer', { qid: 'i:' + x, branch: text }) }
    else if (q.kind === 'group') await post('confirm', { items: q.items.map(i => i.id) })
    else await post('answer', { qid: q.id, branch: q.guess })
    console.log('Saved.')
    const qs = (await get(`/api/library/${id}`)).questions
    show(qs.find(x => x.now) || qs[0])
  } else if (cmd === 'open') { spawn('open', [page], { stdio: 'ignore', detached: true }).unref(); console.log(page) }
  else { console.error(`Unknown command "${cmd}".`); process.exit(1) }
  process.exit(0)
}

// Pick up waiting on a run: skips the question already on screen, returns at the next one or the end.
if (args[0] === 'watch') {
  const id = args[1]
  const r = await get(`/api/runs/${id}`).catch(() => null)
  if (!r || r.error) { console.error('No such run.'); process.exit(1) }
  await watch(id, `${BASE}/run/${id}`, new Set(r.order.filter(i => r.nodes[i].status === 'waiting')))
}

let url = BASE, run = null
if (input) {
  const res = await fetch(BASE + '/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input, model, effort, handsOff, ...(noJev ? { jev: false } : {}) }) })
  run = await res.json()
  if (!res.ok) { console.error(run.error); process.exit(1) }
  url = `${BASE}/run/${run.id}`
}
console.log(`Live map: ${url}`)
if (!noOpen) {
  const [cmd, ...pre] = process.platform === 'darwin' ? ['open'] : process.platform === 'win32' ? ['cmd', '/c', 'start', ''] : ['xdg-open']
  spawn(cmd, [...pre, url], { stdio: 'ignore', detached: true }).on('error', () => {}).unref()
}
if (!wait || !run) process.exit(0)

await watch(run.id, `${BASE}/run/${run.id}`, new Set())

// Narrate the run in plain lines. Return when it asks something new (exit 3) or finishes (exit 0).
async function watch(id, url, ignore) {
  const said = new Set()
  const say = line => { if (!said.has(line)) { said.add(line); console.log(line) } }
  for (;;) {
    const r = await get(`/api/runs/${id}`).catch(() => null)
    if (!r || r.error) { console.error('Lost the run. Is the app still running?'); process.exit(1) }
    const nodes = r.order.map(i => r.nodes[i]).filter(n => n.status !== 'superseded')
    for (const n of nodes.filter(n => n.scope === 'root')) {
      if (n.status === 'running') say(`... ${n.title}`)
      if (n.status === 'done' && (n.kind === 'frame' || n.kind === 'converge') && n.out.question) say(`Question now: ${n.out.question}`)
      const j = n.status === 'done' && n.data.jev
      if (j?.kind === 'route' && !j.fallback) say(`Jev: ${n.out.summary}`)
      if (j?.kind === 'gate' && j.next) say(`Jev: next is ${j.next} (${Math.round(j.confidence * 100)}% sure${j.decidedBy === 'claude' ? ', too unsure, so Claude decided' : ''})`)
      if (n.status === 'error') say(`A step failed (${n.title}): ${n.error}. Open the map and press Try again.`)
    }
    const ask = nodes.find(n => n.status === 'waiting' && !ignore.has(n.id))
    if (ask) {
      console.log(`\nWAITING FOR YOU (run ${id}). Answer on the map (${url}) or with: think answer ${id} "..."`)
      for (const q of ask.data.questions) console.log(`  - ${q.q}${q.options.length ? ` [${q.options.join(' | ')}]` : ''}\n    why it matters: ${q.why}`)
      process.exit(3)
    }
    if (r.status === 'done') {
      const record = join(h.runsDir, id, 'record.md')
      for (let i = 0; i < 20 && !existsSync(record); i++) await sleep(200)
      console.log(`\nDONE. Record: ${record}\n`)
      console.log(existsSync(record) ? readFileSync(record, 'utf8') : '(record not written yet)')
      process.exit(0)
    }
    if (r.status === 'error' && !nodes.some(n => ['running', 'queued', 'waiting'].includes(n.status))) process.exit(2)
    await sleep(2000)
  }
}
