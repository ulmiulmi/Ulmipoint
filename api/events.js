const {allow,send,readBody,fetchStore}=require('./_wishlib');

function safe(v){return String(v||'').trim();}
function list(v){return Array.isArray(v)?v:[];}
function siteCount(org){return org&&Array.isArray(org.sites)?org.sites.length:0;}
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
function backupInfo(data){
  return list(data.organisationBackups).map(b=>({
    id:b.id,at:b.at,reason:b.reason,
    sitesCount:b.sitesCount||siteCount(b.organisationStructure),
    siteNames:Array.isArray(b.siteNames)?b.siteNames:[],
    revisionId:b.revisionId||'',hash:b.hash||'',user:b.user||{}
  })).slice(0,50);
}
function groupBackupInfo(data){
  return list(data.groupStateBackups).map(b=>({
    id:b.id,at:b.at,reason:b.reason,siteId:b.siteId||'',groupKey:b.groupKey||'',
    groupId:b.groupId||'',revisionId:b.revisionId||'',weight:b.weight||0,user:b.user||{}
  })).slice(0,80);
}
function eventInfo(data){
  return list(data.storageEvents).map(e=>({
    eventId:e.eventId,at:e.at,type:e.type,entity:e.entity,
    siteId:e.siteId||'',groupKey:e.groupKey||'',objectId:e.objectId||'',
    revisionBefore:e.revisionBefore||'',revisionAfter:e.revisionAfter||'',
    backupId:e.backupId||'',reason:e.reason||'',summary:e.summary||{},user:e.user||{}
  })).slice(0,250);
}
function publicReport(row,data){
  const org=data.organisationStructure||null;
  return {
    ok:true,
    updatedAt:row.updated_at||'',
    organisation:{
      revisionId:data.organisationRevision||data.revisionId||'',
      sitesCount:siteCount(org),
      siteNames:org&&Array.isArray(org.sites)?org.sites.map(s=>s.name||s.id||'').filter(Boolean):[]
    },
    events:eventInfo(data),
    organisationBackups:backupInfo(data),
    groupStateBackups:groupBackupInfo(data),
    groupStates:Object.keys(data.groupStates||{}).map(k=>{
      const g=data.groupStates[k]||{};
      return {groupId:k,siteId:g.siteId||'',groupKey:g.groupKey||'',groupName:g.groupName||'',revisionId:g.revisionId||'',updatedAt:g.updatedAt||'',weight:g.weight||0,hash:g.hash||''};
    }).slice(0,200)
  };
}

module.exports=async function handler(req,res){
  if(allow(req,res))return;
  try{
    const row=await fetchStore();
    const data=row.data||{};
    if(req.method==='GET'){
      return send(res,200,publicReport(row,data));
    }
    if(req.method!=='POST')return send(res,405,{ok:false,message:'Nur GET oder POST erlaubt.'});
    const body=await readBody(req);
    const token=safe(body.orgAdminToken||'');
    const password=safe(body.orgAdminPassword||'');
    if(!validOrgAdminSession(data,token) && !validOrgAdminPassword(data,password)){
      return send(res,403,{ok:false,message:'Admin-Zugriff erforderlich.'});
    }
    return send(res,200,publicReport(row,data));
  }catch(err){
    return send(res,400,{ok:false,message:err.message||String(err)});
  }
};
