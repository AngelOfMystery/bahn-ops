# Bahn Ops Control Room

**A control room where an agent does the legwork on open alerts, and a person
makes the decisions.** Built for the Bahn Car Delivery Control Room challenge
at the Prompt Operations Hackathon, 24-25 October 2026.

Bahn moves used cars with freelance drivers. Every delivery is a chain of
people who do not work for Bahn: the seller holding the car, the driver, the
ferry line, whoever signs at the other end. When one link breaks, a person in
operations rebuilds the whole chain from phone logs. This is the room where
the chain is visible, and one agent that does the first link's work by itself.

**The agent area is _On the road_**: breakdowns, missed ships and delays for
cars already in motion. See `AGENT-AREA.md` for scope.

---

## What a person sees

The board shows only the alerts that need a person. Every card carries the
reason it surfaced, the agent's proposal, the rationale, the evidence ids, and
two classifications per fact — *who said it* (app, site, driver, ferry,
document, billing, customer) and *what state it is in* (stale, reported,
quoted, missing, disputed, conflicting). Where the evidence does not support
an action, the card shows **Agent stopped** with the missing fact instead of
an Accept button.

Above the queue, two collapsed summaries account for everything not on the
board: the quiet orders (checked, no reason to surface) and the closed alerts
(how many had a reason recorded, how many did not).

Open any card with **Open case →** and you see what happened, what the agent
already found out, what it suggests, and a text box where you can talk to the
agent — ask it a question, tell it to try something else, or ask what evidence
would unblock the case. The agent answers with its own tools (`ask_driver`,
`get_reservations`, `get_messages`). On the case page you can see the
operator's turns in blue and the agent's in green, both persisted across
reloads.

**The rule the whole build is built around:** a person says yes before the
agent changes anything — a booking, a date, a cost, or a message to a customer.
Asking and looking things up need no permission. Accepting a proposal writes a
decision to `bahn_ops/decisions.jsonl` with a timestamp. Reload and it is
still there.

## What a fresh clone shows

A fresh clone has no `bahn_ops/ours.jsonl`, so the board opens with the shipped
examples from `board/dataset/data/agent_proposals.jsonl` alongside the 12 open
alerts. **Five of those alerts carry a shipped proposal. The other seven show
_The agent has not looked at this case yet — Run agent on this case._** Click
that button and `bahn_ops/case_chat.py` runs on that one alert, writes the
result to `bahn_ops/ours.jsonl`, and the card fills in. The agent is not a page
of stale output, it is a button a person presses.

## Run it

Three entry points. Each runs on its own; none requires another.

### 1. Control room (Node, no dependencies)

    node board/server.cjs

Serves http://127.0.0.1:4317. Reads `bahn_ops/ours.jsonl` if present, falls
back to `board/dataset/data/agent_proposals.jsonl` if not.

### 2. Agent (Python 3, stdlib only)

    python3 bahn_ops/agent.py

Reads open alerts from `board/dataset/data`, writes one proposal per alert to
`bahn_ops/ours.jsonl`. Safe to rerun — alerts already present in that file are
skipped.

The model path calls any OpenAI-compatible chat endpoint. With no key it runs
a deterministic path and records why in `model_error`; with a key each row
records `source: model`. The fallback exists so the control room is never
empty, and it records its own reason.

### 3. Case conversation

Two entry points, both standard-library only:

    python3 -m bahn_ops.case_chat <alert_id>
    python3 -m bahn_ops.case_chat <alert_id> "ask the driver if they are safe"

The case page at `/case/:id` calls these via a subprocess and renders the
result. `POST /case/:id/say` accepts `{"message": "..."}` and continues the
same conversation, persisting to `bahn_ops/case_history/{id}.json`.

## Config

Copy `.env.example` to `.env` and fill locally. **Never commit `.env`.**

    BAHN_MODEL_API_KEY=
    BAHN_MODEL_BASE_URL=
    BAHN_MODEL_NAME=

Blank settings run the deterministic path. Any OpenAI-compatible endpoint
works: AnyAPI (`https://api.anyapi.ai/v1`), OpenRouter, OpenAI, or a local
server on `http://127.0.0.1:8080/v1` (llama.cpp, vLLM, LM Studio, Ollama).
`.env.example` lists all four. If a value is already set in your shell, it
wins over `.env`.

The build has been tested with `google/gemini-2.5-flash-lite` via AnyAPI.
`max_tokens` ships at 6000 for `agent.py` and 3000 for `case_chat.py`;
lowering it truncates reasoning models before they answer.

## How it works

The agent's three disciplines, visible on every card:

1. **Source and state per fact.** A quote is not a booking. A driver message
   is not a fresh location. An alert is a reason to look, not a diagnosis.
   Bahn's own `OPERATIONS-CONTEXT.md` warns about this exact class of error,
   and every card shows both classifications so a person checks the agent's
   reasoning instead of rebuilding it.

2. **Refuse before the model.** If the evidence cannot support an action,
   the deterministic refusal is written and the model is never called. Cheaper
   and better: the model invents commands when it is given hopeless cases.
   Three signals (`TRACKING_GAP`, `RELEASE_DOCUMENT_UNCLEAR`,
   `SITE_ACCESS_UNCONFIRMED`) are guarded this way, and the guard fires in
   `case_chat.py` before any tool is offered.

3. **Real tool loop, not a prompt wrapper.** `case_chat.py` runs a multi-turn
   conversation: the model calls tools, the tool results are fed back as
   `role=tool` messages, and the model is called again until it calls
   `propose_action` or exhausts `MAX_TURNS`. The model sees what the tools
   returned before it proposes. The trace on the case page is the
   conversation.

## What is in here

- `board/server.cjs` — the control room, no dependencies. Routes: `/`,
  `/case/:id`, `/case/:id/say`, `/run-case/:id`, `/decide`, `/decisions`.
- `board/page.js` — the queue page renderer.
- `board/case.js` — the case page renderer (trace + conversation + input box).
- `board/dataset/` — Bahn's synthetic dataset, 50 jsonl files.
- `bahn_ops/agent.py` — the batch proposal loop. Reads alerts, writes
  `ours.jsonl`.
- `bahn_ops/case_chat.py` — the per-case conversation loop with real tools.
  Two entry points: `run_case` (one-shot) and `continue_case` (operator turn).
- `bahn_ops/sweep.py` — checks the quiet orders and prints what was checked.
- `bahn_ops/ours.jsonl` — generated by the agent. Not tracked.
- `bahn_ops/decisions.jsonl` — Accept / Change decisions from the board. Not
  tracked.
- `bahn_ops/case_history/` — conversation history, one file per alert. Not
  tracked.
- `PROCESS.md` — how this was built with AI, written during the build.
- `AGENT-AREA.md` — scope of the _On the road_ agent.
- `verify.sh` — the fresh-clone smoke test.

## Verification

    node -c board/server.cjs && echo BOARD_SYNTAX_OK
    python3 -c "import ast,pathlib;ast.parse(pathlib.Path('bahn_ops/agent.py').read_text());print('AGENT_SYNTAX_OK')"
    python3 -c "import ast,pathlib;ast.parse(pathlib.Path('bahn_ops/case_chat.py').read_text());print('CHAT_SYNTAX_OK')"
    bash verify.sh

---

Prompt Operations Hackathon, 24-25 Oct 2026. Bahn challenge: an agentic
operations controller for car transport.
