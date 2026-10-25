"use strict";

function esc(v) {
  return String(v == null ? "" : v).replace(/[<>&"]/g, function (c) {
    return { "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" }[c];
  });
}

function renderTrace(r) {
  return (r.turns || []).map(function (t) {
    if (t.tool) {
      return '<div class="turn tool"><code>' + esc(t.tool) + '</code>' +
        (t.args && Object.keys(t.args).length ? '<span class="args">' + esc(JSON.stringify(t.args)) + '</span>' : "") +
        '<pre>' + esc(t.result) + '</pre></div>';
    }
    if (t.assistant) {
      return '<div class="turn assistant">' + esc(t.assistant) + '</div>';
    }
    if (t.kind) {
      return '<div class="turn proposal"><b>' + esc(t.kind) + '</b><p>' + esc(t.summary) + '</p>' +
        '<p class="why">' + esc(t.rationale) + '</p></div>';
    }
    return "";
  }).join("");
}

function renderConversation(history) {
  if (!history || !history.length) {
    return '<p class="empty">No conversation yet. Ask the agent something below.</p>';
  }
  return history.map(function (h) {
    if (h.role === "operator") {
      return '<div class="msg op"><div class="who">You</div><div class="body">' + esc(h.content) + '</div>' +
        '<div class="when">' + esc((h.at || "").slice(11, 16)) + '</div></div>';
    }
    var t = h.turn || {};
    if (t.tool && t.tool !== "propose_action") {
      return '<div class="msg ag tool"><div class="who">Agent · tool</div><div class="body"><code>' + esc(t.tool) + '</code>' +
        (t.args && t.args.question ? '<span class="q"> &mdash; ' + esc(t.args.question) + '</span>' : '') +
        '<div class="res">' + esc(t.result) + '</div></div></div>';
    }
    if (t.tool === "propose_action") {
      return '<div class="msg ag propose"><div class="who">Agent · proposal</div><div class="body">' +
        '<b>' + esc((t.args && t.args.summary) || "") + '</b>' +
        '<p>' + esc((t.args && t.args.rationale) || "") + '</p></div></div>';
    }
    if (t.assistant) {
      return '<div class="msg ag"><div class="who">Agent</div><div class="body">' + esc(t.assistant) + '</div></div>';
    }
    if (t.kind) {
      return '<div class="msg ag ' + esc(t.kind) + '"><div class="who">Agent · ' + esc(t.kind) + '</div><div class="body">' +
        '<b>' + esc(t.summary || "") + '</b><p>' + esc(t.rationale || "") + '</p></div></div>';
    }
    return "";
  }).join("");
}

function stateHeadline(r) {
  if (!r.ok && r.error) return "The agent could not run on this case";
  if (r.refusal) return "Waiting for you";
  if (r.proposal && r.proposal.kind === "propose") return "Waiting for you";
  if (r.proposal && r.proposal.kind === "refuse") return "Waiting for you";
  return "The agent is still working on this case";
}

var REFUSAL_PLAIN = {
  "release document unclear; a quote is not a release":
    "The site has not confirmed that the signed release is on file. Until it does, the car cannot move.",
  "site access unconfirmed; vehicle presence is not pickup authority":
    "Someone reported the car is at the pickup site, but no one has confirmed the driver is allowed to collect it.",
  "position signal stale; ask the driver before changing a promise":
    "The driver's last known position is out of date. Ask the driver where they actually are before changing the delivery promise.",
};

function plainRefusal(r) {
  var reason = (r.refusal || "").trim();
  if (REFUSAL_PLAIN[reason]) return REFUSAL_PLAIN[reason];
  if (!reason) return "";
  return reason.charAt(0).toUpperCase() + reason.slice(1) + ".";
}

