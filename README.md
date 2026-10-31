# Thinking System

Think anything through on a live, branching map. Your question sits in the middle; the system branches out in several directions, comes back together, restates the question, grows the best options further, comes back to ask you what matters, and hands back a decision with one next action.

It runs on your machine and uses your own Claude Code login. Nothing is hosted.

**Watch one run first:** https://thinking-system.vercel.app (a 20-second replay of a real run).

## Install

You need:
- **Claude Code**, signed in with a Claude Pro or Max plan or an Anthropic API key. Get it at https://claude.com/claude-code.
- **Node.js 18 or newer** (https://nodejs.org). Check with `node -v`.
- A web browser.

Then:

1. Open a terminal and start Claude Code: `claude`
2. Add this repo as a plugin source:
   ```
   /plugin marketplace add Anthoneyq/thinking-system
   ```
3. Install the plugin:
   ```
   /plugin install thinking-system@thinking-system
   ```
4. Quit Claude Code (`/exit`) and start it again so `/systems` loads.
5. Type `/systems`, talk through what's on your mind, and say "go". The live map opens in your browser.

To update later: `/plugin marketplace update thinking-system`. To remove: `/plugin uninstall thinking-system@thinking-system`.

Each run uses your own Claude plan. A normal run is about 3-6 minutes and roughly $0.50-0.80 of usage on Sonnet.

## Use

In Claude Code:

```
/systems
```

Then talk it all out, as messy as you like, and say "go". Or give the thought straight away: `/systems should I raise prices or add a cheaper tier?`. It runs only when you type `/systems` (if another `/systems` already exists, use `/thinking-system:systems`), and it stays on for the rest of the conversation, so each new thing you bring up gets its own map. Claude writes up the thought, adding any facts from your conversation. It opens the live map in your browser, brings each question back into the chat, and returns the decision when it finishes. Answer on the map or in the chat, or say "you decide".

## Faster decisions with Jev (optional)

If `TYPESAFE_API_KEY` is set (or `{"typesafeKey": "..."}` in `~/.thinking-system/config.json`), [Jev](https://docs.typesafe.ai), TypeSafe's fast decision model, steers the run:

- It picks the thinking methods (about 0.1 s instead of a Claude call).
- After each pass, it decides whether to commit, grow the options, look things up, try other angles or ask you.
- It drops options that break a hard rule.
- It drops questions whose answer wouldn't change anything.
- It checks your replies. If part of a reply can't be used, the question stays open on the map, and in the chat, for one more line.

Claude still writes everything you read. Jev's call stands when it agrees with Claude. It overrules Claude only when it is at least 70% sure. If Jev is unsure, or if it fails, Claude's call stands. Each Jev decision shows its probabilities in the panel. A run costs well under a cent in Jev calls. Turn it off per run with `--no-jev`, or with the Decisions switch on the home screen.

From a terminal: `node <plugin folder>/bin/think.mjs "your thought"` (`--effort quick|normal|deep`, `--model claude-opus-5-5`, `--hands-off`, `--no-jev`, `--wait`).

The side panel lists what is **still open**, merged across every branch: how many times each point came up and where, in the order to settle it. Answer a point once and it covers every place it came up. **How it's thinking** shows each pass (which tools went out, what came back, whether Jev or Claude made the call) and which model wrote what. Inferences and assumptions inside any branch can be marked right, wrong or changed; that branch redoes itself. Urgent/important and impact/effort branches draw their 2x2, decision matrices draw their table, and every outer leaf opens to show where the option came from and what became of it.

On the map, any box can be marked **Stuck / don't get this** (it explains plainly and treats the blocker as a constraint), taken **a level deeper** (a full sub-map), or **redone**. Correcting something it inferred redoes everything after it.

Every decision is tagged **Decide**, **Test first**, **Defer** or **Your call**, says whether it is easy or hard to undo, what it displaces, and what should reopen it. When a call would settle similar cases, it offers an if-then rule; click **Save as standing rule** (or say yes in chat) and every later run applies it instead of asking again. Rules live in `~/.thinking-system/rules.md` (or `{"rulesFile": "..."}` in config.json); edit or delete lines freely. The skeptic step also lists claims that trace to nothing you said, gave or it looked up: another model agreeing does not count as evidence.

A normal run is about 15 model calls and 3-6 minutes; on Sonnet that is roughly $0.50-0.80 of usage on your account.

## Conversations mode: every call, filed (optional)

Point it at a folder of recorded calls (Teams or Zoom `.vtt`, Teams Word `.docx`, `.md`, `.txt`) and it builds one record of the business:

- **Reads each call** into items: decisions, open questions, assumptions, to-dos, ideas, facts and preferences, each with who said it, when, and the exact words. Each item carries its own context, so it still makes sense on its own months later. Exact duplicate files are skipped.
- **Places each item on your business tree**, the SOPs within SOPs. Claude names its home and the other branches it also touches (a fee for website work touches pricing and the website); those links are how the parts of the business connect, and the map draws them. Jev walks the tree level by level as a second reader.
- **Measures how sure the filing is instead of trusting a model's score.** How the two readers' picks relate is a rule (same branch, one inside the other, same area, linked, split). You spot-check a sample, ten at a time across every rule; a rule files on its own once it has been right **95%** of the time over 20 checks, and keeps being sampled at one check per 50 items it files. Until then its items show as best guesses. One word used two ways ("ceiling" the cost cap, "ceiling" the damage) always comes to you. Your answers go back to Jev as examples.
- **Ties the same topic together across calls** and says where it stands: decided, open, assumed, done, or **never settled** (talked about several ways, no decision; it lists each way).
- **Lets you work branch by branch.** Click a bubble to see only questions in that branch and its parts, including the relevant items from the current spot-check sample. Step out to widen the scope, or choose **All questions**. **Branch** still shows the topic details.
- **Skip for now** moves an unanswered question or individual spot-check item to **Later** on your copy. It does not approve the filing or answer for the team. Open Later to answer it when you can.
- **Asks what it still needs**, one question at a time, until there is nothing left: never-settled topics, the spot check, and overlaps in the tree (merge two branches, or say how they differ). Filing is never asked item by item, so questions don't grow with every call.
- **Finds** where anything was said, split by the sense a word was used in, and answers questions from the record with sources.
- **Cross-checks** (on demand, Opus): what was worked out in one part of the business that applies to another.

Set it up in `~/.thinking-system/config.json`:

```json
{ "libraries": [{ "id": "acme", "name": "Acme Co", "sources": ["/path/to/call transcripts"], "dir": "/path/to/where the record lives" }] }
```

Put your tree in `<dir>/tree.json` (`{ "name": "Acme Co", "branches": [{ "id": "ops", "name": "Running a job", "desc": "...", "children": [...] }] }`); good descriptions make filing sharper. Then open http://localhost:4477/library/acme, or `/conversations` in Claude Code, or `think library acme status|scan|process|next|answer|ask|crosscheck`. The record is also written as `<dir>/INDEX.md`, with how sure each rule is and which branches connect most. Haiku reads (about $0.03 a call, set `readModel` on the library to change it) and Sonnet ties topics (`topicModel`); filing with Jev is a fraction of a cent.

No names in the record: add `"names": { "Jane Doe": "Principal 1", "Jane": "Principal 1" }` to the library and each name becomes its label before any model reads it (file titles too). Transcripts already scrubbed to labels like `[Attorney 1]` work as they are. Anyone else still named is written by role, and personal talk is left out. Files named only by date and time (`2026-10-29 1427.vtt`) get a title from the reading.

## How it works

- `server/engine.js`: run state, scheduler and the loop (frame, branch, come together, grow, ask, review, decide).
- `server/prompts.js`: the rules, step prompts and strict JSON schemas. `server/methods.js`: the 20 thinking methods it chooses from.
- `server/jev.js`: the Jev judgments (method picks, the gate, question weighing, reply checks).
- `server/library/`: Conversations mode (parse calls, read, links, file level by level, filing rules and spot checks, tie topics, questions, cross-check, Markdown record). `src/LibraryView.jsx`: the spider web and the questions panel.
- `server/models.js`: calls `claude -p` lean (no tools, MCP or settings), or Codex, or a dry run.
- `src/`: React + React Flow. Map view (radial, live) and Steps view.
- `app/server.mjs` and `dist/` are built files, committed so the plugin runs without `npm install`. Rebuild with `npm install && npm run build`.

Runs save to `~/Thinking System/runs/` (change it with `{"runsDir": "..."}` in `~/.thinking-system/config.json`). Server log: `~/.thinking-system/server.log`.
