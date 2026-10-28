# Thinking System

Think anything through on a live, branching map. Your question sits in the middle; the system branches out in several directions, comes back together, restates the question, grows the best options further, comes back to ask you what matters, and hands back a decision with one next action.

It runs on your machine and uses your own Claude Code login. Nothing is hosted.

## Install (Claude Code)

```
/plugin install thinking-system --marketplace Anthoneyq/thinking-system
```

Answer `y` to add the marketplace, then pick a scope. Needs Node 18+ and Claude Code signed in.

## Use

In Claude Code:

```
/think should I raise prices or add a cheaper tier?
```

It runs only when you type `/think` (if another `/think` already exists, use `/thinking-system:think`). Claude writes up the thought, adding any facts from your conversation. It opens the live map in your browser, brings each question back into the chat, and returns the decision when it finishes. Answer on the map or in the chat, or say "you decide".

## Faster decisions with Jev (optional)

If `TYPESAFE_API_KEY` is set (or `{"typesafeKey": "..."}` in `~/.thinking-system/config.json`), [Jev](https://docs.typesafe.ai), TypeSafe's fast decision model, steers the run:

- It picks the thinking methods (about 0.1 s instead of a Claude call).
- After each pass, it decides whether to commit, grow the options, look things up, try other angles or ask you.
- It drops options that break a hard rule.
- It drops questions whose answer wouldn't change anything.
- It checks your replies. If part of a reply can't be used, the question stays open on the map, and in the chat, for one more line.

Claude still writes everything you read. Jev's call stands when it agrees with Claude. It overrules Claude only when it is at least 70% sure. If Jev is unsure, or if it fails, Claude's call stands. Each Jev decision shows its probabilities in the panel. A run costs well under a cent in Jev calls. Turn it off per run with `--no-jev`, or with the Decisions switch on the home screen.

From a terminal: `node <plugin folder>/bin/think.mjs "your thought"` (`--effort quick|normal|deep`, `--model claude-opus-5-5`, `--hands-off`, `--no-jev`, `--wait`).

On the map, any box can be marked **Stuck / don't get this** (it explains plainly and treats the blocker as a constraint), taken **a level deeper** (a full sub-map), or **redone**. Correcting something it inferred redoes everything after it.

A normal run is about 15 model calls and 3-6 minutes; on Sonnet that is roughly $0.50-0.80 of usage on your account.

## How it works

- `server/engine.js`: run state, scheduler and the loop (frame, branch, come together, grow, ask, review, decide).
- `server/prompts.js`: the rules, step prompts and strict JSON schemas. `server/methods.js`: the 17 thinking methods it chooses from.
- `server/jev.js`: the Jev judgments (method picks, the gate, question weighing, reply checks).
- `server/models.js`: calls `claude -p` lean (no tools, MCP or settings), or Codex, or a dry run.
- `src/`: React + React Flow. Map view (radial, live) and Steps view.
- `app/server.mjs` and `dist/` are built files, committed so the plugin runs without `npm install`. Rebuild with `npm install && npm run build`.

Runs save to `~/Thinking System/runs/` (change it with `{"runsDir": "..."}` in `~/.thinking-system/config.json`). Server log: `~/.thinking-system/server.log`.
