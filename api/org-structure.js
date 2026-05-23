const {allow,send,readBody,fetchStore,saveStore}=require('../lib/_wishlib');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.ULMIPOINT_SUPABASE_URL || process.env.POLYPOINT_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY;

function safe(v){return String(v||'').trim();}
function normEmail(v){return safe(v).toLowerCase();}
function slug(v){return safe(v).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')||'default';}
function normalizeRole(v){v=safe(v).toLowerCase(); if(['admin','administrator','leitung','verwaltung'].includes(v))return 'admin'; if(['planner','planer','planung'].includes(v))return 'planner'; if(['employee','mitarbeiter','ma'].includes(v))return 'employee'; return v;}
function roleStore(data){const roles=(data&&typeof data==='object')?(data.accessRoles||data.roles||{}):{}; return roles&&typeof roles==='object'?roles:{};}

function defaultOrganisation(){
  return {
    version:'1.0',
    organisation:{id:'liv',name:'LIV – Leben in Vielfalt'},
    payrollProfileDefault:'CH_BS_PERSONALRECHT_DEFAULT',
    sites:[],
    dutyCatalog:[],
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };
}
function ensureOrg(data){
  if(!data.organisationStructure || typeof data.organisationStructure!=='object') data.organisationStructure=defaultOrganisation();
  if(!data.organisationStructure.organisation || typeof data.organisationStructure.organisation!=='object') data.organisationStructure.organisation={id:'liv',name:'LIV – Leben in Vielfalt'};
  if(!Array.isArray(data.organisationStructure.sites)) data.organisationStructure.sites=[];
  if(!Array.isArray(data.organisationStructure.dutyCatalog)) data.organisationStructure.dutyCatalog=[];
  return data.organisationStructure;
}
function defaultAutomaticFunctions(type){
  type=safe(type)||'wohnheim';
  if(type==='wohnheim') return {nachtwache:true,pikett:true,hausdienstplan:true};
  return {nachtwache:false,pikett:false,hausdienstplan:false};
}
function sanitizeAutomaticFunctions(site,type){
  const def=defaultAutomaticFunctions(type);
  const incoming=site&&site.automaticFunctions&&typeof site.automaticFunctions==='object'?site.automaticFunctions:{};
  return {
    nachtwache: incoming.nachtwache===undefined ? def.nachtwache : !!incoming.nachtwache,
    pikett: incoming.pikett===undefined ? def.pikett : !!incoming.pikett,
    hausdienstplan: incoming.hausdienstplan===undefined ? def.hausdienstplan : !!incoming.hausdienstplan
  };
}
function sanitizeUnit(unit){
  unit=unit&&typeof unit==='object'?unit:{};
  const name=safe(unit.name)||'Bereich';
  const id=slug(unit.id||unit.plannerKey||name);
  const type=safe(unit.type)||'bereich';
  if(['pikett','hausdienstplan','nachtwache'].includes(type)) return null;
  return {
    id,
    name,
    type,
    plannerKey:safe(unit.plannerKey)||id,
    active:unit.active!==false
  };
}
function sanitizeSite(site){
  site=site&&typeof site==='object'?site:{};
  const name=safe(site.name)||'Standort';
  const id=slug(site.id||name);
  const type=safe(site.type)||'wohnheim';
  const units=Array.isArray(site.units)?site.units.map(sanitizeUnit).filter(Boolean):[];
  return {
    id,
    name,
    type,
    canton:safe(site.canton)||'BS',
    active:site.active!==false,
    automaticFunctions:sanitizeAutomaticFunctions(site,type),
    units
  };
}
function unitCountBySite(org){
  const map={};
  (org.sites||[]).forEach(site=>{
    const id=slug(site.id||site.name||'');
    map[id]=(Array.isArray(site.units)?site.units:[]).filter(u=>u&&!['pikett','hausdienstplan','nachtwache'].includes(String(u.type||''))).length;
  });
  return map;
}
function deletedSites(before,after){
  const a=new Set((after.sites||[]).map(s=>slug(s.id||s.name||'')));
  return (before.sites||[]).filter(s=>!a.has(slug(s.id||s.name||''))).map(s=>s.name||s.id).filter(Boolean);
}
function reducedUnits(before,after){
  const b=unitCountBySite(before), a=unitCountBySite(after);
  return Object.keys(b).filter(k=>(a[k]||0)<b[k]).map(k=>({siteId:k,before:b[k],after:a[k]||0}));
}
function configuredOrgAdminPassword(data){
  return safe(process.env.ULMIPOINT_ORG_ADMIN_PASSWORD || process.env.ULMIPOINT_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || data?.organisationAdmin?.password || data?.adminPassword || '');
}
function constantTimeEqual(a,b){
  a=String(a||''); b=String(b||'');
  if(!a || !b || a.length!==b.length) return false;
  let r=0;
  for(let i=0;i<a.length;i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r===0;
}
function validOrgAdminSession(data,tok){
  tok=safe(tok);
  const s=data?.organisationAdmin?.sessions?.[tok];
  if(!s) return false;
  if(s.expiresAt && new Date(s.expiresAt).getTime()<Date.now()) return false;
  return true;
}
function validOrgAdmin(data,body){
  body=body||{};
  const pw=configuredOrgAdminPassword(data);
  return validOrgAdminSession(data,body.orgAdminToken) || (!!pw && constantTimeEqual(safe(body.orgAdminPassword || body.adminPassword || body.password),pw));
}
async function verifySupabaseUser(req){
  const auth=safe(req.headers.authorization || req.headers.Authorization);
  const token=auth.replace(/^Bearer\s+/i,'');
  if(!token) throw new Error('Keine Anmeldung übergeben. Bitte über Organisation mit E-Mail und Passwort einloggen.');
  if(!SUPABASE_URL || !SERVICE_KEY) throw new Error('Server-Umgebung fehlt: SUPABASE_URL oder SERVICE KEY.');
  const resp=await fetch(SUPABASE_URL + '/auth/v1/user',{method:'GET',headers:{apikey:SERVICE_KEY,Authorization:'Bearer '+token}});
  const txt=await resp.text(); let user=null; try{user=txt?JSON.parse(txt):null;}catch(_){}
  if(!resp.ok || !user || !user.id) throw new Error('Anmeldung ungültig oder abgelaufen. Bitte neu einloggen.');
  return user;
}
function assertAdminOrPlanner(data,user){
  const email=normEmail(user.email);
  const roles=roleStore(data);
  const configured=Object.keys(roles).length;
  if(!configured) return {ok:true,email,role:'transition',configured};
  const entry=roles[email];
  const role=normalizeRole(typeof entry==='string'?entry:entry?.role);
  if(role==='admin' || role==='planner') return {ok:true,email,role,configured};
  throw new Error('Keine Admin-/Planer-Rolle für '+(email||'diese Anmeldung')+'.');
}
function orgAdminAccess(data){return {ok:true,email:'org-admin',role:'admin',configured:Object.keys(roleStore(data)).length,orgAdminOnly:true};}
function mergePreservedOrgFields(next,previous){
  // WICHTIG v126: Fachliche Organisations-Speicherung darf den zentralen Dienstkatalog nicht löschen.
  next.dutyCatalog=Array.isArray(previous.dutyCatalog)?previous.dutyCatalog:[];
  if(previous.dutyCatalogUpdatedAt) next.dutyCatalogUpdatedAt=previous.dutyCatalogUpdatedAt;
  if(previous.dutyCatalogUpdatedBy) next.dutyCatalogUpdatedBy=previous.dutyCatalogUpdatedBy;
  return next;
}

module.exports=async function handler(req,res){
  if(allow(req,res)) return;
  if(req.method!=='GET' && req.method!=='POST') return send(res,405,{ok:false,message:'Nur GET oder POST erlaubt.'});
  try{
    const row=await fetchStore();
    const data=row.data||{};
    const org=ensureOrg(data);

    if(req.method==='GET'){
      return send(res,200,{ok:true,mode:'load',readOnly:true,organisationStructure:org,orgRevision:org.revisionId||org.updatedAt||row.updated_at||'',updatedAt:row.updated_at||org.updatedAt||''});
    }

    const body=await readBody(req);
    const mode=safe(body.mode||'load');
    const orgAdminOk=validOrgAdmin(data,body);
    let user=null, access=null;
    if(orgAdminOk){
      user={id:'org-admin',email:'org-admin'};
      access=orgAdminAccess(data);
    }else{
      user=await verifySupabaseUser(req);
      access=assertAdminOrPlanner(data,user);
    }

    if(mode==='load'){
      return send(res,200,{ok:true,mode,organisationStructure:org,access,orgRevision:org.revisionId||org.updatedAt||row.updated_at||'',updatedAt:row.updated_at||org.updatedAt||''});
    }

    if(mode==='save'){
      const incoming=body.organisationStructure;
      if(!incoming || typeof incoming!=='object') throw new Error('Keine Organisationsstruktur übergeben.');
      const next=mergePreservedOrgFields({
        version:'1.0',
        organisation:{id:slug(incoming.organisation?.id || incoming.organisation?.name || 'liv'),name:safe(incoming.organisation?.name)||'LIV – Leben in Vielfalt'},
        payrollProfileDefault:safe(incoming.payrollProfileDefault)||'CH_BS_PERSONALRECHT_DEFAULT',
        sites:Array.isArray(incoming.sites)?incoming.sites.map(sanitizeSite):[],
        createdAt:org.createdAt||new Date().toISOString(),
        updatedAt:new Date().toISOString(),
        revisionId:'org_'+Date.now().toString(36),
        updatedBy:{email:user.email||'',id:user.id||'',role:access.role||''}
      },org);

      const currentSites=Array.isArray(org.sites)?org.sites:[];
      if(currentSites.length>0 && next.sites.length===0 && !body.allowEmptyOrganisation){
        return send(res,409,{ok:false,code:'EMPTY_ORGANISATION_BLOCKED',message:'Speichern blockiert: Der neue Stand enthält keine Häuser. Häuser wurden nicht überschrieben.'});
      }
      const removed=deletedSites(org,next);
      if(removed.length && !body.allowSiteReduction && !body.destructiveConfirm){
        return send(res,409,{ok:false,code:'SITE_DELETE_CONFIRM_REQUIRED',message:'Speichern blockiert: Es würden Standorte entfernt: '+removed.join(', ')+'. Häuser wurden nicht überschrieben.',removedSites:removed});
      }
      const reduced=reducedUnits(org,next);
      if(reduced.length && !body.allowUnitReduction && !body.destructiveConfirm){
        return send(res,409,{ok:false,code:'UNIT_DELETE_CONFIRM_REQUIRED',message:'Speichern blockiert: Es würden Gruppen/Bereiche entfernt. Häuser wurden nicht überschrieben.',reducedUnits:reduced});
      }

      data.organisationStructure=next;
      if(incoming.accessRoles && typeof incoming.accessRoles==='object') data.accessRoles=incoming.accessRoles;
      data.activity=[{id:'act_org_'+Date.now(),at:new Date().toISOString(),action:'Organisation gespeichert',user:{id:user.id||'',name:user.email||'',email:user.email||''},area:'Organisation',note:next.sites.length+' Standorte · Dienstkatalog erhalten'}].concat(Array.isArray(data.activity)?data.activity:[]).slice(0,80);
      const saved=await saveStore(data);
      return send(res,200,{ok:true,mode,organisationStructure:next,access,orgRevision:next.revisionId,updatedAt:saved.updated_at||next.updatedAt});
    }

    return send(res,400,{ok:false,message:'Unbekannter Modus.'});
  }catch(err){
    return send(res,400,{ok:false,message:err.message||String(err)});
  }
};
