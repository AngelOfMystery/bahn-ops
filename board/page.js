const e = (v) => String(v == null ? '' : v).replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
const d10 = (s) => String(s || '').slice(0, 10);
const human = (s) => String(s || '').toLowerCase().replace(/_/g, ' ');

function endpointChips(ep) {
  if (!ep || (!ep.pa && !ep.da)) return '';
  const one = (label, status, confirmed, by) => {
    if (!status) return '';
    const conf = confirmed
      ? ` <span class=epconf>confirmed ${e(d10(confirmed))} by ${e(human(by))}</span>`
      : ' <span class=epnone>not confirmed</span>';
    return `<span class=eprow><span class=eplabel>${label}</span> <b class=epst>${e(human(status))}</b>${conf}</span>`;
  };
  return `<div class=ep>${one('pickup', ep.pa, ep.pc, ep.ps)}${one('delivery', ep.da, ep.dc, ep.ds)}</div>`;
}

function workItemBlock(wi) {
  if (!wi || !wi.next) return '';
  return `<div class=wi><div class=wihead><b>Bahn already opened this</b>` +
    `${wi.due ? `<span class=widue>due ${e(String(wi.due).slice(0, 16))}</span>` : ''}` +
    `${wi.owner ? `<span class=wiown>${e(wi.owner)}</span>` : ''}</div>` +
    `<p>${e(wi.next)}</p></div>`;
}

function decisionChip(d) {
  return `<span class="chip dc">${e(d.decision)} ${e(String(d.at || '').slice(11, 16))}</span>`;
}

function card(r) {
  const chips = `<div class=chips>` +
    `${r.sc ? `<span class=chip>${e(r.sc)}</span>` : ''}` +
    `${r.fs ? `<span class="chip st">${e(r.fs)}</span>` : ''}` +
    `${r.oev ? `<span class="chip ev">${r.oev} src</span>` : ''}` +
    `</div>`;
  const buttons = r.sb
    ? ''
    : `<button onclick="decide('${r.aid}','accept','${e(r.cmd || '')}')">Accept</button>`;
  return `<div class=c data-aid="${r.aid}">` +
    `<div class=h><b>${e(r.r)}</b><span>${e(r.f)} &rarr; ${e(r.t)}</span><small>${e(r.s)}</small></div>` +
    `<p class=w>${e(r.y)}</p>` +
    chips +
    endpointChips(r.ep) +
    workItemBlock(r.wi) +
    (r.sb ? `<div class=stop><b>Agent stopped</b> ${e(r.sb)}</div>` : '') +
    (!r.sb && r.me ? `<div class=fallback>Fallback: ${e(String(r.me).slice(0, 90))}</div>` : '') +
    `<div class=g><div class=gh>Agent proposes</div><p>${e(r.g)}</p>` +
    `${r.ra ? `<p class=gr><b>Why</b> ${e(r.ra)}</p>` : ''}</div>` +
    `<div class=a><span class=dslot></span>${buttons}` +
    `<button onclick="decide('${r.aid}','change','${e(r.cmd || '')}')">Change</button></div>` +
    `</div>`;
}

