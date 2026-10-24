from fastapi import FastAPI
from fastapi.responses import HTMLResponse

app = FastAPI(title="Bahn Ops Controller")


@app.get("/health")
def health() -> dict:
 return {"ok": True, "service": "bahn-ops"}


@app.get("/", response_class=HTMLResponse)
def index() -> str:
 return """<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><title>Bahn Ops</title></head>
<body><h1>Bahn Ops Controller</h1><p>Slice 1: boots.</p></body>
</html>"""
