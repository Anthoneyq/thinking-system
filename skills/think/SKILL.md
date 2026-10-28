---
name: think
description: Think a decision, plan or messy goal through on a live branching map in the browser. It asks only what changes the answer and returns a decision record with one next action. Runs only when the user types /think.
argument-hint: [what you're thinking about]
disable-model-invocation: true
---

# Think it through

The user's thought: $ARGUMENTS

If that is empty, ask in one line what they want to think through, then continue.

This plugin ships a small local app. It runs each thinking step through the user's own `claude` CLI, so it uses their Claude login and nothing is hosted. The map opens at http://localhost:4477.

## Run it

1. **Write the thought to a file.** Use the user's own words first. If the conversation holds facts that matter (constraints, numbers, files they shared), add them under a heading `Context from our conversation:`. Never add guesses as facts; the app separates what was stated from what it infers, and that only works if the input is honest. Save it to a temp file, e.g. `/tmp/think-input.md`.

2. **Start the run in the background** with the Bash tool (`run_in_background: true`), from this skill's base directory:

   ```
   node "<base directory>/../../bin/think.mjs" --wait /tmp/think-input.md
   ```

   Options, only when they fit:
   - `--effort quick` for small or obvious calls, `--effort deep` for big, costly or irreversible ones. Default is normal.
   - `--model claude-opus-5-5` for the hardest thinking, `claude-haiku-5-5` for cheap and fast. Default is Sonnet. `--model codex` if the user asks for GPT and has Codex installed. `--model dry` runs the flow with sample content and no AI (for testing only).
   - `--hands-off` if the user says not to ask them anything. Otherwise let it ask: the questions are the point.
   - `--no-jev` if the user wants Claude to make every routing call. By default, when `TYPESAFE_API_KEY` is set, Jev (TypeSafe's fast decision model) picks the methods, decides what happens after each pass, drops questions that would not change the answer, and checks the user's replies. Claude still writes all the content, and its call stands whenever Jev is unsure.

3. **Tell the user, in one or two lines:** the map is open in their browser (the `Live map:` URL in the output) and you will bring its questions and its decision back here. A normal run takes about 3 to 6 minutes.

4. **When the command returns, read how it ended:**
   - **`WAITING FOR YOU` (exit 3).** The run is back at the question and needs the user. Show its questions here, short, with the options it offers. The user can answer here or on the map; the map keeps going either way. Straight away, start following it again in the background:

     ```
     node "<base directory>/../../bin/think.mjs" watch <run-id>
     ```

     If the user answers here, relay their words exactly, never answering for them:

     ```
     node "<base directory>/../../bin/think.mjs" answer <run-id> "their answer"
     ```

     Use `answer <run-id> --skip` only when the user says to let it decide. Each `watch` returns at the next question or at the end, so repeat this step as needed.

     If `answer` prints `NEEDS A LITTLE MORE` (exit 3), Jev could not use part of the reply. Show the user which questions it named, relay their next reply with `answer` again, or use `answer <run-id> --as-is` if they want to keep what they said. Start `watch` only after an answer goes through.
   - **`DONE` (exit 0).** The output ends with the decision record. Give the user the recommendation, the next action and its owner, and what is still uncertain, in a few lines, and point to the record file. Do not re-argue the decision; if you disagree with something, say so once, briefly.

## If something goes wrong

- `The app did not start`: read `~/.thinking-system/server.log` and report the error. It needs Node 18 or newer and the `claude` CLI signed in.
- A step failed: the user can open that box on the map and press Try again.
- Port 4477 taken by something else: rerun with `THINK_PORT=4478` in front of the command.

Run records are saved in `~/Thinking System/runs/` (or the `runsDir` set in `~/.thinking-system/config.json`). Each holds `record.md`, `run.json` and any Excalidraw export.
