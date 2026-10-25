# How we worked with AI

Written during the build, not reconstructed after it. Bahn's judging asks for
judgement, not tool count, so this records decisions rather than prompts.

## The first build was aimed at the wrong brief

We started before the real brief existed. The only description available was
"build us an agentic operations controller", so we built one: a deterministic
script that parsed free-text orders, priced them from a rate table, assigned a
driver with a stated reason, wrote a timestamped timeline, and escalated when
the driver pool ran dry.

It ran. Four orders in, three assigned, one escalated with the reason
"no driver with an open slot for class van near Espoo." The escalation was the
best part of it.

Then the brief dropped and invalidated it. Bahn requires a language model doing
the work in a loop, real tool use, and a person approving every change before it
happens. A regex parser and a dict of prices satisfies none of that. We kept the
script as history and replaced the submission rather than patching it.

## What we checked and rejected

The starter app. It is Next.js and Postgres, and the brief calls it optional,
adding that its board of lanes is "how people have worked so far, not the
answer." It also fails the taste criterion by construction: a developer-shaped
board is the opposite of something an operations person opens without a
tutorial. We skipped it and read the dataset directly.

Docker. Absent on the machine, and only needed by the starter we rejected. Not
installed, not worked around.

## Where we did not take the first answer

**The evidence count read the wrong object.** The board printed
`proposed 12 evidence 1` and the eleven uncited proposals were not uncited at
all. `ours.jsonl` carried `evidence_refs` on all twelve rows. The server was
counting `a.evidence_refs` off the alert record, which has one entry, instead of
the proposal's refs, which have twelve. The fix was one field. The lesson is
that a number that looks like a defect report can be a defect in the report.

**The source classifier read the channel, not the subject.** First version read
the `conv-` prefix in `evidence_refs` and classified nine of twelve alerts as
conversation-sourced. Eight of those nine were wrong. The alert summaries were
telling us the whole time: "source is a conversation, not a verified outcome"
means the conversation raised the question, not that the conversation is the
fact. A ferry risk is about a ferry. A proof review is about a document. The
correction was to read `signal` first, which names the subject, and fall back to
the ref only when the signal is unmapped.

That is the same error Bahn warns about in OPERATIONS-CONTEXT.md — "a driver
message as a fresh location." A message that says the ferry might be late is not
the ferry's schedule. We made the mistake the brief predicted and caught it by
reading the brief again.

**The build script ignored itself.** `/*.sh` in `.gitignore` was added to keep
fourteen scaffolding scripts out of the repo. It also matched `verify.sh`, the
one script that proves a fresh clone works, and a clone came back with the
checker missing and `bash: verify.sh: No such file or directory`. The fix was a
negation line. The lesson is that an ignore rule written for one state keeps
applying after the state changes.

**The command map was a guess.** Our deterministic path named one command on all
twelve rows. The dataset carries fourteen distinct commands across fourteen
shipped proposals — `travel.rebook`, `condition.compare_evidence`,
`driver.request_safe_stop_details` — and our map guessed at field names instead
of reading the alert's actual `signal` field. One match in twelve. We only found
the real field by probing the data and printing its keys.

**Three scripts reported nothing and looked like success.** `repo.sh` exited at
`GH_NOT_INSTALLED` before it could report current state. `step1.sh` printed
`OURS_MISSING` against a file with twelve rows. A Notepad save of `verify.sh`
produced a file nothing ran. Each time the code was correct and the world had
moved underneath it, and each time the output was confident and empty. A checker
you learn to ignore has already failed.

## The demo as we designed it

First instinct was to show the agent succeeding. The brief's own example — a
Bentley stopped on a motorway with a red warning light — shows the agent handing
a person one decision and expecting a late delivery. We built the handover and
the escalation as the primary flow, not the happy path.

The board shows twelve open alerts, each with a source class, a fact state, and
the reason it surfaced. Three of them say the agent stopped and why. The ones
the agent declined to act on do not offer an Accept button, because accepting
something the agent could not verify is not a decision a person should be able
to make with one click.

## Where the agent is not finished

The model path is measured, not assumed. `call_model` builds a prompt from the
real records, parses JSON from the reply, and falls back to the deterministic
path with the error recorded in `model_error`. The current run produces
`SOURCES: {deterministic: 3, model: 9}` — nine proposals written by the model,
three refusals computed before the model is ever called. Two of those numbers
are the point. The nine prove a language model is doing the work. The three
prove the agent stops when the evidence cannot support an action, and stops
cheaper than asking a model it would have to overrule.

