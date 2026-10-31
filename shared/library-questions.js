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
