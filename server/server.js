import { createServer } from 'node:http'
import { readFileSync, existsSync } from 'node:fs'
import { join, extname, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as engine from './engine.js'
import { MODELS } from './models.js'
import { METHODS } from './methods.js'
import { toExcalidraw } from './excalidraw.js'
import { layout } from '../shared/layout.js'
import { writeRunFile, RUNS_DIR } from './store.js'

const PORT = Number(process.env.THINK_PORT || 4477)
const DIST = join(dirname(fileURLToPath(import.meta.url)), '../dist')
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png' }

const json = (res, code, body) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)) }
const body = req => new Promise((resolve, reject) => {
  let s = ''
  req.on('data', d => (s += d))
  req.on('end', () => { try { resolve(s ? JSON.parse(s) : {}) } catch (e) { reject(e) } })
})

const ACTIONS = { answer: engine.answer, rerun: engine.rerun, correct: engine.correct, stuck: engine.stuck, deeper: engine.deeper, pick: engine.pick, resume: engine.resume }

function sse(req, res, run) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
  let timer = null
  const send = () => { timer = null; res.write(`data: ${JSON.stringify(run)}\n\n`) }
  const onRun = r => { if (r.id === run.id && !timer) timer = setTimeout(send, 120) }
  send()
  engine.bus.on('run', onRun)
  const ping = setInterval(() => res.write(': ping\n\n'), 20000)
  req.on('close', () => { engine.bus.off('run', onRun); clearInterval(ping); clearTimeout(timer) })
}

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x')
  const parts = url.pathname.split('/').filter(Boolean)
  try {
    if (parts[0] === 'api') {
      const [, what, id, action] = parts
      if (what === 'health') return json(res, 200, { ok: true, runsDir: RUNS_DIR })
      if (what === 'meta') return json(res, 200, { models: MODELS, methods: METHODS.map(({ id, name, when }) => ({ id, name, when })) })
      if (what === 'runs' && !id && req.method === 'GET') return json(res, 200, engine.listRuns())
      if (what === 'runs' && !id && req.method === 'POST') {
        const b = await body(req)
        if (!b.input?.trim()) return json(res, 400, { error: 'Write a thought first' })
        return json(res, 200, { id: engine.createRun(b).id })
      }
      const run = engine.getRun(id)
      if (!run) return json(res, 404, { error: 'No such run' })
      if (!action) return json(res, 200, run)
      if (action === 'events') return sse(req, res, run)
      if (action === 'excalidraw') {
        const scope = url.searchParams.get('scope') || 'root'
        const file = JSON.stringify(toExcalidraw(run, layout(run, scope).positions), null, 2)
        writeRunFile(run, `flow-${scope}.excalidraw`, file)
        res.writeHead(200, { 'content-type': 'application/json', 'content-disposition': `attachment; filename="${run.id}-${scope}.excalidraw"` })
        return res.end(file)
      }
      if (ACTIONS[action] && req.method === 'POST') {
        ACTIONS[action](run, await body(req))
        return json(res, 200, { ok: true })
      }
      return json(res, 404, { error: 'Unknown endpoint' })
    }
    // Static app; any other path falls back to the single page.
    let file = join(DIST, url.pathname)
    if (!file.startsWith(DIST) || !existsSync(file) || !extname(file)) file = join(DIST, 'index.html')
    if (!existsSync(file)) { res.writeHead(500); return res.end('Run "npm run build" first.') }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' })
    res.end(readFileSync(file))
  } catch (e) {
    json(res, 400, { error: String(e.message || e) })
  }
}).listen(PORT, '127.0.0.1', () => console.log(`Thinking System on http://localhost:${PORT}  (runs in ${RUNS_DIR})`))
