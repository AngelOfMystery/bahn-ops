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

Three, used for different jobs, all named because the brief asks which.

**Claude Code**, for the agent loop and the board route. Given: the brief, `OPERATIONS-CONTEXT.md`, the schema, and the current `agent.py`. It produced a working loop in one pass, but its first refusal guard fired on a status string instead of on evidence, which would have blocked nine valid cases. Caught by re-running the sweep.

**DeepSeek (VIBE bridge)**, for the schema reading and the evidence boundary work. Given: the file tree and the raw dataset. It misread `next_action` as an instruction twice before the schema's own sentence at line 306 settled it. The fix was a heading change, not a code change.

**GPT-family (Codex)**, for the FastAPI scaffold and the `verify.sh` gate. Given: the same brief and the initial `check.sh`. It reproduced the scaffold, but its output assumed a README it did not read, so the first `verify.sh` skipped the board entirely. Caught by running it.

## The measured state, replacing what the earlier sections said

`PROCESS.md` sections 1-14 describe a build with no model key. Sections 15-16 describe 9 model and 3 deterministic. Both were true at their moment. The current measurement, run twice, is:

- 12 open alerts
- 3 refusals before the model is called (the guard fires on `TRACKING_GAP`, `RELEASE_DOCUMENT_UNCLEAR`, `SITE_ACCESS_UNCONFIRMED`)
- 9 proposals reach the model
- of those 9, one fell to the deterministic fallback on the last run; the reason is in `model_error` on that row

The three refusals are the product. The nine are the work.