function summaryFor(r) {
  var history = r.history || [];
  var opTurns = history.filter(function(h){ return h.role === "operator"; }).length;
  var agTurns = history.filter(function(h){ return h.role === "agent"; }).length;
  var driverReplies = (r.driver_replies || []).length;

  // WHERE THIS IS
  var where = "";
  if (r.refusal) {
    where = plainRefusal(r);
  } else if (r.proposal && r.proposal.summary) {
    where = "A proposal is ready: " + r.proposal.summary;
  } else if (agTurns > 0) {
    where = "The agent has worked this case and is waiting for your decision.";
  } else {
    where = "The agent has not yet run on this case.";
  }
  if (driverReplies > 0) {
    where += " The driver replied " + driverReplies + " time" + (driverReplies === 1 ? "" : "s") + ".";
  }
  if (opTurns > 0) {
    where += " You have asked " + opTurns + " question" + (opTurns === 1 ? "" : "s") + ".";
  }

  // WHAT'S NEXT
  var next = "";
  if (r.refusal) {
    next = "Ask the driver whether they have it, or confirm with the site that it is on file. When the missing piece arrives, the case can move.";
  } else if (r.proposal && r.proposal.kind === "propose" && r.proposal.summary) {
    next = "Approve it \u2014 the effect is: " + (r.proposal.summary) + ". Or ask the agent one more question first.";
  } else if (agTurns > 0) {
    next = "Ask the agent another question, or run it again to get a proposal.";
  } else {
    next = "Run the agent on this case from the queue.";
  }

  return { where: where, next: next };
}

function suggestionsFor(r) {
  if (r.refusal) {
    return [
      "investigate",
      "What evidence would unblock this case?",
      "Ask the driver where exactly they are"
    ];
  }
  if (r.proposal && r.proposal.kind === "propose") {
    return [
      "investigate",
      "Ask the driver one more question before I accept",
      "What's the risk if I accept this now?"
    ];
  }
  return [
    "What's the situation here?",
    "Ask the driver if they're safe"
  ];
}

