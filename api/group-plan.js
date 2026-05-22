const {makeHandler}=require('./_group-section');
module.exports=makeHandler({
  entity:'plan',
  label:'Gruppen-Dienstplan',
  keys:['selectedMonth','selectedYear','plan','dayStatus','dayNeeds','dayOverlap','dayOverrides','teamMeetings','lockedMonths','globalPlanFreezes','duties','rules','ruleToggles','standardNeeds','monthTargets','balanceCarryovers','employeeLimits','schoolHolidays','holidays','deletedDutyCodes']
});