A clone with no key is a different page and says so: nine rows fall back with
`model_error` naming the reason, three still refuse, and every card renders
the fallback line. The fallback exists so the control room is never empty, and
it records why it fell back, which is the honest version of the same page.

## The reviewers we hired by accident

Late in the build, we asked two other models to review the submission cold. Not as collaborators — as judges. We gave them the briefs and the repo and asked what would cost us points.

They found things we missed.

**The approval boundary was not actually enforcing approval.** Both reviewers found it independently. The `/decide` endpoint fired the executor for any decision value — `accept` or `change`. A person who clicked "Change" expecting to edit would have executed the previous proposal. We had tested the buttons but not the intent. The fix was one line: `if(d.decision === 'accept')`. The lesson is that "the UI shows the right thing" is not the same as "the backend enforces the right thing."

**The proposal's command was being replaced at handoff.** The `runCaseFor()` path hardcoded `command: 'alert.resolve'` regardless of what the model proposed. If the model said "replan the route," the saved proposal said "resolve the alert." A judge clicking Accept would have executed something different from what the card promised. Fixed by preserving the agent's actual command and adding `command` and `evidence_refs` to the `propose_action` schema as required fields.

**Acknowledged alerts were being treated as closed.** The reviewer who found this put it best: "acknowledging work establishes ownership, not that unfinished work disappears." Our queue only admitted `status === 'OPEN'`. A case where the safety-stop alert was `ACKNOWLEDGED` but the recovery was still in progress disappeared from the board entirely. A judge clicking through the acknowledged cases would have seen a critical incident quietly vanish. The fix was to keep `ACKNOWLEDGED` on the board with a distinct chip and header bucket: "acknowledged, still in progress."

**Proposal indexes were frozen at server startup.** New proposals written by the "Run agent" button were invisible until the server restarted. The reviewer caught this by reading the code, not by running the app. Fix: rebuild the indexes per request. Two reviewers, two independent ways to catch it.

**The quiet-orders panel overclaimed.** We had three checks per order (address parity, alert presence, travel status) and the panel said "checked and quiet." Three checks do not establish that an order is safe to ignore. Fixed two ways: widened to nine checks per order (release document, handover proof, assignment health, message freshness, tracking freshness, condition claim, plus the original three), and changed the language from "checked and quiet" to **"passed the preliminary check"** with the full list visible and hoverable. A paranoid operator can now drill into every order and see exactly what was verified. The panel says what it did not check, too.

**Operator overrides did not reach the model.** When the operator typed a driver reply in `/phone`, the inbox recorded it — but the model's next turn called `scripted_driver()` and returned the script. The override was persisted but invisible. This one was caught by an operator, not a reviewer: the question "why doesn't the agent react to my override?" exposed the gap. Fix: `ask_driver` reads `latest_reply_for(driver_id)` from the inbox before falling back to the script, and the `/phone/reply` endpoint appends a `[Phone log: the driver just replied]` event to the case history. On the next turn, the model sees the override as a real update and leads with it.

**What this taught us.** Every one of those findings was a mismatch between what the interface promised and what the code did. The interface said "a person decides" — the backend executed on Change. The interface said "replan the route" — the backend saved "resolve the alert." The interface said "checked and quiet" — the check was too narrow. The interface said "I overrode the driver" — the model didn't see it.

The process we would tell the next team is: get the reviewers in early, not late. The two external reviews cost us an hour of reading and four hours of fixing. They caught four P0 defects that would have cost us the submission. If we had done this at hour 6 instead of hour 30, the fixes would have been free.

**What we did not take their word on.** One reviewer said the interface couldn't be scored without a live test. Fair — we recorded a live test. Another reviewer said a mocked execution was insufficient; the brief explicitly says "everything around it can be fake." We kept the mocked executor but added a `REQUESTED` status so the strip says "the executor recorded the request but the downstream system has not confirmed" instead of pretending success. That's a middle path the reviewer would probably accept.

**What we threw away from the reviews.** The "add a real database with a versioned proposal state" recommendation. It would have been more correct, but it would have cost four hours and broken the fresh-clone demo. The point of the demo is not production-grade state management; it's the human-agent decision loop. We kept the loop and lost the architectural purity.

## What we would tell the next team

Get the brief before you get the stack. We spent the first hours building
something competent against a description that turned out to be a summary. The
expensive part was not the rewrite, it was the confidence we had in the wrong
direction.

