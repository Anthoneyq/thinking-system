// The team app: sign in with GitHub once, then the shared record opens, works offline, and syncs on its own.
// It runs the same page and server as the Mac app, as a member: it answers and edits, and never reads calls itself.
import { app, BrowserWindow, Menu, safeStorage, shell, clipboard } from 'electron'
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createServer } from 'node:net'
import { homedir } from 'node:os'

const HERE = dirname(fileURLToPath(import.meta.url))
const TEAM = JSON.parse(readFileSync(join(HERE, 'team.json'), 'utf8'))
if (process.env.ELECTRON_USER_DATA) app.setPath('userData', process.env.ELECTRON_USER_DATA)
const DATA = app.getPath('userData')
const TOKEN = join(DATA, 'github-key')
let win, serverPort

if (!app.requestSingleInstanceLock()) app.quit()
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus() } })
app.on('window-all-closed', () => app.quit())

// ---------- small pages shown before the record opens ----------
const page = (title, body) => 'data:text/html;charset=utf-8,' + encodeURIComponent(`<!doctype html><html><head><meta charset="utf-8"><title>${title}</title><style>
  :root { color-scheme: light dark; --bg:#f4f5f7; --ink:#0e1014; --sub:#626877; --card:#fff; --accent:#3050f0 }
  @media (prefers-color-scheme: dark) { :root { --bg:#0b0c0f; --ink:#edeef1; --sub:#959ba7; --card:#15171c; --accent:#8299ff } }
  body { margin:0; height:100vh; display:grid; place-items:center; background:var(--bg); color:var(--ink); font:16px/1.5 -apple-system, "Segoe UI", system-ui, sans-serif }
  main { background:var(--card); padding:40px 48px; border-radius:16px; max-width:440px; text-align:center; box-shadow:0 20px 60px -20px rgba(0,0,0,.3) }
  h1 { font-size:22px; margin:0 0 8px } p { color:var(--sub); margin:8px 0 }
  .code { font:600 34px/1.2 ui-monospace, Consolas, monospace; letter-spacing:4px; margin:20px 0; color:var(--ink) }
  a.btn { display:inline-block; margin-top:16px; padding:12px 22px; border-radius:10px; background:var(--accent); color:#fff; text-decoration:none; font-weight:600 }
  a.link { display:inline-block; margin-top:12px; color:var(--sub) }
</style></head><body><main>${body}</main></body></html>`)
const show = (title, body) => win.loadURL(page(title, body))

// Links on those pages: GitHub opens in the browser; "app:" links are buttons.
const actions = {}
function wire() {
  win.webContents.on('will-navigate', (e, url) => {
    if (url.startsWith('http://127.0.0.1')) return
    e.preventDefault()
    if (url.startsWith('app:')) actions[url.slice(4)]?.()
    else shell.openExternal(url)
  })
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' } })
}

// ---------- GitHub sign-in: a one-time code each time, no password kept here ----------
const post = (url, body) => fetch(url, { method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json())
const gh = (token, path) => fetch('https://api.github.com' + path, { headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json' } })

async function signIn() {
  const d = await post('https://github.com/login/device/code', { client_id: TEAM.clientId, scope: 'repo' })
  if (!d.user_code) throw new Error(d.error_description || 'GitHub did not give a sign-in code')
  actions.open = () => { clipboard.writeText(d.user_code); shell.openExternal(d.verification_uri) }
  show('Sign in', `<h1>Sign in with GitHub</h1><p>Click the button, then paste this code on GitHub (it's already copied).</p>
    <div class="code">${d.user_code}</div><a class="btn" href="app:open">Open GitHub</a><p>This page moves on by itself once you approve.</p>`)
  let wait = (d.interval || 5) * 1000
  for (const end = Date.now() + d.expires_in * 1000; Date.now() < end;) {
    await new Promise(r => setTimeout(r, wait))
    const t = await post('https://github.com/login/oauth/access_token', { client_id: TEAM.clientId, device_code: d.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' })
    if (t.access_token) return t.access_token
    if (t.error === 'slow_down') wait += 5000
    else if (t.error !== 'authorization_pending') throw new Error(t.error_description || t.error)
  }
  throw new Error('The code expired. Try again.')
}

const saved = () => { try { return safeStorage.decryptString(readFileSync(TOKEN)) } catch { return null } }
const keep = t => writeFileSync(TOKEN, safeStorage.encryptString(t))
function signOut() { rmSync(TOKEN, { force: true }); app.relaunch(); app.exit(0) }

// ---------- start ----------
const freePort = () => new Promise(res => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)) }) })

