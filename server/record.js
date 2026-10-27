// The decision record written next to run.json when the top-level flow finishes.
export function recordMarkdown(run) {
  const all = run.order.map(id => run.nodes[id]).filter(n => n.status === 'done' && n.scope === 'root')
  const last = kind => all.filter(n => n.kind === kind).at(-1)?.out
  const d = last('decide'), f = last('frame'), narrow = last('narrow'), review = last('review')
  const bullets = xs => (xs || []).map(x => `- ${x}`).join('\n') || '- none'
  const lines = [
    `# ${d.title}`, '',
    `Run ${run.id} - ${run.createdAt.slice(0, 16).replace('T', ' ')} - ${run.model} - effort ${run.effort}`, '',
    `## Recommendation`, d.recommendation, '',
    `**Goal served:** ${d.goal_served}`, '',
    `**Next action:** ${d.next_action.what} (owner: ${d.next_action.owner}, when: ${d.next_action.when})`, '',
    d.test ? `**Smallest test:** ${d.test}\n` : '',
    `## Why`, bullets(d.reasons), '',
    `## Tradeoffs`, bullets(d.tradeoffs), '',
    `## Cut`, bullets(d.cuts.map(c => `${c.what} - ${c.why}`)), '',
    `## Still uncertain`, bullets(d.uncertainty), '',
    `## Would change the answer`, bullets(d.would_change), '',
  ]
  if (f) lines.push(`## What you said vs what was inferred`,
    `**Goal (${f.goal.source}):** ${f.goal.text}`, '', '**Stated**', bullets(f.stated), '',
    '**Inferred**', bullets(f.inferred.map(i => `${i.text} (why: ${i.why})`)), '')
  if (run.corrections.length) lines.push('## Your corrections', bullets(run.corrections.map(c => `${c.action}: ${c.original}${c.text ? ' -> ' + c.text : ''}`)), '')
  if (narrow) lines.push('## Every option considered', bullets(narrow.all.map(o => `${o.title}: ${o.detail}`)), '')
  if (review) lines.push('## Skeptic objections', bullets(review.objections.map(o => `[${o.severity}] ${o.text} Fix: ${o.fix}`)), '')
  lines.push('## Methods used', bullets(all.filter(n => n.kind === 'method').map(n => `${n.title}: ${n.data.focus}`)), '',
    '## Original thought', '```', run.input, '```', '')
  return lines.join('\n')
}
