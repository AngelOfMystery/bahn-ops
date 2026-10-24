"use strict";

function esc(v) {
  return String(v == null ? "" : v).replace(/[<>&"]/g, function (c) {
    return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c];
  });
}

function renderCase(r, env) {
  var provider = (env && env.base) || "(default)";
  var model = (env && env.model) || "(default)";
  var modeLabel = env && env.keyPresent ? "model" : "deterministic";

  var refusalBlock = r.refusal
    ? '<div class="refusal"><b>Agent stopped</b><p>' + esc(r.refusal) + '</p></div>'
    : "";

  var turnsHtml = (r.turns || []).map(function (t) {
    if (t.tool) {
      return '<div class="turn tool"><code>' + esc(t.tool) + '</code>' +
        (t.args && Object.keys(t.args).length ? '<span class="args">' + esc(JSON.stringify(t.args)) + '</span>' : "") +
        '<pre>' + esc(t.result) + '</pre></div>';
    }
    if (t.assistant) {
      return '<div class="turn assistant">' + esc(t.assistant) + '</div>';
    }
    if (t.kind) {
      return '<div class="turn proposal"><b>' + esc(t.kind) + '</b><p>' + esc(t.summary) + '</p><p class="why">' + esc(t.rationale) + '</p></div>';
    }
    return "";
  }).join("");

  var driverHtml = (r.driver_replies || []).map(function (d) {
    return '<div class="turn driver"><div class="q">' + esc(d.q) + '</div><div class="a">' + esc(d.a) + '</div></div>';
  }).join("");

  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Case ' + esc(r.reference || r.alert_id) + '</title>' +
    '<style>' +
    'body{font:15px/1.55 system-ui;background:#f7f8f9;margin:0;padding:28px;color:#1a1d21}' +
    'a{color:#15803d}h1{font-size:20px;margin:0 0 4px}' +
    '.meta{color:#6b7280;font-size:13px;margin:0 0 20px}' +
    '.chips{display:flex;gap:6px;margin:0 0 18px;flex-wrap:wrap}' +
    '.chip{font:11px ui-monospace,monospace;background:#eef2f4;border-radius:4px;padding:2px 7px;color:#374151}' +
    '.chip.src{background:#dcfce7;color:#14532d}.chip.state{background:#fef3c7;color:#78350f}' +
    '.refusal{background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #b91c1c;border-radius:8px;padding:12px 14px;margin:0 0 16px}' +
    '.turn{border:1px solid #e4e7ea;background:#fff;border-radius:8px;padding:12px 14px;margin-bottom:10px}' +
    '.turn.tool code{font:12px ui-monospace,monospace;color:#15803d;font-weight:600}' +
    '.turn.tool .args{font:12px ui-monospace,monospace;color:#6b7280;margin-left:8px}' +
    '.turn pre{margin:8px 0 0;white-space:pre-wrap;font:12px ui-monospace,monospace;color:#374151;max-height:180px;overflow:auto}' +
    '.turn.driver{background:#eff6ff;border-color:#bfdbfe}.turn.driver .q{font-size:12px;color:#1e40af;margin-bottom:4px}' +
    '.turn.proposal{border-color:#bbf7d0;background:#f0fdf4}.turn.proposal .why{color:#166534;font-size:13px;margin:6px 0 0}' +
    '.turn.assistant{background:#f9fafb}' +
    '.empty{color:#6b7280;font-size:13px}' +
    '.env{margin-top:22px;color:#6b7280;font-size:12px;font-family:ui-monospace,monospace}' +
    '.back{display:inline-block;margin-bottom:18px;font-size:13px;text-decoration:none}' +
    '</style></head><body>' +
    '<a class="back" href="/">&larr; back to queue</a>' +
    '<h1>' + esc(r.reference || r.alert_id) + '</h1>' +
    '<p class="meta">alert ' + esc(r.alert_id) + ' &middot; mode ' + esc(r.mode || "deterministic") + ' &middot; ' + (r.tools || []).length + ' tools</p>' +
    '<div class="chips"><span class="chip src">' + esc(r.source_class || "?") + '</span>' +
    '<span class="chip state">' + esc(r.fact_state || "?") + '</span>' +
    '<span class="chip">' + esc((r.driver_replies || []).length) + ' driver replies</span></div>' +
    refusalBlock +
    (turnsHtml || '<p class="empty">No turns yet. This case did not reach the model.</p>') +
    (driverHtml ? '<h2 style="font-size:15px;margin:20px 0 8px">Driver answers</h2>' + driverHtml : "") +
    '<p class="env">provider ' + esc(provider) + ' &middot; model ' + esc(model) + ' &middot; running ' + esc(modeLabel) + ' (change in .env)</p>' +
    '</body></html>';
}

module.exports = { renderCase: renderCase };