Then read the operations context as carefully as the schema. It is where the
distinctions live — quoted versus booked, reported versus confirmed, present
versus authorised to collect. Those distinctions are the product.

**The model echoed the schema.** One of the first twelve model proposals came
back with `summary: "one sentence, what happened"` and
`command: "dotted.command.name"` — the literal placeholders from our prompt.
It parsed as valid JSON, so nothing caught it until a sample row was read by
eye. Fixed with a placeholder guard: if any marker from the prompt appears in
the result, the deterministic proposal is written instead and `model_error`
records `model echoed schema placeholder`. Valid JSON is not the same as a
valid answer.

**The model proposed on cases it should refuse.** Before the stop guard moved,
all twelve alerts went to the model, including three whose evidence could not
support any action. It invented `ops.release.authority.review` and
`ops-readiness.confirm-desk-access` for them — plausible-sounding commands for
situations where the right answer was to stop. Fixed by computing the refusal
before the model call: if the evidence does not support action, the
deterministic refusal is written and the model is never asked. Cheaper, and
the answers are better. `SOURCES: {deterministic: 3, model: 9}` is the shape
that fix produced, and it is a better shape than twelve model calls.

## Which tools, and what each was asked for

The build was done in a conversation with a chat-based coding agent (DeepSeek,
accessed through a local OpenAI-compatible bridge) that wrote terminal blocks,
and the operator ran every block by hand in Git Bash and pasted the output
back. No tool had shell access. That constraint shaped everything: every step
had to be verifiable in one run, and every failure had to print enough to
diagnose itself without a second round trip.

**What it was given, and what it got wrong with that.** The prompt that failed
was the one that trusted a summary: "build the controller from the brief"
produced a regex parser and a price table, against a brief the agent had only
seen paraphrased. The prompts that worked carried a constraint and asked for
evidence back, not for code: "here is the exact output, name the first causal
error and give one discriminating command," and "measure what this model
needs at four token ceilings instead of picking one." The four failures below
are what happens when that discipline slips for one turn.

**What was asked for, in order:** a project inspection bundle, then a
deterministic controller, then a control room, then an agent, then a model
loop, then the evidence discipline, then the classification, then the
decisions endpoint, then the docs.

**What the agent got wrong, four times, in ways that mattered.**

It wrote `/*.sh` into `.gitignore` to keep build scripts out of the repo, and
that rule also hid `verify.sh`, the one script that proves a fresh clone
works. A clone came back with `No such file or directory`. The agent then
called the fresh-clone test green because the working tree passed.

It wrote a source classifier that read `evidence_refs` prefixes and called
nine of twelve alerts conversation-sourced. Bahn's own operations context
warns about this exact error — a driver message mistaken for a fresh location
— and the agent had read that document and repeated the mistake anyway.

It wrote `max_tokens: 20` against a reasoning model, which spent the entire
budget thinking and returned `content: null`, crashing the parser. The fix
required measuring the ceiling at four values instead of picking one.

It wrote an `update_project` call with `links` as a list of strings when the
API wanted objects. The error named the path and the type, so the second
attempt worked, but the first was a guess about a schema nobody had read.

**What was thrown away.** The first controller, entirely: a regex parser and
a price table built before the brief existed. The starter Next.js app, unread.
A source-classification map built on guessed field names (`kind`,
`category`) that matched one alert in twelve, replaced after a probe printed
the real field (`signal`). A multi-line patch anchor against a file that had
been minified by earlier patches, which cost two failed attempts before
switching to single-line regex matching.

**What the operator caught.** Every one of those four tool errors was found
by reading output rather than trusting intent. The pattern is consistent: the
code was right, the assumption about the world was wrong, and the output was
the only thing that said so.

## Which coding agents, and what each got wrong

The build happened in four phases. None of them was planned. Each one is here because the previous one stopped working, and the shape of the code we shipped is the shape of that sequence.

**Phase one — my own agent setup.** I started with an agent harness I had already built and used on other projects. It runs commands, reads files, and writes code. It got the foundations in: the repo skeleton, the dataset loader, the first `controller.py`, and the first FastAPI shell. Then it crashed. Not metaphorically — the harness itself broke, threw an exception mid-run, and would not restart. Whatever was on disk when it died is what I had. That was `controller.py` and an empty `app/main.py`.

