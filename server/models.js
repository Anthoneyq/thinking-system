import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fake } from './dryrun.js'

const ALL = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5', engine: 'claude', web: true },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5', engine: 'claude', web: true },
  { id: 'claude-fable-5-1', label: 'Claude Fable 5.1', engine: 'claude', web: true },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 (fast, cheap)', engine: 'claude', web: true },
  { id: 'codex', label: 'GPT via Codex (your Codex default)', engine: 'codex', web: true },
  { id: 'dry', label: 'Dry run (no AI, sample content)', engine: 'dry', web: false },
]
// Offer only what this machine can run.
const has = cmd => !spawnSync(cmd, ['--version'], { stdio: 'ignore' }).error
const ENGINES = { claude: has('claude'), codex: has('codex'), dry: true }
export const MODELS = ALL.filter(m => ENGINES[m.engine])
const ALIAS = { sonnet: 'claude-sonnet-5-5', opus: 'claude-opus-5-5', fable: 'claude-fable-5-1', haiku: 'claude-haiku-5-5', gpt: 'codex', 'dry-run': 'dry' }
export const resolveModel = id => {
  if (!id) return MODELS[0].id
  const m = MODELS.find(x => x.id === (ALIAS[id] || id))
  if (!m) throw new Error(`Unknown or unavailable model "${id}". Use one of: ${MODELS.map(x => x.id).join(', ')}`)
  return m.id
}
export const modelById = id => MODELS.find(m => m.id === id) || MODELS[0]

const TIMEOUT = 6 * 60 * 1000

function run(cmd, args, input, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: process.env })
    let out = '', err = ''
    const timer = setTimeout(() => { p.kill('SIGTERM'); reject(new Error(`${cmd} timed out`)) }, TIMEOUT)
    p.stdout.on('data', d => (out += d))
    p.stderr.on('data', d => (err += d))
    p.on('error', e => { clearTimeout(timer); reject(e) })
    p.on('close', code => {
      clearTimeout(timer)
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${(err || out).slice(-400)}`))
    })
    if (input != null) p.stdin.end(input)
  })
}

// Returns { out, cost } where out matches the schema.
export async function callModel({ model, system, prompt, schema, kind, web }) {
  const m = modelById(model)
  const cwd = mkdtempSync(join(tmpdir(), 'think-'))
  try {
    if (m.engine === 'dry') return { out: await fake(kind, prompt), cost: 0 }

    if (m.engine === 'claude') {
      // Lean call: no tools (unless researching), no MCP, no settings, no saved session.
      const args = ['-p', '--output-format', 'json', '--model', m.id,
        '--tools', web ? 'WebSearch,WebFetch' : '',
        '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '',
        '--system-prompt', system, '--no-session-persistence', '--json-schema', JSON.stringify(schema)]
      if (web) args.push('--allowedTools', 'WebSearch,WebFetch')
      const res = JSON.parse(await run('claude', args, prompt, cwd))
      if (res.is_error || !res.structured_output) throw new Error(res.result || 'No structured output from Claude')
      return { out: res.structured_output, cost: res.total_cost_usd || 0 }
    }

    if (m.engine === 'codex') {
      writeFileSync(join(cwd, 'schema.json'), JSON.stringify(schema))
      const args = [...(web ? ['--search'] : []), 'exec', '--skip-git-repo-check', '--ephemeral', '-s', 'read-only',
        '-c', 'model_reasoning_effort=medium', '--output-schema', 'schema.json', '-o', 'out.json', '-']
      await run('codex', args, `${system}\n\n${prompt}`, cwd)
      return { out: JSON.parse(readFileSync(join(cwd, 'out.json'), 'utf8')), cost: 0 }
    }
    throw new Error('Unknown model ' + model)
  } finally {
    rmSync(cwd, { recursive: true, force: true })
  }
}
