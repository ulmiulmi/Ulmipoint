const {allow,send,readBody,fetchStore,saveStore}=require('./_wishlib');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.ULMIPOINT_SUPABASE_URL || process.env.POLYPOINT_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY;

function safe(v){return String(v||'').trim();}
function normEmail(v){return safe(v).toLowerCase();}
function slug(v){return safe(v).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')||'default';}
function normalizeRole(v){v=safe(v).toLowerCase(); if(['admin','administrator','leitung'].includes(v))return 'admin'; if(['planner','planer','planung'].includes(v))return 'planner'; if(['employee','mitarbeiter','ma'].includes(v))return 'employee'; return v;}
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
  const txt=await resp.text(); let user=null; try{user=txt?JSON.parse(txt):null;}catch(_){}
  if(!resp.ok || !user || !user.id) throw new Error('Server-Sitzung ungültig oder abgelaufen. Bitte neu einloggen.');
  return user;
}
async function verifySupabaseUserOptional(req){
  try{return await verifySupabaseUser(req);}catch(_){return null;}
}
function assertAdminAccess(data,user){
  const email=normEmail(user.email);
  const roles=roleStore(data);
  const configured=Object.keys(roles).length;
  if(!configured) return {ok:true,email,role:'transition',configured};
  const entry=roles[email];
  const role=normalizeRole(typeof entry==='string'?entry:entry?.role);
  if(role==='admin' || role==='planner') return {ok:true,email,role,configured};
  throw new Error('Keine Admin-/Planer-Rolle für '+(email||'diese Sitzung')+'.');
}


function siteCount(org){return org&&Array.isArray(org.sites)?org.sites.length:0;}
function addOrganisationBackup(data,org,reason,user){
  if(!org || !Array.isArray(org.sites) || org.sites.length===0) return;
  if(!Array.isArray(data.organisationBackups)) data.organisationBackups=[];
  data.organisationBackups.unshift({
    id:'org_backup_'+Date.now(),
    at:new Date().toISOString(),
    reason:safe(reason)||'before-save',
    sitesCount:org.sites.length,
    siteNames:org.sites.map(s=>safe(s.name||s.id)).filter(Boolean),
    user:{id:user?.id||'',email:user?.email||''},
    organisationStructure:JSON.parse(JSON.stringify(org))
  });
  data.organisationBackups=data.organisationBackups.slice(0,25);
}
function backupInfo(data){
  const list=Array.isArray(data.organisationBackups)?data.organisationBackups:[];
  return list.map(b=>({id:b.id,at:b.at,reason:b.reason,sitesCount:b.sitesCount||siteCount(b.organisationStructure),siteNames:Array.isArray(b.siteNames)?b.siteNames:[]})).slice(0,25);
}
function destructiveSaveWouldRemoveSites(currentOrg,nextSites){
  const currentSites=(currentOrg&&Array.isArray(currentOrg.sites))?currentOrg.sites:[];
  if(currentSites.length===0) return false;
  const nextIds=new Set((nextSites||[]).map(s=>safe(s.id)).filter(Boolean));
  const removed=currentSites.filter(s=>!nextIds.has(safe(s.id)));
  return removed.length>0 ? removed : false;
}

function defaultOrganisation(){
  return {
    version:'1.0',
    organisation:{id:'liv',name:'LIV – Leben in Vielfalt'},
    payrollProfileDefault:'CH_BS_PERSONALRECHT_DEFAULT',
    sites:[],
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };
}
function normalizeOrgForLoad(data){
  const incoming=data && typeof data==='object' ? data.organisationStructure : null;
  if(!incoming || typeof incoming!=='object'){
    return {org:null, empty:true, reason:'missing'};
  }
  if(!Array.isArray(incoming.sites)){
    incoming.sites=[];
    return {org:incoming, empty:true, reason:'no-sites-array'};
  }
  if(incoming.sites.length===0){
    return {org:incoming, empty:true, reason:'empty-sites'};
  }
  return {org:incoming, empty:false, reason:''};
}
function defaultAutomaticFunctions(type){
  type=safe(type)||'wohnheim';
  if(type==='wohnheim') return {nachtwache:true,pikett:true,hausdienstplan:true};
  return {nachtwache:false,pikett:false,hausdienstplan:false};
}
function sanitizeAutomaticFunctions(site,type){
  const def=defaultAutomaticFunctions(type);
  const incoming=site && site.automaticFunctions && typeof site.automaticFunctions==='object' ? site.automaticFunctions : {};
  return {
    nachtwache: incoming.nachtwache===undefined ? def.nachtwache : !!incoming.nachtwache,
    pikett: incoming.pikett===undefined ? def.pikett : !!incoming.pikett,
    hausdienstplan: incoming.hausdienstplan===undefined ? def.hausdienstplan : !!incoming.hausdienstplan
  };
}
function sanitizeSite(site){
  const name=safe(site.name)||'Standort';
  const id=slug(site.id||name);
  const type=safe(site.type)||'wohnheim';
  const units=Array.isArray(site.units)
    ? site.units.map(sanitizeUnit).filter(Boolean).filter(u=>!['pikett','hausdienstplan','nachtwache'].includes(u.type))
    : [];
  return {
    id,name,type,canton:safe(site.canton)||'BS',active:site.active!==false,
    automaticFunctions:sanitizeAutomaticFunctions(site,type),
    units
  };
}
function sanitizeUnit(unit){
  const name=safe(unit.name)||'Bereich';
  const id=slug(unit.id||name);
  let type=safe(unit.type)||'bereich';
  if(type==='pikett' || type==='hausdienstplan' || type==='nachtwache') return null;
  return {id,name,type,plannerKey:safe(unit.plannerKey)||id,active:unit.active!==false};
}
function accessForOrgAdmin(){return {ok:true,email:'org-admin-password',role:'org-admin-password',configured:1};}
function accessForPublicLoad(){return {ok:true,email:'',role:'public-organisation-load',configured:0};}

