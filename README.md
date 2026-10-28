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

## How it works

- `server/engine.js`: run state, scheduler and the loop (frame, branch, come together, grow, ask, review, decide).
- `server/prompts.js`: the rules, step prompts and strict JSON schemas. `server/methods.js`: the 20 thinking methods it chooses from.
- `server/jev.js`: the Jev judgments (method picks, the gate, question weighing, reply checks).
- `server/models.js`: calls `claude -p` lean (no tools, MCP or settings), or Codex, or a dry run.
- `src/`: React + React Flow. Map view (radial, live) and Steps view.
- `app/server.mjs` and `dist/` are built files, committed so the plugin runs without `npm install`. Rebuild with `npm install && npm run build`.

Runs save to `~/Thinking System/runs/` (change it with `{"runsDir": "..."}` in `~/.thinking-system/config.json`). Server log: `~/.thinking-system/server.log`.
