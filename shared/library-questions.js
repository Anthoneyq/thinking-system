// Use tree ancestry rather than ID prefixes: merged branches can keep their IDs.
export function questionBranches(q, threads) {
  if (q.kind === 'thread') return [threads[q.thread]?.branch].filter(Boolean)
  if (q.kind === 'tree') return [q.a.id, q.b.id]
  if (q.kind === 'place') return [q.guess]
  return [...new Set((q.items || []).map(i => i.branch))]
}

export function questionsInBranch(questions, threads, index, branch) {
  if (!branch) return questions
  const inside = id => {
    for (let n = index.get(id); n; n = index.get(n.parent)) if (n.id === branch) return true
    return false
  }
  return questions.flatMap(q => {
    if (q.kind === 'spot') {
      const items = q.items.filter(i => inside(i.branch))
      return items.length ? [{ ...q, items }] : []
    }
    return questionBranches(q, threads).some(inside) ? [q] : []
  })
}

// Sort fast: the stored groups, narrowed to the questions in view. Anything not sorted yet falls under its subject.
const KIND_ORDER = { owner: 0, keep: 1, subject: 2 }
export function fastGroups(questions, stored) {
  const open = questions.filter(q => q.kind === 'thread')
  const byId = new Map(open.map(q => [q.id, q])), taken = new Set(), groups = []
  for (const g of stored || []) {
    const qs = g.ids.filter(x => byId.has(x) && !taken.has(x)).map(x => byId.get(x))
    if (!qs.length) continue
    qs.forEach(q => taken.add(q.id))
    groups.push({ key: g.name, name: g.name, kind: g.kind, answers: g.answers || [], questions: qs })
  }
  const rest = {}
  for (const q of open) if (!taken.has(q.id)) (rest[q.where.split(' \u203a ').slice(0, 2).join(' \u203a ')] ||= []).push(q)
  for (const [name, qs] of Object.entries(rest)) groups.push({ key: 'area:' + name, name, kind: 'subject', answers: [], questions: qs })
  return groups.sort((a, b) => KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || b.questions.length - a.questions.length)
}

// A bulk answer never reaches a topic that already has a decision or that a teammate has open, unless ticked by hand.
export const startsTicked = q => !q.decided && !q.claimedBy

export function batchAnswers(questions, drafts, ticked) {
  return questions.filter(q => ticked.has(q.id) && !q.claimedBy && drafts[q.id]?.trim()).map(q => ({ qid: q.id, text: drafts[q.id].trim() }))
}
