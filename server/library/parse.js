// Turns a conversation file (.vtt, .docx, .md, .txt) into speaker turns with times, so every item can point back to its moment.
import { readFileSync, statSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { basename, extname } from 'node:path'

export const KINDS = ['.vtt', '.docx', '.md', '.txt']

const clock = s => s.replace(/\.\d+$/, '').replace(/^00:/, '')

// Teams/Zoom VTT: cues split one sentence into fragments; join a speaker's consecutive cues into one turn.
function vtt(text) {
  const turns = []
  for (const block of text.replace(/\r/g, '').split(/\n\n+/)) {
    const lines = block.split('\n')
    const t = lines.findIndex(l => l.includes('-->'))
    if (t < 0) continue
    const at = clock(lines[t].split('-->')[0].trim())
    let body = lines.slice(t + 1).join(' ').trim()
    const v = body.match(/^<v ([^>]+)>/) || body.match(/^([A-Z][^:<>]{1,40}):\s/)
    const who = v ? person(v[1]) : ''
    body = body.replace(/<\/?v[^>]*>/g, '').replace(v && !body.startsWith('<v') ? v[0] : /^$/, '').replace(/\s+/g, ' ').trim()
    if (!body) continue
    const last = turns.at(-1)
    if (last && last.who === who && last.text.length < 1200) last.text += ' ' + body
    else turns.push({ at, who, text: body })
  }
  return turns
}

// "Jane L. Doe, PE, CFM", "JaneLDoePECFM" and "Sam Q., MBA" all become a first name.
export const person = s => s.trim().split(/[,\s]/)[0].replace(/^([A-Z][a-z]+)[A-Z].*$/, '$1')

// Teams Word export: "Name   0:03 words" per line.
const TEAMS = /^\s*([A-Z][^\d]{1,60}?)\s{2,}(\d{1,2}:\d{2}(?::\d{2})?)\s+(.*)$/

// Plain text: Teams lines or "Name: words" lines become turns; anything else is one turn per paragraph.
function plain(text) {
  const lines = text.replace(/\r/g, '').split('\n')
  if (lines.filter(l => TEAMS.test(l)).length > 5) {
    return lines.map(l => l.match(TEAMS)).filter(Boolean).map(([, who, at, t]) => ({ at, who: person(who), text: t.trim() }))
  }
  return text.replace(/\r/g, '').split(/\n\s*\n/).map(p => p.replace(/\s+/g, ' ').trim()).filter(Boolean).map(p => {
    const m = p.match(/^([A-Z][\w.'-]*(?: [A-Z][\w.'-]*){0,3}):\s+(.*)$/)
    return m ? { at: '', who: person(m[1]), text: m[2] } : { at: '', who: '', text: p }
  })
}

function docx(path) {
  const r = spawnSync('textutil', ['-convert', 'txt', '-stdout', path], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  if (r.error || r.status !== 0) throw new Error(`Could not read ${basename(path)} (textutil)`)
  return r.stdout
}

// Date from a "2026-10-12 ..." name, else the file's modified date.
export function callDate(path) {
  const m = basename(path).match(/(\d{4}-\d{2}-\d{2})/)
  return m ? m[1] : statSync(path).mtime.toISOString().slice(0, 10)
}

export function parseFile(path) {
  const ext = extname(path).toLowerCase()
  const raw = ext === '.docx' ? docx(path) : readFileSync(path, 'utf8')
  const turns = ext === '.vtt' ? vtt(raw) : plain(raw)
  const text = turns.map(t => `${t.at ? `[${t.at}] ` : ''}${t.who ? t.who + ': ' : ''}${t.text}`).join('\n')
  return {
    file: basename(path),
    title: basename(path, extname(path)).replace(/^\d{4}-\d{2}-\d{2}\s*/, ''),
    date: callDate(path),
    hash: createHash('sha1').update(text).digest('hex').slice(0, 12),
    speakers: [...new Set(turns.map(t => t.who).filter(Boolean))],
    turns: turns.length,
    text,
  }
}

// Split long calls on turn boundaries so each extraction stays sharp.
export function chunks(text, max = 48000) {
  if (text.length <= max) return [text]
  const out = []
  let cur = ''
  for (const line of text.split('\n')) {
    if (cur.length + line.length > max && cur) { out.push(cur); cur = '' }
    cur += line + '\n'
  }
  if (cur.trim()) out.push(cur)
  return out
}
