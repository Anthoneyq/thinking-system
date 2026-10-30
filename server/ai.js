// Whether this computer's own AI (Claude Code, signed in to the person's plan) is ready, and a one-click way to connect it.
// Teammates read the transcripts they add with their own AI, so nothing runs on anyone else's account.
import { spawnSync, spawn } from 'node:child_process'
import { writeFileSync, chmodSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, delimiter } from 'node:path'

// Claude Code installs here on Mac and Windows; an app opened from the Dock or Start menu doesn't have it on PATH.
const BIN = join(homedir(), '.local', 'bin')
for (const dir of [BIN, ...(process.platform === 'darwin' ? ['/opt/homebrew/bin', '/usr/local/bin'] : [])])
  if (!process.env.PATH.split(delimiter).includes(dir)) process.env.PATH = [dir, process.env.PATH].join(delimiter)

let cache = null
export function aiStatus(fresh = false) {
  if (cache && !fresh && Date.now() - cache.at < 60000) return cache
  const r = spawnSync('claude', ['auth', 'status'], { encoding: 'utf8', timeout: 20000 })
  let loggedIn = false
  try { loggedIn = !!JSON.parse(r.stdout).loggedIn } catch {}
  cache = { at: Date.now(), installed: !r.error, loggedIn }
  return cache
}

// Opens a terminal that installs Claude Code if needed, then signs in (a browser page gives the code to paste back).
export function connectAI() {
  cache = null
  if (process.env.THINK_NO_TERMINAL) return { ok: true }
  if (process.platform === 'win32') {
    const file = join(tmpdir(), 'connect-your-ai.ps1')
    writeFileSync(file, `$Host.UI.RawUI.WindowTitle = 'Connect your AI'
Write-Host 'Connecting your AI (Claude). This takes a minute or two.' -ForegroundColor Cyan
if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
  Write-Host 'Installing Git (Claude needs it)...'
  winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements
}
if (-not (Test-Path "$env:USERPROFILE\\.local\\bin\\claude.exe")) {
  Write-Host 'Installing Claude...'
  irm https://claude.ai/install.ps1 | iex
}
Write-Host ''
Write-Host 'Now sign in. A browser page opens; if it shows a code, paste it here.' -ForegroundColor Cyan
& "$env:USERPROFILE\\.local\\bin\\claude.exe" auth login
Write-Host ''
Write-Host 'Done. Close this window and go back to the app.' -ForegroundColor Green
`)
    spawn('cmd.exe', ['/c', `start "" powershell -NoExit -ExecutionPolicy Bypass -File "${file}"`], { detached: true, stdio: 'ignore', windowsVerbatimArguments: true }).unref()
  } else {
    const file = join(tmpdir(), 'Connect your AI.command')
    writeFileSync(file, `#!/bin/bash
echo "Connecting your AI (Claude). This takes a minute."
command -v claude >/dev/null || [ -x "$HOME/.local/bin/claude" ] || curl -fsSL https://claude.ai/install.sh | bash
echo
echo "Now sign in. A browser page opens; if it shows a code, paste it here."
"$HOME/.local/bin/claude" auth login || claude auth login
echo
echo "Done. Close this window and go back to the app."
`)
    chmodSync(file, 0o755)
    spawn('open', [file], { detached: true, stdio: 'ignore' }).unref()
  }
  return { ok: true }
}
