const { render } = require('./page.js');
const { renderCase } = require('./case.js');
const { renderPhone } = require('./phone.js');
const h=require('http'),f=require('fs'),p=require('path'),cp=require('child_process');
const DEC=p.join(__dirname,'..','bahn_ops','decisions.jsonl');
const OURS=p.join(__dirname,'..','bahn_ops','ours.jsonl');
const EXE=p.join(__dirname,'..','bahn_ops','executions.jsonl');

const LD=()=>{try{if(!f.existsSync(DEC))return[];return f.readFileSync(DEC,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean)}catch(e){return[]}};
const LE=()=>{try{if(!f.existsSync(EXE))return[];return f.readFileSync(EXE,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean)}catch(e){return[]}};
const L=n=>{const x=p.join(__dirname,'dataset','data',n+'.jsonl');
 if(!f.existsSync(x))return[];return f.readFileSync(x,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean)};

const O=L('orders'),A=L('alerts'),D=L('addresses'),WI=L('work_items'),EP=L('order_endpoint_details');
const HUMAN_SUMMARIES=(()=>{
  try{
    const hp=p.join(__dirname,'..','bahn_ops','human_summaries.json');
    if(f.existsSync(hp)) return JSON.parse(f.readFileSync(hp,'utf8'));
  }catch(e){}
  return {};
})();

const refId = x => (x && typeof x === 'object') ? (x.id || x.ref || '') : String(x || '');
const refIds = arr => (arr || []).map(refId).filter(Boolean);

const P=(()=>{
  try{
    if(f.existsSync(OURS)){
      const r=f.readFileSync(OURS,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean)
        .map(q=>Object.assign({},q,{created_at:q.created_at||q.generated_at}));
      if(r.length)return r
    }
  }catch(e){}
  return L('agent_proposals').map(q=>Object.assign({},q,{
    created_at:q.created_at||q.generated_at,
    source:'shipped',
    model_error:null,
    superseded_by_proposal_id:null,
    superseded_at:null
  }))
})();

const IDX={};for(const a of D)if(a.id)IDX[a.id]=a;
const city=i=>{const a=IDX[i]||{};return a.city||a.locality||a.town||''};

// Human-readable labels for chips. The underlying values stay the same.
const SOURCE_LABEL = {
  app:'from the driver\'s app',
  site:'from the pickup or delivery site',
  driver:'from the driver',
  ferry:'from the ferry line',
  document:'from a document',
  billing:'from billing',
  customer:'from the customer',
  conversation:'from a conversation',
  message:'from a message',
  operator:'from an operator',
  unknown:'source unclear',
};
const STATE_LABEL = {
  stale:'stale — needs a fresh check',
  reported:'reported, not confirmed',
  quoted:'quoted, not booked',
  missing:'missing',
  disputed:'disputed by someone',
  conflicting:'two records disagree',
  confirmed:'confirmed',
};
const sourceLabel = k => SOURCE_LABEL[k] || k || 'source unclear';
const stateLabel = k => STATE_LABEL[k] || k || 'state unclear';
const OM={};for(const o of O)OM[o.id]=o;

const _oursExists=(()=>{try{return f.existsSync(OURS)}catch(e){return false}})();
const _all=P.filter(q=>!q.superseded_by_proposal_id&&!q.superseded_at);
const live=_oursExists?_all:P;
const PA={},PO={};
for(const q of live){if(q.alert_id)PA[q.alert_id]=q;if(q.order_id)PO[q.order_id]=q}


const S={critical:0,high:1,medium:2,low:3};

