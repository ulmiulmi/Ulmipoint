'use strict';

const group=require('./_group-section');

function safe(v){return String(v==null?'':v).trim();}
function clone(v){try{return JSON.parse(JSON.stringify(v));}catch(_){return v;}}
function envModel(){return safe(process.env.ULMIPOINT_AI_MODEL || process.env.OPENAI_MODEL || 'gpt-5.2') || 'gpt-5.2';}
function monthKeyFromPayload(payload){
  const mk=safe(payload?.month || payload?.monthKey || '');
  if(/^\d{4}-\d{2}$/.test(mk)) return mk;
  const y=String(payload?.selectedYear||'').trim();
  const m=String(payload?.selectedMonth||'').trim().padStart(2,'0');
  if(/^\d{4}$/.test(y)&&/^\d{2}$/.test(m)) return y+'-'+m;
  return new Date().toISOString().slice(0,7);
}
function limitObjectMap(obj,prefix){
  const out={};
  if(!obj || typeof obj!=='object') return out;
  Object.keys(obj).filter(k=>!prefix || String(k).startsWith(prefix)).sort().slice(0,500).forEach(k=>{out[k]=obj[k];});
  return out;
}
function storedSection(data,siteId,groupKey,section){
  try{return group.publicSection(data,siteId,groupKey,section).value;}catch(_){return undefined;}
}
function normalisePayload({data,siteId,groupKey,body}){
  const incoming=body?.payload || body?.aiPayload || body?.state || {};
  const payload=clone(incoming&&typeof incoming==='object'?incoming:{});
  if(payload.api && typeof payload.api==='object') payload.api={model:payload.api.model||'',saveInBrowserSicherung:false};
  const month=monthKeyFromPayload(payload);
  const storedState=storedSection(data,siteId,groupKey,'state') || {};
  const storedEmployees=storedSection(data,siteId,groupKey,'employees');
  const storedPlan=storedSection(data,siteId,groupKey,'plan');
  const storedDuties=storedSection(data,siteId,groupKey,'duties');
  const storedWishes=storedSection(data,siteId,groupKey,'wishes');
  return {
    app:'ULMIPOINT KI Dienstplanprüfung',
    mode:'server_ai_group_review_no_auto_save',
    siteId:group.slug(siteId),
    groupKey:group.slug(groupKey),
    groupName:safe(payload.groupName || payload.planerGroupName || storedState.unitName || storedState.planerGroupName || groupKey),
    month,
    important:[
      'Prüfe ausschliesslich diese eine Gruppe und diesen einen Monat.',
      'Gib konkrete, kurze Vorschläge für die planende Person.',
      'Nichts automatisch ändern und nichts speichern.',
      'Fixierte und manuelle Einträge respektieren.',
      'Keine Regeln erfinden und keine Daten anderer Gruppen verwenden.',
      'Keine technischen Befehle, keine JSON-Ausgabe, keine Backticks.'
    ],
    rules:payload.rules || storedState.rules || {},
    duties:Array.isArray(payload.duties)?payload.duties:(Array.isArray(storedDuties?.duties)?storedDuties.duties:[]),
    groupDuties:storedDuties || {},
    standardNeeds:payload.standardNeeds || storedState.standardNeeds || {},
    teamMeetings:payload.teamMeetings || storedState.teamMeetings || {},
    dayStatus:payload.dayStatus || limitObjectMap(storedState.dayStatus,month),
    dayNeeds:payload.dayNeeds || limitObjectMap(storedState.dayNeeds,month),
    dayOverrides:payload.dayOverrides || limitObjectMap(storedState.dayOverrides,month),
    employees:Array.isArray(payload.employees)?payload.employees:(Array.isArray(storedEmployees)?storedEmployees:(Array.isArray(storedState.employees)?storedState.employees:[])),
    plan:Array.isArray(payload.plan)?payload.plan:limitObjectMap((payload.plan&&typeof payload.plan==='object'?payload.plan:storedPlan)||{},month),
    wishes:storedWishes || {},
    issues:Array.isArray(payload.issues)?payload.issues.slice(0,120):[]
  };
}
function extractResponseText(data){
  if(!data) return '';
  if(typeof data.output_text==='string') return data.output_text;
  if(Array.isArray(data.output)){
    return data.output.flatMap(item=>Array.isArray(item.content)?item.content:[])
      .map(c=>c.text||c.output_text||'').filter(Boolean).join('\n').trim();
  }
  return safe(data.text || data.message || '');
}
async function callOpenAI(payload){
  const key=safe(process.env.OPENAI_API_KEY || process.env.ULMIPOINT_OPENAI_API_KEY);
  if(!key){
    const err=new Error('KI ist auf Vercel noch nicht eingerichtet: OPENAI_API_KEY fehlt.');
    err.code='AI_KEY_MISSING';
    throw err;
  }
  const body={
    model:envModel(),
    store:false,
    instructions:'Du bist der ULMIPOINT Dienstplan-Assistent. Prüfe Dienstplan, Mitarbeitende, Dienste, Wünsche, Wunschfrist, Tagesbedarf und bestehende Konflikte. Antworte auf Deutsch, knapp und praktisch. Gib nur Vorschläge; du speicherst und änderst nichts.',
    input:JSON.stringify(payload),
    max_output_tokens:1800
  };
  const resp=await fetch('https://api.openai.com/v1/responses',{
    method:'POST',
    headers:{'Content-Type':'application/json','Authorization':'Bearer '+key},
    body:JSON.stringify(body)
  });
  const txt=await resp.text();
  let json={}; try{json=txt?JSON.parse(txt):{};}catch(_){json={raw:txt};}
  if(!resp.ok){
    const msg=json?.error?.message || json?.message || txt || ('KI-Fehler HTTP '+resp.status);
    throw new Error(msg);
  }
  return extractResponseText(json) || 'Keine KI-Antwort erhalten.';
}
async function pruefeDienstplan(args){
  const payload=normalisePayload(args||{});
  const text=await callOpenAI(payload);
  return {
    ok:true,
    mode:'kiDienstplanPruefen',
    source:'vercel-server-ai',
    siteId:payload.siteId,
    groupKey:payload.groupKey,
    groupName:payload.groupName,
    month:payload.month,
    model:envModel(),
    text,
    saved:false,
    message:'KI-Vorschlag erstellt. Es wurde nichts automatisch gespeichert.'
  };
}

function status(){
  const key=safe(process.env.OPENAI_API_KEY || process.env.ULMIPOINT_OPENAI_API_KEY);
  return {
    ok:true,
    mode:'kiStatus',
    connected:!!key,
    configured:!!key,
    model:envModel(),
    message:key?'KI ist über Vercel verbunden.':'KI ist auf Vercel noch nicht eingerichtet: OPENAI_API_KEY fehlt.'
  };
}

module.exports={pruefeDienstplan,status};
