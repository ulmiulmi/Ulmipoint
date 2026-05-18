const {allow,send,readBody,fetchStore,saveStore}=require('./_wishlib');
const {BASEL_STADT_DEFAULT_RULESET, baselStadtHolidays, isBaselStadtHoliday, isSunday}=require('./_timeClockRules');

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.ULMIPOINT_SUPABASE_URL || process.env.POLYPOINT_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SECRET_KEY;

function safe(v){return String(v||'').trim();}
function normEmail(v){return safe(v).toLowerCase();}
function parseJsonMaybe(v){ if(!v||typeof v!=='string')return null; try{return JSON.parse(v)}catch(_){return null} }
function normText(v){ return String(v||'').trim().toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' '); }
function groupKey(v){return normText(v||'allgemein')}
function pad2(n){return String(n).padStart(2,'0')}
function isoDate(y,m,d){return y+'-'+pad2(m)+'-'+pad2(d)}
function minutesToHours(m){return Math.round((m/60)*100)/100}
function normalizeRole(v){v=safe(v).toLowerCase(); if(['admin','administrator','leitung'].includes(v))return 'admin'; if(['planner','planer','planung'].includes(v))return 'planner'; if(['employee','mitarbeiter','ma'].includes(v))return 'employee'; return v;}
function roleStore(data){const roles=(data&&typeof data==='object')?(data.accessRoles||data.roles||{}):{}; return roles&&typeof roles==='object'?roles:{};}

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

function groupFromKey(key,obj){
  const raw=String(obj?.planerGroupName || obj?.groupName || key || '').replace(/^polypoint_/,'').replace(/_/g,' ').trim();
  if(/azoren/i.test(raw))return 'Azoren'; if(/bali/i.test(raw))return 'Bali'; if(/capri/i.test(raw))return 'Capri'; if(/delos/i.test(raw))return 'Delos'; if(/nacht/i.test(raw))return 'Nachtwache'; if(/pikett/i.test(raw))return 'Haus-Pikett'; if(/haus.*dienst|hausdienst/i.test(raw))return 'Haus-Dienstplan';
  return raw || 'Allgemein';
}
function extractEmployeesWithState(data){
  const out=[]; const items=data?.items||{};
  Object.entries(items).forEach(([key,val])=>{
    const st=parseJsonMaybe(val); if(!st||!Array.isArray(st.employees))return;
    const group=groupFromKey(key,st);
    st.employees.forEach((emp,idx)=>{
      if(!emp||emp.active===false)return; const name=safe(emp.name); if(!name)return;
      out.push({id:String(emp.id||name),name,role:String(emp.role||''),group,groupKey:groupKey(group),sourceKey:key,index:idx,state:st});
    });
  });
  const seen=new Set(), uniq=[];
  out.forEach(e=>{const k=(e.group+'|'+e.id+'|'+e.name).toLowerCase(); if(seen.has(k))return; seen.add(k); uniq.push(e);});
  uniq.sort((a,b)=>a.group.localeCompare(b.group,'de')||a.name.localeCompare(b.name,'de'));
  return uniq;
}
function dutyByCode(st,code){return (Array.isArray(st?.duties)?st.duties:[]).find(d=>safe(d.code).toUpperCase()===safe(code).toUpperCase())||null}
function planEntryForEmployee(st,emp,date){
  const plan=st?.plan&&typeof st.plan==='object'?st.plan:{};
  const ids=[emp.id, emp.name].filter(Boolean).map(String);
  for(const id of ids){ const e=plan[date+'__'+id]; if(e)return e; }
  for(const [k,e] of Object.entries(plan)){
    if(!String(k).startsWith(date+'__'))continue;
    const pid=String(k).split('__')[1]||'';
    if(normText(pid)===normText(emp.name)||String(pid)===String(emp.id))return e;
  }
  return null;
}
function statusFromCode(code){
  code=safe(code).toUpperCase();
  const st=BASEL_STADT_DEFAULT_RULESET.statusCodes;
  if(st.sick.includes(code))return 'krank';
  if(st.vacation.includes(code))return 'ferien';
  if(st.school.includes(code))return 'schule';
  if(st.training.includes(code))return 'weiterbildung';
  if(st.compensation.includes(code))return 'kompensation';
  if(st.free.includes(code) || !code)return 'frei';
  return 'dienst';
}
function dutyLabel(st,entry){
  const code=safe(entry?.code).toUpperCase(); if(!code)return 'frei / leer';
  const d=dutyByCode(st,code);
  const name=safe(d?.name||entry?.name);
  const time=d?.start&&d?.end ? d.start+'–'+d.end : '';
  return [code,name,time].filter(Boolean).join(' · ');
}
function plannedMinutes(st,entry){
  const code=safe(entry?.code).toUpperCase(); const d=dutyByCode(st,code);
  const start=safe(d?.start), end=safe(d?.end);
  if(!start||!end)return 0;
  const [sh,sm]=start.split(':').map(Number); const [eh,em]=end.split(':').map(Number);
  if(!Number.isFinite(sh)||!Number.isFinite(eh))return 0;
  let s=sh*60+(sm||0), e=eh*60+(em||0);
  if(e<=s)e+=1440;
  return Math.max(0,e-s);
}
function eventEmpKey(e){return [e.employee?.groupKey||groupKey(e.group), e.employeeId||'', e.employeeName||''].join('|').toLowerCase();}
function empKey(e){return [e.groupKey||groupKey(e.group), e.id||'', e.name||''].join('|').toLowerCase();}
function eventAt(e){const d=new Date(e.at); return Number.isFinite(d.getTime())?d:null}
function minutesBetween(a,b){return Math.max(0,Math.round((b.getTime()-a.getTime())/60000))}
function dateOnly(d){return d.toISOString().slice(0,10)}
function localIsoDay(iso){return String(iso||'').slice(0,10)}

