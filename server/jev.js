// Jev (TypeSafe's System One model): fast, calibrated judgments that steer the run.
// Claude writes the content; Jev makes the routing calls. When Jev is unsure, Claude's own call stands.
import { config } from './store.js'
import { METHODS } from './methods.js'

const KEY = process.env.TYPESAFE_API_KEY || config.typesafeKey
export const JEV_AVAILABLE = !!KEY
const PRICE = 0.042 / 1e6 // per input token

async function ask(state, questions) {
  const t = Date.now()
  for (let attempt = 0; ; attempt++) {
    const res = await fetch('https://api.typesafe.ai/v1/systemone', {
      method: 'POST',
      headers: { authorization: `Bearer ${KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'jev-latest', state, questions }),
      signal: AbortSignal.timeout(30000),
    })
    if ((res.status === 429 || res.status === 529) && attempt < 3) { await new Promise(r => setTimeout(r, 500 * 2 ** attempt)); continue }
    if (!res.ok) throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const r = await res.json()
    return { a: r.answers, ms: Date.now() - t, cost: r.usage.input_tokens * PRICE, model: r.model }
  }
}

export const jevAsk = ask
const meta = r => ({ ms: r.ms, model: r.model })
const shortThought = text => text.length > 4000 ? text.slice(0, 4000) + '...' : text

// The situation every judgment reads, built from the latest frame and question.
export function situation(run, frame, question, extra = {}) {
  const f = frame?.out
  return {
    thought: shortThought(run.input),
    goal: f ? `${f.goal.text} (${f.goal.source})` : 'unknown',
    question,
    hard_constraints: f ? f.constraints.filter(c => c.hard).map(c => c.text) : [],
    other_constraints: [...(f ? f.constraints.filter(c => !c.hard).map(c => c.text) : []), ...run.constraints.map(c => c.text)],
    unknowns: f ? f.unknowns.map(u => u.text) : [],
    ...extra,
  }
}

// Route: one yes/no per method, all in one request. Returns null when nothing is a clear fit, so Claude routes instead.
export async function pickMethods(state, { max, exclude = [] }) {
  const pool = METHODS.filter(m => !exclude.includes(m.id))
  const questions = {
    simple: { type: 'noul', instructions: 'Is `question` simple enough that one quick line of thinking settles it?' },
    // The yes/no answers alone run high for most methods; one choice across all of them sets the lead.
    lead: { type: 'choice', instructions: 'Which thinking method would most help answer `question` toward `goal`?', criteria: Object.fromEntries(pool.map(m => [m.id, `${m.name}: ${m.when}`])) },
  }
  for (const m of pool) questions['m_' + m.id] = {
    type: 'noul',
    instructions: `Would the thinking method "${m.name}" materially help answer \`question\`, given \`goal\` and the situation? The method: ${m.how} It fits when: ${m.when}`,
    criteria: { true: 'Applying it here would surface options, risks or facts that could change the answer', false: 'It would add little here or does not fit this situation' },
  }
  const r = await ask(state, questions)
  const lead = r.a.lead.probabilities
  const scored = pool.map(m => ({ id: m.id, p: r.a['m_' + m.id].noul, lead: lead[m.id] || 0 })).sort((a, b) => (2 * b.lead + b.p) - (2 * a.lead + a.p))
  const simple = r.a.simple.noul >= 0.7
  const picks = scored.filter(s => s.p >= 0.5 || s.lead >= 0.1).slice(0, simple ? 1 : max)
  return { ...meta(r), cost: r.cost, simple, scored, picks: picks.length ? picks : null }
}

// Questions for the user: keep only ones whose answer changes the result; mark which block a good answer.
export async function weighQuestions(state, qs) {
  if (!qs.length) return null
  const questions = {}
  qs.forEach((q, i) => {
    questions['changes_' + i] = { type: 'noul', instructions: `Would the user's answer to \`candidate_questions[${i}]\` change the recommendation, the scope or the next action?` }
    questions['blocks_' + i] = { type: 'noul', instructions: `Is a good answer impossible without the user answering \`candidate_questions[${i}]\`, rather than a sensible default the system could choose and state?` }
  })
  const r = await ask({ ...state, candidate_questions: qs.map(q => `${q.q} (why: ${q.why})`) }, questions)
  return { ...meta(r), cost: r.cost, each: qs.map((q, i) => ({ changes: r.a['changes_' + i].noul, blocks: r.a['blocks_' + i].noul })) }
}

const NEXT = {
  commit: 'Enough is known: more work is unlikely to change which option to recommend or the next action',
  develop: 'The shortlisted options are promising but too vague to choose between; working out what each takes, its risks and a test would settle it',
  research: 'The choice hinges on facts that can be looked up, listed in `possible_research`',
  more: 'The options so far miss important angles; different kinds of thinking are needed before choosing',
  ask: 'The choice now depends on the user\'s preferences or facts only they know, listed in `possible_questions`',
}
const FIT = [
  'Works against the goal or ignores it',
  'Helps the goal a little',
  'Serves the goal with real trade-offs',
  'Serves the goal well within the constraints',
  'Clearly the strongest fit for the goal and constraints',
]

// Gate after the branches come back: what next, how well each option fits, and which break a hard constraint.
export async function gate(state, out, allowed) {
  const questions = {}
  if (allowed.length > 1) questions.next = { type: 'choice', instructions: 'The branches have reported and the options are in `options`. What should the thinking system do next?', criteria: Object.fromEntries(allowed.map(k => [k, NEXT[k]])) }
  out.all.forEach((o, i) => {
    questions['fit_' + i] = { type: 'score', instructions: `How well does \`options[${i}]\` serve \`goal\` and answer \`question\`?`, criteria: FIT }
    if (state.hard_constraints.length) questions['breaks_' + i] = { type: 'noul', instructions: `Does \`options[${i}]\` break any rule in \`hard_constraints\`?` }
  })
  const r = await ask({
    ...state,
    options: out.all.map(o => `${o.title}: ${o.detail}`),
    possible_questions: out.questions.map(q => q.q),
    possible_research: out.research.map(x => x.query),
  }, questions)
  const n = r.a.next
  return {
    ...meta(r), cost: r.cost,
    next: n?.choice ?? null, confidence: n?.confidence ?? 0, probabilities: n?.probabilities ?? {},
    options: out.all.map((o, i) => ({ id: o.id, fit: r.a['fit_' + i].score / (FIT.length - 1), fitConfidence: r.a['fit_' + i].confidence, breaks: r.a['breaks_' + i]?.noul ?? 0 })),
  }
}

// The user's replies ([{q, a}]): did each give the run something usable?
export async function checkAnswers(pairs) {
  const state = { questions: pairs.map(p => p.q), replies: pairs.map(p => p.a) }
  const qs = {}
  pairs.forEach((p, i) => {
    qs['ok_' + i] = {
      type: 'noul', instructions: `Does \`replies[${i}]\` give usable information for \`questions[${i}]\`?`,
      criteria: { true: 'It answers it, states a preference or fact that bears on it, or says to decide or skip it', false: 'It is about something else, contradicts itself, or is too vague to act on' },
    }
  })
  const r = await ask(state, qs)
  return { ...meta(r), cost: r.cost, each: pairs.map((p, i) => r.a['ok_' + i].noul) }
}
