const { render } = require('./page.js');
const { renderCase } = require('./case.js');
const h=require('http'),f=require('fs'),p=require('path');
const DEC=p.join(__dirname,'..','bahn_ops','decisions.jsonl');
const LD=()=>{try{if(!f.existsSync(DEC))return[];return f.readFileSync(DEC,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean)}catch(e){return[]}};
const L=n=>{const x=p.join(__dirname,'dataset','data',n+'.jsonl');
 if(!f.existsSync(x))return[];return f.readFileSync(x,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean)};
const O=L('orders'),A=L('alerts'),D=L('addresses'),WI=L('work_items'),EP=L('order_endpoint_details'),P=(()=>{const o=p.join(__dirname,'..','bahn_ops','ours.jsonl');try{if(f.existsSync(o)){const r=f.readFileSync(o,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean).map(q=>Object.assign({},q,{created_at:q.created_at||q.generated_at}));if(r.length)return r}}catch(e){}return L('agent_proposals').map(q=>Object.assign({},q,{summary:'',rationale:'',command:'',evidence_refs:[],source_class:'',fact_state:'',model_error:null,superseded_by_proposal_id:null,superseded_at:null,stops_because:'agent has not run; run bash verify.sh'}))})();
const HID2=A.filter(a=>a.status!=='OPEN').map(a=>({s:a.status||'',r:(a.resolution_reason||a.acknowledgement_reason||'').trim(),sig:a.signal||''}));
const IDX={};for(const a of D)if(a.id)IDX[a.id]=a;
const city=i=>{const a=IDX[i]||{};return a.city||a.locality||a.town||''};
const OM={};for(const o of O)OM[o.id]=o;
const _oursExists=(()=>{try{return f.existsSync(p.join(__dirname,'..','bahn_ops','ours.jsonl'))}catch(e){return false}})();
const _all=P.filter(q=>!q.superseded_by_proposal_id&&!q.superseded_at);
const live=_oursExists?_all:[];
const PA={},PO={};for(const q of live){if(q.alert_id)PA[q.alert_id]=q;if(q.order_id)PO[q.order_id]=q}
const S={critical:0,high:1,medium:2,low:3};
const Q=A.filter(a=>a.status==='OPEN').map(a=>{const o=OM[a.order_id]||{},q=PA[a.id]||PO[a.order_id]||{};
 return{r:o.reference||a.order_id,f:city(o.pickup_address_id)||o.pickup_site_id||'?',
 t:city(o.delivery_address_id)||o.delivery_site_id||'?',s:a.severity||'',y:a.summary||'',w:a.triggered_at||'',
 g:q.summary||'',ra:q.rationale||'',ev:(a.evidence_refs||[])[0]||'',oev:(q.evidence_refs||[]).length,sc:q.source_class||'',fs:q.fact_state||'',sb:q.stops_because||'',aid:a.id||'',cmd:q.command||'',me:q.model_error||'',wi:(()=>{const w=WI.find(x=>x.order_id===o.id);return w?{due:w.due_at||'',kind:w.kind||'',owner:w.owner||'',next:w.next_action||''}:null})(),ep:(()=>{const z=EP.filter(x=>x.order_id===o.id);const p=z.find(x=>x.boundary==='PICKUP')||{};const d=z.find(x=>x.boundary==='DELIVERY')||{};return{pa:p.access_status||'',pc:p.last_confirmed_at||'',ps:p.last_confirmed_source||'',da:d.access_status||'',dc:d.last_confirmed_at||'',ds:d.last_confirmed_source||''}})()}})
 .sort((x,y)=>((S[x.s]??9)-(S[y.s]??9))||x.w.localeCompare(y.w));