function buildCard(a){
  const o=OM[a.order_id]||{};
  const q=PA[a.id]||PO[a.order_id]||{};
  const hasProposal=!!(q.summary || q.stops_because);
  const decForAlert = (()=>{ try{ for(const x of LD()){ if(x.alert_id===a.id) return x } }catch(e){} return null })();
  return {
    r:o.reference||a.order_id,
    f:city(o.pickup_address_id)||o.pickup_site_id||'?',
    t:city(o.delivery_address_id)||o.delivery_site_id||'?',
    s:a.severity||'',
    y:a.summary||'',
    w:a.triggered_at||'',
    g:q.summary||'',
    ra:q.rationale||'',
    ev:refIds(a.evidence_refs)[0]||'',
    oev:refIds(q.evidence_refs).length,
    oevFirst:refIds(q.evidence_refs)[0]||'',
    sc:q.source_class||'',
    fs:q.fact_state||'',
    sb:q.stops_because||'',
    aid:a.id||'',
    cmd:q.command||'',
    me:q.model_error||'',
    hasProposal:hasProposal,
    wi:(()=>{const w=WI.find(x=>x.order_id===o.id);return w?{due:w.due_at||'',kind:w.kind||'',owner:w.owner||'',next:w.next_action||''}:null})(),
    ep:(()=>{
      const z=EP.filter(x=>x.order_id===o.id);
      const pu=z.find(x=>x.boundary==='PICKUP')||{};
      const de=z.find(x=>x.boundary==='DELIVERY')||{};
      return{
        pa:pu.access_status||'',pc:pu.last_confirmed_at||'',ps:pu.last_confirmed_source||'',
        da:de.access_status||'',dc:de.last_confirmed_at||'',ds:de.last_confirmed_source||''
      }
    })(),
    dec: decForAlert ? { decision:decForAlert.decision, command:decForAlert.command||'', at:decForAlert.at||'' } : null,
    exec: (()=>{
      try{ for(const x of LE()){ if(x.alert_id===a.id) return x } }catch(e){}
      return null;
    })(),
    human: HUMAN_SUMMARIES[a.id] ? { opener: HUMAN_SUMMARIES[a.id].opener, hint: HUMAN_SUMMARIES[a.id].hint } : null
  };
}

function buildQueue(){
  return A.filter(a=>a.status==='OPEN')
    .map(buildCard)
    .sort((x,y)=>((S[x.s]??9)-(S[y.s]??9))||String(x.w).localeCompare(String(y.w)));
}

const HID=A.filter(a=>a.status!=='OPEN').map(a=>({
  s:a.status,
  r:(a.resolution_reason||a.acknowledgement_reason||'').trim(),
  sig:a.signal||''
}));

function buildQuiet(){
  const alerted={};
  for(const a of A)if(a.status==='OPEN')alerted[a.order_id]=true;
  const reservations={};
  for(const r of L('travel_reservations')){
    const oid=r.order_id;
    if(oid){ if(!reservations[oid])reservations[oid]=[]; reservations[oid].push(r); }
  }
  const rows=[];
  let withAlert=0, quietCount=0, withSameCity=0, withQuotedOnly=0;
  for(const o of O){
    const oid=o.id;
    const pc=city(o.pickup_address_id), dc=city(o.delivery_address_id);
    const same = !!(pc && dc && pc.toLowerCase()===dc.toLowerCase());
    const alert = !!alerted[oid];
    const res = reservations[oid]||[];
    const quoted = res.filter(x=>String(x.status||'').toUpperCase()==='QUOTED').length;
    const booked = res.filter(x=>String(x.status||'').toUpperCase()==='BOOKED').length;
    const onlyQuoted = quoted>0 && booked===0;
    const checks = [
      {name:'address parity', ok: !same, note: same?'pickup and delivery same city: '+pc:'pickup and delivery differ'},
      {name:'alert presence', ok: !alert, note: alert?'open alert on this order':'no open alert'},
      {name:'travel status', ok: !onlyQuoted, note: onlyQuoted?'travel only quoted, nothing booked':(booked>0?'travel booked':(quoted>0?'travel quoted and booked':'no travel rows'))},
    ];
    const quiet = !alert && !onlyQuoted;
    if(alert)withAlert++;
    if(same)withSameCity++;
    if(onlyQuoted)withQuotedOnly++;
    if(quiet)quietCount++;
    rows.push({oid, ref:o.reference||oid, from: pc||'?', to: dc||'?', quiet, checks});
  }
  return {checked:rows.length, quiet:quietCount, withAlert, withSameCity, withQuotedOnly, total:O.length, rows};
}

const e=v=>String(v==null?'':v).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));

