cd /c/Users/kiami/IdeaProjects/TESTING/bahn-packet && cat > server.cjs <<'VIBE_S3'
const h=require('http'),f=require('fs'),p=require('path');
const L=n=>{const x=p.join(__dirname,'dataset','data',n+'.jsonl');
 if(!f.existsSync(x))return[];return f.readFileSync(x,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean)};
const O=L('orders'),A=L('alerts'),D=L('addresses');
const IDX={};for(const a of D)if(a.id)IDX[a.id]=a;
const city=i=>{const a=IDX[i]||{};return a.city||a.locality||a.town||''};
const OM={};for(const o of O)OM[o.id]=o;
const S={critical:0,high:1,medium:2,low:3};
const Q=A.filter(a=>a.status==='OPEN').map(a=>{const o=OM[a.order_id]||{};
 return{r:o.reference||a.order_id,f:city(o.pickup_address_id)||o.pickup_site_id||'?',
 t:city(o.delivery_address_id)||o.delivery_site_id||'?',s:a.severity||'',y:a.summary||'',w:a.triggered_at||''}})
 .sort((x,y)=>((S[x.s]??9)-(S[y.s]??9))||x.w.localeCompare(y.w));
const e=v=>String(v==null?'':v).replace(/[<>&]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;'}[c]));
const b=Q.map(r=>`<div class=c><div class=h><b>${e(r.r)}</b><span>${e(r.f)} &rarr; ${e(r.t)}</span><small>${e(r.s)}</small></div><p>${e(r.y)}</p></div>`).join('');
const H=`<!doctype html><meta charset=utf-8><title>Needs a person</title><style>body{font:15px/1.5 system-ui;background:#f7f8f9;margin:0;padding:28px;color:#1a1d21}h1{font-size:20px;margin:0 0 4px}.m{color:#6b7280;font-size:13px;margin:0 0 20px}.c{background:#fff;border:1px solid #e4e7ea;border-left:3px solid #b45309;border-radius:9px;padding:14px 16px;margin-bottom:10px}.h{display:flex;gap:10px;align-items:baseline}.h span{font-weight:600}.h small{margin-left:auto;color:#b45309;text-transform:uppercase;font-size:11px}p{margin:7px 0 0;color:#333a41}</style><h1>Needs a person</h1><p class=m>${Q.length} open of ${A.length} alerts &middot; ${O.length} orders</p>${b||'<p>Nothing waiting.</p>'}`;
h.createServer((q,s)=>{s.writeHead(200,{'content-type':'text/html;charset=utf-8'});s.end(H)})
 .listen(4317,'127.0.0.1',()=>{console.log('UP');console.log('orders',O.length,'alerts',A.length,'open',Q.length,'addr',D.length);
 console.log('addr_keys',Object.keys(D[0]||{}).join(','));console.log('first',Q[0]?Q[0].r+' '+Q[0].f+'->'+Q[0].t:'none')});
VIBE_S3
node -c server.cjs && echo OK
node server.cjs & S=$!; sleep 2; curl -s -o /dev/null -w 'status=%{http_code}\n' http://127.0.0.1:4317; kill $S 2>/dev/null