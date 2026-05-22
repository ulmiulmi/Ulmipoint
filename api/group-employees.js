const {makeHandler}=require('./_group-section');
module.exports=makeHandler({
  entity:'employees',
  label:'Mitarbeitende',
  keys:['employees','employeeLimits','monthTargets','balanceCarryovers']
});