function renderCard(r){
  const triggered = String(r.w||'').slice(0,19).replace('T',' ');
  const factWhen = (r.ep && (r.ep.pc || r.ep.dc)) ? String(r.ep.pc || r.ep.dc).slice(0,19).replace('T',' ') : triggered;
  const factSource = (r.ep && (r.ep.ps || r.ep.ds)) ? String(r.ep.ps || r.ep.ds) : r.sc;
  const srcFull = factSource || r.sc || '';
  const stFull = r.fs || '';
  const chips='<div class=chips>'+
    (srcFull?'<span class=chip title="'+e(srcFull)+' — recorded at '+e(factWhen)+' (alert raised '+e(triggered)+')">'+e(sourceLabel(srcFull))+'</span>':'')+
    (stFull?'<span class="chip st" title="'+e(stFull)+' — recorded at '+e(factWhen)+' (alert raised '+e(triggered)+')">'+e(stateLabel(stFull))+'</span>':'')+
    (r.oev?'<span class="chip ev" title="'+r.oev+' pieces of evidence cited by the suggestion">'+r.oev+' source'+(r.oev===1?'':'s')+'</span>':'')+
    '</div>';
  const caseLink='<a class=caselink href="/case/'+encodeURIComponent(r.aid)+'">Open case &rarr;</a>';
  const header='<div class=h><b>'+e(r.r)+'</b><span>'+e(r.f)+' &rarr; '+e(r.t)+'</span><small>'+e(r.s)+'</small></div>';
  const what = r.human
    ? '<p class=w>'+e(r.human.opener)+'</p><p class=whint>'+e(r.human.hint)+'</p>'
    : '<p class=w>'+e(r.y)+'</p>';

  if(r.sb){
    return '<div class=c data-aid="'+e(r.aid)+'">'+header+what+chips+
      '<div class=stop><b>Agent stopped</b> '+e(r.sb)+'</div>'+
      '<div class=a><span class=dslot></span><button onclick="decide(\''+e(r.aid)+'\',\'change\',\''+e(r.cmd||'')+'\')">Change</button>'+caseLink+'</div>'+
      handoverStrip(r)+'</div>';
  }

  if(r.g){
    const effect='<div class=effect><b>Accepting will</b> run <code>'+e(r.cmd||'alert.resolve')+'</code> on '+e(r.r)+' &middot; no customer contact &middot; needs your approval</div>';
    return '<div class=c data-aid="'+e(r.aid)+'">'+header+what+chips+
      '<div class=g><div class=gh>Agent proposes</div><p>'+e(r.g)+'</p>'+
      (r.ra?'<p class=gr><b>Why</b> '+e(r.ra)+'</p>':'')+
      (r.oevFirst?'<p class=ge>from <code>'+e(r.oevFirst)+'</code>'+(r.oev>1?' and '+(r.oev-1)+' more':'')+'</p>':'')+
      '</div>'+effect+
      '<div class=a><span class=dslot></span>'+
      '<button class="act-accept" onclick="decide(\''+e(r.aid)+'\',\'accept\',\''+e(r.cmd||'')+'\')">Accept</button>'+
      '<button class="act-change" onclick="decide(\''+e(r.aid)+'\',\'change\',\''+e(r.cmd||'')+'\')">Change</button>'+
      caseLink+'</div>'+
      handoverStrip(r)+'</div>';
  }

  return '<div class="c notrun" data-aid="'+e(r.aid)+'">'+header+what+chips+
    '<div class=notrunbox><b>The agent has not looked at this case yet.</b> '+
    'Click below to run it on just this alert.</div>'+
    '<div class=a><span class=dslot></span>'+
    '<button class=runagent onclick="runAgent(\''+e(r.aid)+'\')">Run agent on this case</button>'+
    '<button class="act-change" onclick="decide(\''+e(r.aid)+'\',\'change\',\'\')">Change</button>'+
    caseLink+'</div></div>';
}

function handoverStrip(r){
  if(!r.dec) return '';
  const at = String(r.dec.at||'');
  const t = at.slice(11,19) || '?';
  const cmd = r.dec.command || 'alert.resolve';
  const decLine = '<div class="hstate done">&#10003; '+e(r.dec.decision)+' at '+e(t)+'</div>';

  if(r.exec){
    const exAt = String(r.exec.executed_at||'');
    const exT = exAt.slice(11,19) || '?';
    const status = r.exec.status || 'SUCCESS';
    const desc = r.exec.description || '';
    if(status === 'REFUSED'){
      return '<div class="handover refused">'+
        decLine+
        '<div class="hstate refused">&#10007; REFUSED &middot; '+e(desc)+'</div>'+
        '<div class="hstate">Command <code>'+e(cmd)+'</code> was not executed on '+e(r.r)+'</div>'+
        '<div class="hstate"><a href="/case/'+encodeURIComponent(r.aid)+'">view trace &rarr;</a></div>'+
        '</div>';
    }
    return '<div class="handover">'+
      decLine+
      '<div class="hstate">Executed at '+e(exT)+': '+e(desc)+'</div>'+
      '<div class="hstate">Case resolved &middot; <a href="/case/'+encodeURIComponent(r.aid)+'">view trace &rarr;</a></div>'+
      '</div>';
  }

  return '<div class="handover pending">'+
    decLine+
    '<div class="hstate">Executing <code>'+e(cmd)+'</code> on '+e(r.r)+'...</div>'+
    '<div class="hstate"><a href="/case/'+encodeURIComponent(r.aid)+'">view trace &rarr;</a></div>'+
    '</div>';
}

