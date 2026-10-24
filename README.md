# Bahn Ops Controller

Prompt Operations Hackathon, 24-25 Oct 2026.
Bahn challenge: an agentic operations controller for car transport.

Three entry points. Run them in any order; none depends on another.

## 1. The ops API (FastAPI)

    python3 -m venv .venv
    .venv/bin/python -m pip install -r requirements.txt
    .venv/bin/python -m uvicorn app.main:app --port 8000

Health: http://127.0.0.1:8000/health

Windows with Git Bash:

    python -m venv .venv
    .venv/Scripts/python.exe -m pip install -r requirements.txt
    .venv/Scripts/python.exe -m uvicorn app.main:app --port 8000

## 2. The control room (Node, no dependencies)

    node board/server.cjs

Serves http://127.0.0.1:4317 — only the orders that need a person, each with
its reason, the agent proposal, the rationale, and the ids the proposal
relied on. Reads bahn_ops/ours.jsonl when it exists and falls back to the
shipped board/dataset/data/agent_proposals.jsonl when it does not.

## 3. The agent (Python, stdlib only)

    python3 bahn_ops/agent.py

Reads the open alerts, writes one proposal per alert to bahn_ops/ours.jsonl.
Safe to rerun: alerts already present in that file are skipped, so the board
never double-counts. No model key means the deterministic path runs and each
row records why in model_error. A key means the model writes the proposal and
source reads model instead of deterministic.

## Config

Copy .env.example to .env and fill locally. Never commit .env.

    BAHN_MODEL_API_KEY=
    BAHN_MODEL_BASE_URL=
    BAHN_MODEL_NAME=

Blank settings run the deterministic parser.

## What is in here

- app/ — FastAPI shell, /health and a placeholder index.
- bahn_ops/controller.py — first build, deterministic order parsing, pricing,
  driver assignment. Kept as history; not the submission.
- bahn_ops/agent.py — the proposal loop. Deterministic fallback with no key.
- bahn_ops/ours.jsonl — generated. Delete it to force a clean rerun.
- board/server.cjs — the control room.
- board/dataset/ — Bahn's synthetic dataset, 50 jsonl files.
- PROCESS.md — how this was built with AI, written during the build.

## Verification

    curl -s http://127.0.0.1:8000/health
    node -c board/server.cjs
    python3 -c "import ast,pathlib;ast.parse(pathlib.Path('bahn_ops/agent.py').read_text());print('AGENT_SYNTAX_OK')"
