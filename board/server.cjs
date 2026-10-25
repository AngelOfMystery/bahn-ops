// Load .env at startup so the case page can show provider/model
(function loadDotEnv(){
  try{
    const path = require('path');
    const fs = require('fs');
    const envPath = path.join(__dirname, '..', '.env');
    if(!fs.existsSync(envPath)) return;
    for(const line of fs.readFileSync(envPath, 'utf8').split('\n')){
      const s = line.trim();
      if(!s || s.startsWith('#') || !s.includes('=')) continue;
      const eq = s.indexOf('=');
      const k = s.slice(0, eq).trim();
      let v = s.slice(eq+1).trim();
      if((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if(k && !process.env[k]) process.env[k] = v;
    }
  }catch(e){}
})();

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
// Extra datasets for the paranoid quiet-order checks
const DOCS=L('documents');
const PROOFS=L('proofs');
const MSGS=L('messages');
const TRACK=L('tracking_observations');
const INCIDENTS=L('incidents');
const ASSIGN=L('work_assignments');
const CUSTODY=L('custody_asset_events');
const RES=L('travel_reservations');
const HUMAN_SUMMARIES=(()=>{
  try{
    const hp=p.join(__dirname,'..','bahn_ops','human_summaries.json');
    if(f.existsSync(hp)) return JSON.parse(f.readFileSync(hp,'utf8'));
  }catch(e){}
  return {};
})();

const refId = x => (x && typeof x === 'object') ? (x.id || x.ref || '') : String(x || '');
const refTable = x => (x && typeof x === 'object') ? (x.table || '') : '';
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
  // Endpoint source enums — these come from order_endpoint_details.last_confirmed_source
  MANAGED_SITE_PROFILE:'the site\'s own record',
  BRANCH_STOCK:'branch stock system',
  YARD_OPERATOR:'the yard operator',
  DRIVER_APP:'the driver\'s app',
  CUSTOMER_PORTAL:'the customer portal',
  DEALER_PORTAL:'the dealer portal',
  SITE_CONFIRMATION:'the site confirmed in person',
  OPERATOR_NOTE:'an operator note',
  FERRY_LINE:'the ferry line',
  DOCUMENT:'a document',
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
// Merge: our current proposals first, then shipped examples for any alert
// we have not yet produced a proposal for. Never lose a shipped example
// just because the local file exists.
const _all=(()=>{
  const ours = P.filter(q=>!q.superseded_by_proposal_id&&!q.superseded_at);
  const shipped = L('agent_proposals').map(q=>Object.assign({}, q, {
    created_at: q.created_at||q.generated_at,
    source:'shipped',
    model_error:null,
    superseded_by_proposal_id:null,
    superseded_at:null
  }));
  if (!ours.length) return shipped;
  const seen = new Set(ours.map(q => q.alert_id).filter(Boolean));
  const merged = [...ours];
  for (const q of shipped) {
    if (q.alert_id && !seen.has(q.alert_id)) merged.push(q);
  }
  return merged;
})();
const live=_all;
// Rebuilt per request — do NOT freeze at startup
function readOurs(){
  try{
    if(!f.existsSync(OURS))return[];
    return f.readFileSync(OURS,'utf8').split('\n').filter(Boolean).map(l=>{try{return JSON.parse(l)}catch(e){return null}}).filter(Boolean)
      .map(q=>Object.assign({},q,{created_at:q.created_at||q.generated_at}));
  }catch(e){return[]}
}
function buildProposalIndexes(){
  const pa={},po={};
  for(const q of readOurs()){
    if(q.superseded_by_proposal_id||q.superseded_at)continue;
    if(q.alert_id)pa[q.alert_id]=q;
    if(q.order_id)po[q.order_id]=q;
  }
  return {pa,po};
}

const S={critical:0,high:1,medium:2,low:3};

function buildCard(a, pa, po){
  const o=OM[a.order_id]||{};
  const q=(pa && pa[a.id]) || {};
  const hasProposal=!!(q.summary || q.stops_because);
  const decForAlert = (()=>{ try{ for(const x of LD()){ if(x.alert_id===a.id) return x } }catch(e){} return null })();
  return {
    r:o.reference||a.order_id,
    f:city(o.pickup_address_id)||o.pickup_site_id||'?',
    t:city(o.delivery_address_id)||o.delivery_site_id||'?',
    s:a.severity||'',
    status:a.status||'OPEN',
    y:a.summary||'',
    w:a.triggered_at||'',
    g:q.summary||'',
    ra:q.rationale||'',
    ev:refIds(a.evidence_refs)[0]||'',
    oev:refIds(q.evidence_refs).length,
    oevTables:(q.evidence_refs||[]).map(x=>refTable(x)).filter(Boolean),
    oevFirst:refIds(q.evidence_refs)[0]||'',
    sc:q.source_class||'',
    fs:q.fact_state||'',
    sb:q.stops_because||'',
    aid:a.id||'',
    cmd:String(q.command||'').replace(/[^A-Za-z0-9._-]/g,''),
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
  const {pa, po} = buildProposalIndexes();
  return A.filter(a=>a.status==='OPEN' || a.status==='ACKNOWLEDGED')
    .map(a=>buildCard(a, pa, po))
    .sort((x,y)=>((S[x.s]??9)-(S[y.s]??9))||String(x.w).localeCompare(String(y.w)));
}

const HID=A.filter(a=>a.status!=='OPEN' && a.status!=='ACKNOWLEDGED').map(a=>({
  s:a.status,
  r:(a.resolution_reason||a.acknowledgement_reason||'').trim(),
  sig:a.signal||''
}));

// Acknowledged but not resolved: still needs a person, but someone owns it.
// These stay on the board, marked as "acknowledged, still in progress."
const ACK_COUNT = A.filter(a=>a.status==='ACKNOWLEDGED').length;

function buildQuiet(){
  const grp=(arr)=>{const m={};for(const r of arr){if(r.order_id){(m[r.order_id]=m[r.order_id]||[]).push(r)}}return m};
  const NOTES=L('order_notes');
  const resBy=grp(RES),docBy=grp(DOCS),prfBy=grp(PROOFS),msgBy=grp(MSGS),trkBy=grp(TRACK),incBy=grp(INCIDENTS),asgBy=grp(ASSIGN),cusBy=grp(CUSTODY),notesBy=grp(NOTES);
  const ms=v=>{const t=Date.parse(v);return isNaN(t)?null:t};
  let snap=0;
  for(const arr of [MSGS,TRACK,A]){
    for(const r of arr){
      for(const k of ['authored_at','observed_at','triggered_at','received_at']){
        const t=ms(r[k]); if(t&&t>snap)snap=t;
      }
    }
  }
  if(!snap)snap=Date.now();
  const hrs=v=>{const t=ms(v);return t==null?null:Math.round((snap-t)/3600000)};
  const U=v=>String(v==null?'':v).toUpperCase();
  const norm=t=>' '+String(t).toLowerCase().replace(/[^a-z0-9äöüåéèñ]/g,' ')+' ';

  const alerted={};
  for(const a of A)if(a.status==='OPEN'||a.status==='ACKNOWLEDGED')alerted[a.order_id]=true;

  const cities=[...new Set(D.map(a=>String(a.city||a.locality||a.town||'').trim()).filter(c=>c.length>=4))];

  const rows=[];
  let quietCount=0, alertedCount=0, flaggedCount=0;

  for(const o of O){
    const oid=o.id;
    const pc=city(o.pickup_address_id);
    const dc=city(o.delivery_address_id);

    const asg=asgBy[oid]||[];
    const delivered=asg.some(a=>U(a.status)==='COMPLETED') && !asg.some(a=>U(a.status)==='IN_PROGRESS'||U(a.status)==='ASSIGNED');
    const active=asg.some(a=>U(a.status)==='IN_PROGRESS');
    const moving=active||delivered;

    const checks=[];
    const add=(key,name,state,note)=>checks.push({key,name,state,ok:state!=='fail',note});

    // 1. address vs notes (Tampere/Helsinki trap)
    const notes=notesBy[oid]||[];
    const msgs=msgBy[oid]||[];
    const texts=[];
    for(const n of notes)texts.push(String(n.body||''));
    for(const m of msgs)if(['customer','site_contact','handoff_contact'].includes(m.author_type))texts.push(String(m.body||''));
    const knownCities=[pc,dc].map(x=>String(x||'').toLowerCase());
    let conflict=null;
    for(const t of texts){
      for(const sent of String(t).split(/[.\n;]/)){
        const low=norm(sent);
        if(!/(deliver|drop|destination|address|hand.?over|receiv|pickup|pick up|collect)/.test(low))continue;
        for(const c of cities){
          const cl=c.toLowerCase();
          if(knownCities.includes(cl))continue;
          if(low.includes(' '+cl.replace(/[^a-z0-9äöüåéèñ]/g,' ')+' ')){conflict={c:c,s:sent.trim().slice(0,80)};break}
        }
        if(conflict)break;
      }
      if(conflict)break;
    }
    if(conflict)add('address','address vs notes','fail','a note mentions '+conflict.c+' but addresses say '+(pc||'?')+' → '+(dc||'?'));
    else add('address','address vs notes','ok','notes agree with addresses');

    // 2. alert presence
    const hasAlert=!!alerted[oid];
    if(hasAlert)add('alert','alert presence','fail','has an open or acknowledged alert');
    else add('alert','alert presence','ok','no open or acknowledged alert');

    // 3. travel risk — real fields: MISSED_CHECK_IN, snapshot_journey_state UNVERIFIED/REJECTED
    const res=resBy[oid]||[];
    const travelProblems=[];
    for(const r of res){
      const st=U(r.status);
      const js=U(r.snapshot_journey_state);
      const lab=String(r.route_label||r.kind||'travel');
      if(st==='MISSED_CHECK_IN')travelProblems.push(lab+': missed check-in');
      else if(js.includes('UNVERIFIED'))travelProblems.push(lab+': booked, use not verified');
      else if(js.includes('REJECTED')&&!js.includes('REBOOKED'))travelProblems.push(lab+': check-in rejected');
    }
    if(!res.length)add('travel','travel','na','no travel booked for this order');
    else if(travelProblems.length)add('travel','travel','fail',travelProblems.join('; '));
    else add('travel','travel','ok',res.length+' reservation(s) fine');

    // 4. paperwork — RELEASE_AUTHORITY only matters when moving
    const docs=docBy[oid]||[];
    const paperProblems=[];
    for(const d of docs){
      const kind=U(d.kind);
      const st=U(d.status);
      if(kind==='RELEASE_AUTHORITY'&&['MISSING','REQUESTED'].includes(st)&&moving){
        paperProblems.push('release authority is '+st.toLowerCase()+' but car is '+(delivered?'delivered':'moving'));
      }
      if(kind==='CMR'&&st==='MISSING'&&moving)paperProblems.push('CMR missing');
    }
    if(!docs.length)add('paperwork','paperwork','na','no documents on file');
    else if(paperProblems.length)add('paperwork','paperwork','fail',paperProblems.join('; '));
    else add('paperwork','paperwork','ok',docs.length+' document(s) fine');

    // 5. handover — only when delivered
    const prf=prfBy[oid]||[];
    const dphoto=prf.filter(x=>U(x.kind)==='DELIVERY_PHOTOS');
    const signedHandover=docs.some(d=>U(d.kind)==='SIGNED_HANDOVER'&&['SIGNED','VERIFIED'].includes(U(d.status)));
    const deliveryPhotosOk=dphoto.length>0&&dphoto.every(x=>['APPROVED','SUBMITTED'].includes(U(x.status)));
    const rejectedProofs=prf.filter(x=>U(x.status)==='REJECTED');
    const requiredProofs=prf.filter(x=>U(x.status)==='REQUIRED');
    if(!delivered)add('handover','handover','na','not delivered yet, nothing expected');
    else if(rejectedProofs.length)add('handover','handover','fail',rejectedProofs.map(x=>x.kind+' rejected').join('; '));
    else if(requiredProofs.length)add('handover','handover','fail',requiredProofs.map(x=>x.kind+' still required').join('; '));
    else if(!signedHandover&&!deliveryPhotosOk)add('handover','handover','fail','delivered, no signed handover or delivery photos');
    else add('handover','handover','ok','handover evidence present');

    // 6. assignment health
    const cancelled=asg.filter(a=>U(a.status)==='CANCELLED').length;
    const live=asg.filter(a=>U(a.status)!=='CANCELLED').length;
    if(!asg.length)add('assignment','assignment','na','no assignment yet');
    else if(cancelled>0&&live===0)add('assignment','assignment','fail','all assignments cancelled, none active');
    else add('assignment','assignment','ok',live+' active assignment(s)');

    // 7. message freshness — an inbound that has waited 3+ hours with no operator reply
    const sorted=[...msgs].sort((a,b)=>String(a.authored_at).localeCompare(String(b.authored_at)));
    const lastInbound=[...sorted].reverse().find(m=>['customer','site_contact','handoff_contact'].includes(m.author_type));
    if(!lastInbound)add('messages','messages','ok','no inbound messages to answer');
    else{
      const after=sorted.filter(m=>m.author_type==='operator'&&String(m.authored_at)>String(lastInbound.authored_at));
      const w=hrs(lastInbound.authored_at);
      if(after.length)add('messages','messages','ok','last inbound has a reply');
      else if(w!==null&&w>=3)add('messages','messages','fail','last '+lastInbound.author_type+' message '+w+'h old, no reply');
      else add('messages','messages','ok','last inbound recent');
    }

    // 8. tracking — only when moving
    const trk=trkBy[oid]||[];
    if(!moving)add('tracking','tracking','na','not on the road');
    else if(!trk.length)add('tracking','tracking','fail','on the road but no position reports');
    else{
      let last=null;
      for(const t of trk)if(!last||String(t.observed_at)>String(last))last=t.observed_at;
      const lh=hrs(last);
      if(lh!==null&&lh>6)add('tracking','tracking','fail','last position '+lh+'h old');
      else add('tracking','tracking','ok','position recent');
    }

    // 9. incidents — real statuses
    const inc=incBy[oid]||[];
    const openInc=inc.filter(i=>!i.resolved_at&&['INVESTIGATING','AWAITING_DECISION','NEEDS_HUMAN'].includes(U(i.status)));
    if(!inc.length)add('incidents','incidents','ok','no incidents');
    else if(openInc.length)add('incidents','incidents','fail',openInc.map(i=>i.kind+' ('+i.status.toLowerCase().replace(/_/g,' ')+')').join('; '));
    else add('incidents','incidents','ok',inc.length+' incident(s), resolved');

    const fails=checks.filter(c=>c.state==='fail');
    const isQuiet=!hasAlert&&fails.length===0;
    if(hasAlert)alertedCount++;
    if(isQuiet)quietCount++;
    if(!hasAlert&&fails.length>0)flaggedCount++;

    rows.push({oid,ref:o.reference||oid,from:pc||'?',to:dc||'?',hasAlert,quiet:isQuiet,fails,checks});
  }

  return {total:O.length,quiet:quietCount,alerted:alertedCount,flagged:flaggedCount,snap:new Date(snap).toISOString().slice(0,16).replace('T',' '),rows};
}

const e=v=>String(v==null?'':v).replace(/[<>&"]/g,c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;'}[c]));

function cmdInfo(cmd){
  const c=String(cmd||'').toLowerCase();
  const parts=c.split('.').filter(Boolean);
  const action=(parts.length>1?parts.slice(1).join(' '):(parts[0]||'review the case')).replace(/_/g,' ');
  const label=action.charAt(0).toUpperCase()+action.slice(1)+(parts.length>1?' ('+parts[0]+')':'');
  let touches='records your decision only';
  if(/rebook|book|ferry|hotel|ticket|reroute|re-route/.test(c)&&!/verify/.test(c))touches='may change a booking or add cost. Nothing is booked until you confirm';
  else if(/customer|dealer/.test(c))touches='involves the customer or dealer. Drafted for you to send, the agent never contacts them';
  else if(/driver/.test(c))touches='asks the driver (allowed). No booking, date or cost changes';
  else if(/date|promise|window|reschedul/.test(c))touches='moves a promised date. Needs your approval';
  else if(/verify|compare|review|check|request/.test(c))touches='asks for or compares evidence. No booking, date or cost changes';
  else if(c==='alert.resolve')touches='closes the alert. Nothing else changes';
  return {label:label,touches:touches};
}
function renderCard(r){
  const triggered = String(r.w||'').slice(0,19).replace('T',' ');
  const isAck = r.status === 'ACKNOWLEDGED';
  const factWhen = (r.ep && (r.ep.pc || r.ep.dc)) ? String(r.ep.pc || r.ep.dc).slice(0,19).replace('T',' ') : triggered;
  // The alert's own source is what surfaced the case. Only fall back to the
  // endpoint's last-confirmed source if the alert source is empty.
  const factSource = r.sc || (r.ep && (r.ep.ps || r.ep.ds)) || '';
  const srcFull = factSource || r.sc || '';
  const stFull = r.fs || '';
  const chips='<div class=chips>'+
    (srcFull?'<span class=chip title="'+e(srcFull)+' — recorded at '+e(factWhen)+' (alert raised '+e(triggered)+')">'+e(sourceLabel(srcFull))+'</span>':'')+
    (stFull?'<span class="chip st" title="'+e(stFull)+' — recorded at '+e(factWhen)+' (alert raised '+e(triggered)+')">'+e(stateLabel(stFull))+'</span>':'')+
    (r.oev?'<span class="chip ev" title="'+r.oev+' pieces of evidence cited: '+e((r.oevTables||[]).slice(0,4).join(', '))+(r.oevTables && r.oevTables.length>4?' and '+r.oevTables.length-4+' more':'')+'">'+r.oev+' source'+(r.oev===1?'':'s')+'</span>':'')+
    (isAck?'<span class="chip ack" title="Someone owns this case, but the recovery is not done">acknowledged</span>':'')+
    '</div>';
  const caseLink='<a class=caselink href="/case/'+encodeURIComponent(r.aid)+'">Open case &rarr;</a>';
  const header='<div class=h><b>'+e(r.r)+'</b><span>'+e(r.f)+' &rarr; '+e(r.t)+'</span><small class="sev-'+e(String(r.s).toLowerCase())+'">'+e(r.s)+'</small></div>';
  const what = r.human
    ? '<p class=w>'+e(r.human.opener)+'</p><p class=whint>'+e(r.human.hint)+'</p>'
    : '<p class=w>'+e(r.y)+'</p>';

  if(r.sb){
    return '<div class=c data-aid="'+e(r.aid)+'">'+header+what+chips+
      '<div class=stop><b>Not ready for action</b> '+e(r.sb)+'</div>'+
      '<div class=a><span class=dslot></span><button onclick="decide(\''+e(r.aid)+'\',\'change\',\''+e(r.cmd||'')+'\')">Choose another step</button>'+caseLink+'</div>'+
      handoverStrip(r)+'</div>';
  }

  if(r.g){
    const info=cmdInfo(r.cmd);const effect='<div class=effect><b>If you approve:</b> '+e(info.label)+' on '+e(r.r)+' &middot; '+e(info.touches)+'</div>';
    return '<div class=c data-aid="'+e(r.aid)+'">'+header+what+chips+
      '<div class=g><div class=gh>The agent suggests</div><p>'+e(r.g)+'</p>'+
      (r.ra?'<p class=gr><b>Because</b> '+e(r.ra)+'</p>':'')+
      (r.oevFirst?'<p class=ge>from <code>'+e(r.oevFirst)+'</code>'+(r.oev>1?' and '+(r.oev-1)+' more':'')+'</p>':'')+
      '</div>'+effect+
      '<div class=a><span class=dslot></span>'+
      '<button class="act-accept" onclick="decide(\''+e(r.aid)+'\',\'accept\',\''+e(r.cmd||'')+'\')">Approve: '+e(cmdInfo(r.cmd).label)+'</button>'+
      '<button class="act-change" onclick="decide(\''+e(r.aid)+'\',\'change\',\''+e(r.cmd||'')+'\')">Choose another step</button>'+
      caseLink+'</div>'+
      handoverStrip(r)+'</div>';
  }

  return '<div class="c notrun" data-aid="'+e(r.aid)+'">'+header+what+chips+
    '<div class=notrunbox><b>The agent has not reached this case yet.</b> '+
    'Click below to run it on just this alert.</div>'+
    '<div class=a><span class=dslot></span>'+
    '<button class=runagent onclick="runAgent(\''+e(r.aid)+'\')">Run agent on this case</button>'+
    '<button class="act-change" onclick="decide(\''+e(r.aid)+'\',\'change\',\'\')">Choose another step</button>'+
    caseLink+'</div></div>';
}

function handoverStrip(r){
  if(!r.dec) return '';
  const at = String(r.dec.at||'');
  const t = at.slice(11,19) || '?';
  const cmd = r.dec.command || 'alert.resolve';
  const decLine = '<div class="hstate done">&#10003; '+e(r.dec.decision)+' at '+e(t)+'</div>';

  // If a decision exists but isn't accept, show a revision state, not "executing".
  if(r.dec && r.dec.decision !== 'accept' && !r.exec){
    return '<div class="handover pending">'+
      decLine+
      '<div class="hstate">&#9679; REVISION REQUESTED &middot; open the case to tell the agent what to do instead.</div>'+
      '<div class="hstate"><a href="/case/'+encodeURIComponent(r.aid)+'">open the case &rarr;</a></div>'+
      '</div>';
  }

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
    if(status === 'PENDING'){
      return '<div class="handover pending">'+
        decLine+
        '<div class="hstate">&#9888; WAITING ON A PERSON &middot; '+e(desc)+'</div>'+
        '<div class="hstate">Command <code>'+e(cmd)+'</code> needs an operator\'s OK before it runs.</div>'+
        '<div class="hstate"><a href="/case/'+encodeURIComponent(r.aid)+'">view trace &rarr;</a></div>'+
        '</div>';
    }
    if(status === 'REQUESTED'){
      return '<div class="handover pending">'+
        decLine+
        '<div class="hstate">&#9679; REQUESTED at '+e(exT)+' &middot; '+e(desc)+'</div>'+
        '<div class="hstate">Command <code>'+e(cmd)+'</code> was recorded. The downstream system has not confirmed.</div>'+
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
  // Disjoint buckets: every card falls into exactly one bucket.
  const stopped=Q.filter(r=>r.sb).length;
  const ackOnly=Q.filter(r=>!r.sb && r.status==='ACKNOWLEDGED').length;
  const proposed=Q.filter(r=>!r.sb && r.status!=='ACKNOWLEDGED' && r.g).length;
  const notrun=Q.filter(r=>!r.sb && r.status!=='ACKNOWLEDGED' && !r.g).length;
  const cards=Q.map(renderCard).join('');
  const hidWith=HID.filter(x=>x.r).length;
  const hidNone=HID.length-hidWith;
  const hidRows=HID.map(x=>'<li><code>'+e(x.sig)+'</code> <span class=hs>'+e(x.s)+'</span> '+(x.r?e(x.r):'<b class=hn>no reason recorded</b>')+'</li>').join('');
  const HIDBLOCK=HID.length?'<details class=hid><summary>'+HID.length+' closed alerts &middot; '+hidWith+' with a reason &middot; '+hidNone+' without</summary><ul>'+hidRows+'</ul></details>':'';
  const flagged=quiet.rows.filter(r=>!r.hasAlert&&r.fails.length).sort((a,b)=>b.fails.length-a.fails.length);
  const failCell=r=>r.fails.map(c=>'<span class="qc warn" title="'+e(c.note)+'">'+e(c.name)+'</span>').join(' ');
  const flaggedRows=flagged.map(r=>'<tr><td><code>'+e(r.ref)+'</code></td><td>'+e(r.from)+' &rarr; '+e(r.to)+'</td><td>'+failCell(r)+' '+e(r.fails.map(c=>c.note).join(' · '))+'</td></tr>').join('');
  const quietRows=quiet.rows.filter(r=>r.quiet).map(r=>'<tr><td><code>'+e(r.ref)+'</code></td><td>'+e(r.from)+' &rarr; '+e(r.to)+'</td><td>'+r.checks.map(c=>'<span class="qc '+(c.state==='ok'?'ok':'na')+'" title="'+e(c.note)+'">'+e(c.name)+'</span>').join('')+'</td></tr>').join('');
  const alertedRows=quiet.rows.filter(r=>r.hasAlert).map(r=>'<li><code>'+e(r.ref)+'</code> &middot; '+e(r.from)+' &rarr; '+e(r.to)+(r.fails.length?' &middot; also: '+e(r.fails.map(c=>c.name).join(', ')):'')+'</li>').join('');
  const FLAG=flagged.length?'<details class=hid><summary><b>'+flagged.length+' more orders failed a check but have no alert</b></summary><p class="qh">Found by checking all '+quiet.total+' orders against the records. Snapshot clock: '+e(quiet.snap)+' UTC.</p><div class="qtable-wrap"><table class="qtable"><thead><tr><th>Order</th><th>Route</th><th>What the check found</th></tr></thead><tbody>'+flaggedRows+'</tbody></table></div></details>':'';
  const QUIET=FLAG+'<details class=hid><summary><b>'+quiet.quiet+' of '+quiet.total+' orders passed every check</b> &middot; '+quiet.flagged+' failed a check (no alert) &middot; '+quiet.alerted+' have an alert (on board)</summary><p class="qh">Stage-aware checks (snapshot clock '+e(quiet.snap)+' UTC). A check that does not apply yet (for example, handover proof before a car is delivered) is shown grey, not failed. Hover a check to see what was verified.</p><div class="qtable-wrap"><table class="qtable"><thead><tr><th>Order</th><th>Route</th><th>Checks</th></tr></thead><tbody>'+quietRows+'</tbody></table></div>'+(alertedRows?'<p class="qh"><b>Orders with an alert (on board above)</b></p><ul class="qlist">'+alertedRows+'</ul>':'')+'</details>';
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
    '.hs{color:#6b7280}.hn{color:#b45309}'+'.qh{margin:10px 0 8px;font-size:12px;color:#4b5563;line-height:1.5}'+'.qtable{width:100%;border-collapse:collapse;font-size:12px;margin:8px 0}'+'.qtable th{text-align:left;padding:6px 8px;background:#f4f6f8;color:#374151;font-weight:600;border-bottom:1px solid #e4e7ea}'+'.qtable td{padding:6px 8px;border-bottom:1px solid #eef2f4;vertical-align:top}'+'.qtable td code{font:11px ui-monospace,monospace}'+'.qc{display:inline-block;font-size:10px;padding:1px 6px;border-radius:9px;margin-right:4px;text-transform:lowercase}'+'.qc.ok{background:#dcfce7;color:#14532d}'+'.qc.warn{background:#fef3c7;color:#78350f}'+'.qc.na{background:#f4f6f8;color:#9ca3af;border:1px solid #e4e7ea}'+'.qc.fail{background:#fee2e2;color:#991b1b}'+'.qlist{margin:4px 0 0;padding:0 0 0 18px;font-size:12px;color:#4b5563}'+'.qlist code{font:11px ui-monospace,monospace;background:#f4f6f8;padding:1px 5px;border-radius:4px}'+
    '.a button:disabled{opacity:.45;cursor:not-allowed}'+'.handover{margin:11px 0 0;padding:9px 12px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:7px;font-size:12px;color:#166534}'+'.handover .hstate{padding:2px 0}'+'.handover .hstate.done{font-weight:600;color:#15803d}'+'.handover .hstate code{background:#fff;border:1px solid #bbf7d0;border-radius:4px;padding:1px 5px;font:11px ui-monospace,monospace}'+'.handover a{color:#15803d;text-decoration:none}'+'.handover.refused{background:#fef2f2;border-color:#fecaca}'+'.handover.refused .hstate.done{color:#991b1b}'+'.handover .hstate.refused{color:#b91c1c;font-weight:600}'+'.handover.refused a{color:#b91c1c}'+'.handover.pending{background:#fef3c7;border-color:#fde68a;color:#78350f}'+'.handover.pending .hstate.done{color:#92400e}'+'.handover.pending a{color:#92400e}'+'.emptyboard{padding:32px 24px;text-align:center;color:#4b5563;background:#fff;border:1px dashed #d5d9dd;border-radius:9px;line-height:1.55}'+'.emptyboard b{color:#15803d;font-size:15px;display:block;margin-bottom:4px}'+'.qtable-wrap{max-height:520px;overflow-y:auto;border:1px solid #e4e7ea;border-radius:7px;margin:8px 0}'+'.qtable-wrap .qtable{margin:0;border-radius:0}'+'.qc{cursor:help}'+'.sev-critical{color:#b91c1c!important;font-weight:700}.c.sel{outline:2px solid #1d4ed8}'+'.qc-fail{color:#b91c1c;font-size:11px;font-weight:600}'+'.chip.ack{background:#fef3c7;border-color:#fde68a;color:#92400e;font-weight:600}'+'.whint{color:#6b7280;font-size:13px;margin:4px 0 0;line-height:1.5}'+'.btnspinner{display:inline-block;width:10px;height:10px;border:2px solid currentColor;border-radius:50%;border-top-color:transparent;animation:spin .7s linear infinite;margin-right:6px;vertical-align:middle}'+'@keyframes spin{to{transform:rotate(360deg)}}'+
    '</style><script>'+
    'async function decide(id,kind,cmd){if(kind=="change"){location.href="/case/"+encodeURIComponent(id)+"#talk";return}'+
    ' try{const r=await fetch("/decide",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({alert_id:id,decision:kind,command:cmd||""})});'+
    ' const j=await r.json();if(j.ok){loadDecisions()}else{alert("could not record: "+(j.error||"unknown"))}}catch(e){alert("could not record: "+e.message)}}'+
    'async function runAll(btn){'+
    '  btn.disabled=true;'+
    '  btn.innerHTML="<span class=btnspinner></span>Agent is working";'+
    '  try{'+
    '    await fetch("/run-all",{method:"POST"});'+
    '    const t=setInterval(async()=>{'+
    '      try{'+
    '        const st=await (await fetch("/run-all/status")).json();'+
    '        btn.innerHTML="<span class=btnspinner></span>Agent: "+st.done+" of "+st.total+" done";'+
    '        if(!st.running){clearInterval(t);location.reload()}'+
    '      }catch(e){}'+
    '    },2500);'+
    '  }catch(e){btn.disabled=false;btn.textContent="Run failed"}'+
    '}'+
    'async function runAgent(id){'+
    ' const btn=event.target;btn.disabled=true;btn.innerHTML="<span class=btnspinner></span>Running agent...";'+
    ' try{const r=await fetch("/run-case/"+encodeURIComponent(id),{method:"POST"});const j=await r.json();'+
    ' if(j.ok){location.reload()}else{btn.disabled=false;btn.textContent="Run agent on this case";alert("agent failed: "+(j.error||"unknown"))}}'+
    ' catch(e){btn.disabled=false;btn.textContent="Run agent on this case";alert("agent failed: "+e.message)}}'+
    'async function loadDecisions(){try{const r=await fetch("/decisions");const d=await r.json();const by={};for(const x of d)by[x.alert_id]=x;'+
    ' for(const el of document.querySelectorAll("[data-aid]")){const dec=by[el.getAttribute("data-aid")];const slot=el.querySelector(".dslot");if(!slot)continue;'+
    ' if(dec){slot.innerHTML="<span class=chip dc>"+dec.decision+" "+dec.at.slice(11,16)+"</span>";el.querySelectorAll(".act-accept,.act-change").forEach(b=>b.style.display="none")}}}catch(e){}}'+
    'document.addEventListener("DOMContentLoaded",loadDecisions);'+'document.addEventListener("keydown",ev=>{const tn=ev.target.tagName;if(tn=="INPUT"||tn=="TEXTAREA")return;const cards=[...document.querySelectorAll(".c")];if(!cards.length)return;let i=cards.findIndex(c=>c.classList.contains("sel"));if(ev.key=="j"||ev.key=="k"){ev.preventDefault();if(i>=0)cards[i].classList.remove("sel");i=ev.key=="j"?Math.min(cards.length-1,i+1):Math.max(0,i<0?0:i-1);cards[i].classList.add("sel");cards[i].scrollIntoView({block:"center"})}if(ev.key=="Enter"&&i>=0){const l=cards[i].querySelector(".caselink");if(l)location.href=l.href}});'+
    '</script>'+
    '<h1>Needs a person</h1><p style="margin:0 0 22px;font-size:13px"><a href="/phone" style="color:#6b7280;text-decoration:none">Phone log &rarr;</a></p>'+
    '<p class=m><b>'+proposed+'</b> ready for your call &middot; <b>'+stopped+'</b> that need more evidence'+
      (ackOnly>0?' &middot; <b>'+ackOnly+'</b> acknowledged, still in progress':'')+
      (notrun>0?' &middot; <b>'+notrun+'</b> the agent is still working on':'')+
      ' &middot; <span style="color:#9ca3af">'+Q.length+' on the board</span></p>'+
    ((notrun+ackOnly)>0?'<p class=m><button class=runagent onclick="runAll(this)">Run the agent on the '+(notrun+ackOnly)+' cases that need a proposal</button></p>':'')+QUIET+HIDBLOCK+
    (cards||'<div class="emptyboard"><b>All '+quiet.total+' orders passed the automated checks. Nothing needs you right now.</b><br>Nine automated checks per order — address parity, alert presence, travel status, release document, handover proof, assignment health, message freshness, tracking freshness, condition claim.</div>');
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
    // Preserve the agent's actual command if it named one. Fall back to
    // alert.resolve only when the proposal had no command at all.
    const propCommand = (prop.command || '').trim();
    // Never invent an executable command for an incomplete proposal.
    const command = propCommand;
    // Evidence refs: prefer ids the proposal actually cited. If absent,
    // derive typed refs from the alert and order ids.
    const evidenceRefs = (() => {
      const propRefs = prop.evidence_refs || [];
      if (Array.isArray(propRefs) && propRefs.length) return propRefs;
      const ids = [];
      if (record.alert_id) ids.push({id: record.alert_id, table: 'alerts'});
      if (record.order_id) ids.push({id: record.order_id, table: 'orders'});
      return ids;
    })();
    const row = {
      alert_id: record.alert_id,
      order_id: record.order_id,
      summary: prop.summary || '',
      rationale: prop.rationale || '',
      command: command,
      evidence_refs: evidenceRefs,
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

const { promisify } = require('util');
const execFileP = promisify(cp.execFile);
const AUTO = { running: false, done: 0, total: 0, errors: [] };

async function runCaseAsync(alertId) {
  const id = String(alertId).replace(/[^A-Za-z0-9_\-]/g, '');
  const py = "import sys,json;sys.path.insert(0,'.');from bahn_ops.case_chat import run_case;print(json.dumps(run_case('" + id + "')))";
  const out = await execFileP('python3', ['-c', py], { cwd: p.join(__dirname, '..'), timeout: 180000, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  const record = JSON.parse(out.stdout);
  if (!record.ok) throw new Error(record.error || 'agent failed');
  const prop = record.proposal || {};
  const propRefs = prop.evidence_refs || [];
  const evidenceRefs = (Array.isArray(propRefs) && propRefs.length) ? propRefs : [{ id: record.alert_id, table: 'alerts' }, { id: record.order_id, table: 'orders' }];
  const row = {
    alert_id: record.alert_id,
    order_id: record.order_id,
    summary: prop.summary || '',
    rationale: prop.rationale || '',
    command: (prop.command || '').trim(),
    evidence_refs: evidenceRefs,
    needs_approval: true,
    source_class: record.source_class || '',
    fact_state: record.fact_state || '',
    stops_because: record.refusal || '',
    model_error: record.model_error || '',
    source: record.mode || 'deterministic',
    status: 'PENDING_REVIEW',
    generated_at: record.generated_at
  };
  f.appendFileSync(OURS, JSON.stringify(row) + '\n', 'utf8');
  return row;
}

async function autorunMissing() {
  if (AUTO.running) return;
  const todo = buildQueue().filter(r => !r.g && !r.sb).map(r => r.aid);
  AUTO.running = true;
  AUTO.done = 0;
  AUTO.total = todo.length;
  AUTO.errors = [];
  for (const id of todo) {
    try { await runCaseAsync(id); }
    catch (err) { AUTO.errors.push(id + ': ' + String(err.message || err).slice(0, 120)); }
    AUTO.done++;
  }
  AUTO.running = false;
}

function readJsonBody(q, cb){
  let b='';
  q.on('data',c=>{b+=c});
  q.on('end',()=>{
    try{ cb(null, JSON.parse(b||'{}')) }catch(e){ cb(e) }
  });
}

h.createServer((q,s)=>{
  // POST /case/:id/stream — SSE
  if(q.method==='POST' && q.url.match(/^\/case\/[^\/]+\/stream/)){
    const m = q.url.match(/^\/case\/([^\/]+)\/stream/);
    const id = decodeURIComponent(m[1]).replace(/[^A-Za-z0-9_\-]/g,'');
    return readJsonBody(q, (err, body)=>{
      if(err){s.writeHead(400,{'content-type':'application/json'});return s.end(JSON.stringify({ok:false,error:'bad json'}))}
      const message = (body && body.message) || '';
      if(!message.trim()){s.writeHead(400,{'content-type':'application/json'});return s.end(JSON.stringify({ok:false,error:'message required'}))}

      s.writeHead(200,{
        'content-type':'text/event-stream',
        'cache-control':'no-cache',
        'connection':'keep-alive'
      });

      const payload = JSON.stringify({alert_id: id, message: message});
      const py = "import sys,json;msg=json.loads(sys.stdin.read());sys.path.insert(0,'.');from bahn_ops.case_chat import continue_case_streaming;" +
                 "\nfor ev in continue_case_streaming(msg['alert_id'], msg['message']): print('data: '+json.dumps(ev))";

      try{
        const child = cp.spawn('python3',['-c',py],{cwd:p.join(__dirname,'..')});
        child.stdin.write(payload);
        child.stdin.end();

        let buf='';
        child.stdout.on('data', chunk=>{
          buf += chunk.toString();
          const lines = buf.split('\n');
          buf = lines.pop() || '';
          for(const line of lines){
            if(line.startsWith('data: ')){ s.write(line + '\n\n'); }
          }
        });
        child.stdout.on('end', ()=>{ s.end('data: {"event":"end"}\n\n'); });
        child.stderr.on('data', err=>{ s.write('data: ' + JSON.stringify({event:'error', data: err.toString().slice(0,200)}) + '\n\n'); });
      }catch(e){
        s.write('data: ' + JSON.stringify({event:'error', data: String(e.message||e).slice(0,200)}) + '\n\n');
        s.end();
      }
    });
  }

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
        "import pathlib as _pl;" +
        "_ours=_pl.Path('bahn_ops/ours.jsonl');" +
        "_rows=[__import__('json').loads(l) for l in _ours.read_text().splitlines() if l.strip()] if _ours.exists() else [];" +
        "_match=next((x for x in _rows if x.get('alert_id')=='" + id + "'), None);" +
        "r['source']=(_match or {}).get('source','');" +
        "r['model_error']=(_match or {}).get('model_error','');" +
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

      // A8: if the client sent a proposal version, verify it still matches.
      // This blocks "accept a proposal that was replaced 3 seconds ago".
      if(d.proposal_version){
        try{
          const {pa,po} = buildProposalIndexes();
          const current = pa[d.alert_id] || po[d.alert_id];
          const currentVer = current && (current.created_at || current.generated_at || '');
          if(currentVer && currentVer !== d.proposal_version){
            s.writeHead(409,{'content-type':'application/json'});
            return s.end(JSON.stringify({ok:false,error:'This proposal has been replaced. Reload the page and decide again.',current_version:currentVer}));
          }
        }catch(e){}
      }
      if(!['accept','change'].includes(d.decision)){
        s.writeHead(400,{'content-type':'application/json'});
        return s.end(JSON.stringify({ok:false,error:'decision must be accept or change'}));
      }

      // The browser is untrusted. Resolve the command from the current
      // server-side proposal; never record a client-supplied command.
      const {pa,po} = buildProposalIndexes();
      const proposal = pa[d.alert_id] || po[d.alert_id];
      if(!proposal){
        s.writeHead(404,{'content-type':'application/json'});
        return s.end(JSON.stringify({ok:false,error:'No current proposal exists for this alert'}));
      }
      const verifiedCommand = String(proposal.command || '').trim();
      if(d.decision === 'accept' && (proposal.stop_enforced || String(proposal.stops_because||'').trim())){
        s.writeHead(409,{'content-type':'application/json'});
        return s.end(JSON.stringify({ok:false,error:'The agent stopped on this case: '+String(proposal.stops_because||'the evidence is insufficient')}));
      }
      if(d.decision === 'accept' && !verifiedCommand){
        s.writeHead(409,{'content-type':'application/json'});
        return s.end(JSON.stringify({ok:false,error:'Cannot accept a proposal with no command'}));
      }

      const row={alert_id:d.alert_id,decision:d.decision,command:verifiedCommand,at:new Date().toISOString()};
      f.appendFileSync(DEC,JSON.stringify(row)+'\n','utf8');
      // Only an explicit 'accept' fires the executor. 'change' records the
      // intent but does not run the previous proposal.
      if(d.decision === 'accept'){
        try{
          const child=cp.spawn('python3',['-m','bahn_ops.execute',d.alert_id],{
            cwd:p.join(__dirname,'..'),
            detached:true,
            stdio:'ignore'
          });
          child.unref();
        }catch(e){}
      }
      s.writeHead(200,{'content-type':'application/json'});
      return s.end(JSON.stringify({ok:true,row}));
    });
    return;
  }

  // POST /run-all -- fire the agent on every card with no proposal, async
  if (q.method === 'POST' && q.url === '/run-all') {
    autorunMissing();
    s.writeHead(200, { 'content-type': 'application/json' });
    return s.end(JSON.stringify({ ok: true, total: AUTO.total }));
  }
  if (q.url === '/run-all/status') {
    s.writeHead(200, { 'content-type': 'application/json' });
    return s.end(JSON.stringify(AUTO));
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
        const payload = JSON.stringify({qid: qid, reply: reply});
        const py = "import sys,json;d=json.loads(sys.stdin.read());sys.path.insert(0,'.');from bahn_ops.inbox import override;print(json.dumps(override(d['qid'],d['reply'])))";
        const out = cp.execFileSync('python3',['-c',py],{cwd:p.join(__dirname,'..'),input:payload,timeout:30000,encoding:'utf8'});
        const record = JSON.parse(out);

        // Append a driver-update event to the case history so the model
        // sees the new reply on the next turn.
        try{
          const py2 = "import sys,json;sys.path.insert(0,'.');from bahn_ops.inbox import alert_id_for;print(alert_id_for('" + qid.replace(/[^A-Za-z0-9_\-]/g,'') + "') or '')";
          const outAlert = cp.execFileSync('python3',['-c',py2],{cwd:p.join(__dirname,'..'),timeout:15000,encoding:'utf8'}).trim();
          if(outAlert){
            const histPayload = JSON.stringify({alert_id: outAlert, reply: reply});
            const py3 = "import sys,json,pathlib;from datetime import datetime,timezone;d=json.loads(sys.stdin.read());" +
                        "p=pathlib.Path('bahn_ops/case_history')/(d['alert_id']+'.json');p.parent.mkdir(parents=True,exist_ok=True);" +
                        "h=json.loads(p.read_text()) if p.exists() else [];" +
                        "h.append({'role':'operator','at':datetime.now(timezone.utc).isoformat(),'content':'[Phone log: the driver just replied]'+d['reply']});" +
                        "p.write_text(json.dumps(h,indent=2,ensure_ascii=False));print('ok')";
            cp.execFileSync('python3',['-c',py3],{cwd:p.join(__dirname,'..'),input:histPayload,timeout:15000,encoding:'utf8'});
          }
        }catch(e2){}

        s.writeHead(record.ok?200:400,{'content-type':'application/json'});
        return s.end(JSON.stringify(record));
      }catch(e){
        s.writeHead(500,{'content-type':'application/json'});
        return s.end(JSON.stringify({ok:false,error:String(e.message||e).slice(0,300)}));
      }
    });
  }


  s.writeHead(200,{'content-type':'text/html;charset=utf-8'});
  s.end(renderPage());
})
.listen(4317,'127.0.0.1',()=>{
  const Q=buildQueue();
  console.log('UP');
  if (process.env.BAHN_AUTORUN === '1') autorunMissing();
  console.log('open',Q.length,'proposed',Q.filter(r=>r.g).length,'stopped',Q.filter(r=>r.sb).length,'notrun',Q.filter(r=>!r.g&&!r.sb).length);
});