function renderCase(r, env) {
  var provider = (env && env.base) || "(default)";
  var model = (env && env.model) || "(default)";
  var modeLabel = r.mode || "deterministic";

  var failureBlock = (r && r.ok === false)
    ? '<div class="failure"><b>The agent did not run on this case</b><p>' +
      esc(r.error || 'unknown error') + '</p>' +
      '<a href="" class="retry">Retry &rarr;</a></div>'
    : "";
  var refusalBlock = r.refusal
    ? '<div class="refusal"><b>Agent stopped</b><p>' + esc(r.refusal) + '</p></div>'
    : "";

  var phoneBlock = r.phone
    ? '<a class="phonelink" href="/phone"><b>' + esc(r.phone.count) + '</b> message' +
      (r.phone.count === 1 ? '' : 's') + ' exchanged with <code>' + esc(r.phone.driver_id) + '</code> &middot; see the log &rarr;</a>'
    : "";

  var traceHtml = renderTrace(r);
  var convHtml = renderConversation(r.history || []);
  var chips = suggestionsFor(r).map(function (s) {
    return '<button class="sugg" onclick="say(this.dataset.q)" data-q="' + esc(s) + '">' + esc(s) + '</button>';
  }).join("");

  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Case ' + esc(r.reference || r.alert_id) + '</title>' +
    '<style>' +
    'body{font:15px/1.55 system-ui;background:#f7f8f9;margin:0;padding:28px;color:#1a1d21;max-width:840px}' +
    'a{color:#15803d}h1{font-size:20px;margin:0 0 4px}' +
    '.meta{color:#6b7280;font-size:13px;margin:0 0 20px}' +
    '.chips{display:flex;gap:6px;margin:0 0 18px;flex-wrap:wrap}' +
    '.chip{font:11px ui-monospace,monospace;background:#eef2f4;border-radius:4px;padding:2px 7px;color:#374151}' +
    '.chip.src{background:#dcfce7;color:#14532d}.chip.state{background:#fef3c7;color:#78350f}' +
    '.summarybox{background:#fff;border:1px solid #e4e7ea;border-left:3px solid #15803d;border-radius:8px;padding:12px 14px;margin:0 0 14px}' +
    '.sline{display:flex;gap:12px;padding:3px 0;font-size:14px;color:#1a1d21;line-height:1.45}' +
    '.slabel{flex:0 0 92px;font:11px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;font-weight:600;padding-top:3px}' +
    '.failure{background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #b91c1c;border-radius:8px;padding:12px 14px;margin:0 0 14px}' +
    '.failure b{color:#991b1b;display:block;margin-bottom:4px}' +
    '.failure p{margin:0;color:#7c2d12;font-size:13px}' +
    '.failure .retry{display:inline-block;margin-top:8px;font-size:12px;color:#b91c1c;text-decoration:none;font-weight:600}' +
    '.refusal{background:#fef2f2;border:1px solid #fecaca;border-left:4px solid #b91c1c;border-radius:8px;padding:12px 14px;margin:0 0 16px}' +
    '.phonelink{display:block;background:#f5f3ff;border:1px solid #ddd6fe;border-radius:8px;padding:9px 12px;margin:0 0 14px;font-size:13px;color:#5b21b6;text-decoration:none}' +
    '.phonelink code{background:#fff;border:1px solid #ddd6fe;border-radius:4px;padding:1px 5px;font:11px ui-monospace,monospace}' +
    '.phonelink:hover{background:#ede9fe}' +
    '.turn{border:1px solid #e4e7ea;background:#fff;border-radius:8px;padding:12px 14px;margin-bottom:10px}' +
    '.turn.tool code{font:12px ui-monospace,monospace;color:#15803d;font-weight:600}' +
    '.turn.tool .args{font:12px ui-monospace,monospace;color:#6b7280;margin-left:8px}' +
    '.turn pre{margin:8px 0 0;white-space:pre-wrap;font:12px ui-monospace,monospace;color:#374151;max-height:180px;overflow:auto}' +
    '.turn.proposal{border-color:#bbf7d0;background:#f0fdf4}.turn.proposal .why{color:#166534;font-size:13px;margin:6px 0 0}' +
    '.turn.assistant{background:#f9fafb}' +
    '.sec{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:26px 0 10px;font-weight:600}' +
    '.msg{border-radius:9px;padding:10px 14px;margin-bottom:8px;font-size:14px}' +
    '.msg .who{font-size:11px;text-transform:uppercase;letter-spacing:.05em;opacity:.8;margin-bottom:3px}' +
    '.msg .body p{margin:4px 0 0}.msg .when{font-size:11px;opacity:.55;margin-top:4px}' +
    '.msg.op{background:#eff6ff;border:1px solid #bfdbfe;color:#1e3a8a}' +
    '.msg.ag{background:#f0fdf4;border:1px solid #bbf7d0;color:#14532d}' +
    '.msg.ag.tool{background:#f8fafc;border-color:#e2e8f0;color:#334155}' +
    '.msg.ag.tool .res{font:11px ui-monospace,monospace;margin-top:4px;max-height:120px;overflow:auto;white-space:pre-wrap;opacity:.85}' +
    '.msg.ag.refuse{background:#fff7ed;border-color:#fed7aa;color:#7c2d12}' +
    '.say{display:flex;gap:8px;margin-top:12px}' +
    '.say input{flex:1;font:inherit;padding:9px 12px;border:1px solid #d5d9dd;border-radius:8px;background:#fff}' +
    '.say button{font:inherit;font-size:14px;padding:9px 18px;border-radius:8px;border:1px solid #15803d;background:#15803d;color:#fff;cursor:pointer}' +
    '.say button:disabled{opacity:.5;cursor:not-allowed}' +
    '.sugg{font:12px;padding:4px 10px;border-radius:12px;border:1px solid #d5d9dd;background:#fff;cursor:pointer;color:#374151;margin-right:6px}' +
    '.sugg:hover{background:#f4f6f8}' +
    '.empty{color:#6b7280;font-size:13px}' +
    '.env{margin-top:22px;color:#6b7280;font-size:12px;font-family:ui-monospace,monospace}' +
    '.src-badge{display:inline-block;padding:3px 9px;border-radius:10px;font-size:11px;font-weight:600;letter-spacing:.02em}' +
    '.src-badge.model{background:#dcfce7;color:#14532d;border:1px solid #86efac}' +
    '.src-badge.fallback{background:#fef3c7;color:#78350f;border:1px solid #fde68a}' +
    '.src-badge.unknown{background:#f4f6f8;color:#6b7280;border:1px solid #e4e7ea}' +
    '.back{display:inline-block;margin-bottom:18px;font-size:13px;text-decoration:none}' +
    '</style></head><body>' +
    '<a class="back" href="/">&larr; back to queue</a>' +
    '<h1>' + esc(stateHeadline(r)) + '</h1>' +
    '<p class="meta">' + esc(r.reference || r.alert_id) + ' &middot; <span style="color:#9ca3af">' + esc((r.driver_replies || []).length === 0 ? 'no driver replies yet' : (r.driver_replies || []).length + ' driver repl' + ((r.driver_replies || []).length === 1 ? 'y' : 'ies')) + '</span></p>' +
    '<div class="summarybox">' +
      '<div class="sline"><span class="slabel">Where this is</span><span>' + esc(summaryFor(r).where) + '</span></div>' +
      '<div class="sline"><span class="slabel">What\'s next</span><span>' + esc(summaryFor(r).next) + '</span></div>' +
    '</div>' +
    failureBlock +
    refusalBlock +
    phoneBlock +
    '<h2 class="sec">What the agent did</h2>' +
    (traceHtml || '<p class="empty">No turns yet.</p>') +
    '<h2 class="sec">Talk to the agent</h2>' +
    '<div id="convostream">' + convHtml + '</div>' +
    '<p style="margin:8px 0 0;font-size:13px"><a href="/phone" style="color:#6b7280;text-decoration:none">See every message the agent has sent this driver &rarr;</a></p>' +
    '<div class="suggrow" style="margin:8px 0">' + chips + '</div>' +
    '<div class="say">' +
    '<input id="sayin" placeholder="What should the agent do next?" autocomplete="off">' +
    '<button id="saybtn" onclick="say()">Send</button>' +
    '</div>' +
    '<p class="env">' +
      (r.source === 'model'
        ? '<span class="src-badge model">&#9679; source: model &middot; ' + esc(model) + '</span>'
        : (r.source === 'deterministic'
          ? '<span class="src-badge fallback">&#9679; source: deterministic fallback' + (r.model_error ? ' &middot; ' + esc(String(r.model_error).slice(0, 60)) : '') + '</span>'
          : '<span class="src-badge unknown">&#9679; source: ' + esc(r.source || 'unknown') + '</span>'
        )
      ) +
    '<span style="color:#9ca3af;font-size:11px;margin-left:8px">(configure in .env)</span>' +
    '</p>' +
    '<script>' +
    'var ALERT_ID=' + JSON.stringify(r.alert_id) + ';' +
    'async function say(q){' +
    '  var inp=document.getElementById("sayin");' +
    '  var msg=q!==undefined?q:(inp.value||"");' +
    '  if(!msg.trim())return;' +
    '  var btn=document.getElementById("saybtn");' +
    '  btn.disabled=true;btn.innerHTML="<span class=btnspinner></span>Sending...";' +
    '  var convo=document.getElementById("convostream");' +
    '  if(!convo){location.reload();return}' +
    '  var addMsg=function(cls,label,text){' +
    '    var d=document.createElement("div");d.className="msg "+cls;' +
    '    d.innerHTML="<div class=who>"+label+"</div><div class=body>"+text+"</div>";' +
    '    convo.appendChild(d);return d' +
    '  };' +
    '  addMsg("op","You",msg);' +
    '  var agentEl=addMsg("ag","Agent","");' +
    '  var agentBody=agentEl.querySelector(".body");' +
    '  try{' +
    '    var res=await fetch("/case/"+encodeURIComponent(ALERT_ID)+"/stream",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({message:msg})});' +
    '    var reader=res.body.getReader();' +
    '    var decoder=new TextDecoder();' +
    '    var buffer="";' +
    '    while(true){' +
    '      var rd=await reader.read();' +
    '      if(rd.done)break;' +
    '      buffer+=decoder.decode(rd.value,{stream:true});' +
    '      var events=buffer.split("\\n\\n");' +
    '      buffer=events.pop()||"";' +
    '      for(var evstr of events){' +
    '        if(!evstr.startsWith("data: "))continue;' +
    '        try{' +
    '          var ev=JSON.parse(evstr.slice(6));' +
    '          if(ev.event==="token"){agentBody.textContent+=(ev.data.text||"")}' +
    '          else if(ev.event==="tool_start"){agentBody.textContent+="\\n["+ev.data.tool+"]"}' +
    '          else if(ev.event==="tool_result"){agentBody.textContent+=" → "+(ev.data.result||"").slice(0,80)}' +
    '          else if(ev.event==="proposal"){agentBody.textContent+="\\n\\nProposal: "+(ev.data.summary||"")}' +
    '          else if(ev.event==="fallback"){agentBody.textContent+="\\n(fallback: "+(ev.data.reason||"")+")"}' +
    '          else if(ev.event==="done"||ev.event==="end"){location.reload();return}' +
    '          else if(ev.event==="error"){agentBody.textContent+="\\nError: "+(ev.data||"")}' +
    '        }catch(e){}' +
    '      }' +
    '    }' +
    '    location.reload();' +
    '  }catch(e){alert("agent failed: "+e.message);btn.disabled=false;btn.textContent="Send"}' +
    '}' +
    'document.addEventListener("keydown",function(e){if(e.key==="Enter"&&e.target.id==="sayin")say()});' +
    '</script>' +
    '</body></html>';
}

module.exports = { renderCase: renderCase };
