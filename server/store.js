import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Each run keeps its record on disk: THINK_RUNS_DIR, else runsDir in ~/.thinking-system/config.json, else ~/Thinking System/runs.
export const config = (() => { try { return JSON.parse(readFileSync(process.env.THINK_CONFIG || join(homedir(), '.thinking-system', 'config.json'), 'utf8')) } catch { return {} } })()
export const RUNS_DIR = process.env.THINK_RUNS_DIR || config.runsDir || join(homedir(), 'Thinking System', 'runs')

// Standing rules the user approved: if-then calls decided once and reused, so the same choice is not asked again.
export const RULES_FILE = process.env.THINK_RULES_FILE || config.rulesFile || join(homedir(), '.thinking-system', 'rules.md')
export const readRules = () => { try { return readFileSync(RULES_FILE, 'utf8').split('\n').filter(l => l.startsWith('- ')).map(l => l.slice(2)) } catch { return [] } }
export function addRule(text, from) {
  const head = existsSync(RULES_FILE) ? '' : '# Standing rules\n\nApproved if-then rules the Thinking System applies when they fit. Edit or delete freely.\n\n'
  writeFileSync(RULES_FILE, (existsSync(RULES_FILE) ? readFileSync(RULES_FILE, 'utf8') : head) + `- ${text.replace(/\s+/g, ' ').trim()} (from ${from})\n`)
}

const timers = new Map()

export const runDir = run => join(RUNS_DIR, run.id)

export function loadRuns() {
  if (!existsSync(RUNS_DIR)) return []
  return readdirSync(RUNS_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory() && existsSync(join(RUNS_DIR, d.name, 'run.json')))
    .map(d => { try { return JSON.parse(readFileSync(join(RUNS_DIR, d.name, 'run.json'), 'utf8')) } catch { return null } })
    .filter(Boolean)
}

export function saveRun(run, now = false) {
  const write = () => {
    timers.delete(run.id)
    mkdirSync(runDir(run), { recursive: true })
    writeFileSync(join(runDir(run), 'run.json'), JSON.stringify(run, null, 2))
  }
  clearTimeout(timers.get(run.id))
  if (now) return write()
  timers.set(run.id, setTimeout(write, 300))
}

export function writeRunFile(run, name, content) {
  mkdirSync(runDir(run), { recursive: true })
  const path = join(runDir(run), name)
  writeFileSync(path, content)
  return path
}
