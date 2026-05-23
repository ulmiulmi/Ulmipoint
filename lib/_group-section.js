const crypto=require('crypto');

function safe(v){return String(v==null?'':v).trim();}
function slug(v){
  return safe(v).toLowerCase()
    .normalize('NFKD').replace(/[\u0300-\u036f]/g,'')
    .replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'') || 'default';
}
function sectionName(v){
  v=slug(v);
  if(['state','group_state','group'].includes(v)) return 'state';
  if(['employees','employee','mitarbeiter','group_employees'].includes(v)) return 'employees';
  if(['plan','dienstplan','group_plan'].includes(v)) return 'plan';
  if(['duties','duty','dienste','dienst','group_duties','group_duty'].includes(v)) return 'duties';
  if(['wishes','wish','wuensche','wunsche','group_wishes'].includes(v)) return 'wishes';
  throw new Error('Unbekannter Gruppenbereich: '+safe(v));
}
function objectKey(siteId,groupKey,section){
  return slug(siteId)+'::'+slug(groupKey)+'::'+sectionName(section);
}
function groupKeyOnly(siteId,groupKey){
  return slug(siteId)+'::'+slug(groupKey);
}
function stableJson(v){
  if(v===null || typeof v!=='object') return JSON.stringify(v);
  if(Array.isArray(v)) return '['+v.map(stableJson).join(',')+']';
  return '{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stableJson(v[k])).join(',')+'}';
}
function hash(v){
  return crypto.createHash('sha256').update(stableJson(v)).digest('hex').slice(0,16);
}
function hasContent(v){
  if(v==null) return false;
  if(Array.isArray(v)) return v.length>0;
  if(typeof v==='object') return Object.keys(v).length>0;
  if(typeof v==='string') return v.trim().length>0;
  return true;
}
function nowIso(){return new Date().toISOString();}
function ensureRoot(data){
  if(!data.groupSections || typeof data.groupSections!=='object') data.groupSections={};
  if(!Array.isArray(data.groupEvents)) data.groupEvents=[];
  if(!Array.isArray(data.groupBackups)) data.groupBackups=[];
  return data.groupSections;
}
function ensureGroup(data,siteId,groupKey){
  const root=ensureRoot(data);
  const gKey=groupKeyOnly(siteId,groupKey);
  if(!root[gKey] || typeof root[gKey]!=='object'){
    root[gKey]={siteId:slug(siteId),groupKey:slug(groupKey),sections:{},createdAt:nowIso(),updatedAt:nowIso()};
  }
  if(!root[gKey].sections || typeof root[gKey].sections!=='object') root[gKey].sections={};
  return root[gKey];
}
function currentSection(data,siteId,groupKey,section){
  const g=ensureGroup(data,siteId,groupKey);
  const sec=sectionName(section);
  const cur=g.sections[sec] || null;
  return {group:g, section:sec, current:cur};
}
function defaultValueForSection(section){
  section=sectionName(section);
  if(section==='employees') return [];
  if(section==='plan') return {};
  if(section==='wishes') return {};
  if(section==='duties') return {version:'1.0',duties:[]};
  return {};
}
function extractValue(body,section){
  section=sectionName(section);
  if(section==='employees') return body.employees ?? body.value ?? body.data ?? [];
  if(section==='plan') return body.plan ?? body.value ?? body.data ?? {};
  if(section==='wishes') return body.wishes ?? body.value ?? body.data ?? {};
  if(section==='duties') return body.duties ?? body.groupDuties ?? body.value ?? body.data ?? {version:'1.0',duties:[]};
  return body.state ?? body.value ?? body.data ?? {};
}
function backupSection(data,siteId,groupKey,section,previous,user){
  if(!previous) return '';
  const backupId='gb_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
  data.groupBackups.unshift({
    backupId,
    siteId:slug(siteId),
    groupKey:slug(groupKey),
    section:sectionName(section),
    objectKey:objectKey(siteId,groupKey,section),
    createdAt:nowIso(),
    createdBy:user||{},
    previous
  });
  data.groupBackups=data.groupBackups.slice(0,300);
  return backupId;
}
function addEvent(data,type,siteId,groupKey,section,before,after,user,backupId){
  const ev={
    eventId:'ge_'+Date.now()+'_'+Math.random().toString(36).slice(2,8),
    type,
    siteId:slug(siteId),
    groupKey:slug(groupKey),
    objectKey:objectKey(siteId,groupKey,section),
    section:sectionName(section),
    revisionVorher:before?.revision||0,
    revisionNachher:after?.revision||0,
    hashVorher:before?.hash||'',
    hashNachher:after?.hash||'',
    createdAt:nowIso(),
    createdBy:user||{},
    backupId:backupId||''
  };
  ensureRoot(data);
  data.groupEvents.unshift(ev);
  data.groupEvents=data.groupEvents.slice(0,500);
  return ev;
}
function publicSection(data,siteId,groupKey,section){
  const {group,section:sec,current}=currentSection(data,siteId,groupKey,section);
  const val=current ? current.value : defaultValueForSection(sec);
  return {
    ok:true,
    siteId:slug(siteId),
    groupKey:slug(groupKey),
    section:sec,
    objectKey:objectKey(siteId,groupKey,sec),
    value:val,
    revision:current?.revision||0,
    hash:current?.hash||hash(val),
    updatedAt:current?.updatedAt||'',
    updatedBy:current?.updatedBy||{},
    hasContent:hasContent(val),
    groupUpdatedAt:group.updatedAt||''
  };
}
function updateSection(data,siteId,groupKey,section,value,opts={}){
  const {group,section:sec,current}=currentSection(data,siteId,groupKey,section);
  const previous=current||null;
  const previousValue=previous?.value;
  const previousHasContent=hasContent(previousValue);
  const incomingHasContent=hasContent(value);

  if(previousHasContent && !incomingHasContent && opts.allowEmpty!==true && opts.force!==true){
    throw new Error('Leerer Stand wird nicht gespeichert. Zum Leeren braucht es allowEmpty:true.');
  }

  const backupId=backupSection(data,siteId,groupKey,sec,previous,opts.user);
  const next={
    value,
    revision:(previous?.revision||0)+1,
    hash:hash(value),
    updatedAt:nowIso(),
    updatedBy:opts.user||{}
  };
  group.sections[sec]=next;
  group.updatedAt=next.updatedAt;
  group.siteId=slug(siteId);
  group.groupKey=slug(groupKey);

  const type = sec==='state' ? 'group.state.updated' :
               sec==='employees' ? (opts.imported?'group.employees.imported':'group.employees.updated') :
               sec==='plan' ? 'group.plan.updated' :
               sec==='duties' ? 'group.duties.updated' :
               sec==='wishes' ? 'group.wishes.updated' : 'group.updated';

  const ev=addEvent(data,type,siteId,groupKey,sec,previous,next,opts.user,backupId);
  return Object.assign(publicSection(data,siteId,groupKey,sec), {event:ev, backupId});
}
function legacyStorageKey(siteId,groupKey){
  siteId=slug(siteId||'haus_1');
  groupKey=slug(groupKey||'gruppe');
  if((siteId==='haus_1'||siteId==='haus1') && ['azoren','bali','capri','delos'].includes(groupKey)){
    return 'polypoint_ki_planer_v13_clean__'+groupKey;
  }
  return 'polypoint_ki_planer_v13_clean__'+siteId+'__'+groupKey;
}
function legacyPreview(data,siteId,groupKey){
  const key=legacyStorageKey(siteId,groupKey);
  const raw=data?.items?.[key];
  if(!raw) return {found:false,key};
  try{
    const obj=JSON.parse(String(raw));
    return {
      found:true,
      key,
      employees:Array.isArray(obj.employees)?obj.employees.length:0,
      plan:obj.plan&&typeof obj.plan==='object'?Object.keys(obj.plan).length:0,
      savedAt:obj.savedAt||'',
      value:obj
    };
  }catch(_){
    return {found:true,key,parseError:true};
  }
}
function normaliseEventOptions(limitOrOptions){
  if(limitOrOptions && typeof limitOrOptions==='object'){
    const out=Object.assign({},limitOrOptions);
    out.limit=Math.max(1,Math.min(500,parseInt(out.limit||100,10)||100));
    out.siteId=out.siteId ? slug(out.siteId) : '';
    out.groupKey=out.groupKey ? slug(out.groupKey) : '';
    out.section=out.section ? sectionName(out.section) : '';
    return out;
  }
  return {limit:Math.max(1,Math.min(500,parseInt(limitOrOptions||100,10)||100)),siteId:'',groupKey:'',section:''};
}
function matchesEventFilter(item,opts){
  if(!item) return false;
  if(opts.siteId && slug(item.siteId)!==opts.siteId) return false;
  if(opts.groupKey && slug(item.groupKey)!==opts.groupKey) return false;
  if(opts.section && sectionName(item.section||'state')!==opts.section) return false;
  return true;
}
function eventsReport(data,limitOrOptions=100){
  ensureRoot(data);
  const opts=normaliseEventOptions(limitOrOptions);
  const allEvents=Array.isArray(data.groupEvents)?data.groupEvents:[];
  const allBackups=Array.isArray(data.groupBackups)?data.groupBackups:[];
  const filteredEvents=allEvents.filter(ev=>matchesEventFilter(ev,opts));
  const filteredBackups=allBackups.filter(b=>matchesEventFilter(b,opts));
  return {
    ok:true,
    events:filteredEvents.slice(0,opts.limit),
    backups:filteredBackups.slice(0,Math.min(50,opts.limit)),
    filters:{siteId:opts.siteId,groupKey:opts.groupKey,section:opts.section},
    counters:{
      groups:Object.keys(data.groupSections||{}).length,
      events:allEvents.length,
      backups:allBackups.length,
      filteredEvents:filteredEvents.length,
      filteredBackups:filteredBackups.length
    }
  };
}
function userFromBody(body){
  return {
    email:safe(body.email||body.userEmail||body.createdBy?.email||''),
    id:safe(body.userId||body.createdBy?.id||''),
    source:safe(body.source||'group-api')
  };
}

module.exports={
  safe,slug,sectionName,objectKey,groupKeyOnly,hash,hasContent,
  ensureRoot,publicSection,updateSection,extractValue,legacyPreview,eventsReport,userFromBody
};