const e=v=>String(v==null?'':v).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
const b=Q.map(r=>`<div class=c data-aid="${r.aid}"><div class=h><b>${e(r.r)}</b><span>${e(r.f)} &rarr; ${e(r.t)}</span><small>${e(r.s)}</small></div>
<p class=w>${e(r.y)}</p><div class=chips>${r.sc?`<span class=chip>${e(r.sc)}</span>`:''}${r.fs?`<span class=chip st>${e(r.fs)}</span>`:''}${r.oev?`<span class=chip ev>${r.oev} src</span>`:''}</div>${r.sb?`<div class=stop><b>Agent stopped</b> ${e(r.sb)}</div>`:''}${!r.sb&&r.me?`<div class=fallback>Fallback: ${e(String(r.me).slice(0,90))}</div>`:''}${r.g?`<div class=g><div class=gh>Agent proposes</div><p>${e(r.g)}</p>${r.ra?`<p class=gr><b>Why</b> ${e(r.ra)}</p>`:''}${r.ev?`<p class=ge>from <code>${e(r.ev)}</code></p>`:''}</div>`:''}
<div class=a><span class=dslot></span>${r.sb?'':`<button onclick="decide('${r.aid}','accept','${r.cmd||''}')">Accept</button>`}
<button onclick="decide('${r.aid}','change','${r.cmd||''}')">Change</button></div></div>`).join('');
const HID=A.filter(a=>a.status!=='OPEN').map(a=>({
  s:a.status,
  r:(a.resolution_reason||a.acknowledgement_reason||'').trim(),
  sig:a.signal||''
}));
const HID_WITH=HID.filter(x=>x.r).length;
const HID_NONE=HID.length-HID_WITH;
const e2=v=>String(v==null?'':v).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
const hidRows=HID.map(x=>`<li><code>${e2(x.sig)}</code> <span class=hs>${e2(x.s)}</span> ${x.r?e2(x.r):'<b class=hn>no reason recorded</b>'}</li>`).join('');
const HIDBLOCK=HID.length?`<details class=hid><summary>${HID.length} hidden &middot; ${HID_WITH} with a recorded reason &middot; ${HID_NONE} without</summary><ul>${hidRows}</ul></details>`:'';

