// Conversations mode: prompts and strict schemas for reading calls into filed, traceable items.
const str = { type: 'string' }
const bool = { type: 'boolean' }
const num = { type: 'number' }
const arr = items => ({ type: 'array', items })
const oneOf = (...values) => ({ type: 'string', enum: values })
const obj = props => ({ type: 'object', properties: props, required: Object.keys(props), additionalProperties: false })

export const ITEM_TYPES = ['decision', 'open', 'assumption', 'todo', 'idea', 'fact', 'preference']
export const THREAD_STATUS = ['decided', 'unsettled', 'open', 'assumed', 'done']

export const SCHEMAS = {
  extract: obj({
    summary: str,
    items: arr(obj({
      type: oneOf(...ITEM_TYPES),
      text: str,
      context: str,
      who: str,
      at: str,
      quote: str,
      terms: arr(obj({ term: str, sense: str })),
      mixed: str,
      branch: str,
      also: arr(str),
      confidence: num,
      new_branch: str,
    })),
  }),
  links: obj({ items: arr(obj({ id: str, also: arr(str) })) }),
  threads: obj({
    threads: arr(obj({
      id: str,
      title: str,
      status: oneOf(...THREAD_STATUS),
      summary: str,
      decision: str,
      ways: arr(str),
      items: arr(str),
      question: obj({ q: str, why: str, options: arr(str) }),
    })),
  }),
  crosscheck: obj({
    summary: str,
    links: arr(obj({ from: str, to: str, idea: str, action: str, strength: oneOf('strong', 'possible') })),
  }),
  ask: obj({ answer: str, cites: arr(str), gaps: arr(str) }),
}

export const SYSTEM = `You read a business's recorded conversations and turn them into a clean, traceable record.
Rules:
- Each item must stand on its own: someone reading only that item, months later, knows what it is about. Put the missing context in "context" (the verse needs its chapter).
- Never invent. Every item traces to words in the transcript; "quote" is copied exactly (up to 25 words) and "at" is the time shown before it.
- Keep the speaker's meaning. Brainstorms are ideas, not decisions. A decision needs someone with the say agreeing to it.
- Transcription garbles names, numbers and product words. Read them from context and say so in "context" when unsure.
- Plain words, short sentences.`

const outline = (tree, depth = 0) => tree.map(n => `${'  '.repeat(depth)}- ${n.id}: ${n.name}${n.desc ? ' — ' + n.desc : ''}\n${n.children?.length ? outline(n.children, depth + 1) : ''}`).join('')

