const {allow,send,readBody,fetchStore,saveStore}=require('../lib/_wishlib');
const group=require('../lib/_group-section');
const kiPlaner=require('../lib/_ki-planer');

function parseQuery(req){
  const proto=(req.headers['x-forwarded-proto']||'https');
  const host=req.headers.host||'localhost';
  return new URL(req.url||'/', proto+'://'+host).searchParams;
}
function sectionFromReq(req,body){
  const qs=parseQuery(req);
  const fromQuery=qs.get('section');
  if(fromQuery) return group.sectionName(fromQuery);
  const url=String(req.url||'');
  if(url.includes('group-employees')) return 'employees';
  if(url.includes('group-plan')) return 'plan';
  if(url.includes('group-duties')) return 'duties';
  if(url.includes('group-wishes')) return 'wishes';
  if(url.includes('group-state')) return 'state';
  return group.sectionName(body?.section||'state');
}

function decorateSectionResult(result,section){
  if(!result || typeof result!=='object') return result;
  section=group.sectionName(section);
  if(section==='state'){
    result.groupRevision=result.revision||0;
    result.groupState={
      payload:result.value||{},
      revisionId:result.revision||0,
      hash:result.hash||'',
      updatedAt:result.updatedAt||'',
      updatedBy:result.updatedBy||{}
    };
  }
  if(section==='duties'){
    const value=result.value&&typeof result.value==='object'?result.value:{version:'1.0',duties:[]};
    result.groupDutyRevision=result.revision||0;
    result.groupDuties={
      value,
      duties:Array.isArray(value.duties)?value.duties:[],
      revisionId:result.revision||0,
      hash:result.hash||'',
      updatedAt:result.updatedAt||'',
      updatedBy:result.updatedBy||{}
    };
  }
  return result;
}

function idsFrom(req,body){
  const qs=parseQuery(req);
  const rawSite=qs.get('siteId') || body?.siteId || body?.site || '';
  const rawGroup=qs.get('groupKey') || qs.get('plannerKey') || body?.groupKey || body?.plannerKey || body?.unitId || '';
  const siteId=group.slug(rawSite);
  const groupKey=group.slug(rawGroup);
  if(!String(rawSite||'').trim() || !String(rawGroup||'').trim() || groupKey==='overview' || groupKey==='startseite'){
    const err=new Error('Gruppen-Speicher braucht eine eindeutige Gruppe. Es wurde nichts gespeichert oder geladen.');
    err.code='MISSING_GROUP_CONTEXT';
    throw err;
  }
  return {siteId,groupKey};
}

module.exports=async function handler(req,res){
  if(allow(req,res)) return;
  try{
    const row=await fetchStore();
    const data=row.data||{};

    if(req.method==='GET'){
      const section=sectionFromReq(req,{});
      const ids=idsFrom(req,{});
      const result=decorateSectionResult(group.publicSection(data,ids.siteId,ids.groupKey,section),section);
      result.legacy=group.legacyPreview(data,ids.siteId,ids.groupKey);
      result.updatedAt=row.updated_at||'';
      return send(res,200,result);
    }

    if(req.method!=='POST') return send(res,405,{ok:false,message:'Nur GET oder POST erlaubt.'});

    const body=await readBody(req);
    const mode=group.safe(body.mode||'save');
    const section=sectionFromReq(req,body);
    const ids=idsFrom(req,body);

    if(mode==='load'){
      const result=decorateSectionResult(group.publicSection(data,ids.siteId,ids.groupKey,section),section);
      result.legacy=group.legacyPreview(data,ids.siteId,ids.groupKey);
      result.updatedAt=row.updated_at||'';
      return send(res,200,result);
    }

    if(mode==='kiStatus'){
      const result=kiPlaner.status();
      result.siteId=ids.siteId;
      result.groupKey=ids.groupKey;
      result.updatedAt=row.updated_at||'';
      return send(res,200,result);
    }

    if(['kiDienstplanPruefen','kiPlaner','aiReview'].includes(mode)){
      const result=await kiPlaner.pruefeDienstplan({data,siteId:ids.siteId,groupKey:ids.groupKey,body,row});
      result.updatedAt=row.updated_at||'';
      return send(res,200,result);
    }

    if(mode!=='save' && mode!=='import'){
      return send(res,400,{ok:false,message:'Unbekannter Modus.'});
    }

    const value=group.extractValue(body,section);
    const updated=group.updateSection(data,ids.siteId,ids.groupKey,section,value,{
      allowEmpty:body.allowEmpty===true,
      force:body.force===true,
      imported:mode==='import' || body.imported===true,
      user:group.userFromBody(body)
    });

    const saved=await saveStore(data);
    updated.updatedAt=saved.updated_at||updated.updatedAt;
    return send(res,200,decorateSectionResult(updated,section));
  }catch(err){
    return send(res,400,{ok:false,message:err.message||String(err)});
  }
};
