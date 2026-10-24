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

The model path is wired and unproven. `call_model` builds a prompt from the real
records, parses JSON from the reply, and falls back to the deterministic path
with the error recorded in `model_error`. No key has been in `.env`, so all
twelve rows read `deterministic_fallback` and the brief's hardest requirement —
a language model doing the work in a loop — is built but not demonstrated. The
fallback exists so the control room is never empty, and it records why it fell
back, which is the honest version of the same page.

## What we would tell the next team

Get the brief before you get the stack. We spent the first hours building
something competent against a description that turned out to be a summary. The
expensive part was not the rewrite, it was the confidence we had in the wrong
direction.

Then read the operations context as carefully as the schema. It is where the
distinctions live — quoted versus booked, reported versus confirmed, present
versus authorised to collect. Those distinctions are the product.
