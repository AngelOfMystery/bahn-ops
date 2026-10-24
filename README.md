# Bahn Ops Controller

Prompt Operations Hackathon, 24-25 Oct 2026.
Bahn challenge: an agentic operations controller for car transport.

## Run on Linux or macOS

 python3 -m venv .venv
 .venv/bin/python -m pip install -r requirements.txt
 .venv/bin/python -m uvicorn app.main:app --reload --port 8000

## Run on Windows with Git Bash

 python -m venv .venv
 .venv/Scripts/python.exe -m pip install -r requirements.txt
 .venv/Scripts/python.exe -m uvicorn app.main:app --reload --port 8000

Health: http://127.0.0.1:8000/health

## Config

Copy .env.example to .env. No model key means the deterministic parser runs.
A key means the model parses orders.
