const {allow,send,readBody,fetchStore,saveStore}=require('../lib/_wishlib');

function safe(v){return String(v||'').trim();}
function normEmail(v){return safe(v).toLowerCase();}
function slug(v){return safe(v).toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'')||'default';}
function arr(v){return Array.isArray(v)?v.map(x=>safe(x)).filter(Boolean):[];}
function uniq(v){return [...new Set((v||[]).map(x=>safe(x)).filter(Boolean))];}
function normalizeRole(v){
  v=safe(v).toLowerCase();
  if(['administrator','verwaltung','leitung-admin','admin','geschaeftsleitung','geschäftsleitung'].includes(v)) return 'admin';
  if(['planer','planung','planner'].includes(v)) return 'planner';
  if(['leitung','hausleitung','haus-leitung','hl'].includes(v)) return 'hausleitung';
  if(['tko','teamkoordination','team-koordinator','teamkoordinator'].includes(v)) return 'tko';
  if(['mitarbeiter','ma','employee'].includes(v)) return 'employee';
  return v||'employee';
}
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
function assertOrgAdmin(data,body){
  if(validOrgAdminSession(data,body.orgAdminToken)) return true;
  if(validOrgAdminPassword(data,body.orgAdminPassword)) return true;
  throw new Error('Admin-Zugriff fehlt oder ist abgelaufen.');
}
function roleStore(data){
  if(!data.accessRoles||typeof data.accessRoles!=='object') data.accessRoles={};
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
      siteIds:uniq(arr(entry.siteIds||(entry.siteId?[entry.siteId]:[])).map(slug)),
      groupKeys:uniq(arr(entry.groupKeys||(entry.groupKey?[entry.groupKey]:[])).map(slug)),
      employeeId:safe(entry.employeeId||''),
      employeeName:safe(entry.employeeName||''),
      updatedAt:safe(entry.updatedAt||''),
      createdAt:safe(entry.createdAt||''),
      source:safe(entry.source||'organisation-admin'),
      mustChangePassword:entry.mustChangePassword===true
    };
  }).sort((a,b)=>(a.name||a.email).localeCompare(b.name||b.email,'de'));
}
function sanitizeUser(input){
  input=input||{};
  const role=normalizeRole(input.role);
  const email=normEmail(input.email);
  const siteIds=uniq(arr(input.siteIds||(input.siteId?[input.siteId]:[])).map(slug));
  const groupKeys=uniq(arr(input.groupKeys||(input.groupKey?[input.groupKey]:[])).map(slug));
  const now=new Date().toISOString();
  return {
    email,
    name:safe(input.name||input.employeeName||''),
    role,
    scope:safe(input.scope)||((role==='admin'||role==='planner')?'all':(role==='hausleitung'?'site':'groups')),
    siteIds:(role==='admin'||role==='planner')?[]:siteIds,
    groupKeys:(role==='tko'||role==='employee')?groupKeys:[],
    employeeId:safe(input.employeeId||''),
    employeeName:safe(input.employeeName||''),
    createdAt:safe(input.createdAt)||now,
    updatedAt:now,
    source:'organisation-admin',
    mustChangePassword:input.mustChangePassword===true
  };
}
function validateUser(user){
  if(!user.email) throw new Error('E-Mail fehlt.');
  if(!/^\S+@\S+\.\S+$/.test(user.email)) throw new Error('E-Mail ist ungültig.');
}

module.exports=async function handler(req,res){
  if(allow(req,res)) return;
  if(req.method!=='POST') return send(res,405,{ok:false,message:'Nur POST erlaubt.'});
  try{
    const body=await readBody(req);
    const mode=safe(body.mode||'load');
    const row=await fetchStore();
    const data=row.data||{};
    assertOrgAdmin(data,body);

    if(mode==='load'){
      return send(res,200,{ok:true,users:publicUsers(data),updatedAt:row.updated_at||''});
    }

    if(mode==='saveUser'){
      const user=sanitizeUser(body.user||{});
      validateUser(user);
      const roles=roleStore(data);
      const prev=roles[user.email]&&typeof roles[user.email]==='object'?roles[user.email]:{};
      roles[user.email]=Object.assign({},prev,user,{updatedAt:new Date().toISOString()});
      data.accessRoles=roles;
      data.roleVersion='ulmipoint-v-basic';
      data.activity=[{
        id:'act_user_'+Date.now(),
        at:new Date().toISOString(),
        action:'Benutzer/Rechte gespeichert',
        user:{id:'org-admin-password',email:'org-admin-password'},
        area:'Organisation',
        note:user.email+' · '+user.role
      }].concat(Array.isArray(data.activity)?data.activity:[]).slice(0,80);
      const saved=await saveStore(data);
      return send(res,200,{ok:true,message:'Benutzer/Rechte gespeichert.',users:publicUsers(data),updatedAt:saved.updated_at||new Date().toISOString()});
    }

    if(mode==='deleteUser'){
      const email=normEmail(body.email||body.user?.email||'');
      if(!email) throw new Error('E-Mail fehlt.');
      const roles=roleStore(data);
      delete roles[email];
      data.accessRoles=roles;
      const saved=await saveStore(data);
      return send(res,200,{ok:true,users:publicUsers(data),updatedAt:saved.updated_at||new Date().toISOString()});
    }

    return send(res,400,{ok:false,message:'Unbekannter Modus.'});
  }catch(err){
    return send(res,400,{ok:false,message:err.message||String(err)});
  }
};