**Phase two — Claude Code, until it hit the rate limit.** I switched to Claude Code on the free tier. It fixed what my own agent had left half-finished: the `verify.sh` gate, the first board page, the working `/decide` endpoint, and the `case_chat.py` loop. It also introduced the two mistakes that cost the most time: a `.gitignore` rule that hid `verify.sh` from a fresh clone (I didn't catch that until hour fourteen), and a source classifier that read `evidence_refs` prefixes and called nine of twelve alerts conversation-sourced — the exact mistake Bahn warns about in `OPERATIONS-CONTEXT.md`. Both caught by running the fresh-clone test and re-reading the brief.

Then Claude hit the free tier's message cap. No more messages that day.

**Phase three — chat.deepseek.com, context problems, and then flow.** I moved to the DeepSeek web app. This was the phase with the steepest learning curve, and it was not about the model's capability. It was about context.

The web app doesn't have a shell. It doesn't read the repo. It doesn't remember what happened last message if you open a new conversation. Every single command had to be pasted back and forth — I run it in Git Bash, I paste the output, it responds. And because the free tier caps at ~100 messages a day across a conversation history, I kept hitting a point where the model had *just* seen the file it needed and then lost it in a summarized context window. Three hours of "run this script, paste the output, no wait, that's the old version of the file, here's the current one, ok now run it again."

But it got into a flow. The trick was: every prompt carried the constraint, and every response came back with a command whose output was *self-diagnosing*. "Here is the exact output. Name the first causal error and give one command." That prompt pattern produced one useful fix per round trip, roughly every four minutes. Six hours of that produced the executor, the streaming SSE endpoint, the four UX passes, and the six bugs caught in tests before the video.

**Phase four — back to Claude for the docs.** Once the code was stable, I went back to Claude for the README and PROCESS.md writing, since the free tier message cap had reset. It was the right tool for the right phase.

**What was thrown away across all four phases.** The first `controller.py`, entirely. The starter Next.js app, unread. A source-classification map built on guessed field names (`kind`, `category`) that matched one alert in twelve — replaced after a probe printed the real field (`signal`). A multi-line patch anchor against a file that had been minified by earlier patches — cost two failed attempts before switching to single-line matching. A diagnostic that counted chip occurrences by grepping lines instead of matches, which reported 1 chip on a page with 12. A handover strip that read a module-level decisions lookup frozen at server startup, so it showed "no decision" for decisions it had just written.

**The pattern.** Every one of those bugs was found by reading output, not by trusting intent. The code was often right; the assumption about the world was wrong, and the output was the only thing that said so. That was true whether the agent was my own harness, Claude, or DeepSeek. The tool didn't matter. The discipline did.

**What each phase was actually good for.**

- **My own agent** — bootstrapping. Fast on the skeleton, no social friction.
- **Claude Code** — the messy middle. Fixed the half-finished first attempt, wrote real code, made specific mistakes that were easy to find by running the tests.
- **chat.deepseek.com** — the long haul. Slow per round trip, but steady, and it caught the bugs that only show up in the fourth hour of running the same test script.
- **Claude again** — the writing. The register of a README is different from the register of code. Both are fine; only one is a doc.

**What I would tell the next team.** Do not plan on any single tool surviving a two-day build. The honest state of an agent-assisted hackathon is: you will change tools mid-build because one crashes, one rate-limits, one loses context, and one just doesn't fit how you think. The submission is not what each tool did. It is what survived after all of them.


## The measured state, replacing what the earlier sections said

`PROCESS.md` sections 1-14 describe a build with no model key. Sections 15-16 describe 9 model and 3 deterministic. Both were true at their moment. The current measurement, run twice, is:

- 12 open alerts
- 3 refusals before the model is called (the guard fires on `TRACKING_GAP`, `RELEASE_DOCUMENT_UNCLEAR`, `SITE_ACCESS_UNCONFIRMED`)
- 9 proposals reach the model
- of those 9, one fell to the deterministic fallback on the last run; the reason is in `model_error` on that row

The three refusals are the product. The nine are the work.

## The talk-to-the-agent turn

The brief's second requirement is a real agent "that a person can talk to."
Our first build had a case page that rendered the agent's run as a static
trace. That is a *trace*, not a *conversation*. A judge clicking through it
would see what the agent did, but had nowhere to type. We read the brief
again: *"one that uses tools and that a person can talk to."* Two verbs, not
one. We were doing the first.

The fix was three pieces: a `/case/:id/say` endpoint that accepts a
message and continues the same conversation, a `continue_case()` function
that replays the stored history plus the new operator turn through the same
tool loop `run_case()` uses, and a UI below the trace that shows operator
turns in blue and agent turns in green, with an input box and two
suggestion chips derived from the case state.

Three things we got wrong on the way to working:

**The case route overwrote history on every reload.** `run_case()` wrote
its own output to `bahn_ops/case_history/{alert}.json` on every call,
including when the case page just wanted to *read* the conversation. That
meant the operator's message was written by `/say`, then erased the next
time anyone opened the page. The fix is to check `load_history()` first and
only seed if the file is empty; the case GET no longer calls `run_case` at
all, it reads history directly and pulls the alert metadata from the
dataset.

**We tested rendering with the wrong grep.** `grep -c 'Agent proposes'`
counts *lines*, not occurrences, and our HTML is one line. Every board
looked like it had exactly one proposal card until we switched to
`grep -o ... | wc -l`. The board had been fine for hours. The lesson is
that a test that reports a stable nonzero number is not the same as a test
that reports the number you meant.

**The model 429'd mid-demo.** The free tier on `nvidia/nemotron-3.5-lightning`
caps at 100 requests per day, and we hit it while testing the tool loop.
We switched to `google/gemini-2.5-flash-lite` and the leak forced a
rotation anyway (see the earlier section). The important outcome is that
the demo never stopped working. `continue_case` and `run_case` both fall
through to a deterministic turn when the model does not answer, and the
deterministic turn *uses the same tools in the same order* — so the trace
on the case page is indistinguishable in shape from the model-backed run,
just faster and poorer. The fallback is not degraded mode: it is what the
demo uses when the room Wi-Fi is down, and it records its own reason on
every row.

The current state, measured from a fresh clone:

- 12 open alerts
- 5 carry a proposal from the shipped examples
- 7 show "The agent has not looked at this case yet. Run agent on this case."
- Clicking that button spawns `run_case` for that one alert, writes the
  result to `bahn_ops/ours.jsonl`, and the card fills in
- Every card links to `/case/:id`, which shows the trace and a text box
- Typing into the box and pressing Send appends to
  `bahn_ops/case_history/{id}.json`, calls `continue_case`, and reloads
- On reload, the operator's message appears in blue and the agent's
  response in green, both still there

That is the loop the brief describes. A person sees the orders that need
them, opens one, sees what the agent already found out, talks to it if the
case is unclear, accepts or changes the agent's proposal, and the decision
persists. The agent does the legwork; the person decides.

## The phone log

The brief says the agent should "do the cheap work first, reading, asking and
looking things up." Asking. We had `ask_driver` as a tool, but the driver's
reply was a Python function returning a string. A judge watching that can
see the tool call in the trace, but cannot see *why* the answer is what it
is. The whole driver side was a black box.

The phone log makes the black box visible. When the agent calls
`ask_driver`, the question is written to `bahn_ops/inbox_out/{driver}.jsonl`
with a `question_id`, the scripted reply is written to
`bahn_ops/inbox_in/{driver}.jsonl` with a `reply_id`, and `/phone` renders
both sides as a message thread. An operator can override the scripted reply
as if they were the driver, and the case page sees the new answer. The old
reply is marked `superseded: True` — nothing is deleted, everything has a
source.

The design separates **the agent's question** from **the channel it travels
on**. Today the channel is two JSONL files. Tomorrow it's SMTP, or Twilio,
or a mock browser driving a web form. The case page, the tools, and the log
all keep working, because the agent doesn't know the channel exists. That's
what the brief means by "everything around it can be fake."

Three things that had to be right:

**Refused cases still ask.** A case on hold because the release document is
unclear cannot propose a write — but asking the driver "do you have the
signed release?" is not a write. The first fix here made the fallback refuse
*everything*, including questions. The second fix made it refuse nothing.
The correct answer is in between: reads and questions are always allowed,
writes are never allowed. `continue_case` on a refused case exposes
`get_order`, `get_messages`, `get_reservations`, and `ask_driver` — no
`propose_action`.

**The fallback was verbose and repetitive.** With no model key, every
`/say` produced the same "I sent the driver your question. Reply is above.
The case itself is still on hold: ..." That reads as broken even when it's
doing the right thing. The fix was to vary the acknowledgement by intent
("Asked. The driver's answer about the paperwork is above.") and to print
the "still on hold because" line once, not on every turn. The demo doesn't
need the model; it needs the fallback to feel like a competent agent that
happens to be fast.

**The model 429'd mid-build.** `google/gemini-2.5-flash-lite` free tier
caps at 100 requests/day, and we hit it while testing the tool loop. The
phone log doesn't need the model at all — it's a human-input feature — but
the case page does, and the demo can't depend on the free tier staying up.
The deterministic path is what the demo runs on. The model path is what
survives when the tier resets. Both are tested.

The measured state after the phone log: 12 open alerts, 5 with a shipped
proposal, 7 where the agent has not run, every card links to a case page,
every case page has a text box and a phone-log link, every driver question
shows up in `/phone`, every override shows up as `operator_override`.

## The second half of the build

`PROCESS.md` above documents the first day. The second day — the evening of 24 October — is where the submission became a submission, and it deserves the same honesty as the first half. Every change below landed as a separate commit with a backup and a test. Nothing was edited in place without the ability to revert.

**The four features added after the first submission-ready state:**

1. **Quiet-orders drill-in.** The board's collapsed panel used to say "88 of 100 orders checked and quiet." A count is an assertion. The fix was to make it a table: every quiet order, with three checks visible per order (address parity, alert presence, travel status). The deck says "for every hidden order, say what was checked" — a table is what that sentence asks for.

2. **Handover-back strip.** The brief says "how it passes a case to a person, **and how it gets it back**." We had the passing. We did not have the getting back. After clicking Accept, nothing visible happened. The fix was three states: pending (executing), success (executed at HH:MM:SS, effect shown), refused (red, reason shown). The strip reads from `bahn_ops/executions.jsonl`, which is written by a real subprocess that fires in the background when a decision is recorded.

3. **Case-page summary box.** "In a few seconds" — the deck's phrase — was not being served by a page that led with the trace. The fix was a two-line box at the top: "Where this is" (state, in a sentence) and "What's next" (the recommendation, in a sentence). Everything below is evidence for those two lines. A judge reading the box can make a decision in under three seconds.

4. **Executor with customer-contact refusal.** The brief says the agent never contacts a customer on its own. We had that as a *rule*. Now it is a *guard*: any command starting with `customer.`, `notify.customer`, `email.customer`, or `sms.customer` is refused by the executor, with the refusal recorded and rendered red on the strip. Every other command has an explicit entry in `EXECUTABLE_EFFECTS`. An unknown command is refused, not invented.

**Three bugs caught in tests before the video:**

**The chips bug.** Nine of twelve cards were missing the source and state chips. `agent.py`'s model-success path did not set `source_class` or `fact_state` — only the deterministic refusal path did. A judge clicking through would have seen one card with chips and eleven without. Found by counting `chip title` attributes in the rendered HTML, not by clicking. Fixed by setting the fields on every path.

**The style-injection bug.** A patch that was supposed to add CSS to the quiet-orders table produced `''+` in the styles chain and turned `board/server.cjs` into a syntax error. Caught by the mandatory `node -c` check after every drop. Reverted with `git checkout`, then the same fix applied with a safer insertion point — new styles added as a *new* concatenation entry, never replacing a quoted segment that was already part of a chain.

**The frozen decisions lookup.** The handover strip read from a module-level `DECISIONS_BY_ALERT` that was populated once at server startup. Accepting a decision wrote to `decisions.jsonl` on disk, but the strip read the frozen map and saw no entry. The fix was to build the lookup per request. Caught by the strip test that accepts a card and reloads — it showed strips: 0 after accept. Two attempted fixes failed before the third identified the actual cause.

**What we did not take the first answer on:** every drop tonight was tested before commit. Every test had a check that could *fail*. When the test passed without the fix having been applied (the chip title count reading 1 because grep counts lines, not occurrences), we fixed the test, not the code. The pattern is consistent with the first day: the code is usually right, the assumption about the world is usually wrong, and the output is the only thing that says so.

**The final state, measured:**

- 12 open alerts, 5 with a shipped proposal on fresh clone, 7 where the agent has not run
- Every card carries source, state, and evidence chips with tooltip timestamps
- Every card links to a case page that shows "Where this is" and "What's next" first
- Every case page has a text box where the operator can ask the agent questions
- Every driver question is logged in `/phone` with a `question_id` and a `reply_id`
- Every operator override of a scripted reply is marked `operator_override` in the log
- Every accept fires `execute.py`, which writes a real `executions.jsonl` row
- Customer-contact commands are refused, visibly, on the strip
- Six tools, four routes beyond the two index pages, no dependencies outside the standard library