const STYLE = `body{font:15px/1.55 system-ui;background:#f7f8f9;margin:0;padding:28px;color:#1a1d21;max-width:1180px}
h1{font-size:20px;margin:0 0 3px}.m{color:#6b7280;font-size:13px;margin:0 0 22px}
h2.sec{font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#6b7280;margin:26px 0 10px;font-weight:600}
h2.sec span{color:#9ca3af;font-weight:400;text-transform:none;letter-spacing:0;margin-left:6px}
.c{background:#fff;border:1px solid #e4e7ea;border-left:3px solid #b45309;border-radius:9px;padding:15px 17px;margin-bottom:10px}
.c.calm{border-left-color:#15803d}
.h{display:flex;gap:10px;align-items:baseline}.h span{font-weight:600}.h small{margin-left:auto;color:#b45309;text-transform:uppercase;font-size:11px}
.c.calm .h small{color:#15803d}
.w{margin:8px 0 0;color:#333a41}
.chips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 0}
.chip{font:11px ui-monospace,monospace;background:#f4f6f8;border:1px solid #e4e7ea;border-radius:10px;padding:2px 8px;color:#4b5563}
.chip.st{background:#fff7ed;border-color:#fed7aa;color:#b45309}
.chip.ev{background:#f0fdf4;border-color:#bbf7d0;color:#15803d}
.chip.dc{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;margin-right:6px}
.ep{margin:8px 0 0;display:flex;gap:18px;flex-wrap:wrap;font-size:12px;color:#6b7280}
.eprow .eplabel{text-transform:uppercase;font-size:10px;letter-spacing:.05em;color:#9ca3af;margin-right:2px}
.eprow b.epst{color:#374151;font-weight:600}.epconf{color:#15803d}.epnone{color:#b45309}
.wi{margin:9px 0 0;padding:9px 11px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:7px}
.wihead b{color:#1d4ed8;font-size:11px;text-transform:uppercase;letter-spacing:.05em}
.widue{font:12px ui-monospace,monospace;color:#1d4ed8;margin-left:8px}.wiown{font-size:12px;color:#3b82f6;margin-left:8px}
.wi p{margin:5px 0 0;font-size:13px;color:#1e3a8a;line-height:1.5}
.stop{margin:9px 0 0;padding:9px 11px;background:#fff7ed;border:1px solid #fed7aa;border-radius:7px;font-size:13px;color:#7c2d12}
.stop b{color:#b45309;font-weight:600;margin-right:4px}
.fallback{margin:8px 0 0;font:12px ui-monospace,monospace;color:#6b7280}
.g{margin:9px 0 0;background:#f4f6f8;border-radius:7px;padding:9px 11px;font-size:14px}
.gh{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#15803d;font-weight:700;margin-bottom:3px}
.g p{margin:0 0 4px}.gr{color:#4b5563;font-size:13px}.gr b{color:#15803d;font-weight:600;margin-right:4px}
.a{display:flex;gap:8px;align-items:center;margin-top:11px}
button{font:inherit;font-size:13px;padding:5px 13px;border-radius:6px;border:1px solid #d5d9dd;background:#fff;cursor:pointer}
button:first-of-type{background:#15803d;border-color:#15803d;color:#fff}
.a button:disabled{opacity:.45;cursor:not-allowed}
.done{color:#15803d;font-size:13px;font-weight:600}
.hid{margin:0 0 18px;font-size:13px;color:#4b5563}
.hid summary{cursor:pointer;padding:8px 12px;background:#fff;border:1px solid #e4e7ea;border-radius:7px}
.hid ul{margin:8px 0 0;padding:0 0 0 18px}.hid li{margin:4px 0;line-height:1.45}
.hid code{font:12px ui-monospace,monospace;background:#f4f6f8;padding:1px 5px;border-radius:4px}
.hs{color:#6b7280}.hn{color:#b45309}
.empty{background:#fff;border:1px solid #e4e7ea;border-radius:9px;padding:28px 24px;text-align:center}
.empty h3{font-size:16px;margin:0 0 6px;color:#1a1d21}.empty p{margin:0;color:#6b7280;font-size:13px}`;

const SCRIPT = `<script>
async function decide(id,kind,cmd){
 try{
  const r=await fetch('/decide',{method:'POST',headers:{'content-type':'application/json'},
   body:JSON.stringify({alert_id:id,decision:kind,command:cmd||''})});
  const j=await r.json();
  if(j.ok){loadDecisions()}else{alert('could not record: '+(j.error||'unknown'))}
 }catch(e){alert('could not record: '+e.message)}
}
async function loadDecisions(){
 try{
  const r=await fetch('/decisions');const d=await r.json();const by={};
  for(const x of d){by[x.alert_id]=x}
  for(const el of document.querySelectorAll('[data-aid]')){
   const dec=by[el.getAttribute('data-aid')];const slot=el.querySelector('.dslot');
   if(!slot)continue;
   if(dec){slot.innerHTML='<span class="chip dc">'+dec.decision+' '+String(dec.at).slice(11,16)+'</span>';
    el.querySelectorAll('.a button').forEach(b=>b.disabled=true)}
  }
 }catch(e){}
}
document.addEventListener('DOMContentLoaded',loadDecisions);
</script>`;

function render({ open, hidden, proposals }) {
  const hasWi = (r) => Boolean(r.wi && r.wi.next);
  const withWi = open.filter(hasWi);
  const withoutWi = open.filter((r) => !hasWi(r));

  const hidWith = hidden.filter((x) => x.r).length;
  const hidNone = hidden.length - hidWith;
  const hidRows = hidden.map((x) =>
    `<li><code>${e(x.sig)}</code> <span class=hs>${e(x.s)}</span> ${x.r ? e(x.r) : '<b class=hn>no reason recorded</b>'}</li>`
  ).join('');
  const hidBlock = hidden.length
    ? `<details class=hid><summary>${hidden.length} hidden &middot; ${hidWith} with a recorded reason &middot; ${hidNone} without</summary><ul>${hidRows}</ul></details>`
    : '';

  const section = (title, sub, rows) => {
    if (!rows.length) return '';
    return `<h2 class=sec>${title}<span>${sub}</span></h2>` + rows.map(card).join('');
  };

  const queue = open.length
    ? section('Bahn already decided', `${withWi.length} orders with an owner and a due time`, withWi) +
      section('Nobody has decided', `${withoutWi.length} orders where the agent proposes`, withoutWi)
    : `<div class=empty><h3>Nothing needs a person</h3><p>The agent checked every open alert and none requires a decision. Hidden alerts are listed above with what was checked.</p></div>`;

  return `<!doctype html><meta charset=utf-8><title>Needs a person</title><style>${STYLE}</style>` +
    `<h1>Needs a person</h1>` +
    `<p class=m>${open.length} need a person &middot; ${proposals} with a suggested action</p>` +
    hidBlock + queue + SCRIPT;
}

module.exports = { render };
