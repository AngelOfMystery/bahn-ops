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

The demo. First instinct was to show the agent succeeding. The brief's own
example - a Bentley stopped on a motorway with a red warning light - shows the
agent handing a person one decision and expecting a late delivery. We built the
handover and the escalation as the primary flow, not the happy path.

Our own escalation wording. The first version said "assignment failed." That is
a status, not a fact a person can act on. It now names the constraint and the
place: no driver with an open slot for class van near Espoo.

## What we would tell the next team

Get the brief before you get the stack. We spent the first hours building
something competent against a description that turned out to be a summary. The
expensive part was not the rewrite, it was the confidence we had in the wrong
direction.