async function start() {
  let token = process.env.THINK_GITHUB_TOKEN || saved()
  let login
  for (;;) {
    if (!token) { token = await signIn(); keep(token) }
    const me = await gh(token, '/user')
    if (me.status === 401) { token = null; continue }
    if (!me.ok) throw new Error(`GitHub ${me.status}`)
    login = (await me.json()).login
    const repo = await gh(token, `/repos/${TEAM.repo}`)
    if (repo.ok) break
    await new Promise(res => {
      actions.retry = res
      actions.other = signOut
      show('No access', `<h1>Almost there</h1><p>You're signed in as <b>${login}</b>, but that account can't see the team record yet.</p><p>Ask Anthoney to add <b>${login}</b> to ${TEAM.repo} on GitHub, then try again.</p><a class="btn" href="app:retry">Try again</a><br><a class="link" href="app:other">Sign in as someone else</a>`)
    })
  }
  show('Opening', `<h1>Opening the record…</h1><p>Signed in as ${login}.</p>`)
  if (serverPort) return win.loadURL(`http://127.0.0.1:${serverPort}/library/${TEAM.library}`)
  const port = serverPort = await freePort()
  mkdirSync(join(DATA, 'record'), { recursive: true })
  const config = join(DATA, 'config.json')
  writeFileSync(config, JSON.stringify({
    runsDir: join(DATA, 'runs'), rulesFile: join(DATA, 'rules.md'),
    libraries: [{ id: TEAM.library, name: TEAM.libraryName, sources: [], dir: join(DATA, 'record'), sync: { repo: TEAM.repo, role: 'member', me: process.env.THINK_ME || login } }],
  }, null, 2))
  Object.assign(process.env, { THINK_CONFIG: config, THINK_PORT: String(port), THINK_GITHUB_TOKEN: token })
  await import(pathToFileURL(join(HERE, 'bundle', 'app', 'server.mjs')).href)
  for (let k = 0; k < 50; k++) { try { if ((await fetch(`http://127.0.0.1:${port}/api/health`)).ok) break } catch {} await new Promise(r => setTimeout(r, 100)) }
  win.loadURL(`http://127.0.0.1:${port}/library/${TEAM.library}`)
}

// On the Mac that reads calls (its own config marks the library as the reader), the app is that Mac's copy: no
// sign-in, it opens the running Thinking System or starts it, and reads and syncs while open.
function readerConfig() {
  try { return JSON.parse(readFileSync(join(homedir(), '.thinking-system', 'config.json'), 'utf8')).libraries.some(l => l.id === TEAM.library && l.sync?.role === 'reader') } catch { return false }
}
async function startReader() {
  const url = `http://127.0.0.1:4477/library/${TEAM.library}`
  try { if ((await fetch('http://127.0.0.1:4477/api/health')).ok) return win.loadURL(url) } catch {}
  // Opened from the Dock, the app doesn't get the shell's PATH; claude and gh live in these.
  process.env.PATH = [join(homedir(), '.local', 'bin'), '/opt/homebrew/bin', '/usr/local/bin', process.env.PATH].join(':')
  await import(pathToFileURL(join(HERE, 'bundle', 'app', 'server.mjs')).href)
  for (let k = 0; k < 50; k++) { try { if ((await fetch('http://127.0.0.1:4477/api/health')).ok) break } catch {} await new Promise(r => setTimeout(r, 100)) }
  win.loadURL(url)
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
    { label: 'File', submenu: [{ label: 'Sign out', click: signOut }, { type: 'separator' }, { role: 'quit' }] },
    { role: 'editMenu' },
    { label: 'View', submenu: [{ role: 'reload' }, { role: 'zoomIn' }, { role: 'zoomOut' }, { role: 'resetZoom' }, { type: 'separator' }, { role: 'togglefullscreen' }] },
  ]))
  win = new BrowserWindow({ width: 1400, height: 900, title: TEAM.name, backgroundColor: '#f4f5f7', autoHideMenuBar: true })
  wire()
  ;(readerConfig() ? startReader : start)().catch(e => { actions.retry = () => start().catch(() => {}); show('Problem', `<h1>Something went wrong</h1><p>${String(e.message || e).replace(/</g, '&lt;')}</p><a class="btn" href="app:retry">Try again</a>`) })
})
