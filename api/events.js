const {allow,send,readBody,fetchStore}=require('../lib/_wishlib');
const group=require('../lib/_group-section');

function parseQuery(req){
  const proto=(req.headers['x-forwarded-proto']||'https');
  const host=req.headers.host||'localhost';
  return new URL(req.url||'/', proto+'://'+host).searchParams;
}
function readFiltersFromQuery(qs){
  return {
    limit:Math.max(1,Math.min(500,parseInt(qs.get('limit')||100,10)||100)),
    siteId:qs.get('siteId') || qs.get('site') || qs.get('haus') || '',
    groupKey:qs.get('groupKey') || qs.get('plannerKey') || qs.get('unitId') || qs.get('gruppe') || '',
    section:qs.get('section') || qs.get('bereich') || ''
  };
}
function readFiltersFromBody(body){
  body=body||{};
  return {
    limit:Math.max(1,Math.min(500,parseInt(body.limit||100,10)||100)),
    siteId:body.siteId || body.site || body.haus || '',
    groupKey:body.groupKey || body.plannerKey || body.unitId || body.gruppe || '',
    section:body.section || body.bereich || ''
  };
}

module.exports=async function handler(req,res){
  if(allow(req,res)) return;
  try{
    const row=await fetchStore();
    const data=row.data||{};
    let filters;

    if(req.method==='POST'){
      const body=await readBody(req);
      filters=readFiltersFromBody(body);
    }else if(req.method==='GET'){
      filters=readFiltersFromQuery(parseQuery(req));
    }else{
      return send(res,405,{ok:false,message:'Nur GET oder POST erlaubt.'});
    }

    const out=group.eventsReport(data,filters);
    out.updatedAt=row.updated_at||'';
    return send(res,200,out);
  }catch(err){
    return send(res,400,{ok:false,message:err.message||String(err)});
  }
};
