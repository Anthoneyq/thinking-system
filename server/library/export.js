// The record as plain Markdown next to the data, so any AI or person can read it without the app.
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

const STATUS = { unsettled: 'Talked about, never settled', open: 'Open', assumed: 'Assumed, never confirmed', decided: 'Decided', done: 'Done' }
const ORDER = ['unsettled', 'open', 'assumed', 'decided', 'done']

export function writeMarkdown(lib, s, v) {
  const index = new Map()
  const walk = (ns, parent) => ns.forEach(n => { index.set(n.id, { ...n, parent }); walk(n.children || [], n.id) })
  walk(s.tree.branches, null)
  const path = id => { const p = []; for (let n = index.get(id); n; n = index.get(n.parent)) p.unshift(n.name); return p.join(' › ') }
  const src = id => { const i = s.items[id]; return i ? `${i.file}${i.at ? ' ' + i.at : ''}` : id }
  const c = v.counts
  const out = [
    `# ${lib.name}: conversation index`,
    '',
    `Built by the Thinking System (Conversations mode). Open the live map: http://localhost:4477/library/${lib.id}`,
    `Updated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC. ${c.calls} calls, ${c.items} items, ${c.filed} filed, ${c.review} to check, ${c.threads} topics (${c.open} not settled).`,
    `Items file on their own at ${Math.round(v.fileAt * 100)}% confidence or higher; below that they wait for a person. Data: \`library.json\`, branches: \`tree.json\`.`,
    '',
    '## Needs you',
    '',
    ...v.questions.slice(0, 25).map((q, k) => q.kind === 'thread'
      ? `${k + 1}. **${q.q}** (${STATUS[q.status].toLowerCase()}, ${q.where})${q.ways?.length ? `\n   Ways it was talked about: ${q.ways.join(' / ')}` : ''}`
      : `${k + 1}. **Where does this belong?** "${q.q}" — best guess ${q.guessName} (${q.why}). From ${q.call ? s.calls[q.call]?.file : ''} ${q.at || ''}`),
    v.questions.length > 25 ? `\n…and ${v.questions.length - 25} more in the app.` : '',
    '',
  ]
  if (s.crosslinks.length) {
    out.push('## Applies elsewhere (last cross-check)', '', ...(s.crosscheckSummary ? [s.crosscheckSummary, ''] : []))
    for (const l of s.crosslinks) out.push(`- **${l.fromName} → ${l.toName}** (${l.strength}): ${l.idea} First step: ${l.action}`)
    out.push('')
  }
  out.push('## By branch', '')
  const threads = Object.values(s.threads)
  for (const top of s.tree.branches) {
    const here = threads.filter(t => t.branch === top.id || t.branch.startsWith(top.id + '.'))
    if (!here.length) continue
    out.push(`### ${top.name}`, '')
    for (const st of ORDER) {
      const ts = here.filter(t => t.status === st).sort((a, b) => (b.last || '').localeCompare(a.last || ''))
      if (!ts.length) continue
      out.push(`**${STATUS[st]}**`, '')
      for (const t of ts) {
        out.push(`- **${t.title}** — ${path(t.branch)}. ${t.summary}${t.decision ? ` Decision: ${t.decision}${t.answeredBy ? ' (answered in the app)' : ''}` : ''}`)
        out.push(`  Sources: ${t.items.slice(0, 6).map(src).join('; ')}${t.items.length > 6 ? `; +${t.items.length - 6} more` : ''}`)
      }
      out.push('')
    }
  }
  out.push('## Calls read', '')
  for (const call of v.calls) out.push(`- ${call.date} ${call.file}: ${call.status === 'dup' ? `same as ${call.dupOf}` : call.status === 'done' ? `${call.items} items. ${call.summary || ''}` : call.status}`)
  writeFileSync(join(lib.dir, 'INDEX.md'), out.join('\n') + '\n')
}
