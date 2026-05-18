const STORE_ID = process.env.ULMIPOINT_STORE_ID || process.env.POLYPOINT_STORE_ID || 'default';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.ULMIPOINT_SUPABASE_URL || process.env.POLYPOINT_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY;

function send(res, status, data){
  res.statusCode=status;
  res.setHeader('Content-Type','application/json; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.end(JSON.stringify(data));
}
function allow(req,res){
  res.setHeader('Access-Control-Allow-Methods','POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers','Content-Type');
  if(req.method==='OPTIONS'){send(res,200,{ok:true}); return true;}
  return false;
}
async function readBody(req){
  if(req.body && typeof req.body==='object') return req.body;
  const chunks=[]; for await (const c of req) chunks.push(Buffer.from(c));
  const raw=Buffer.concat(chunks).toString('utf8');
  if(!raw) return {};
  try{return JSON.parse(raw)}catch(_){return {}}
}
function assertEnv(){
  if(!SUPABASE_URL || !SERVICE_KEY) throw new Error('Server nicht eingerichtet: SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY fehlt.');
}
async function supabase(path,opt={}){
  assertEnv();
  const headers=Object.assign({'apikey':SERVICE_KEY,'Authorization':'Bearer '+SERVICE_KEY}, opt.headers||{});
  const resp=await fetch(SUPABASE_URL+path,Object.assign({},opt,{headers}));
  const txt=await resp.text(); let data=null; try{data=txt?JSON.parse(txt):null}catch(_){data=txt}
  if(!resp.ok) throw new Error((data&&data.message)||(data&&data.msg)||String(data||('HTTP '+resp.status)));
  return data;
}
async function fetchStore(){
  const data=await supabase('/rest/v1/planer_store?id=eq.'+encodeURIComponent(STORE_ID)+'&select=id,data,updated_at',{method:'GET'});
  const row=Array.isArray(data)?data[0]:null;
  if(!row || !row.data) throw new Error('Kein Serverstand gefunden.');
  return row;
}
async function saveStore(data){
  const now=new Date().toISOString();
  await supabase('/rest/v1/planer_store',{method:'POST',headers:{'Content-Type':'application/json','Prefer':'resolution=merge-duplicates,return=minimal'},body:JSON.stringify({id:STORE_ID,data,updated_at:now})});
  return {id:STORE_ID,data,updated_at:now};
}
function parseJsonMaybe(v){ if(!v||typeof v!=='string')return null; try{return JSON.parse(v)}catch(_){return null} }
function normEmail(v){ return String(v||'').trim().toLowerCase(); }
function normCode(v){ return String(v||'').trim().replace(/\s+/g,'').toUpperCase(); }
function normText(v){ return String(v||'').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' '); }
function safeKeyPart(v){ return String(v||'').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,''); }
function groupFromKey(key,obj){
  const raw=String(obj?.planerGroupName || obj?.groupName || key || '').replace(/^polypoint_/,'').replace(/_/g,' ').trim();
  if(/azoren/i.test(raw))return 'Azoren'; if(/bali/i.test(raw))return 'Bali'; if(/capri/i.test(raw))return 'Capri'; if(/delos/i.test(raw))return 'Delos'; if(/nacht/i.test(raw))return 'Nachtwache'; if(/pikett/i.test(raw))return 'Haus-Pikett'; if(/haus.*dienst|hausdienst/i.test(raw))return 'Haus-Dienstplan';
  return raw || 'Allgemein';
}
function groupKey(v){return normText(v||'allgemein')}
function extractEmployeeEmails(emp){
  const arr=[]; ['email','mail','loginEmail','portalEmail','wunschEmail'].forEach(k=>{ if(emp&&emp[k])arr.push(normEmail(emp[k])); });
  if(Array.isArray(emp?.emails))emp.emails.forEach(e=>arr.push(normEmail(e)));
  return [...new Set(arr.filter(Boolean))];
}
function extractEmployees(data){
  const out=[]; const items=data?.items||{};
  Object.entries(items).forEach(([key,val])=>{
    const obj=parseJsonMaybe(val); if(!obj||!Array.isArray(obj.employees))return;
    const group=groupFromKey(key,obj);
    obj.employees.forEach(emp=>{
      if(!emp||emp.active===false)return; const name=String(emp.name||'').trim(); if(!name)return;
      out.push({id:String(emp.id||name),name,role:String(emp.role||''),group,groupKey:groupKey(group),emails:extractEmployeeEmails(emp),wishCode:String(emp.wishCode||emp.portalCode||emp.wunschCode||''),sourceKey:key});
    });
  });
  const seen=new Set(), uniq=[];
  out.forEach(e=>{ const k=(e.name+'|'+e.id+'|'+e.group).toLowerCase(); if(seen.has(k))return; seen.add(k); uniq.push(e); });
  uniq.sort((a,b)=>(a.group||'').localeCompare(b.group||'','de')||a.name.localeCompare(b.name,'de'));
  return uniq;
}
function employeeCodeMatches(e,identity,code){
  const idn=normText(identity); const em=normEmail(identity); const c=normCode(code);
  if(!c || normCode(e.wishCode)!==c)return false;
  const byEmail=em && (e.emails||[]).includes(em);
  const byName=idn && (normText(e.name)===idn || normText(e.name).includes(idn) || idn.includes(normText(e.name)));
  return !!(byEmail || byName);
}
function findEmployee(data,identity,code,employeeId){
  const list=extractEmployees(data);
  let matches=list.filter(e=>employeeCodeMatches(e,identity,code));
  if(employeeId) matches=matches.filter(e=>String(e.id)===String(employeeId));
  if(matches.length!==1) throw new Error(matches.length>1?'Mehrere Treffer gefunden. Bitte E-Mail statt Name verwenden.':'Kein Mitarbeiter mit diesem Namen/E-Mail und Wunsch-Code gefunden.');
  const emp=Object.assign({},matches[0]); delete emp.wishCode;
  return {emp, secure:list.find(e=>e.id===matches[0].id && e.name===matches[0].name && e.group===matches[0].group)};
}
function dutyLabel(d){
  const code=String(d?.code||'').trim(); const name=String(d?.name||'').trim(); const time=[d?.start,d?.end].filter(Boolean).join('–');
  return code+(name?' · '+name:'')+(time?' · '+time:'');
}
function shouldShowDutyInPortal(d){
  const code=String(d?.code||'').trim().toUpperCase(); const type=String(d?.type||'').trim(); const name=String(d?.name||'').trim();
  if(!code)return false; if(['KR','FER','WB','WB%','SCH','SCHF','ÜK','UK','KGL','KF'].includes(code))return false; if(['absenceWork','schoolFree','compensationFree'].includes(type))return false; if(code==='FR')return false;
  if(d?.countsForCoverage || d?.autoPlan)return true; if(['group','split','office','emergencyGroup'].includes(type))return true; if(code==='P'||/pikett/i.test(name))return true; if(/nacht/i.test(code+' '+name+' '+type))return true; return false;
}
function normalizedDutyCode(v){return String(v||'').trim().toUpperCase()}
function activeStandardCodesFromState(st){
  const set=new Set(); const needs=st?.standardNeeds||{};
  Object.entries(needs).forEach(([day,arr])=>{ if(day&&day[0]==='_')return; if(!Array.isArray(arr))return; arr.forEach(code=>{code=normalizedDutyCode(code); if(code)set.add(code);}); });
  return set;
}
function employeeRelevantWishDuty(d){ const code=normalizedDutyCode(d?.code); const type=String(d?.type||''); if(['FER','WB','WB%','SCH','SCHF','ÜK','UK','KGL','KF'].includes(code))return true; if(['absenceWork','schoolFree','compensationFree'].includes(type)&&code!=='KR')return true; return false; }
const baseWishOptions=[['','egal / kein Wunsch'],['FR','Wunsch frei / frei gewünscht'],['NO','nicht verfügbar']];
const otherWishOption=['OTHER','anderer Wunsch / siehe Kommentar'];
const fallbackEmployeeWishOptions=[['FER','Ferien'],['SCH','Schule'],['WB','Weiterbildung'],['KF','Kompensation / frei']];
function dutyOrder(pair){ const c=String(pair[0]||''), label=String(pair[1]||''); if(/^F/.test(c))return '10_'+c; if(/^M/.test(c))return '20_'+c; if(/^S/.test(c))return '30_'+c; if(/^G|^B/.test(c))return '40_'+c; if(/^GD/.test(c))return '50_'+c; if(/^N|NW/.test(c)||/nacht/i.test(label))return '60_'+c; if(/^P/.test(c))return '70_'+c; return '90_'+c; }
function getGroupStateForEmployee(data,emp){
  const items=data?.items||{}; let st=parseJsonMaybe(items[emp.sourceKey]);
  if(st && Array.isArray(st.employees) && st.employees.some(e=>String(e.id||e.name)===String(emp.id)||normText(e.name)===normText(emp.name)))return st;
  for(const val of Object.values(items)){ const obj=parseJsonMaybe(val); if(!obj||!Array.isArray(obj.employees))continue; const g=groupKey(groupFromKey('',obj)); const sameGroup=!emp.groupKey||g===emp.groupKey; const hasEmp=obj.employees.some(e=>String(e.id||e.name)===String(emp.id)||normText(e.name)===normText(emp.name)); if(sameGroup&&hasEmp)return obj; }
  return st||null;
}
function wishOptionsForEmployee(data,emp){
  const st=getGroupStateForEmployee(data,emp); const map=new Map();
  const active=activeStandardCodesFromState(st);
  (Array.isArray(st?.duties)?st.duties:[]).forEach(d=>{ const code=normalizedDutyCode(d.code); if(!code)return; if(shouldShowDutyInPortal(d) && active.has(code))map.set(code,[code,dutyLabel(Object.assign({},d,{code}))]); });
  (Array.isArray(st?.duties)?st.duties:[]).forEach(d=>{ if(!employeeRelevantWishDuty(d))return; const code=normalizedDutyCode(d.code); if(!code)return; if(!map.has(code))map.set(code,[code,dutyLabel(Object.assign({},d,{code}))]); });
  fallbackEmployeeWishOptions.forEach(o=>{ if(!map.has(o[0]))map.set(o[0],o); });
  return baseWishOptions.concat([...map.values()].sort((a,b)=>dutyOrder(a).localeCompare(dutyOrder(b),'de'))).concat([otherWishOption]);
}
function employeeKey(emp){ const base=[emp?.groupKey||emp?.group||'', emp?.id||'', emp?.name||''].filter(Boolean).map(safeKeyPart).filter(Boolean).join('__'); return 'emp_'+(base||safeKeyPart(emp?.name||'unknown')); }
function wishStore(data){ if(!data.wishes||typeof data.wishes!=='object')data.wishes={version:'13.0.226j-api',people:{}}; if(!data.wishes.people||typeof data.wishes.people!=='object')data.wishes.people={}; return data.wishes; }
function getWishes(data,emp,monthKey){ const ws=wishStore(data); return JSON.parse(JSON.stringify(ws.people?.[employeeKey(emp)]?.months?.[monthKey]?.days||{})); }
function setWishes(data,emp,monthKey,days,identity,action){
  const ws=wishStore(data); const key=employeeKey(emp); const [y,m]=String(monthKey).split('-').map(Number);
  if(!ws.people[key])ws.people[key]={employeeId:emp.id,employeeName:emp.name,email:normEmail(identity),group:emp.group,months:{}};
  Object.assign(ws.people[key],{employeeId:emp.id,employeeName:emp.name,email:normEmail(identity),group:emp.group,groupKey:emp.groupKey,updatedAt:new Date().toISOString(),keyMode:'employee'});
  ws.people[key].months[monthKey]={year:y,month:m,days,group:emp.group,updatedAt:new Date().toISOString(),savedBy:{id:'code:'+emp.id,email:normEmail(identity),name:emp.name}};
  ws.version='13.0.226j-api'; ws.updatedAt=new Date().toISOString();
  const count=Object.keys(days||{}).length;
  const act={id:'act_'+new Date().toISOString().replace(/[:.]/g,'-')+'_'+Math.random().toString(36).slice(2,8),at:new Date().toISOString(),action:action||'Wünsche gespeichert',user:{id:'code:'+emp.id,email:normEmail(identity),name:emp.name},area:'Wunschportal',group:emp.group,employeeName:emp.name,hash:'wishes-'+count+'-'+Date.now().toString(36),count,note:'Mitarbeiter-Wunschportal API'};
  data.activity=[act].concat(Array.isArray(data.activity)?data.activity:[]).slice(0,50);
}
function dateStr(y,m,d){return y+'-'+String(m).padStart(2,'0')+'-'+String(d).padStart(2,'0')}
function dutyForPlan(st,code){ code=String(code||'').trim(); return (Array.isArray(st?.duties)?st.duties:[]).find(d=>String(d.code||'').trim()===code)||null; }
function shortDutyLabel(st,entry){ if(!entry)return 'frei / leer'; const code=String(entry.code||'').trim(); if(!code)return 'frei / leer'; if(code==='FR')return 'Frei'; const d=dutyForPlan(st,code); const name=String(d?.name||entry.name||'').trim(); const time=(d?.start&&d?.end)?String(d.start)+'–'+String(d.end):''; return code+(name?' · '+name:'')+(time?' · '+time:''); }
function shortWishLabel(type,wishOptions){ const f=(wishOptions||[]).find(o=>o[0]===type); return f?f[1]:(type||''); }
function employeeIndexInState(st,emp){
  const list=Array.isArray(st?.employees)?st.employees:[];
  let idx=list.findIndex(e=>String(e?.id||'')===String(emp?.id||''));
  if(idx>=0)return idx;
  idx=list.findIndex(e=>normText(e?.name)===normText(emp?.name));
  if(idx>=0)return idx;
  const mailSet=new Set((emp?.emails||[]).map(normEmail));
  if(mailSet.size){
    idx=list.findIndex(e=>empEmails(e).some(m=>mailSet.has(normEmail(m))));
    if(idx>=0)return idx;
  }
  return -1;
}
function possiblePlanIdsForEmployee(st,emp,date){
  const ids=new Set();
  if(emp?.id)ids.add(String(emp.id));
  if(emp?.name)ids.add(String(emp.name));
  const list=Array.isArray(st?.employees)?st.employees:[];
  const idx=employeeIndexInState(st,emp);
  if(idx>=0&&list[idx]){
    if(list[idx].id)ids.add(String(list[idx].id));
    if(list[idx].name)ids.add(String(list[idx].name));
  }
  const empIds=new Set(list.map(e=>String(e?.id||'')).filter(Boolean));
  const orphanIds=[];
  Object.keys(st?.plan||{}).forEach(k=>{
    if(!String(k).startsWith(String(date)+'__')||String(k).startsWith('OPEN__'))return;
    const parts=String(k).split('__'); const oldId=parts[1];
    if(oldId&&!empIds.has(oldId)&&!orphanIds.includes(oldId))orphanIds.push(oldId);
  });
  if(idx>=0&&orphanIds[idx])ids.add(String(orphanIds[idx]));
  return [...ids].filter(Boolean);
}
function planEntryForEmployee(st,emp,date){
  const plan=(st&&st.plan&&typeof st.plan==='object')?st.plan:{};
  for(const id of possiblePlanIdsForEmployee(st,emp,date)){
    const e=plan[date+'__'+id];
    if(e)return e;
  }
  const list=Array.isArray(st?.employees)?st.employees:[];
  for(const [k,e] of Object.entries(plan)){
    if(!String(k).startsWith(String(date)+'__'))continue;
    const pid=String(k).split('__')[1]||'';
    const pe=list.find(x=>String(x?.id||'')===pid);
    if(pe&&(String(pe.id||'')===String(emp?.id||'')||normText(pe.name)===normText(emp?.name)))return e;
    if(normText(pid)===normText(emp?.name))return e;
  }
  return null;
}
function planDayFromState(st,emp,date,wishes,wishOptions){
  const p=String(date||'').split('-').map(Number); const y=p[0], m=p[1], d=p[2];
  const dow=new Date(y,m-1,d).getDay();
  const entry=planEntryForEmployee(st,emp,date);
  const label=shortDutyLabel(st,entry); const has=!!(entry&&entry.code&&entry.code!=='FR');
  const wish=wishes?.[date]?.type ? shortWishLabel(wishes[date].type,wishOptions) : '';
  const fixed=!!(entry&&entry.fixed) || !!(st?.lockedMonths&&st.lockedMonths[String(date).slice(0,7)]);
  return {day:d,date,dow:['So','Mo','Di','Mi','Do','Fr','Sa'][dow],weekend:dow===0||dow===6,hasDuty:has,code:entry?.code||'',label,wish,fixed,manual:!!entry?.manual};
}
function personalPlan(data,emp,monthKey,wishes,wishOptions){
  const [y,m]=String(monthKey).split('-').map(Number); const st=getGroupStateForEmployee(data,emp); const days=[]; const rows=[];
  if(!st||!y||!m)return {days,rows,planned:0,info:'Für '+emp.name+' wurde kein Gruppenplan gefunden.'};
  const daysIn=new Date(y,m,0).getDate(); let planned=0;
  for(let d=1; d<=daysIn; d++){
    const date=dateStr(y,m,d); const day=planDayFromState(st,emp,date,wishes,wishOptions);
    if(day.hasDuty)planned++; days.push(day); if(day.code)rows.push(day);
  }
  return {monthKey,days,rows,planned,info:'Persönlicher Dienstplan: '+emp.name+' · '+emp.group+' · '+monthKey+' · '+planned+' geplante Dienste. Stand aus dem aktuellen Server-Speicher.'};
}
function currentDayPlan(data,emp,todayDate,wishOptions){
  const date=String(todayDate||'').match(/^\d{4}-\d{2}-\d{2}$/)?String(todayDate):new Date().toISOString().slice(0,10);
  const st=getGroupStateForEmployee(data,emp); if(!st)return {date,label:'kein Plan gefunden',hasDuty:false,fixed:false,info:'Für heute wurde kein Gruppenplan gefunden.'};
  const ws=wishStore(data); const wishDays=ws.people?.[employeeKey(emp)]?.months?.[date.slice(0,7)]?.days||{};
  return planDayFromState(st,emp,date,wishDays,wishOptions);
}
function wishDeadlineWeeks(data){ const ws=data?.wishSettings||{}; let weeks=Number(ws.deadlineWeeks); if(!Number.isFinite(weeks))weeks=Number(ws.weeks); if(!Number.isFinite(weeks))weeks=6; return Math.max(0,Math.min(26,Math.round(weeks))); }
function publicPayload(row,emp,identity,monthKey,todayDate){ const data=row.data; const wishes=getWishes(data,emp,monthKey); const opts=wishOptionsForEmployee(data,emp); const today=String(todayDate||'').match(/^\d{4}-\d{2}-\d{2}$/)?String(todayDate):new Date().toISOString().slice(0,10); const currentMonthKey=today.slice(0,7); const currentMonthWishes=getWishes(data,emp,currentMonthKey); return {ok:true,employee:emp,identity:normEmail(identity)||identity,monthKey,wishDeadlineWeeks:wishDeadlineWeeks(data),wishOptions:opts,wishes,personalPlan:personalPlan(data,emp,monthKey,wishes,opts),currentMonthPlan:personalPlan(data,emp,currentMonthKey,currentMonthWishes,opts),currentDay:currentDayPlan(data,emp,today,opts),updatedAt:row.updated_at||new Date().toISOString()}; }

module.exports={allow,send,readBody,fetchStore,saveStore,findEmployee,publicPayload,setWishes};