function renderPage(){
  const Q=buildQueue();
  const quiet=buildQuiet();
  const proposed=Q.filter(r=>r.g).length;
  const stopped=Q.filter(r=>r.sb).length;
  const notrun=Q.filter(r=>!r.g && !r.sb).length;
  const cards=Q.map(renderCard).join('');
  const hidWith=HID.filter(x=>x.r).length;
  const hidNone=HID.length-hidWith;
  const hidRows=HID.map(x=>'<li><code>'+e(x.sig)+'</code> <span class=hs>'+e(x.s)+'</span> '+(x.r?e(x.r):'<b class=hn>no reason recorded</b>')+'</li>').join('');
  const HIDBLOCK=HID.length?'<details class=hid><summary>'+HID.length+' closed alerts &middot; '+hidWith+' with a reason &middot; '+hidNone+' without</summary><ul>'+hidRows+'</ul></details>':'';
  const quietRows = quiet.rows.filter(r=>r.quiet).map(r=>{
    const checks = r.checks.map(c=>'<span class="qc '+(c.ok?'ok':'warn')+'">'+e(c.name)+'</span>').join('');
    return '<tr><td><code>'+e(r.ref)+'</code></td><td>'+e(r.from)+' &rarr; '+e(r.to)+'</td><td>'+checks+'</td></tr>';
  }).join('');
  const alertRows = quiet.rows.filter(r=>r.alert).map(r=>'<li><code>'+e(r.ref)+'</code> &middot; '+e(r.from)+' &rarr; '+e(r.to)+'</li>').join('');
  const QUIET='<details class=hid><summary><b>'+quiet.quiet+' of '+quiet.total+' orders checked and quiet</b> &middot; '+quiet.withAlert+' with an open alert &middot; '+quiet.withSameCity+' same-city pickup and delivery &middot; '+quiet.withQuotedOnly+' travel only quoted</summary>'+
    '<p class="qh">Every order was checked for three things: address parity (pickup and delivery city compared), alert presence (does the order have an open alert), travel status (is travel only quoted, never booked). An order that fails any check is on the board above, not here.</p>'+
    '<table class="qtable"><thead><tr><th>Order</th><th>Route</th><th>Checks</th></tr></thead><tbody>'+quietRows+'</tbody></table>'+
    (alertRows?'<p class="qh"><b>Orders with an open alert</b></p><ul class="qlist">'+alertRows+'</ul>':'')+
    '</details>';

  return '<!doctype html><meta charset=utf-8><title>Needs a person</title><style>'+
    'body{font:15px/1.55 system-ui;background:#f7f8f9;margin:0;padding:28px;color:#1a1d21;max-width:1180px}'+
    'h1{font-size:20px;margin:0 0 3px}'+
    '.m{color:#6b7280;font-size:13px;margin:0 0 22px}'+
    '.m b{color:#1a1d21}'+
    '.c{background:#fff;border:1px solid #e4e7ea;border-left:3px solid #b45309;border-radius:9px;padding:15px 17px;margin-bottom:10px}'+
    '.c.notrun{border-left-color:#6b7280;background:#fbfbfc}'+
    '.h{display:flex;gap:10px;align-items:baseline}.h span{font-weight:600}.h small{margin-left:auto;color:#b45309;text-transform:uppercase;font-size:11px}'+
    '.w{margin:8px 0 0;color:#333a41}'+
    '.chips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 0}'+
    '.chip{font:11px ui-monospace,monospace;background:#f4f6f8;border:1px solid #e4e7ea;border-radius:10px;padding:2px 8px;color:#4b5563}'+
    '.chip.st{background:#fff7ed;border-color:#fed7aa;color:#b45309}'+
    '.chip.ev{background:#f0fdf4;border-color:#bbf7d0;color:#15803d}'+
    '.chip.dc{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;margin-right:6px}'+
    '.g{margin:9px 0 0;background:#f4f6f8;border-radius:7px;padding:9px 11px;font-size:14px}'+
    '.gh{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#15803d;font-weight:700;margin-bottom:3px}'+
    '.g p{margin:0 0 4px}.gr{color:#4b5563;font-size:13px}.gr b{color:#15803d;font-weight:600;margin-right:4px}'+
    '.ge{font:12px ui-monospace,monospace;color:#6b7280}.ge code{background:#fff;border:1px solid #e4e7ea;border-radius:4px;padding:1px 5px}'+
    '.effect{margin:9px 0 0;padding:7px 10px;background:#eff6ff;border:1px solid #bfdbfe;border-radius:7px;font-size:12px;color:#1e3a8a}'+
    '.effect code{background:#fff;border:1px solid #bfdbfe;border-radius:4px;padding:1px 5px;font:11px ui-monospace,monospace}'+
    '.a{display:flex;gap:8px;align-items:center;margin-top:11px;flex-wrap:wrap}'+
    'button{font:inherit;font-size:13px;padding:5px 13px;border-radius:6px;border:1px solid #d5d9dd;background:#fff;cursor:pointer}'+
    'button:first-child{background:#15803d;border-color:#15803d;color:#fff}'+
    '.runagent{background:#1d4ed8;border-color:#1d4ed8;color:#fff}'+
    '.caselink{margin-left:auto;font-size:12px;color:#6b7280;text-decoration:none}'+
    '.caselink:hover{color:#15803d}'+
    '.stop{margin:9px 0 0;padding:9px 11px;background:#fff7ed;border:1px solid #fed7aa;border-radius:7px;font-size:13px;color:#7c2d12}'+
    '.stop b{color:#b45309;font-weight:600;margin-right:4px}'+
    '.notrunbox{margin:9px 0 0;padding:9px 11px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:7px;font-size:13px;color:#475569}'+
    '.notrunbox b{color:#1e293b}'+
    '.hid{margin:0 0 14px;font-size:13px;color:#4b5563}'+
    '.hid summary{cursor:pointer;padding:8px 12px;background:#fff;border:1px solid #e4e7ea;border-radius:7px}'+
    '.hid ul{margin:8px 0 0;padding:0 0 0 18px}.hid li{margin:4px 0;line-height:1.45}'+
    '.hid code{font:12px ui-monospace,monospace;background:#f4f6f8;padding:1px 5px;border-radius:4px}'+
    '.hs{color:#6b7280}.hn{color:#b45309}'+'.qh{margin:10px 0 8px;font-size:12px;color:#4b5563;line-height:1.5}'+'.qtable{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0}'+'.qtable th{text-align:left;padding:6px 8px;background:#f4f6f8;color:#374151;font-weight:600;border-bottom:1px solid #e4e7ea}'+'.qtable td{padding:6px 8px;border-bottom:1px solid #eef2f4;vertical-align:top}'+'.qtable td code{font:11px ui-monospace,monospace}'+'.qc{display:inline-block;font-size:10px;padding:1px 6px;border-radius:9px;margin-right:4px;text-transform:lowercase}'+'.qc.ok{background:#dcfce7;color:#14532d}'+'.qc.warn{background:#fef3c7;color:#78350f}'+'.qlist{margin:4px 0 0;padding:0 0 0 18px;font-size:12px;color:#4b5563}'+'.qlist code{font:11px ui-monospace,monospace;background:#f4f6f8;padding:1px 5px;border-radius:4px}'+
    '.a button:disabled{opacity:.45;cursor:not-allowed}'+'.handover{margin:11px 0 0;padding:9px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:7px;font-size:12px;color:#166534}'+'.handover .hstate{padding:2px 0}'+'.handover .hstate.done{font-weight:600;color:#15803d}'+'.handover .hstate code{background:#fff;border:1px solid #bbf7d0;border-radius:4px;padding:1px 5px;font:11px ui-monospace,monospace}'+'.handover a{color:#15803d;text-decoration:none}'+'.handover.refused{background:#fef2f2;border-color:#fecaca}'+'.handover.refused .hstate.done{color:#991b1b}'+'.handover .hstate.refused{color:#b91c1c;font-weight:600}'+'.handover.refused a{color:#b91c1c}'+'.handover.pending{background:#fef3c7;border-color:#fde68a;color:#78350f}'+'.handover.pending .hstate.done{color:#92400e}'+'.handover.pending a{color:#92400e}'+'.emptyboard{padding:32px 24px;text-align:center;color:#4b5563;background:#fff;border:1px dashed #d5d9dd;border-radius:9px;line-height:1.55}'+'.emptyboard b{color:#15803d;font-size:15px;display:block;margin-bottom:4px}'+'.whint{color:#6b7280;font-size:13px;margin:4px 0 0;line-height:1.5}'+'.btnspinner{display:inline-block;width:10px;height:10px;border:2px solid currentColor;border-radius:50%;border-top-color:transparent;animation:spin .7s linear infinite;margin-right:6px;vertical-align:middle}'+'@keyframes spin{to{transform:rotate(360deg)}}'+
    '</style><script>'+
    'async function decide(id,kind,cmd){'+
    ' try{const r=await fetch("/decide",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({alert_id:id,decision:kind,command:cmd||""})});'+
    ' const j=await r.json();if(j.ok){loadDecisions()}else{alert("could not record: "+(j.error||"unknown"))}}catch(e){alert("could not record: "+e.message)}}'+
    'async function runAgent(id){'+
    ' const btn=event.target;btn.disabled=true;btn.innerHTML="<span class=btnspinner></span>Running agent...";'+
    ' try{const r=await fetch("/run-case/"+encodeURIComponent(id),{method:"POST"});const j=await r.json();'+
    ' if(j.ok){location.reload()}else{btn.disabled=false;btn.textContent="Run agent on this case";alert("agent failed: "+(j.error||"unknown"))}}'+
    ' catch(e){btn.disabled=false;btn.textContent="Run agent on this case";alert("agent failed: "+e.message)}}'+
    'async function loadDecisions(){try{const r=await fetch("/decisions");const d=await r.json();const by={};for(const x of d)by[x.alert_id]=x;'+
    ' for(const el of document.querySelectorAll("[data-aid]")){const dec=by[el.getAttribute("data-aid")];const slot=el.querySelector(".dslot");if(!slot)continue;'+
    ' if(dec){slot.innerHTML="<span class=chip dc>"+dec.decision+" "+dec.at.slice(11,16)+"</span>";el.querySelectorAll(".act-accept,.act-change").forEach(b=>b.style.display="none")}}}catch(e){}}'+
    'document.addEventListener("DOMContentLoaded",loadDecisions);'+
    '</script>'+
    '<h1>Needs a person</h1><p style="margin:0 0 22px;font-size:13px"><a href="/phone" style="color:#6b7280;text-decoration:none">Phone log &rarr;</a></p>'+
    '<p class=m><b>'+proposed+'</b> ready for your call &middot; <b>'+stopped+'</b> that need more evidence'+
      (notrun>0?' &middot; <b>'+notrun+'</b> the agent is still working on':'')+
      ' &middot; <span style="color:#9ca3af">'+Q.length+' open in total</span></p>'+
    QUIET+HIDBLOCK+
    (cards||'<div class="emptyboard"><b>All '+quiet.total+' orders checked. Nothing needs you.</b><br>Every order passed address parity, alert presence, and travel status.</div>');
}

