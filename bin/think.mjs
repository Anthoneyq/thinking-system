#!/usr/bin/env node
// think "a thought" | think notes.md | pbpaste | think
//   --model <id>          claude-sonnet-5-5 (default), claude-opus-5-5, claude-haiku-5-5, codex, dry
//   --effort <level>      quick | normal (default) | deep
//   --hands-off           never stop to ask; decide everything itself
//   --wait                follow the run; return when it asks you something (exit 3) or finishes with the record (exit 0)
//   --no-open             don't open the browser
// think answer <run-id> "your answer"   answer the questions it is waiting on (or --skip to let it decide)
// think watch <run-id>                  keep following a run after a question
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
const handsOff = bool('--hands-off'), wait = bool('--wait'), noOpen = bool('--no-open') || !!process.env.THINK_NO_OPEN

// Answer from the chat instead of the browser.
if (args[0] === 'answer') {
  const [, id, ...rest] = args
  const skip = rest.includes('--skip'), text = rest.filter(x => x !== '--skip').join(' ').trim()
  const r = await fetch(`${BASE}/api/runs/${id}`).then(x => x.json()).catch(() => null)
  const ask = r?.order?.map(i => r.nodes[i]).find(n => n.status === 'waiting')
  if (!ask) { console.error('That run is not waiting for an answer.'); process.exit(1) }
  const res = await fetch(`${BASE}/api/runs/${id}/answer`, { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ nodeId: ask.id, skip: skip || !text, answers: [{ q: ask.data.questions.map(q => q.q).join(' / '), a: text }] }) })
  console.log(res.ok ? 'Answered. The run carries on.' : (await res.json()).error)
  process.exit(res.ok ? 0 : 1)
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

// Pick up waiting on a run: skips the question already on screen, returns at the next one or the end.
if (args[0] === 'watch') {
  const id = args[1]
  const r = await get(`/api/runs/${id}`).catch(() => null)
  if (!r || r.error) { console.error('No such run.'); process.exit(1) }
  await watch(id, `${BASE}/run/${id}`, new Set(r.order.filter(i => r.nodes[i].status === 'waiting')))
}

let url = BASE, run = null
if (input) {
  const res = await fetch(BASE + '/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input, model, effort, handsOff }) })
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
