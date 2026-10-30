import { createServer } from "node:http";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, mkdirSync, statSync } from "node:fs";
import { join, extname, basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { EventEmitter } from "node:events";
import { spawnSync, spawn } from "node:child_process";
import { tmpdir, homedir } from "node:os";
import { createHash } from "node:crypto";
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
async function fake(kind, prompt) {
  await wait(500 + Math.random() * 900);
  const answered = prompt.includes("ANSWERS FROM THE USER");
  const q = { id: "q1", q: "What matters most here: speed, money, or quality?", why: "It changes which option wins.", options: ["Speed", "Money", "Quality"], blocking: true };
  switch (kind) {
    case "frame":
      return {
        title: "Sample dry run",
        summary: "Sample framing of the thought.",
        question: answered ? "Which direction fits what matters most to you?" : "What should you do about this?",
        goal: { text: answered ? "Pick a direction that fits what matters most" : "Not stated yet", source: answered ? "inferred" : "unknown" },
        stated: ["(dry run) First line of what you wrote, compressed"],
        inferred: [{ text: "You want a decision this week", why: "Sample inference" }, { text: "Budget is limited", why: "Sample inference" }],
        constraints: [{ text: "Limited time", source: "inferred", hard: false }],
        evidence: ["(dry run) none"],
        unknowns: [{ text: "What matters most", why_it_matters: "Decides the winner", action: answered ? "decide" : "ask", how: "Ask one question" }],
        lenses: ["general"],
        confidence: { level: answered ? "medium" : "low", basis: "Sample" },
        questions: answered ? [] : [q]
      };
    case "route":
      return {
        summary: "Picked two sample methods.",
        simple: false,
        plan: prompt.includes("follow-up pass") ? [] : [
          { method: "possibilities", focus: "What directions exist?", why: "Direction is open", checks: [] },
          { method: "algorithm", focus: "What can be cut?", why: "Keep it lean", checks: [] },
          { method: "eisenhower", focus: "What comes first?", why: "Several things mixed", checks: [] }
        ]
      };
    case "method":
      return {
        summary: "Sample method output.",
        findings: [{ text: "Sample finding", kind: "inference" }],
        options: [{ title: "Option A", detail: "Sample" }, { title: "Option B", detail: "Sample" }, { title: "Option C", detail: "Sample" }],
        cuts: [{ what: "Extra step", why: "Nobody asked for it" }],
        risks: ["Sample risk"],
        unknowns: ["Sample unknown from this branch"],
        quadrant: prompt.includes('x = "Urgent"') ? { x: "Urgent", y: "Important", items: [
          { text: "Send the proposal", x_high: true, y_high: true, note: "Do today" },
          { text: "Plan Q1 offer", x_high: false, y_high: true, note: "Schedule Friday" },
          { text: "Reply to vendor", x_high: true, y_high: false, note: "Delegate" },
          { text: "Redesign logo", x_high: false, y_high: false, note: "Drop" }
        ] } : { x: "", y: "", items: [] },
        matrix: { criteria: [], rows: [] }
      };
    case "narrow":
      return {
        summary: "Five options found, three kept.",
        all: ["A", "B", "C", "D", "E"].map((l, i) => ({ id: "o" + (i + 1), title: "Option " + l, detail: "Sample", from: ["possibilities"] })),
        top: [{ id: "o1", why: "Fastest" }, { id: "o2", why: "Cheapest" }, { id: "o3", why: "Best quality" }],
        combine: "Start with A, keep the cheap part of B."
      };
    case "converge": {
      const grow = prompt.includes("Growth rounds left: 1") || prompt.includes("Growth rounds left: 2");
      const ask2 = !grow && prompt.includes("Asking is available");
      return {
        summary: grow ? "Three strong directions; growing them further." : ask2 ? "Down to a choice only you can make." : "Enough to commit.",
        question: grow ? "Which of A, B or C gets you there fastest?" : "A or B, given that speed matters most?",
        changed: grow ? "Narrowed from open to three directions" : "Narrowed to two",
        all: ["A", "B", "C", "D", "E"].map((l, i) => ({ id: "o" + (i + 1), title: "Option " + l, detail: "Sample", from: [i % 2 ? "algorithm" : "possibilities"] })),
        top: [{ id: "o1", why: "Fastest" }, { id: "o2", why: "Cheapest" }, { id: "o3", why: "Best quality" }],
        combine: "",
        enough: !grow && !ask2,
        confidence: { level: "medium", basis: "Sample" },
        next: grow ? "develop" : ask2 ? "ask" : "commit",
        questions: ask2 ? [{ id: "q2", q: "Option A or Option B?", why: "Both fit; it is your call.", options: ["Option A", "Option B"], blocking: true }] : [],
        research: [],
        stop_reason: "Sample.",
        open_points: [
          { id: "p1", text: "What matters most: speed, money or quality?", raised_in: ["frame", "possibilities", "algorithm"], times: 3, action: "ask", rank: 1, unlocks: "Which option wins" },
          { id: "p2", text: "Is the budget fixed?", raised_in: ["algorithm"], times: 1, action: "ask", rank: 2, unlocks: "Whether option C stays" }
        ].filter((p) => !prompt.includes(p.text + "\n  A:"))
      };
    }
    case "develop":
      return {
        summary: "Sample developed direction.",
        practice: "Sample practice.",
        fit: "Fits well.",
        takes: ["Step one", "Step two"],
        risks: ["Sample risk"],
        test: "Try it for a week.",
        verdict: "possible",
        sub_options: [{ title: "Lean version", detail: "Sample" }, { title: "Bold version", detail: "Sample" }]
      };
    case "assess":
      return {
        summary: "Enough to commit.",
        enough: true,
        confidence: { level: "medium", basis: "Sample" },
        gaps: [],
        next: "commit",
        questions: [],
        research: [],
        stop_reason: "More analysis would not change the next action."
      };
    case "research":
      return { summary: "Sample research.", findings: [{ text: "Sample fact", source: "" }], verified: false };
    case "review":
      return { summary: "One serious objection.", unsupported: ["Sample claim with no source"], objections: [{ text: "Sample objection", severity: "serious", fix: "Sample fix" }], fatal: false };
    case "decide":
      return {
        title: "Sample decision",
        summary: "Go with Option A.",
        recommendation: "Go with Option A and keep the cheap part of B.",
        goal_served: "Sample goal",
        reasons: ["Sample reason"],
        tradeoffs: ["Sample tradeoff"],
        cuts: [{ what: "Extra step", why: "Not needed" }],
        uncertainty: ["Sample"],
        would_change: ["Sample"],
        call: "decide",
        door: "two-way",
        displaces: "Sample: delays the current project a day",
        revisit_if: "Sample: option A misses a requirement",
        next_action: { what: "Do the first step", owner: "You", when: "Today" },
        test: "",
        rule: "If a sample option passes the requirements and is cheap to undo, then pick it and move on."
      };
    case "unstick":
      return { summary: "Plain explanation.", plain: "This step just lists choices; nothing is decided yet.", blocker: "The step used jargon", constraint: "Use plain words", suggestion: "rerun" };
  }
  throw new Error("No dry-run sample for " + kind);
}
const ALL = [
  { id: "claude-sonnet-5-5", label: "Claude Sonnet 5.5", engine: "claude", web: true },
  { id: "claude-opus-5-5", label: "Claude Opus 5.5", engine: "claude", web: true },
  { id: "claude-fable-5-1", label: "Claude Fable 5.1", engine: "claude", web: true },
  { id: "claude-haiku-5-5", label: "Claude Haiku 5.5 (fast, cheap)", engine: "claude", web: true },
  { id: "codex", label: "GPT via Codex (your Codex default)", engine: "codex", web: true },
  { id: "dry", label: "Dry run (no AI, sample content)", engine: "dry", web: false }
];
const has = (cmd) => !spawnSync(cmd, ["--version"], { stdio: "ignore" }).error;
const ENGINES = { claude: has("claude"), codex: has("codex"), dry: true };
const MODELS = ALL.filter((m) => ENGINES[m.engine]);
const ALIAS = { sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5", fable: "claude-fable-5-1", haiku: "claude-haiku-5-5", gpt: "codex", "dry-run": "dry" };
const resolveModel = (id) => {
  if (!id) return MODELS[0].id;
  const m = MODELS.find((x) => x.id === (ALIAS[id] || id));
  if (!m) throw new Error(`Unknown or unavailable model "${id}". Use one of: ${MODELS.map((x) => x.id).join(", ")}`);
  return m.id;
};
const modelById = (id) => MODELS.find((m) => m.id === id) || MODELS[0];
const TIMEOUT = 6 * 60 * 1e3;
function run$3(cmd, args, input, cwd) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { cwd, env: process.env });
    let out = "", err = "";
    const timer = setTimeout(() => {
      p.kill("SIGTERM");
      reject(new Error(`${cmd} timed out`));
    }, TIMEOUT);
    p.stdout.on("data", (d) => out += d);
    p.stderr.on("data", (d) => err += d);
    p.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    p.on("close", (code) => {
      clearTimeout(timer);
      code === 0 ? resolve(out) : reject(new Error(`${cmd} exited ${code}: ${(err || out).slice(-400)}`));
    });
    if (input != null) p.stdin.end(input);
  });
}
async function callModel({ model, system, prompt, schema, kind, web }) {
  const m = modelById(model);
  const cwd = mkdtempSync(join(tmpdir(), "think-"));
  try {
    if (m.engine === "dry") return { out: await fake(kind, prompt), cost: 0 };
    if (m.engine === "claude") {
      const args = [
        "-p",
        "--output-format",
        "json",
        "--model",
        m.id,
        "--tools",
        web ? "WebSearch,WebFetch" : "",
        "--strict-mcp-config",
        "--mcp-config",
        '{"mcpServers":{}}',
        "--setting-sources",
        "",
        "--system-prompt",
        system,
        "--no-session-persistence",
        "--json-schema",
        JSON.stringify(schema)
      ];
      if (web) args.push("--allowedTools", "WebSearch,WebFetch");
      const res = JSON.parse(await run$3("claude", args, prompt, cwd));
      if (res.is_error || !res.structured_output) throw new Error(res.result || "No structured output from Claude");
      return { out: res.structured_output, cost: res.total_cost_usd || 0 };
    }
    if (m.engine === "codex") {
      writeFileSync(join(cwd, "schema.json"), JSON.stringify(schema));
      const args = [
        ...web ? ["--search"] : [],
        "exec",
        "--skip-git-repo-check",
        "--ephemeral",
        "-s",
        "read-only",
        "-c",
        "model_reasoning_effort=medium",
        "--output-schema",
        "schema.json",
        "-o",
        "out.json",
        "-"
      ];
      await run$3("codex", args, `${system}

${prompt}`, cwd);
      return { out: JSON.parse(readFileSync(join(cwd, "out.json"), "utf8")), cost: 0 };
    }
    throw new Error("Unknown model " + model);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}
const METHODS = [
  {
    id: "possibilities",
    name: "Show everything",
    when: "Direction is open, or the user may not know what is possible.",
    how: "Go wide before narrowing. List many distinct directions, including capabilities or approaches the user probably does not know exist. Mix safe, bold and odd. Each option is a real, different path, not a rewording."
  },
  {
    id: "first-principles",
    name: "First principles",
    when: 'Assumptions or "how it is usually done" may be wrong.',
    how: "Strip the problem to what is actually true and required. Separate fundamentals from convention. Rebuild an answer from the fundamentals."
  },
  {
    id: "inversion",
    name: "Inversion / pre-mortem",
    when: "A plan exists or is forming; risk of failure matters.",
    how: "Assume it failed a year from now. List the most likely causes of failure, then what would prevent each."
  },
  {
    id: "second-order",
    name: "Second-order effects",
    when: "A choice has knock-on consequences over time.",
    how: 'For each leading option, ask "and then what?" two or three steps out. Note effects on time, money, people, reputation.'
  },
  {
    id: "six-hats",
    name: "Six perspectives",
    when: "One viewpoint dominates or emotions and facts are mixed.",
    how: "Look through facts, feelings, risks, benefits, new ideas and process. Report only what each view adds."
  },
  {
    id: "decision-matrix",
    name: "Decision matrix",
    when: "Several concrete options must be compared on several criteria.",
    how: "Pick the few criteria that matter, weight them, score options. Hard constraints eliminate options before scoring; they are never averaged away. Scores aid judgment, they are not the answer."
  },
  {
    id: "eisenhower",
    name: "Urgent / important",
    when: "Several tasks, projects, decisions or asks are mixed together and need ordering.",
    how: "Sort items into do now, schedule, delegate or automate, drop. Importance means it moves the stated goal."
  },
  {
    id: "impact-effort",
    name: "Impact vs effort",
    when: "Many possible actions, limited time.",
    how: "Place each action on impact and effort. Name the quick wins, the big bets, and what to skip."
  },
  {
    id: "issue-tree",
    name: "Issue tree",
    when: "The problem is big or tangled.",
    how: "Break the question into non-overlapping sub-questions that together cover it. Mark which branch matters most."
  },
  {
    id: "five-whys",
    name: "Five whys / iceberg",
    when: "A recurring problem or symptom; the cause is unclear.",
    how: "Ask why repeatedly to reach structure and root cause, not the visible event. Name the leverage point."
  },
  {
    id: "constraints",
    name: "Bottleneck",
    when: "Progress is stuck or throughput is low.",
    how: "Find the single constraint limiting the whole system right now. Everything else waits until it moves."
  },
  {
    id: "customer-jobs",
    name: "Jobs to be done",
    when: "Something is being sold, built or named for other people.",
    how: "Describe the job the buyer is hiring this for, what they use today, what makes them switch, and what objections stop them."
  },
  {
    id: "algorithm",
    name: "The Algorithm",
    when: "Something is overbuilt, slow or complicated, or a process will be automated.",
    how: "In order: Question each requirement (who asked, is it needed), Delete parts and steps, Simplify what survives, Accelerate it, then Automate. Never automate or speed up something that should be deleted. List what was deleted and what survived, with reasons."
  },
  {
    id: "compress",
    name: "Compress",
    when: "Output or material is long; same meaning should take less.",
    how: "Keep the meaning, cut the words. Record what was removed and why so nothing important is silently lost."
  },
  {
    id: "reversibility",
    name: "Reversibility",
    when: "Deciding how carefully to decide.",
    how: "Is this a one-way or two-way door? Reversible and cheap means decide fast and test; irreversible and costly means slow down and gather evidence."
  },
  {
    id: "satisficing",
    name: "Good enough",
    when: "Options keep multiplying, or searching longer is unlikely to find much better.",
    how: "Write the few requirements a satisfactory answer must meet. Drop options that fail any. Take the first that passes, preferring the one cheapest to change later. Stop searching."
  },
  {
    id: "value-of-info",
    name: "Is more research worth it",
    when: "Tempted to research, compare or ask more before deciding.",
    how: "For each open question, name the finding that would change the recommendation. If no realistic finding would, stop and decide. Otherwise look up only that."
  },
  {
    id: "opportunity-cost",
    name: "Opportunity cost",
    when: "Adding a feature, tool, project or idea on top of existing work.",
    how: "Name what this displaces: the current work it delays, the attention it takes, the upkeep it adds. Keep the existing tool or plan unless the gain clearly beats the switching cost."
  },
  {
    id: "small-test",
    name: "Smallest test",
    when: "The answer depends on evidence nobody has yet.",
    how: "Design the cheapest, fastest test that would change the decision. State what result means go, change, or stop."
  },
  {
    id: "domain-lens",
    name: "Domain check",
    when: "The subject has its own standard checks (business, design, training, writing, code...).",
    how: "Run the given checks for this domain. Report only checks that reveal something; skip the rest."
  }
];
const METHOD_IDS = METHODS.map((m) => m.id);
const methodById = (id) => METHODS.find((m) => m.id === id);
const str$1 = { type: "string" };
const bool = { type: "boolean" };
const arr$1 = (items) => ({ type: "array", items });
const oneOf$1 = (...values) => ({ type: "string", enum: values });
const obj$1 = (props) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });
const num$1 = { type: "number" };
const int = { type: "integer" };
const confidence = obj$1({ level: oneOf$1("low", "medium", "high"), basis: str$1 });
const question = obj$1({ id: str$1, q: str$1, why: str$1, options: arr$1(str$1), blocking: bool });
const SCHEMAS$1 = {
  frame: obj$1({
    title: str$1,
    summary: str$1,
    question: str$1,
    goal: obj$1({ text: str$1, source: oneOf$1("stated", "inferred", "unknown") }),
    stated: arr$1(str$1),
    inferred: arr$1(obj$1({ text: str$1, why: str$1 })),
    constraints: arr$1(obj$1({ text: str$1, source: oneOf$1("stated", "inferred"), hard: bool })),
    evidence: arr$1(str$1),
    unknowns: arr$1(obj$1({ text: str$1, why_it_matters: str$1, action: oneOf$1("ask", "research", "test", "decide", "ignore"), how: str$1 })),
    lenses: arr$1(str$1),
    confidence,
    questions: arr$1(question)
  }),
  route: obj$1({
    summary: str$1,
    simple: bool,
    plan: arr$1(obj$1({ method: oneOf$1(...METHOD_IDS), focus: str$1, why: str$1, checks: arr$1(str$1) }))
  }),
  method: obj$1({
    summary: str$1,
    findings: arr$1(obj$1({ text: str$1, kind: oneOf$1("evidence", "inference", "assumption") })),
    options: arr$1(obj$1({ title: str$1, detail: str$1 })),
    cuts: arr$1(obj$1({ what: str$1, why: str$1 })),
    risks: arr$1(str$1),
    unknowns: arr$1(str$1),
    quadrant: obj$1({ x: str$1, y: str$1, items: arr$1(obj$1({ text: str$1, x_high: bool, y_high: bool, note: str$1 })) }),
    matrix: obj$1({ criteria: arr$1(obj$1({ name: str$1, weight: num$1 })), rows: arr$1(obj$1({ option: str$1, scores: arr$1(num$1), total: num$1 })) })
  }),
  narrow: obj$1({
    summary: str$1,
    all: arr$1(obj$1({ id: str$1, title: str$1, detail: str$1, from: arr$1(str$1) })),
    top: arr$1(obj$1({ id: str$1, why: str$1 })),
    combine: str$1
  }),
  converge: obj$1({
    summary: str$1,
    question: str$1,
    changed: str$1,
    all: arr$1(obj$1({ id: str$1, title: str$1, detail: str$1, from: arr$1(str$1) })),
    top: arr$1(obj$1({ id: str$1, why: str$1 })),
    combine: str$1,
    enough: bool,
    confidence,
    next: oneOf$1("commit", "ask", "develop", "research", "more"),
    questions: arr$1(question),
    research: arr$1(obj$1({ query: str$1, why: str$1 })),
    open_points: arr$1(obj$1({ id: str$1, text: str$1, raised_in: arr$1(str$1), times: int, action: oneOf$1("ask", "research", "test", "decide"), rank: int, unlocks: str$1 })),
    stop_reason: str$1
  }),
  develop: obj$1({
    summary: str$1,
    practice: str$1,
    fit: str$1,
    takes: arr$1(str$1),
    risks: arr$1(str$1),
    test: str$1,
    verdict: oneOf$1("strong", "possible", "weak"),
    sub_options: arr$1(obj$1({ title: str$1, detail: str$1 }))
  }),
  assess: obj$1({
    summary: str$1,
    enough: bool,
    confidence,
    gaps: arr$1(obj$1({ text: str$1, action: oneOf$1("ask", "research", "test", "decide") })),
    next: oneOf$1("commit", "ask", "research", "more"),
    questions: arr$1(question),
    research: arr$1(obj$1({ query: str$1, why: str$1 })),
    stop_reason: str$1
  }),
  research: obj$1({
    summary: str$1,
    findings: arr$1(obj$1({ text: str$1, source: str$1 })),
    verified: bool
  }),
  review: obj$1({
    summary: str$1,
    unsupported: arr$1(str$1),
    objections: arr$1(obj$1({ text: str$1, severity: oneOf$1("fatal", "serious", "minor"), fix: str$1 })),
    fatal: bool
  }),
  decide: obj$1({
    title: str$1,
    summary: str$1,
    recommendation: str$1,
    goal_served: str$1,
    reasons: arr$1(str$1),
    tradeoffs: arr$1(str$1),
    cuts: arr$1(obj$1({ what: str$1, why: str$1 })),
    uncertainty: arr$1(str$1),
    would_change: arr$1(str$1),
    call: oneOf$1("decide", "test", "defer", "ask"),
    door: oneOf$1("one-way", "two-way"),
    displaces: str$1,
    revisit_if: str$1,
    next_action: obj$1({ what: str$1, owner: str$1, when: str$1 }),
    test: str$1,
    rule: str$1
  }),
  unstick: obj$1({
    summary: str$1,
    plain: str$1,
    blocker: str$1,
    constraint: str$1,
    suggestion: oneOf$1("rerun", "ask", "nothing")
  })
};
const SYSTEM$1 = `You are one step inside a thinking system that turns an incomplete thought into clear action with less decision fatigue. It works for anyone and any subject.
Rules:
- Separate what the user STATED from what you INFER. Never present an inference as something they said. Corrections from the user override your inferences.
- Separate evidence from assumptions and unknowns.
- Explore widely, keep selectively, commit deliberately.
- Do not demand a clear goal. If the goal is unknown, say so and work toward discovering it.
- Ask only questions whose answer would change the recommendation, scope or action. Vague or low-stakes items: decide yourself and say so.
- Hard constraints eliminate options; they are never averaged away. Do not invent numeric precision; confidence names its basis.
- Plain words, short sentences. No filler, no hype. Each item says one thing once.
- Never invent facts about real people, companies, prices or results. If you do not know, it is an unknown.
- Another model agreeing is not evidence. A claim is supported only when it traces to what the user stated, given evidence or research.
- Match care to reversibility: cheap, reversible choices get decided fast; costly or hard-to-undo ones get scrutiny.
Return only the JSON the schema asks for.`;
const methodMenu = METHODS.map((m) => `- ${m.id}: ${m.name}. Use when: ${m.when}`).join("\n");
const EFFORT_NOTE = {
  quick: "Effort: quick. Use at most 2 methods. Prefer deciding over asking.",
  normal: "Effort: normal. Use 2-4 methods.",
  deep: "Effort: deep. Use 3-6 methods; be thorough but stop when more analysis would not change the next action."
};
function stepPrompt(kind, node, ctx, opts) {
  const head = `${ctx}

---
`;
  switch (kind) {
    case "frame":
      return head + `STEP: Frame the situation.
Echo back what the user explicitly said in compressed form ("stated"). If they stated a goal, goal.source = stated and goal.text is their goal compressed, faithful to their words. Otherwise infer one (source inferred) or mark it unknown.
List inferences separately with why you inferred each. Map constraints, evidence, and unknowns; for each unknown say what to do about it (ask the user, research it, test it, decide it yourself, or ignore).
Name the lenses (subject areas) that apply.
Questions: only ones whose answer would change the result. blocking = true only if a good answer is impossible without it. ${opts.askAllowed ? "Up to 5 questions; offer 2-4 short answer options when natural." : "Asking is not available now: return questions as an empty list and decide instead."}
question: the question this run answers, one plain sentence in the user's terms. If the goal is unknown, the question is about finding it.
title: 3-6 words naming this run.`;
    case "route":
      return head + `STEP: Choose thinking methods for ${node.data.followup ? "the remaining gaps (follow-up pass; add only what is still needed, an empty plan is fine)" : "this situation"}.
Method library:
${methodMenu}
${EFFORT_NOTE[opts.effort]} If the situation is simple, set simple = true and pick 1 method.
For each pick give a focus (the exact question it should answer here) and why. For domain-lens, list 3-6 checks specific to the subject in "checks"; otherwise checks = [].`;
    case "method":
      return head + `STEP: Apply the method "${node.data.name}".
How: ${node.data.how}
Focus: ${node.data.focus}
${node.data.checks?.length ? "Checks: " + node.data.checks.join("; ") : node.data.method === "domain-lens" ? "Choose the 3-6 standard checks for this subject yourself." : ""}
Report findings (mark each evidence / inference / assumption), options this method surfaces, anything that should be cut and why, risks, and new unknowns. Keep it tight.
${node.data.method === "eisenhower" ? 'quadrant: x = "Urgent", y = "Important". Place EVERY task, decision, ask or project the user mentioned (not your options) as one item each; note = one short line on what to do with it.' : node.data.method === "impact-effort" ? 'quadrant: x = "Effort", y = "Impact". Place every candidate action as one item each; note = one short line.' : 'quadrant: x = "", y = "", items = [].'}
${node.data.method === "decision-matrix" ? "matrix: 2-5 criteria with weights summing to 1; one row per option with a 1-5 score per criterion (same order) and the weighted total. Options that break a hard constraint are left out, not scored low." : "matrix: criteria = [], rows = []."}`;
    case "converge":
      return head + `STEP: Come back together (pass ${opts.pass}). The branches so far have reported.
1. Restate the question in its sharpest current form, given what was learned ("question", one sentence). "changed": what changed from the previous statement of the question in a few words, or "".
2. Show everything: collect every distinct option surfaced so far into "all" (merge duplicates, short ids o1, o2...; "from" = the method ids exactly as written in the method results, e.g. ["small-test", "algorithm"]). Pick the top 3 or fewer that best serve the goal within the constraints, each with why. If parts combine into something better, describe it in "combine"; else "".
3. Gate. enough = true when further work is unlikely to change the next action. Otherwise choose next:
   develop = grow the top options further (what each takes, risks, tests);
   research = facts can be looked up (max 3 queries; each "why" names the finding that would change the recommendation, otherwise do not research);
   more = different thinking methods are needed;
   ask = the choice now depends on the user's preferences or facts only they know. Ask them, offering the top options as answer choices where natural.
Growth rounds left: ${opts.loopsLeft}. If 0, do not choose develop, research or more.${opts.loopsLeft > 0 && opts.pass === 1 ? " This is the first pass: prefer develop unless the answer is already obvious." : ""}
${opts.askAllowed ? "Asking is available." : "Asking is not available; do not choose ask."}
If enough, next = commit. ${opts.jev ? "Whatever you choose, fill questions with up to 3 you would ask the user (only ones whose answer changes the recommendation; offer the top options as answer choices where natural) and research with up to 3 queries that could be looked up; a separate gate may use either. Empty lists are fine when none apply." : "Fill questions only for ask and research only for research."}
open_points: every point still open anywhere (frame unknowns, branch unknowns, unanswered questions, risks that need a call). Merge points that ask the same thing into one; raised_in = every place it came up ("frame", method ids, or grown direction titles); times = how many times it came up. Leave out points the user already settled. rank 1 = settle first because other points or the recommendation depend on it; unlocks = what settling it decides, in a few words. Max 8.
stop_reason: one sentence on why you stop or continue.
${opts.picks ? "The user picked these and their choice wins: " + opts.picks : ""}`;
    case "develop":
      return head + `STEP: Develop one direction: "${node.data.title}" - ${node.data.detail}
Why it made the shortlist: ${node.data.why}
Make it concrete: what it looks like in practice ("practice"), how well it serves the goal ("fit"), what it would take (steps, time, money where knowable; never invent precise figures), the main risks, the smallest test, and a verdict (strong, possible, weak). List up to 3 sub_options: variants of this direction worth considering.`;
    case "narrow":
      return head + `STEP: Show everything, then narrow to 3.
Collect every distinct option surfaced so far into "all" (merge duplicates, keep ids short like o1, o2). Then pick the top 3 (or fewer) that best serve the goal within the constraints, each with why. If parts of several options combine into something better, describe it in "combine"; else "".
${opts.picks ? "The user picked these options and their choice wins: " + opts.picks : ""}`;
    case "assess":
      return head + `STEP: Confidence gate. Is enough known to commit to a recommendation?
enough = true when further analysis is unlikely to change the next action within the effort budget. If not enough, choose next: ask (the user must supply something only they know), research (facts can be looked up), more (more thinking methods would help). Loops left: ${opts.loopsLeft}. If loops left is 0 you must choose commit and name what stays uncertain.
${opts.askAllowed ? "" : "Asking is not available; do not choose ask."}
${opts.researchAllowed ? "" : "Research is not available; do not choose research."}
Only fill questions when next = ask, and research when next = research (max 3 queries).
stop_reason: one sentence on why you stop or continue.`;
    case "research":
      return head + `STEP: Research. Query: ${node.data.query}
Why it matters: ${node.data.why}
${opts.web ? "Use web search and fetch. Cite the source URL for each finding." : 'You cannot browse. Answer from what you reliably know, set source to "" and verified = false.'}
Report only facts relevant to the decision.`;
    case "review":
      return head + `STEP: Adversarial review, one pass. Attack the leading direction as a sharp skeptic would. List real objections only, each with severity and a fix. fatal = true only if the direction should not go ahead as it stands.
unsupported: claims the direction rests on that do not trace to what the user stated, given evidence or research (agreement between steps does not count). Empty if all are supported.`;
    case "decide":
      return head + `STEP: Decision record. recommendation: the call itself in at most two short sentences (under 40 words); details go in reasons. Then the goal it serves, key reasons, tradeoffs, what to cut and why, what stays uncertain, what would change the answer, the single next action (next_action.what: one short sentence, under 25 words) with owner (the user, or "AI" if an AI can do it) and when, and the smallest test if one applies (else "").
call: decide = routine and supported enough, go ahead; test = one important uncertainty remains, run the smallest test first (fill test); defer = it does not need deciding now (revisit_if says when it will); ask = it hinges on the user's values or a permission they have not given.
door: two-way if cheap to undo, one-way if costly or hard to undo.
displaces: what current work or attention this delays, in one short line ("" if nothing real).
revisit_if: the specific trigger that should reopen this decision, one short line.
rule: if this call would settle similar situations in future, one if-then rule for the user to approve ("If ..., then ..."); else "". Never restate a standing rule that already exists.
title: 3-8 words.`;
    case "unstick":
      return head + `STEP: The user marked the step "${node.data.targetTitle}" as stuck or not understood.
Their note: ${node.data.note || "(none)"}
What that step produced: ${node.data.targetSummary}
Explain it in plain language a smart 12-year-old would follow ("plain"). Name what is actually blocking ("blocker") and restate it as a constraint the system must respect ("constraint"). Suggest rerun (redo that step with the constraint), ask (the user must answer something), or nothing.`;
    default:
      throw new Error("Unknown step " + kind);
  }
}
const config = (() => {
  try {
    return JSON.parse(readFileSync(process.env.THINK_CONFIG || join(homedir(), ".thinking-system", "config.json"), "utf8"));
  } catch {
    return {};
  }
})();
const RUNS_DIR = process.env.THINK_RUNS_DIR || config.runsDir || join(homedir(), "Thinking System", "runs");
const RULES_FILE = process.env.THINK_RULES_FILE || config.rulesFile || join(homedir(), ".thinking-system", "rules.md");
const readRules = () => {
  try {
    return readFileSync(RULES_FILE, "utf8").split("\n").filter((l) => l.startsWith("- ")).map((l) => l.slice(2));
  } catch {
    return [];
  }
};
function addRule(text, from) {
  const head = existsSync(RULES_FILE) ? "" : "# Standing rules\n\nApproved if-then rules the Thinking System applies when they fit. Edit or delete freely.\n\n";
  writeFileSync(RULES_FILE, (existsSync(RULES_FILE) ? readFileSync(RULES_FILE, "utf8") : head) + `- ${text.replace(/\s+/g, " ").trim()} (from ${from})
`);
}
const timers$1 = /* @__PURE__ */ new Map();
const runDir = (run2) => join(RUNS_DIR, run2.id);
function loadRuns() {
  if (!existsSync(RUNS_DIR)) return [];
  return readdirSync(RUNS_DIR, { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(RUNS_DIR, d.name, "run.json"))).map((d) => {
    try {
      return JSON.parse(readFileSync(join(RUNS_DIR, d.name, "run.json"), "utf8"));
    } catch {
      return null;
    }
  }).filter(Boolean);
}
function saveRun(run2, now = false) {
  const write2 = () => {
    timers$1.delete(run2.id);
    mkdirSync(runDir(run2), { recursive: true });
    writeFileSync(join(runDir(run2), "run.json"), JSON.stringify(run2, null, 2));
  };
  clearTimeout(timers$1.get(run2.id));
  if (now) return write2();
  timers$1.set(run2.id, setTimeout(write2, 300));
}
function writeRunFile(run2, name, content) {
  mkdirSync(runDir(run2), { recursive: true });
  const path = join(runDir(run2), name);
  writeFileSync(path, content);
  return path;
}
function recordMarkdown(run2) {
  const all = run2.order.map((id) => run2.nodes[id]).filter((n) => n.status === "done" && n.scope === "root");
  const last = (kind) => all.filter((n) => n.kind === kind).at(-1)?.out;
  const d = last("decide"), f = last("frame"), narrow = last("converge") || last("narrow"), review = last("review");
  const bullets = (xs) => (xs || []).map((x) => `- ${x}`).join("\n") || "- none";
  const lines = [
    `# ${d.title}`,
    "",
    `Run ${run2.id} - ${run2.createdAt.slice(0, 16).replace("T", " ")} - ${run2.model} - effort ${run2.effort}`,
    "",
    `## Recommendation`,
    d.recommendation,
    "",
    `**Goal served:** ${d.goal_served}`,
    "",
    `**Next action:** ${d.next_action.what} (owner: ${d.next_action.owner}, when: ${d.next_action.when})`,
    "",
    d.call ? `**Call:** ${d.call} - ${d.door} door${d.displaces ? ` - displaces: ${d.displaces}` : ""}
` : "",
    d.test ? `**Smallest test:** ${d.test}
` : "",
    d.revisit_if ? `**Revisit if:** ${d.revisit_if}
` : "",
    d.rule ? `**Proposed rule (not approved):** ${d.rule}
` : "",
    `## Why`,
    bullets(d.reasons),
    "",
    `## Tradeoffs`,
    bullets(d.tradeoffs),
    "",
    `## Cut`,
    bullets(d.cuts.map((c) => `${c.what} - ${c.why}`)),
    "",
    `## Still uncertain`,
    bullets(d.uncertainty),
    "",
    `## Would change the answer`,
    bullets(d.would_change),
    ""
  ];
  if (f) lines.push(
    `## What you said vs what was inferred`,
    `**Goal (${f.goal.source}):** ${f.goal.text}`,
    "",
    "**Stated**",
    bullets(f.stated),
    "",
    "**Inferred**",
    bullets(f.inferred.map((i) => `${i.text} (why: ${i.why})`)),
    ""
  );
  const open = last("converge")?.open_points;
  if (open?.length) lines.push("## Still open, in the order to settle them", bullets([...open].sort((a, b) => a.rank - b.rank).map((p) => `${p.text} (came up ${p.times}x: ${p.raised_in.join(", ")}; ${p.action}; settles: ${p.unlocks})`)), "");
  if (run2.pointAnswers?.length) lines.push("## Points you settled", bullets(run2.pointAnswers.map((a) => `${a.point} -> ${a.text}`)), "");
  if (run2.corrections.length) lines.push("## Your corrections", bullets(run2.corrections.map((c) => `${c.action}: ${c.original}${c.text ? " -> " + c.text : ""}`)), "");
  if (narrow) lines.push("## Every option considered", bullets(narrow.all.map((o) => `${o.title}: ${o.detail}`)), "");
  if (review) lines.push("## Skeptic objections", bullets(review.objections.map((o) => `[${o.severity}] ${o.text} Fix: ${o.fix}`)), "");
  if (review?.unsupported?.length) lines.push("## Unsupported claims", bullets(review.unsupported), "");
  lines.push(
    "## Methods used",
    bullets(all.filter((n) => n.kind === "method").map((n) => `${n.title}: ${n.data.focus}`)),
    "",
    "## Original thought",
    "```",
    run2.input,
    "```",
    ""
  );
  return lines.join("\n");
}
const KEY = process.env.TYPESAFE_API_KEY || config.typesafeKey;
const JEV_AVAILABLE = !!KEY;
const PRICE = 0.042 / 1e6;
async function ask$1(state, questions2) {
  const t = Date.now();
  for (let attempt = 0; ; attempt++) {
    const res = await fetch("https://api.typesafe.ai/v1/systemone", {
      method: "POST",
      headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ model: "jev-latest", state, questions: questions2 }),
      signal: AbortSignal.timeout(3e4)
    });
    if ((res.status === 429 || res.status === 529) && attempt < 3) {
      await new Promise((r2) => setTimeout(r2, 500 * 2 ** attempt));
      continue;
    }
    if (!res.ok) throw new Error(`Jev ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const r = await res.json();
    return { a: r.answers, ms: Date.now() - t, cost: r.usage.input_tokens * PRICE, model: r.model };
  }
}
const jevAsk = ask$1;
const meta = (r) => ({ ms: r.ms, model: r.model });
const shortThought = (text) => text.length > 4e3 ? text.slice(0, 4e3) + "..." : text;
function situation(run2, frame, question2, extra = {}) {
  const f = frame?.out;
  return {
    thought: shortThought(run2.input),
    goal: f ? `${f.goal.text} (${f.goal.source})` : "unknown",
    question: question2,
    hard_constraints: f ? f.constraints.filter((c) => c.hard).map((c) => c.text) : [],
    other_constraints: [...f ? f.constraints.filter((c) => !c.hard).map((c) => c.text) : [], ...run2.constraints.map((c) => c.text)],
    unknowns: f ? f.unknowns.map((u) => u.text) : [],
    ...extra
  };
}
async function pickMethods(state, { max, exclude = [] }) {
  const pool2 = METHODS.filter((m) => !exclude.includes(m.id));
  const questions2 = {
    simple: { type: "noul", instructions: "Is `question` simple enough that one quick line of thinking settles it?" },
    // The yes/no answers alone run high for most methods; one choice across all of them sets the lead.
    lead: { type: "choice", instructions: "Which thinking method would most help answer `question` toward `goal`?", criteria: Object.fromEntries(pool2.map((m) => [m.id, `${m.name}: ${m.when}`])) }
  };
  for (const m of pool2) questions2["m_" + m.id] = {
    type: "noul",
    instructions: `Would the thinking method "${m.name}" materially help answer \`question\`, given \`goal\` and the situation? The method: ${m.how} It fits when: ${m.when}`,
    criteria: { true: "Applying it here would surface options, risks or facts that could change the answer", false: "It would add little here or does not fit this situation" }
  };
  const r = await ask$1(state, questions2);
  const lead = r.a.lead.probabilities;
  const scored = pool2.map((m) => ({ id: m.id, p: r.a["m_" + m.id].noul, lead: lead[m.id] || 0 })).sort((a, b) => 2 * b.lead + b.p - (2 * a.lead + a.p));
  const simple = r.a.simple.noul >= 0.7;
  const picks = scored.filter((s) => s.p >= 0.5 || s.lead >= 0.1).slice(0, simple ? 1 : max);
  return { ...meta(r), cost: r.cost, simple, scored, picks: picks.length ? picks : null };
}
async function weighQuestions$1(state, qs) {
  if (!qs.length) return null;
  const questions2 = {};
  qs.forEach((q, i) => {
    questions2["changes_" + i] = { type: "noul", instructions: `Would the user's answer to \`candidate_questions[${i}]\` change the recommendation, the scope or the next action?` };
    questions2["blocks_" + i] = { type: "noul", instructions: `Is a good answer impossible without the user answering \`candidate_questions[${i}]\`, rather than a sensible default the system could choose and state?` };
  });
  const r = await ask$1({ ...state, candidate_questions: qs.map((q) => `${q.q} (why: ${q.why})`) }, questions2);
  return { ...meta(r), cost: r.cost, each: qs.map((q, i) => ({ changes: r.a["changes_" + i].noul, blocks: r.a["blocks_" + i].noul })) };
}
const NEXT = {
  commit: "Enough is known: more work is unlikely to change which option to recommend or the next action",
  develop: "The shortlisted options are promising but too vague to choose between; working out what each takes, its risks and a test would settle it",
  research: "The choice hinges on facts that can be looked up, listed in `possible_research`",
  more: "The options so far miss important angles; different kinds of thinking are needed before choosing",
  ask: "The choice now depends on the user's preferences or facts only they know, listed in `possible_questions`"
};
const FIT = [
  "Works against the goal or ignores it",
  "Helps the goal a little",
  "Serves the goal with real trade-offs",
  "Serves the goal well within the constraints",
  "Clearly the strongest fit for the goal and constraints"
];
async function gate(state, out, allowed) {
  const questions2 = {};
  if (allowed.length > 1) questions2.next = { type: "choice", instructions: "The branches have reported and the options are in `options`. What should the thinking system do next?", criteria: Object.fromEntries(allowed.map((k) => [k, NEXT[k]])) };
  out.all.forEach((o, i) => {
    questions2["fit_" + i] = { type: "score", instructions: `How well does \`options[${i}]\` serve \`goal\` and answer \`question\`?`, criteria: FIT };
    if (state.hard_constraints.length) questions2["breaks_" + i] = { type: "noul", instructions: `Does \`options[${i}]\` break any rule in \`hard_constraints\`?` };
  });
  const r = await ask$1({
    ...state,
    options: out.all.map((o) => `${o.title}: ${o.detail}`),
    possible_questions: out.questions.map((q) => q.q),
    possible_research: out.research.map((x) => x.query)
  }, questions2);
  const n = r.a.next;
  return {
    ...meta(r),
    cost: r.cost,
    next: n?.choice ?? null,
    confidence: n?.confidence ?? 0,
    probabilities: n?.probabilities ?? {},
    options: out.all.map((o, i) => ({ id: o.id, fit: r.a["fit_" + i].score / (FIT.length - 1), fitConfidence: r.a["fit_" + i].confidence, breaks: r.a["breaks_" + i]?.noul ?? 0 }))
  };
}
async function checkAnswers(pairs) {
  const state = { questions: pairs.map((p) => p.q), replies: pairs.map((p) => p.a) };
  const qs = {};
  pairs.forEach((p, i) => {
    qs["ok_" + i] = {
      type: "noul",
      instructions: `Does \`replies[${i}]\` give usable information for \`questions[${i}]\`?`,
      criteria: { true: "It answers it, states a preference or fact that bears on it, or says to decide or skip it", false: "It is about something else, contradicts itself, or is too vague to act on" }
    };
  });
  const r = await ask$1(state, qs);
  return { ...meta(r), cost: r.cost, each: pairs.map((p, i) => r.a["ok_" + i].noul) };
}
const bus$1 = new EventEmitter();
bus$1.setMaxListeners(100);
const EFFORT = {
  quick: { methods: 2, loops: 0, asks: 1, review: false },
  normal: { methods: 4, loops: 1, asks: 2, review: true },
  deep: { methods: 6, loops: 2, asks: 3, review: true }
};
const CONCURRENCY$1 = 3;
const TITLES = {
  capture: "Your thought",
  frame: "Frame it",
  ask: "Your input",
  route: "Pick methods",
  narrow: "Show all, keep 3",
  assess: "Enough to commit?",
  review: "Skeptic review",
  decide: "Decision",
  unstick: "Plain explanation",
  converge: "Come back together"
};
const GROW = ["develop", "research", "more"];
const runs = /* @__PURE__ */ new Map();
for (const run2 of loadRuns()) {
  let interrupted = false;
  for (const n of Object.values(run2.nodes)) if (n.status === "running") {
    n.status = "queued";
    interrupted = true;
  }
  if (interrupted) run2.paused = true;
  runs.set(run2.id, run2);
}
const getRun = (id) => runs.get(id);
const listRuns = () => [...runs.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map((r) => ({ id: r.id, title: r.title, createdAt: r.createdAt, status: r.status, model: r.model, effort: r.effort }));
const nodes = (run2) => run2.order.map((id) => run2.nodes[id]);
const active = (run2) => nodes(run2).filter((n) => n.status !== "superseded");
const inScope = (run2, scope) => active(run2).filter((n) => n.scope === scope);
const latest = (run2, scope, kind) => inScope(run2, scope).filter((n) => n.kind === kind && n.status === "done").at(-1);
const effortOf = (run2, scope) => EFFORT[scope === "root" ? run2.effort : "quick"];
const asksUsed = (run2, scope) => inScope(run2, scope).filter((n) => n.kind === "ask").length;
const loopsUsed = (run2, scope) => inScope(run2, scope).filter((n) => n.data.grew || n.kind === "route" && n.data.followup && n.data.legacy).length;
const passOf = (run2, scope) => inScope(run2, scope).filter((n) => n.kind === "converge").length;
function questionTrail(run2, scope) {
  return inScope(run2, scope).filter((n) => (n.kind === "frame" || n.kind === "converge") && n.status === "done" && n.out.question).map((n) => ({ node: n.id, text: n.out.question, changed: n.out.changed || "" }));
}
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
function sourceOf(run2, scope, option, used) {
  const methods = inScope(run2, scope).filter((n) => n.kind === "method");
  const hits = (option?.from || []).map((f) => methods.find((n) => [n.data.method, n.title].some((x) => norm(x) === norm(f) || norm(x).includes(norm(f)) || norm(f).includes(norm(x))))).filter(Boolean);
  const pick2 = hits.find((m) => !used.has(m.id)) || hits[0];
  if (pick2) used.add(pick2.id);
  return pick2?.id || null;
}
function log(run2, text) {
  run2.activity.push({ t: (/* @__PURE__ */ new Date()).toISOString(), text });
  if (run2.activity.length > 40) run2.activity.shift();
}
function add(run2, { kind, scope, title, deps = [], data = {}, status = "queued", out = null }) {
  const id = "n" + ++run2.seq;
  run2.nodes[id] = { id, kind, scope, title: title || TITLES[kind], deps, data, status, out, error: null, createdAt: (/* @__PURE__ */ new Date()).toISOString() };
  run2.order.push(id);
  return run2.nodes[id];
}
function changed(run2, now = false) {
  run2.status = statusOf(run2);
  run2.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  saveRun(run2, now);
  bus$1.emit("run", run2);
}
function statusOf(run2) {
  const a = active(run2);
  if (run2.paused && a.some((n) => n.status === "queued")) return "paused";
  if (a.some((n) => n.status === "running" || n.status === "queued")) return "running";
  if (a.some((n) => n.status === "waiting")) return "waiting";
  if (latest(run2, "root", "decide")) return "done";
  if (a.some((n) => n.status === "error")) return "error";
  return "idle";
}
const list$1 = (items, f) => items.map(f).filter(Boolean).join("\n");
function context(run2, scope) {
  const parts = [];
  if (scope === "root") parts.push(`USER'S THOUGHT (verbatim):
${run2.input}`);
  else {
    const cap = inScope(run2, scope).find((n) => n.kind === "capture");
    const rootFrame = latest(run2, "root", "frame");
    parts.push(
      `GOING ONE LEVEL DEEPER ON:
${cap.out.text}`,
      `ORIGINAL THOUGHT (for context):
${run2.input.slice(0, 2e3)}`
    );
    if (rootFrame) parts.push(`OVERALL GOAL: ${rootFrame.out.goal.text} (${rootFrame.out.goal.source})`);
  }
  const rules = readRules();
  if (rules.length) parts.push("STANDING RULES THE USER APPROVED (apply when one fits instead of re-deciding or re-asking; say which you applied):\n" + list$1(rules, (r) => `- ${r}`));
  if (run2.corrections.length) parts.push("CORRECTIONS FROM THE USER (these override any inference):\n" + list$1(run2.corrections, (c) => c.action === "reject" ? `- NOT TRUE: ${c.original}` : c.action === "edit" ? `- Instead of "${c.original}": ${c.text}` : `- CONFIRMED: ${c.original}`));
  if (run2.pointAnswers?.length) parts.push("OPEN POINTS THE USER SETTLED (each answer covers every place the point came up):\n" + list$1(run2.pointAnswers, (a) => `- ${a.point}
  A: ${a.text}`));
  if (run2.constraints.length) parts.push("CONSTRAINTS THE USER FLAGGED:\n" + list$1(run2.constraints, (c) => `- ${c.text}`));
  const answers = inScope(run2, scope).filter((n) => n.kind === "ask" && n.status === "done");
  const qa = answers.flatMap((n) => n.out.skipped ? [{ q: "(user skipped questions)", a: "Decide yourself." }] : n.out.answers);
  if (qa.length) parts.push("ANSWERS FROM THE USER:\n" + list$1(qa, (x) => `- Q: ${x.q}
  A: ${x.a}`));
  const frame = latest(run2, scope, "frame");
  if (frame) {
    const f = frame.out;
    parts.push(`CURRENT FRAME:
Goal (${f.goal.source}): ${f.goal.text}
Stated: ${f.stated.join("; ")}
Inferred: ${f.inferred.map((i) => i.text).join("; ")}
Constraints: ${f.constraints.map((c) => `${c.text}${c.hard ? " [hard]" : ""}`).join("; ")}
Unknowns: ${f.unknowns.map((u) => `${u.text} -> ${u.action}`).join("; ")}`);
  }
  const trail = questionTrail(run2, scope);
  if (trail.length) parts.push(`CURRENT QUESTION: ${trail.at(-1).text}` + (trail.length > 1 ? `
Earlier versions: ${trail.slice(0, -1).map((q) => q.text).join(" | ")}` : ""));
  const methods = inScope(run2, scope).filter((n) => n.kind === "method" && n.status === "done");
  if (methods.length) parts.push("METHOD RESULTS:\n" + list$1(methods, (n) => [
    `## ${n.title} [${n.data.method}] (focus: ${n.data.focus})`,
    n.out.summary,
    ...n.out.findings.map((f) => `- [${f.kind}] ${f.text}`),
    n.out.options.length ? "Options: " + n.out.options.map((o) => `${o.title}: ${o.detail}`).join(" | ") : "",
    n.out.cuts.length ? "Cut: " + n.out.cuts.map((c) => `${c.what} (${c.why})`).join(" | ") : "",
    n.out.risks.length ? "Risks: " + n.out.risks.join("; ") : "",
    n.out.quadrant?.items?.length ? `Grid (${n.out.quadrant.x} / ${n.out.quadrant.y}): ` + n.out.quadrant.items.map((i) => `${i.text} [${i.x_high ? "high" : "low"} ${n.out.quadrant.x}, ${i.y_high ? "high" : "low"} ${n.out.quadrant.y}]`).join("; ") : "",
    n.out.matrix?.rows?.length ? "Matrix totals: " + n.out.matrix.rows.map((r) => `${r.option} ${r.total}`).join("; ") : ""
  ].filter(Boolean).join("\n")));
  const research = inScope(run2, scope).filter((n) => n.kind === "research" && n.status === "done");
  if (research.length) parts.push("RESEARCH:\n" + list$1(research, (n) => `## ${n.data.query}${n.out.verified ? "" : " (unverified)"}
` + n.out.findings.map((f) => `- ${f.text}${f.source ? ` [${f.source}]` : ""}`).join("\n")));
  const developed = inScope(run2, scope).filter((n) => n.kind === "develop" && n.status === "done");
  if (developed.length) parts.push("DEVELOPED DIRECTIONS:\n" + list$1(developed, (n) => `## ${n.data.title} (verdict: ${n.out.verdict})
${n.out.practice}
Fit: ${n.out.fit}
Takes: ${n.out.takes.join("; ")}
Risks: ${n.out.risks.join("; ")}
Test: ${n.out.test}` + (n.out.sub_options.length ? `
Variants: ${n.out.sub_options.map((o) => o.title).join("; ")}` : "")));
  const narrow = latest(run2, scope, "converge") || latest(run2, scope, "narrow");
  if (narrow) {
    const byId = Object.fromEntries(narrow.out.all.map((o) => [o.id, o]));
    parts.push("SHORTLIST:\n" + list$1(narrow.out.top, (t) => `- ${byId[t.id]?.title || t.id}: ${byId[t.id]?.detail || ""} (why: ${t.why})`) + (narrow.out.combine ? `
Combination: ${narrow.out.combine}` : ""));
  }
  if (run2.picks[scope]) parts.push(`USER PICKED (this wins over the shortlist): ${run2.picks[scope]}`);
  const assess = latest(run2, scope, "assess");
  if (assess) parts.push(`LATEST ASSESSMENT: ${assess.out.summary} Gaps: ${assess.out.gaps.map((g) => g.text).join("; ") || "none"}`);
  const review = latest(run2, scope, "review");
  if (review) parts.push("SKEPTIC OBJECTIONS:\n" + list$1(review.out.objections, (o) => `- [${o.severity}] ${o.text} Fix: ${o.fix}`));
  return parts.join("\n\n");
}
function tick(run2) {
  if (run2.paused) return changed(run2);
  let running = active(run2).filter((n) => n.status === "running").length;
  for (const n of active(run2)) {
    if (running >= CONCURRENCY$1) break;
    if (n.status !== "queued") continue;
    if (!n.deps.every((d) => run2.nodes[d]?.status === "done")) continue;
    running++;
    start(run2, n);
  }
  changed(run2);
}
async function start(run2, node) {
  node.status = "running";
  node.startedAt = (/* @__PURE__ */ new Date()).toISOString();
  log(run2, `${node.title}: started`);
  const scope = node.scope;
  const E = effortOf(run2, scope);
  const model = modelById(run2.model);
  const opts = {
    effort: scope === "root" ? run2.effort : "quick",
    // The opening frame gets one round of questions; the rest are saved for when the branches come back.
    askAllowed: !run2.handsOff && (node.kind === "frame" ? asksUsed(run2, scope) === 0 : asksUsed(run2, scope) < E.asks),
    loopsLeft: E.loops - loopsUsed(run2, scope),
    researchAllowed: E.loops - loopsUsed(run2, scope) > 0,
    web: model.web,
    picks: run2.picks[scope],
    pass: passOf(run2, scope),
    jev: run2.jev
  };
  try {
    let res = node.kind === "route" && run2.jev ? await jevRoute(run2, node, E) : null;
    if (!res) res = await callModel({
      model: run2.model,
      system: SYSTEM$1,
      prompt: stepPrompt(node.kind, node, context(run2, scope), opts),
      schema: SCHEMAS$1[node.kind],
      kind: node.kind,
      web: node.kind === "research" && model.web
    });
    run2.cost += res.cost;
    if (node.status !== "running") return;
    node.out = res.out;
    if (run2.jev) await jevJudge(run2, node, opts);
    if (node.status !== "running") return;
    const out = node.out;
    node.status = "done";
    node.endedAt = (/* @__PURE__ */ new Date()).toISOString();
    log(run2, `${node.title}: ${out.summary || "done"}`);
    after(run2, node, E, opts);
  } catch (e) {
    if (node.status !== "running") return;
    node.status = "error";
    node.error = String(e.message || e).slice(0, 600);
    log(run2, `${node.title}: failed`);
  }
  tick(run2);
}
function track(run2, r) {
  run2.cost += r.cost;
  run2.jevStats = { calls: (run2.jevStats?.calls || 0) + 1, ms: (run2.jevStats?.ms || 0) + r.ms };
}
const jevError = (node, e) => {
  node.data.jev = { ...node.data.jev, error: String(e.message || e).slice(0, 200) };
};
const pct = (p) => Math.round(p * 100) + "%";
async function jevRoute(run2, node, E) {
  const s = node.scope;
  const frame = latest(run2, s, "frame");
  const q = questionTrail(run2, s).at(-1)?.text || run2.input.slice(0, 300);
  const review = latest(run2, s, "review");
  const objections = node.title === "Answer the objections" && review ? review.out.objections.map((o) => o.text) : null;
  const done = inScope(run2, s).filter((n) => n.kind === "method").map((n) => n.data.method);
  try {
    const r = await pickMethods(situation(run2, frame, q, objections ? { objections } : {}), { max: E.methods, exclude: node.data.followup ? done : [] });
    track(run2, r);
    node.data.jev = { kind: "route", ms: r.ms, simple: r.simple, scored: r.scored.slice(0, 8) };
    if (!r.picks) {
      node.data.jev.fallback = "No method was a clear fit, so Claude chose";
      return null;
    }
    const focus = !node.data.followup ? q : objections ? "How to answer the skeptic's objections" : `What has not been considered yet about: ${q}`;
    const n = r.picks.length;
    return { cost: 0, out: {
      summary: `Jev picked ${n} method${n > 1 ? "s" : ""} in ${(r.ms / 1e3).toFixed(1)}s.`,
      simple: r.simple,
      plan: r.picks.map((p) => ({ method: p.id, focus, why: `Jev: ${pct(p.p)} likely to help`, checks: [] }))
    } };
  } catch (e) {
    jevError(node, e);
    return null;
  }
}
function weigh(qs, r) {
  return qs.map((q, i) => ({ ...q, jev: r.each[i], blocking: r.each[i].blocks >= 0.6 ? true : r.each[i].blocks <= 0.4 ? false : q.blocking }));
}
const keepQuestions = (qs) => qs.filter((q) => !q.jev || q.jev.changes >= 0.35);
async function jevJudge(run2, node, opts) {
  const o = node.out, s = node.scope;
  try {
    if (node.kind === "frame" && opts.askAllowed && o.questions.length) {
      const r = await weighQuestions$1(situation(run2, node, o.question), o.questions);
      track(run2, r);
      const all = weigh(o.questions, r);
      o.questions = keepQuestions(all);
      node.data.jev = { kind: "questions", ms: r.ms, dropped: all.filter((q) => !o.questions.includes(q)).map((q) => q.q) };
    }
    if (node.kind === "converge" && o.all.length) {
      const state = situation(run2, latest(run2, s, "frame"), o.question);
      const allowed = ["commit"];
      if (opts.loopsLeft > 0) {
        if (o.top.length) allowed.push("develop");
        if (o.research.length) allowed.push("research");
        allowed.push("more");
      }
      if (opts.askAllowed && o.questions.length) allowed.push("ask");
      const [g, w] = await Promise.all([gate(state, o, allowed), allowed.includes("ask") ? weighQuestions$1(state, o.questions) : null]);
      track(run2, g);
      if (w) {
        track(run2, w);
        o.questions = keepQuestions(weigh(o.questions, w));
      }
      const byId = Object.fromEntries(g.options.map((x) => [x.id, x]));
      const dropped = o.top.filter((t) => byId[t.id]?.breaks >= 0.7).map((t) => t.id);
      if (dropped.length) {
        const keep = o.top.filter((t) => !dropped.includes(t.id));
        const fill = g.options.filter((x) => x.breaks < 0.7 && !keep.some((t) => t.id === x.id)).sort((a, b) => b.fit - a.fit).slice(0, o.top.length - keep.length).map((x) => ({ id: x.id, why: `Jev: best remaining fit (${pct(x.fit)}) that keeps the hard constraints` }));
        o.top = [...keep, ...fill];
      }
      const claude = { next: o.next, enough: o.enough };
      const sure = g.next && (g.next === o.next ? g.confidence >= 0.5 : g.confidence >= 0.7);
      if (sure) {
        o.next = g.next;
        o.enough = g.next === "commit";
      }
      node.data.jev = { kind: "gate", ms: g.ms + (w?.ms || 0), next: g.next, confidence: g.confidence, probabilities: g.probabilities, decidedBy: sure ? "jev" : "claude", claude, options: g.options, dropped };
    }
  } catch (e) {
    jevError(node, e);
  }
}
function after(run2, node, E, opts) {
  const s = node.scope;
  const o = node.out;
  const toReview = (deps) => add(run2, { kind: E.review ? "review" : "decide", scope: s, deps });
  const followup = (deps) => add(run2, { kind: "route", scope: s, title: "Fill the gaps", deps, data: { followup: true, legacy: true } });
  switch (node.kind) {
    case "capture":
      add(run2, { kind: "frame", scope: s, deps: [node.id] });
      break;
    case "frame": {
      if (s === "root" && o.title) run2.title = o.title;
      if (s !== "root" && o.title) node.title = "Frame: " + o.title;
      if (!opts.askAllowed) o.questions = [];
      const blocking = o.questions.some((q) => q.blocking);
      if (blocking) add(run2, { kind: "ask", scope: s, deps: [node.id], status: "waiting", data: { from: "frame", questions: o.questions } });
      else add(run2, { kind: "route", scope: s, deps: [node.id] });
      break;
    }
    case "ask":
      if (node.data.from === "frame" && !node.out.skipped) add(run2, { kind: "frame", scope: s, title: "Reframe", deps: [node.id] });
      else if (node.data.from === "frame") add(run2, { kind: "route", scope: s, deps: [node.id] });
      else if (node.data.from === "converge") add(run2, { kind: "converge", scope: s, title: "Restate with your answers", deps: [node.id] });
      else followup([node.id]);
      break;
    case "route": {
      let plan = o.plan.slice(0, E.methods);
      if (!plan.length && !node.data.followup) plan = [{ method: "possibilities", focus: "What directions exist?", why: "Fallback", checks: [] }];
      const ids = plan.map((p) => {
        const m = methodById(p.method);
        return add(run2, { kind: "method", scope: s, title: m.name, deps: [node.id], data: { method: m.id, name: m.name, how: m.how, focus: p.focus, why: p.why, checks: p.checks, ring: node.data.ring || 1 } }).id;
      });
      add(run2, { kind: "converge", scope: s, deps: ids.length ? ids : [node.id] });
      break;
    }
    case "converge": {
      const grow = GROW.includes(o.next) && !o.enough && opts.loopsLeft > 0;
      if (!grow && !o.enough && o.next === "ask" && o.questions.length && opts.askAllowed)
        add(run2, { kind: "ask", scope: s, deps: [node.id], status: "waiting", data: { from: "converge", questions: o.questions } });
      else if (grow) {
        node.data.grew = true;
        const ring = loopsUsed(run2, s) + 1;
        const byId = Object.fromEntries(o.all.map((x) => [x.id, x]));
        const used = /* @__PURE__ */ new Set();
        let ids = [];
        if (o.next === "develop") ids = o.top.slice(0, 3).map((t) => {
          const opt = byId[t.id] || { title: t.id, detail: "" };
          return add(run2, { kind: "develop", scope: s, title: opt.title, deps: [node.id], data: { title: opt.title, detail: opt.detail, why: t.why, parent: sourceOf(run2, s, opt, used), ring } }).id;
        });
        if (o.next === "research") ids = o.research.slice(0, 3).map((r) => add(run2, { kind: "research", scope: s, title: "Look up: " + r.query, deps: [node.id], data: { ...r, ring } }).id);
        if (ids.length) add(run2, { kind: "converge", scope: s, deps: ids });
        else add(run2, { kind: "route", scope: s, title: "Find other angles", deps: [node.id], data: { followup: true, ring } });
      } else toReview([node.id]);
      break;
    }
    case "narrow":
      add(run2, { kind: "assess", scope: s, deps: [node.id] });
      break;
    case "assess": {
      const commit = o.next === "commit" || o.enough || opts.loopsLeft <= 0;
      if (commit) toReview([node.id]);
      else if (o.next === "ask" && o.questions.length && opts.askAllowed)
        add(run2, { kind: "ask", scope: s, deps: [node.id], status: "waiting", data: { from: "assess", questions: o.questions } });
      else if (o.next === "research" && o.research.length)
        followup(o.research.slice(0, 3).map((r) => add(run2, { kind: "research", scope: s, title: "Look up: " + r.query, deps: [node.id], data: r }).id));
      else followup([node.id]);
      break;
    }
    case "review":
      if (o.fatal && opts.loopsLeft > 0) {
        node.data.grew = true;
        add(run2, { kind: "route", scope: s, title: "Answer the objections", deps: [node.id], data: { followup: true, ring: loopsUsed(run2, s) + 1 } });
      } else add(run2, { kind: "decide", scope: s, deps: [node.id] });
      break;
    case "decide":
      if (s === "root") {
        run2.title = o.title || run2.title;
        writeRunFile(run2, "record.md", recordMarkdown(run2));
      } else {
        const parent = run2.nodes[s.slice(1)];
        if (parent) parent.childResult = { recommendation: o.recommendation, next: o.next_action.what };
      }
      break;
    case "unstick": {
      const target = run2.nodes[node.data.target];
      if (o.constraint) run2.constraints.push({ text: o.constraint, from: node.data.target });
      if (target?.stuck) target.stuck.explained = node.id;
      break;
    }
  }
}
function createRun({ input, model, effort, handsOff = false, jev: useJev }) {
  const now = /* @__PURE__ */ new Date();
  const words2 = input.split("\n").filter((l) => !l.startsWith("--- ")).join(" ").toLowerCase().match(/[a-z0-9]+/g);
  const slug = (words2 || ["thought"]).slice(0, 5).join("-").slice(0, 40);
  model = resolveModel(model);
  const id = `${now.toISOString().slice(0, 10)}-${slug}-${Math.random().toString(36).slice(2, 6)}`;
  const run2 = {
    id,
    title: input.trim().split("\n").find((l) => l.trim() && !l.startsWith("--- "))?.slice(0, 70) || "Thought",
    input,
    model,
    effort: EFFORT[effort] ? effort : "normal",
    handsOff: !!handsOff,
    createdAt: now.toISOString(),
    status: "running",
    jev: JEV_AVAILABLE && (useJev ?? model !== "dry"),
    seq: 0,
    nodes: {},
    order: [],
    corrections: [],
    constraints: [],
    pointAnswers: [],
    picks: {},
    cost: 0,
    activity: []
  };
  runs.set(id, run2);
  const cap = add(run2, { kind: "capture", scope: "root", status: "done", out: { text: input } });
  after(run2, cap, EFFORT[run2.effort], {});
  log(run2, "Run started on " + modelById(run2.model).label + (run2.jev ? ", Jev deciding the routes" : ""));
  tick(run2);
  return run2;
}
function need(run2, nodeId) {
  const n = run2.nodes[nodeId];
  if (!n) throw new Error("No such step");
  return n;
}
async function answer$1(run2, { nodeId, answers = [], skip = false, asIs = false }) {
  const n = need(run2, nodeId);
  if (n.kind !== "ask" || n.status !== "waiting") throw new Error("That step is not waiting for you");
  const given = answers.filter((a) => a.a?.trim());
  if (run2.jev && !skip && !asIs && given.length && !n.data.checked) {
    n.data.checked = true;
    const matched = n.data.questions.map((q) => ({ q: q.q, a: given.find((a) => a.q === q.q)?.a })).filter((p) => p.a);
    const pairs = matched.length ? matched : n.data.questions.map((q) => ({ q: q.q, a: given.map((a) => a.a).join(" / ") }));
    try {
      const r = await checkAnswers(pairs);
      track(run2, r);
      const unclear = pairs.filter((p, i) => r.each[i] < 0.3).map((p) => p.q);
      if (unclear.length && n.status === "waiting") {
        n.data.unclear = { questions: unclear, first: given };
        log(run2, "Your input: needs a little more on " + unclear.length + " question" + (unclear.length > 1 ? "s" : ""));
        changed(run2);
        return { unclear };
      }
    } catch (e) {
      log(run2, "Answer check skipped: " + String(e.message || e).slice(0, 80));
    }
  }
  const all = [...n.data.unclear?.first || [], ...given];
  n.out = { answers: all, skipped: skip || !all.length };
  n.status = "done";
  n.endedAt = (/* @__PURE__ */ new Date()).toISOString();
  n.out.summary = n.out.skipped ? "You said: decide yourself" : `${n.out.answers.length} answer(s)`;
  log(run2, "Your input: " + n.out.summary);
  after(run2, n, effortOf(run2, n.scope), {});
  tick(run2);
}
function descendants(run2, rootIds) {
  const set = new Set(rootIds);
  let grew = true;
  while (grew) {
    grew = false;
    for (const n of active(run2)) {
      if (set.has(n.id)) continue;
      const hit = n.deps.some((d) => set.has(d)) || n.kind === "unstick" && set.has(n.data.target) || set.has(n.scope.slice(1));
      if (hit) {
        set.add(n.id);
        grew = true;
      }
    }
  }
  return set;
}
function rerun(run2, { nodeId }) {
  const n = need(run2, nodeId);
  if (n.kind === "capture") throw new Error("Start a new run to change the thought itself");
  for (const id of descendants(run2, [n.id])) run2.nodes[id].status = "superseded";
  add(run2, { kind: n.kind, scope: n.scope, title: n.title, deps: n.deps, data: { ...n.data, grew: void 0 }, status: n.kind === "ask" ? "waiting" : "queued" });
  run2.paused = false;
  log(run2, `${n.title}: redoing this step and everything after it`);
  tick(run2);
}
function correct(run2, { original, action, text = "", frameId, nodeId }) {
  run2.corrections = run2.corrections.filter((c) => c.original !== original);
  run2.corrections.push({ original, action, text, from: nodeId || frameId });
  log(run2, action === "confirm" ? `Confirmed: ${original}` : `Corrected: ${original}`);
  const src = nodeId && run2.nodes[nodeId];
  if (src && src.status === "done" && src.kind !== "frame") return action === "confirm" ? changed(run2) : rerun(run2, { nodeId });
  const scope = run2.nodes[frameId]?.scope || "root";
  const frame = inScope(run2, scope).filter((n) => n.kind === "frame" && n.status === "done").at(-1);
  if (action !== "confirm" && frame) return rerun(run2, { nodeId: frame.id });
  changed(run2);
}
function settle$1(run2, { point, text, scope = "root" }) {
  if (!point?.trim() || !text?.trim()) throw new Error("Write an answer first");
  run2.pointAnswers = (run2.pointAnswers || []).filter((a) => a.point !== point);
  run2.pointAnswers.push({ point, text, scope, at: (/* @__PURE__ */ new Date()).toISOString() });
  log(run2, `Settled: ${point}`);
  if (inScope(run2, scope).some((n) => n.status === "queued" || n.status === "running")) return changed(run2);
  const target = latest(run2, scope, "converge") || latest(run2, scope, "frame");
  if (target) return rerun(run2, { nodeId: target.id });
  changed(run2);
}
function stuck(run2, { nodeId, note: note2 = "" }) {
  const n = need(run2, nodeId);
  n.stuck = { note: note2, at: (/* @__PURE__ */ new Date()).toISOString() };
  add(run2, { kind: "unstick", scope: n.scope, deps: [], data: { target: n.id, targetTitle: n.title, targetSummary: summarize(n), note: note2 } });
  log(run2, `Marked stuck: ${n.title}`);
  tick(run2);
}
function deeper(run2, { nodeId, focus = "" }) {
  const n = need(run2, nodeId);
  const scope = "S" + n.id;
  if (inScope(run2, scope).length) return;
  n.child = scope;
  const text = focus.trim() || `${n.title}: ${summarize(n)}`;
  const cap = add(run2, { kind: "capture", scope, title: "Go deeper", status: "done", out: { text, summary: text.slice(0, 120) }, data: { parent: n.id } });
  after(run2, cap, EFFORT.quick, {});
  log(run2, `Going deeper on ${n.title}`);
  tick(run2);
}
function pick$1(run2, { nodeId, picks = [], combine = "" }) {
  const n = need(run2, nodeId);
  if (!["narrow", "converge"].includes(n.kind) || !n.out) throw new Error("Picks apply to the shortlist step");
  const byId = Object.fromEntries(n.out.all.map((o) => [o.id, o]));
  run2.picks[n.scope] = [...picks.map((id) => byId[id]?.title || id), combine && `combine: ${combine}`].filter(Boolean).join("; ");
  n.data.userPicks = picks;
  log(run2, "You picked: " + run2.picks[n.scope]);
  if (n.kind === "converge") return rerun(run2, { nodeId: n.id });
  const next = active(run2).find((x) => x.deps.includes(n.id));
  if (next) return rerun(run2, { nodeId: next.id });
  changed(run2);
}
function resume(run2) {
  run2.paused = false;
  log(run2, "Resumed");
  tick(run2);
}
function summarize(n) {
  const o = n.out;
  if (!o) return n.error || "";
  if (n.kind === "capture") return o.text.slice(0, 160);
  if (n.kind === "decide") return o.recommendation;
  if (n.kind === "unstick") return o.plain;
  return o.summary || "";
}
function toExcalidraw(run2, positions) {
  const els = [];
  let seed = 1;
  const base = (type, x, y, w, h, extra = {}) => ({
    id: `${type}-${seed}`,
    type,
    x,
    y,
    width: w,
    height: h,
    angle: 0,
    strokeColor: "#111418",
    backgroundColor: "transparent",
    fillStyle: "solid",
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 0,
    opacity: 100,
    groupIds: [],
    frameId: null,
    roundness: type === "rectangle" ? { type: 3 } : null,
    seed: seed++,
    version: 1,
    versionNonce: seed,
    isDeleted: false,
    boundElements: [],
    updated: Date.now(),
    link: null,
    locked: false,
    ...extra
  });
  const text = (x, y, w, str2, size, containerId = null) => base("text", x, y, w, size * 1.25 * str2.split("\n").length, {
    text: str2,
    originalText: str2,
    fontSize: size,
    fontFamily: 2,
    textAlign: "left",
    verticalAlign: "top",
    containerId,
    lineHeight: 1.25,
    autoResize: true
  });
  const wrap = (s, n = 34) => s.split(" ").reduce((acc, w) => {
    const line = acc.at(-1);
    if ((line + " " + w).trim().length > n) acc.push(w);
    else acc[acc.length - 1] = (line + " " + w).trim();
    return acc;
  }, [""]).slice(0, 4).join("\n");
  const ids = {};
  for (const [id, p] of Object.entries(positions)) {
    const n = run2.nodes[id];
    if (!n) continue;
    const stroke = n.stuck ? "#E5484D" : n.status === "waiting" ? "#2F54EB" : "#111418";
    const rect = base("rectangle", p.x, p.y, p.w, p.h, { strokeColor: stroke, strokeStyle: n.status === "done" || n.status === "waiting" ? "solid" : "dashed" });
    els.push(rect, text(p.x + 14, p.y + 12, p.w - 28, n.title, 18));
    const sum = n.out?.recommendation || n.out?.plain || n.out?.summary || n.status;
    els.push(text(p.x + 14, p.y + 40, p.w - 28, wrap(String(sum)), 13));
    ids[id] = rect;
  }
  for (const id of Object.keys(positions)) {
    const n = run2.nodes[id];
    const from = n?.kind === "unstick" ? [n.data.target] : n?.deps || [];
    for (const d of from) {
      const a = positions[d], b = positions[id];
      if (!a || !b) continue;
      const sx = a.x + a.w, sy = a.y + a.h / 2, ex = b.x, ey = b.y + b.h / 2;
      els.push(base("arrow", sx, sy, ex - sx, ey - sy, {
        points: [[0, 0], [ex - sx, ey - sy]],
        endArrowhead: "arrow",
        startArrowhead: null,
        strokeColor: n.kind === "unstick" ? "#E5484D" : "#111418",
        startBinding: { elementId: ids[d].id, focus: 0, gap: 4 },
        endBinding: { elementId: ids[id].id, focus: 0, gap: 4 }
      }));
    }
  }
  return { type: "excalidraw", version: 2, source: "thinking-system", elements: els, appState: { viewBackgroundColor: "#ffffff", gridSize: null }, files: {} };
}
function getDefaultExportFromCjs(x) {
  return x && x.__esModule && Object.prototype.hasOwnProperty.call(x, "default") ? x["default"] : x;
}
var DEFAULT_EDGE_NAME = "\0";
var GRAPH_NODE = "\0";
var EDGE_KEY_DELIM = "";
let Graph$a = class Graph {
  _isDirected = true;
  _isMultigraph = false;
  _isCompound = false;
  // Label for the graph itself
  _label;
  // Defaults to be set when creating a new node
  _defaultNodeLabelFn = () => void 0;
  // Defaults to be set when creating a new edge
  _defaultEdgeLabelFn = () => void 0;
  // v -> label
  _nodes = {};
  // v -> edgeObj
  _in = {};
  // u -> v -> Number
  _preds = {};
  // v -> edgeObj
  _out = {};
  // v -> w -> Number
  _sucs = {};
  // e -> edgeObj
  _edgeObjs = {};
  // e -> label
  _edgeLabels = {};
  /* Number of nodes in the graph. Should only be changed by the implementation. */
  _nodeCount = 0;
  /* Number of edges in the graph. Should only be changed by the implementation. */
  _edgeCount = 0;
  _parent;
  _children;
  constructor(opts) {
    if (opts) {
      this._isDirected = Object.hasOwn(opts, "directed") ? opts.directed : true;
      this._isMultigraph = Object.hasOwn(opts, "multigraph") ? opts.multigraph : false;
      this._isCompound = Object.hasOwn(opts, "compound") ? opts.compound : false;
    }
    if (this._isCompound) {
      this._parent = {};
      this._children = {};
      this._children[GRAPH_NODE] = {};
    }
  }
  /* === Graph functions ========= */
  /**
   * Whether graph was created with 'directed' flag set to true or not.
   */
  isDirected() {
    return this._isDirected;
  }
  /**
   * Whether graph was created with 'multigraph' flag set to true or not.
   */
  isMultigraph() {
    return this._isMultigraph;
  }
  /**
   * Whether graph was created with 'compound' flag set to true or not.
   */
  isCompound() {
    return this._isCompound;
  }
  /**
   * Sets the label of the graph.
   */
  setGraph(label) {
    this._label = label;
    return this;
  }
  /**
   * Gets the graph label.
   */
  graph() {
    return this._label;
  }
  /* === Node functions ========== */
  /**
   * Sets the default node label. If newDefault is a function, it will be
   * invoked ach time when setting a label for a node. Otherwise, this label
   * will be assigned as default label in case if no label was specified while
   * setting a node.
   * Complexity: O(1).
   */
  setDefaultNodeLabel(newDefault) {
    this._defaultNodeLabelFn = newDefault;
    if (typeof newDefault !== "function") {
      this._defaultNodeLabelFn = () => newDefault;
    }
    return this;
  }
  /**
   * Gets the number of nodes in the graph.
   * Complexity: O(1).
   */
  nodeCount() {
    return this._nodeCount;
  }
  /**
   * Gets all nodes of the graph. Note, the in case of compound graph subnodes are
   * not included in list.
   * Complexity: O(1).
   */
  nodes() {
    return Object.keys(this._nodes);
  }
  /**
   * Gets list of nodes without in-edges.
   * Complexity: O(|V|).
   */
  sources() {
    var self = this;
    return this.nodes().filter((v) => Object.keys(self._in[v]).length === 0);
  }
  /**
   * Gets list of nodes without out-edges.
   * Complexity: O(|V|).
   */
  sinks() {
    var self = this;
    return this.nodes().filter((v) => Object.keys(self._out[v]).length === 0);
  }
  /**
   * Invokes setNode method for each node in names list.
   * Complexity: O(|names|).
   */
  setNodes(vs, value) {
    var args = arguments;
    var self = this;
    vs.forEach(function(v) {
      if (args.length > 1) {
        self.setNode(v, value);
      } else {
        self.setNode(v);
      }
    });
    return this;
  }
  /**
   * Creates or updates the value for the node v in the graph. If label is supplied
   * it is set as the value for the node. If label is not supplied and the node was
   * created by this call then the default node label will be assigned.
   * Complexity: O(1).
   */
  setNode(v, value) {
    if (Object.hasOwn(this._nodes, v)) {
      if (arguments.length > 1) {
        this._nodes[v] = value;
      }
      return this;
    }
    this._nodes[v] = arguments.length > 1 ? value : this._defaultNodeLabelFn(v);
    if (this._isCompound) {
      this._parent[v] = GRAPH_NODE;
      this._children[v] = {};
      this._children[GRAPH_NODE][v] = true;
    }
    this._in[v] = {};
    this._preds[v] = {};
    this._out[v] = {};
    this._sucs[v] = {};
    ++this._nodeCount;
    return this;
  }
  /**
   * Gets the label of node with specified name.
   * Complexity: O(|V|).
   */
  node(v) {
    return this._nodes[v];
  }
  /**
   * Detects whether graph has a node with specified name or not.
   */
  hasNode(v) {
    return Object.hasOwn(this._nodes, v);
  }
  /**
   * Remove the node with the name from the graph or do nothing if the node is not in
   * the graph. If the node was removed this function also removes any incident
   * edges.
   * Complexity: O(1).
   */
  removeNode(v) {
    var self = this;
    if (Object.hasOwn(this._nodes, v)) {
      var removeEdge = (e) => self.removeEdge(self._edgeObjs[e]);
      delete this._nodes[v];
      if (this._isCompound) {
        this._removeFromParentsChildList(v);
        delete this._parent[v];
        this.children(v).forEach(function(child) {
          self.setParent(child);
        });
        delete this._children[v];
      }
      Object.keys(this._in[v]).forEach(removeEdge);
      delete this._in[v];
      delete this._preds[v];
      Object.keys(this._out[v]).forEach(removeEdge);
      delete this._out[v];
      delete this._sucs[v];
      --this._nodeCount;
    }
    return this;
  }
  /**
   * Sets node p as a parent for node v if it is defined, or removes the
   * parent for v if p is undefined. Method throws an exception in case of
   * invoking it in context of noncompound graph.
   * Average-case complexity: O(1).
   */
  setParent(v, parent) {
    if (!this._isCompound) {
      throw new Error("Cannot set parent in a non-compound graph");
    }
    if (parent === void 0) {
      parent = GRAPH_NODE;
    } else {
      parent += "";
      for (var ancestor = parent; ancestor !== void 0; ancestor = this.parent(ancestor)) {
        if (ancestor === v) {
          throw new Error("Setting " + parent + " as parent of " + v + " would create a cycle");
        }
      }
      this.setNode(parent);
    }
    this.setNode(v);
    this._removeFromParentsChildList(v);
    this._parent[v] = parent;
    this._children[parent][v] = true;
    return this;
  }
  _removeFromParentsChildList(v) {
    delete this._children[this._parent[v]][v];
  }
  /**
   * Gets parent node for node v.
   * Complexity: O(1).
   */
  parent(v) {
    if (this._isCompound) {
      var parent = this._parent[v];
      if (parent !== GRAPH_NODE) {
        return parent;
      }
    }
  }
  /**
   * Gets list of direct children of node v.
   * Complexity: O(1).
   */
  children(v = GRAPH_NODE) {
    if (this._isCompound) {
      var children = this._children[v];
      if (children) {
        return Object.keys(children);
      }
    } else if (v === GRAPH_NODE) {
      return this.nodes();
    } else if (this.hasNode(v)) {
      return [];
    }
  }
  /**
   * Return all nodes that are predecessors of the specified node or undefined if node v is not in
   * the graph. Behavior is undefined for undirected graphs - use neighbors instead.
   * Complexity: O(|V|).
   */
  predecessors(v) {
    var predsV = this._preds[v];
    if (predsV) {
      return Object.keys(predsV);
    }
  }
  /**
   * Return all nodes that are successors of the specified node or undefined if node v is not in
   * the graph. Behavior is undefined for undirected graphs - use neighbors instead.
   * Complexity: O(|V|).
   */
  successors(v) {
    var sucsV = this._sucs[v];
    if (sucsV) {
      return Object.keys(sucsV);
    }
  }
  /**
   * Return all nodes that are predecessors or successors of the specified node or undefined if
   * node v is not in the graph.
   * Complexity: O(|V|).
   */
  neighbors(v) {
    var preds = this.predecessors(v);
    if (preds) {
      const union = new Set(preds);
      for (var succ of this.successors(v)) {
        union.add(succ);
      }
      return Array.from(union.values());
    }
  }
  isLeaf(v) {
    var neighbors;
    if (this.isDirected()) {
      neighbors = this.successors(v);
    } else {
      neighbors = this.neighbors(v);
    }
    return neighbors.length === 0;
  }
  /**
   * Creates new graph with nodes filtered via filter. Edges incident to rejected node
   * are also removed. In case of compound graph, if parent is rejected by filter,
   * than all its children are rejected too.
   * Average-case complexity: O(|E|+|V|).
   */
  filterNodes(filter) {
    var copy = new this.constructor({
      directed: this._isDirected,
      multigraph: this._isMultigraph,
      compound: this._isCompound
    });
    copy.setGraph(this.graph());
    var self = this;
    Object.entries(this._nodes).forEach(function([v, value]) {
      if (filter(v)) {
        copy.setNode(v, value);
      }
    });
    Object.values(this._edgeObjs).forEach(function(e) {
      if (copy.hasNode(e.v) && copy.hasNode(e.w)) {
        copy.setEdge(e, self.edge(e));
      }
    });
    var parents = {};
    function findParent(v) {
      var parent = self.parent(v);
      if (parent === void 0 || copy.hasNode(parent)) {
        parents[v] = parent;
        return parent;
      } else if (parent in parents) {
        return parents[parent];
      } else {
        return findParent(parent);
      }
    }
    if (this._isCompound) {
      copy.nodes().forEach((v) => copy.setParent(v, findParent(v)));
    }
    return copy;
  }
  /* === Edge functions ========== */
  /**
   * Sets the default edge label or factory function. This label will be
   * assigned as default label in case if no label was specified while setting
   * an edge or this function will be invoked each time when setting an edge
   * with no label specified and returned value * will be used as a label for edge.
   * Complexity: O(1).
   */
  setDefaultEdgeLabel(newDefault) {
    this._defaultEdgeLabelFn = newDefault;
    if (typeof newDefault !== "function") {
      this._defaultEdgeLabelFn = () => newDefault;
    }
    return this;
  }
  /**
   * Gets the number of edges in the graph.
   * Complexity: O(1).
   */
  edgeCount() {
    return this._edgeCount;
  }
  /**
   * Gets edges of the graph. In case of compound graph subgraphs are not considered.
   * Complexity: O(|E|).
   */
  edges() {
    return Object.values(this._edgeObjs);
  }
  /**
   * Establish an edges path over the nodes in nodes list. If some edge is already
   * exists, it will update its label, otherwise it will create an edge between pair
   * of nodes with label provided or default label if no label provided.
   * Complexity: O(|nodes|).
   */
  setPath(vs, value) {
    var self = this;
    var args = arguments;
    vs.reduce(function(v, w) {
      if (args.length > 1) {
        self.setEdge(v, w, value);
      } else {
        self.setEdge(v, w);
      }
      return w;
    });
    return this;
  }
  /**
   * Creates or updates the label for the edge (v, w) with the optionally supplied
   * name. If label is supplied it is set as the value for the edge. If label is not
   * supplied and the edge was created by this call then the default edge label will
   * be assigned. The name parameter is only useful with multigraphs.
   */
  setEdge() {
    var v, w, name, value;
    var valueSpecified = false;
    var arg0 = arguments[0];
    if (typeof arg0 === "object" && arg0 !== null && "v" in arg0) {
      v = arg0.v;
      w = arg0.w;
      name = arg0.name;
      if (arguments.length === 2) {
        value = arguments[1];
        valueSpecified = true;
      }
    } else {
      v = arg0;
      w = arguments[1];
      name = arguments[3];
      if (arguments.length > 2) {
        value = arguments[2];
        valueSpecified = true;
      }
    }
    v = "" + v;
    w = "" + w;
    if (name !== void 0) {
      name = "" + name;
    }
    var e = edgeArgsToId(this._isDirected, v, w, name);
    if (Object.hasOwn(this._edgeLabels, e)) {
      if (valueSpecified) {
        this._edgeLabels[e] = value;
      }
      return this;
    }
    if (name !== void 0 && !this._isMultigraph) {
      throw new Error("Cannot set a named edge when isMultigraph = false");
    }
    this.setNode(v);
    this.setNode(w);
    this._edgeLabels[e] = valueSpecified ? value : this._defaultEdgeLabelFn(v, w, name);
    var edgeObj = edgeArgsToObj(this._isDirected, v, w, name);
    v = edgeObj.v;
    w = edgeObj.w;
    Object.freeze(edgeObj);
    this._edgeObjs[e] = edgeObj;
    incrementOrInitEntry(this._preds[w], v);
    incrementOrInitEntry(this._sucs[v], w);
    this._in[w][e] = edgeObj;
    this._out[v][e] = edgeObj;
    this._edgeCount++;
    return this;
  }
  /**
   * Gets the label for the specified edge.
   * Complexity: O(1).
   */
  edge(v, w, name) {
    var e = arguments.length === 1 ? edgeObjToId(this._isDirected, arguments[0]) : edgeArgsToId(this._isDirected, v, w, name);
    return this._edgeLabels[e];
  }
  /**
   * Gets the label for the specified edge and converts it to an object.
   * Complexity: O(1)
   */
  edgeAsObj() {
    const edge = this.edge(...arguments);
    if (typeof edge !== "object") {
      return { label: edge };
    }
    return edge;
  }
  /**
   * Detects whether the graph contains specified edge or not. No subgraphs are considered.
   * Complexity: O(1).
   */
  hasEdge(v, w, name) {
    var e = arguments.length === 1 ? edgeObjToId(this._isDirected, arguments[0]) : edgeArgsToId(this._isDirected, v, w, name);
    return Object.hasOwn(this._edgeLabels, e);
  }
  /**
   * Removes the specified edge from the graph. No subgraphs are considered.
   * Complexity: O(1).
   */
  removeEdge(v, w, name) {
    var e = arguments.length === 1 ? edgeObjToId(this._isDirected, arguments[0]) : edgeArgsToId(this._isDirected, v, w, name);
    var edge = this._edgeObjs[e];
    if (edge) {
      v = edge.v;
      w = edge.w;
      delete this._edgeLabels[e];
      delete this._edgeObjs[e];
      decrementOrRemoveEntry(this._preds[w], v);
      decrementOrRemoveEntry(this._sucs[v], w);
      delete this._in[w][e];
      delete this._out[v][e];
      this._edgeCount--;
    }
    return this;
  }
  /**
   * Return all edges that point to the node v. Optionally filters those edges down to just those
   * coming from node u. Behavior is undefined for undirected graphs - use nodeEdges instead.
   * Complexity: O(|E|).
   */
  inEdges(v, u) {
    var inV = this._in[v];
    if (inV) {
      var edges = Object.values(inV);
      if (!u) {
        return edges;
      }
      return edges.filter((edge) => edge.v === u);
    }
  }
  /**
   * Return all edges that are pointed at by node v. Optionally filters those edges down to just
   * those point to w. Behavior is undefined for undirected graphs - use nodeEdges instead.
   * Complexity: O(|E|).
   */
  outEdges(v, w) {
    var outV = this._out[v];
    if (outV) {
      var edges = Object.values(outV);
      if (!w) {
        return edges;
      }
      return edges.filter((edge) => edge.w === w);
    }
  }
  /**
   * Returns all edges to or from node v regardless of direction. Optionally filters those edges
   * down to just those between nodes v and w regardless of direction.
   * Complexity: O(|E|).
   */
  nodeEdges(v, w) {
    var inEdges = this.inEdges(v, w);
    if (inEdges) {
      return inEdges.concat(this.outEdges(v, w));
    }
  }
};
function incrementOrInitEntry(map, k) {
  if (map[k]) {
    map[k]++;
  } else {
    map[k] = 1;
  }
}
function decrementOrRemoveEntry(map, k) {
  if (!--map[k]) {
    delete map[k];
  }
}
function edgeArgsToId(isDirected, v_, w_, name) {
  var v = "" + v_;
  var w = "" + w_;
  if (!isDirected && v > w) {
    var tmp = v;
    v = w;
    w = tmp;
  }
  return v + EDGE_KEY_DELIM + w + EDGE_KEY_DELIM + (name === void 0 ? DEFAULT_EDGE_NAME : name);
}
function edgeArgsToObj(isDirected, v_, w_, name) {
  var v = "" + v_;
  var w = "" + w_;
  if (!isDirected && v > w) {
    var tmp = v;
    v = w;
    w = tmp;
  }
  var edgeObj = { v, w };
  if (name) {
    edgeObj.name = name;
  }
  return edgeObj;
}
function edgeObjToId(isDirected, edgeObj) {
  return edgeArgsToId(isDirected, edgeObj.v, edgeObj.w, edgeObj.name);
}
var graph = Graph$a;
var version$1 = "2.2.4";
var lib$1 = {
  Graph: graph,
  version: version$1
};
var Graph$9 = graph;
var json$1 = {
  write,
  read
};
function write(g) {
  var json2 = {
    options: {
      directed: g.isDirected(),
      multigraph: g.isMultigraph(),
      compound: g.isCompound()
    },
    nodes: writeNodes(g),
    edges: writeEdges(g)
  };
  if (g.graph() !== void 0) {
    json2.value = structuredClone(g.graph());
  }
  return json2;
}
function writeNodes(g) {
  return g.nodes().map(function(v) {
    var nodeValue = g.node(v);
    var parent = g.parent(v);
    var node = { v };
    if (nodeValue !== void 0) {
      node.value = nodeValue;
    }
    if (parent !== void 0) {
      node.parent = parent;
    }
    return node;
  });
}
function writeEdges(g) {
  return g.edges().map(function(e) {
    var edgeValue = g.edge(e);
    var edge = { v: e.v, w: e.w };
    if (e.name !== void 0) {
      edge.name = e.name;
    }
    if (edgeValue !== void 0) {
      edge.value = edgeValue;
    }
    return edge;
  });
}
function read(json2) {
  var g = new Graph$9(json2.options).setGraph(json2.value);
  json2.nodes.forEach(function(entry) {
    g.setNode(entry.v, entry.value);
    if (entry.parent) {
      g.setParent(entry.v, entry.parent);
    }
  });
  json2.edges.forEach(function(entry) {
    g.setEdge({ v: entry.v, w: entry.w, name: entry.name }, entry.value);
  });
  return g;
}
var components_1 = components;
function components(g) {
  var visited = {};
  var cmpts = [];
  var cmpt;
  function dfs2(v) {
    if (Object.hasOwn(visited, v)) return;
    visited[v] = true;
    cmpt.push(v);
    g.successors(v).forEach(dfs2);
    g.predecessors(v).forEach(dfs2);
  }
  g.nodes().forEach(function(v) {
    cmpt = [];
    dfs2(v);
    if (cmpt.length) {
      cmpts.push(cmpt);
    }
  });
  return cmpts;
}
let PriorityQueue$2 = class PriorityQueue {
  _arr = [];
  _keyIndices = {};
  /**
   * Returns the number of elements in the queue. Takes `O(1)` time.
   */
  size() {
    return this._arr.length;
  }
  /**
   * Returns the keys that are in the queue. Takes `O(n)` time.
   */
  keys() {
    return this._arr.map(function(x) {
      return x.key;
    });
  }
  /**
   * Returns `true` if **key** is in the queue and `false` if not.
   */
  has(key) {
    return Object.hasOwn(this._keyIndices, key);
  }
  /**
   * Returns the priority for **key**. If **key** is not present in the queue
   * then this function returns `undefined`. Takes `O(1)` time.
   *
   * @param {Object} key
   */
  priority(key) {
    var index = this._keyIndices[key];
    if (index !== void 0) {
      return this._arr[index].priority;
    }
  }
  /**
   * Returns the key for the minimum element in this queue. If the queue is
   * empty this function throws an Error. Takes `O(1)` time.
   */
  min() {
    if (this.size() === 0) {
      throw new Error("Queue underflow");
    }
    return this._arr[0].key;
  }
  /**
   * Inserts a new key into the priority queue. If the key already exists in
   * the queue this function returns `false`; otherwise it will return `true`.
   * Takes `O(n)` time.
   *
   * @param {Object} key the key to add
   * @param {Number} priority the initial priority for the key
   */
  add(key, priority) {
    var keyIndices = this._keyIndices;
    key = String(key);
    if (!Object.hasOwn(keyIndices, key)) {
      var arr2 = this._arr;
      var index = arr2.length;
      keyIndices[key] = index;
      arr2.push({ key, priority });
      this._decrease(index);
      return true;
    }
    return false;
  }
  /**
   * Removes and returns the smallest key in the queue. Takes `O(log n)` time.
   */
  removeMin() {
    this._swap(0, this._arr.length - 1);
    var min = this._arr.pop();
    delete this._keyIndices[min.key];
    this._heapify(0);
    return min.key;
  }
  /**
   * Decreases the priority for **key** to **priority**. If the new priority is
   * greater than the previous priority, this function will throw an Error.
   *
   * @param {Object} key the key for which to raise priority
   * @param {Number} priority the new priority for the key
   */
  decrease(key, priority) {
    var index = this._keyIndices[key];
    if (priority > this._arr[index].priority) {
      throw new Error("New priority is greater than current priority. Key: " + key + " Old: " + this._arr[index].priority + " New: " + priority);
    }
    this._arr[index].priority = priority;
    this._decrease(index);
  }
  _heapify(i) {
    var arr2 = this._arr;
    var l = 2 * i;
    var r = l + 1;
    var largest = i;
    if (l < arr2.length) {
      largest = arr2[l].priority < arr2[largest].priority ? l : largest;
      if (r < arr2.length) {
        largest = arr2[r].priority < arr2[largest].priority ? r : largest;
      }
      if (largest !== i) {
        this._swap(i, largest);
        this._heapify(largest);
      }
    }
  }
  _decrease(index) {
    var arr2 = this._arr;
    var priority = arr2[index].priority;
    var parent;
    while (index !== 0) {
      parent = index >> 1;
      if (arr2[parent].priority < priority) {
        break;
      }
      this._swap(index, parent);
      index = parent;
    }
  }
  _swap(i, j) {
    var arr2 = this._arr;
    var keyIndices = this._keyIndices;
    var origArrI = arr2[i];
    var origArrJ = arr2[j];
    arr2[i] = origArrJ;
    arr2[j] = origArrI;
    keyIndices[origArrJ.key] = i;
    keyIndices[origArrI.key] = j;
  }
};
var priorityQueue = PriorityQueue$2;
var PriorityQueue$1 = priorityQueue;
var dijkstra_1 = dijkstra$1;
var DEFAULT_WEIGHT_FUNC$1 = () => 1;
function dijkstra$1(g, source, weightFn, edgeFn) {
  return runDijkstra(
    g,
    String(source),
    weightFn || DEFAULT_WEIGHT_FUNC$1,
    edgeFn || function(v) {
      return g.outEdges(v);
    }
  );
}
function runDijkstra(g, source, weightFn, edgeFn) {
  var results = {};
  var pq = new PriorityQueue$1();
  var v, vEntry;
  var updateNeighbors = function(edge) {
    var w = edge.v !== v ? edge.v : edge.w;
    var wEntry = results[w];
    var weight = weightFn(edge);
    var distance = vEntry.distance + weight;
    if (weight < 0) {
      throw new Error("dijkstra does not allow negative edge weights. Bad edge: " + edge + " Weight: " + weight);
    }
    if (distance < wEntry.distance) {
      wEntry.distance = distance;
      wEntry.predecessor = v;
      pq.decrease(w, distance);
    }
  };
  g.nodes().forEach(function(v2) {
    var distance = v2 === source ? 0 : Number.POSITIVE_INFINITY;
    results[v2] = { distance };
    pq.add(v2, distance);
  });
  while (pq.size() > 0) {
    v = pq.removeMin();
    vEntry = results[v];
    if (vEntry.distance === Number.POSITIVE_INFINITY) {
      break;
    }
    edgeFn(v).forEach(updateNeighbors);
  }
  return results;
}
var dijkstra = dijkstra_1;
var dijkstraAll_1 = dijkstraAll;
function dijkstraAll(g, weightFunc, edgeFunc) {
  return g.nodes().reduce(function(acc, v) {
    acc[v] = dijkstra(g, v, weightFunc, edgeFunc);
    return acc;
  }, {});
}
var tarjan_1 = tarjan$1;
function tarjan$1(g) {
  var index = 0;
  var stack = [];
  var visited = {};
  var results = [];
  function dfs2(v) {
    var entry = visited[v] = {
      onStack: true,
      lowlink: index,
      index: index++
    };
    stack.push(v);
    g.successors(v).forEach(function(w2) {
      if (!Object.hasOwn(visited, w2)) {
        dfs2(w2);
        entry.lowlink = Math.min(entry.lowlink, visited[w2].lowlink);
      } else if (visited[w2].onStack) {
        entry.lowlink = Math.min(entry.lowlink, visited[w2].index);
      }
    });
    if (entry.lowlink === entry.index) {
      var cmpt = [];
      var w;
      do {
        w = stack.pop();
        visited[w].onStack = false;
        cmpt.push(w);
      } while (v !== w);
      results.push(cmpt);
    }
  }
  g.nodes().forEach(function(v) {
    if (!Object.hasOwn(visited, v)) {
      dfs2(v);
    }
  });
  return results;
}
var tarjan = tarjan_1;
var findCycles_1 = findCycles;
function findCycles(g) {
  return tarjan(g).filter(function(cmpt) {
    return cmpt.length > 1 || cmpt.length === 1 && g.hasEdge(cmpt[0], cmpt[0]);
  });
}
var floydWarshall_1 = floydWarshall;
var DEFAULT_WEIGHT_FUNC = () => 1;
function floydWarshall(g, weightFn, edgeFn) {
  return runFloydWarshall(
    g,
    weightFn || DEFAULT_WEIGHT_FUNC,
    edgeFn || function(v) {
      return g.outEdges(v);
    }
  );
}
function runFloydWarshall(g, weightFn, edgeFn) {
  var results = {};
  var nodes2 = g.nodes();
  nodes2.forEach(function(v) {
    results[v] = {};
    results[v][v] = { distance: 0 };
    nodes2.forEach(function(w) {
      if (v !== w) {
        results[v][w] = { distance: Number.POSITIVE_INFINITY };
      }
    });
    edgeFn(v).forEach(function(edge) {
      var w = edge.v === v ? edge.w : edge.v;
      var d = weightFn(edge);
      results[v][w] = { distance: d, predecessor: v };
    });
  });
  nodes2.forEach(function(k) {
    var rowK = results[k];
    nodes2.forEach(function(i) {
      var rowI = results[i];
      nodes2.forEach(function(j) {
        var ik = rowI[k];
        var kj = rowK[j];
        var ij = rowI[j];
        var altDistance = ik.distance + kj.distance;
        if (altDistance < ij.distance) {
          ij.distance = altDistance;
          ij.predecessor = kj.predecessor;
        }
      });
    });
  });
  return results;
}
function topsort$1(g) {
  var visited = {};
  var stack = {};
  var results = [];
  function visit(node) {
    if (Object.hasOwn(stack, node)) {
      throw new CycleException();
    }
    if (!Object.hasOwn(visited, node)) {
      stack[node] = true;
      visited[node] = true;
      g.predecessors(node).forEach(visit);
      delete stack[node];
      results.push(node);
    }
  }
  g.sinks().forEach(visit);
  if (Object.keys(visited).length !== g.nodeCount()) {
    throw new CycleException();
  }
  return results;
}
class CycleException extends Error {
  constructor() {
    super(...arguments);
  }
}
var topsort_1 = topsort$1;
topsort$1.CycleException = CycleException;
var topsort = topsort_1;
var isAcyclic_1 = isAcyclic;
function isAcyclic(g) {
  try {
    topsort(g);
  } catch (e) {
    if (e instanceof topsort.CycleException) {
      return false;
    }
    throw e;
  }
  return true;
}
var dfs_1 = dfs$3;
function dfs$3(g, vs, order2) {
  if (!Array.isArray(vs)) {
    vs = [vs];
  }
  var navigation = g.isDirected() ? (v) => g.successors(v) : (v) => g.neighbors(v);
  var orderFunc = order2 === "post" ? postOrderDfs : preOrderDfs;
  var acc = [];
  var visited = {};
  vs.forEach((v) => {
    if (!g.hasNode(v)) {
      throw new Error("Graph does not have node: " + v);
    }
    orderFunc(v, navigation, visited, acc);
  });
  return acc;
}
function postOrderDfs(v, navigation, visited, acc) {
  var stack = [[v, false]];
  while (stack.length > 0) {
    var curr = stack.pop();
    if (curr[1]) {
      acc.push(curr[0]);
    } else {
      if (!Object.hasOwn(visited, curr[0])) {
        visited[curr[0]] = true;
        stack.push([curr[0], true]);
        forEachRight(navigation(curr[0]), (w) => stack.push([w, false]));
      }
    }
  }
}
function preOrderDfs(v, navigation, visited, acc) {
  var stack = [v];
  while (stack.length > 0) {
    var curr = stack.pop();
    if (!Object.hasOwn(visited, curr)) {
      visited[curr] = true;
      acc.push(curr);
      forEachRight(navigation(curr), (w) => stack.push(w));
    }
  }
}
function forEachRight(array, iteratee) {
  var length = array.length;
  while (length--) {
    iteratee(array[length], length, array);
  }
  return array;
}
var dfs$2 = dfs_1;
var postorder_1 = postorder$2;
function postorder$2(g, vs) {
  return dfs$2(g, vs, "post");
}
var dfs$1 = dfs_1;
var preorder_1 = preorder$1;
function preorder$1(g, vs) {
  return dfs$1(g, vs, "pre");
}
var Graph$8 = graph;
var PriorityQueue2 = priorityQueue;
var prim_1 = prim;
function prim(g, weightFunc) {
  var result = new Graph$8();
  var parents = {};
  var pq = new PriorityQueue2();
  var v;
  function updateNeighbors(edge) {
    var w = edge.v === v ? edge.w : edge.v;
    var pri = pq.priority(w);
    if (pri !== void 0) {
      var edgeWeight = weightFunc(edge);
      if (edgeWeight < pri) {
        parents[w] = v;
        pq.decrease(w, edgeWeight);
      }
    }
  }
  if (g.nodeCount() === 0) {
    return result;
  }
  g.nodes().forEach(function(v2) {
    pq.add(v2, Number.POSITIVE_INFINITY);
    result.setNode(v2);
  });
  pq.decrease(g.nodes()[0], 0);
  var init = false;
  while (pq.size() > 0) {
    v = pq.removeMin();
    if (Object.hasOwn(parents, v)) {
      result.setEdge(v, parents[v]);
    } else if (init) {
      throw new Error("Input graph is not connected: " + g);
    } else {
      init = true;
    }
    g.nodeEdges(v).forEach(updateNeighbors);
  }
  return result;
}
var alg = {
  components: components_1,
  dijkstra: dijkstra_1,
  dijkstraAll: dijkstraAll_1,
  findCycles: findCycles_1,
  floydWarshall: floydWarshall_1,
  isAcyclic: isAcyclic_1,
  postorder: postorder_1,
  preorder: preorder_1,
  prim: prim_1,
  tarjan: tarjan_1,
  topsort: topsort_1
};
var lib = lib$1;
var graphlib = {
  Graph: lib.Graph,
  json: json$1,
  alg,
  version: lib.version
};
let List$1 = class List {
  constructor() {
    let sentinel = {};
    sentinel._next = sentinel._prev = sentinel;
    this._sentinel = sentinel;
  }
  dequeue() {
    let sentinel = this._sentinel;
    let entry = sentinel._prev;
    if (entry !== sentinel) {
      unlink(entry);
      return entry;
    }
  }
  enqueue(entry) {
    let sentinel = this._sentinel;
    if (entry._prev && entry._next) {
      unlink(entry);
    }
    entry._next = sentinel._next;
    sentinel._next._prev = entry;
    sentinel._next = entry;
    entry._prev = sentinel;
  }
  toString() {
    let strs = [];
    let sentinel = this._sentinel;
    let curr = sentinel._prev;
    while (curr !== sentinel) {
      strs.push(JSON.stringify(curr, filterOutLinks));
      curr = curr._prev;
    }
    return "[" + strs.join(", ") + "]";
  }
};
function unlink(entry) {
  entry._prev._next = entry._next;
  entry._next._prev = entry._prev;
  delete entry._next;
  delete entry._prev;
}
function filterOutLinks(k, v) {
  if (k !== "_next" && k !== "_prev") {
    return v;
  }
}
var list = List$1;
let Graph$7 = graphlib.Graph;
let List2 = list;
var greedyFas = greedyFAS$1;
let DEFAULT_WEIGHT_FN = () => 1;
function greedyFAS$1(g, weightFn) {
  if (g.nodeCount() <= 1) {
    return [];
  }
  let state = buildState(g, weightFn || DEFAULT_WEIGHT_FN);
  let results = doGreedyFAS(state.graph, state.buckets, state.zeroIdx);
  return results.flatMap((e) => g.outEdges(e.v, e.w));
}
function doGreedyFAS(g, buckets, zeroIdx) {
  let results = [];
  let sources = buckets[buckets.length - 1];
  let sinks = buckets[0];
  let entry;
  while (g.nodeCount()) {
    while (entry = sinks.dequeue()) {
      removeNode(g, buckets, zeroIdx, entry);
    }
    while (entry = sources.dequeue()) {
      removeNode(g, buckets, zeroIdx, entry);
    }
    if (g.nodeCount()) {
      for (let i = buckets.length - 2; i > 0; --i) {
        entry = buckets[i].dequeue();
        if (entry) {
          results = results.concat(removeNode(g, buckets, zeroIdx, entry, true));
          break;
        }
      }
    }
  }
  return results;
}
function removeNode(g, buckets, zeroIdx, entry, collectPredecessors) {
  let results = collectPredecessors ? [] : void 0;
  g.inEdges(entry.v).forEach((edge) => {
    let weight = g.edge(edge);
    let uEntry = g.node(edge.v);
    if (collectPredecessors) {
      results.push({ v: edge.v, w: edge.w });
    }
    uEntry.out -= weight;
    assignBucket(buckets, zeroIdx, uEntry);
  });
  g.outEdges(entry.v).forEach((edge) => {
    let weight = g.edge(edge);
    let w = edge.w;
    let wEntry = g.node(w);
    wEntry["in"] -= weight;
    assignBucket(buckets, zeroIdx, wEntry);
  });
  g.removeNode(entry.v);
  return results;
}
function buildState(g, weightFn) {
  let fasGraph = new Graph$7();
  let maxIn = 0;
  let maxOut = 0;
  g.nodes().forEach((v) => {
    fasGraph.setNode(v, { v, "in": 0, out: 0 });
  });
  g.edges().forEach((e) => {
    let prevWeight = fasGraph.edge(e.v, e.w) || 0;
    let weight = weightFn(e);
    let edgeWeight = prevWeight + weight;
    fasGraph.setEdge(e.v, e.w, edgeWeight);
    maxOut = Math.max(maxOut, fasGraph.node(e.v).out += weight);
    maxIn = Math.max(maxIn, fasGraph.node(e.w)["in"] += weight);
  });
  let buckets = range$1(maxOut + maxIn + 3).map(() => new List2());
  let zeroIdx = maxIn + 1;
  fasGraph.nodes().forEach((v) => {
    assignBucket(buckets, zeroIdx, fasGraph.node(v));
  });
  return { graph: fasGraph, buckets, zeroIdx };
}
function assignBucket(buckets, zeroIdx, entry) {
  if (!entry.out) {
    buckets[0].enqueue(entry);
  } else if (!entry["in"]) {
    buckets[buckets.length - 1].enqueue(entry);
  } else {
    buckets[entry.out - entry["in"] + zeroIdx].enqueue(entry);
  }
}
function range$1(limit) {
  const range2 = [];
  for (let i = 0; i < limit; i++) {
    range2.push(i);
  }
  return range2;
}
let Graph$6 = graphlib.Graph;
var util$d = {
  addBorderNode: addBorderNode$1,
  addDummyNode,
  applyWithChunking: applyWithChunking$1,
  asNonCompoundGraph,
  buildLayerMatrix,
  intersectRect,
  mapValues,
  maxRank,
  normalizeRanks: normalizeRanks$1,
  notime,
  partition,
  pick,
  predecessorWeights,
  range,
  removeEmptyRanks: removeEmptyRanks$1,
  simplify: simplify$1,
  successorWeights,
  time,
  uniqueId: uniqueId$1,
  zipObject: zipObject$1
};
function addDummyNode(g, type, attrs, name) {
  var v = name;
  while (g.hasNode(v)) {
    v = uniqueId$1(name);
  }
  attrs.dummy = type;
  g.setNode(v, attrs);
  return v;
}
function simplify$1(g) {
  let simplified = new Graph$6().setGraph(g.graph());
  g.nodes().forEach((v) => simplified.setNode(v, g.node(v)));
  g.edges().forEach((e) => {
    let simpleLabel = simplified.edge(e.v, e.w) || { weight: 0, minlen: 1 };
    let label = g.edge(e);
    simplified.setEdge(e.v, e.w, {
      weight: simpleLabel.weight + label.weight,
      minlen: Math.max(simpleLabel.minlen, label.minlen)
    });
  });
  return simplified;
}
function asNonCompoundGraph(g) {
  let simplified = new Graph$6({ multigraph: g.isMultigraph() }).setGraph(g.graph());
  g.nodes().forEach((v) => {
    if (!g.children(v).length) {
      simplified.setNode(v, g.node(v));
    }
  });
  g.edges().forEach((e) => {
    simplified.setEdge(e, g.edge(e));
  });
  return simplified;
}
function successorWeights(g) {
  let weightMap = g.nodes().map((v) => {
    let sucs = {};
    g.outEdges(v).forEach((e) => {
      sucs[e.w] = (sucs[e.w] || 0) + g.edge(e).weight;
    });
    return sucs;
  });
  return zipObject$1(g.nodes(), weightMap);
}
function predecessorWeights(g) {
  let weightMap = g.nodes().map((v) => {
    let preds = {};
    g.inEdges(v).forEach((e) => {
      preds[e.v] = (preds[e.v] || 0) + g.edge(e).weight;
    });
    return preds;
  });
  return zipObject$1(g.nodes(), weightMap);
}
function intersectRect(rect, point) {
  let x = rect.x;
  let y = rect.y;
  let dx = point.x - x;
  let dy = point.y - y;
  let w = rect.width / 2;
  let h = rect.height / 2;
  if (!dx && !dy) {
    throw new Error("Not possible to find intersection inside of the rectangle");
  }
  let sx, sy;
  if (Math.abs(dy) * w > Math.abs(dx) * h) {
    if (dy < 0) {
      h = -h;
    }
    sx = h * dx / dy;
    sy = h;
  } else {
    if (dx < 0) {
      w = -w;
    }
    sx = w;
    sy = w * dy / dx;
  }
  return { x: x + sx, y: y + sy };
}
function buildLayerMatrix(g) {
  let layering = range(maxRank(g) + 1).map(() => []);
  g.nodes().forEach((v) => {
    let node = g.node(v);
    let rank2 = node.rank;
    if (rank2 !== void 0) {
      layering[rank2][node.order] = v;
    }
  });
  return layering;
}
function normalizeRanks$1(g) {
  let nodeRanks = g.nodes().map((v) => {
    let rank2 = g.node(v).rank;
    if (rank2 === void 0) {
      return Number.MAX_VALUE;
    }
    return rank2;
  });
  let min = applyWithChunking$1(Math.min, nodeRanks);
  g.nodes().forEach((v) => {
    let node = g.node(v);
    if (Object.hasOwn(node, "rank")) {
      node.rank -= min;
    }
  });
}
function removeEmptyRanks$1(g) {
  let nodeRanks = g.nodes().map((v) => g.node(v).rank);
  let offset = applyWithChunking$1(Math.min, nodeRanks);
  let layers = [];
  g.nodes().forEach((v) => {
    let rank2 = g.node(v).rank - offset;
    if (!layers[rank2]) {
      layers[rank2] = [];
    }
    layers[rank2].push(v);
  });
  let delta = 0;
  let nodeRankFactor = g.graph().nodeRankFactor;
  Array.from(layers).forEach((vs, i) => {
    if (vs === void 0 && i % nodeRankFactor !== 0) {
      --delta;
    } else if (vs !== void 0 && delta) {
      vs.forEach((v) => g.node(v).rank += delta);
    }
  });
}
function addBorderNode$1(g, prefix, rank2, order2) {
  let node = {
    width: 0,
    height: 0
  };
  if (arguments.length >= 4) {
    node.rank = rank2;
    node.order = order2;
  }
  return addDummyNode(g, "border", node, prefix);
}
function splitToChunks(array, chunkSize = CHUNKING_THRESHOLD) {
  const chunks2 = [];
  for (let i = 0; i < array.length; i += chunkSize) {
    const chunk = array.slice(i, i + chunkSize);
    chunks2.push(chunk);
  }
  return chunks2;
}
const CHUNKING_THRESHOLD = 65535;
function applyWithChunking$1(fn, argsArray) {
  if (argsArray.length > CHUNKING_THRESHOLD) {
    const chunks2 = splitToChunks(argsArray);
    return fn.apply(null, chunks2.map((chunk) => fn.apply(null, chunk)));
  } else {
    return fn.apply(null, argsArray);
  }
}
function maxRank(g) {
  const nodes2 = g.nodes();
  const nodeRanks = nodes2.map((v) => {
    let rank2 = g.node(v).rank;
    if (rank2 === void 0) {
      return Number.MIN_VALUE;
    }
    return rank2;
  });
  return applyWithChunking$1(Math.max, nodeRanks);
}
function partition(collection, fn) {
  let result = { lhs: [], rhs: [] };
  collection.forEach((value) => {
    if (fn(value)) {
      result.lhs.push(value);
    } else {
      result.rhs.push(value);
    }
  });
  return result;
}
function time(name, fn) {
  let start2 = Date.now();
  try {
    return fn();
  } finally {
    console.log(name + " time: " + (Date.now() - start2) + "ms");
  }
}
function notime(name, fn) {
  return fn();
}
let idCounter = 0;
function uniqueId$1(prefix) {
  var id = ++idCounter;
  return prefix + ("" + id);
}
function range(start2, limit, step = 1) {
  if (limit == null) {
    limit = start2;
    start2 = 0;
  }
  let endCon = (i) => i < limit;
  if (step < 0) {
    endCon = (i) => limit < i;
  }
  const range2 = [];
  for (let i = start2; endCon(i); i += step) {
    range2.push(i);
  }
  return range2;
}
function pick(source, keys) {
  const dest = {};
  for (const key of keys) {
    if (source[key] !== void 0) {
      dest[key] = source[key];
    }
  }
  return dest;
}
function mapValues(obj2, funcOrProp) {
  let func = funcOrProp;
  if (typeof funcOrProp === "string") {
    func = (val) => val[funcOrProp];
  }
  return Object.entries(obj2).reduce((acc, [k, v]) => {
    acc[k] = func(v, k);
    return acc;
  }, {});
}
function zipObject$1(props, values) {
  return props.reduce((acc, key, i) => {
    acc[key] = values[i];
    return acc;
  }, {});
}
let greedyFAS = greedyFas;
let uniqueId = util$d.uniqueId;
var acyclic$1 = {
  run: run$2,
  undo: undo$2
};
function run$2(g) {
  let fas = g.graph().acyclicer === "greedy" ? greedyFAS(g, weightFn(g)) : dfsFAS(g);
  fas.forEach((e) => {
    let label = g.edge(e);
    g.removeEdge(e);
    label.forwardName = e.name;
    label.reversed = true;
    g.setEdge(e.w, e.v, label, uniqueId("rev"));
  });
  function weightFn(g2) {
    return (e) => {
      return g2.edge(e).weight;
    };
  }
}
function dfsFAS(g) {
  let fas = [];
  let stack = {};
  let visited = {};
  function dfs2(v) {
    if (Object.hasOwn(visited, v)) {
      return;
    }
    visited[v] = true;
    stack[v] = true;
    g.outEdges(v).forEach((e) => {
      if (Object.hasOwn(stack, e.w)) {
        fas.push(e);
      } else {
        dfs2(e.w);
      }
    });
    delete stack[v];
  }
  g.nodes().forEach(dfs2);
  return fas;
}
function undo$2(g) {
  g.edges().forEach((e) => {
    let label = g.edge(e);
    if (label.reversed) {
      g.removeEdge(e);
      let forwardName = label.forwardName;
      delete label.reversed;
      delete label.forwardName;
      g.setEdge(e.w, e.v, label, forwardName);
    }
  });
}
let util$c = util$d;
var normalize$1 = {
  run: run$1,
  undo: undo$1
};
function run$1(g) {
  g.graph().dummyChains = [];
  g.edges().forEach((edge) => normalizeEdge(g, edge));
}
function normalizeEdge(g, e) {
  let v = e.v;
  let vRank = g.node(v).rank;
  let w = e.w;
  let wRank = g.node(w).rank;
  let name = e.name;
  let edgeLabel = g.edge(e);
  let labelRank = edgeLabel.labelRank;
  if (wRank === vRank + 1) return;
  g.removeEdge(e);
  let dummy, attrs, i;
  for (i = 0, ++vRank; vRank < wRank; ++i, ++vRank) {
    edgeLabel.points = [];
    attrs = {
      width: 0,
      height: 0,
      edgeLabel,
      edgeObj: e,
      rank: vRank
    };
    dummy = util$c.addDummyNode(g, "edge", attrs, "_d");
    if (vRank === labelRank) {
      attrs.width = edgeLabel.width;
      attrs.height = edgeLabel.height;
      attrs.dummy = "edge-label";
      attrs.labelpos = edgeLabel.labelpos;
    }
    g.setEdge(v, dummy, { weight: edgeLabel.weight }, name);
    if (i === 0) {
      g.graph().dummyChains.push(dummy);
    }
    v = dummy;
  }
  g.setEdge(v, w, { weight: edgeLabel.weight }, name);
}
function undo$1(g) {
  g.graph().dummyChains.forEach((v) => {
    let node = g.node(v);
    let origLabel = node.edgeLabel;
    let w;
    g.setEdge(node.edgeObj, origLabel);
    while (node.dummy) {
      w = g.successors(v)[0];
      g.removeNode(v);
      origLabel.points.push({ x: node.x, y: node.y });
      if (node.dummy === "edge-label") {
        origLabel.x = node.x;
        origLabel.y = node.y;
        origLabel.width = node.width;
        origLabel.height = node.height;
      }
      v = w;
      node = g.node(v);
    }
  });
}
const { applyWithChunking } = util$d;
var util$b = {
  longestPath: longestPath$1,
  slack: slack$2
};
function longestPath$1(g) {
  var visited = {};
  function dfs2(v) {
    var label = g.node(v);
    if (Object.hasOwn(visited, v)) {
      return label.rank;
    }
    visited[v] = true;
    let outEdgesMinLens = g.outEdges(v).map((e) => {
      if (e == null) {
        return Number.POSITIVE_INFINITY;
      }
      return dfs2(e.w) - g.edge(e).minlen;
    });
    var rank2 = applyWithChunking(Math.min, outEdgesMinLens);
    if (rank2 === Number.POSITIVE_INFINITY) {
      rank2 = 0;
    }
    return label.rank = rank2;
  }
  g.sources().forEach(dfs2);
}
function slack$2(g, e) {
  return g.node(e.w).rank - g.node(e.v).rank - g.edge(e).minlen;
}
var Graph$5 = graphlib.Graph;
var slack$1 = util$b.slack;
var feasibleTree_1 = feasibleTree$2;
function feasibleTree$2(g) {
  var t = new Graph$5({ directed: false });
  var start2 = g.nodes()[0];
  var size = g.nodeCount();
  t.setNode(start2, {});
  var edge, delta;
  while (tightTree(t, g) < size) {
    edge = findMinSlackEdge(t, g);
    delta = t.hasNode(edge.v) ? slack$1(g, edge) : -slack$1(g, edge);
    shiftRanks(t, g, delta);
  }
  return t;
}
function tightTree(t, g) {
  function dfs2(v) {
    g.nodeEdges(v).forEach((e) => {
      var edgeV = e.v, w = v === edgeV ? e.w : edgeV;
      if (!t.hasNode(w) && !slack$1(g, e)) {
        t.setNode(w, {});
        t.setEdge(v, w, {});
        dfs2(w);
      }
    });
  }
  t.nodes().forEach(dfs2);
  return t.nodeCount();
}
function findMinSlackEdge(t, g) {
  const edges = g.edges();
  return edges.reduce((acc, edge) => {
    let edgeSlack = Number.POSITIVE_INFINITY;
    if (t.hasNode(edge.v) !== t.hasNode(edge.w)) {
      edgeSlack = slack$1(g, edge);
    }
    if (edgeSlack < acc[0]) {
      return [edgeSlack, edge];
    }
    return acc;
  }, [Number.POSITIVE_INFINITY, null])[1];
}
function shiftRanks(t, g, delta) {
  t.nodes().forEach((v) => g.node(v).rank += delta);
}
var feasibleTree$1 = feasibleTree_1;
var slack = util$b.slack;
var initRank = util$b.longestPath;
var preorder = graphlib.alg.preorder;
var postorder$1 = graphlib.alg.postorder;
var simplify = util$d.simplify;
var networkSimplex_1 = networkSimplex$1;
networkSimplex$1.initLowLimValues = initLowLimValues;
networkSimplex$1.initCutValues = initCutValues;
networkSimplex$1.calcCutValue = calcCutValue;
networkSimplex$1.leaveEdge = leaveEdge;
networkSimplex$1.enterEdge = enterEdge;
networkSimplex$1.exchangeEdges = exchangeEdges;
function networkSimplex$1(g) {
  g = simplify(g);
  initRank(g);
  var t = feasibleTree$1(g);
  initLowLimValues(t);
  initCutValues(t, g);
  var e, f;
  while (e = leaveEdge(t)) {
    f = enterEdge(t, g, e);
    exchangeEdges(t, g, e, f);
  }
}
function initCutValues(t, g) {
  var vs = postorder$1(t, t.nodes());
  vs = vs.slice(0, vs.length - 1);
  vs.forEach((v) => assignCutValue(t, g, v));
}
function assignCutValue(t, g, child) {
  var childLab = t.node(child);
  var parent = childLab.parent;
  t.edge(child, parent).cutvalue = calcCutValue(t, g, child);
}
function calcCutValue(t, g, child) {
  var childLab = t.node(child);
  var parent = childLab.parent;
  var childIsTail = true;
  var graphEdge = g.edge(child, parent);
  var cutValue = 0;
  if (!graphEdge) {
    childIsTail = false;
    graphEdge = g.edge(parent, child);
  }
  cutValue = graphEdge.weight;
  g.nodeEdges(child).forEach((e) => {
    var isOutEdge = e.v === child, other = isOutEdge ? e.w : e.v;
    if (other !== parent) {
      var pointsToHead = isOutEdge === childIsTail, otherWeight = g.edge(e).weight;
      cutValue += pointsToHead ? otherWeight : -otherWeight;
      if (isTreeEdge(t, child, other)) {
        var otherCutValue = t.edge(child, other).cutvalue;
        cutValue += pointsToHead ? -otherCutValue : otherCutValue;
      }
    }
  });
  return cutValue;
}
function initLowLimValues(tree, root) {
  if (arguments.length < 2) {
    root = tree.nodes()[0];
  }
  dfsAssignLowLim(tree, {}, 1, root);
}
function dfsAssignLowLim(tree, visited, nextLim, v, parent) {
  var low = nextLim;
  var label = tree.node(v);
  visited[v] = true;
  tree.neighbors(v).forEach((w) => {
    if (!Object.hasOwn(visited, w)) {
      nextLim = dfsAssignLowLim(tree, visited, nextLim, w, v);
    }
  });
  label.low = low;
  label.lim = nextLim++;
  if (parent) {
    label.parent = parent;
  } else {
    delete label.parent;
  }
  return nextLim;
}
function leaveEdge(tree) {
  return tree.edges().find((e) => tree.edge(e).cutvalue < 0);
}
function enterEdge(t, g, edge) {
  var v = edge.v;
  var w = edge.w;
  if (!g.hasEdge(v, w)) {
    v = edge.w;
    w = edge.v;
  }
  var vLabel = t.node(v);
  var wLabel = t.node(w);
  var tailLabel = vLabel;
  var flip = false;
  if (vLabel.lim > wLabel.lim) {
    tailLabel = wLabel;
    flip = true;
  }
  var candidates = g.edges().filter((edge2) => {
    return flip === isDescendant(t, t.node(edge2.v), tailLabel) && flip !== isDescendant(t, t.node(edge2.w), tailLabel);
  });
  return candidates.reduce((acc, edge2) => {
    if (slack(g, edge2) < slack(g, acc)) {
      return edge2;
    }
    return acc;
  });
}
function exchangeEdges(t, g, e, f) {
  var v = e.v;
  var w = e.w;
  t.removeEdge(v, w);
  t.setEdge(f.v, f.w, {});
  initLowLimValues(t);
  initCutValues(t, g);
  updateRanks(t, g);
}
function updateRanks(t, g) {
  var root = t.nodes().find((v) => !g.node(v).parent);
  var vs = preorder(t, root);
  vs = vs.slice(1);
  vs.forEach((v) => {
    var parent = t.node(v).parent, edge = g.edge(v, parent), flipped = false;
    if (!edge) {
      edge = g.edge(parent, v);
      flipped = true;
    }
    g.node(v).rank = g.node(parent).rank + (flipped ? edge.minlen : -edge.minlen);
  });
}
function isTreeEdge(tree, u, v) {
  return tree.hasEdge(u, v);
}
function isDescendant(tree, vLabel, rootLabel) {
  return rootLabel.low <= vLabel.lim && vLabel.lim <= rootLabel.lim;
}
var rankUtil = util$b;
var longestPath = rankUtil.longestPath;
var feasibleTree = feasibleTree_1;
var networkSimplex = networkSimplex_1;
var rank_1 = rank$1;
function rank$1(g) {
  var ranker = g.graph().ranker;
  if (ranker instanceof Function) {
    return ranker(g);
  }
  switch (g.graph().ranker) {
    case "network-simplex":
      networkSimplexRanker(g);
      break;
    case "tight-tree":
      tightTreeRanker(g);
      break;
    case "longest-path":
      longestPathRanker(g);
      break;
    case "none":
      break;
    default:
      networkSimplexRanker(g);
  }
}
var longestPathRanker = longestPath;
function tightTreeRanker(g) {
  longestPath(g);
  feasibleTree(g);
}
function networkSimplexRanker(g) {
  networkSimplex(g);
}
var parentDummyChains_1 = parentDummyChains$1;
function parentDummyChains$1(g) {
  let postorderNums = postorder(g);
  g.graph().dummyChains.forEach((v) => {
    let node = g.node(v);
    let edgeObj = node.edgeObj;
    let pathData = findPath(g, postorderNums, edgeObj.v, edgeObj.w);
    let path = pathData.path;
    let lca = pathData.lca;
    let pathIdx = 0;
    let pathV = path[pathIdx];
    let ascending = true;
    while (v !== edgeObj.w) {
      node = g.node(v);
      if (ascending) {
        while ((pathV = path[pathIdx]) !== lca && g.node(pathV).maxRank < node.rank) {
          pathIdx++;
        }
        if (pathV === lca) {
          ascending = false;
        }
      }
      if (!ascending) {
        while (pathIdx < path.length - 1 && g.node(pathV = path[pathIdx + 1]).minRank <= node.rank) {
          pathIdx++;
        }
        pathV = path[pathIdx];
      }
      g.setParent(v, pathV);
      v = g.successors(v)[0];
    }
  });
}
function findPath(g, postorderNums, v, w) {
  let vPath = [];
  let wPath = [];
  let low = Math.min(postorderNums[v].low, postorderNums[w].low);
  let lim = Math.max(postorderNums[v].lim, postorderNums[w].lim);
  let parent;
  let lca;
  parent = v;
  do {
    parent = g.parent(parent);
    vPath.push(parent);
  } while (parent && (postorderNums[parent].low > low || lim > postorderNums[parent].lim));
  lca = parent;
  parent = w;
  while ((parent = g.parent(parent)) !== lca) {
    wPath.push(parent);
  }
  return { path: vPath.concat(wPath.reverse()), lca };
}
function postorder(g) {
  let result = {};
  let lim = 0;
  function dfs2(v) {
    let low = lim;
    g.children(v).forEach(dfs2);
    result[v] = { low, lim: lim++ };
  }
  g.children().forEach(dfs2);
  return result;
}
let util$a = util$d;
var nestingGraph$1 = {
  run,
  cleanup
};
function run(g) {
  let root = util$a.addDummyNode(g, "root", {}, "_root");
  let depths = treeDepths(g);
  let depthsArr = Object.values(depths);
  let height = util$a.applyWithChunking(Math.max, depthsArr) - 1;
  let nodeSep = 2 * height + 1;
  g.graph().nestingRoot = root;
  g.edges().forEach((e) => g.edge(e).minlen *= nodeSep);
  let weight = sumWeights(g) + 1;
  g.children().forEach((child) => dfs(g, root, nodeSep, weight, height, depths, child));
  g.graph().nodeRankFactor = nodeSep;
}
function dfs(g, root, nodeSep, weight, height, depths, v) {
  let children = g.children(v);
  if (!children.length) {
    if (v !== root) {
      g.setEdge(root, v, { weight: 0, minlen: nodeSep });
    }
    return;
  }
  let top = util$a.addBorderNode(g, "_bt");
  let bottom = util$a.addBorderNode(g, "_bb");
  let label = g.node(v);
  g.setParent(top, v);
  label.borderTop = top;
  g.setParent(bottom, v);
  label.borderBottom = bottom;
  children.forEach((child) => {
    dfs(g, root, nodeSep, weight, height, depths, child);
    let childNode = g.node(child);
    let childTop = childNode.borderTop ? childNode.borderTop : child;
    let childBottom = childNode.borderBottom ? childNode.borderBottom : child;
    let thisWeight = childNode.borderTop ? weight : 2 * weight;
    let minlen = childTop !== childBottom ? 1 : height - depths[v] + 1;
    g.setEdge(top, childTop, {
      weight: thisWeight,
      minlen,
      nestingEdge: true
    });
    g.setEdge(childBottom, bottom, {
      weight: thisWeight,
      minlen,
      nestingEdge: true
    });
  });
  if (!g.parent(v)) {
    g.setEdge(root, top, { weight: 0, minlen: height + depths[v] });
  }
}
function treeDepths(g) {
  var depths = {};
  function dfs2(v, depth) {
    var children = g.children(v);
    if (children && children.length) {
      children.forEach((child) => dfs2(child, depth + 1));
    }
    depths[v] = depth;
  }
  g.children().forEach((v) => dfs2(v, 1));
  return depths;
}
function sumWeights(g) {
  return g.edges().reduce((acc, e) => acc + g.edge(e).weight, 0);
}
function cleanup(g) {
  var graphLabel = g.graph();
  g.removeNode(graphLabel.nestingRoot);
  delete graphLabel.nestingRoot;
  g.edges().forEach((e) => {
    var edge = g.edge(e);
    if (edge.nestingEdge) {
      g.removeEdge(e);
    }
  });
}
let util$9 = util$d;
var addBorderSegments_1 = addBorderSegments$1;
function addBorderSegments$1(g) {
  function dfs2(v) {
    let children = g.children(v);
    let node = g.node(v);
    if (children.length) {
      children.forEach(dfs2);
    }
    if (Object.hasOwn(node, "minRank")) {
      node.borderLeft = [];
      node.borderRight = [];
      for (let rank2 = node.minRank, maxRank2 = node.maxRank + 1; rank2 < maxRank2; ++rank2) {
        addBorderNode(g, "borderLeft", "_bl", v, node, rank2);
        addBorderNode(g, "borderRight", "_br", v, node, rank2);
      }
    }
  }
  g.children().forEach(dfs2);
}
function addBorderNode(g, prop, prefix, sg, sgNode, rank2) {
  let label = { width: 0, height: 0, rank: rank2, borderType: prop };
  let prev = sgNode[prop][rank2 - 1];
  let curr = util$9.addDummyNode(g, "border", label, prefix);
  sgNode[prop][rank2] = curr;
  g.setParent(curr, sg);
  if (prev) {
    g.setEdge(prev, curr, { weight: 1 });
  }
}
var coordinateSystem$1 = {
  adjust,
  undo
};
function adjust(g) {
  let rankDir = g.graph().rankdir.toLowerCase();
  if (rankDir === "lr" || rankDir === "rl") {
    swapWidthHeight(g);
  }
}
function undo(g) {
  let rankDir = g.graph().rankdir.toLowerCase();
  if (rankDir === "bt" || rankDir === "rl") {
    reverseY(g);
  }
  if (rankDir === "lr" || rankDir === "rl") {
    swapXY(g);
    swapWidthHeight(g);
  }
}
function swapWidthHeight(g) {
  g.nodes().forEach((v) => swapWidthHeightOne(g.node(v)));
  g.edges().forEach((e) => swapWidthHeightOne(g.edge(e)));
}
function swapWidthHeightOne(attrs) {
  let w = attrs.width;
  attrs.width = attrs.height;
  attrs.height = w;
}
function reverseY(g) {
  g.nodes().forEach((v) => reverseYOne(g.node(v)));
  g.edges().forEach((e) => {
    let edge = g.edge(e);
    edge.points.forEach(reverseYOne);
    if (Object.hasOwn(edge, "y")) {
      reverseYOne(edge);
    }
  });
}
function reverseYOne(attrs) {
  attrs.y = -attrs.y;
}
function swapXY(g) {
  g.nodes().forEach((v) => swapXYOne(g.node(v)));
  g.edges().forEach((e) => {
    let edge = g.edge(e);
    edge.points.forEach(swapXYOne);
    if (Object.hasOwn(edge, "x")) {
      swapXYOne(edge);
    }
  });
}
function swapXYOne(attrs) {
  let x = attrs.x;
  attrs.x = attrs.y;
  attrs.y = x;
}
let util$8 = util$d;
var initOrder_1 = initOrder$1;
function initOrder$1(g) {
  let visited = {};
  let simpleNodes = g.nodes().filter((v) => !g.children(v).length);
  let simpleNodesRanks = simpleNodes.map((v) => g.node(v).rank);
  let maxRank2 = util$8.applyWithChunking(Math.max, simpleNodesRanks);
  let layers = util$8.range(maxRank2 + 1).map(() => []);
  function dfs2(v) {
    if (visited[v]) return;
    visited[v] = true;
    let node = g.node(v);
    layers[node.rank].push(v);
    g.successors(v).forEach(dfs2);
  }
  let orderedVs = simpleNodes.sort((a, b) => g.node(a).rank - g.node(b).rank);
  orderedVs.forEach(dfs2);
  return layers;
}
let zipObject = util$d.zipObject;
var crossCount_1 = crossCount$1;
function crossCount$1(g, layering) {
  let cc = 0;
  for (let i = 1; i < layering.length; ++i) {
    cc += twoLayerCrossCount(g, layering[i - 1], layering[i]);
  }
  return cc;
}
function twoLayerCrossCount(g, northLayer, southLayer) {
  let southPos = zipObject(southLayer, southLayer.map((v, i) => i));
  let southEntries = northLayer.flatMap((v) => {
    return g.outEdges(v).map((e) => {
      return { pos: southPos[e.w], weight: g.edge(e).weight };
    }).sort((a, b) => a.pos - b.pos);
  });
  let firstIndex = 1;
  while (firstIndex < southLayer.length) firstIndex <<= 1;
  let treeSize = 2 * firstIndex - 1;
  firstIndex -= 1;
  let tree = new Array(treeSize).fill(0);
  let cc = 0;
  southEntries.forEach((entry) => {
    let index = entry.pos + firstIndex;
    tree[index] += entry.weight;
    let weightSum = 0;
    while (index > 0) {
      if (index % 2) {
        weightSum += tree[index + 1];
      }
      index = index - 1 >> 1;
      tree[index] += entry.weight;
    }
    cc += entry.weight * weightSum;
  });
  return cc;
}
var barycenter_1 = barycenter$1;
function barycenter$1(g, movable = []) {
  return movable.map((v) => {
    let inV = g.inEdges(v);
    if (!inV.length) {
      return { v };
    } else {
      let result = inV.reduce((acc, e) => {
        let edge = g.edge(e), nodeU = g.node(e.v);
        return {
          sum: acc.sum + edge.weight * nodeU.order,
          weight: acc.weight + edge.weight
        };
      }, { sum: 0, weight: 0 });
      return {
        v,
        barycenter: result.sum / result.weight,
        weight: result.weight
      };
    }
  });
}
let util$7 = util$d;
var resolveConflicts_1 = resolveConflicts$1;
function resolveConflicts$1(entries, cg) {
  let mappedEntries = {};
  entries.forEach((entry, i) => {
    let tmp = mappedEntries[entry.v] = {
      indegree: 0,
      "in": [],
      out: [],
      vs: [entry.v],
      i
    };
    if (entry.barycenter !== void 0) {
      tmp.barycenter = entry.barycenter;
      tmp.weight = entry.weight;
    }
  });
  cg.edges().forEach((e) => {
    let entryV = mappedEntries[e.v];
    let entryW = mappedEntries[e.w];
    if (entryV !== void 0 && entryW !== void 0) {
      entryW.indegree++;
      entryV.out.push(mappedEntries[e.w]);
    }
  });
  let sourceSet = Object.values(mappedEntries).filter((entry) => !entry.indegree);
  return doResolveConflicts(sourceSet);
}
function doResolveConflicts(sourceSet) {
  let entries = [];
  function handleIn(vEntry) {
    return (uEntry) => {
      if (uEntry.merged) {
        return;
      }
      if (uEntry.barycenter === void 0 || vEntry.barycenter === void 0 || uEntry.barycenter >= vEntry.barycenter) {
        mergeEntries(vEntry, uEntry);
      }
    };
  }
  function handleOut(vEntry) {
    return (wEntry) => {
      wEntry["in"].push(vEntry);
      if (--wEntry.indegree === 0) {
        sourceSet.push(wEntry);
      }
    };
  }
  while (sourceSet.length) {
    let entry = sourceSet.pop();
    entries.push(entry);
    entry["in"].reverse().forEach(handleIn(entry));
    entry.out.forEach(handleOut(entry));
  }
  return entries.filter((entry) => !entry.merged).map((entry) => {
    return util$7.pick(entry, ["vs", "i", "barycenter", "weight"]);
  });
}
function mergeEntries(target, source) {
  let sum = 0;
  let weight = 0;
  if (target.weight) {
    sum += target.barycenter * target.weight;
    weight += target.weight;
  }
  if (source.weight) {
    sum += source.barycenter * source.weight;
    weight += source.weight;
  }
  target.vs = source.vs.concat(target.vs);
  target.barycenter = sum / weight;
  target.weight = weight;
  target.i = Math.min(source.i, target.i);
  source.merged = true;
}
let util$6 = util$d;
var sort_1 = sort$1;
function sort$1(entries, biasRight) {
  let parts = util$6.partition(entries, (entry) => {
    return Object.hasOwn(entry, "barycenter");
  });
  let sortable = parts.lhs, unsortable = parts.rhs.sort((a, b) => b.i - a.i), vs = [], sum = 0, weight = 0, vsIndex = 0;
  sortable.sort(compareWithBias(!!biasRight));
  vsIndex = consumeUnsortable(vs, unsortable, vsIndex);
  sortable.forEach((entry) => {
    vsIndex += entry.vs.length;
    vs.push(entry.vs);
    sum += entry.barycenter * entry.weight;
    weight += entry.weight;
    vsIndex = consumeUnsortable(vs, unsortable, vsIndex);
  });
  let result = { vs: vs.flat(true) };
  if (weight) {
    result.barycenter = sum / weight;
    result.weight = weight;
  }
  return result;
}
function consumeUnsortable(vs, unsortable, index) {
  let last;
  while (unsortable.length && (last = unsortable[unsortable.length - 1]).i <= index) {
    unsortable.pop();
    vs.push(last.vs);
    index++;
  }
  return index;
}
function compareWithBias(bias) {
  return (entryV, entryW) => {
    if (entryV.barycenter < entryW.barycenter) {
      return -1;
    } else if (entryV.barycenter > entryW.barycenter) {
      return 1;
    }
    return !bias ? entryV.i - entryW.i : entryW.i - entryV.i;
  };
}
let barycenter = barycenter_1;
let resolveConflicts = resolveConflicts_1;
let sort = sort_1;
var sortSubgraph_1 = sortSubgraph$1;
function sortSubgraph$1(g, v, cg, biasRight) {
  let movable = g.children(v);
  let node = g.node(v);
  let bl = node ? node.borderLeft : void 0;
  let br = node ? node.borderRight : void 0;
  let subgraphs = {};
  if (bl) {
    movable = movable.filter((w) => w !== bl && w !== br);
  }
  let barycenters = barycenter(g, movable);
  barycenters.forEach((entry) => {
    if (g.children(entry.v).length) {
      let subgraphResult = sortSubgraph$1(g, entry.v, cg, biasRight);
      subgraphs[entry.v] = subgraphResult;
      if (Object.hasOwn(subgraphResult, "barycenter")) {
        mergeBarycenters(entry, subgraphResult);
      }
    }
  });
  let entries = resolveConflicts(barycenters, cg);
  expandSubgraphs(entries, subgraphs);
  let result = sort(entries, biasRight);
  if (bl) {
    result.vs = [bl, result.vs, br].flat(true);
    if (g.predecessors(bl).length) {
      let blPred = g.node(g.predecessors(bl)[0]), brPred = g.node(g.predecessors(br)[0]);
      if (!Object.hasOwn(result, "barycenter")) {
        result.barycenter = 0;
        result.weight = 0;
      }
      result.barycenter = (result.barycenter * result.weight + blPred.order + brPred.order) / (result.weight + 2);
      result.weight += 2;
    }
  }
  return result;
}
function expandSubgraphs(entries, subgraphs) {
  entries.forEach((entry) => {
    entry.vs = entry.vs.flatMap((v) => {
      if (subgraphs[v]) {
        return subgraphs[v].vs;
      }
      return v;
    });
  });
}
function mergeBarycenters(target, other) {
  if (target.barycenter !== void 0) {
    target.barycenter = (target.barycenter * target.weight + other.barycenter * other.weight) / (target.weight + other.weight);
    target.weight += other.weight;
  } else {
    target.barycenter = other.barycenter;
    target.weight = other.weight;
  }
}
let Graph$4 = graphlib.Graph;
let util$5 = util$d;
var buildLayerGraph_1 = buildLayerGraph$1;
function buildLayerGraph$1(g, rank2, relationship, nodesWithRank) {
  if (!nodesWithRank) {
    nodesWithRank = g.nodes();
  }
  let root = createRootNode(g), result = new Graph$4({ compound: true }).setGraph({ root }).setDefaultNodeLabel((v) => g.node(v));
  nodesWithRank.forEach((v) => {
    let node = g.node(v), parent = g.parent(v);
    if (node.rank === rank2 || node.minRank <= rank2 && rank2 <= node.maxRank) {
      result.setNode(v);
      result.setParent(v, parent || root);
      g[relationship](v).forEach((e) => {
        let u = e.v === v ? e.w : e.v, edge = result.edge(u, v), weight = edge !== void 0 ? edge.weight : 0;
        result.setEdge(u, v, { weight: g.edge(e).weight + weight });
      });
      if (Object.hasOwn(node, "minRank")) {
        result.setNode(v, {
          borderLeft: node.borderLeft[rank2],
          borderRight: node.borderRight[rank2]
        });
      }
    }
  });
  return result;
}
function createRootNode(g) {
  var v;
  while (g.hasNode(v = util$5.uniqueId("_root"))) ;
  return v;
}
var addSubgraphConstraints_1 = addSubgraphConstraints$1;
function addSubgraphConstraints$1(g, cg, vs) {
  let prev = {}, rootPrev;
  vs.forEach((v) => {
    let child = g.parent(v), parent, prevChild;
    while (child) {
      parent = g.parent(child);
      if (parent) {
        prevChild = prev[parent];
        prev[parent] = child;
      } else {
        prevChild = rootPrev;
        rootPrev = child;
      }
      if (prevChild && prevChild !== child) {
        cg.setEdge(prevChild, child);
        return;
      }
      child = parent;
    }
  });
}
let initOrder = initOrder_1;
let crossCount = crossCount_1;
let sortSubgraph = sortSubgraph_1;
let buildLayerGraph = buildLayerGraph_1;
let addSubgraphConstraints = addSubgraphConstraints_1;
let Graph$3 = graphlib.Graph;
let util$4 = util$d;
var order_1 = order$1;
function order$1(g, opts) {
  if (opts && typeof opts.customOrder === "function") {
    opts.customOrder(g, order$1);
    return;
  }
  let maxRank2 = util$4.maxRank(g), downLayerGraphs = buildLayerGraphs(g, util$4.range(1, maxRank2 + 1), "inEdges"), upLayerGraphs = buildLayerGraphs(g, util$4.range(maxRank2 - 1, -1, -1), "outEdges");
  let layering = initOrder(g);
  assignOrder(g, layering);
  if (opts && opts.disableOptimalOrderHeuristic) {
    return;
  }
  let bestCC = Number.POSITIVE_INFINITY, best;
  for (let i = 0, lastBest = 0; lastBest < 4; ++i, ++lastBest) {
    sweepLayerGraphs(i % 2 ? downLayerGraphs : upLayerGraphs, i % 4 >= 2);
    layering = util$4.buildLayerMatrix(g);
    let cc = crossCount(g, layering);
    if (cc < bestCC) {
      lastBest = 0;
      best = Object.assign({}, layering);
      bestCC = cc;
    }
  }
  assignOrder(g, best);
}
function buildLayerGraphs(g, ranks, relationship) {
  const nodesByRank = /* @__PURE__ */ new Map();
  const addNodeToRank = (rank2, node) => {
    if (!nodesByRank.has(rank2)) {
      nodesByRank.set(rank2, []);
    }
    nodesByRank.get(rank2).push(node);
  };
  for (const v of g.nodes()) {
    const node = g.node(v);
    if (typeof node.rank === "number") {
      addNodeToRank(node.rank, v);
    }
    if (typeof node.minRank === "number" && typeof node.maxRank === "number") {
      for (let r = node.minRank; r <= node.maxRank; r++) {
        if (r !== node.rank) {
          addNodeToRank(r, v);
        }
      }
    }
  }
  return ranks.map(function(rank2) {
    return buildLayerGraph(g, rank2, relationship, nodesByRank.get(rank2) || []);
  });
}
function sweepLayerGraphs(layerGraphs, biasRight) {
  let cg = new Graph$3();
  layerGraphs.forEach(function(lg) {
    let root = lg.graph().root;
    let sorted = sortSubgraph(lg, root, cg, biasRight);
    sorted.vs.forEach((v, i) => lg.node(v).order = i);
    addSubgraphConstraints(lg, cg, sorted.vs);
  });
}
function assignOrder(g, layering) {
  Object.values(layering).forEach((layer) => layer.forEach((v, i) => g.node(v).order = i));
}
let Graph$2 = graphlib.Graph;
let util$3 = util$d;
var bk = {
  positionX: positionX$1
};
function findType1Conflicts(g, layering) {
  let conflicts = {};
  function visitLayer(prevLayer, layer) {
    let k0 = 0, scanPos = 0, prevLayerLength = prevLayer.length, lastNode = layer[layer.length - 1];
    layer.forEach((v, i) => {
      let w = findOtherInnerSegmentNode(g, v), k1 = w ? g.node(w).order : prevLayerLength;
      if (w || v === lastNode) {
        layer.slice(scanPos, i + 1).forEach((scanNode) => {
          g.predecessors(scanNode).forEach((u) => {
            let uLabel = g.node(u), uPos = uLabel.order;
            if ((uPos < k0 || k1 < uPos) && !(uLabel.dummy && g.node(scanNode).dummy)) {
              addConflict(conflicts, u, scanNode);
            }
          });
        });
        scanPos = i + 1;
        k0 = k1;
      }
    });
    return layer;
  }
  layering.length && layering.reduce(visitLayer);
  return conflicts;
}
function findType2Conflicts(g, layering) {
  let conflicts = {};
  function scan2(south, southPos, southEnd, prevNorthBorder, nextNorthBorder) {
    let v;
    util$3.range(southPos, southEnd).forEach((i) => {
      v = south[i];
      if (g.node(v).dummy) {
        g.predecessors(v).forEach((u) => {
          let uNode = g.node(u);
          if (uNode.dummy && (uNode.order < prevNorthBorder || uNode.order > nextNorthBorder)) {
            addConflict(conflicts, u, v);
          }
        });
      }
    });
  }
  function visitLayer(north, south) {
    let prevNorthPos = -1, nextNorthPos, southPos = 0;
    south.forEach((v, southLookahead) => {
      if (g.node(v).dummy === "border") {
        let predecessors = g.predecessors(v);
        if (predecessors.length) {
          nextNorthPos = g.node(predecessors[0]).order;
          scan2(south, southPos, southLookahead, prevNorthPos, nextNorthPos);
          southPos = southLookahead;
          prevNorthPos = nextNorthPos;
        }
      }
      scan2(south, southPos, south.length, nextNorthPos, north.length);
    });
    return south;
  }
  layering.length && layering.reduce(visitLayer);
  return conflicts;
}
function findOtherInnerSegmentNode(g, v) {
  if (g.node(v).dummy) {
    return g.predecessors(v).find((u) => g.node(u).dummy);
  }
}
function addConflict(conflicts, v, w) {
  if (v > w) {
    let tmp = v;
    v = w;
    w = tmp;
  }
  let conflictsV = conflicts[v];
  if (!conflictsV) {
    conflicts[v] = conflictsV = {};
  }
  conflictsV[w] = true;
}
function hasConflict(conflicts, v, w) {
  if (v > w) {
    let tmp = v;
    v = w;
    w = tmp;
  }
  return !!conflicts[v] && Object.hasOwn(conflicts[v], w);
}
function verticalAlignment(g, layering, conflicts, neighborFn) {
  let root = {}, align = {}, pos = {};
  layering.forEach((layer) => {
    layer.forEach((v, order2) => {
      root[v] = v;
      align[v] = v;
      pos[v] = order2;
    });
  });
  layering.forEach((layer) => {
    let prevIdx = -1;
    layer.forEach((v) => {
      let ws = neighborFn(v);
      if (ws.length) {
        ws = ws.sort((a, b) => pos[a] - pos[b]);
        let mp = (ws.length - 1) / 2;
        for (let i = Math.floor(mp), il = Math.ceil(mp); i <= il; ++i) {
          let w = ws[i];
          if (align[v] === v && prevIdx < pos[w] && !hasConflict(conflicts, v, w)) {
            align[w] = v;
            align[v] = root[v] = root[w];
            prevIdx = pos[w];
          }
        }
      }
    });
  });
  return { root, align };
}
function horizontalCompaction(g, layering, root, align, reverseSep) {
  let xs = {}, blockG = buildBlockGraph(g, layering, root, reverseSep), borderType = reverseSep ? "borderLeft" : "borderRight";
  function iterate(setXsFunc, nextNodesFunc) {
    let stack = blockG.nodes();
    let elem = stack.pop();
    let visited = {};
    while (elem) {
      if (visited[elem]) {
        setXsFunc(elem);
      } else {
        visited[elem] = true;
        stack.push(elem);
        stack = stack.concat(nextNodesFunc(elem));
      }
      elem = stack.pop();
    }
  }
  function pass1(elem) {
    xs[elem] = blockG.inEdges(elem).reduce((acc, e) => {
      return Math.max(acc, xs[e.v] + blockG.edge(e));
    }, 0);
  }
  function pass2(elem) {
    let min = blockG.outEdges(elem).reduce((acc, e) => {
      return Math.min(acc, xs[e.w] - blockG.edge(e));
    }, Number.POSITIVE_INFINITY);
    let node = g.node(elem);
    if (min !== Number.POSITIVE_INFINITY && node.borderType !== borderType) {
      xs[elem] = Math.max(xs[elem], min);
    }
  }
  iterate(pass1, blockG.predecessors.bind(blockG));
  iterate(pass2, blockG.successors.bind(blockG));
  Object.keys(align).forEach((v) => xs[v] = xs[root[v]]);
  return xs;
}
function buildBlockGraph(g, layering, root, reverseSep) {
  let blockGraph = new Graph$2(), graphLabel = g.graph(), sepFn = sep(graphLabel.nodesep, graphLabel.edgesep, reverseSep);
  layering.forEach((layer) => {
    let u;
    layer.forEach((v) => {
      let vRoot = root[v];
      blockGraph.setNode(vRoot);
      if (u) {
        var uRoot = root[u], prevMax = blockGraph.edge(uRoot, vRoot);
        blockGraph.setEdge(uRoot, vRoot, Math.max(sepFn(g, v, u), prevMax || 0));
      }
      u = v;
    });
  });
  return blockGraph;
}
function findSmallestWidthAlignment(g, xss) {
  return Object.values(xss).reduce((currentMinAndXs, xs) => {
    let max = Number.NEGATIVE_INFINITY;
    let min = Number.POSITIVE_INFINITY;
    Object.entries(xs).forEach(([v, x]) => {
      let halfWidth = width(g, v) / 2;
      max = Math.max(x + halfWidth, max);
      min = Math.min(x - halfWidth, min);
    });
    const newMin = max - min;
    if (newMin < currentMinAndXs[0]) {
      currentMinAndXs = [newMin, xs];
    }
    return currentMinAndXs;
  }, [Number.POSITIVE_INFINITY, null])[1];
}
function alignCoordinates(xss, alignTo) {
  let alignToVals = Object.values(alignTo), alignToMin = util$3.applyWithChunking(Math.min, alignToVals), alignToMax = util$3.applyWithChunking(Math.max, alignToVals);
  ["u", "d"].forEach((vert) => {
    ["l", "r"].forEach((horiz) => {
      let alignment = vert + horiz, xs = xss[alignment];
      if (xs === alignTo) return;
      let xsVals = Object.values(xs);
      let delta = alignToMin - util$3.applyWithChunking(Math.min, xsVals);
      if (horiz !== "l") {
        delta = alignToMax - util$3.applyWithChunking(Math.max, xsVals);
      }
      if (delta) {
        xss[alignment] = util$3.mapValues(xs, (x) => x + delta);
      }
    });
  });
}
function balance(xss, align) {
  return util$3.mapValues(xss.ul, (num2, v) => {
    if (align) {
      return xss[align.toLowerCase()][v];
    } else {
      let xs = Object.values(xss).map((xs2) => xs2[v]).sort((a, b) => a - b);
      return (xs[1] + xs[2]) / 2;
    }
  });
}
function positionX$1(g) {
  let layering = util$3.buildLayerMatrix(g);
  let conflicts = Object.assign(
    findType1Conflicts(g, layering),
    findType2Conflicts(g, layering)
  );
  let xss = {};
  let adjustedLayering;
  ["u", "d"].forEach((vert) => {
    adjustedLayering = vert === "u" ? layering : Object.values(layering).reverse();
    ["l", "r"].forEach((horiz) => {
      if (horiz === "r") {
        adjustedLayering = adjustedLayering.map((inner) => {
          return Object.values(inner).reverse();
        });
      }
      let neighborFn = (vert === "u" ? g.predecessors : g.successors).bind(g);
      let align = verticalAlignment(g, adjustedLayering, conflicts, neighborFn);
      let xs = horizontalCompaction(
        g,
        adjustedLayering,
        align.root,
        align.align,
        horiz === "r"
      );
      if (horiz === "r") {
        xs = util$3.mapValues(xs, (x) => -x);
      }
      xss[vert + horiz] = xs;
    });
  });
  let smallestWidth = findSmallestWidthAlignment(g, xss);
  alignCoordinates(xss, smallestWidth);
  return balance(xss, g.graph().align);
}
function sep(nodeSep, edgeSep, reverseSep) {
  return (g, v, w) => {
    let vLabel = g.node(v);
    let wLabel = g.node(w);
    let sum = 0;
    let delta;
    sum += vLabel.width / 2;
    if (Object.hasOwn(vLabel, "labelpos")) {
      switch (vLabel.labelpos.toLowerCase()) {
        case "l":
          delta = -vLabel.width / 2;
          break;
        case "r":
          delta = vLabel.width / 2;
          break;
      }
    }
    if (delta) {
      sum += reverseSep ? delta : -delta;
    }
    delta = 0;
    sum += (vLabel.dummy ? edgeSep : nodeSep) / 2;
    sum += (wLabel.dummy ? edgeSep : nodeSep) / 2;
    sum += wLabel.width / 2;
    if (Object.hasOwn(wLabel, "labelpos")) {
      switch (wLabel.labelpos.toLowerCase()) {
        case "l":
          delta = wLabel.width / 2;
          break;
        case "r":
          delta = -wLabel.width / 2;
          break;
      }
    }
    if (delta) {
      sum += reverseSep ? delta : -delta;
    }
    delta = 0;
    return sum;
  };
}
function width(g, v) {
  return g.node(v).width;
}
let util$2 = util$d;
let positionX = bk.positionX;
var position_1 = position$1;
function position$1(g) {
  g = util$2.asNonCompoundGraph(g);
  positionY(g);
  Object.entries(positionX(g)).forEach(([v, x]) => g.node(v).x = x);
}
function positionY(g) {
  let layering = util$2.buildLayerMatrix(g);
  let rankSep = g.graph().ranksep;
  let prevY = 0;
  layering.forEach((layer) => {
    const maxHeight = layer.reduce((acc, v) => {
      const height = g.node(v).height;
      if (acc > height) {
        return acc;
      } else {
        return height;
      }
    }, 0);
    layer.forEach((v) => g.node(v).y = prevY + maxHeight / 2);
    prevY += maxHeight + rankSep;
  });
}
let acyclic = acyclic$1;
let normalize = normalize$1;
let rank = rank_1;
let normalizeRanks = util$d.normalizeRanks;
let parentDummyChains = parentDummyChains_1;
let removeEmptyRanks = util$d.removeEmptyRanks;
let nestingGraph = nestingGraph$1;
let addBorderSegments = addBorderSegments_1;
let coordinateSystem = coordinateSystem$1;
let order = order_1;
let position = position_1;
let util$1 = util$d;
let Graph$1 = graphlib.Graph;
var layout_1 = layout$1;
function layout$1(g, opts) {
  let time2 = opts && opts.debugTiming ? util$1.time : util$1.notime;
  time2("layout", () => {
    let layoutGraph = time2("  buildLayoutGraph", () => buildLayoutGraph(g));
    time2("  runLayout", () => runLayout(layoutGraph, time2, opts));
    time2("  updateInputGraph", () => updateInputGraph(g, layoutGraph));
  });
}
function runLayout(g, time2, opts) {
  time2("    makeSpaceForEdgeLabels", () => makeSpaceForEdgeLabels(g));
  time2("    removeSelfEdges", () => removeSelfEdges(g));
  time2("    acyclic", () => acyclic.run(g));
  time2("    nestingGraph.run", () => nestingGraph.run(g));
  time2("    rank", () => rank(util$1.asNonCompoundGraph(g)));
  time2("    injectEdgeLabelProxies", () => injectEdgeLabelProxies(g));
  time2("    removeEmptyRanks", () => removeEmptyRanks(g));
  time2("    nestingGraph.cleanup", () => nestingGraph.cleanup(g));
  time2("    normalizeRanks", () => normalizeRanks(g));
  time2("    assignRankMinMax", () => assignRankMinMax(g));
  time2("    removeEdgeLabelProxies", () => removeEdgeLabelProxies(g));
  time2("    normalize.run", () => normalize.run(g));
  time2("    parentDummyChains", () => parentDummyChains(g));
  time2("    addBorderSegments", () => addBorderSegments(g));
  time2("    order", () => order(g, opts));
  time2("    insertSelfEdges", () => insertSelfEdges(g));
  time2("    adjustCoordinateSystem", () => coordinateSystem.adjust(g));
  time2("    position", () => position(g));
  time2("    positionSelfEdges", () => positionSelfEdges(g));
  time2("    removeBorderNodes", () => removeBorderNodes(g));
  time2("    normalize.undo", () => normalize.undo(g));
  time2("    fixupEdgeLabelCoords", () => fixupEdgeLabelCoords(g));
  time2("    undoCoordinateSystem", () => coordinateSystem.undo(g));
  time2("    translateGraph", () => translateGraph(g));
  time2("    assignNodeIntersects", () => assignNodeIntersects(g));
  time2("    reversePoints", () => reversePointsForReversedEdges(g));
  time2("    acyclic.undo", () => acyclic.undo(g));
}
function updateInputGraph(inputGraph, layoutGraph) {
  inputGraph.nodes().forEach((v) => {
    let inputLabel = inputGraph.node(v);
    let layoutLabel = layoutGraph.node(v);
    if (inputLabel) {
      inputLabel.x = layoutLabel.x;
      inputLabel.y = layoutLabel.y;
      inputLabel.rank = layoutLabel.rank;
      if (layoutGraph.children(v).length) {
        inputLabel.width = layoutLabel.width;
        inputLabel.height = layoutLabel.height;
      }
    }
  });
  inputGraph.edges().forEach((e) => {
    let inputLabel = inputGraph.edge(e);
    let layoutLabel = layoutGraph.edge(e);
    inputLabel.points = layoutLabel.points;
    if (Object.hasOwn(layoutLabel, "x")) {
      inputLabel.x = layoutLabel.x;
      inputLabel.y = layoutLabel.y;
    }
  });
  inputGraph.graph().width = layoutGraph.graph().width;
  inputGraph.graph().height = layoutGraph.graph().height;
}
let graphNumAttrs = ["nodesep", "edgesep", "ranksep", "marginx", "marginy"];
let graphDefaults = { ranksep: 50, edgesep: 20, nodesep: 50, rankdir: "tb" };
let graphAttrs = ["acyclicer", "ranker", "rankdir", "align"];
let nodeNumAttrs = ["width", "height", "rank"];
let nodeDefaults = { width: 0, height: 0 };
let edgeNumAttrs = ["minlen", "weight", "width", "height", "labeloffset"];
let edgeDefaults = {
  minlen: 1,
  weight: 1,
  width: 0,
  height: 0,
  labeloffset: 10,
  labelpos: "r"
};
let edgeAttrs = ["labelpos"];
function buildLayoutGraph(inputGraph) {
  let g = new Graph$1({ multigraph: true, compound: true });
  let graph2 = canonicalize(inputGraph.graph());
  g.setGraph(Object.assign(
    {},
    graphDefaults,
    selectNumberAttrs(graph2, graphNumAttrs),
    util$1.pick(graph2, graphAttrs)
  ));
  inputGraph.nodes().forEach((v) => {
    let node = canonicalize(inputGraph.node(v));
    const newNode = selectNumberAttrs(node, nodeNumAttrs);
    Object.keys(nodeDefaults).forEach((k) => {
      if (newNode[k] === void 0) {
        newNode[k] = nodeDefaults[k];
      }
    });
    g.setNode(v, newNode);
    g.setParent(v, inputGraph.parent(v));
  });
  inputGraph.edges().forEach((e) => {
    let edge = canonicalize(inputGraph.edge(e));
    g.setEdge(e, Object.assign(
      {},
      edgeDefaults,
      selectNumberAttrs(edge, edgeNumAttrs),
      util$1.pick(edge, edgeAttrs)
    ));
  });
  return g;
}
function makeSpaceForEdgeLabels(g) {
  let graph2 = g.graph();
  graph2.ranksep /= 2;
  g.edges().forEach((e) => {
    let edge = g.edge(e);
    edge.minlen *= 2;
    if (edge.labelpos.toLowerCase() !== "c") {
      if (graph2.rankdir === "TB" || graph2.rankdir === "BT") {
        edge.width += edge.labeloffset;
      } else {
        edge.height += edge.labeloffset;
      }
    }
  });
}
function injectEdgeLabelProxies(g) {
  g.edges().forEach((e) => {
    let edge = g.edge(e);
    if (edge.width && edge.height) {
      let v = g.node(e.v);
      let w = g.node(e.w);
      let label = { rank: (w.rank - v.rank) / 2 + v.rank, e };
      util$1.addDummyNode(g, "edge-proxy", label, "_ep");
    }
  });
}
function assignRankMinMax(g) {
  let maxRank2 = 0;
  g.nodes().forEach((v) => {
    let node = g.node(v);
    if (node.borderTop) {
      node.minRank = g.node(node.borderTop).rank;
      node.maxRank = g.node(node.borderBottom).rank;
      maxRank2 = Math.max(maxRank2, node.maxRank);
    }
  });
  g.graph().maxRank = maxRank2;
}
function removeEdgeLabelProxies(g) {
  g.nodes().forEach((v) => {
    let node = g.node(v);
    if (node.dummy === "edge-proxy") {
      g.edge(node.e).labelRank = node.rank;
      g.removeNode(v);
    }
  });
}
function translateGraph(g) {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = 0;
  let minY = Number.POSITIVE_INFINITY;
  let maxY = 0;
  let graphLabel = g.graph();
  let marginX = graphLabel.marginx || 0;
  let marginY = graphLabel.marginy || 0;
  function getExtremes(attrs) {
    let x = attrs.x;
    let y = attrs.y;
    let w = attrs.width;
    let h = attrs.height;
    minX = Math.min(minX, x - w / 2);
    maxX = Math.max(maxX, x + w / 2);
    minY = Math.min(minY, y - h / 2);
    maxY = Math.max(maxY, y + h / 2);
  }
  g.nodes().forEach((v) => getExtremes(g.node(v)));
  g.edges().forEach((e) => {
    let edge = g.edge(e);
    if (Object.hasOwn(edge, "x")) {
      getExtremes(edge);
    }
  });
  minX -= marginX;
  minY -= marginY;
  g.nodes().forEach((v) => {
    let node = g.node(v);
    node.x -= minX;
    node.y -= minY;
  });
  g.edges().forEach((e) => {
    let edge = g.edge(e);
    edge.points.forEach((p) => {
      p.x -= minX;
      p.y -= minY;
    });
    if (Object.hasOwn(edge, "x")) {
      edge.x -= minX;
    }
    if (Object.hasOwn(edge, "y")) {
      edge.y -= minY;
    }
  });
  graphLabel.width = maxX - minX + marginX;
  graphLabel.height = maxY - minY + marginY;
}
function assignNodeIntersects(g) {
  g.edges().forEach((e) => {
    let edge = g.edge(e);
    let nodeV = g.node(e.v);
    let nodeW = g.node(e.w);
    let p1, p2;
    if (!edge.points) {
      edge.points = [];
      p1 = nodeW;
      p2 = nodeV;
    } else {
      p1 = edge.points[0];
      p2 = edge.points[edge.points.length - 1];
    }
    edge.points.unshift(util$1.intersectRect(nodeV, p1));
    edge.points.push(util$1.intersectRect(nodeW, p2));
  });
}
function fixupEdgeLabelCoords(g) {
  g.edges().forEach((e) => {
    let edge = g.edge(e);
    if (Object.hasOwn(edge, "x")) {
      if (edge.labelpos === "l" || edge.labelpos === "r") {
        edge.width -= edge.labeloffset;
      }
      switch (edge.labelpos) {
        case "l":
          edge.x -= edge.width / 2 + edge.labeloffset;
          break;
        case "r":
          edge.x += edge.width / 2 + edge.labeloffset;
          break;
      }
    }
  });
}
function reversePointsForReversedEdges(g) {
  g.edges().forEach((e) => {
    let edge = g.edge(e);
    if (edge.reversed) {
      edge.points.reverse();
    }
  });
}
function removeBorderNodes(g) {
  g.nodes().forEach((v) => {
    if (g.children(v).length) {
      let node = g.node(v);
      let t = g.node(node.borderTop);
      let b = g.node(node.borderBottom);
      let l = g.node(node.borderLeft[node.borderLeft.length - 1]);
      let r = g.node(node.borderRight[node.borderRight.length - 1]);
      node.width = Math.abs(r.x - l.x);
      node.height = Math.abs(b.y - t.y);
      node.x = l.x + node.width / 2;
      node.y = t.y + node.height / 2;
    }
  });
  g.nodes().forEach((v) => {
    if (g.node(v).dummy === "border") {
      g.removeNode(v);
    }
  });
}
function removeSelfEdges(g) {
  g.edges().forEach((e) => {
    if (e.v === e.w) {
      var node = g.node(e.v);
      if (!node.selfEdges) {
        node.selfEdges = [];
      }
      node.selfEdges.push({ e, label: g.edge(e) });
      g.removeEdge(e);
    }
  });
}
function insertSelfEdges(g) {
  var layers = util$1.buildLayerMatrix(g);
  layers.forEach((layer) => {
    var orderShift = 0;
    layer.forEach((v, i) => {
      var node = g.node(v);
      node.order = i + orderShift;
      (node.selfEdges || []).forEach((selfEdge) => {
        util$1.addDummyNode(g, "selfedge", {
          width: selfEdge.label.width,
          height: selfEdge.label.height,
          rank: node.rank,
          order: i + ++orderShift,
          e: selfEdge.e,
          label: selfEdge.label
        }, "_se");
      });
      delete node.selfEdges;
    });
  });
}
function positionSelfEdges(g) {
  g.nodes().forEach((v) => {
    var node = g.node(v);
    if (node.dummy === "selfedge") {
      var selfNode = g.node(node.e.v);
      var x = selfNode.x + selfNode.width / 2;
      var y = selfNode.y;
      var dx = node.x - x;
      var dy = selfNode.height / 2;
      g.setEdge(node.e, node.label);
      g.removeNode(v);
      node.label.points = [
        { x: x + 2 * dx / 3, y: y - dy },
        { x: x + 5 * dx / 6, y: y - dy },
        { x: x + dx, y },
        { x: x + 5 * dx / 6, y: y + dy },
        { x: x + 2 * dx / 3, y: y + dy }
      ];
      node.label.x = node.x;
      node.label.y = node.y;
    }
  });
}
function selectNumberAttrs(obj2, attrs) {
  return util$1.mapValues(util$1.pick(obj2, attrs), Number);
}
function canonicalize(attrs) {
  var newAttrs = {};
  if (attrs) {
    Object.entries(attrs).forEach(([k, v]) => {
      if (typeof k === "string") {
        k = k.toLowerCase();
      }
      newAttrs[k] = v;
    });
  }
  return newAttrs;
}
let util = util$d;
let Graph2 = graphlib.Graph;
var debug = {
  debugOrdering
};
function debugOrdering(g) {
  let layerMatrix = util.buildLayerMatrix(g);
  let h = new Graph2({ compound: true, multigraph: true }).setGraph({});
  g.nodes().forEach((v) => {
    h.setNode(v, { label: v });
    h.setParent(v, "layer" + g.node(v).rank);
  });
  g.edges().forEach((e) => h.setEdge(e.v, e.w, {}, e.name));
  layerMatrix.forEach((layer, i) => {
    let layerV = "layer" + i;
    h.setNode(layerV, { rank: "same" });
    layer.reduce((u, v) => {
      h.setEdge(u, v, { style: "invis" });
      return v;
    });
  });
  return h;
}
var version = "1.1.8";
var dagre = {
  graphlib,
  layout: layout_1,
  debug,
  util: {
    time: util$d.time,
    notime: util$d.notime
  },
  version
};
const dagre$1 = /* @__PURE__ */ getDefaultExportFromCjs(dagre);
const SIZE = { w: 250, h: 92 };
const sizeOf = (n) => n.kind === "decide" ? { w: 300, h: 112 } : SIZE;
function layout(run2, scope = "root", showOld = false) {
  const visible = run2.order.map((id) => run2.nodes[id]).filter((n) => n.scope === scope && (showOld || n.status !== "superseded"));
  const ids = new Set(visible.map((n) => n.id));
  const edges = [];
  for (const n of visible) {
    const from = n.kind === "unstick" ? [n.data.target] : n.deps;
    for (const d of from) if (ids.has(d)) edges.push({ id: `${d}-${n.id}`, source: d, target: n.id, stuck: n.kind === "unstick" });
  }
  const g = new dagre$1.graphlib.Graph();
  g.setGraph({ rankdir: "LR", nodesep: 28, ranksep: 70, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of visible) g.setNode(n.id, { width: sizeOf(n).w, height: sizeOf(n).h });
  for (const e of edges) g.setEdge(e.source, e.target);
  dagre$1.layout(g);
  const positions = {};
  for (const n of visible) {
    const p = g.node(n.id), s = sizeOf(n);
    positions[n.id] = { x: p.x - s.w / 2, y: p.y - s.h / 2, w: s.w, h: s.h };
  }
  return { visible, edges, positions };
}
const KINDS = [".vtt", ".docx", ".md", ".txt"];
const clock = (s) => s.replace(/\.\d+$/, "").replace(/^00:/, "");
function vtt(text) {
  const turns = [];
  for (const block of text.replace(/\r/g, "").split(/\n\n+/)) {
    const lines = block.split("\n");
    const t = lines.findIndex((l) => l.includes("-->"));
    if (t < 0) continue;
    const at = clock(lines[t].split("-->")[0].trim());
    let body2 = lines.slice(t + 1).join(" ").trim();
    const v = body2.match(/^<v ([^>]+)>/) || body2.match(/^([A-Z][^:<>]{1,40}):\s/);
    const who = v ? person(v[1]) : "";
    body2 = body2.replace(/<\/?v[^>]*>/g, "").replace(v && !body2.startsWith("<v") ? v[0] : /^$/, "").replace(/\s+/g, " ").trim();
    if (!body2) continue;
    const last = turns.at(-1);
    if (last && last.who === who && last.text.length < 1200) last.text += " " + body2;
    else turns.push({ at, who, text: body2 });
  }
  return turns;
}
const person = (s) => /^\s*\[/.test(s) ? s.trim().replace(/^\[|\]$/g, "") : s.trim().split(/[,\s]/)[0].replace(/^([A-Z][a-z]+)[A-Z].*$/, "$1");
function scrub(text, names = {}) {
  const keys = Object.keys(names).sort((a, b) => b.length - a.length);
  const esc = (k) => k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return keys.length ? text.replace(new RegExp(`(?<![\\w\\[])(${keys.map(esc).join("|")})(?![\\w\\]])`, "g"), (m) => `[${names[m]}]`) : text;
}
const TEAMS = /^\s*([A-Z[][^\d]{1,60}?)\s{2,}(\d{1,2}:\d{2}(?::\d{2})?)\s+(.*)$/;
function plain(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  if (lines.filter((l) => TEAMS.test(l)).length > 5) {
    return lines.map((l) => l.match(TEAMS)).filter(Boolean).map(([, who, at, t]) => ({ at, who: person(who), text: t.trim() }));
  }
  return text.replace(/\r/g, "").split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean).map((p) => {
    const m = p.match(/^(\[[^\]]{1,40}\]|[A-Z][\w.'-]*(?: [A-Z][\w.'-]*){0,3}):\s+(.*)$/);
    return m ? { at: "", who: person(m[1]), text: m[2] } : { at: "", who: "", text: p };
  });
}
function docx(path) {
  const r = spawnSync("textutil", ["-convert", "txt", "-stdout", path], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (r.error || r.status !== 0) throw new Error(`Could not read ${basename(path)} (textutil)`);
  return r.stdout;
}
function callDate(path) {
  const m = basename(path).match(/(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : statSync(path).mtime.toISOString().slice(0, 10);
}
function parseFile(path, names) {
  const ext = extname(path).toLowerCase();
  const raw = scrub(ext === ".docx" ? docx(path) : readFileSync(path, "utf8"), names);
  const turns = ext === ".vtt" ? vtt(raw) : plain(raw);
  const text = turns.map((t) => `${t.at ? `[${t.at}] ` : ""}${t.who ? t.who + ": " : ""}${t.text}`).join("\n");
  return {
    file: basename(path),
    title: scrub(basename(path, extname(path)), names).replace(/^\d{4}-\d{2}-\d{2}\s*/, ""),
    date: callDate(path),
    hash: createHash("sha1").update(text).digest("hex").slice(0, 12),
    speakers: [...new Set(turns.map((t) => t.who).filter(Boolean))],
    turns: turns.length,
    text
  };
}
function chunks(text, max = 48e3) {
  if (text.length <= max) return [text];
  const out = [];
  let cur = "";
  for (const line of text.split("\n")) {
    if (cur.length + line.length > max && cur) {
      out.push(cur);
      cur = "";
    }
    cur += line + "\n";
  }
  if (cur.trim()) out.push(cur);
  return out;
}
const str = { type: "string" };
const num = { type: "number" };
const arr = (items) => ({ type: "array", items });
const oneOf = (...values) => ({ type: "string", enum: values });
const obj = (props) => ({ type: "object", properties: props, required: Object.keys(props), additionalProperties: false });
const ITEM_TYPES = ["decision", "open", "assumption", "todo", "idea", "fact", "preference"];
const THREAD_STATUS = ["decided", "unsettled", "open", "assumed", "done"];
const SCHEMAS = {
  extract: obj({
    title: str,
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
      new_branch: str
    }))
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
      question: obj({ q: str, why: str, options: arr(str) })
    }))
  }),
  crosscheck: obj({
    summary: str,
    links: arr(obj({ from: str, to: str, idea: str, action: str, strength: oneOf("strong", "possible") }))
  }),
  ask: obj({ answer: str, cites: arr(str), gaps: arr(str) })
};
const SYSTEM = `You read a business's recorded conversations and turn them into a clean, traceable record.
Rules:
- Each item must stand on its own: someone reading only that item, months later, knows what it is about. Put the missing context in "context" (the verse needs its chapter).
- Never invent. Every item traces to words in the transcript; "quote" is copied exactly (up to 25 words) and "at" is the time shown before it.
- Keep the speaker's meaning. Brainstorms are ideas, not decisions. A decision needs someone with the say agreeing to it.
- Transcription garbles names, numbers and product words. Read them from context and say so in "context" when unsure.
- No names of people. Use the labels the transcript gives (e.g. "Principal 1", "Attorney 2"), in every field including "who" and "quote"; anyone still named is written by role ("an attorney", "the insured"). Companies, products and storms keep their names.
- Leave out personal life (health, family, faith, travel, hobbies, home), even as context.
- Plain words, short sentences.`;
const outline = (tree, depth = 0) => tree.map((n) => `${"  ".repeat(depth)}- ${n.id}: ${n.name}${n.desc ? " — " + n.desc : ""}
${n.children?.length ? outline(n.children, depth + 1) : ""}`).join("");
function extractPrompt({ library, call, part, parts, text, tree, glossary: glossary2 }) {
  return `Business: ${library.name}
${call.note ? `Project note: "${call.title}", updated ${call.date}. It is the written record of work done and decisions made, often off the recorded calls; dated sections give when. Use the section's date in "context", and "" for "at".` : `Conversation: "${call.title}" on ${call.date}${call.speakers.length ? `, speakers: ${call.speakers.join(", ")}` : ""}`}${parts > 1 ? ` (part ${part} of ${parts})` : ""}

The business tree (file each item at the deepest branch that fits; use the id):
${outline(tree)}
${glossary2.length ? `
Words this business uses in more than one sense (keep them apart):
${glossary2.map((g) => `- ${g.term}: ${g.senses.join(" / ")}`).join("\n")}
` : ""}
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
- "title": a short title for the whole conversation, 3 to 8 words, no names (e.g. "Isaias page layout and team section").
- "summary": two or three lines on what this ${parts > 1 ? "part of the " : ""}conversation covered.

Transcript:
${text}`;
}
function linksPrompt({ library, tree, items }) {
  return `Business: ${library.name}

The business tree:
${outline(tree)}
Each item below already has a home branch. List the other branches it clearly also touches, because it is about both, so someone working in that branch should find it too (a fee for website work touches pricing and the website). At most 3, by id; [] when it sits in one place. Not branches you are merely unsure between. Return every item id.

Items (id | home | text | context):
${items.map((i) => `${i.id} | ${i.claudeBranch} | ${i.text} | ${i.context}`).join("\n")}`;
}
function threadsPrompt({ library, path, items, existing }) {
  return `Business: ${library.name}
Branch: ${path}

Group these items into threads: one thread per topic that was talked about, across every call. Keep an existing thread's id when it is the same topic; make a short new id (kebab-case) for a new one.
For each thread:
- "status": decided (someone with the say settled it; "decision" says what and who), unsettled (talked about in different ways and never settled; list each way in "ways"), open (raised, not answered), assumed (treated as true, never confirmed), done (the work is finished).
- "summary": where it stands now, in one or two lines, latest first when calls disagree. Say the date of the latest word on it.
- "items": the item ids it is built from.
- "question": for anything not decided or done, the one question to ask the owner that would settle it, why it matters, and 2 to 4 short options. For decided or done, empty strings and [].
Later calls override earlier ones when they clearly settle or reverse something; say so in the summary. A project note records decisions made off the calls: when it says something was picked, approved or done, that settles it.
${existing.length ? `
Existing threads on this branch:
${existing.map((t) => `- ${t.id} [${t.status}] ${t.title}: ${t.summary}`).join("\n")}
` : ""}
Items (id | date | type | who | text | context; "note" marks the project note):
${items.map((i) => `${i.id} | ${i.date}${i.note ? " note" : ""} | ${i.type} | ${i.who} | ${i.text} | ${i.context}`).join("\n")}`;
}
function crosscheckPrompt({ library, threads }) {
  return `Business: ${library.name}

Below is everything this business has talked through, as threads filed on a tree. Look across branches for places where something worked out in one part of the business applies somewhere else and nobody has connected it yet. Example: a property model built for one client becomes the hook in an email to attorneys.
Only real, useful links. For each: "from" and "to" are thread ids or branch ids, "idea" says how it applies, "action" is the first concrete step, "strength" is strong or possible.

Threads (id | branch | status | title | summary):
${threads.map((t) => `${t.id} | ${t.path} | ${t.status} | ${t.title} | ${t.summary}`).join("\n")}`;
}
function askPrompt({ library, question: question2, items, threads }) {
  return `Business: ${library.name}
Question: ${question2}

Answer from the record below only. Say where each point was said (call and date). Put the item or thread ids you used in "cites". If the record does not settle it, say so and list what is missing in "gaps".

Threads:
${threads.map((t) => `${t.id} [${t.status}] ${t.path}: ${t.title} — ${t.summary}`).join("\n")}

Items (id | date | call | type | who | text | quote):
${items.map((i) => `${i.id} | ${i.date} | ${i.call} | ${i.type} | ${i.who} | ${i.text} | "${i.quote}"`).join("\n")}`;
}
const STATUS = { unsettled: "Talked about, never settled", open: "Open", assumed: "Assumed, never confirmed", decided: "Decided", done: "Done" };
const ORDER = ["unsettled", "open", "assumed", "decided", "done"];
function writeMarkdown(lib2, s, v) {
  const index = /* @__PURE__ */ new Map();
  const walk = (ns, parent) => ns.forEach((n) => {
    index.set(n.id, { ...n, parent });
    walk(n.children || [], n.id);
  });
  walk(s.tree.branches, null);
  const path = (id) => {
    const p = [];
    for (let n = index.get(id); n; n = index.get(n.parent)) p.unshift(n.name);
    return p.join(" › ");
  };
  const src = (id) => {
    const i = s.items[id];
    return i ? `${i.file}${i.at ? " " + i.at : ""}` : id;
  };
  const c = v.counts;
  const out = [
    `# ${lib2.name}: conversation index`,
    "",
    `Built by the Thinking System (Conversations mode). Open the live map: http://localhost:4477/library/${lib2.id}`,
    `Updated ${(/* @__PURE__ */ new Date()).toISOString().slice(0, 16).replace("T", " ")} UTC. ${c.calls} calls, ${c.items} items: ${c.filed} filed, ${c.guessed} best guesses, ${c.links} links between branches. ${c.threads} topics (${c.open} not settled).`,
    `Every item has a home branch and may link to others it also touches. A home counts as filed when you confirmed it, or when the rule that placed it has been right at least ${Math.round(v.target * 100)}% of the time in your spot checks. Data: \`library.json\`, branches: \`tree.json\`.`,
    "",
    "## How sure the filing is",
    "",
    "| Rule | Items | Checked | Right | Files on its own |",
    "|---|---|---|---|---|",
    ...v.rules.map((r) => `| ${r.label} | ${r.items} | ${r.checked} of ${r.need} | ${r.right == null ? "-" : Math.round(r.right * 100) + "%"} | ${r.trusted ? "yes" : "not yet"} |`),
    "",
    "## Needs you",
    "",
    ...v.questions.slice(0, 25).map((q, k) => q.kind === "thread" ? `${k + 1}. **${q.q}** (${STATUS[q.status].toLowerCase()}, ${q.where})${q.ways?.length ? `
   Ways it was talked about: ${q.ways.join(" / ")}` : ""}` : q.kind === "spot" ? `${k + 1}. **Spot check: are these in the right place?** ${q.items.length} items, ${q.left} checks left. Answer in the app.` : q.kind === "tree" ? `${k + 1}. **${q.q}**` : `${k + 1}. **Where does this belong?** "${q.q}" — best guess ${q.guessName} (${q.why}). From ${q.call ? s.calls[q.call]?.file : ""} ${q.at || ""}`),
    v.questions.length > 25 ? `
…and ${v.questions.length - 25} more in the app.` : "",
    ""
  ];
  if (s.crosslinks.length) {
    out.push("## Applies elsewhere (last cross-check)", "", ...s.crosscheckSummary ? [s.crosscheckSummary, ""] : []);
    for (const l of s.crosslinks) out.push(`- **${l.fromName} → ${l.toName}** (${l.strength}): ${l.idea} First step: ${l.action}`);
    out.push("");
  }
  const top = (id) => {
    let n = index.get(id);
    while (n?.parent && index.get(n.parent)?.parent) n = index.get(n.parent);
    return n;
  };
  const pairs = {};
  for (const i of Object.values(s.items)) for (const l of i.links || []) {
    const a = top(i.branch), b = top(l);
    if (!a || !b || a.id === b.id) continue;
    const k = [a.id, b.id].sort().join("|");
    (pairs[k] ||= []).push(i);
  }
  const strong = Object.entries(pairs).sort((x, y) => y[1].length - x[1].length).slice(0, 20);
  if (strong.length) {
    out.push("## How the parts connect", "", "Branch pairs that share the most items (two levels down), with an example of each.", "");
    for (const [k, list2] of strong) {
      const [a, b] = k.split("|");
      out.push(`- **${path(a)}** ↔ **${path(b)}**: ${list2.length} items. e.g. ${list2[0].text}`);
    }
    out.push("");
  }
  out.push("## By branch", "");
  const threads = Object.values(s.threads);
  for (const top2 of s.tree.branches) {
    const here = threads.filter((t) => t.branch === top2.id || t.branch.startsWith(top2.id + "."));
    if (!here.length) continue;
    out.push(`### ${top2.name}`, "");
    for (const st of ORDER) {
      const ts = here.filter((t) => t.status === st).sort((a, b) => (b.last || "").localeCompare(a.last || ""));
      if (!ts.length) continue;
      out.push(`**${STATUS[st]}**`, "");
      for (const t of ts) {
        out.push(`- **${t.title}** — ${path(t.branch)}. ${t.summary}${t.decision ? ` Decision: ${t.decision}${t.answeredBy ? " (answered in the app)" : ""}` : ""}`);
        out.push(`  Sources: ${t.items.slice(0, 6).map(src).join("; ")}${t.items.length > 6 ? `; +${t.items.length - 6} more` : ""}`);
      }
      out.push("");
    }
  }
  out.push("## Calls read", "");
  for (const call of v.calls) out.push(`- ${call.date} ${call.file}: ${call.status === "dup" ? `same as ${call.dupOf}` : call.status === "done" ? `${call.items} items. ${call.summary || ""}` : call.status}`);
  writeFileSync(join(lib2.dir, "INDEX.md"), out.join("\n") + "\n");
}
const bus = new EventEmitter();
bus.setMaxListeners(100);
const TARGET = 0.95;
const MIN_CHECKS = 20, CHECK_EVERY = 50, SPOT = 10;
const CONCURRENCY = 3, LINK_BATCH = 60;
const LIBS = new Map((config.libraries || []).map((l) => [l.id, { ...l, sources: [].concat(l.sources || l.source || []) }]));
const states = /* @__PURE__ */ new Map();
const listLibraries = () => [...LIBS.values()].map((l) => ({ id: l.id, name: l.name, ...counts(load(l.id)) }));
const getLibrary = (id) => LIBS.get(id);
function load(id) {
  if (states.has(id)) return states.get(id);
  const lib2 = LIBS.get(id);
  if (!lib2) return null;
  const read2 = (f, d) => {
    try {
      return JSON.parse(readFileSync(join(lib2.dir, f), "utf8"));
    } catch {
      return d;
    }
  };
  const tree = read2("tree.json", { name: lib2.name, branches: [] });
  const s = {
    calls: {},
    items: {},
    threads: {},
    answers: [],
    corrections: [],
    crosslinks: [],
    snoozed: {},
    scopeSig: {},
    resolvedPairs: {},
    cost: 0,
    seq: 0,
    ...read2("library.json", {}),
    tree,
    job: null,
    version: 0
  };
  states.set(id, s);
  return s;
}
let timers = {};
function save(id, now = false) {
  const s = states.get(id), lib2 = LIBS.get(id);
  s.version++;
  bus.emit("library", id);
  const write2 = () => {
    delete timers[id];
    mkdirSync(lib2.dir, { recursive: true });
    const { tree, job, version: version2, ...rest } = s;
    writeFileSync(join(lib2.dir, "library.json"), JSON.stringify(rest, null, 1));
    writeFileSync(join(lib2.dir, "tree.json"), JSON.stringify(tree, null, 2));
    writeMarkdown(lib2, s, view(id));
  };
  clearTimeout(timers[id]);
  if (now) return write2();
  timers[id] = setTimeout(write2, 800);
}
const flat = (nodes2, parent = null, depth = 0, out = /* @__PURE__ */ new Map()) => {
  for (const n of nodes2) {
    out.set(n.id, { ...n, parent, depth });
    flat(n.children || [], n.id, depth + 1, out);
  }
  return out;
};
const pathOf = (index, id) => {
  const p = [];
  for (let n = index.get(id); n; n = index.get(n.parent)) p.unshift(n);
  return p;
};
const pathName = (index, id) => id === "none" ? "Not this business" : pathOf(index, id).map((n) => n.name).join(" › ") || id;
const within = (index, id, top) => pathOf(index, id).some((n) => n.id === top);
const scopeOf = (index, id) => pathOf(index, id).slice(0, 2).at(-1)?.id || "none";
function counts(s) {
  const items = Object.values(s.items).filter((i) => !i.dup);
  return {
    calls: Object.values(s.calls).filter((c) => !c.dupOf).length,
    newCalls: Object.values(s.calls).filter((c) => !c.dupOf && c.status !== "done").length,
    items: items.length,
    filed: items.filter((i) => i.filed && i.branch !== "none").length,
    guessed: items.filter((i) => i.placed && !i.filed && i.branch !== "none").length,
    links: items.reduce((a, i) => a + (i.links?.length || 0), 0),
    threads: Object.keys(s.threads).length,
    open: Object.values(s.threads).filter((t) => ["unsettled", "open", "assumed"].includes(t.status)).length,
    cost: s.cost
  };
}
const home = (i) => i.branch;
const threadable = (i) => i.placed && !i.dup && i.branch !== "none";
function questions(id) {
  const s = load(id), index = flat(s.tree.branches);
  const rank2 = { unsettled: 0, open: 2, assumed: 3 };
  const fromThreads = Object.values(s.threads).filter((t) => rank2[t.status] !== void 0 && t.question?.q && !s.snoozed["t:" + t.id]).map((t) => ({
    id: "t:" + t.id,
    kind: "thread",
    thread: t.id,
    status: t.status,
    q: t.question.q,
    why: t.question.why,
    options: t.question.options,
    where: pathName(index, t.branch),
    ways: t.ways,
    items: t.items.length,
    weight: t.weight ?? 0.5,
    order: rank2[t.status] - (t.weight ?? 0.5) - Math.min(t.items.length, 10) / 20,
    now: t.status === "unsettled" || (t.weight ?? 0.5) >= 0.8
  }));
  const fromItems = Object.values(s.items).filter((i) => i.rule === "mixed" && i.by !== "owner" && !i.dup && !s.snoozed["i:" + i.id]).map((i) => placeQ(i, index));
  const check = spotCheck(s, index);
  return [...fromThreads, ...check ? [check] : [], ...fromItems, ...confusions(s, index)].sort((a, b) => a.order - b.order);
}
function confusions(s, index) {
  const pairs = {};
  for (const i of Object.values(s.items)) {
    if (i.by === "owner" || !["split", "shared"].includes(i.rule)) continue;
    const g = i.guess, other = i.claudeBranch;
    if (!other || other === "none" || g === "none" || !index.has(other) || !index.has(g) || within(index, g, other) || within(index, other, g)) continue;
    const key = [g, other].sort().join("|");
    (pairs[key] ||= []).push(i);
  }
  return Object.entries(pairs).filter(([k, list2]) => list2.length >= 5 && !s.resolvedPairs[k] && !s.snoozed["b:" + k]).sort((a, b) => b[1].length - a[1].length).slice(0, 8).map(([k, list2]) => {
    const [a, b] = k.split("|").map((x) => ({ id: x, name: pathName(index, x), desc: index.get(x).desc || "" }));
    return {
      id: "b:" + k,
      kind: "tree",
      a,
      b,
      count: list2.length,
      q: `${list2.length} items keep landing between ${a.name.split(" › ").at(-1)} and ${b.name.split(" › ").at(-1)}. Are they the same thing, or how do they differ?`,
      examples: list2.slice(0, 5).map((i) => i.text),
      order: 0.5 - list2.length / 1e3,
      now: true
    };
  });
}
const placeQ = (i, index) => ({
  id: "i:" + i.id,
  kind: "place",
  item: i.id,
  q: i.text,
  context: i.context,
  quote: i.quote,
  call: i.call,
  at: i.at,
  date: i.date,
  guess: i.branch,
  guessName: pathName(index, i.branch),
  conf: i.conf,
  why: reviewWhy(i),
  mixed: i.mixed,
  alts: (i.alts || []).map((a) => ({ ...a, name: pathName(index, a.branch) })),
  newBranch: i.new_branch,
  order: 1.5 + (1 - (i.conf || 0)) * 0.5
});
const reviewWhy = (i) => `Uses a word two ways: ${i.mixed}`;
const RULES = {
  same: "Jev and Claude picked the same branch, Jev 50% sure or more",
  "same-low": "Jev and Claude picked the same branch, Jev under 50% sure",
  nested: "One picked a part of the other's branch: filed at the part",
  shared: "Same area, different parts: filed at the area",
  linked: "Different branches, and Claude says it touches both: home at Claude's, linked to Jev's",
  split: "Jev and Claude disagree: Claude's pick",
  none: "Both say it is not about this business",
  claude: "Claude alone (Jev was not available)"
};
const related = (index, a, b) => a === b || within(index, a, b) || within(index, b, a);
const common = (index, a, b) => {
  const pa = pathOf(index, a).map((n) => n.id);
  return pathOf(index, b).map((n) => n.id).filter((x) => pa.includes(x)).at(-1) || null;
};
function settle(i, index) {
  if (i.by === "owner") return;
  const c = index.has(i.claudeBranch) ? i.claudeBranch : "none";
  const j = i.by === "claude" ? null : index.has(i.guess) ? i.guess : "none";
  const also = (i.also || []).filter((x) => index.has(x));
  const both = j && j !== "none" && c !== "none";
  let rule, branch;
  if (i.mixed) [rule, branch] = ["mixed", c !== "none" ? c : j || "none"];
  else if (!j) [rule, branch] = ["claude", c];
  else if (j === "none" && c === "none") [rule, branch] = ["none", "none"];
  else if (j === c) [rule, branch] = [i.guessConf >= 0.5 ? "same" : "same-low", c];
  else if (both && related(index, j, c)) [rule, branch] = ["nested", index.get(j).depth >= index.get(c).depth ? j : c];
  else if (both && common(index, j, c)) [rule, branch] = ["shared", common(index, j, c)];
  else if (j !== "none" && also.some((a) => related(index, a, j))) [rule, branch] = ["linked", c];
  else [rule, branch] = ["split", c !== "none" ? c : j];
  const links = branch === "none" ? [] : [.../* @__PURE__ */ new Set([...also, ...rule === "linked" ? [j] : []])].filter((x) => !related(index, x, branch));
  Object.assign(i, { rule, branch, links, placed: true });
  delete i.finer;
  delete i.disagree;
}
function ruleStats(s) {
  const st = Object.fromEntries(Object.entries(RULES).map(([rule, label]) => [rule, { rule, label, items: 0, checked: 0, wrong: 0 }]));
  for (const i of Object.values(s.items)) {
    const x = !i.dup && i.placed && st[i.check?.rule || i.rule];
    if (!x) continue;
    x.items++;
    if (i.check) {
      x.checked++;
      if (!i.check.ok) x.wrong++;
    }
  }
  for (const x of Object.values(st)) {
    x.need = Math.max(MIN_CHECKS, Math.ceil(x.items / CHECK_EVERY));
    x.right = x.checked ? (x.checked - x.wrong) / x.checked : null;
    x.trusted = x.checked >= MIN_CHECKS && x.right >= TARGET;
  }
  return st;
}
function applyTrust(s) {
  const st = ruleStats(s);
  for (const i of Object.values(s.items)) {
    if (!i.placed || i.by === "owner") continue;
    i.filed = i.branch !== "none" && !!st[i.rule]?.trusted;
    i.offtopic = i.branch === "none" && !!st.none.trusted;
  }
}
function resettle(s) {
  const index = flat(s.tree.branches);
  for (const i of Object.values(s.items)) if (i.placed) settle(i, index);
  applyTrust(s);
}
const hash = (x) => {
  let h = 2166136261;
  for (const ch of x) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return h >>> 0;
};
function spotCheck(s, index) {
  const st = ruleStats(s);
  const pools = Object.values(st).filter((x) => x.checked < x.need).sort((a, b) => b.items - a.items).map((x) => ({
    x,
    list: Object.values(s.items).filter((i) => i.rule === x.rule && i.by !== "owner" && !i.dup && !s.snoozed["s:" + i.id]).sort((a, b) => hash(a.id) - hash(b.id)).slice(0, x.need - x.checked)
  })).filter((p) => p.list.length);
  if (!pools.length) return null;
  const pick2 = [];
  for (let k = 0; pick2.length < SPOT && pools.some((p) => p.list[k]); k++) for (const p of pools) if (p.list[k] && pick2.length < SPOT) pick2.push(p.list[k]);
  const left = pools.reduce((a, p) => a + p.list.length, 0);
  return {
    id: "spot",
    kind: "spot",
    q: `Are these in the right place? ${left} check${left > 1 ? "s" : ""} left before filing can be trusted on its own.`,
    items: pick2.map((i) => ({ id: i.id, text: i.text, context: i.context, file: i.file, at: i.at, branch: i.branch, where: pathName(index, i.branch), rule: i.rule, links: (i.links || []).map((l) => ({ id: l, name: pathName(index, l) })) })),
    rules: Object.values(st).filter((x) => x.items),
    left,
    order: -5,
    now: true
  };
}
function view(id) {
  const s = load(id), lib2 = LIBS.get(id), index = flat(s.tree.branches);
  const byBranch = {};
  const bump = (bid, key) => {
    for (const p of pathOf(index, bid)) {
      const b = byBranch[p.id] ||= { items: 0, filed: 0, need: 0, now: 0 };
      b[key]++;
    }
  };
  for (const i of Object.values(s.items)) if (i.placed && !i.dup && i.branch !== "none") {
    bump(i.branch, "items");
    if (i.filed) bump(i.branch, "filed");
  }
  const qs = questions(id);
  for (const q of qs) for (const bid of q.kind === "thread" ? [s.threads[q.thread].branch] : q.kind === "tree" ? [q.a.id, q.b.id] : q.kind === "place" ? [q.guess] : []) {
    bump(bid, "need");
    if (q.now) bump(bid, "now");
  }
  return {
    id,
    name: lib2.name,
    dir: lib2.dir,
    sources: lib2.sources,
    target: TARGET,
    jev: JEV_AVAILABLE,
    rules: Object.values(ruleStats(s)).filter((x) => x.items),
    tree: s.tree,
    byBranch,
    counts: counts(s),
    calls: Object.values(s.calls).sort((a, b) => b.date.localeCompare(a.date)),
    items: s.items,
    threads: s.threads,
    crosslinks: s.crosslinks,
    answers: s.answers.slice(-50),
    questions: qs,
    job: s.job,
    version: s.version,
    estimate: estimate(s, id),
    pending: s.corrections.filter((c) => c.at > (s.refreshedAt || "")).length + (s.treeChangedAt > (s.refreshedAt || "") ? 1 : 0)
  };
}
function scan(id) {
  const s = load(id), lib2 = LIBS.get(id);
  const seen = new Map(Object.values(s.calls).filter((c) => !c.dupOf).map((c) => [c.hash, c.file]));
  let added = 0;
  const files = lib2.sources.filter(existsSync).flatMap((src) => statSync(src).isDirectory() ? readdirSync(src).filter((f) => KINDS.includes(extname(f).toLowerCase()) && !f.startsWith(".")).sort().map((f) => [src, f]) : [[dirname(src), basename(src)]]);
  for (const [dir, f] of files) {
    {
      const known = Object.values(s.calls).find((c2) => c2.file === f && c2.dir === dir);
      let c;
      try {
        c = parseFile(join(dir, f), lib2.names);
      } catch (e) {
        if (!known) s.calls["err-" + f] = { id: "err-" + f, file: f, dir, date: "", status: "error", error: e.message };
        continue;
      }
      if (known && known.hash === c.hash) continue;
      if (known) {
        for (const i of Object.values(s.items)) if (i.call === known.id) delete s.items[i.id];
        delete s.calls[known.id];
        seen.delete(known.hash);
      }
      const { text, ...meta2 } = c;
      const dupOf = seen.get(c.hash);
      const callId = dupOf && dupOf !== f ? `${c.hash}~${f}` : c.hash;
      if (s.calls[callId]) continue;
      s.calls[callId] = { id: callId, ...meta2, dir, chars: text.length, note: !meta2.speakers.length && /\.(md|txt)$/i.test(f), status: dupOf && dupOf !== f ? "dup" : "new", dupOf: dupOf && dupOf !== f ? dupOf : null, items: 0 };
      if (!dupOf) {
        seen.set(c.hash, f);
        added++;
      }
    }
  }
  save(id);
  return { added, ...counts(s) };
}
const readModel = (id) => resolveModel(LIBS.get(id).readModel || "claude-haiku-5-5");
const topicModel = (id) => resolveModel(LIBS.get(id).topicModel || "claude-sonnet-5-5");
const READ_PER_K = { "claude-haiku-5-5": 7e-4, "claude-sonnet-5-5": 37e-4, "claude-opus-5-5": 0.0185 };
function estimate(s, id) {
  const calls = Object.values(s.calls).filter((c) => c.status === "new");
  const chars = calls.reduce((a, c) => a + c.chars, 0);
  return { calls: calls.length, usd: Math.round((chars / 1e3 * (READ_PER_K[readModel(id)] ?? 37e-4) + calls.length * 0.05) * 100) / 100 };
}
function processLibrary(id, { model, only } = {}) {
  const s = load(id);
  if (s.job?.running) throw new Error("Already processing");
  model = model ? resolveModel(model) : readModel(id);
  s.job = { running: true, stage: "Reading calls", done: 0, total: 0, started: (/* @__PURE__ */ new Date()).toISOString(), log: [], model };
  save(id);
  pipeline(id, model, only).catch((e) => note(id, `Stopped: ${e.message}`)).finally(() => {
    s.job.running = false;
    s.job.stage = "Done";
    save(id, true);
  });
  return s.job;
}
function stop(id) {
  const s = load(id);
  if (s.job?.running) {
    s.job.stop = true;
    note(id, "Stopping after the calls in flight");
  }
}
function note(id, text) {
  const s = load(id);
  s.job.log.push({ t: (/* @__PURE__ */ new Date()).toISOString(), text });
  if (s.job.log.length > 60) s.job.log.shift();
  save(id);
}
async function pool(list2, n, fn) {
  const queue = [...list2];
  await Promise.all(Array.from({ length: Math.min(n, queue.length) }, async () => {
    while (queue.length) await fn(queue.shift());
  }));
}
async function pipeline(id, model, only) {
  const s = load(id), lib2 = LIBS.get(id);
  const todo = Object.values(s.calls).filter((c) => (c.status === "new" || c.status === "error" && c.hash) && (!only || c.file.includes(only)));
  const parts = todo.flatMap((c) => {
    const text = parseFile(join(c.dir, c.file), lib2.names).text;
    const cs = chunks(text);
    return cs.map((t, i) => ({ call: c, part: i + 1, parts: cs.length, text: t }));
  });
  s.job.total = parts.length;
  s.job.stage = `Reading ${todo.length} call(s)`;
  note(id, `Reading ${todo.length} call(s) in ${parts.length} part(s) with ${model}`);
  const fresh = [];
  const index = () => flat(s.tree.branches);
  const done = /* @__PURE__ */ new Map();
  await pool(parts, CONCURRENCY, async (p) => {
    if (s.job.stop) return;
    try {
      const res = await callModel({
        model,
        system: SYSTEM,
        kind: "extract",
        schema: SCHEMAS.extract,
        prompt: extractPrompt({ library: lib2, call: p.call, part: p.part, parts: p.parts, text: p.text, tree: s.tree.branches, glossary: glossary(s) })
      });
      s.cost += res.cost;
      const idx = index();
      for (const it of res.out.items) {
        const iid = `${p.call.hash.slice(0, 6)}-${++s.seq}`;
        const branch = idx.has(it.branch) ? it.branch : "none";
        s.items[iid] = {
          id: iid,
          call: p.call.id,
          file: p.call.file,
          date: p.call.date,
          part: p.part,
          ...p.call.note ? { note: true } : {},
          ...it,
          also: it.also.filter((x) => idx.has(x) && x !== branch).slice(0, 3),
          claudeBranch: branch,
          claudeConf: it.confidence,
          branch,
          conf: it.confidence,
          placed: false,
          filed: false
        };
        fresh.push(iid);
      }
      if (p.part === 1 && res.out.title && /^[\d\s-]*$/.test(p.call.title)) p.call.title = res.out.title;
      p.call.summary = [p.call.summary, res.out.summary].filter(Boolean).join(" ");
      p.call.items = (p.call.items || 0) + res.out.items.length;
      done.set(p.call.id, (done.get(p.call.id) || 0) + 1);
      if (done.get(p.call.id) === p.parts) p.call.status = "done";
      s.job.done++;
      note(id, `${p.call.title}${p.parts > 1 ? ` (${p.part}/${p.parts})` : ""}: ${res.out.items.length} items`);
    } catch (e) {
      p.call.status = "error";
      p.call.error = String(e.message || e).slice(0, 300);
      s.job.done++;
      note(id, `${p.call.title}: failed (${p.call.error.slice(0, 120)})`);
    }
  });
  for (const c of todo) if (c.status === "error") {
    for (const i of Object.values(s.items)) if (i.call === c.id) delete s.items[i.id];
  }
  await placeItems(id, fresh.filter((i) => s.items[i]));
  await rebuildThreads(id, topicModel(id), changedScopes(s, index()));
  await weighQuestions(id);
  note(id, `Done: ${fresh.length} new items, ${counts(s).filed} filed, ${counts(s).guessed} best guesses, ${counts(s).open} open threads. Spent $${s.cost.toFixed(2)} so far.`);
}
function glossary(s) {
  const senses = {};
  for (const i of Object.values(s.items)) for (const t of i.terms || []) {
    const k = t.term.toLowerCase().trim();
    (senses[k] ||= /* @__PURE__ */ new Set()).add(t.sense.toLowerCase().trim());
  }
  return Object.entries(senses).filter(([, v]) => v.size > 1).slice(0, 40).map(([term, v]) => ({ term, senses: [...v].slice(0, 4) }));
}
const PLACE_BATCH = 20;
async function placeItems(id, ids) {
  const s = load(id);
  if (!ids.length) return;
  s.job.stage = `Filing ${ids.length} item(s)`;
  const index = flat(s.tree.branches);
  if (!JEV_AVAILABLE) {
    for (const iid of ids) {
      Object.assign(s.items[iid], { by: "claude", ctx: ctxKey(s) });
      settle(s.items[iid], index);
    }
    applyTrust(s);
    note(id, "Placed by Claude alone (no Jev key set)");
    return save(id);
  }
  const per = {};
  const examples = s.corrections.slice().reverse().filter((c) => index.has(c.branch) && (per[c.branch] = (per[c.branch] || 0) + 1) <= 2).slice(0, 40).map((c) => `"${c.text}" belongs in ${pathName(index, c.branch)}`);
  let walking = ids.map((iid) => ({ iid, at: null, p: 1, path: [], alts: [] }));
  for (let depth = 0; walking.length && depth < 8; depth++) {
    const groups = {};
    for (const w of walking) (groups[w.at ?? "_root"] ||= []).push(w);
    const next = [];
    for (const [at, ws] of Object.entries(groups)) {
      const node = at === "_root" ? null : index.get(at);
      const kids = node ? node.children || [] : s.tree.branches;
      if (!kids.length) {
        ws.forEach((w) => finish(w));
        continue;
      }
      const criteria = Object.fromEntries(kids.map((k) => [k.id, `${k.name}${k.desc ? ": " + k.desc : ""}`]));
      if (node) criteria.here = `${node.name} in general, not one particular part of it`;
      else criteria.none = "Not about this business (personal, small talk, other ventures)";
      for (let b = 0; b < ws.length; b += PLACE_BATCH) {
        const batch = ws.slice(b, b + PLACE_BATCH);
        const state = {
          business: s.tree.name,
          branch: node ? pathName(index, node.id) : "the whole business",
          items: batch.map((w) => {
            const i = s.items[w.iid];
            return `${i.text} (context: ${i.context})`;
          }),
          ...examples.length ? { past_corrections: examples } : {}
        };
        const questions2 = Object.fromEntries(batch.map((w, k) => [`q${k}`, { type: "choice", instructions: `Where in \`branch\` does \`items[${k}]\` belong?`, criteria }]));
        let r;
        try {
          r = await jevAsk(state, questions2);
        } catch (e) {
          note(id, `Jev failed, Claude's filing stands for ${batch.length} item(s): ${e.message.slice(0, 80)}`);
          batch.forEach((w) => (w.fail = true, finish(w)));
          continue;
        }
        s.cost += r.cost;
        batch.forEach((w, k) => {
          const probs = Object.entries(r.a[`q${k}`].probabilities).sort((a, b2) => b2[1] - a[1]);
          const [best, pb] = probs[0];
          if (probs[1] && probs[1][1] > 0.02) w.alts.push({ branch: probs[1][0] === "here" ? at : probs[1][0], p: w.p * probs[1][1] });
          w.p *= pb;
          if (best === "here" || best === "none") {
            w.at = best === "none" ? "none" : at;
            return finish(w);
          }
          w.at = best;
          w.path.push({ id: best, p: w.p });
          next.push(w);
        });
      }
    }
    walking = next;
  }
  walking.forEach(finish);
  const ctx = ctxKey(s);
  for (const iid of ids) if (s.items[iid]) s.items[iid].ctx = ctx;
  applyTrust(s);
  function finish(w) {
    const i = s.items[w.iid];
    if (w.fail) {
      i.by = "claude";
      return settle(i, index);
    }
    let alts = w.alts.filter((a) => a.branch && a.branch !== "_root").sort((a, b) => b.p - a.p).slice(0, 3);
    const c = i.claudeBranch;
    if (c !== "none" && c !== w.at && !alts.some((a) => a.branch === c)) alts = [...alts, { branch: c, p: i.claudeConf ?? 0, by: "claude" }];
    Object.assign(i, { guess: w.at || "none", guessConf: Math.round(w.p * 1e3) / 1e3, conf: Math.round(w.p * 1e3) / 1e3, alts, by: "jev" });
    settle(i, index);
  }
  save(id);
}
async function linkItems(id, ids, model) {
  const s = load(id), lib2 = LIBS.get(id);
  if (!ids.length) return;
  s.job.stage = `Finding what ${ids.length} item(s) also touch`;
  const batches = [];
  for (let b = 0; b < ids.length; b += LINK_BATCH) batches.push(ids.slice(b, b + LINK_BATCH));
  s.job.total += batches.length;
  await pool(batches, CONCURRENCY, async (batch) => {
    if (s.job.stop) return;
    const index = flat(s.tree.branches);
    try {
      const res = await callModel({ model, system: SYSTEM, kind: "links", schema: SCHEMAS.links, prompt: linksPrompt({ library: lib2, tree: s.tree.branches, items: batch.map((x) => s.items[x]) }) });
      s.cost += res.cost;
      for (const r of res.out.items) {
        const i = s.items[r.id];
        if (i) i.also = r.also.filter((x) => index.has(x) && x !== i.claudeBranch).slice(0, 3);
      }
      for (const x of batch) s.items[x].also ||= [];
    } catch (e) {
      note(id, `Links failed for ${batch.length} item(s): ${String(e.message).slice(0, 100)}`);
    }
    s.job.done++;
  });
  save(id);
}
async function rebuildThreads(id, model, scopes) {
  const s = load(id), lib2 = LIBS.get(id);
  const index = flat(s.tree.branches);
  scopes.delete("none");
  if (!scopes.size) return;
  s.job.stage = `Tying topics together in ${scopes.size} branch(es)`;
  s.job.total += scopes.size;
  await pool([...scopes], CONCURRENCY, async (scope) => {
    if (s.job.stop) return;
    const items = Object.values(s.items).filter((i) => threadable(i) && scopeOf(index, home(i)) === scope).sort((a, b) => a.date.localeCompare(b.date));
    const existing0 = Object.values(s.threads).filter((t) => t.scope === scope);
    if (!items.length) {
      existing0.forEach((t) => delete s.threads[t.id]);
      delete s.scopeSig[scope];
      s.job.done++;
      return;
    }
    const existing = Object.values(s.threads).filter((t) => t.scope === scope);
    try {
      const res = await callModel({ model, system: SYSTEM, kind: "threads", schema: SCHEMAS.threads, prompt: threadsPrompt({ library: lib2, path: pathName(index, scope), items, existing }) });
      s.cost += res.cost;
      const answered = new Map(existing.filter((t) => t.answeredBy).map((t) => [t.id, t]));
      for (const t of existing) delete s.threads[t.id];
      for (const t of res.out.threads) {
        const its = t.items.filter((x) => s.items[x]);
        if (!its.length) continue;
        const tally = {};
        its.forEach((x) => tally[home(s.items[x])] = (tally[home(s.items[x])] || 0) + 1);
        const branch = Object.entries(tally).sort((a, b) => b[1] - a[1])[0][0];
        const prev = answered.get(t.id);
        s.threads[t.id] = {
          ...t,
          items: its,
          scope,
          branch,
          unconfirmed: its.filter((x) => !s.items[x].filed).length,
          first: s.items[its[0]].date,
          last: its.map((x) => s.items[x].date).sort().at(-1),
          ...prev && t.status !== "decided" ? { status: "decided", decision: prev.decision, answeredBy: prev.answeredBy, answeredAt: prev.answeredAt } : {},
          ...prev && t.status === "decided" ? { answeredBy: prev.answeredBy, answeredAt: prev.answeredAt } : {}
        };
      }
      s.scopeSig[scope] = sig(items);
      s.job.done++;
      note(id, `${pathName(index, scope)}: ${res.out.threads.length} thread(s)`);
    } catch (e) {
      s.job.done++;
      note(id, `${pathName(index, scope)}: threads failed (${String(e.message).slice(0, 120)})`);
    }
  });
  save(id);
}
const sig = (items) => items.map((i) => i.id).sort().join(",");
function changedScopes(s, index) {
  const now = {};
  for (const i of Object.values(s.items)) if (threadable(i)) (now[scopeOf(index, home(i))] ||= []).push(i);
  const out = new Set(Object.keys(now).filter((k) => s.scopeSig[k] !== sig(now[k])));
  for (const k of Object.keys(s.scopeSig)) if (!now[k]) out.add(k);
  for (const t of Object.values(s.threads)) if (!now[t.scope]) out.add(t.scope);
  return out;
}
async function weighQuestions(id) {
  const s = load(id);
  if (!JEV_AVAILABLE) return;
  const ts = Object.values(s.threads).filter((t) => ["unsettled", "open", "assumed"].includes(t.status) && t.question?.q && t.weight === void 0);
  for (let b = 0; b < ts.length; b += 25) {
    const batch = ts.slice(b, b + 25);
    const questions2 = Object.fromEntries(batch.map((t, k) => [`w${k}`, { type: "noul", instructions: `Would the owner's answer to \`questions[${k}]\` change what ${s.tree.name} builds, sends, charges or decides next?` }]));
    try {
      const r = await jevAsk({ business: s.tree.name, questions: batch.map((t) => `${t.question.q} (topic: ${t.title}; ${t.summary})`) }, questions2);
      s.cost += r.cost;
      batch.forEach((t, k) => t.weight = r.a[`w${k}`].noul);
    } catch {
      break;
    }
  }
  save(id);
}
function answer(id, { qid, text, branch, newBranch, skip, items }) {
  const s = load(id), index = flat(s.tree.branches);
  const at = (/* @__PURE__ */ new Date()).toISOString();
  if (skip) {
    if (items?.length) for (const x of items) s.snoozed[(qid === "spot" ? "s:" : "i:") + x] = at;
    else s.snoozed[qid] = at;
    save(id);
    return { ok: true };
  }
  if (qid === "spot") return spotAnswer(id, arguments[1].checks || []);
  const [kind, key] = [qid.slice(0, 1), qid.slice(2)];
  if (kind === "b") return sharpen(id, key, arguments[1]);
  if (kind === "t") {
    const t = s.threads[key];
    if (!t) throw new Error("No such thread");
    if (!text?.trim()) throw new Error("Write an answer, or skip");
    Object.assign(t, { status: "decided", decision: text.trim(), answeredBy: "owner", answeredAt: at });
    s.answers.push({ at, thread: key, title: t.title, q: t.question?.q, a: text.trim(), where: pathName(index, t.branch) });
  } else {
    const i = s.items[key];
    if (!i) throw new Error("No such item");
    let target = branch;
    if (newBranch?.name) {
      const parent = index.get(newBranch.parent);
      if (!parent) throw new Error("Pick where the new branch goes");
      const slug = newBranch.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
      target = `${parent.id}.${slug}`;
      const node = findNode(s.tree.branches, parent.id);
      if (!index.has(target)) (node.children ||= []).push({ id: target, name: newBranch.name.trim(), desc: newBranch.desc || "", from: "review", added: at.slice(0, 10) });
      s.treeChangedAt = at;
    }
    if (!target || target !== "none" && !flat(s.tree.branches).has(target)) throw new Error("Pick a branch");
    Object.assign(i, { branch: target, conf: 1, by: "owner", rule: "owner", filed: target !== "none", offtopic: target === "none", links: (i.links || []).filter((l) => l !== target) });
    s.corrections.push({ at, text: i.text, branch: target });
    s.answers.push({ at, item: key, q: i.text, a: pathName(flat(s.tree.branches), target) });
  }
  save(id);
  return { ok: true };
}
function spotAnswer(id, checks) {
  const s = load(id), index = flat(s.tree.branches), at = (/* @__PURE__ */ new Date()).toISOString();
  let right = 0, moved = 0;
  for (const ck of checks) {
    const i = s.items[ck.id];
    const to = ck.ok ? i?.branch : ck.branch;
    if (!i || i.by === "owner" || !to || to !== "none" && !index.has(to)) continue;
    i.check = { at, rule: i.rule, ok: !!ck.ok, was: i.branch };
    Object.assign(i, { branch: to, conf: 1, by: "owner", rule: "owner", filed: to !== "none", offtopic: to === "none", links: (i.links || []).filter((l) => l !== to) });
    s.corrections.push({ at, text: i.text, branch: to });
    ck.ok ? right++ : moved++;
  }
  s.answers.push({ at, q: `Spot check of ${right + moved} filing(s)`, a: `${right} right, ${moved} moved` });
  applyTrust(s);
  save(id);
  return { right, moved, ...counts(s) };
}
function sharpen(id, key, { merge, describe }) {
  const s = load(id), index = flat(s.tree.branches), at = (/* @__PURE__ */ new Date()).toISOString();
  const [a, b] = key.split("|");
  if (merge) {
    const keep = merge, gone = merge === a ? b : a;
    const parentOf = index.get(gone).parent;
    const list2 = parentOf ? findNode(s.tree.branches, parentOf).children : s.tree.branches;
    const node = list2.splice(list2.findIndex((n) => n.id === gone), 1)[0];
    const into = findNode(s.tree.branches, keep);
    (into.children ||= []).push(...node.children || []);
    into.desc = [into.desc, `Includes what was "${node.name}".`].filter(Boolean).join(" ");
    const move = (x) => x === gone ? keep : x;
    for (const i of Object.values(s.items)) {
      i.branch = move(i.branch);
      i.guess = move(i.guess);
      i.claudeBranch = move(i.claudeBranch);
      if (i.also) i.also = [...new Set(i.also.map(move))];
      if (i.links) i.links = [...new Set(i.links.map(move))].filter((l) => l !== i.branch);
      i.alts = (i.alts || []).map((x) => ({ ...x, branch: move(x.branch) }));
    }
    for (const t of Object.values(s.threads)) t.branch = move(t.branch);
    for (const c of s.corrections) c.branch = move(c.branch);
    s.answers.push({ at, q: `Merge ${node.name} into ${into.name}?`, a: "Merged" });
  } else {
    for (const [bid, text] of Object.entries(describe || {})) {
      if (!text?.trim() || ![a, b].includes(bid)) continue;
      const n = findNode(s.tree.branches, bid);
      n.desc = text.trim();
    }
    s.answers.push({ at, q: `How do ${pathName(index, a)} and ${pathName(index, b)} differ?`, a: Object.values(describe || {}).join(" / ") });
  }
  s.resolvedPairs[key] = at;
  s.treeChangedAt = at;
  save(id);
  return { ok: true };
}
const findNode = (nodes2, id) => {
  for (const n of nodes2) {
    if (n.id === id) return n;
    const f = findNode(n.children || [], id);
    if (f) return f;
  }
  return null;
};
const ctxKey = (s) => `${s.treeChangedAt || ""}|${s.corrections.length}`;
const retry = (s) => {
  const index = flat(s.tree.branches), ctx = ctxKey(s);
  return Object.values(s.items).filter((i) => i.by !== "owner" && i.placed && (!i.filed && i.ctx !== ctx || i.branch !== "none" && !index.has(i.branch) || i.guess && i.guess !== "none" && !index.has(i.guess))).map((i) => i.id);
};
async function refile(id) {
  const s = load(id);
  if (s.job?.running) throw new Error("Already processing");
  s.tree = (() => {
    try {
      return JSON.parse(readFileSync(join(LIBS.get(id).dir, "tree.json"), "utf8"));
    } catch {
      return s.tree;
    }
  })();
  const ids = retry(s);
  s.job = { running: true, stage: "Filing again", done: 0, total: 0, started: (/* @__PURE__ */ new Date()).toISOString(), log: [], model: "" };
  try {
    resettle(s);
    await placeItems(id, ids);
    note(id, `Placed ${ids.length} item(s) again: ${counts(s).filed} filed, ${counts(s).guessed} best guesses`);
  } finally {
    s.job.running = false;
    s.job.stage = "Done";
    save(id, true);
  }
  return counts(s);
}
async function refresh(id, { model } = {}) {
  const s = load(id);
  if (s.job?.running) throw new Error("Already processing");
  s.job = { running: true, stage: "Filing again", done: 0, total: 0, started: (/* @__PURE__ */ new Date()).toISOString(), log: [], model: model ? resolveModel(model) : readModel(id) };
  save(id);
  (async () => {
    await linkItems(id, Object.values(s.items).filter((i) => !i.dup && !i.also).map((i) => i.id), s.job.model);
    resettle(s);
    await placeItems(id, retry(s));
    note(id, `Filed again: ${counts(s).filed} filed, ${counts(s).guessed} best guesses, ${counts(s).links} links`);
    await rebuildThreads(id, topicModel(id), changedScopes(s, flat(s.tree.branches)));
    await weighQuestions(id);
    s.refreshedAt = (/* @__PURE__ */ new Date()).toISOString();
  })().catch((e) => note(id, `Stopped: ${e.message}`)).finally(() => {
    s.job.running = false;
    s.job.stage = "Done";
    save(id, true);
  });
  return s.job;
}
function crosscheck(id, { model } = {}) {
  const s = load(id), lib2 = LIBS.get(id), index = flat(s.tree.branches);
  if (s.job?.running) throw new Error("Already processing");
  model = resolveModel(model || "claude-opus-5-5");
  s.job = { running: true, stage: "Cross-checking every branch", done: 0, total: 1, started: (/* @__PURE__ */ new Date()).toISOString(), log: [], model };
  save(id);
  (async () => {
    const threads = Object.values(s.threads).map((t) => ({ ...t, path: pathName(index, t.branch) }));
    const res = await callModel({ model, system: SYSTEM, kind: "crosscheck", schema: SCHEMAS.crosscheck, prompt: crosscheckPrompt({ library: lib2, threads }) });
    s.cost += res.cost;
    const at = (/* @__PURE__ */ new Date()).toISOString();
    s.crosslinks = res.out.links.map((l, k) => ({ ...l, id: `x${Date.now()}-${k}`, at, fromName: s.threads[l.from]?.title || pathName(index, l.from), toName: s.threads[l.to]?.title || pathName(index, l.to) }));
    s.crosscheckSummary = res.out.summary;
    s.job.done = 1;
    note(id, `${s.crosslinks.length} link(s) across branches`);
  })().catch((e) => note(id, `Cross-check failed: ${e.message}`)).finally(() => {
    s.job.running = false;
    s.job.stage = "Done";
    save(id, true);
  });
  return s.job;
}
const words = (q) => q.toLowerCase().split(/[^a-z0-9$%.-]+/).filter((w) => w.length > 2 && !STOP.has(w));
const STOP = new Set("the and for that this with what where when did was were about have has from into our you your are how why who which talk talked said say".split(" "));
function search(id, q) {
  const s = load(id), index = flat(s.tree.branches);
  const ws = words(q);
  if (!ws.length) return { items: [], threads: [], senses: [] };
  const score = (text) => {
    const t = text.toLowerCase();
    return ws.reduce((a, w) => a + (t.includes(w) ? 1 : 0), 0);
  };
  const items = Object.values(s.items).filter((i) => !i.dup).map((i) => ({ i, sc: score(`${i.text} ${i.context} ${i.quote} ${(i.terms || []).map((t) => t.term + " " + t.sense).join(" ")}`) })).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc || b.i.date.localeCompare(a.i.date)).slice(0, 120).map(({ i }) => ({ ...i, where: pathName(index, i.branch) }));
  const threads = Object.values(s.threads).map((t) => ({ t, sc: score(`${t.title} ${t.summary} ${t.decision}`) })).filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc).slice(0, 30).map(({ t }) => ({ ...t, where: pathName(index, t.branch) }));
  const senses = {};
  for (const i of items) for (const t of i.terms || []) if (ws.some((w) => t.term.toLowerCase().includes(w))) (senses[`${t.term.toLowerCase()} — ${t.sense.toLowerCase()}`] ||= []).push(i.id);
  return { items, threads, senses: Object.entries(senses).map(([sense, ids]) => ({ sense, ids })).sort((a, b) => b.ids.length - a.ids.length) };
}
async function ask(id, question2, { model } = {}) {
  const s = load(id), lib2 = LIBS.get(id);
  const found = search(id, question2);
  if (!found.items.length && !found.threads.length) return { answer: "Nothing in the record matches those words yet.", cites: [], gaps: [question2] };
  const res = await callModel({
    model: resolveModel(model || "claude-sonnet-5-5"),
    system: SYSTEM,
    kind: "ask",
    schema: SCHEMAS.ask,
    prompt: askPrompt({ library: lib2, question: question2, items: found.items.slice(0, 80).map((i) => ({ ...i, call: i.file })), threads: found.threads.map((t) => ({ ...t, path: t.where })) })
  });
  s.cost += res.cost;
  save(id);
  return res.out;
}
const PORT = Number(process.env.THINK_PORT || 4477);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIST = join(ROOT, "dist");
const VERSION = JSON.parse(readFileSync(join(ROOT, ".claude-plugin/plugin.json"), "utf8")).version;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const json = (res, code, body2) => {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body2));
};
const body = (req) => new Promise((resolve, reject) => {
  let s = "";
  req.on("data", (d) => s += d);
  req.on("end", () => {
    try {
      resolve(s ? JSON.parse(s) : {});
    } catch (e) {
      reject(e);
    }
  });
});
const ACTIONS = { answer: answer$1, rerun, correct, stuck, deeper, pick: pick$1, resume, settle: settle$1 };
function librarySse(req, res, id) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  let timer = null;
  const send = () => {
    timer = null;
    const s = load(id);
    res.write(`data: ${JSON.stringify({ version: s.version, job: s.job })}

`);
  };
  const on = (lid) => {
    if (lid === id && !timer) timer = setTimeout(send, 400);
  };
  send();
  bus.on("library", on);
  const ping = setInterval(() => res.write(": ping\n\n"), 2e4);
  req.on("close", () => {
    bus.off("library", on);
    clearInterval(ping);
    clearTimeout(timer);
  });
}
const LIBRARY_ACTIONS = {
  scan: (id) => scan(id),
  process: (id, b) => processLibrary(id, b),
  refresh: (id, b) => refresh(id, b),
  crosscheck: (id, b) => crosscheck(id, b),
  stop: (id) => stop(id),
  refile: (id) => refile(id),
  answer: (id, b) => answer(id, b),
  ask: (id, b) => ask(id, b.question, b)
};
function sse(req, res, run2) {
  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  let timer = null;
  const send = () => {
    timer = null;
    res.write(`data: ${JSON.stringify(run2)}

`);
  };
  const onRun = (r) => {
    if (r.id === run2.id && !timer) timer = setTimeout(send, 120);
  };
  send();
  bus$1.on("run", onRun);
  const ping = setInterval(() => res.write(": ping\n\n"), 2e4);
  req.on("close", () => {
    bus$1.off("run", onRun);
    clearInterval(ping);
    clearTimeout(timer);
  });
}
createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  const parts = url.pathname.split("/").filter(Boolean);
  try {
    if (parts[0] === "api") {
      const [, what, id, action] = parts;
      if (what === "health") return json(res, 200, { ok: true, app: "thinking-system", version: VERSION, runsDir: RUNS_DIR });
      if (what === "shutdown" && req.method === "POST") {
        json(res, 200, { ok: true });
        return setTimeout(() => process.exit(0), 50);
      }
      if (what === "meta") return json(res, 200, { models: MODELS, jev: JEV_AVAILABLE, methods: METHODS.map(({ id: id2, name, when }) => ({ id: id2, name, when })) });
      if (what === "rules" && req.method === "GET") return json(res, 200, { file: RULES_FILE, rules: readRules() });
      if (what === "rules" && req.method === "POST") {
        const b = await body(req);
        if (!b.text?.trim()) return json(res, 400, { error: "Empty rule" });
        addRule(b.text, b.from || "manual");
        return json(res, 200, { ok: true, file: RULES_FILE });
      }
      if (what === "libraries") return json(res, 200, listLibraries());
      if (what === "library") {
        if (!getLibrary(id)) return json(res, 404, { error: 'No such library. Add it under "libraries" in ~/.thinking-system/config.json' });
        if (!action) return json(res, 200, view(id));
        if (action === "events") return librarySse(req, res, id);
        if (action === "search") return json(res, 200, search(id, url.searchParams.get("q") || ""));
        if (LIBRARY_ACTIONS[action] && req.method === "POST") return json(res, 200, { ok: true, result: await LIBRARY_ACTIONS[action](id, await body(req)) });
        return json(res, 404, { error: "Unknown endpoint" });
      }
      if (what === "runs" && !id && req.method === "GET") return json(res, 200, listRuns());
      if (what === "runs" && !id && req.method === "POST") {
        const b = await body(req);
        if (!b.input?.trim()) return json(res, 400, { error: "Write a thought first" });
        const run3 = createRun(b);
        return json(res, 200, { id: run3.id, dir: join(RUNS_DIR, run3.id) });
      }
      const run2 = getRun(id);
      if (!run2) return json(res, 404, { error: "No such run" });
      if (!action) return json(res, 200, run2);
      if (action === "events") return sse(req, res, run2);
      if (action === "excalidraw") {
        const scope = url.searchParams.get("scope") || "root";
        const file2 = JSON.stringify(toExcalidraw(run2, layout(run2, scope).positions), null, 2);
        writeRunFile(run2, `flow-${scope}.excalidraw`, file2);
        res.writeHead(200, { "content-type": "application/json", "content-disposition": `attachment; filename="${run2.id}-${scope}.excalidraw"` });
        return res.end(file2);
      }
      if (ACTIONS[action] && req.method === "POST") {
        const r = await ACTIONS[action](run2, await body(req));
        return json(res, 200, { ok: true, ...r?.unclear ? { unclear: r.unclear } : {} });
      }
      return json(res, 404, { error: "Unknown endpoint" });
    }
    let file = join(DIST, url.pathname);
    if (!file.startsWith(DIST) || !existsSync(file) || !extname(file)) file = join(DIST, "index.html");
    if (!existsSync(file)) {
      res.writeHead(500);
      return res.end('Run "npm run build" first.');
    }
    res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(readFileSync(file));
  } catch (e) {
    json(res, 400, { error: String(e.message || e) });
  }
}).listen(PORT, "127.0.0.1", () => console.log(`Thinking System on http://localhost:${PORT}  (runs in ${RUNS_DIR})`));
