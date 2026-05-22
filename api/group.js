const {allow,send,readBody,fetchStore,saveStore}=require('../lib/_wishlib');
const group=require('../lib/_group-section');

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
  if(url.includes('group-wishes')) return 'wishes';
  if(url.includes('group-state')) return 'state';
  return group.sectionName(body?.section||'state');
}
function idsFrom(req,body){
  const qs=parseQuery(req);
  return {
    siteId:group.slug(qs.get('siteId') || body?.siteId || body?.site || 'haus_1'),
    groupKey:group.slug(qs.get('groupKey') || qs.get('plannerKey') || body?.groupKey || body?.plannerKey || body?.unitId || 'gruppe')
  };
}

module.exports=async function handler(req,res){
  if(allow(req,res)) return;
  try{
    const row=await fetchStore();
    const data=row.data||{};

    if(req.method==='GET'){
      const section=sectionFromReq(req,{});
      const ids=idsFrom(req,{});
      const result=group.publicSection(data,ids.siteId,ids.groupKey,section);
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
      const result=group.publicSection(data,ids.siteId,ids.groupKey,section);
      result.legacy=group.legacyPreview(data,ids.siteId,ids.groupKey);
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
    return send(res,200,updated);
  }catch(err){
    return send(res,400,{ok:false,message:err.message||String(err)});
  }
};
