# Thinking System

Think anything through on a live, branching map. Your question sits in the middle; the system branches out in several directions, comes back together, restates the question, grows the best options further, comes back to ask you what matters, and hands back a decision with one next action.

It runs on your machine and uses your own Claude Code login. Nothing is hosted.

## Install (Claude Code)

```
/plugin install thinking-system --marketplace Anthoneyq/thinking-system
```

Answer `y` to add the marketplace, then pick a scope. Needs Node 18+ and Claude Code signed in.

## Use

In Claude Code, just ask: "think this through: should I raise prices or add a cheaper tier?" Claude writes up the thought, starts the map in your browser, and brings the decision back into the chat when it finishes. Answer its questions on the map, or press "You decide".

From a terminal: `node <plugin folder>/bin/think.mjs "your thought"` (`--effort quick|normal|deep`, `--model claude-opus-5-5`, `--hands-off`, `--wait`).

On the map, any box can be marked **Stuck / don't get this** (it explains plainly and treats the blocker as a constraint), taken **a level deeper** (a full sub-map), or **redone**. Correcting something it inferred redoes everything after it.

A normal run is about 15 model calls and 3-6 minutes; on Sonnet that is roughly $0.50-0.80 of usage on your account.

## How it works

- `server/engine.js`: run state, scheduler and the loop (frame, branch, come together, grow, ask, review, decide).
- `server/prompts.js`: the rules, step prompts and strict JSON schemas. `server/methods.js`: the 17 thinking methods it chooses from.
- `server/models.js`: calls `claude -p` lean (no tools, MCP or settings), or Codex, or a dry run.
- `src/`: React + React Flow. Map view (radial, live) and Steps view.
- `app/server.mjs` and `dist/` are built files, committed so the plugin runs without `npm install`. Rebuild with `npm install && npm run build`.

Runs save to `~/Thinking System/runs/` (change it with `{"runsDir": "..."}` in `~/.thinking-system/config.json`). Server log: `~/.thinking-system/server.log`.
