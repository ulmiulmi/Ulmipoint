const {allow,send,readBody,fetchStore}=require('../lib/_wishlib');

function safe(v){return String(v||'').trim();}
function configuredOrgAdminPassword(data){
  return safe(process.env.ULMIPOINT_ORG_ADMIN_PASSWORD||process.env.ULMIPOINT_ADMIN_PASSWORD||process.env.ADMIN_PASSWORD||data?.organisationAdmin?.password||data?.adminPassword||'');
}
function constantTimeEqual(a,b){
  a=String(a||''); b=String(b||'');
  if(!a||!b||a.length!==b.length) return false;
  let r=0; for(let i=0;i<a.length;i++) r|=a.charCodeAt(i)^b.charCodeAt(i);
  return r===0;
}
function validOrgAdminPassword(data,pw){
  const c=configuredOrgAdminPassword(data);
  return !!c && constantTimeEqual(safe(pw),c);
}
function validOrgAdminSession(data,tok){
  tok=safe(tok);
  const s=(data?.organisationAdmin?.sessions||{})[tok];
  if(!s) return false;
  if(s.expiresAt && new Date(s.expiresAt).getTime()<Date.now()) return false;
  return true;
}
function report(row,data,admin){
  const activity=Array.isArray(data.activity)?data.activity:[];
  const items=data.items&&typeof data.items==='object'?data.items:{};
  return {
    ok:true,
    updatedAt:row.updated_at||'',
    activity:admin?activity.slice(0,100):activity.slice(0,20).map(a=>({at:a.at||'',action:a.action||'',area:a.area||'',note:a.note||''})),
    counters:{
      items:Object.keys(items).length,
      sites:Array.isArray(data.organisationStructure?.sites)?data.organisationStructure.sites.length:0
    }
  };
}
module.exports=async function handler(req,res){
  if(allow(req,res)) return;
  try{
    const row=await fetchStore();
    const data=row.data||{};
    if(req.method==='GET') return send(res,200,report(row,data,false));
    if(req.method!=='POST') return send(res,405,{ok:false,message:'Nur GET oder POST erlaubt.'});
    const body=await readBody(req);
    const admin=validOrgAdminSession(data,body.orgAdminToken)||validOrgAdminPassword(data,body.orgAdminPassword);
    return send(res,200,report(row,data,!!admin));
  }catch(err){
    return send(res,400,{ok:false,message:err.message||String(err)});
  }
};
