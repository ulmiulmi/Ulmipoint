const {allow,send,readBody,fetchStore,saveStore}=require('../lib/_wishlib');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.ULMIPOINT_SUPABASE_URL || process.env.POLYPOINT_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY;

function safe(v){return String(v==null?'':v).trim();}
function normEmail(v){return safe(v).toLowerCase();}
function slug(v){return safe(v).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'') || 'dienst';}
function normalizeRole(v){v=safe(v).toLowerCase(); if(['admin','administrator','leitung','verwaltung'].includes(v))return 'admin'; if(['planner','planer','planung'].includes(v))return 'planner'; return v;}
function roleStore(data){const roles=(data&&typeof data==='object')?(data.accessRoles||data.roles||{}):{}; return roles&&typeof roles==='object'?roles:{};}
function ensureOrg(data){
  if(!data.organisationStructure || typeof data.organisationStructure!=='object') data.organisationStructure={version:'1.0',organisation:{id:'liv',name:'LIV – Leben in Vielfalt'},sites:[]};
  if(!Array.isArray(data.organisationStructure.sites)) data.organisationStructure.sites=[];
  if(!Array.isArray(data.organisationStructure.dutyCatalog)) data.organisationStructure.dutyCatalog=[];
  return data.organisationStructure;
}
async function verifyUser(req){
  const auth=safe(req.headers.authorization || req.headers.Authorization);
  const token=auth.replace(/^Bearer\s+/i,'');
  if(!token) throw new Error('Nicht eingeloggt. Bitte über Organisation mit E-Mail und Passwort einloggen.');
  if(!SUPABASE_URL || !SERVICE_KEY) throw new Error('Server-Umgebung fehlt: SUPABASE_URL oder SERVICE KEY.');
  const resp=await fetch(SUPABASE_URL + '/auth/v1/user',{method:'GET',headers:{apikey:SERVICE_KEY,Authorization:'Bearer '+token}});
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
  throw new Error('Keine Admin-/Planer-Rolle für '+(email||'diese Anmeldung')+'.');
}
function cleanSegments(value){
  const arr=Array.isArray(value)?value:[];
  return arr.map(s=>({start:safe(s.start||s[0]),end:safe(s.end||s[1])})).filter(s=>s.start||s.end);
}
function cleanDuty(item,index){
  item=item&&typeof item==='object'?item:{};
  const code=safe(item.code).toUpperCase();
  const name=safe(item.name)||code||('Dienst '+(index+1));
  const id=safe(item.id)||('d_'+slug(code||name));
  return {
    id:slug(id),
    code,
    name,
    short:safe(item.short||item.shortCode||code),
    category:safe(item.category)||'Sonstige',
    type:safe(item.type)||'',
    start:safe(item.start),
    end:safe(item.end),
    breakStart:safe(item.breakStart),
    breakEnd:safe(item.breakEnd),
    duration:safe(item.duration||item.hoursText),
    hours:Number.isFinite(parseFloat(item.hours))?parseFloat(item.hours):null,
    segments:cleanSegments(item.segments),
    marker:item.marker===true,
    active:item.active!==false,
    note:safe(item.note||item.meaning),
    updatedAt:new Date().toISOString()
  };
}
function sortDuties(list){
  const order=['Frei / Kompensation / Ferien','Frühdienste','Mitteldienste','Spätdienste','Geteilte Dienste','Sitzungen / Verfügungsdienste','Kurzfristige Einsätze / Mehrarbeit','Krankheit / Unfall / Abwesenheiten','Weiterbildung / Schule','Gleitzeit','Markierungen','Sonstige'];
  const idx=c=>{const i=order.indexOf(c); return i<0?999:i;};
  return list.slice().sort((a,b)=>(idx(a.category)-idx(b.category)) || String(a.code).localeCompare(String(b.code),'de',{numeric:true}) || String(a.name).localeCompare(String(b.name),'de'));
}

module.exports=async function handler(req,res){
  if(allow(req,res)) return;
  if(req.method!=='GET' && req.method!=='POST') return send(res,405,{ok:false,message:'Nur GET oder POST erlaubt.'});
  try{
    const row=await fetchStore();
    const data=row.data||{};
    const org=ensureOrg(data);

    if(req.method==='GET'){
      return send(res,200,{ok:true,dutyCatalog:sortDuties(org.dutyCatalog||[]),updatedAt:org.dutyCatalogUpdatedAt||row.updated_at||'',updatedBy:org.dutyCatalogUpdatedBy||{}});
    }

    const user=await verifyUser(req);
    const access=assertAdminOrPlanner(data,user);
    const body=await readBody(req);
    const list=Array.isArray(body.dutyCatalog)?body.dutyCatalog:(Array.isArray(body.duties)?body.duties:[]);
    const seen=new Set();
    const cleaned=[];
    list.map(cleanDuty).forEach(d=>{
      if(!d.name && !d.code) return;
      let key=d.id || slug(d.code||d.name);
      if(seen.has(key)) key=key+'_'+cleaned.length;
      seen.add(key);
      d.id=key;
      cleaned.push(d);
    });
    org.dutyCatalog=sortDuties(cleaned);
    org.dutyCatalogUpdatedAt=new Date().toISOString();
    org.dutyCatalogUpdatedBy={id:user.id||'',email:user.email||'',role:access.role||''};
    data.organisationStructure=org;
    data.activity=[{id:'act_duty_catalog_'+Date.now(),at:new Date().toISOString(),action:'Dienstkatalog gespeichert',user:{id:user.id||'',email:user.email||''},area:'Dienstkatalog',note:org.dutyCatalog.length+' Dienste · Gruppen-Auswahl bleibt unverändert'}].concat(Array.isArray(data.activity)?data.activity:[]).slice(0,100);
    const saved=await saveStore(data);
    return send(res,200,{ok:true,dutyCatalog:org.dutyCatalog,updatedAt:saved.updated_at||org.dutyCatalogUpdatedAt,count:org.dutyCatalog.length});
  }catch(err){
    return send(res,400,{ok:false,message:err.message||String(err)});
  }
};
