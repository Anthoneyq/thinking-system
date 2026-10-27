# Thinking System

Drop in an incomplete thought; watch a flowchart work it out live; step in at any box.

```
think "which of my businesses first, and what do I automate forever?"
think notes.md                    # files become the input
pbpaste | think --effort deep     # --model claude-opus-5-5 | codex | dry ...
```

`think` starts the local app on http://localhost:4477 if needed and opens the run. Or `npm run app` and use the home page.

## How a run flows

Your thought -> Frame it (stated vs inferred, constraints, unknowns and what to do about each) -> Your input (only questions that change the answer; "You decide" skips) -> Pick methods (from `server/methods.js`, chosen per situation) -> methods in parallel -> Show all, keep 3 -> Enough to commit? (confidence gate: commit, ask, research, or more methods, bounded by effort) -> Skeptic review (one pass) -> Decision.

At any box: **Stuck / don't get this** (red; explains it plainly and adds a constraint), **Go a level deeper** (a full sub-flow for that box), **Redo from here**. Correcting an inference or picking your own options redoes everything downstream; earlier passes stay viewable.

## Pieces

- `server/engine.js` - run state, scheduler, routing after each step, user actions.
- `server/prompts.js` - system rules, step prompts, strict JSON schemas.
- `server/models.js` - Claude CLI (lean: no tools/MCP/settings), Codex CLI, dry run.
- `src/` - React + React Flow view. `shared/layout.js` - dagre layout (also used for Excalidraw export).
- Runs save to `~/Documents/AnthoneyOS/Personal/Thinking System/runs/<id>/` (`run.json`, `record.md`, `flow-*.excalidraw`). Override with `THINK_RUNS_DIR`.

Log: `~/Library/Logs/thinking-system.log`.
