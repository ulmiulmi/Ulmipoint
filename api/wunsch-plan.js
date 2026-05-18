const {allow,send,readBody,fetchStore,findEmployee,publicPayload}=require('./_wishlib');
module.exports=async function handler(req,res){
  try{
    if(allow(req,res))return;
    if(req.method!=='POST')return send(res,405,{ok:false,message:'Nur POST erlaubt.'});
    const body=await readBody(req);
    const identity=String(body.identity||'').trim(); const code=String(body.code||'').trim(); const monthKey=String(body.monthKey||'').trim();
    if(!identity||!code)return send(res,400,{ok:false,message:'Name/E-Mail und Wunsch-Code fehlen.'});
    if(!/^\d{4}-\d{2}$/.test(monthKey))return send(res,400,{ok:false,message:'Monat fehlt.'});
    const row=await fetchStore(); const {emp}=findEmployee(row.data,identity,code,body.employeeId);
    return send(res,200,publicPayload(row,emp,identity,monthKey,body.todayDate));
  }catch(e){return send(res,500,{ok:false,message:e.message||String(e)});}
};
