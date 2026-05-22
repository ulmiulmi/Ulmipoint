const {allow,send,readBody,fetchStore,saveStore}=require('./_wishlib');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.ULMIPOINT_SUPABASE_URL || process.env.POLYPOINT_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY;

function safe(v){return String(v||'').trim();}
function normEmail(v){return safe(v).toLowerCase();}
function slug(v){return safe(v).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')||'default';}
function clone(v){return JSON.parse(JSON.stringify(v==null?null:v));}
function normalizeRole(v){v=safe(v).toLowerCase(); if(['admin','administrator','leitung'].includes(v))return 'admin'; if(['planner','planer','planung'].includes(v))return 'planner'; if(['hausleitung','houselead','house_lead'].includes(v))return 'hausleitung'; if(['tko','teamkoordination','teamkoordinator'].includes(v))return 'tko'; if(['employee','mitarbeiter','ma'].includes(v))return 'employee'; return v;}
function roleStore(data){const roles=(data&&typeof data==='object')?(data.accessRoles||data.roles||{}):{}; return roles&&typeof roles==='object'?roles:{};}
function validOrgAdminSession(data,tok){
  tok=safe(tok);
  const sessions=data?.organisationAdmin?.sessions || {};
  const s=sessions[tok];
  if(!s) return false;
  if(s.expiresAt && new Date(s.expiresAt).getTime() < Date.now()) return false;
  return true;
}
function configuredOrgAdminPassword(data){
  return safe(
    process.env.ULMIPOINT_ORG_ADMIN_PASSWORD ||
    process.env.ULMIPOINT_ADMIN_PASSWORD ||
    process.env.ADMIN_PASSWORD ||
    data?.organisationAdmin?.password ||
    data?.adminPassword ||
    ''
  );
}
function constantTimeEqual(a,b){
  a=String(a||''); b=String(b||'');
  if(!a || !b || a.length!==b.length) return false;
  let r=0;
  for(let i=0;i<a.length;i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r===0;
}
function validOrgAdminPassword(data,pw){
  const configured=configuredOrgAdminPassword(data);
  return !!configured && constantTimeEqual(safe(pw), configured);
}
async function verifySupabaseUser(req){
  const auth=safe(req.headers.authorization || req.headers.Authorization);
  const token=auth.replace(/^Bearer\s+/i,'');
  if(!token) throw new Error('Keine Server-Sitzung übergeben. Bitte im Hauptplaner über ☁️ Server einloggen.');
  if(!SUPABASE_URL || !SERVICE_KEY) throw new Error('Server-Umgebung fehlt: SUPABASE_URL oder SERVICE KEY.');
  const resp=await fetch(SUPABASE_URL + '/auth/v1/user', {method:'GET', headers:{'apikey':SERVICE_KEY,'Authorization':'Bearer '+token}});
  const txt=await resp.text(); let user=null; try{user=txt?JSON.parse(txt):null;}catch(_){ }
  if(!resp.ok || !user || !user.id) throw new Error('Server-Sitzung ungültig oder abgelaufen. Bitte neu einloggen.');
  return user;
}
async function verifySupabaseUserOptional(req){try{return await verifySupabaseUser(req);}catch(_){return null;}}
function list(v){return Array.isArray(v)?v:[];}
function orgSites(data){return list(data?.organisationStructure?.sites);}
function findSite(data,siteId){
  const id=slug(siteId);
  return orgSites(data).find(s=>slug(s.id||s.name)===id || safe(s.id)===safe(siteId) || safe(s.name)===safe(siteId)) || null;
}
function findUnit(site,groupKey,unitId){
  const g=safe(groupKey), u=safe(unitId);
  const gs=slug(g), us=slug(u);
  return list(site?.units).find(x=>safe(x.plannerKey)===g || safe(x.id)===u || safe(x.id)===g || slug(x.plannerKey||x.id||x.name)===gs || slug(x.id||x.name)===us) || null;
}
function accessFor(data,user,siteId,groupKey,unitId){
  const email=normEmail(user?.email);
  const roles=roleStore(data);
  const configured=Object.keys(roles).length;
  if(!configured) return {ok:true,email,role:'transition'};
  const entry=roles[email];
  const role=normalizeRole(typeof entry==='string'?entry:entry?.role);
  if(role==='admin'||role==='planner') return {ok:true,email,role};
  const site=findSite(data,siteId);
  const unit=site?findUnit(site,groupKey,unitId):null;
  const siteKeys=new Set([safe(siteId), slug(siteId), safe(site?.id), slug(site?.id), safe(site?.name), slug(site?.name)].filter(Boolean));
  const groupKeys=new Set([safe(groupKey), slug(groupKey), safe(unitId), slug(unitId), safe(unit?.id), slug(unit?.id), safe(unit?.plannerKey), slug(unit?.plannerKey), safe(unit?.name), slug(unit?.name)].filter(Boolean));
  const entrySites=list(entry?.sites || entry?.siteIds || entry?.houses || entry?.hausIds).map(x=>safe(typeof x==='string'?x:x?.id||x?.siteId||x?.name)).filter(Boolean);
  const entryGroups=list(entry?.groups || entry?.groupIds || entry?.units || entry?.unitIds).map(x=>safe(typeof x==='string'?x:x?.id||x?.groupKey||x?.plannerKey||x?.name)).filter(Boolean);
  if(role==='hausleitung'){
    if(!entrySites.length || entrySites.some(x=>siteKeys.has(x)||siteKeys.has(slug(x)))) return {ok:true,email,role};
  }
  if(role==='tko'){
    const siteOk=!entrySites.length || entrySites.some(x=>siteKeys.has(x)||siteKeys.has(slug(x)));
    const groupOk=!entryGroups.length || entryGroups.some(x=>groupKeys.has(x)||groupKeys.has(slug(x)));
    if(siteOk && groupOk) return {ok:true,email,role};
  }
  throw new Error('Kein Zugriff auf diese Gruppe für '+(email||'diese Sitzung')+'.');
}
function makeGroupId(siteId,groupKey,unitId){return slug(siteId)+'__'+slug(groupKey||unitId||'gruppe');}
function legacyItemKey(groupId){return 'polypoint_ki_planer_v13_clean__'+safe(groupId);}
function stateWeight(obj){
  try{
    const st=obj&&typeof obj==='object'?obj:{};
    return (list(st.employees).length*100000)+(Object.keys(st.plan||{}).length*10)+Object.keys(st.monthTargets||{}).length+Object.keys(st.balanceCarryovers||{}).length+Object.keys(st.standardNeeds||{}).length;
  }catch(_){return 0;}
}
function stableStringify(value){
  if(value===null || typeof value!=='object') return JSON.stringify(value);
  if(Array.isArray(value)) return '['+value.map(stableStringify).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableStringify(value[k])).join(',')+'}';
}
function simpleHash(value){
  const str=stableStringify(value||{});
  let h=2166136261;
  for(let i=0;i<str.length;i++){ h^=str.charCodeAt(i); h=Math.imul(h,16777619); }
  return 'h'+(h>>>0).toString(36);
}
function newRevision(){return 'grev_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);}
function ensureStores(data){
  if(!data.groupStates || typeof data.groupStates!=='object' || Array.isArray(data.groupStates)) data.groupStates={};
  if(!data.items || typeof data.items!=='object' || Array.isArray(data.items)) data.items={};
  if(!Array.isArray(data.groupStateBackups)) data.groupStateBackups=[];
  if(!Array.isArray(data.storageEvents)) data.storageEvents=[];
}
function addEvent(data,event){
  ensureStores(data);
  const ev=Object.assign({eventId:'ev_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),at:new Date().toISOString(),version:'1.0'},event||{});
  data.storageEvents.unshift(ev);
  data.storageEvents=data.storageEvents.slice(0,250);
  return ev.eventId;
}
function backupGroup(data,entry,reason,user){
  if(!entry || !entry.payload || stateWeight(entry.payload)<=0) return '';
  ensureStores(data);
  const id='grp_backup_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);
  data.groupStateBackups.unshift({
    id,at:new Date().toISOString(),reason:safe(reason)||'before-group-save',
    siteId:safe(entry.siteId),groupKey:safe(entry.groupKey),groupId:safe(entry.groupId),storageKey:safe(entry.storageKey),
    revisionId:safe(entry.revisionId),hash:simpleHash(entry.payload),weight:stateWeight(entry.payload),
    user:{id:user?.id||'',email:user?.email||''},
    entry:clone(entry)
  });
  data.groupStateBackups=data.groupStateBackups.slice(0,80);
  return id;
}
function eventInfo(data){
  return list(data?.storageEvents).map(e=>({eventId:e.eventId,at:e.at,type:e.type,entity:e.entity,siteId:e.siteId||'',groupKey:e.groupKey||'',objectId:e.objectId||'',revisionBefore:e.revisionBefore||'',revisionAfter:e.revisionAfter||'',backupId:e.backupId||'',summary:e.summary||{},user:e.user||{}})).slice(0,120);
}
function backupInfo(data,siteId,groupKey){
  const sid=slug(siteId), gk=slug(groupKey);
  return list(data?.groupStateBackups).filter(b=>!sid||slug(b.siteId)===sid).filter(b=>!gk||slug(b.groupKey)===gk||slug(b.groupId)===gk).map(b=>({id:b.id,at:b.at,reason:b.reason,siteId:b.siteId,groupKey:b.groupKey,groupId:b.groupId,revisionId:b.revisionId,weight:b.weight,user:b.user||{}})).slice(0,30);
}
function currentEntry(data,groupId,storageKey){
  ensureStores(data);
  const byId=data.groupStates[groupId];
  if(byId && byId.payload) return byId;
  const raw=data.items[storageKey] || data.items[legacyItemKey(groupId)];
  if(raw){
    try{
      const payload=typeof raw==='string'?JSON.parse(raw):raw;
      if(payload && typeof payload==='object'){
        return {groupId,storageKey,siteId:payload.siteId||'',groupKey:payload.planerGroupId||groupId,groupName:payload.planerGroupName||'',payload,revisionId:payload.groupRevision||payload.savedAt||'',updatedAt:payload.savedAt||''};
      }
    }catch(_){ }
  }
  return null;
}
function publicEntry(entry){
  if(!entry) return null;
  return {siteId:entry.siteId||'',groupKey:entry.groupKey||'',groupId:entry.groupId||'',groupName:entry.groupName||'',storageKey:entry.storageKey||'',revisionId:entry.revisionId||'',updatedAt:entry.updatedAt||'',weight:stateWeight(entry.payload),hash:simpleHash(entry.payload||{}),payload:entry.payload||null};
}
function summarizePayload(payload){
  return {employees:list(payload?.employees).length,planEntries:Object.keys(payload?.plan||{}).length,monthTargets:Object.keys(payload?.monthTargets||{}).length,balanceCarryovers:Object.keys(payload?.balanceCarryovers||{}).length,standardNeeds:Object.keys(payload?.standardNeeds||{}).length,selectedMonth:payload?.selectedMonth||'',selectedYear:payload?.selectedYear||''};
}

module.exports=async function handler(req,res){
  if(allow(req,res))return;
  if(req.method!=='POST')return send(res,405,{ok:false,message:'Nur POST erlaubt.'});
  try{
    const body=await readBody(req);
    const mode=safe(body.mode||'load');
    const row=await fetchStore();
    const data=row.data||{};
    ensureStores(data);

    const siteId=safe(body.siteId||body.site||'');
    const groupKey=safe(body.groupKey||body.plannerKey||body.unitId||'');
    const unitId=safe(body.unitId||'');
    const groupId=safe(body.groupId||makeGroupId(siteId,groupKey,unitId));
    const storageKey=safe(body.storageKey||legacyItemKey(groupId));

    const hasOrgAdmin=validOrgAdminSession(data, body.orgAdminToken) || validOrgAdminPassword(data, body.orgAdminPassword);
    let user=hasOrgAdmin ? {id:'org-admin-password',email:'org-admin-password'} : await verifySupabaseUserOptional(req);
    let access=hasOrgAdmin ? {ok:true,email:'org-admin-password',role:'org-admin-password'} : null;
    if(!access){
      if(!user) throw new Error('Server-Sitzung oder Admin-Zugriff erforderlich.');
      access=accessFor(data,user,siteId,groupKey,unitId);
    }

    const existing=currentEntry(data,groupId,storageKey);

    if(mode==='load'){
      return send(res,200,{ok:true,mode,access,updatedAt:row.updated_at||'',groupState:publicEntry(existing),groupRevision:existing?.revisionId||'',groupBackups:backupInfo(data,siteId,groupKey),storageEvents:eventInfo(data)});
    }

    if(mode==='save'){
      const payload=body.state || body.payload || body.groupState;
      if(!payload || typeof payload!=='object' || Array.isArray(payload)) throw new Error('Kein Gruppenstand übergeben.');
      const incomingWeight=stateWeight(payload);
      const existingWeight=stateWeight(existing?.payload);
      if(existingWeight>1000 && incomingWeight<Math.max(50,existingWeight*0.15) && body.allowEmpty!==true){
        return send(res,409,{ok:false,blocked:true,code:'GROUP_EMPTY_OVERWRITE_BLOCKED',message:'Speichern blockiert: Der neue Gruppenstand wirkt leer und würde einen gefüllten Gruppenstand überschreiben.',existingWeight,incomingWeight,groupState:publicEntry(existing),groupRevision:existing?.revisionId||'',groupBackups:backupInfo(data,siteId,groupKey),storageEvents:eventInfo(data)});
      }
      const currentRevision=safe(existing?.revisionId||'');
      const base=safe(body.baseGroupRevision||body.groupRevision||'');
      if(currentRevision && base && base!==currentRevision){
        return send(res,409,{ok:false,blocked:true,code:'STALE_GROUP_VERSION',message:'Speichern blockiert: Auf dem Server liegt bereits ein anderer Gruppenstand. Bitte Gruppe neu laden, damit kein älterer Stand überschreibt.',currentGroupRevision:currentRevision,baseGroupRevision:base,groupState:publicEntry(existing),groupBackups:backupInfo(data,siteId,groupKey),storageEvents:eventInfo(data)});
      }
      if(currentRevision && !base && body.requireRevision!==false){
        return send(res,409,{ok:false,blocked:true,code:'GROUP_REVISION_REQUIRED',message:'Speichern blockiert: Die Seite kennt den aktuellen Gruppenstand nicht. Bitte Gruppe neu laden und danach erneut speichern.',currentGroupRevision:currentRevision,groupState:publicEntry(existing),groupBackups:backupInfo(data,siteId,groupKey),storageEvents:eventInfo(data)});
      }

      const nextRevision=newRevision();
      const now=new Date().toISOString();
      const cleanPayload=clone(payload);
      cleanPayload.planerGroupId=cleanPayload.planerGroupId || groupId;
      cleanPayload.planerGroupName=cleanPayload.planerGroupName || safe(body.groupName||body.unitName||groupKey||groupId);
      cleanPayload.groupRevision=nextRevision;
      cleanPayload.savedAt=now;
      cleanPayload.serverSavedAt=now;
      cleanPayload.storageProfile='server-group-state';
      if(cleanPayload.api && typeof cleanPayload.api==='object') cleanPayload.api.key='';

      const backupId=backupGroup(data,existing,existing?'before-group-save':'before-group-create',user);
      const next={siteId,groupKey,unitId,groupId,storageKey,groupName:safe(body.groupName||body.unitName||cleanPayload.planerGroupName||groupKey),revisionId:nextRevision,updatedAt:now,updatedBy:{id:user?.id||'',email:user?.email||''},payload:cleanPayload,hash:simpleHash(cleanPayload),weight:stateWeight(cleanPayload)};
      data.groupStates[groupId]=next;
      data.items[storageKey]=JSON.stringify(cleanPayload);
      if(storageKey!==legacyItemKey(groupId)) data.items[legacyItemKey(groupId)]=JSON.stringify(cleanPayload);

      const eventType=existing?'group.state.updated':'group.state.created';
      addEvent(data,{type:eventType,entity:'group-state',siteId,groupKey,objectId:groupId,revisionBefore:currentRevision,revisionAfter:nextRevision,hashBefore:simpleHash(existing?.payload||{}),hashAfter:simpleHash(cleanPayload),backupId,user:{id:user?.id||'',email:user?.email||''},summary:{before:summarizePayload(existing?.payload||{}),after:summarizePayload(cleanPayload)}});
      data.activity=[{id:'act_group_'+Date.now(),at:now,action:'Gruppe gespeichert',area:'Gruppe',group:safe(body.groupName||groupKey||groupId),siteId,groupKey,groupId,user:{id:user?.id||'',name:user?.email||'',email:user?.email||''},eventType,backupId,note:'Gruppenstand separat gespeichert'}].concat(Array.isArray(data.activity)?data.activity:[]).slice(0,100);

      await saveStore(data);
      const verifyRow=await fetchStore();
      const verifyData=verifyRow.data||{};
      const verified=currentEntry(verifyData,groupId,storageKey);
      if(!verified || safe(verified.revisionId)!==nextRevision){
        return send(res,500,{ok:false,confirmed:false,code:'GROUP_SAVE_NOT_CONFIRMED',message:'Gruppenstand nicht bestätigt: Der Server hat die neue Gruppen-Revision nicht zurückgeliefert. Seite nicht verlassen.',expectedRevision:nextRevision,groupState:publicEntry(next),groupBackups:backupInfo(verifyData,siteId,groupKey),storageEvents:eventInfo(verifyData)});
      }
      return send(res,200,{ok:true,mode,confirmed:true,access,updatedAt:verifyRow.updated_at||now,groupState:publicEntry(verified),groupRevision:nextRevision,groupBackups:backupInfo(verifyData,siteId,groupKey),storageEvents:eventInfo(verifyData)});
    }

    return send(res,400,{ok:false,message:'Unbekannter Modus.'});
  }catch(err){
    return send(res,400,{ok:false,message:err.message||String(err),code:err.code||''});
  }
};
