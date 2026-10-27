#!/usr/bin/env node
// think "a thought" | think notes.md other.txt | pbpaste | think   [--model id] [--effort quick|normal|deep]
// Starts the local app if it isn't running, starts a run, and opens the live flowchart.
import { readFileSync, existsSync, openSync, realpathSync } from 'node:fs'
import { spawn, execSync } from 'node:child_process'
import { dirname, join, basename } from 'node:path'
import { homedir } from 'node:os'

const ROOT = join(dirname(realpathSync(process.argv[1])), '..')
const PORT = process.env.THINK_PORT || 4477
const BASE = `http://localhost:${PORT}`
const args = process.argv.slice(2)
const flag = name => { const i = args.indexOf(name); return i >= 0 ? args.splice(i, 2)[1] : undefined }
const model = flag('--model'), effort = flag('--effort')

const parts = args.map(a => existsSync(a) ? `--- ${basename(a)} ---\n${readFileSync(a, 'utf8')}` : a)
if (!process.stdin.isTTY) { const piped = readFileSync(0, 'utf8').trim(); if (piped) parts.push(piped) }
const input = parts.join('\n\n').trim()

const up = () => fetch(BASE + '/api/health').then(r => r.ok, () => false)
if (!(await up())) {
  if (!existsSync(join(ROOT, 'dist/index.html'))) execSync('npx vite build', { cwd: ROOT, stdio: 'ignore' })
  const log = openSync(join(homedir(), 'Library/Logs/thinking-system.log'), 'a')
  spawn(process.execPath, ['server/server.js'], { cwd: ROOT, detached: true, stdio: ['ignore', log, log] }).unref()
  for (let i = 0; i < 50 && !(await up()); i++) await new Promise(r => setTimeout(r, 100))
}

let url = BASE
if (input) {
  const res = await fetch(BASE + '/api/runs', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ input, model, effort }) })
  const data = await res.json()
  if (!res.ok) { console.error(data.error); process.exit(1) }
  url = `${BASE}/run/${data.id}`
}
console.log(url)
if (!process.env.THINK_NO_OPEN) spawn('open', [url], { stdio: 'ignore', detached: true }).unref()
