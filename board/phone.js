"use strict";

function esc(v) {
  return String(v == null ? "" : v).replace(/[<>&"]/g, function (c) {
    return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c];
  });
}

function t(iso) {
  return String(iso || "").slice(11, 19);
}

function renderPhone(data) {
  var drivers = (data && data.drivers) || [];
  var blocks = drivers.map(function (d) {
    var rows = (d.thread || []).map(function (m) {
      var replyLabel = m.reply_source === "operator_override"
        ? "You (as driver)"
        : "Driver (scripted)";
      var replyClass = m.reply_source === "operator_override" ? "reply override" : "reply";
      return '<div class="thread-item">' +
        '<div class="qa">' +
        '<div class="ask"><span class="tag out">AGENT &rarr; DRIVER</span><span class="at">' + esc(t(m.asked_at)) + '</span>' +
        '<div class="body">' + esc(m.question) + '</div></div>' +
        '<div class="' + replyClass + '"><span class="tag in">' + esc(replyLabel) + '</span><span class="at">' + esc(t(m.reply_at)) + '</span>' +
        '<div class="body">' + esc(m.reply || "(no reply yet)") + '</div></div>' +
        '</div>' +
        '<form class="ov" data-qid="' + esc(m.question_id) + '">' +
        '<input name="reply" placeholder="Reply as the driver..." autocomplete="off">' +
        '<button type="submit">Send override</button>' +
        '</form>' +
        '</div>';
    }).join("");
    var drvName = d.driver_name ? ' — ' + d.driver_name : '';
    var ordRef  = d.order_reference ? ' · on ' + d.order_reference : '';
    return '<section class="driver">' +
      '<h2>' + esc(d.driver_id) + esc(drvName) + esc(ordRef) + ' <small>' + (d.thread || []).length + ' message' + ((d.thread || []).length === 1 ? '' : 's') + '</small></h2>' +
      (rows || '<p class="empty">No messages yet.</p>') +
      '</section>';
  }).join("");

  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Phone log</title><style>' +
    'body{font:15px/1.55 system-ui;background:#f7f8f9;margin:0;padding:28px;color:#1a1d21;max-width:920px}' +
    'a{color:#15803d}h1{font-size:20px;margin:0 0 3px}' +
    '.meta{color:#6b7280;font-size:13px;margin:0 0 24px}' +
    '.driver{background:#fff;border:1px solid #e4e7ea;border-radius:9px;padding:16px 18px;margin-bottom:14px}' +
    '.driver h2{font-size:14px;margin:0 0 12px;font-family:ui-monospace,monospace}' +
    '.driver h2 small{font-family:system-ui;font-weight:400;color:#6b7280;margin-left:6px}' +
    '.thread-item{border-top:1px solid #eef2f4;padding:12px 0}' +
    '.thread-item:first-of-type{border-top:0;padding-top:0}' +
    '.qa{display:grid;grid-template-columns:1fr 1fr;gap:12px}' +
    '.ask,.reply,.reply.override{border-radius:8px;padding:10px 12px;font-size:13px}' +
    '.ask{background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a}' +
    '.reply{background:#f0fdf4;border:1px solid #bbf7d0;color:#14532d}' +
    '.reply.override{background:#fef3c7;border:1px solid #fde68a;color:#78350f}' +
    '.tag{font-size:10px;text-transform:uppercase;letter-spacing:.06em;font-weight:600;opacity:.75}' +
    '.tag.out{color:#1e40af}.tag.in{color:#15803d}.reply.override .tag.in{color:#92400e}' +
    '.at{font:11px ui-monospace,monospace;opacity:.6;margin-left:8px}' +
    '.body{margin-top:4px;line-height:1.45}' +
    '.ov{display:flex;gap:8px;margin-top:8px}' +
    '.ov input{flex:1;font:inherit;font-size:13px;padding:7px 11px;border:1px solid #d5d9dd;border-radius:7px;background:#fff}' +
    '.ov button{font:inherit;font-size:13px;padding:7px 14px;border-radius:7px;border:1px solid #d5d9dd;background:#fff;cursor:pointer}' +
    '.ov button:hover{background:#f4f6f8}' +
    '.empty{color:#6b7280;font-size:13px;margin:0}' +
    '.back{display:inline-block;margin-bottom:18px;font-size:13px;text-decoration:none}' +
    '</style></head><body>' +
    '<a class="back" href="/">&larr; back to queue</a>' +
    '<h1>Phone log</h1>' +
    '<p class="meta">Every question the agent sent to a driver. Override any scripted reply to test the case page against a different answer.</p>' +
    (blocks || '<p class="empty">No messages yet. Ask a driver something from a case page.</p>') +
    '<script>' +
    'document.querySelectorAll(".ov").forEach(function(f){' +
    'f.addEventListener("submit",async function(e){' +
    '  e.preventDefault();' +
    '  var qid=f.dataset.qid;' +
    '  var val=f.querySelector("input").value.trim();' +
    '  if(!val)return;' +
    '  var btn=f.querySelector("button");btn.disabled=true;btn.textContent="Sending...";' +
    '  try{' +
    '    var r=await fetch("/phone/reply",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({question_id:qid,reply:val})});' +
    '    var j=await r.json();' +
    '    if(j.ok){location.reload()}else{alert("failed: "+(j.error||"unknown"));btn.disabled=false;btn.textContent="Send override"}' +
    '  }catch(err){alert("failed: "+err.message);btn.disabled=false;btn.textContent="Send override"}' +
    '});' +
    '});' +
    '</script>' +
    '</body></html>';
}

module.exports = { renderPhone: renderPhone };