export function extractPrompt({ library, call, part, parts, text, tree, glossary }) {
  return `Business: ${library.name}
${call.note ? `Project note: "${call.title}", updated ${call.date}. It is the written record of work done and decisions made, often off the recorded calls; dated sections give when. Use the section's date in "context", and "" for "at".` : `Conversation: "${call.title}" on ${call.date}${call.speakers.length ? `, speakers: ${call.speakers.join(', ')}` : ''}`}${parts > 1 ? ` (part ${part} of ${parts})` : ''}

The business tree (file each item at the deepest branch that fits; use the id):
${outline(tree)}
${glossary.length ? `\nWords this business uses in more than one sense (keep them apart):\n${glossary.map(g => `- ${g.term}: ${g.senses.join(' / ')}`).join('\n')}\n` : ''}
Pull out every item that matters to running or growing the business:
- decision: settled, by someone with the say ("who" is the decider).
- open: a question raised and not answered.
- assumption: something treated as true that nobody confirmed.
- todo: a task someone took on or was given ("who" is the owner, or "" if nobody).
- idea: a proposal or brainstorm, not agreed.
- fact: a number, rule, name or detail worth keeping.
- preference: what someone likes or rejects (design, wording, process).
Skip small talk and anything outside the business (family, workouts, jokes), unless it changes the work.

For each item:
- "terms": the 1 to 4 subject words someone would search for, each with the sense meant here (e.g. {"term":"ceiling","sense":"cost cap on a budget"} vs {"term":"ceiling","sense":"part of the building"}).
- "mixed": only if this item itself uses one word in two senses, so it could be filed in two places, say which ("ceiling: damage and price"); talking about the word itself does not count. Else "".
- "branch": the tree id it belongs to, "none" if it fits nowhere; "confidence" 0 to 1 that the branch is right.
- "also": other tree ids this item clearly also touches, because it is about both (a fee for website work touches pricing and the website). At most 3; [] when it sits in one place. Not branches you are merely unsure between.
- "new_branch": if no branch fits well, a short name for the branch that should exist; else "".
- "summary": two or three lines on what this ${parts > 1 ? 'part of the ' : ''}conversation covered.

Transcript:
${text}`
}

export function linksPrompt({ library, tree, items }) {
  return `Business: ${library.name}

The business tree:
${outline(tree)}
Each item below already has a home branch. List the other branches it clearly also touches, because it is about both, so someone working in that branch should find it too (a fee for website work touches pricing and the website). At most 3, by id; [] when it sits in one place. Not branches you are merely unsure between. Return every item id.

Items (id | home | text | context):
${items.map(i => `${i.id} | ${i.claudeBranch} | ${i.text} | ${i.context}`).join('\n')}`
}

export function threadsPrompt({ library, path, items, existing }) {
  return `Business: ${library.name}
Branch: ${path}

Group these items into threads: one thread per topic that was talked about, across every call. Keep an existing thread's id when it is the same topic; make a short new id (kebab-case) for a new one.
For each thread:
- "status": decided (someone with the say settled it; "decision" says what and who), unsettled (talked about in different ways and never settled; list each way in "ways"), open (raised, not answered), assumed (treated as true, never confirmed), done (the work is finished).
- "summary": where it stands now, in one or two lines, latest first when calls disagree. Say the date of the latest word on it.
- "items": the item ids it is built from.
- "question": for anything not decided or done, the one question to ask the owner that would settle it, why it matters, and 2 to 4 short options. For decided or done, empty strings and [].
Later calls override earlier ones when they clearly settle or reverse something; say so in the summary. A project note records decisions made off the calls: when it says something was picked, approved or done, that settles it.
${existing.length ? `\nExisting threads on this branch:\n${existing.map(t => `- ${t.id} [${t.status}] ${t.title}: ${t.summary}`).join('\n')}\n` : ''}
Items (id | date | type | who | text | context; "note" marks the project note):
${items.map(i => `${i.id} | ${i.date}${i.note ? ' note' : ''} | ${i.type} | ${i.who} | ${i.text} | ${i.context}`).join('\n')}`
}

export function crosscheckPrompt({ library, threads }) {
  return `Business: ${library.name}

Below is everything this business has talked through, as threads filed on a tree. Look across branches for places where something worked out in one part of the business applies somewhere else and nobody has connected it yet. Example: a property model built for one client becomes the hook in an email to attorneys.
Only real, useful links. For each: "from" and "to" are thread ids or branch ids, "idea" says how it applies, "action" is the first concrete step, "strength" is strong or possible.

Threads (id | branch | status | title | summary):
${threads.map(t => `${t.id} | ${t.path} | ${t.status} | ${t.title} | ${t.summary}`).join('\n')}`
}

export function askPrompt({ library, question, items, threads }) {
  return `Business: ${library.name}
Question: ${question}

Answer from the record below only. Say where each point was said (call and date). Put the item or thread ids you used in "cites". If the record does not settle it, say so and list what is missing in "gaps".

Threads:
${threads.map(t => `${t.id} [${t.status}] ${t.path}: ${t.title} — ${t.summary}`).join('\n')}

Items (id | date | call | type | who | text | quote):
${items.map(i => `${i.id} | ${i.date} | ${i.call} | ${i.type} | ${i.who} | ${i.text} | "${i.quote}"`).join('\n')}`
}
