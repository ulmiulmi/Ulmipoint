const {allow,send,readBody,fetchStore,saveStore}=require('../lib/_wishlib');

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
function validOrgAdmin(data,body){
  body=body||{};
  return validOrgAdminSession(data, body.orgAdminToken) || validOrgAdminPassword(data, body.orgAdminPassword || body.adminPassword || body.password);
}
function orgAdminAccess(data){
  return {
    ok:true,
    email:'org-admin',
    role:'admin',
    configured:Object.keys(roleStore(data)).length,
    canManageOrganisation:true,
    orgAdminOnly:true,
    superAdmin:true
  };
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

function defaultOrganisation(){
  return {
    version:'1.0',
    organisation:{id:'liv',name:'LIV – Leben in Vielfalt'},
    payrollProfileDefault:'CH_BS_PERSONALRECHT_DEFAULT',
    sites:[
      {
        id:'haus_1',
        name:'Haus 1',
        type:'wohnheim',
        canton:'BS',
        active:true,
        automaticFunctions:{nachtwache:true,pikett:true,hausdienstplan:true},
        units:[
          {id:'azoren',name:'Azoren',type:'wohngruppe',plannerKey:'azoren',active:true},
          {id:'bali',name:'Bali',type:'wohngruppe',plannerKey:'bali',active:true},
          {id:'capri',name:'Capri',type:'wohngruppe',plannerKey:'capri',active:false},
          {id:'delos',name:'Delos',type:'wohngruppe',plannerKey:'delos',active:true}
        ]
      }
    ],
    createdAt:new Date().toISOString(),
    updatedAt:new Date().toISOString()
  };
}
function ensureOrg(data){
  if(!data.organisationStructure || typeof data.organisationStructure!=='object'){
    data.organisationStructure=defaultOrganisation();
  }
  if(!Array.isArray(data.organisationStructure.sites)) data.organisationStructure.sites=[];
  return data.organisationStructure;
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

module.exports=async function handler(req,res){
  if(allow(req,res))return;
  if(req.method!=='POST' && req.method!=='GET')return send(res,405,{ok:false,message:'Nur GET oder POST erlaubt.'});
  try{
    const body=req.method==='GET' ? {mode:'load'} : await readBody(req);
    const mode=safe(body.mode||'load');
    const row=await fetchStore();
    const data=row.data||{};
    const orgAdminOk=validOrgAdmin(data, body);

    let user=null;
    let access=null;

    if(orgAdminOk){
      user={id:'org-admin',email:'org-admin'};
      access=orgAdminAccess(data);
    }else{
      user=await verifySupabaseUser(req);
      access=assertAdminAccess(data,user);
    }

    const org=ensureOrg(data);

    // Laden darf mit Admin-Passwort/Admin-Token ODER normaler Admin-/Planer-Sitzung erfolgen.
    if(mode==='load'){
      return send(res,200,{ok:true,mode,organisationStructure:org,access,updatedAt:row.updated_at});
    }

    // Speichern nur mit Admin-Passwort/Admin-Token.
    // Dadurch hängt die Organisation nicht mehr an einer abgelaufenen normalen Server-Sitzung.
    if(!orgAdminOk){
      return send(res,401,{ok:false,message:'Organisation speichern nur mit Admin-Passwort. Bitte Organisation neu freischalten.'});
    }

    if(mode==='save'){
      const incoming=body.organisationStructure;
      if(!incoming || typeof incoming!=='object') throw new Error('Keine Organisationsstruktur übergeben.');

      const next={
        version:'1.0',
        organisation:{
          id:slug(incoming.organisation?.id || incoming.organisation?.name || 'liv'),
          name:safe(incoming.organisation?.name)||'LIV – Leben in Vielfalt'
        },
        payrollProfileDefault:safe(incoming.payrollProfileDefault)||'CH_BS_PERSONALRECHT_DEFAULT',
        sites:Array.isArray(incoming.sites)?incoming.sites.map(sanitizeSite):[],
        createdAt:org.createdAt||new Date().toISOString(),
        updatedAt:new Date().toISOString(),
        updatedBy:{email:user.email||'',id:user.id||''}
      };

      data.organisationStructure=next;

      // Rechte nur ändern, wenn die Oberfläche sie ausdrücklich mitsendet.
      if(incoming.accessRoles && typeof incoming.accessRoles==='object'){
        data.accessRoles=incoming.accessRoles;
      }

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
