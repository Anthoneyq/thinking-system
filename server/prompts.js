import { METHODS, METHOD_IDS } from './methods.js'

// Strict JSON-schema helpers: every key required, no extras (works for Claude and OpenAI strict mode).
const str = { type: 'string' }
const bool = { type: 'boolean' }
const arr = items => ({ type: 'array', items })
const oneOf = (...values) => ({ type: 'string', enum: values })
const obj = props => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false })

const confidence = obj({ level: oneOf('low', 'medium', 'high'), basis: str })
const question = obj({ id: str, q: str, why: str, options: arr(str), blocking: bool })

export const SCHEMAS = {
  frame: obj({
    title: str,
    summary: str,
    goal: obj({ text: str, source: oneOf('stated', 'inferred', 'unknown') }),
    stated: arr(str),
    inferred: arr(obj({ text: str, why: str })),
    constraints: arr(obj({ text: str, source: oneOf('stated', 'inferred'), hard: bool })),
    evidence: arr(str),
    unknowns: arr(obj({ text: str, why_it_matters: str, action: oneOf('ask', 'research', 'test', 'decide', 'ignore'), how: str })),
    lenses: arr(str),
    confidence,
    questions: arr(question),
  }),
  route: obj({
    summary: str,
    simple: bool,
    plan: arr(obj({ method: oneOf(...METHOD_IDS), focus: str, why: str, checks: arr(str) })),
  }),
  method: obj({
    summary: str,
    findings: arr(obj({ text: str, kind: oneOf('evidence', 'inference', 'assumption') })),
    options: arr(obj({ title: str, detail: str })),
    cuts: arr(obj({ what: str, why: str })),
    risks: arr(str),
    unknowns: arr(str),
  }),
  narrow: obj({
    summary: str,
    all: arr(obj({ id: str, title: str, detail: str, from: arr(str) })),
    top: arr(obj({ id: str, why: str })),
    combine: str,
  }),
  assess: obj({
    summary: str,
    enough: bool,
    confidence,
    gaps: arr(obj({ text: str, action: oneOf('ask', 'research', 'test', 'decide') })),
    next: oneOf('commit', 'ask', 'research', 'more'),
    questions: arr(question),
    research: arr(obj({ query: str, why: str })),
    stop_reason: str,
  }),
  research: obj({
    summary: str,
    findings: arr(obj({ text: str, source: str })),
    verified: bool,
  }),
  review: obj({
    summary: str,
    objections: arr(obj({ text: str, severity: oneOf('fatal', 'serious', 'minor'), fix: str })),
    fatal: bool,
  }),
  decide: obj({
    title: str,
    summary: str,
    recommendation: str,
    goal_served: str,
    reasons: arr(str),
    tradeoffs: arr(str),
    cuts: arr(obj({ what: str, why: str })),
    uncertainty: arr(str),
    would_change: arr(str),
    next_action: obj({ what: str, owner: str, when: str }),
    test: str,
  }),
  unstick: obj({
    summary: str,
    plain: str,
    blocker: str,
    constraint: str,
    suggestion: oneOf('rerun', 'ask', 'nothing'),
  }),
}

export const SYSTEM = `You are one step inside a thinking system that turns an incomplete thought into clear action with less decision fatigue. It works for anyone and any subject.
Rules:
- Separate what the user STATED from what you INFER. Never present an inference as something they said. Corrections from the user override your inferences.
- Separate evidence from assumptions and unknowns.
- Explore widely, keep selectively, commit deliberately.
- Do not demand a clear goal. If the goal is unknown, say so and work toward discovering it.
- Ask only questions whose answer would change the recommendation, scope or action. Vague or low-stakes items: decide yourself and say so.
- Hard constraints eliminate options; they are never averaged away. Do not invent numeric precision; confidence names its basis.
- Plain words, short sentences. No filler, no hype. Each item says one thing once.
- Never invent facts about real people, companies, prices or results. If you do not know, it is an unknown.
Return only the JSON the schema asks for.`

const methodMenu = METHODS.map(m => `- ${m.id}: ${m.name}. Use when: ${m.when}`).join('\n')

const EFFORT_NOTE = {
  quick: 'Effort: quick. Use at most 2 methods. Prefer deciding over asking.',
  normal: 'Effort: normal. Use 2-4 methods.',
  deep: 'Effort: deep. Use 3-6 methods; be thorough but stop when more analysis would not change the next action.',
}