module.exports=async function handler(req,res){
  if(allow(req,res))return;
  if(req.method!=='POST' && req.method!=='GET')return send(res,405,{ok:false,message:'Nur GET oder POST erlaubt.'});
  try{
    const body=req.method==='GET' ? {mode:'load'} : await readBody(req);
    const mode=safe(body.mode||'load');
    const row=await fetchStore();
    const data=row.data||{};
    const normalized=normalizeOrgForLoad(data);
    const org=normalized.org;
    const hasOrgAdmin=validOrgAdminSession(data, body.orgAdminToken);
    const hasOrgAdminPassword=validOrgAdminPassword(data, body.orgAdminPassword);
    let user=null;
    let access=null;

    if(mode==='load'){
      if(hasOrgAdmin || hasOrgAdminPassword){
        access=accessForOrgAdmin();
      }else{
        user=await verifySupabaseUserOptional(req);
        if(user){
          try{ access=assertAdminAccess(data,user); }catch(_){ access=accessForPublicLoad(); }
        }else{
          access=accessForPublicLoad();
        }
      }
      const updatedAt=row.updated_at;
      return send(res,200,{ok:true,mode,organisationStructure:org,access,updatedAt,empty:normalized.empty,emptyReason:normalized.reason,seeded:false,organisationBackups:backupInfo(data)});
    }

    if(mode==='save'){
      if(hasOrgAdmin || hasOrgAdminPassword){
        access=accessForOrgAdmin();
        user={id:'org-admin-password',email:'org-admin-password'};
      }else{
        user=await verifySupabaseUser(req);
        access=assertAdminAccess(data,user);
      }

      const incoming=body.organisationStructure;
      if(!incoming || typeof incoming!=='object') throw new Error('Keine Organisationsstruktur übergeben.');
      let sites=Array.isArray(incoming.sites)?incoming.sites.map(sanitizeSite).filter(Boolean):[];
      if(sites.length===0) throw new Error('Keine Standorte zum Speichern. Es wurde nichts überschrieben.');
      const removedSites=destructiveSaveWouldRemoveSites(org,sites);
      if(removedSites && body.allowSiteReduction!==true){
        return send(res,409,{ok:false,blocked:true,code:'SITE_DELETE_CONFIRM_REQUIRED',message:'Speichern blockiert: Der neue Stand würde vorhandene Standorte löschen: '+removedSites.map(s=>safe(s.name||s.id)).join(', ')+'. Bitte nur bestätigen, wenn das wirklich gewollt ist.',removedSites:removedSites.map(s=>({id:safe(s.id),name:safe(s.name)})),organisationStructure:org,organisationBackups:backupInfo(data)});
      }
      const next={
        version:'1.0',
        organisation:{
          id:slug(incoming.organisation?.id || incoming.organisation?.name || 'liv'),
          name:safe(incoming.organisation?.name)||'LIV – Leben in Vielfalt'
        },
        payrollProfileDefault:safe(incoming.payrollProfileDefault)||'CH_BS_PERSONALRECHT_DEFAULT',
        sites,
        createdAt:(org&&org.createdAt)||new Date().toISOString(),
        updatedAt:new Date().toISOString(),
        updatedBy:{email:user.email||'',id:user.id||''}
      };
      addOrganisationBackup(data, org, removedSites?'before-destructive-save':'before-save', user);
      data.organisationStructure=next;
      data.activity=[{
        id:'act_org_'+Date.now(),
        at:new Date().toISOString(),
        action:'Organisation gespeichert',
        user:{id:user.id||'',name:user.email||'',email:user.email||''},
        area:'Organisation',
        note:next.sites.length+' Standorte'
      }].concat(Array.isArray(data.activity)?data.activity:[]).slice(0,80);
      const saved=await saveStore(data);
      return send(res,200,{ok:true,mode,organisationStructure:next,access,updatedAt:saved.updated_at||next.updatedAt});
    }

    return send(res,400,{ok:false,message:'Unbekannter Modus.'});
  }catch(err){
    return send(res,400,{ok:false,message:err.message||String(err)});
  }
};
