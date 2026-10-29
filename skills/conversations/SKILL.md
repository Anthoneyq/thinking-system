---
name: conversations
description: Conversations mode of the Thinking System. Reads a business's recorded calls into one record (every decision, open question, assumption, to-do and idea, filed on the business tree with a confidence score), then asks the user what it still needs, one question at a time, until nothing is left. Also answers "where did we talk about X". Runs only when the user types /conversations.
argument-hint: [library id] [a question like "where did we talk about the fee ceiling?"]
disable-model-invocation: true
---

# Conversations mode

What the user said with the command: $ARGUMENTS

Every command runs from this skill's base directory: `node "<base directory>/../../bin/think.mjs" library <command>`. Without a library id it uses the first library in `~/.thinking-system/config.json`. Show its output to the user plainly and briefly; never paste the whole record.

1. **Start with `status`.** Tell the user in one or two lines: how many calls are unread, how many questions are waiting, and the map link.
2. **New calls?** If they dropped new transcripts in the folder, run `scan`, then `process` (it shows a cost estimate on the map; Sonnet reads about $0.10 a call). It runs in the app; check back with `status`. To try one call first: `process --only "<part of the file name>"`.
3. **Their question, if they asked one** ("where did we talk about...", "what did Dan decide on..."): run `ask "<their question>"` and give the answer with where it was said.
4. **Then work the questions.** Run `next` and put the one question to the user, short, with its options. When they answer:
   - a topic question: `answer "<their words>"` (their words become the decision; don't rewrite them),
   - a filing check: `answer yes` to accept the guess, `file <branch-id>` to move it (`file none` if it is not about the business),
   - `skip` if they want to leave it.
   Each command prints the next question; keep going until it says nothing needs them or they stop. Answer filing checks for them only when they say "you decide".
5. **When they've answered a batch of filing checks,** the page shows "Update topics with N answers"; tell them, or run it from the page. Weekly, or after a big batch of calls, offer `crosscheck` (Opus, a few dollars): it finds ideas worked out in one part of the business that apply elsewhere.

Don't analyse or advise beyond what the record says. The record is at `<library dir>/INDEX.md` (path printed by `status`) for any AI or person to read.
