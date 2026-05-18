const { allow, send, readBody, fetchStore } = require('./_wishlib');

function safe(v){ return String(v || '').trim(); }
function lc(v){ return safe(v).toLowerCase(); }
function eventDate(e){ return safe(e.date || e.day || e.datum || e.at || e.timestamp || e.createdAt).slice(0,10); }
function eventEmployee(e){ return safe(e.employeeName || e.name || e.employee || e.mitarbeiter || e.userName); }
function eventGroup(e){ return safe(e.group || e.groupName || e.unitName || e.unit || e.bereich); }
function normalizeEvent(e){
  const at = safe(e.at || e.timestamp || e.time || e.createdAt || e.date || new Date().toISOString());
  const action = safe(e.action || e.type || e.mode || e.event || '');
  const out = Object.assign({}, e, {
    at,
    timeText: safe(e.timeText || at.replace('T',' ').slice(0,16)),
    employeeName: eventEmployee(e),
    employeeId: safe(e.employeeId || e.mitarbeiterId || e.id || ''),
    group: eventGroup(e),
    action,
    actionLabel: safe(e.actionLabel || (action === 'clock_in' ? 'Kommen' : action === 'clock_out' ? 'Gehen' : action)),
    locationId: safe(e.locationId || e.location || e.ort || ''),
    locationLabel: safe(e.locationLabel || e.locationName || e.locationId || e.location || e.ort || ''),
    source: safe(e.source || 'server'),
    api: e.api && typeof e.api === 'object' ? e.api : { status: safe(e.apiStatus || 'open') },
    token: safe(e.token || e.raw || '')
  });
  return out;
}
function collectEvents(data){
  const sources = [
    data && data.timeClock && data.timeClock.events,
    data && data.timeClockEvents,
    data && data.clockEvents,
    data && data.zeiterfassung && data.zeiterfassung.events
  ];
  for(const src of sources){
    if(Array.isArray(src)) return src.map(normalizeEvent);
  }
  return [];
}

module.exports = async function handler(req, res){
  if(allow(req,res)) return;
  if(req.method !== 'POST') return send(res,405,{ok:false,message:'Nur POST erlaubt.'});
  try{
    const body = await readBody(req);
    const row = await fetchStore();
    const data = row.data || {};
    let events = collectEvents(data);
    const date = safe(body.date);
    const group = lc(body.group);
    const employeeName = lc(body.employeeName);
    if(date) events = events.filter(e => eventDate(e) === date);
    if(group) events = events.filter(e => lc(eventGroup(e)).includes(group));
    if(employeeName) events = events.filter(e => lc(eventEmployee(e)).includes(employeeName));
    events.sort((a,b) => safe(b.at).localeCompare(safe(a.at)));
    const limit = Math.max(1, Math.min(1000, Number(body.limit) || 200));
    return send(res,200,{
      ok:true,
      events:events.slice(0,limit),
      total:events.length,
      updatedAt: row.updated_at || new Date().toISOString(),
      access:'admin-session',
      api:{mode:'prepared'}
    });
  }catch(err){
    return send(res,400,{ok:false,message:err.message || String(err)});
  }
};