export function stepPrompt(kind, node, ctx, opts) {
  const head = `${ctx}\n\n---\n`
  switch (kind) {
    case 'frame':
      return head + `STEP: Frame the situation.
Echo back what the user explicitly said in compressed form ("stated"). If they stated a goal, goal.source = stated and goal.text is their goal compressed, faithful to their words. Otherwise infer one (source inferred) or mark it unknown.
List inferences separately with why you inferred each. Map constraints, evidence, and unknowns; for each unknown say what to do about it (ask the user, research it, test it, decide it yourself, or ignore).
Name the lenses (subject areas) that apply.
Questions: only ones whose answer would change the result. blocking = true only if a good answer is impossible without it. ${opts.askAllowed ? 'Up to 5 questions; offer 2-4 short answer options when natural.' : 'Asking is not available now: return questions as an empty list and decide instead.'}
title: 3-6 words naming this run.`
    case 'route':
      return head + `STEP: Choose thinking methods for ${node.data.followup ? 'the remaining gaps (follow-up pass; add only what is still needed, an empty plan is fine)' : 'this situation'}.
Method library:
${methodMenu}
${EFFORT_NOTE[opts.effort]} If the situation is simple, set simple = true and pick 1 method.
For each pick give a focus (the exact question it should answer here) and why. For domain-lens, list 3-6 checks specific to the subject in "checks"; otherwise checks = [].`
    case 'method':
      return head + `STEP: Apply the method "${node.data.name}".
How: ${node.data.how}
Focus: ${node.data.focus}
${node.data.checks?.length ? 'Checks: ' + node.data.checks.join('; ') : ''}
Report findings (mark each evidence / inference / assumption), options this method surfaces, anything that should be cut and why, risks, and new unknowns. Keep it tight.`
    case 'narrow':
      return head + `STEP: Show everything, then narrow to 3.
Collect every distinct option surfaced so far into "all" (merge duplicates, keep ids short like o1, o2). Then pick the top 3 (or fewer) that best serve the goal within the constraints, each with why. If parts of several options combine into something better, describe it in "combine"; else "".
${opts.picks ? 'The user picked these options and their choice wins: ' + opts.picks : ''}`
    case 'assess':
      return head + `STEP: Confidence gate. Is enough known to commit to a recommendation?
enough = true when further analysis is unlikely to change the next action within the effort budget. If not enough, choose next: ask (the user must supply something only they know), research (facts can be looked up), more (more thinking methods would help). Loops left: ${opts.loopsLeft}. If loops left is 0 you must choose commit and name what stays uncertain.
${opts.askAllowed ? '' : 'Asking is not available; do not choose ask.'}
${opts.researchAllowed ? '' : 'Research is not available; do not choose research.'}
Only fill questions when next = ask, and research when next = research (max 3 queries).
stop_reason: one sentence on why you stop or continue.`
    case 'research':
      return head + `STEP: Research. Query: ${node.data.query}
Why it matters: ${node.data.why}
${opts.web ? 'Use web search and fetch. Cite the source URL for each finding.' : 'You cannot browse. Answer from what you reliably know, set source to "" and verified = false.'}
Report only facts relevant to the decision.`
    case 'review':
      return head + `STEP: Adversarial review, one pass. Attack the leading direction as a sharp skeptic would. List real objections only, each with severity and a fix. fatal = true only if the direction should not go ahead as it stands.`
    case 'decide':
      return head + `STEP: Decision record. recommendation: the call itself in at most two short sentences (under 40 words); details go in reasons. Then the goal it serves, key reasons, tradeoffs, what to cut and why, what stays uncertain, what would change the answer, the single next action with owner (the user, or "AI" if an AI can do it) and when, and the smallest test if one applies (else "").
title: 3-8 words.`
    case 'unstick':
      return head + `STEP: The user marked the step "${node.data.targetTitle}" as stuck or not understood.
Their note: ${node.data.note || '(none)'}
What that step produced: ${node.data.targetSummary}
Explain it in plain language a smart 12-year-old would follow ("plain"). Name what is actually blocking ("blocker") and restate it as a constraint the system must respect ("constraint"). Suggest rerun (redo that step with the constraint), ask (the user must answer something), or nothing.`
    default:
      throw new Error('Unknown step ' + kind)
  }
}
