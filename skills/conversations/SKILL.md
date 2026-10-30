---
name: conversations
description: Conversations mode of the Thinking System. Reads a business's recorded calls into one record (every decision, open question, assumption, to-do and idea, placed on the business tree with links to the other branches it touches), then asks the user what it still needs, one question at a time, until nothing is left. Also answers "where did we talk about X". Runs only when the user types /conversations.
argument-hint: [library id] [a question like "where did we talk about the fee ceiling?"]
disable-model-invocation: true
---

# Conversations mode

What the user said with the command: $ARGUMENTS

Every command runs from this skill's base directory: `node "<base directory>/../../bin/think.mjs" library <command>`. Without a library id it uses the first library in `~/.thinking-system/config.json`. Show its output to the user plainly and briefly; never paste the whole record.

1. **Start with `status`.** Tell the user in one or two lines: how many calls are unread, how many questions are waiting, and the map link.
2. **New calls?** If they dropped new transcripts in the folder, run `scan`, then `process` (it shows a cost estimate on the map; about $0.08 a call: Haiku reads, Sonnet ties topics). It runs in the app; check back with `status`. To try one call first: `process --only "<part of the file name>"`.
3. **Their question, if they asked one** ("where did we talk about...", "what did Dan decide on..."): run `ask "<their question>"` and give the answer with where it was said.
4. **Then work the questions.** Run `next` and put the one question to the user, short, with its options. When they answer:
   - a topic question: `answer "<their words>"` (their words become the decision; don't rewrite them),
   - a spot check (a sample of filings): `answer yes` if all are right, or `answer wrong 2=<branch-id> 5=none` for the wrong ones (the rest count as right),
   - a single "where does this belong?": `answer yes` for the guess, `file <branch-id>` to move it (`file none` if it is not about the business),
   - a tree overlap: answer it on the map (merge, or say how the branches differ),
   - `skip` if they want to leave it.
   Each command prints the next question; keep going until it says nothing needs them or they stop. Never answer spot checks for them: they measure how often filing is right.
5. **When they've answered a batch,** the page shows "Update with N changes"; tell them, or run it from the page. Spot checks need no update: a rule that reaches 95% right over 20 checks files its items at once. Weekly, or after a big batch of calls, offer `crosscheck` (Opus, a few dollars): it finds ideas worked out in one part of the business that apply elsewhere.

Don't analyse or advise beyond what the record says. The record is at `<library dir>/INDEX.md` (path printed by `status`) for any AI or person to read.
