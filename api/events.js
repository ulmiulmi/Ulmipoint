const {allow,send,readBody,fetchStore}=require('./_wishlib');

function safe(v){return String(v||'').trim();}
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
function validOrgAdminSession(data,tok){
  tok=safe(tok);
  const sessions=data?.organisationAdmin?.sessions || {};
  const s=sessions[tok];
  if(!s) return false;
  if(s.expiresAt && new Date(s.expiresAt).getTime() < Date.now()) return false;
  return true;
}
function siteCount(org){return org&&Array.isArray(org.sites)?org.sites.length:0;}
function backupInfo(data){
  const list=Array.isArray(data.organisationBackups)?data.organisationBackups:[];
  return list.map(b=>({
    id:b.id,
    at:b.at,
    reason:b.reason,
    sitesCount:b.sitesCount||siteCount(b.organisationStructure),
    siteNames:Array.isArray(b.siteNames)?b.siteNames:[],
    user:b.user||{}
  })).slice(0,25);
}
function eventInfo(data){
  const list=Array.isArray(data.storageEvents)?data.storageEvents:[];
  return list.map(e=>({
    eventId:e.eventId,
    at:e.at,
    type:e.type,
    entity:e.entity,
    siteId:e.siteId||'',
    groupKey:e.groupKey||'',
    objectId:e.objectId||'',
    revisionBefore:e.revisionBefore||'',
    revisionAfter:e.revisionAfter||'',
    backupId:e.backupId||'',
    reason:e.reason||'',
    summary:e.summary||{},
    user:e.user||{}
  })).slice(0,120);
}

module.exports=async function handler(req,res){
  if(allow(req,res))return;
  if(req.method!=='POST')return send(res,405,{ok:false,message:'Nur POST erlaubt.'});
  try{
    const body=await readBody(req);
    const row=await fetchStore();
    const data=row.data||{};
    const token=safe(body.orgAdminToken||'');
    const password=safe(body.orgAdminPassword||'');
    if(!validOrgAdminSession(data,token) && !validOrgAdminPassword(data,password)){
      return send(res,403,{ok:false,message:'Admin-Zugriff erforderlich.'});
    }
    return send(res,200,{ok:true,updatedAt:row.updated_at||'',events:eventInfo(data),organisationBackups:backupInfo(data)});
  }catch(err){
    return send(res,400,{ok:false,message:err.message||String(err)});
  }
};
