const {allow,send,readBody,fetchStore,saveStore}=require('./_wishlib');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.ULMIPOINT_SUPABASE_URL || process.env.POLYPOINT_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY;

function safe(v){return String(v||'').trim();}
function normEmail(v){return safe(v).toLowerCase();}
function slug(v){return safe(v).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')||'default';}
function arr(v){return Array.isArray(v)?v.map(x=>safe(x)).filter(Boolean):[];}
function uniq(v){return [...new Set((v||[]).map(x=>safe(x)).filter(Boolean))];}
function normalizeRole(v){
  v=safe(v).toLowerCase();
  if(['administrator','verwaltung','leitung-admin','admin'].includes(v))return 'admin';
  if(['planer','planung','planner'].includes(v))return 'planner';
  if(['hausleitung','haus-leitung','hl'].includes(v))return 'hausleitung';
  if(['tko','teamkoordination','team-koordinator','teamkoordinator'].includes(v))return 'tko';
  if(['mitarbeiter','ma','employee'].includes(v))return 'employee';
  return 'employee';
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
  let r=0; for(let i=0;i<a.length;i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
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
function assertOrgAdmin(data, body){
  if(validOrgAdminSession(data, body.orgAdminToken)) return true;
  if(validOrgAdminPassword(data, body.orgAdminPassword)) return true;
  throw new Error('Admin-Zugriff fehlt oder ist abgelaufen. Bitte Organisation neu freischalten.');
}
function roleStore(data){
  if(!data.accessRoles || typeof data.accessRoles !== 'object') data.accessRoles={};
  return data.accessRoles;
}
function publicUsers(data){
  const roles=roleStore(data);
  return Object.entries(roles).map(([email,entry])=>{
    if(typeof entry==='string') entry={role:entry,email};
    const role=normalizeRole(entry.role);
    return {
      email:normEmail(entry.email||email),
      name:safe(entry.name||entry.employeeName||''),
      role,
      scope:safe(entry.scope)||((role==='admin'||role==='planner')?'all':(role==='hausleitung'?'site':'groups')),
      siteIds:uniq(arr(entry.siteIds || (entry.siteId?[entry.siteId]:[])).map(slug)),
      groupKeys:uniq(arr(entry.groupKeys || (entry.groupKey?[entry.groupKey]:[])).map(slug)),
      employeeId:safe(entry.employeeId||''),
      employeeName:safe(entry.employeeName||''),
      updatedAt:safe(entry.updatedAt||''),
      createdAt:safe(entry.createdAt||''),
      source:safe(entry.source||'organisation-admin')
    };
  }).sort((a,b)=>(a.name||a.email).localeCompare(b.name||b.email,'de'));
}
function sanitizeUser(input){
  input=input||{};
  const role=normalizeRole(input.role);
  const email=normEmail(input.email);
  const siteIds=uniq(arr(input.siteIds || (input.siteId?[input.siteId]:[])).map(slug));
  const groupKeys=uniq(arr(input.groupKeys || (input.groupKey?[input.groupKey]:[])).map(slug));
  const now=new Date().toISOString();
  return {
    email,
    name:safe(input.name||input.employeeName||''),
    role,
    scope:safe(input.scope)||((role==='admin'||role==='planner')?'all':(role==='hausleitung'?'site':'groups')),
    siteIds:(role==='admin'||role==='planner')?[]:siteIds,
    groupKeys:(role==='tko'||role==='employee')?groupKeys:[],
    createdAt:safe(input.createdAt)||now,
    updatedAt:now,
    source:'organisation-admin'
  };
}
async function authFetch(path,opt={}){
  if(!SUPABASE_URL || !SERVICE_KEY) throw new Error('Server-Umgebung fehlt: SUPABASE_URL oder SUPABASE_SERVICE_ROLE_KEY.');
  const resp=await fetch(SUPABASE_URL.replace(/\/+$/,'') + path, Object.assign({},opt,{headers:Object.assign({'apikey':SERVICE_KEY,'Authorization':'Bearer '+SERVICE_KEY},opt.headers||{})}));
  const txt=await resp.text(); let data={}; try{data=txt?JSON.parse(txt):{};}catch(_){data={message:txt};}
  return {resp,data,txt};
}
async function findAuthUserByEmail(email){
  try{
    const {resp,data}=await authFetch('/auth/v1/admin/users?page=1&per_page=200',{method:'GET'});
    if(!resp.ok) return null;
    const list=Array.isArray(data?.users)?data.users:(Array.isArray(data)?data:[]);
    return list.find(u=>normEmail(u.email)===normEmail(email))||null;
  }catch(_){return null;}
}
async function updateSupabaseUser(user,password){
  const existing=await findAuthUserByEmail(user.email);
  if(!existing || !existing.id) return {updated:false, message:'Supabase-Benutzer existiert bereits; Rolle wurde aktualisiert.'};
  const payload={user_metadata:{name:user.name||'',ulmipointRole:user.role,ulmipointScope:user.scope}};
  if(password) payload.password=password;
  const {resp,data,txt}=await authFetch('/auth/v1/admin/users/'+encodeURIComponent(existing.id),{
    method:'PUT',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify(payload)
  });
  if(resp.ok) return {updated:true,userId:existing.id,message:password?'Supabase-Benutzer aktualisiert und Passwort gesetzt.':'Supabase-Benutzer aktualisiert.'};
  const msg=safe(data.message||data.error_description||data.error||txt);
  return {updated:false,userId:existing.id,message:'Supabase-Benutzer existiert; Rolle wurde aktualisiert.'+(msg?' Hinweis: '+msg:'')};
}
async function createSupabaseUser(user,password){
  if(!password) return {created:false, skipped:true, message:'Kein Passwort übergeben; nur Rolle gespeichert.'};
  const {resp,data,txt}=await authFetch('/auth/v1/admin/users', {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({email:user.email,password,email_confirm:true,user_metadata:{name:user.name||'',ulmipointRole:user.role,ulmipointScope:user.scope}})
  });
  if(resp.ok) return {created:true,userId:data.id||data.user?.id||'', message:'Supabase-Benutzer erstellt.'};
  const msg=safe(data.message||data.error_description||data.error||txt);
  if(/already|exist|registered|unique|duplicate|User already/i.test(msg)){
    return updateSupabaseUser(user,password);
  }
  throw new Error('Supabase-Benutzer konnte nicht erstellt werden: '+(msg||('HTTP '+resp.status)));
}
function validateUser(user){
  if(!user.email) throw new Error('E-Mail fehlt.');
  if(!/^\S+@\S+\.\S+$/.test(user.email)) throw new Error('E-Mail ist ungültig.');
  if((user.role==='hausleitung'||user.role==='tko'||user.role==='employee') && !user.siteIds.length) throw new Error('Für diese Rolle muss ein Haus/Standort gewählt werden.');
  if(user.role==='tko' && !user.groupKeys.length) throw new Error('TKO braucht mindestens eine ausgewählte Gruppe.');
}

module.exports=async function handler(req,res){
  if(allow(req,res))return;
  if(req.method!=='POST')return send(res,405,{ok:false,message:'Nur POST erlaubt.'});
  try{
    const body=await readBody(req);
    const mode=safe(body.mode||'load');
    const row=await fetchStore();
    const data=row.data||{};
    assertOrgAdmin(data, body);

    if(mode==='load'){
      return send(res,200,{ok:true,users:publicUsers(data),updatedAt:row.updated_at||''});
    }

    if(mode==='saveUser'){
      const user=sanitizeUser(body.user||{});
      validateUser(user);
      const password=safe(body.user?.password||'');
      const authResult=await createSupabaseUser(user,password);
      const roles=roleStore(data);
      const prev=roles[user.email] && typeof roles[user.email]==='object' ? roles[user.email] : {};
      roles[user.email]=Object.assign({},prev,user,{auth:safe(authResult.userId)||safe(prev.auth||''),updatedAt:new Date().toISOString()});
      data.accessRoles=roles;
      data.roleVersion='ulmipoint-v83';
      data.activity=[{
        id:'act_user_'+Date.now(),
        at:new Date().toISOString(),
        action:'Benutzer/Rechte gespeichert',
        user:{id:'org-admin-password',email:'org-admin-password'},
        area:'Organisation',
        note:user.email+' · '+user.role+' · '+(authResult.message||'')
      }].concat(Array.isArray(data.activity)?data.activity:[]).slice(0,80);
      const saved=await saveStore(data);
      return send(res,200,{ok:true,message:(authResult.message||'Benutzer gespeichert.')+' Zugriff gespeichert.',users:publicUsers(data),updatedAt:saved.updated_at||new Date().toISOString()});
    }

    if(mode==='deleteUser'){
      const email=normEmail(body.email||body.user?.email||'');
      if(!email) throw new Error('E-Mail fehlt.');
      const roles=roleStore(data);
      delete roles[email];
      data.accessRoles=roles;
      data.roleVersion='ulmipoint-v83';
      data.activity=[{
        id:'act_user_delete_'+Date.now(),
        at:new Date().toISOString(),
        action:'Benutzerrecht entfernt',
        user:{id:'org-admin-password',email:'org-admin-password'},
        area:'Organisation',
        note:email
      }].concat(Array.isArray(data.activity)?data.activity:[]).slice(0,80);
      const saved=await saveStore(data);
      return send(res,200,{ok:true,users:publicUsers(data),updatedAt:saved.updated_at||new Date().toISOString()});
    }

    return send(res,400,{ok:false,message:'Unbekannter Modus.'});
  }catch(err){
    return send(res,400,{ok:false,message:err.message||String(err)});
  }
};
