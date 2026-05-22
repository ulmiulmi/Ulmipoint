const {allow,send,readBody,fetchStore}=require('../lib/_wishlib');
const group=require('../lib/_group-section');

module.exports=async function handler(req,res){
  if(allow(req,res)) return;
  try{
    const row=await fetchStore();
    const data=row.data||{};
    let limit=100;
    if(req.method==='POST'){
      const body=await readBody(req);
      limit=Math.max(1,Math.min(500,parseInt(body.limit||100,10)||100));
    }else if(req.method==='GET'){
      const proto=(req.headers['x-forwarded-proto']||'https');
      const host=req.headers.host||'localhost';
      const qs=new URL(req.url||'/', proto+'://'+host).searchParams;
      limit=Math.max(1,Math.min(500,parseInt(qs.get('limit')||100,10)||100));
    }else{
      return send(res,405,{ok:false,message:'Nur GET oder POST erlaubt.'});
    }
    const out=group.eventsReport(data,limit);
    out.updatedAt=row.updated_at||'';
    return send(res,200,out);
  }catch(err){
    return send(res,400,{ok:false,message:err.message||String(err)});
  }
};