function pairEventsForEmployee(events,emp){
  const key=empKey(emp);
  const list=events.filter(e=>eventEmpKey(e)===key).map(e=>Object.assign({},e,{_date:eventAt(e)})).filter(e=>e._date).sort((a,b)=>a._date-b._date);
  const pairs=[]; let open=null;
  for(const e of list){
    const act=safe(e.action).toLowerCase();
    if(act.includes('kommen')){
      if(open)pairs.push({start:open._date,end:null,startEvent:open,endEvent:null,warning:'Kommen ohne Gehen vor nächstem Kommen'});
      open=e;
    }else if(act.includes('gehen')){
      if(open){ pairs.push({start:open._date,end:e._date,startEvent:open,endEvent:e}); open=null; }
      else pairs.push({start:null,end:e._date,startEvent:null,endEvent:e,warning:'Gehen ohne Kommen'});
    }
  }
  if(open)pairs.push({start:open._date,end:null,startEvent:open,endEvent:null,warning:'Kommen ohne Gehen'});
  return pairs;
}
function pairsStartingOnDate(pairs,date){
  return pairs.filter(p=>p.start && dateOnly(p.start)===date);
}
function nightMinutes(start,end){
  if(!start||!end)return 0;
  let min=0; const cur=new Date(start.getTime());
  while(cur<end){
    const next=new Date(Math.min(end.getTime(), cur.getTime()+15*60000));
    const h=cur.getUTCHours(), m=cur.getUTCMinutes(); const tod=h*60+m;
    if(tod>=20*60 || tod<6*60) min+=minutesBetween(cur,next);
    cur.setTime(next.getTime());
  }
  return min;
}
function saturdayMinutes(start,end){
  if(!start||!end)return 0;
  let min=0; const cur=new Date(start.getTime());
  while(cur<end){
    const next=new Date(Math.min(end.getTime(), cur.getTime()+15*60000));
    const day=dateOnly(cur);
    const d=new Date(day+'T12:00:00Z');
    if(d.getUTCDay()===6 && !isBaselStadtHoliday(day)) min+=minutesBetween(cur,next);
    cur.setTime(next.getTime());
  }
  return min;
}
function sundayHolidayMinutes(start,end){
  if(!start||!end)return 0;
  let min=0; const cur=new Date(start.getTime());
  while(cur<end){
    const next=new Date(Math.min(end.getTime(), cur.getTime()+15*60000));
    const day=dateOnly(cur);
    if(isSunday(day) || isBaselStadtHoliday(day)) min+=minutesBetween(cur,next);
    cur.setTime(next.getTime());
  }
  return min;
}
function rateNumber(v){
  const n=Number(v);
  return Number.isFinite(n)?Math.max(0,n):0;
}
function allowanceRatesFromBody(body){
  const r=body&&body.allowanceRates&&typeof body.allowanceRates==='object'?body.allowanceRates:{};
  return {
    night: rateNumber(r.night),
    saturday: rateNumber(r.saturday),
    sundayHoliday: rateNumber(r.sundayHoliday),
    pikett: rateNumber(r.pikett)
  };
}

