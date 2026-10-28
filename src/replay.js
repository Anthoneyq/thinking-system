// Rebuild a finished run as it stood at each moment, so a static page can play it back without a server.
export function timeline(run) {
  const ns = run.order.map(i => run.nodes[i]).filter(n => n.status !== 'superseded')
  // Answers carry no end time in older runs: the step that followed them marks it.
  const doneAt = n => n.endedAt || (n.kind === 'ask' && ns.filter(x => x.deps.includes(n.id)).map(x => x.createdAt).sort()[0]) || n.createdAt
  const times = [...new Set(ns.flatMap(n => [n.createdAt, n.startedAt, doneAt(n)]).filter(Boolean))].sort()
  const end = times.at(-1)
  const frame = t => {
    const nodes = {}, order = []
    for (const n of ns) {
      if (n.createdAt > t) continue
      const fin = doneAt(n) <= t
      const status = n.kind === 'ask' ? (fin ? 'done' : 'waiting')
        : n.kind === 'capture' || fin ? 'done' : n.startedAt && n.startedAt <= t ? 'running' : 'queued'
      nodes[n.id] = { ...n, status, out: status === 'done' ? n.out : null, data: status === 'waiting' ? { ...n.data, unclear: undefined } : n.data }
      order.push(n.id)
    }
    const share = order.length / ns.length
    return { ...run, nodes, order, status: t >= end ? 'done' : 'running', cost: t >= end ? run.cost : run.cost * share }
  }
  return { times, frame }
}
