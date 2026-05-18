const {allow,send,readBody,fetchStore,saveStore}=require('./_wishlib');

function safe(v){return String(v||'').trim();}
function constantTimeEqual(a,b){
  a=String(a||''); b=String(b||'');
  if(a.length!==b.length) return false;
  let r=0;
  for(let i=0;i<a.length;i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r===0;
}
function token(){
  return 'orgadm_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}
function configuredPassword(data){
  return safe(
    process.env.ULMIPOINT_ORG_ADMIN_PASSWORD ||
    process.env.ULMIPOINT_ADMIN_PASSWORD ||
    process.env.ADMIN_PASSWORD ||
    data?.organisationAdmin?.password ||
    data?.adminPassword ||
    ''
  );
}
function validSession(data,tok){
  tok=safe(tok);
  const sessions=data?.organisationAdmin?.sessions || {};
  const s=sessions[tok];
  if(!s) return false;
  if(s.expiresAt && new Date(s.expiresAt).getTime() < Date.now()) return false;
  return true;
}

module.exports=async function handler(req,res){
  if(allow(req,res))return;
  if(req.method!=='POST')return send(res,405,{ok:false,message:'Nur POST erlaubt.'});
  try{
    const body=await readBody(req);
    const row=await fetchStore();
    const data=row.data||{};
    if(!data.organisationAdmin || typeof data.organisationAdmin!=='object') data.organisationAdmin={sessions:{}};
    if(!data.organisationAdmin.sessions || typeof data.organisationAdmin.sessions!=='object') data.organisationAdmin.sessions={};

    const mode=safe(body.mode||'login');

    if(mode==='check'){
      return send(res,200,{ok:true,authenticated:validSession(data,body.token),configured:!!configuredPassword(data)});
    }

    const pw=configuredPassword(data);
    if(!pw){
      return send(res,400,{ok:false,message:'Admin-Passwort ist noch nicht konfiguriert. Bitte ULMIPOINT_ORG_ADMIN_PASSWORD in Vercel/Supabase-Umgebung setzen.'});
    }

    if(!constantTimeEqual(safe(body.password),pw)){
      return send(res,401,{ok:false,message:'Admin-Passwort falsch.'});
    }

    // alte Sessions aufräumen
    const now=Date.now();
    Object.entries(data.organisationAdmin.sessions).forEach(([k,v])=>{
      if(v?.expiresAt && new Date(v.expiresAt).getTime()<now) delete data.organisationAdmin.sessions[k];
    });

    const tok=token();
    const expiresAt=new Date(Date.now()+8*60*60*1000).toISOString();
    data.organisationAdmin.sessions[tok]={createdAt:new Date().toISOString(),expiresAt};
    data.organisationAdmin.updatedAt=new Date().toISOString();
    const saved=await saveStore(data);
    return send(res,200,{ok:true,token:tok,expiresAt,updatedAt:saved.updated_at||data.organisationAdmin.updatedAt});
  }catch(err){
    return send(res,400,{ok:false,message:err.message||String(err)});
  }
};
