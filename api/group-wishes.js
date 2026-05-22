const {makeHandler}=require('./_group-section');
module.exports=makeHandler({
  entity:'wishes',
  label:'Wunschdaten',
  keys:['wishes','wishRequests','employeeWishes','wishLocks','wishMeta','requests']
});
