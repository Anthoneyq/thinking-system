// Sample outputs for testing the flow without spending on a model. Content is placeholder, not analysis.
const wait = ms => new Promise(r => setTimeout(r, ms))

export async function fake(kind, prompt) {
  await wait(500 + Math.random() * 900)
  const answered = prompt.includes('ANSWERS FROM THE USER')
  const q = { id: 'q1', q: 'What matters most here: speed, money, or quality?', why: 'It changes which option wins.', options: ['Speed', 'Money', 'Quality'], blocking: true }
  switch (kind) {
    case 'frame': return {
      title: 'Sample dry run', summary: 'Sample framing of the thought.',
      question: answered ? 'Which direction fits what matters most to you?' : 'What should you do about this?',
      goal: { text: answered ? 'Pick a direction that fits what matters most' : 'Not stated yet', source: answered ? 'inferred' : 'unknown' },
      stated: ['(dry run) First line of what you wrote, compressed'],
      inferred: [{ text: 'You want a decision this week', why: 'Sample inference' }, { text: 'Budget is limited', why: 'Sample inference' }],
      constraints: [{ text: 'Limited time', source: 'inferred', hard: false }],
      evidence: ['(dry run) none'],
      unknowns: [{ text: 'What matters most', why_it_matters: 'Decides the winner', action: answered ? 'decide' : 'ask', how: 'Ask one question' }],
      lenses: ['general'], confidence: { level: answered ? 'medium' : 'low', basis: 'Sample' },
      questions: answered ? [] : [q],
    }
    case 'route': return {
      summary: 'Picked two sample methods.', simple: false,
      plan: prompt.includes('follow-up pass') ? [] : [
        { method: 'possibilities', focus: 'What directions exist?', why: 'Direction is open', checks: [] },
        { method: 'algorithm', focus: 'What can be cut?', why: 'Keep it lean', checks: [] },
      ],
    }
    case 'method': return {
      summary: 'Sample method output.',
      findings: [{ text: 'Sample finding', kind: 'inference' }],
      options: [{ title: 'Option A', detail: 'Sample' }, { title: 'Option B', detail: 'Sample' }, { title: 'Option C', detail: 'Sample' }],
      cuts: [{ what: 'Extra step', why: 'Nobody asked for it' }], risks: ['Sample risk'], unknowns: [],
    }
    case 'narrow': return {
      summary: 'Five options found, three kept.',
      all: ['A', 'B', 'C', 'D', 'E'].map((l, i) => ({ id: 'o' + (i + 1), title: 'Option ' + l, detail: 'Sample', from: ['possibilities'] })),
      top: [{ id: 'o1', why: 'Fastest' }, { id: 'o2', why: 'Cheapest' }, { id: 'o3', why: 'Best quality' }], combine: 'Start with A, keep the cheap part of B.',
    }
    case 'converge': {
      const grow = prompt.includes('Growth rounds left: 1') || prompt.includes('Growth rounds left: 2')
      const ask = !grow && prompt.includes('Asking is available')
      return {
        summary: grow ? 'Three strong directions; growing them further.' : ask ? 'Down to a choice only you can make.' : 'Enough to commit.',
        question: grow ? 'Which of A, B or C gets you there fastest?' : 'A or B, given that speed matters most?',
        changed: grow ? 'Narrowed from open to three directions' : 'Narrowed to two',
        all: ['A', 'B', 'C', 'D', 'E'].map((l, i) => ({ id: 'o' + (i + 1), title: 'Option ' + l, detail: 'Sample', from: [i % 2 ? 'algorithm' : 'possibilities'] })),
        top: [{ id: 'o1', why: 'Fastest' }, { id: 'o2', why: 'Cheapest' }, { id: 'o3', why: 'Best quality' }], combine: '',
        enough: !grow && !ask, confidence: { level: 'medium', basis: 'Sample' },
        next: grow ? 'develop' : ask ? 'ask' : 'commit',
        questions: ask ? [{ id: 'q2', q: 'Option A or Option B?', why: 'Both fit; it is your call.', options: ['Option A', 'Option B'], blocking: true }] : [],
        research: [], stop_reason: 'Sample.',
      }
    }
    case 'develop': return {
      summary: 'Sample developed direction.', practice: 'Sample practice.', fit: 'Fits well.', takes: ['Step one', 'Step two'],
      risks: ['Sample risk'], test: 'Try it for a week.', verdict: 'possible',
      sub_options: [{ title: 'Lean version', detail: 'Sample' }, { title: 'Bold version', detail: 'Sample' }],
    }
    case 'assess': return {
      summary: 'Enough to commit.', enough: true, confidence: { level: 'medium', basis: 'Sample' },
      gaps: [], next: 'commit', questions: [], research: [], stop_reason: 'More analysis would not change the next action.',
    }
    case 'research': return { summary: 'Sample research.', findings: [{ text: 'Sample fact', source: '' }], verified: false }
    case 'review': return { summary: 'One serious objection.', objections: [{ text: 'Sample objection', severity: 'serious', fix: 'Sample fix' }], fatal: false }
    case 'decide': return {
      title: 'Sample decision', summary: 'Go with Option A.', recommendation: 'Go with Option A and keep the cheap part of B.',
      goal_served: 'Sample goal', reasons: ['Sample reason'], tradeoffs: ['Sample tradeoff'], cuts: [{ what: 'Extra step', why: 'Not needed' }],
      uncertainty: ['Sample'], would_change: ['Sample'], next_action: { what: 'Do the first step', owner: 'You', when: 'Today' }, test: '',
    }
    case 'unstick': return { summary: 'Plain explanation.', plain: 'This step just lists choices; nothing is decided yet.', blocker: 'The step used jargon', constraint: 'Use plain words', suggestion: 'rerun' }
  }
  throw new Error('No dry-run sample for ' + kind)
}
