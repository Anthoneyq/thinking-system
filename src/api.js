export async function api(path, body) {
  const res = await fetch('/api/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

export const go = path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate')) }

export function summary(n) {
  const o = n.out
  if (n.status === 'error') return n.error
  if (n.status === 'waiting') return n.data.questions?.length ? `${n.data.questions.length} question(s) for you` : 'Waiting for you'
  if (!o) return n.status === 'running' ? 'Thinking...' : n.status === 'queued' ? 'Up next' : ''
  if (n.kind === 'capture') return o.text
  if (n.kind === 'decide') return o.recommendation
  if (n.kind === 'unstick') return o.plain
  if (n.kind === 'method') return o.summary
  if (n.kind === 'develop') return `${o.verdict[0].toUpperCase() + o.verdict.slice(1)} - ${o.summary}`
  if (n.kind === 'converge') return o.question
  return o.summary
}

export const KIND_LABEL = {
  capture: 'Input', frame: 'Frame', ask: 'You', route: 'Router', method: 'Method', narrow: 'Wide to narrow',
  assess: 'Confidence gate', converge: 'Come together', develop: 'Grow', research: 'Research', review: 'Adversarial', decide: 'Record', unstick: 'Unstick',
}
