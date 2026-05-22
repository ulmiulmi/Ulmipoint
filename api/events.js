const {allow,send,readBody,fetchStore,ensureStores,eventsReport,safe}=require('./_group-storage');

function configuredOrgAdminPassword(data){return safe(process.env.ULMIPOINT_ORG_ADMIN_PASSWORD||process.env.ULMIPOINT_ADMIN_PASSWORD||process.env.ADMIN_PASSWORD||data?.organisationAdmin?.password||data?.adminPassword||'');}
function constantTimeEqual(a,b){a=String(a||'');b=String(b||'');if(!a||!b||a.length!==b.length)return false;let r=0;for(let i=0;i<a.length;i++)r|=a.charCodeAt(i)^b.charCodeAt(i);return r===0;}
function validOrgAdminPassword(data,pw){const c=configuredOrgAdminPassword(data);return !!c&&constantTimeEqual(safe(pw),c);}
function validOrgAdminSession(data,tok){tok=safe(tok);const s=(data?.organisationAdmin?.sessions||{})[tok];if(!s)return false;if(s.expiresAt&&new Date(s.expiresAt).getTime()<Date.now())return false;return true;}

module.exports=async function handler(req,res){
  if(allow(req,res))return;
  try{
    const row=await fetchStore();
    const data=row.data||{};
    ensureStores(data);
    if(req.method==='GET'){
      return send(res,200,eventsReport(row,data,false));
    }
    if(req.method!=='POST')return send(res,405,{ok:false,message:'Nur GET oder POST erlaubt.'});
    const body=await readBody(req);
    const admin=validOrgAdminSession(data,body.orgAdminToken)||validOrgAdminPassword(data,body.orgAdminPassword);
    return send(res,200,eventsReport(row,data,!!admin));
  }catch(err){
    return send(res,400,{ok:false,message:err.message||String(err)});
  }
};