const H=`<!doctype html><meta charset=utf-8><title>Needs a person</title><style>
body{font:15px/1.55 system-ui;background:#f7f8f9;margin:0;padding:28px;color:#1a1d21}h1{font-size:20px;margin:0 0 3px}
.m{color:#6b7280;font-size:13px;margin:0 0 22px}.c{background:#fff;border:1px solid #e4e7ea;border-left:3px solid #b45309;border-radius:9px;padding:15px 17px;margin-bottom:10px}
.h{display:flex;gap:10px;align-items:baseline}.h span{font-weight:600}.h small{margin-left:auto;color:#b45309;text-transform:uppercase;font-size:11px}
.w{margin:8px 0 0;color:#333a41}.g{margin:9px 0 0;background:#f4f6f8;border-radius:7px;padding:9px 11px;font-size:14px}
.gh{font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:#15803d;font-weight:700;margin-bottom:3px}
.g p{margin:0 0 4px}.gr{color:#4b5563;font-size:13px}.gr b{color:#15803d;font-weight:600;margin-right:4px}
.ge{font:12px ui-monospace,monospace;color:#6b7280}.ge code{background:#fff;border:1px solid #e4e7ea;border-radius:4px;padding:1px 5px}
.a{display:flex;gap:8px;align-items:center;margin-top:11px}button{font:inherit;font-size:13px;padding:5px 13px;border-radius:6px;border:1px solid #d5d9dd;background:#fff;cursor:pointer}
button:first-child{background:#15803d;border-color:#15803d;color:#fff}.done{color:#15803d;font-size:13px;font-weight:600}
.hid{margin:0 0 18px;font-size:13px;color:#4b5563}.hid summary{cursor:pointer;padding:8px 12px;background:#fff;border:1px solid #e4e7ea;border-radius:7px}.hid ul{margin:8px 0 0;padding:0 0 0 18px}.hid li{margin:4px 0;line-height:1.45}.hid code{font:12px ui-monospace,monospace;background:#f4f6f8;padding:1px 5px;border-radius:4px}.hs{color:#6b7280}.hn{color:#b45309}.chips{display:flex;gap:6px;flex-wrap:wrap;margin:8px 0 0}.chip{font:11px ui-monospace,monospace;background:#f4f6f8;border:1px solid #e4e7ea;border-radius:10px;padding:2px 8px;color:#4b5563}.chip.st{background:#fff7ed;border-color:#fed7aa;color:#b45309}.chip.ev{background:#f0fdf4;border-color:#bbf7d0;color:#15803d}.chip.dc{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8;margin-right:6px}.a button:disabled{opacity:.45;cursor:not-allowed}.stop{margin:9px 0 0;padding:9px 11px;background:#fff7ed;border:1px solid #fed7aa;border-radius:7px;font-size:13px;color:#7c2d12}.stop b{color:#b45309;font-weight:600;margin-right:4px}.fallback{margin:8px 0 0;font:12px ui-monospace,monospace;color:#6b7280}</style><script>
async function decide(id,kind,cmd){
 try{
  const r=await fetch('/decide',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({alert_id:id,decision:kind,command:cmd||''})});
  const j=await r.json();
  if(j.ok){loadDecisions()}else{alert('could not record: '+(j.error||'unknown'))}
 }catch(e){alert('could not record: '+e.message)}
}
async function loadDecisions(){
 try{
  const r=await fetch('/decisions');
  const d=await r.json();
  const by={};
  for(const x of d){by[x.alert_id]=x}
  for(const el of document.querySelectorAll('[data-aid]')){
   const dec=by[el.getAttribute('data-aid')];
   const slot=el.querySelector('.dslot');
   if(!slot)continue;
   if(dec){slot.innerHTML='<span class=chip dc>'+dec.decision+' '+dec.at.slice(11,16)+'</span>';el.querySelectorAll('.a button').forEach(b=>b.disabled=true)}
  }
 }catch(e){}
}
document.addEventListener('DOMContentLoaded',loadDecisions);
</script><h1>Needs a person</h1><p class=m>${Q.length} need a person &middot; ${Q.filter(r=>r.g).length} with a suggested action</p>${HIDBLOCK}${b||'<p>Nothing waiting.</p>'}`;
h.createServer((q,s)=>{
 if(q.url.startsWith('/case/')){
    const id=decodeURIComponent(q.url.slice(6).split('?')[0]).replace(/[^A-Za-z0-9_\-]/g,'');
    let r={ok:false,alert_id:id,error:'case engine not invoked'};
    try{
      const out=require('child_process').execFileSync('python3',['-c',
        "import sys,json;sys.path.insert(0,'.');from bahn_ops.case_chat import run_case;print(json.dumps(run_case('"+id+"')))"],
        {cwd:require('path').join(__dirname,'..'),timeout:60000,encoding:'utf8'});
      r=JSON.parse(out);
    }catch(e){ r={ok:false,alert_id:id,error:String(e.message||e).slice(0,240)}; }
    const env={base:process.env.BAHN_MODEL_BASE_URL||'',model:process.env.BAHN_MODEL_NAME||'',keyPresent:!!process.env.BAHN_MODEL_API_KEY};
    s.writeHead(200,{'content-type':'text/html;charset=utf-8'});
    return s.end(renderCase(r,env));
  }
  if(q.url==='/decisions'){
  s.writeHead(200,{'content-type':'application/json'});
  s.end(JSON.stringify(LD()));
  return
 }
 if(q.method==='POST'&&q.url==='/decide'){
  let b='';
  q.on('data',c=>{b+=c});
  q.on('end',()=>{
   let d={};
   try{d=JSON.parse(b)}catch(e){s.writeHead(400,{'content-type':'application/json'});s.end(JSON.stringify({ok:false,error:'bad json'}));return}
   if(!d.alert_id||!d.decision){s.writeHead(400,{'content-type':'application/json'});s.end(JSON.stringify({ok:false,error:'alert_id and decision required'}));return}
   const row={alert_id:d.alert_id,decision:d.decision,command:d.command||'',at:new Date().toISOString()};
   f.appendFileSync(DEC,JSON.stringify(row)+'\n','utf8');
   s.writeHead(200,{'content-type':'application/json'});
   s.end(JSON.stringify({ok:true,row}));
   return
  });
  return
 }
 s.writeHead(200,{'content-type':'text/html;charset=utf-8'});
 s.end(render({open:Q,hidden:HID2,proposals:Q.filter(r=>r.g).length}))
})
 .listen(4317,'127.0.0.1',()=>{console.log('UP');console.log('open',Q.length,'proposed',Q.filter(r=>r.g).length,'rationale',Q.filter(r=>r.ra).length,'alert_level_evidence',Q.filter(r=>r.ev).length,'proposal_evidence',Q.filter(r=>r.oev).length);
 console.log('statuses',[...new Set(P.map(x=>x.status).filter(Boolean))].join('|'));
 console.log('reviews',[...new Set(P.map(x=>x.review).filter(Boolean))].join('|'));
 console.log('commands',[...new Set(P.map(x=>x.command).filter(Boolean))].slice(0,8).join('|'));
 const w=Q.find(r=>r.g);console.log('sample',w?w.r+' :: '+w.g.slice(0,70):'none')});
