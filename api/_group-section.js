const {allow,send,readBody,fetchStore,saveStore}=require('./_wishlib');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.ULMIPOINT_SUPABASE_URL || process.env.POLYPOINT_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY;

function safe(v){return String(v||'').trim();}
function normEmail(v){return safe(v).toLowerCase();}
function slug(v){return safe(v).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')||'default';}
function clone(v){return JSON.parse(JSON.stringify(v==null?null:v));}
function list(v){return Array.isArray(v)?v:[];}
function normalizeRole(v){v=safe(v).toLowerCase(); if(['admin','administrator','leitung'].includes(v))return 'admin'; if(['planner','planer','planung'].includes(v))return 'planner'; if(['hausleitung','houselead','house_lead'].includes(v))return 'hausleitung'; if(['tko','teamkoordination','teamkoordinator'].includes(v))return 'tko'; if(['employee','mitarbeiter','ma'].includes(v))return 'employee'; return v;}
function roleStore(data){const roles=(data&&typeof data==='object')?(data.accessRoles||data.roles||{}):{}; return roles&&typeof roles==='object'?roles:{};}
function configuredOrgAdminPassword(data){return safe(process.env.ULMIPOINT_ORG_ADMIN_PASSWORD||process.env.ULMIPOINT_ADMIN_PASSWORD||process.env.ADMIN_PASSWORD||data?.organisationAdmin?.password||data?.adminPassword||'');}
function constantTimeEqual(a,b){a=String(a||'');b=String(b||'');if(!a||!b||a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0;}
function validOrgAdminPassword(data,pw){const configured=configuredOrgAdminPassword(data);return !!configured&&constantTimeEqual(safe(pw),configured);}
function validOrgAdminSession(data,tok){tok=safe(tok);const s=(data?.organisationAdmin?.sessions||{})[tok];if(!s)return false;if(s.expiresAt&&new Date(s.expiresAt).getTime()<Date.now())return false;return true;}
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
function orgSites(data){return list(data?.organisationStructure?.sites);}
function findSite(data,siteId){const id=slug(siteId);return orgSites(data).find(s=>slug(s.id||s.name)===id||safe(s.id)===safe(siteId)||safe(s.name)===safe(siteId))||null;}
function findUnit(site,groupKey,unitId){const g=safe(groupKey),u=safe(unitId),gs=slug(g),us=slug(u);return list(site?.units).find(x=>safe(x.plannerKey)===g||safe(x.id)===u||safe(x.id)===g||slug(x.plannerKey||x.id||x.name)===gs||slug(x.id||x.name)===us)||null;}
function accessFor(data,user,siteId,groupKey,unitId){
  const email=normEmail(user?.email);const roles=roleStore(data);const configured=Object.keys(roles).length;if(!configured)return{ok:true,email,role:'transition'};
  const entry=roles[email];const role=normalizeRole(typeof entry==='string'?entry:entry?.role);
  if(role==='admin'||role==='planner')return{ok:true,email,role};
  const site=findSite(data,siteId);const unit=site?findUnit(site,groupKey,unitId):null;
  const siteKeys=new Set([safe(siteId),slug(siteId),safe(site?.id),slug(site?.id),safe(site?.name),slug(site?.name)].filter(Boolean));
  const groupKeys=new Set([safe(groupKey),slug(groupKey),safe(unitId),slug(unitId),safe(unit?.id),slug(unit?.id),safe(unit?.plannerKey),slug(unit?.plannerKey),safe(unit?.name),slug(unit?.name)].filter(Boolean));
  const entrySites=list(entry?.sites||entry?.siteIds||entry?.houses||entry?.hausIds).map(x=>safe(typeof x==='string'?x:x?.id||x?.siteId||x?.name)).filter(Boolean);
  const entryGroups=list(entry?.groups||entry?.groupIds||entry?.units||entry?.unitIds).map(x=>safe(typeof x==='string'?x:x?.id||x?.groupKey||x?.plannerKey||x?.name)).filter(Boolean);
  if(role==='hausleitung'){if(!entrySites.length||entrySites.some(x=>siteKeys.has(x)||siteKeys.has(slug(x))))return{ok:true,email,role};}
  if(role==='tko'){const siteOk=!entrySites.length||entrySites.some(x=>siteKeys.has(x)||siteKeys.has(slug(x)));const groupOk=!entryGroups.length||entryGroups.some(x=>groupKeys.has(x)||groupKeys.has(slug(x)));if(siteOk&&groupOk)return{ok:true,email,role};}
  throw new Error('Kein Zugriff auf diese Gruppe.');
}
function stableStringify(value){if(value===null||typeof value!=='object')return JSON.stringify(value);if(Array.isArray(value))return '['+value.map(stableStringify).join(',')+']';return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+stableStringify(value[k])).join(',')+'}';}
function simpleHash(value){const str=stableStringify(value||{});let h=2166136261;for(let i=0;i<str.length;i++){h^=str.charCodeAt(i);h=Math.imul(h,16777619);}return 'h'+(h>>>0).toString(36);}
function newRevision(prefix){return (prefix||'srev')+'_'+Date.now().toString(36)+'_'+Math.random().toString(36).slice(2,8);}
function makeGroupId(siteId,groupKey,unitId){return slug(siteId)+'__'+slug(groupKey||unitId||'gruppe');}
function legacyItemKey(groupId){return 'polypoint_ki_planer_v13_clean__'+safe(groupId);}
function ensureStores(data){if(!data.groupStates||typeof data.groupStates!=='object'||Array.isArray(data.groupStates))data.groupStates={};if(!data.items||typeof data.items!=='object'||Array.isArray(data.items))data.items={};if(!Array.isArray(data.groupStateBackups))data.groupStateBackups=[];if(!Array.isArray(data.storageEvents))data.storageEvents=[];}
function stateWeight(obj){try{return (list(obj?.employees).length*100000)+(Object.keys(obj?.plan||{}).length*10)+Object.keys(obj?.monthTargets||{}).length+Object.keys(obj?.balanceCarryovers||{}).length+Object.keys(obj?.standardNeeds||{}).length;}catch(_){return 0;}}
function currentEntry(data,groupId,storageKey){ensureStores(data);const byId=data.groupStates[groupId];if(byId&&byId.payload)return byId;const raw=data.items[storageKey]||data.items[legacyItemKey(groupId)];if(raw){try{const payload=typeof raw==='string'?JSON.parse(raw):raw;if(payload&&typeof payload==='object')return{groupId,storageKey,siteId:payload.siteId||'',groupKey:payload.planerGroupId||groupId,groupName:payload.planerGroupName||'',payload,revisionId:payload.groupRevision||payload.savedAt||'',updatedAt:payload.savedAt||''};}catch(_){ }}return null;}
function addEvent(data,event){ensureStores(data);const ev=Object.assign({eventId:'ev_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),at:new Date().toISOString(),version:'1.1'},event||{});data.storageEvents.unshift(ev);data.storageEvents=data.storageEvents.slice(0,300);return ev.eventId;}
function backupGroup(data,entry,reason,user){if(!entry||!entry.payload||stateWeight(entry.payload)<=0)return'';ensureStores(data);const id='grp_backup_'+Date.now()+'_'+Math.random().toString(36).slice(2,7);data.groupStateBackups.unshift({id,at:new Date().toISOString(),reason:safe(reason)||'before-section-save',siteId:safe(entry.siteId),groupKey:safe(entry.groupKey),groupId:safe(entry.groupId),storageKey:safe(entry.storageKey),revisionId:safe(entry.revisionId),hash:simpleHash(entry.payload),weight:stateWeight(entry.payload),user:{id:user?.id||'',email:user?.email||''},entry:clone(entry)});data.groupStateBackups=data.groupStateBackups.slice(0,100);return id;}
function publicSection(entry,keys){const payload=entry?.payload||{};const section={};keys.forEach(k=>{section[k]=clone(payload[k]);});return{groupId:entry?.groupId||'',siteId:entry?.siteId||'',groupKey:entry?.groupKey||'',revisionId:entry?.revisionId||'',updatedAt:entry?.updatedAt||'',hash:simpleHash(section),section};}
function pickSection(src,keys){const out={};keys.forEach(k=>{if(Object.prototype.hasOwnProperty.call(src||{},k))out[k]=clone(src[k]);});return out;}
function summarizeSection(obj){const s=obj||{};return{employees:list(s.employees).length,planEntries:Object.keys(s.plan||{}).length,wishes:list(s.wishes||s.requests||s.employeeWishes).length,monthTargets:Object.keys(s.monthTargets||{}).length,standardNeeds:Object.keys(s.standardNeeds||{}).length};}
function makeHandler(config){
  const entity=config.entity;const keys=config.keys;const label=config.label||entity;
  return async function handler(req,res){
    if(allow(req,res))return;
    if(req.method!=='POST')return send(res,405,{ok:false,message:'Nur POST erlaubt.'});
    try{
      const body=await readBody(req);const mode=safe(body.mode||'load');const row=await fetchStore();const data=row.data||{};ensureStores(data);
      const siteId=safe(body.siteId||body.site||'');const groupKey=safe(body.groupKey||body.plannerKey||body.unitId||'');const unitId=safe(body.unitId||'');const groupId=safe(body.groupId||makeGroupId(siteId,groupKey,unitId));const storageKey=safe(body.storageKey||legacyItemKey(groupId));
      const hasOrgAdmin=validOrgAdminSession(data,body.orgAdminToken)||validOrgAdminPassword(data,body.orgAdminPassword);
      let user=hasOrgAdmin?{id:'org-admin-password',email:'org-admin-password'}:await verifySupabaseUserOptional(req);
      let access=hasOrgAdmin?{ok:true,email:'org-admin-password',role:'org-admin-password'}:null;
      if(!access){if(!user)throw new Error('Server-Sitzung oder Admin-Zugriff erforderlich.');access=accessFor(data,user,siteId,groupKey,unitId);}
      const existing=currentEntry(data,groupId,storageKey);
      if(mode==='load')return send(res,200,{ok:true,mode,access,section:publicSection(existing,keys)});
      if(mode!=='save')return send(res,400,{ok:false,message:'Unbekannter Modus.'});
      const incoming=body.section||body.payload||{};if(!incoming||typeof incoming!=='object'||Array.isArray(incoming))throw new Error('Kein Abschnitt übergeben.');
      const part=pickSection(incoming,keys);const now=new Date().toISOString();const currentRevision=safe(existing?.revisionId||'');const base=safe(body.baseGroupRevision||body.groupRevision||'');
      if(currentRevision&&base&&base!==currentRevision)return send(res,409,{ok:false,blocked:true,code:'STALE_GROUP_VERSION',message:'Speichern blockiert: Auf dem Server liegt bereits ein anderer Gruppenstand.',currentGroupRevision:currentRevision,baseGroupRevision:base,section:publicSection(existing,keys)});
      const backupId=backupGroup(data,existing,'before-'+entity+'-save',user);
      const payload=clone(existing?.payload||{});Object.assign(payload,part);payload.planerGroupId=payload.planerGroupId||groupId;payload.planerGroupName=payload.planerGroupName||safe(body.groupName||body.unitName||groupKey||groupId);payload.siteId=payload.siteId||siteId;payload.siteName=payload.siteName||safe(body.siteName||'');payload.unitId=payload.unitId||unitId;payload.unitName=payload.unitName||safe(body.unitName||payload.planerGroupName||'');payload.storageProfile='server-group-state';payload.savedAt=now;payload.serverSavedAt=now;payload.groupRevision=newRevision('grev');if(payload.api&&typeof payload.api==='object')payload.api.key='';
      const nextRevision=payload.groupRevision;const next={siteId,groupKey,unitId,groupId,storageKey,groupName:payload.planerGroupName,revisionId:nextRevision,updatedAt:now,updatedBy:{id:user?.id||'',email:user?.email||''},payload,hash:simpleHash(payload),weight:stateWeight(payload)};
      data.groupStates[groupId]=next;data.items[storageKey]=JSON.stringify(payload);if(storageKey!==legacyItemKey(groupId))data.items[legacyItemKey(groupId)]=JSON.stringify(payload);
      addEvent(data,{type:'group.'+entity+'.updated',entity:'group-'+entity,siteId,groupKey,objectId:groupId,revisionBefore:currentRevision,revisionAfter:nextRevision,backupId,user:{id:user?.id||'',email:user?.email||''},summary:{label,before:summarizeSection(pickSection(existing?.payload||{},keys)),after:summarizeSection(part)}});
      await saveStore(data);const verifyRow=await fetchStore();const verifyData=verifyRow.data||{};const verified=currentEntry(verifyData,groupId,storageKey);
      if(!verified||safe(verified.revisionId)!==nextRevision)return send(res,500,{ok:false,confirmed:false,message:label+' nicht bestätigt. Seite nicht verlassen.',expectedRevision:nextRevision,section:publicSection(next,keys)});
      return send(res,200,{ok:true,mode,confirmed:true,access,updatedAt:verifyRow.updated_at||now,groupRevision:nextRevision,section:publicSection(verified,keys)});
    }catch(err){return send(res,400,{ok:false,message:err.message||String(err),code:err.code||''});}
  };
}
module.exports={makeHandler};
