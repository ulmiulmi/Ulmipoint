const {allow,send,readBody,fetchStore,findEmployee}=require('../lib/_wishlib');

function safe(v){return String(v||'').trim();}
function today(){return new Date().toISOString().slice(0,10);}
function employeeKeyFromEvent(e){return [e.employee?.groupKey||e.group||'', e.employeeId||'', e.employeeName||''].join('|').toLowerCase();}
function employeeKey(emp){return [emp.groupKey||emp.group||'', emp.id||'', emp.name||''].join('|').toLowerCase();}

module.exports=async function handler(req,res){
  if(allow(req,res))return;
  if(req.method!=='POST')return send(res,405,{ok:false,message:'Nur POST erlaubt.'});
  try{
    const body=await readBody(req);
    const row=await fetchStore();
    const data=row.data||{};
    const clock=data.timeClock&&typeof data.timeClock==='object'?data.timeClock:{events:[]};
    let events=Array.isArray(clock.events)?clock.events.slice():[];

    const mode=safe(body.mode||'self');
    if(mode==='self'){
      const identity=safe(body.identity);
      const code=safe(body.code || body.wishCode);
      if(!identity || !code) throw new Error('Bitte zuerst einloggen.');
      const found=findEmployee(data,identity,code,body.employeeId);
      const k=employeeKey(found.emp);
      events=events.filter(e=>employeeKeyFromEvent(e)===k);
    }else{
      const adminKey=safe(body.adminKey);
      const expected=safe(process.env.ULMIPOINT_TIMECLOCK_ADMIN_KEY || process.env.ZEITERFASSUNG_ADMIN_KEY);
      if(expected && adminKey!==expected) throw new Error('Admin-Zugriff für Zeiterfassung nicht freigegeben.');
      if(!expected) throw new Error('Admin-Liste ist vorbereitet, aber ULMIPOINT_TIMECLOCK_ADMIN_KEY ist noch nicht gesetzt.');
    }

    if(body.date) events=events.filter(e=>String(e.at||'').slice(0,10)===safe(body.date));
    if(body.group) events=events.filter(e=>safe(e.group).toLowerCase()===safe(body.group).toLowerCase());
    if(body.employeeName) events=events.filter(e=>safe(e.employeeName).toLowerCase().includes(safe(body.employeeName).toLowerCase()));

    const limit=Math.max(1,Math.min(500,Number(body.limit)||50));
    events=events.slice(0,limit);
    return send(res,200,{ok:true,events,locations:clock.locations||{},api:clock.api||{mode:'prepared'},updatedAt:clock.updatedAt||row.updated_at});
  }catch(err){
    return send(res,400,{ok:false,message:err.message||String(err)});
  }
};
