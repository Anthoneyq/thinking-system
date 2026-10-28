import { mkdirSync, readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

// Each run keeps its record on disk: THINK_RUNS_DIR, else runsDir in ~/.thinking-system/config.json, else ~/Thinking System/runs.
export const config = (() => { try { return JSON.parse(readFileSync(join(homedir(), '.thinking-system', 'config.json'), 'utf8')) } catch { return {} } })()
export const RUNS_DIR = process.env.THINK_RUNS_DIR || config.runsDir || join(homedir(), 'Thinking System', 'runs')

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
