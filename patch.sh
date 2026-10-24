cd /c/Users/kiami/IdeaProjects/TESTING/bahn-packet && cat > server.cjs <<'VIBE_S5'
const h=require('http'),f=require('fs'),p=require('path');
const L=n=>{const x=p.join(__dirname,'dataset','data',n+'.jsonl');
 if(!f.existsSync(x))return[];return f.readFileSync(x,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean)};
const O=L('orders'),A=L('alerts'),D=L('addresses'),P=L('agent_proposals');
const IDX={};for(const a of D)if(a.id)IDX[a.id]=a;
const city=i=>{const a=IDX[i]||{};return a.city||a.locality||a.town||''};
const OM={};for(const o of O)OM[o.id]=o;
const live=P.filter(q=>!q.superseded_by_proposal_id&&!q.superseded_at).sort((a,b)=>String(a.created_at).localeCompare(String(b.created_at)));
const PA={},PO={};for(const q of live){if(q.alert_id)PA[q.alert_id]=q;if(q.order_id)PO[q.order_id]=q}
const S={critical:0,high:1,medium:2,low:3};
const Q=A.filter(a=>a.status==='OPEN').map(a=>{const o=OM[a.order_id]||{},q=PA[a.id]||PO[a.order_id]||{};
 return{r:o.reference||a.order_id,f:city(o.pickup_address_id)||o.pickup_site_id||'?',
 t:city(o.delivery_address_id)||o.delivery_site_id||'?',s:a.severity||'',y:a.summary||'',w:a.triggered_at||'',
 g:q.summary||'',ra:q.rationale||'',ev:(a.evidence_refs||[])[0]||''}})
 .sort((x,y)=>((S[x.s]??9)-(S[y.s]??9))||x.w.localeCompare(y.w));
const e=v=>String(v==null?'':v).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));
const b=Q.map(r=>`<div class=c><div class=h><b>${e(r.r)}</b><span>${e(r.f)} &rarr; ${e(r.t)}</span><small>${e(r.s)}</small></div>
<p class=w>${e(r.y)}</p>${r.g?`<div class=g><div class=gh>Agent proposes</div><p>${e(r.g)}</p>${r.ra?`<p class=gr><b>Why</b> ${e(r.ra)}</p>`:''}${r.ev?`<p class=ge>from <code>${e(r.ev)}</code></p>`:''}</div>`:''}
<div class=a><button onclick="this.parentNode.innerHTML='<span class=done>Accepted - agent proceeds</span>'">Accept</button>
<button onclick="this.parentNode.innerHTML='<span class=done>Changed - edit the plan</span>'">Change</button></div></div>`).join('');
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
</style><h1>Needs a person</h1><p class=m>${Q.length} open of ${A.length} alerts &middot; ${Q.filter(r=>r.g).length} with a proposal</p>${b||'<p>Nothing waiting.</p>'}`;
h.createServer((q,s)=>{s.writeHead(200,{'content-type':'text/html;charset=utf-8'});s.end(H)})
 .listen(4317,'127.0.0.1',()=>{console.log('UP');console.log('open',Q.length,'proposed',Q.filter(r=>r.g).length,'rationale',Q.filter(r=>r.ra).length,'evidence',Q.filter(r=>r.ev).length);
 console.log('statuses',[...new Set(P.map(x=>x.status).filter(Boolean))].join('|'));
 console.log('reviews',[...new Set(P.map(x=>x.review).filter(Boolean))].join('|'));
 console.log('commands',[...new Set(P.map(x=>x.command).filter(Boolean))].slice(0,8).join('|'));
 const w=Q.find(r=>r.g);console.log('sample',w?w.r+' :: '+w.g.slice(0,70):'none')});
VIBE_S5
node -c server.cjs && echo OK
node server.cjs & S=$!; sleep 2; curl -s http://127.0.0.1:4317 | grep -c 'Agent proposes'; curl -s http://127.0.0.1:4317 | grep -c 'from <code>'; curl -s -o /dev/null -w 'status=%{http_code}\n' http://127.0.0.1:4317; kill $S 2>/dev/null