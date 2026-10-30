// Team sync through one private GitHub repo, so several people work on the same record without passing files around.
// The repo holds data/Transcripts (the calls), data/record (the shared record) and data/changes/<who>.jsonl (each
// person's changes, so nobody writes anyone else's file). Members send their changes and replay everyone's on the
// shared record. The reader (the Mac that reads calls with Claude) applies everyone's changes, reads new calls,
// and sends the record back.
import { readFileSync, writeFileSync, existsSync, readdirSync, mkdirSync } from 'node:fs'
import { join, extname } from 'node:path'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { load, save, getLibrary, applyRemote, replaceBase, bus, readUpload, scan, processLibrary, preRead } from './library.js'
import { aiStatus } from '../ai.js'
import { KINDS } from './parse.js'

const API = 'https://api.github.com'
const EVERY = { member: 60000, reader: 120000 }
const RECORD = ['library.json', 'tree.json', 'INDEX.md']
const blobSha = buf => createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex')

// The token comes from the desktop app's sign-in, else the GitHub CLI on this Mac.
const token = lib => process.env.THINK_GITHUB_TOKEN || lib.sync.token || spawnSync('gh', ['auth', 'token'], { encoding: 'utf8' }).stdout?.trim()

async function gh(lib, path, opts = {}) {
  const res = await fetch(API + path, {
    ...opts,
    headers: { authorization: `Bearer ${token(lib)}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', ...(opts.body ? { 'content-type': 'application/json' } : {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
    signal: AbortSignal.timeout(120000),
  })
  if (res.status === 404 && opts.soft) return null
  if (!res.ok) throw Object.assign(new Error(`GitHub ${res.status}: ${(await res.text()).slice(0, 160)}`), { status: res.status })
  return res.status === 204 ? null : res.json()
}
const blob = async (lib, sha) => Buffer.from((await gh(lib, `/repos/${lib.sync.repo}/git/blobs/${sha}`)).content, 'base64')

// What is on GitHub now: the head commit and every file's blob sha.
async function remote(lib) {
  const ref = await gh(lib, `/repos/${lib.sync.repo}/git/ref/heads/main`, { soft: true }).catch(e => { if (e.status === 409) return null; throw e })
  if (!ref) return { head: null, files: {} }
  const commit = await gh(lib, `/repos/${lib.sync.repo}/git/commits/${ref.object.sha}`)
  const tree = await gh(lib, `/repos/${lib.sync.repo}/git/trees/${commit.tree.sha}?recursive=1`)
  return { head: ref.object.sha, tree: commit.tree.sha, files: Object.fromEntries(tree.tree.filter(t => t.type === 'blob').map(t => [t.path, t.sha])) }
}

const running = new Set()
export async function sync(id, { push = true } = {}) {
  const lib = getLibrary(id), s = load(id)
  // The reader waits for a read to finish before taking in anyone's changes.
  if (!lib?.sync || running.has(id) || (lib.sync.role === 'reader' && s.job?.running)) return
  running.add(id)
  const before = JSON.stringify([s.syncState?.error, s.outbox?.length, s.outfiles?.length])
  let dirty = false
  try {
    const r = await remote(lib)
    const changesDir = join(lib.dir, 'changes')
    mkdirSync(changesDir, { recursive: true })
    const seen = { ...s.syncState?.seen }
    // Everyone's change logs: fetch the ones that changed.
    for (const [path, sha] of Object.entries(r.files)) {
      if (!path.startsWith('data/changes/') || seen[path] === sha) continue
      writeFileSync(join(changesDir, path.slice('data/changes/'.length)), await blob(lib, sha))
      seen[path] = sha
    }
    // A member takes the newest shared record as its base.
    if (lib.sync.role === 'member') {
      const p = 'data/record/library.json', t = 'data/record/tree.json'
      if (r.files[p] && (seen[p] !== r.files[p] || seen[t] !== r.files[t])) {
        replaceBase(id, JSON.parse(await blob(lib, r.files[p])), JSON.parse(await blob(lib, r.files[t])))
        seen[p] = r.files[p]; seen[t] = r.files[t]; dirty = true
      }
    }
    const ops = readdirSync(changesDir).filter(f => f.endsWith('.jsonl')).flatMap(f => readFileSync(join(changesDir, f), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l) } catch { return null } }).filter(Boolean))
    // My unsent changes count too: a new base must not drop them.
    const applied = applyRemote(id, [...ops, ...(load(id).outbox || [])])
    if (applied) dirty = true
    // The reader brings down transcripts members added, and the readings they made with their own AI.
    const fresh = []
    if (lib.sync.role === 'reader') {
      const dir = lib.sources.find(x => existsSync(x) && !extname(x))
      mkdirSync(join(lib.dir, 'reads'), { recursive: true })
      for (const [path, sha] of Object.entries(r.files)) {
        if (path.startsWith('data/reads/') && seen[path] !== sha) { writeFileSync(join(lib.dir, 'reads', path.slice('data/reads/'.length)), await blob(lib, sha)); seen[path] = sha }
        const name = path.slice('data/Transcripts/'.length)
        if (!path.startsWith('data/Transcripts/') || name.includes('/') || existsSync(join(dir, name))) continue
        writeFileSync(join(dir, name), await blob(lib, sha)); dirty = true; fresh.push(name)
      }
    }
    const state = load(id)
    state.syncState = { ...state.syncState, seen }
    if (push) await send(id, lib, r)
    state.syncState = { ...state.syncState, last: new Date().toISOString(), error: '' }
    // Already read by the teammates who added them: take them in now (filing and topics only, no reading cost).
    if (fresh.length) {
      scan(id)
      const waiting = Object.values(load(id).calls).filter(c => c.status === 'new')
      if (waiting.length && waiting.every(c => preRead(id, c))) processLibrary(id)
    }
  } catch (e) {
    load(id).syncState = { ...load(id).syncState, error: e.message.slice(0, 200) }
  } finally {
    running.delete(id)
    const x = load(id)
    // Only a real change reloads the page; a quiet sync just notes the time.
    if (dirty || before !== JSON.stringify([x.syncState?.error, x.outbox?.length, x.outfiles?.length])) save(id)
  }
}

// One commit with everything that changed here: my change log, and for the reader the record and the calls.
async function send(id, lib, r) {
  const s = load(id), me = lib.sync.me
  const files = {}
  const mine = join(lib.dir, 'changes', `${me}.jsonl`)
  const sent = s.outbox?.length || 0, calls = s.outfiles?.length || 0
  const log = Buffer.from((existsSync(mine) ? readFileSync(mine, 'utf8') : '') + (s.outbox || []).map(o => JSON.stringify(o) + '\n').join(''))
  if (log.length) files[`data/changes/${me}.jsonl`] = log
  for (const f of s.outfiles || []) if (existsSync(f.path)) files[`data/Transcripts/${f.name}`] = readFileSync(f.path)
  const reads = (s.outreads || []).length
  for (const f of s.outreads || []) if (existsSync(f.path)) files[`data/reads/${f.name}.json`] = readFileSync(f.path)
  if (lib.sync.role === 'reader') {
    for (const f of RECORD) files[`data/record/${f}`] = readFileSync(join(lib.dir, f))
    const dir = lib.sources.find(x => existsSync(x) && !extname(x))
    for (const f of readdirSync(dir)) if (KINDS.includes(extname(f).toLowerCase()) && !f.startsWith('.')) files[`data/Transcripts/${f}`] = readFileSync(join(dir, f))
  }
  const changed = Object.entries(files).filter(([path, buf]) => r.files[path] !== blobSha(buf))
  if (changed.length) {
    const tree = []
    for (const [path, buf] of changed) {
      const b = await gh(lib, `/repos/${lib.sync.repo}/git/blobs`, { method: 'POST', body: { content: buf.toString('base64'), encoding: 'base64' } })
      tree.push({ path, mode: '100644', type: 'blob', sha: b.sha })
    }
    const t = await gh(lib, `/repos/${lib.sync.repo}/git/trees`, { method: 'POST', body: { ...(r.tree ? { base_tree: r.tree } : {}), tree } })
    const what = [sent && `${sent} change(s)`, calls && `${calls} call(s)`, lib.sync.role === 'reader' && changed.some(([p]) => p.startsWith('data/record/')) && 'record'].filter(Boolean).join(', ')
    const c = await gh(lib, `/repos/${lib.sync.repo}/git/commits`, { method: 'POST', body: { message: `${me}: ${what || 'sync'}`, tree: t.sha, parents: r.head ? [r.head] : [] } })
    // Someone else sent first: nothing is lost, the next sync tries again on top of theirs.
    if (r.head) await gh(lib, `/repos/${lib.sync.repo}/git/refs/heads/main`, { method: 'PATCH', body: { sha: c.sha } })
    else await gh(lib, `/repos/${lib.sync.repo}/git/refs`, { method: 'POST', body: { ref: 'refs/heads/main', sha: c.sha } })
    const seen = { ...s.syncState?.seen }
    for (const [path, b] of changed) seen[path] = blobSha(b)
    // A member's own record isn't the shared one; only its change log and calls count as seen.
    if (lib.sync.role === 'member') for (const p of Object.keys(seen)) if (p.startsWith('data/record/')) seen[p] = r.files[p]
    s.syncState = { ...s.syncState, seen }
  }
  // Sent: my log on disk now matches GitHub's, and the queue empties (anything added meanwhile stays queued).
  if (log.length) writeFileSync(mine, log)
  s.outbox = (s.outbox || []).slice(sent)
  s.outfiles = (s.outfiles || []).slice(calls)
  s.outreads = (s.outreads || []).slice(reads)
}

// A call a member adds: kept here until it is sent, then the reader reads it.
export function addTranscript(id, name, base64) {
  const lib = getLibrary(id), s = load(id)
  if (!KINDS.includes(extname(name).toLowerCase())) throw new Error(`Only ${KINDS.join(', ')} files`)
  const dir = join(lib.dir, 'outfiles')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name.replace(/[\\/:*?"<>|]/g, '-'))
  writeFileSync(path, Buffer.from(base64, 'base64'))
  const file = path.split(/[\\/]/).at(-1)
  ;(s.outfiles ||= []).push({ name: file, path })
  save(id)
  // With their own AI connected, the teammate reads it here; without, it goes up unread and the reader reads it.
  if (lib.sync?.role === 'member' && aiStatus().loggedIn) readUpload(id, path, file)
}

// Sync on a timer, and soon after any change made here.
export function startSync(ids) {
  for (const id of ids) {
    const lib = getLibrary(id)
    if (!lib?.sync) continue
    let soon = null
    sync(id)
    setInterval(() => sync(id), EVERY[lib.sync.role] || 60000)
    bus.on('change', x => { if (x === id) { clearTimeout(soon); soon = setTimeout(() => sync(id), 3000) } })
    bus.on('jobdone', x => { if (x === id) sync(id) })
  }
}