function runCaseFor(alertId, res){
  try{
    const py = "import sys,json;sys.path.insert(0,'.');from bahn_ops.case_chat import run_case;print(json.dumps(run_case('"+alertId.replace(/[^A-Za-z0-9_\-]/g,'')+"')))";
    const out = cp.execFileSync('python3',['-c',py],{cwd:p.join(__dirname,'..'),timeout:120000,encoding:'utf8'});
    const record = JSON.parse(out);
    if(!record.ok){
      res.writeHead(500,{'content-type':'application/json'});
      return res.end(JSON.stringify({ok:false,error:record.error||'unknown'}));
    }
    const prop = record.proposal || {};
    const row = {
      alert_id: record.alert_id,
      order_id: record.order_id,
      summary: prop.summary || '',
      rationale: prop.rationale || '',
      command: 'alert.resolve',
      evidence_refs: record.turns ? record.turns.map(t=>t.result||'').filter(Boolean).slice(0,6) : [],
      needs_approval: true,
      source_class: record.source_class || '',
      fact_state: record.fact_state || '',
      stops_because: record.refusal || '',
      model_error: record.model_error || '',
      source: record.mode || 'deterministic',
      status: 'PENDING_REVIEW',
      generated_at: record.generated_at
    };
    f.appendFileSync(OURS, JSON.stringify(row)+'\n', 'utf8');
    res.writeHead(200,{'content-type':'application/json'});
    return res.end(JSON.stringify({ok:true, record}));
  }catch(err){
    res.writeHead(500,{'content-type':'application/json'});
    return res.end(JSON.stringify({ok:false,error:String(err.message||err).slice(0,300)}));
  }
}