function monthDays(monthKey){
  const [y,m]=String(monthKey).split('-').map(Number);
  const n=new Date(Date.UTC(y,m,0)).getUTCDate();
  const out=[]; for(let d=1;d<=n;d++)out.push(isoDate(y,m,d));
  return out;
}

module.exports=async function handler(req,res){
  if(allow(req,res))return;
  if(req.method!=='POST')return send(res,405,{ok:false,message:'Nur POST erlaubt.'});
  try{
    const body=await readBody(req);
    const monthKey=safe(body.monthKey || new Date().toISOString().slice(0,7));
    if(!/^\d{4}-\d{2}$/.test(monthKey)) throw new Error('Monat fehlt oder ist ungültig.');
    const row=await fetchStore();
    const data=row.data||{};
    const user=await verifySupabaseUser(req);
    const access=assertAdminAccess(data,user);

    if(!data.timeClock || typeof data.timeClock!=='object') data.timeClock={version:'1.0',events:[],locations:{},api:{mode:'prepared'}};
    if(!data.timeClock.monthlyClose || typeof data.timeClock.monthlyClose!=='object') data.timeClock.monthlyClose={rules:{},drafts:{}};
    if(!data.timeClock.monthlyClose.rules || typeof data.timeClock.monthlyClose.rules!=='object') data.timeClock.monthlyClose.rules={};
    if(!data.timeClock.monthlyClose.drafts || typeof data.timeClock.monthlyClose.drafts!=='object') data.timeClock.monthlyClose.drafts={};
    if(!data.timeClock.monthlyClose.employeeDrafts || typeof data.timeClock.monthlyClose.employeeDrafts!=='object') data.timeClock.monthlyClose.employeeDrafts={};

    const mode=safe(body.mode||'calculate');

    if(mode==='load_rules'){
      const rules=data.timeClock.monthlyClose.rules || {};
      return send(res,200,{ok:true,mode,rules,access,updatedAt:row.updated_at});
    }

    if(mode==='save_rules'){
      const next=allowanceRatesFromBody(body);
      data.timeClock.monthlyClose.rules.allowanceRates=next;
      data.timeClock.monthlyClose.rules.updatedAt=new Date().toISOString();
      data.timeClock.monthlyClose.rules.updatedBy={email:user.email||'',id:user.id||''};
      const saved=await saveStore(data);
      return send(res,200,{ok:true,mode,rules:data.timeClock.monthlyClose.rules,access,updatedAt:saved.updated_at||data.timeClock.monthlyClose.rules.updatedAt});
    }

    if(mode==='load_draft'){
      const draft=data.timeClock.monthlyClose.drafts[monthKey] || null;
      const employeeDrafts=data.timeClock.monthlyClose.employeeDrafts[monthKey] || {};
      return send(res,200,{ok:true,mode,monthKey,draft,employeeDrafts,access,updatedAt:row.updated_at});
    }

    if(mode==='list_drafts'){
      const drafts=data.timeClock.monthlyClose.drafts || {};
      const employeeDrafts=data.timeClock.monthlyClose.employeeDrafts || {};
      const months=Array.from(new Set(Object.keys(drafts).concat(Object.keys(employeeDrafts)))).sort().reverse();
      return send(res,200,{ok:true,mode,months:months.map(m=>({monthKey:m,monthDraft:!!drafts[m],employeeCount:employeeDrafts[m]?Object.keys(employeeDrafts[m]).length:0,savedAt:drafts[m]?.savedAt||''})),access,updatedAt:row.updated_at});
    }

    const allowanceRates=Object.assign(
      {},
      data.timeClock.monthlyClose.rules.allowanceRates || {},
      body.allowanceRates ? allowanceRatesFromBody(body) : {}
    );

    let employees=extractEmployeesWithState(data);
    const bulkMode = mode === 'save_all_drafts';
    if(!bulkMode && body.group) employees=employees.filter(e=>safe(e.group).toLowerCase()===safe(body.group).toLowerCase());
    if(!bulkMode && body.employeeName) employees=employees.filter(e=>safe(e.name).toLowerCase().includes(safe(body.employeeName).toLowerCase()));
    const allEvents=Array.isArray(data.timeClock?.events)?data.timeClock.events:[];
    const days=monthDays(monthKey);
    const [year]=monthKey.split('-').map(Number);
    const holidayList=baselStadtHolidays(year);

    const employeeSummaries=[];
    const detailRows=[];

    for(const emp of employees){
      const pairs=pairEventsForEmployee(allEvents,emp);
      const sum={employeeId:emp.id,employeeName:emp.name,group:emp.group,plannedMinutes:0,workedMinutes:0,diffMinutes:0,nightMinutes:0,saturdayMinutes:0,sundayHolidayMinutes:0,nightAllowance:0,saturdayAllowance:0,sundayHolidayAllowance:0,totalAllowance:0,krank:0,ferien:0,schule:0,weiterbildung:0,frei:0,dienstTage:0,warnings:0};

      for(const date of days){
        const st=emp.state; const entry=planEntryForEmployee(st,emp,date); const code=safe(entry?.code).toUpperCase();
        const status=statusFromCode(code);
        const planned= status==='dienst' ? plannedMinutes(st,entry) : 0;
        const holiday=isBaselStadtHoliday(date); const sunday=isSunday(date);
        const dayPairs=pairsStartingOnDate(pairs,date);
        let worked=0, night=0, sat=0, sh=0, first='', last='';
        const warnings=[];

        dayPairs.forEach(p=>{
          if(p.warning) warnings.push(p.warning);
          if(p.start && !first) first=p.start.toISOString();
          if(p.end) last=p.end.toISOString();
          if(p.start && p.end){
            const wm=minutesBetween(p.start,p.end);
            worked+=wm; night+=nightMinutes(p.start,p.end); sat+=saturdayMinutes(p.start,p.end); sh+=sundayHolidayMinutes(p.start,p.end);
          }
        });

        if(status==='dienst'){
          sum.dienstTage++; sum.plannedMinutes+=planned;
          if(!dayPairs.some(p=>p.start)) warnings.push('Dienst geplant, kein Kommen');
          if(dayPairs.some(p=>p.start&&!p.end)) warnings.push('Kommen vorhanden, Gehen fehlt');
        }else{
          if(status==='krank')sum.krank++;
          if(status==='ferien')sum.ferien++;
          if(status==='schule')sum.schule++;
          if(status==='weiterbildung')sum.weiterbildung++;
          if(status==='frei')sum.frei++;
          if(dayPairs.length) warnings.push('Stempelung trotz '+status);
        }
        if(dayPairs.some(p=>p.start&&p.end&&p.end<p.start)) warnings.push('Gehen vor Kommen');

        const nightAllowance=minutesToHours(night)*allowanceRates.night;
        const saturdayAllowance=minutesToHours(sat)*allowanceRates.saturday;
        const sundayHolidayAllowance=minutesToHours(sh)*allowanceRates.sundayHoliday;
        const totalAllowance=nightAllowance+saturdayAllowance+sundayHolidayAllowance;

        sum.workedMinutes+=worked; sum.nightMinutes+=night; sum.saturdayMinutes+=sat; sum.sundayHolidayMinutes+=sh;
        sum.nightAllowance+=nightAllowance; sum.saturdayAllowance+=saturdayAllowance; sum.sundayHolidayAllowance+=sundayHolidayAllowance; sum.totalAllowance+=totalAllowance;
        sum.warnings+=warnings.length;

        detailRows.push({
          date,
          weekday:['So','Mo','Di','Mi','Do','Fr','Sa'][new Date(date+'T12:00:00Z').getUTCDay()],
          employeeId:emp.id, employeeName:emp.name, group:emp.group,
          code, planLabel:dutyLabel(st,entry), status,
          holiday: holiday?holiday.name:'',
          sunday,
          plannedHours:minutesToHours(planned),
          workedHours:minutesToHours(worked),
          diffHours:minutesToHours(worked-planned),
          nightHours:minutesToHours(night),
          saturdayHours:minutesToHours(sat),
          sundayHolidayHours:minutesToHours(sh),
          nightAllowance:Math.round(nightAllowance*100)/100,
          saturdayAllowance:Math.round(saturdayAllowance*100)/100,
          sundayHolidayAllowance:Math.round(sundayHolidayAllowance*100)/100,
          totalAllowance:Math.round(totalAllowance*100)/100,
          firstClock:first, lastClock:last,
          warnings
        });
      }
      sum.diffMinutes=sum.workedMinutes-sum.plannedMinutes;
      employeeSummaries.push(Object.assign({},sum,{
        plannedHours:minutesToHours(sum.plannedMinutes),
        workedHours:minutesToHours(sum.workedMinutes),
        diffHours:minutesToHours(sum.diffMinutes),
        nightHours:minutesToHours(sum.nightMinutes),
        saturdayHours:minutesToHours(sum.saturdayMinutes),
        sundayHolidayHours:minutesToHours(sum.sundayHolidayMinutes),
        nightAllowance:Math.round(sum.nightAllowance*100)/100,
        saturdayAllowance:Math.round(sum.saturdayAllowance*100)/100,
        sundayHolidayAllowance:Math.round(sum.sundayHolidayAllowance*100)/100,
        totalAllowance:Math.round(sum.totalAllowance*100)/100
      }));
    }

    const totals=employeeSummaries.reduce((a,e)=>{
      ['plannedMinutes','workedMinutes','diffMinutes','nightMinutes','saturdayMinutes','sundayHolidayMinutes','nightAllowance','saturdayAllowance','sundayHolidayAllowance','totalAllowance','krank','ferien','schule','weiterbildung','frei','dienstTage','warnings'].forEach(k=>a[k]=(a[k]||0)+(e[k]||0));
      return a;
    },{});
    Object.assign(totals,{
      plannedHours:minutesToHours(totals.plannedMinutes||0),
      workedHours:minutesToHours(totals.workedMinutes||0),
      diffHours:minutesToHours(totals.diffMinutes||0),
      nightHours:minutesToHours(totals.nightMinutes||0),
      saturdayHours:minutesToHours(totals.saturdayMinutes||0),
      sundayHolidayHours:minutesToHours(totals.sundayHolidayMinutes||0),
      nightAllowance:Math.round((totals.nightAllowance||0)*100)/100,
      saturdayAllowance:Math.round((totals.saturdayAllowance||0)*100)/100,
      sundayHolidayAllowance:Math.round((totals.sundayHolidayAllowance||0)*100)/100,
      totalAllowance:Math.round((totals.totalAllowance||0)*100)/100
    });

    const result={ok:true,mode,monthKey,canton:'BS',holidayProfile:'CH-BS',ruleset:BASEL_STADT_DEFAULT_RULESET,allowanceRates,holidays:holidayList,totals,employees:employeeSummaries,days:detailRows,access,updatedAt:row.updated_at};

    if(mode==='save_draft' || mode==='save_all_drafts'){
      const now=new Date().toISOString();
      const status = mode === 'save_all_drafts' ? 'bulk_draft' : 'draft';
      data.timeClock.monthlyClose.drafts[monthKey]={
        monthKey,
        savedAt:now,
        savedBy:{email:user.email||'',id:user.id||''},
        allowanceRates,
        totals,
        employees:employeeSummaries,
        days:detailRows,
        canton:'BS',
        holidayProfile:'CH-BS',
        status
      };

      const employeeMap={};
      for(const emp of employeeSummaries){
        const key=[emp.group,emp.employeeId,emp.employeeName].join('|').toLowerCase();
        employeeMap[key]={
          monthKey,
          savedAt:now,
          savedBy:{email:user.email||'',id:user.id||''},
          allowanceRates,
          employee:emp,
          days:detailRows.filter(d=>d.employeeId===emp.employeeId && d.employeeName===emp.employeeName && d.group===emp.group),
          canton:'BS',
          holidayProfile:'CH-BS',
          status
        };
      }
      data.timeClock.monthlyClose.employeeDrafts[monthKey]=employeeMap;

      const saved=await saveStore(data);
      result.savedDraft=data.timeClock.monthlyClose.drafts[monthKey];
      result.savedEmployeeDrafts=Object.keys(employeeMap).length;
      result.updatedAt=saved.updated_at||now;
    }

    return send(res,200,result);
  }catch(err){
    return send(res,400,{ok:false,message:err.message||String(err)});
  }
};
