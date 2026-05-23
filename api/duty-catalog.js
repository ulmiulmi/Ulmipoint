const {allow,send}=require('../lib/_wishlib');
module.exports=async function handler(req,res){ if(allow(req,res))return; return send(res,200,{ok:false,disabled:true,message:'Dienstkatalog in v128 bewusst deaktiviert.'}); };