function sayToCase(alertId, message, res){
  try{
    const payload = JSON.stringify({alert_id: alertId, message: message});
    const py = "import sys,json;msg=json.loads(sys.stdin.read());sys.path.insert(0,'.');from bahn_ops.case_chat import continue_case;print(json.dumps(continue_case(msg['alert_id'], msg['message'])))";
    const out = cp.execFileSync('python3',['-c',py],{cwd:p.join(__dirname,'..'),input:payload,timeout:120000,encoding:'utf8'});
    const record = JSON.parse(out);
    res.writeHead(record.ok?200:500,{'content-type':'application/json'});
    return res.end(JSON.stringify(record));
  }catch(err){
    res.writeHead(500,{'content-type':'application/json'});
    return res.end(JSON.stringify({ok:false,error:String(err.message||err).slice(0,300)}));
  }
}

function readJsonBody(q, cb){
  let b='';
  q.on('data',c=>{b+=c});
  q.on('end',()=>{
    try{ cb(null, JSON.parse(b||'{}')) }catch(e){ cb(e) }
  });
}

h.createServer((q,s)=>{
  // POST /case/:id/say
  if(q.method==='POST' && q.url.match(/^\/case\/[^\/]+\/say/)){
    const m = q.url.match(/^\/case\/([^\/]+)\/say/);
    const id = decodeURIComponent(m[1]).replace(/[^A-Za-z0-9_\-]/g,'');
    return readJsonBody(q, (err, body)=>{
      if(err){s.writeHead(400,{'content-type':'application/json'});return s.end(JSON.stringify({ok:false,error:'bad json'}))}
      const message = (body && body.message) || '';
      if(!message.trim()){s.writeHead(400,{'content-type':'application/json'});return s.end(JSON.stringify({ok:false,error:'message required'}))}
      return sayToCase(id, message, s);
    });
  }

  // GET /case/:id -- metadata from dataset, history from disk (no re-run)
  if(q.url.startsWith('/case/')){
    const id=decodeURIComponent(q.url.slice(6).split('?')[0]).replace(/[^A-Za-z0-9_\-]/g,'');
    let r={ok:false,alert_id:id,error:'case engine not invoked'};
    try{
      const out=cp.execFileSync('python3',['-c',
        "import sys,json;sys.path.insert(0,'.');from bahn_ops.case_chat import _build_ctx,load_history,save_history;from bahn_ops.agent import source_class,fact_state;ctx,err=_build_ctx('"+id+"');" +
        "r={'ok':True,'alert_id':'" + id + "','order_id':(ctx.get('alert') or {}).get('order_id'),'reference':(ctx.get('order') or {}).get('reference'),'source_class':source_class(ctx['alert']),'fact_state':fact_state(ctx['alert']),'refusal':ctx.get('refusal'),'turns':[],'proposal':None,'history':load_history('" + id + "'),'mode':None,'driver_replies':[]};" +
        "h=r['history'];r['turns']=[x.get('turn') for x in h if x.get('role')=='agent' and x.get('turn')];" +
        "r['proposal']=r['turns'][-1] if r['turns'] else None;" +
        "r['mode']='conversation' if h else 'new';" +
        "print(json.dumps(r))"],
        {cwd:p.join(__dirname,'..'),timeout:30000,encoding:'utf8'});
      r=JSON.parse(out);
    }catch(e){ r={ok:false,alert_id:id,error:String(e.message||e).slice(0,240)}; }
    try{
      const py2 = "import sys,json;sys.path.insert(0,'.');from bahn_ops.case_chat import case_inbox;print(json.dumps(case_inbox('"+id+"')))";
      const out2 = cp.execFileSync('python3',['-c',py2],{cwd:p.join(__dirname,'..'),timeout:15000,encoding:'utf8'});
      const inboxData = JSON.parse(out2);
      if(inboxData && inboxData.length && inboxData[0].thread && inboxData[0].thread.length){
        r.phone = {driver_id: inboxData[0].driver_id, count: inboxData[0].thread.length, last: inboxData[0].thread[inboxData[0].thread.length-1]};
      }
    }catch(e){}
    const env={base:process.env.BAHN_MODEL_BASE_URL||'',model:process.env.BAHN_MODEL_NAME||'',keyPresent:!!process.env.BAHN_MODEL_API_KEY};
    s.writeHead(200,{'content-type':'text/html;charset=utf-8'});
    return s.end(renderCase(r,env));
  }

  if(q.method==='POST' && q.url.startsWith('/run-case/')){
    const id=decodeURIComponent(q.url.slice(10).split('?')[0]).replace(/[^A-Za-z0-9_\-]/g,'');
    return runCaseFor(id, s);
  }

  if(q.url==='/decisions'){
    s.writeHead(200,{'content-type':'application/json'});
    return s.end(JSON.stringify(LD()));
  }

  if(q.method==='POST' && q.url==='/decide'){
    let b='';
    q.on('data',c=>{b+=c});
    q.on('end',()=>{
      let d={};
      try{d=JSON.parse(b)}catch(e){s.writeHead(400,{'content-type':'application/json'});return s.end(JSON.stringify({ok:false,error:'bad json'}))}
      if(!d.alert_id||!d.decision){s.writeHead(400,{'content-type':'application/json'});return s.end(JSON.stringify({ok:false,error:'alert_id and decision required'}))}
      const row={alert_id:d.alert_id,decision:d.decision,command:d.command||'',at:new Date().toISOString()};
      f.appendFileSync(DEC,JSON.stringify(row)+'\n','utf8');
      // Fire the executor in the background; do not wait
      try{
        const child=cp.spawn('python3',['-m','bahn_ops.execute',d.alert_id],{
          cwd:p.join(__dirname,'..'),
          detached:true,
          stdio:'ignore'
        });
        child.unref();
      }catch(e){}
      s.writeHead(200,{'content-type':'application/json'});
      return s.end(JSON.stringify({ok:true,row}));
    });
    return;
  }

  // GET /phone -- all driver threads
  if(q.url==='/phone'){
    try{
      const py = "import sys,json;sys.path.insert(0,'.');from bahn_ops.inbox import all_drivers,thread;from bahn_ops.agent import load;drivers={d.get('id'):d for d in load('drivers') if d.get('id')};orders={o.get('id'):o for o in load('orders') if o.get('id')};out=[]\nfor d in all_drivers():\n  t=thread(d)\n  oid=None\n  for m in t:\n    if m.get('order_id'): oid=m['order_id']; break\n  drv=drivers.get(d) or {}\n  o=orders.get(oid) or {}\n  out.append({'driver_id':d,'driver_name':(drv.get('full_name') or drv.get('name') or ''),'order_reference':(o.get('reference') or ''),'order_id':oid,'thread':t})\nprint(json.dumps({'drivers':out}))";
      const out = cp.execFileSync('python3',['-c',py],{cwd:p.join(__dirname,'..'),timeout:30000,encoding:'utf8'});
      const data = JSON.parse(out);
      s.writeHead(200,{'content-type':'text/html;charset=utf-8'});
      return s.end(renderPhone(data));
    }catch(e){
      s.writeHead(500,{'content-type':'text/html;charset=utf-8'});
      return s.end('<pre>phone log error: '+e.message+'</pre>');
    }
  }

  // POST /phone/reply -- operator override
  if(q.method==='POST' && q.url==='/phone/reply'){
    return readJsonBody(q, (err, body)=>{
      if(err){s.writeHead(400,{'content-type':'application/json'});return s.end(JSON.stringify({ok:false,error:'bad json'}))}
      const qid = (body && body.question_id) || '';
      const reply = (body && body.reply) || '';
      if(!qid || !reply.trim()){s.writeHead(400,{'content-type':'application/json'});return s.end(JSON.stringify({ok:false,error:'question_id and reply required'}))}
      try{
        const payload = JSON.stringify({qid, reply});
        const py = "import sys,json;d=json.loads(sys.stdin.read());sys.path.insert(0,'.');from bahn_ops.inbox import override;print(json.dumps(override(d['qid'],d['reply'])))";
        const out = cp.execFileSync('python3',['-c',py],{cwd:p.join(__dirname,'..'),input:payload,timeout:30000,encoding:'utf8'});
        const record = JSON.parse(out);
        s.writeHead(record.ok?200:400,{'content-type':'application/json'});
        return s.end(JSON.stringify(record));
      }catch(e){
        s.writeHead(500,{'content-type':'application/json'});
        return s.end(JSON.stringify({ok:false,error:String(e.message||e).slice(0,300)}));
      }
    });
  }

  if(q.url==='/executions'){
    s.writeHead(200,{'content-type':'application/json'});
    return s.end(JSON.stringify(LE()));
  }

  if(q.url.match(/^\/executions\/[^\/]+/)){
    const m = q.url.match(/^\/executions\/([^\/]+)/);
    const id = decodeURIComponent(m[1]).replace(/[^A-Za-z0-9_\-]/g,'');
    let latest=null;
    try{ for(const x of LE()){ if(x.alert_id===id) latest=x } }catch(e){}
    s.writeHead(latest?200:404,{'content-type':'application/json'});
    return s.end(JSON.stringify(latest||{ok:false,error:'no execution'}));
  }

  s.writeHead(200,{'content-type':'text/html;charset=utf-8'});
  s.end(renderPage());
})
.listen(4317,'127.0.0.1',()=>{
  const Q=buildQueue();
  console.log('UP');
  console.log('open',Q.length,'proposed',Q.filter(r=>r.g).length,'stopped',Q.filter(r=>r.sb).length,'notrun',Q.filter(r=>!r.g&&!r.sb).length);
});
