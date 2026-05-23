const {allow,send,readBody,fetchStore,saveStore}=require('../lib/_wishlib');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.ULMIPOINT_SUPABASE_URL || process.env.POLYPOINT_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY;
function safe(v){return String(v||'').trim();}
function normEmail(v){return safe(v).toLowerCase();}
function normalizeRole(v){v=safe(v).toLowerCase(); if(['admin','administrator','leitung','verwaltung'].includes(v))return 'admin'; if(['planner','planer','planung'].includes(v))return 'planner'; return v;}
function roleStore(data){const roles=(data&&typeof data==='object')?(data.accessRoles||data.roles||{}):{}; return roles&&typeof roles==='object'?roles:{};}
async function verifyUser(req){
  const auth=safe(req.headers.authorization || req.headers.Authorization);
  const token=auth.replace(/^Bearer\s+/i,'');
  if(!token) throw new Error('Nicht eingeloggt. Bitte über Organisation einloggen.');
  if(!SUPABASE_URL || !SERVICE_KEY) throw new Error('Server-Umgebung fehlt: SUPABASE_URL oder SERVICE KEY.');
  const resp=await fetch(SUPABASE_URL + '/auth/v1/user', {method:'GET', headers:{'apikey':SERVICE_KEY,'Authorization':'Bearer '+token}});
  const txt=await resp.text(); let user=null; try{user=txt?JSON.parse(txt):null;}catch(_){}
  if(!resp.ok || !user || !user.id) throw new Error('Login ungültig oder abgelaufen.');
  return user;
}
function assertAdminOrPlanner(data,user){
  const email=normEmail(user.email);
  const roles=roleStore(data);
  const configured=Object.keys(roles).length;
  if(!configured) return {email,role:'transition',configured};
  const entry=roles[email];
  const role=normalizeRole(typeof entry==='string'?entry:entry?.role);
  if(role==='admin' || role==='planner') return {email,role,configured};
  throw new Error('Keine Admin-/Planer-Rolle für '+(email||'diese Sitzung')+'.');
}
function ensureOrg(data){
  if(!data.organisationStructure || typeof data.organisationStructure!=='object') data.organisationStructure={version:'1.0',organisation:{id:'liv',name:'LIV – Leben in Vielfalt'},sites:[]};
  if(!Array.isArray(data.organisationStructure.sites)) data.organisationStructure.sites=[];
  if(!Array.isArray(data.organisationStructure.dutyCatalog)) data.organisationStructure.dutyCatalog=[];
  return data.organisationStructure;
}
function cleanDuty(d){
  d=d&&typeof d==='object'?d:{};
  return {
    id:safe(d.id)||('d_'+safe(d.code||Date.now())),
    code:safe(d.code),
    name:safe(d.name)||'Dienst',
    category:safe(d.category)||'Sonstige',
    start:safe(d.start),
    end:safe(d.end),
    breakStart:safe(d.breakStart),
    breakEnd:safe(d.breakEnd),
    duration:safe(d.duration),
    active:d.active!==false,
    marker:d.marker===true,
    segments:Array.isArray(d.segments)?d.segments.map(s=>({start:safe(s.start),end:safe(s.end)})).filter(s=>s.start||s.end):[],
    updatedAt:new Date().toISOString()
  };
}
module.exports=async function handler(req,res){
  if(allow(req,res))return;
  if(req.method!=='GET' && req.method!=='POST')return send(res,405,{ok:false,message:'Nur GET oder POST erlaubt.'});
  try{
    const row=await fetchStore();
    const data=row.data||{};
    const org=ensureOrg(data);
    if(req.method==='GET'){
      return send(res,200,{ok:true,dutyCatalog:Array.isArray(org.dutyCatalog)?org.dutyCatalog:[],updatedAt:row.updated_at||org.updatedAt||''});
    }
    const user=await verifyUser(req);
    const access=assertAdminOrPlanner(data,user);
    const body=await readBody(req);
    const list=Array.isArray(body.dutyCatalog)?body.dutyCatalog:[];
    org.dutyCatalog=list.map(cleanDuty).filter(d=>d.id&&d.name);
    org.dutyCatalogUpdatedAt=new Date().toISOString();
    org.dutyCatalogUpdatedBy={id:user.id||'',email:user.email||'',role:access.role||''};
    data.organisationStructure=org;
    data.activity=[{id:'act_duty_catalog_'+Date.now(),at:new Date().toISOString(),action:'Dienstkatalog gespeichert',user:{id:user.id||'',email:user.email||''},area:'Dienstkatalog',count:org.dutyCatalog.length,note:'Nur dutyCatalog gespeichert; Häuser/Gruppen unverändert'}].concat(Array.isArray(data.activity)?data.activity:[]).slice(0,80);
    const saved=await saveStore(data);
    return send(res,200,{ok:true,dutyCatalog:org.dutyCatalog,updatedAt:saved.updated_at||org.dutyCatalogUpdatedAt,count:org.dutyCatalog.length});
  }catch(err){
    return send(res,400,{ok:false,message:err.message||String(err)});
  }
};
