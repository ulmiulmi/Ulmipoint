const {allow,send,readBody,fetchStore,saveStore}=require('./_wishlib');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.ULMIPOINT_SUPABASE_URL || process.env.POLYPOINT_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY;

function safe(v){return String(v==null?'':v).trim();}
function normEmail(v){return safe(v).toLowerCase();}
function list(v){return Array.isArray(v)?v:[];}
function clone(v){return JSON.parse(JSON.stringify(v==null?null:v));}
function slug(v){return safe(v).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')||'default';}
function nowIso(){return new Date().toISOString();}
function uid(prefix){return (prefix||'id')+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);}
function stableStringify(value){
  if(value===null||typeof value!=='object')return JSON.stringify(value);
  if(Array.isArray(value))return '['+value.map(stableStringify).join(',')+']';
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableStringify(value[k])).join(',')+'}';
}
function simpleHash(value){
  const str=stableStringify(value||{});
  let h=2166136261;
  for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}
  return 'h'+(h>>>0).toString(36);
}
function objectWeight(obj){
  if(!obj||typeof obj!=='object')return 0;
  try{
    let weight=0;
    if(Array.isArray(obj))return obj.length;
    if(Array.isArray(obj.employees))weight+=obj.employees.length*100000;
    if(obj.plan&&typeof obj.plan==='object')weight+=Object.keys(obj.plan).length*1000;
    if(obj.wishes&&typeof obj.wishes==='object')weight+=Object.keys(obj.wishes).length*100;
    if(obj.days&&typeof obj.days==='object')weight+=Object.keys(obj.days).length*50;
    if(obj.months&&typeof obj.months==='object')weight+=Object.keys(obj.months).length*50;
    if(obj.settings&&typeof obj.settings==='object')weight+=Object.keys(obj.settings).length*20;
    weight+=Object.keys(obj).length;
    return weight;
  }catch(_){return 1;}
}
function ensureStores(data){
  if(!data||typeof data!=='object')throw new Error('Ungültiger Server-Speicher.');
  if(!data.groupStores||typeof data.groupStores!=='object'||Array.isArray(data.groupStores))data.groupStores={};
  if(!data.groupStates||typeof data.groupStates!=='object'||Array.isArray(data.groupStates))data.groupStates={};
  if(!data.items||typeof data.items!=='object'||Array.isArray(data.items))data.items={};
  if(!Array.isArray(data.storageEvents))data.storageEvents=[];
  if(!Array.isArray(data.groupStateBackups))data.groupStateBackups=[];
  if(!Array.isArray(data.groupSectionBackups))data.groupSectionBackups=[];
}
function configuredOrgAdminPassword(data){
  return safe(process.env.ULMIPOINT_ORG_ADMIN_PASSWORD||process.env.ULMIPOINT_ADMIN_PASSWORD||process.env.ADMIN_PASSWORD||data?.organisationAdmin?.password||data?.adminPassword||'');
}
function constantTimeEqual(a,b){
  a=String(a||'');b=String(b||'');
  if(!a||!b||a.length!==b.length)return false;
  let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);
  return r===0;
}
function validOrgAdminPassword(data,pw){const c=configuredOrgAdminPassword(data);return !!c&&constantTimeEqual(safe(pw),c);}
function validOrgAdminSession(data,tok){
  tok=safe(tok);
  const s=(data?.organisationAdmin?.sessions||{})[tok];
  if(!s)return false;
  if(s.expiresAt&&new Date(s.expiresAt).getTime()<Date.now())return false;
  return true;
}
async function verifySupabaseUser(req){
  const auth=safe(req.headers.authorization||req.headers.Authorization);
  const token=auth.replace(/^Bearer\s+/i,'');
  if(!token)throw new Error('Server-Sitzung oder Admin-Zugriff erforderlich.');
  if(!SUPABASE_URL||!SERVICE_KEY)throw new Error('Server-Umgebung fehlt: SUPABASE_URL oder SERVICE KEY.');
  const resp=await fetch(SUPABASE_URL+'/auth/v1/user',{method:'GET',headers:{apikey:SERVICE_KEY,Authorization:'Bearer '+token}});
  const txt=await resp.text();let user=null;try{user=txt?JSON.parse(txt):null;}catch(_){ }
  if(!resp.ok||!user||!user.id)throw new Error('Server-Sitzung ungültig oder abgelaufen.');
  return user;
}
async function verifySupabaseUserOptional(req){try{return await verifySupabaseUser(req);}catch(_){return null;}}
function normalizeRole(v){
  v=safe(v).toLowerCase();
  if(['admin','administrator','leitung'].includes(v))return 'admin';
  if(['planner','planer','planung'].includes(v))return 'planner';
  if(['hausleitung','houselead','house_lead'].includes(v))return 'hausleitung';
  if(['tko','teamkoordination','teamkoordinator'].includes(v))return 'tko';
  if(['employee','mitarbeiter','ma'].includes(v))return 'employee';
  return v;
}
function roleStore(data){
  const roles=(data&&typeof data==='object')?(data.accessRoles||data.roles||{}):{};
  return roles&&typeof roles==='object'?roles:{};
}
function orgSites(data){return list(data?.organisationStructure?.sites);}
function findSite(data,siteId){
  const id=slug(siteId);
  return orgSites(data).find(s=>safe(s.id)===safe(siteId)||safe(s.name)===safe(siteId)||slug(s.id||s.name)===id)||null;
}
function findUnit(site,groupKey,unitId){
  const g=safe(groupKey), u=safe(unitId), gs=slug(g), us=slug(u);
  return list(site?.units).find(x=>safe(x.plannerKey)===g||safe(x.id)===u||safe(x.id)===g||slug(x.plannerKey||x.id||x.name)===gs||slug(x.id||x.name)===us)||null;
}
function accessFor(data,user,siteId,groupKey,unitId,write){
  const email=normEmail(user?.email);
  const roles=roleStore(data);
  const configured=Object.keys(roles).length;
  if(!configured)return{ok:true,email,role:'transition'};
  const entry=roles[email];
  const role=normalizeRole(typeof entry==='string'?entry:entry?.role);
  if(role==='admin'||role==='planner')return{ok:true,email,role};
  const site=findSite(data,siteId);
  const unit=site?findUnit(site,groupKey,unitId):null;
  const siteKeys=new Set([safe(siteId),slug(siteId),safe(site?.id),slug(site?.id),safe(site?.name),slug(site?.name)].filter(Boolean));
  const groupKeys=new Set([safe(groupKey),slug(groupKey),safe(unitId),slug(unitId),safe(unit?.id),slug(unit?.id),safe(unit?.plannerKey),slug(unit?.plannerKey),safe(unit?.name),slug(unit?.name)].filter(Boolean));
  const entrySites=list(entry?.sites||entry?.siteIds||entry?.houses||entry?.hausIds).map(x=>safe(typeof x==='string'?x:x?.id||x?.siteId||x?.name)).filter(Boolean);
  const entryGroups=list(entry?.groups||entry?.groupIds||entry?.units||entry?.unitIds).map(x=>safe(typeof x==='string'?x:x?.id||x?.groupKey||x?.plannerKey||x?.name)).filter(Boolean);
  if(role==='hausleitung'){
    if(!entrySites.length||entrySites.some(x=>siteKeys.has(x)||siteKeys.has(slug(x))))return{ok:true,email,role};
  }
  if(role==='tko'){
    const siteOk=!entrySites.length||entrySites.some(x=>siteKeys.has(x)||siteKeys.has(slug(x)));
    const groupOk=!entryGroups.length||entryGroups.some(x=>groupKeys.has(x)||groupKeys.has(slug(x)));
    if(siteOk&&groupOk)return{ok:true,email,role};
  }
  if(!write&&role==='employee')return{ok:true,email,role:'employee-read'};
  throw new Error('Kein Zugriff auf diese Gruppe.');
}
async function resolveAccess(req,data,body,write){
  if(validOrgAdminSession(data,body.orgAdminToken)||validOrgAdminPassword(data,body.orgAdminPassword)){
    return{user:{id:'org-admin',email:'org-admin-password'},access:{ok:true,email:'org-admin-password',role:'org-admin'}};
  }
  const user=await verifySupabaseUserOptional(req);
  if(user)return{user,access:accessFor(data,user,body.siteId||body.site,body.groupKey||body.plannerKey,body.unitId,write)};
  const roles=roleStore(data);
  if(!Object.keys(roles).length)return{user:{id:'transition',email:''},access:{ok:true,email:'',role:'transition'}};
  if(!write)return{user:{id:'anonymous-read',email:''},access:{ok:true,email:'',role:'anonymous-read'}};
  throw new Error('Admin-Zugriff oder gültige Sitzung erforderlich.');
}
function makeGroupId(siteId,groupKey,unitId){return slug(siteId)+'__'+slug(groupKey||unitId||'gruppe');}
function legacyItemKey(groupId){return 'polypoint_ki_planer_v13_clean__'+safe(groupId);}
function parseJsonMaybe(v){if(!v)return null;if(typeof v==='object')return v;if(typeof v!=='string')return null;try{return JSON.parse(v)}catch(_){return null}}
function getGroupStore(data,groupId){
  ensureStores(data);
  if(!data.groupStores[groupId]||typeof data.groupStores[groupId]!=='object'||Array.isArray(data.groupStores[groupId])){
    data.groupStores[groupId]={groupId,sections:{},revisions:{},updatedAt:'',createdAt:nowIso()};
  }
  if(!data.groupStores[groupId].sections||typeof data.groupStores[groupId].sections!=='object')data.groupStores[groupId].sections={};
  if(!data.groupStores[groupId].revisions||typeof data.groupStores[groupId].revisions!=='object')data.groupStores[groupId].revisions={};
  return data.groupStores[groupId];
}
function readLegacyState(data,groupId,storageKey){
  const gs=data.groupStates?.[groupId];
  if(gs&&gs.payload)return gs.payload;
  const raw=data.items?.[storageKey]||data.items?.[legacyItemKey(groupId)];
  return parseJsonMaybe(raw);
}
function readSection(data,groupId,section,storageKey){
  ensureStores(data);
  const store=data.groupStores?.[groupId];
  if(store&&store.sections&&Object.prototype.hasOwnProperty.call(store.sections,section)){
    return {payload:clone(store.sections[section]),revisionId:safe(store.revisions?.[section]),updatedAt:safe(store.updatedAt),source:'groupStores'};
  }
  if(section==='state'){
    const legacy=readLegacyState(data,groupId,storageKey);
    if(legacy)return{payload:clone(legacy),revisionId:safe(legacy.groupRevision||legacy.revisionId||''),updatedAt:safe(legacy.savedAt||legacy.updatedAt||''),source:'legacy'};
  }
  return{payload:null,revisionId:'',updatedAt:'',source:'empty'};
}
function groupSummary(data){
  ensureStores(data);
  return Object.entries(data.groupStores).map(([id,g])=>({
    groupId:id,siteId:safe(g.siteId),groupKey:safe(g.groupKey),groupName:safe(g.groupName),
    updatedAt:safe(g.updatedAt),sections:Object.keys(g.sections||{}),revisions:g.revisions||{},
    weight:Object.values(g.sections||{}).reduce((a,v)=>a+objectWeight(v),0)
  })).slice(0,300);
}
function eventSummary(data){
  return list(data?.storageEvents).map(e=>({
    eventId:e.eventId,at:e.at,type:e.type,entity:e.entity,siteId:e.siteId||'',groupKey:e.groupKey||'',objectId:e.objectId||'',section:e.section||'',
    revisionBefore:e.revisionBefore||'',revisionAfter:e.revisionAfter||'',hashBefore:e.hashBefore||'',hashAfter:e.hashAfter||'',backupId:e.backupId||'',summary:e.summary||{},user:e.user||{}
  })).slice(0,300);
}
function backupSummary(data){
  return list(data?.groupSectionBackups).map(b=>({id:b.id,at:b.at,reason:b.reason,siteId:b.siteId,groupKey:b.groupKey,groupId:b.groupId,section:b.section,revisionId:b.revisionId,weight:b.weight,user:b.user||{}})).slice(0,80);
}
function orgSummary(row,data){
  const org=data?.organisationStructure||null;
  return {updatedAt:row?.updated_at||'',revisionId:data?.organisationRevision||data?.revisionId||'',sitesCount:Array.isArray(org?.sites)?org.sites.length:0,siteNames:Array.isArray(org?.sites)?org.sites.map(s=>s.name||s.id||'').filter(Boolean):[],hasOrganisation:!!org};
}
function addEvent(data,event){
  ensureStores(data);
  const ev=Object.assign({eventId:uid('ev'),at:nowIso(),version:'storage-v105a'},event||{});
  data.storageEvents.unshift(ev);
  data.storageEvents=data.storageEvents.slice(0,300);
  return ev.eventId;
}
function addBackup(data,entry){
  ensureStores(data);
  if(!entry||objectWeight(entry.payload)<=0)return'';
  const id=uid('gsec_backup');
  data.groupSectionBackups.unshift(Object.assign({id,at:nowIso(),version:'storage-v105a'},entry));
  data.groupSectionBackups=data.groupSectionBackups.slice(0,120);
  return id;
}
function publicSection(row,data,meta,section,payloadInfo){
  const cur=payloadInfo||readSection(data,meta.groupId,section,meta.storageKey);
  return {ok:true,mode:'load',section,access:meta.access||null,organisation:orgSummary(row,data),group:{siteId:meta.siteId,groupKey:meta.groupKey,unitId:meta.unitId,groupId:meta.groupId,groupName:meta.groupName,storageKey:meta.storageKey},revisionId:cur.revisionId||'',source:cur.source||'',updatedAt:cur.updatedAt||'',weight:objectWeight(cur.payload),hash:simpleHash(cur.payload||{}),payload:cur.payload||null,events:eventSummary(data),groupBackups:backupSummary(data)};
}
function paramsFromRequest(req,body){
  const url=new URL(req.url||'/', 'https://ulmipoint.local');
  const q=url.searchParams;
  const get=(k)=>safe(body?.[k]||q.get(k)||'');
  const siteId=get('siteId')||get('site')||get('house')||get('haus');
  const groupKey=get('groupKey')||get('plannerKey')||get('unitId')||get('group')||get('gruppe');
  const unitId=get('unitId');
  const groupId=get('groupId')||makeGroupId(siteId,groupKey,unitId);
  const storageKey=get('storageKey')||legacyItemKey(groupId);
  const groupName=get('groupName')||get('unitName')||groupKey||groupId;
  return{siteId,groupKey,unitId,groupId,storageKey,groupName};
}
async function handleSection(req,res,section){
  if(allow(req,res))return;
  try{
    const isGet=req.method==='GET';
    if(!isGet&&req.method!=='POST')return send(res,405,{ok:false,message:'Nur GET oder POST erlaubt.'});
    const body=isGet?{}:await readBody(req);
    const row=await fetchStore();
    const data=row.data||{};
    ensureStores(data);
    const meta=paramsFromRequest(req,body);
    if(!meta.siteId||!meta.groupKey)return send(res,400,{ok:false,message:'siteId und groupKey fehlen.',expected:'?siteId=...&groupKey=...'});
    const mode=safe(body.mode||body.action||(isGet?'load':'load')).toLowerCase()||'load';
    const write=mode==='save'||mode==='update'||mode==='import';
    const auth=await resolveAccess(req,data,Object.assign({},body,meta),write);
    meta.access=auth.access;

    if(!write){
      return send(res,200,publicSection(row,data,meta,section));
    }

    let payload=body.payload;
    if(payload===undefined)payload=body.state;
    if(payload===undefined)payload=body[section];
    if(payload===undefined&&section==='employees')payload=body.employees;
    if(payload===undefined&&section==='plan')payload=body.plan;
    if(payload===undefined&&section==='wishes')payload=body.wishes;
    if(payload===undefined)throw new Error('Kein Speicherinhalt übergeben.');
    if(typeof payload!=='object'||payload===null)throw new Error('Speicherinhalt muss ein Objekt oder Array sein.');

    const before=readSection(data,meta.groupId,section,meta.storageKey);
    const beforeWeight=objectWeight(before.payload);
    const incomingWeight=objectWeight(payload);
    if(beforeWeight>1000&&incomingWeight<Math.max(50,beforeWeight*0.15)&&body.allowEmpty!==true){
      return send(res,409,{ok:false,blocked:true,code:'GROUP_SECTION_EMPTY_OVERWRITE_BLOCKED',message:'Speichern blockiert: Der neue Gruppenbereich wirkt leer und würde einen gefüllten Gruppenbereich überschreiben.',section,existingWeight:beforeWeight,incomingWeight,group:meta,server:publicSection(row,data,meta,section,before)});
    }
    const base=safe(body.baseRevision||body.baseSectionRevision||body.revisionId||body.groupRevision||'');
    const current=safe(before.revisionId||'');
    if(current&&base&&base!==current){
      return send(res,409,{ok:false,blocked:true,code:'STALE_GROUP_SECTION_VERSION',message:'Speichern blockiert: Auf dem Server liegt bereits ein anderer Gruppenstand. Bitte Gruppe neu laden.',section,currentRevision:current,baseRevision:base,server:publicSection(row,data,meta,section,before)});
    }
    if(current&&!base&&body.requireRevision===true){
      return send(res,409,{ok:false,blocked:true,code:'GROUP_SECTION_REVISION_REQUIRED',message:'Speichern blockiert: Die Seite kennt die aktuelle Revision nicht. Bitte Gruppe neu laden.',section,currentRevision:current,server:publicSection(row,data,meta,section,before)});
    }

    const store=getGroupStore(data,meta.groupId);
    const nextRevision=uid('gsec');
    const now=nowIso();
    const clean=clone(payload);
    const backupId=addBackup(data,{reason:before.payload?'before-'+section+'-save':'before-'+section+'-create',siteId:meta.siteId,groupKey:meta.groupKey,groupId:meta.groupId,groupName:meta.groupName,section,revisionId:before.revisionId||'',hash:simpleHash(before.payload||{}),weight:beforeWeight,user:{id:auth.user?.id||'',email:auth.user?.email||''},payload:before.payload});

    Object.assign(store,{siteId:meta.siteId,groupKey:meta.groupKey,unitId:meta.unitId,groupId:meta.groupId,groupName:meta.groupName,storageKey:meta.storageKey,updatedAt:now,updatedBy:{id:auth.user?.id||'',email:auth.user?.email||''}});
    store.sections[section]=clean;
    store.revisions[section]=nextRevision;
    store.hashes=store.hashes||{};
    store.hashes[section]=simpleHash(clean);

    if(section==='state'){
      const statePayload=clone(clean);
      if(statePayload&&typeof statePayload==='object'&&!Array.isArray(statePayload)){
        statePayload.planerGroupId=statePayload.planerGroupId||meta.groupId;
        statePayload.planerGroupName=statePayload.planerGroupName||meta.groupName;
        statePayload.groupRevision=nextRevision;
        statePayload.savedAt=now;
        statePayload.serverSavedAt=now;
        statePayload.storageProfile='server-group-state-v105a';
      }
      data.groupStates[meta.groupId]={siteId:meta.siteId,groupKey:meta.groupKey,unitId:meta.unitId,groupId:meta.groupId,storageKey:meta.storageKey,groupName:meta.groupName,revisionId:nextRevision,updatedAt:now,payload:statePayload,hash:simpleHash(statePayload),weight:objectWeight(statePayload)};
      data.items[meta.storageKey]=JSON.stringify(statePayload);
      data.items[legacyItemKey(meta.groupId)]=JSON.stringify(statePayload);
    }

    addEvent(data,{type:'group.'+section+'.updated',entity:'group-section',siteId:meta.siteId,groupKey:meta.groupKey,objectId:meta.groupId,section,revisionBefore:before.revisionId||'',revisionAfter:nextRevision,hashBefore:simpleHash(before.payload||{}),hashAfter:simpleHash(clean),backupId,user:{id:auth.user?.id||'',email:auth.user?.email||''},summary:{beforeWeight,incomingWeight}});
    data.activity=[{id:uid('act_group'),at:now,action:'Gruppenbereich gespeichert',area:'Gruppe',group:meta.groupName,siteId:meta.siteId,groupKey:meta.groupKey,groupId:meta.groupId,section,user:{id:auth.user?.id||'',email:auth.user?.email||''},backupId,note:'Separater Gruppen-Speicherbereich'}].concat(Array.isArray(data.activity)?data.activity:[]).slice(0,100);

    await saveStore(data);
    const verifyRow=await fetchStore();
    const verifyData=verifyRow.data||{};
    ensureStores(verifyData);
    const after=readSection(verifyData,meta.groupId,section,meta.storageKey);
    if(safe(after.revisionId)!==nextRevision){
      return send(res,500,{ok:false,confirmed:false,code:'GROUP_SECTION_SAVE_NOT_CONFIRMED',message:'Speichern nicht bestätigt: Der Server hat die neue Gruppen-Revision nicht zurückgeliefert. Seite nicht verlassen.',section,expectedRevision:nextRevision,server:publicSection(verifyRow,verifyData,meta,section,after)});
    }
    return send(res,200,Object.assign(publicSection(verifyRow,verifyData,meta,section,after),{mode:'save',confirmed:true,message:'Gruppenbereich gespeichert und vom Server bestätigt.'}));
  }catch(err){
    return send(res,400,{ok:false,message:err.message||String(err)});
  }
}
function eventsReport(row,data,includePrivate){
  ensureStores(data);
  return {ok:true,version:'storage-v105a',updatedAt:row?.updated_at||'',organisation:orgSummary(row,data),events:eventSummary(data),groupStores:groupSummary(data),groupSectionBackups:backupSummary(data),organisationBackups:list(data.organisationBackups).map(b=>({id:b.id,at:b.at,reason:b.reason,sitesCount:b.sitesCount,siteNames:b.siteNames||[],revisionId:b.revisionId||'',hash:b.hash||''})).slice(0,80),debug:includePrivate?{storeKeys:Object.keys(data).sort()}:undefined};
}

module.exports={allow,send,readBody,fetchStore,saveStore,safe,slug,list,clone,ensureStores,eventsReport,handleSection};
