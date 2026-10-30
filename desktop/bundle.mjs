// Copies the built page and server into the app, then (with "win" or "mac") builds the installer named for the team.
// team.json (kept out of git) says which team: { name, library, libraryName, repo, clientId }.
import { cpSync, rmSync, mkdirSync, readFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
execSync('npm run build', { cwd: '..', stdio: 'inherit' })
rmSync('bundle', { recursive: true, force: true })
mkdirSync('bundle/.claude-plugin', { recursive: true })
cpSync('../app/server.mjs', 'bundle/app/server.mjs')
cpSync('../dist', 'bundle/dist', { recursive: true })
cpSync('../.claude-plugin/plugin.json', 'bundle/.claude-plugin/plugin.json')
const target = process.argv[2]
if (target) {
  const team = JSON.parse(readFileSync('team.json', 'utf8'))
  const { build, Platform } = await import('electron-builder')
  const base = JSON.parse(readFileSync('package.json', 'utf8')).build
  await build({
    targets: (target === 'win' ? Platform.WINDOWS : Platform.MAC).createTarget(),
    config: { ...base, productName: team.name, nsis: { ...base.nsis, shortcutName: team.name } },
  })
}
