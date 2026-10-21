import { writeFileSync } from 'node:fs';
import { startInPortal, readPortalTask, evalInPortal } from './portal.mjs';
const targets=[
 {id:'A-include',table:'x_2270630_pttrail__pedido_audit',sysId:'f410800ac38057101cbdb8e1b40131d6',field:'short_description'},
 {id:'A-event',table:'x_2270630_pttrail__pedido_audit',sysId:'f410800ac38057101cbdb8e1b40131d6',field:'u_valor'},
 {id:'A-global',table:'x_2270630_pttrail__pedido_audit',sysId:'c110804ac38057101cbdb8e1b40131ec',field:'u_valor'},
 {id:'A-after',table:'x_2270630_pttrail__pedido_audit',sysId:'c110804ac38057101cbdb8e1b40131ec',field:'u_aprovador'},
 {id:'A-async',table:'x_2270630_pttrail__pedido_audit',sysId:'6d10c04ac38057101cbdb8e1b401310e',field:'u_data_limite'},
 {id:'A-incident',table:'incident',sysId:'8420c04ac38057101cbdb8e1b401313f',field:'urgency'},
 {id:'B-job',table:'x_2270630_pttrailb_item',sysId:'89b4b771c30057101cbdb8e1b401314b',field:'u_estoque'},
 {id:'C-job',table:'x_2270630_pttrailc_item',sysId:'44d4b771c30057101cbdb8e1b4013189',field:'u_estoque'},
 {id:'B-event',table:'x_2270630_pttrailb_pedido',sysId:'d691c80ac38057101cbdb8e1b401314c',field:'u_valor'},
 {id:'C-event',table:'x_2270630_pttrailc_pedido',sysId:'10a1cccac38057101cbdb8e1b40131df',field:'u_valor'},
 {id:'B-cross',table:'x_2270630_pttrail__pedido',sysId:'c1bfb739c38057101cbdb8e1b40131db',field:'u_valor'},
 {id:'C-cross',table:'x_2270630_pttrail__pedido',sysId:'b5bff739c38057101cbdb8e1b4013192',field:'short_description'},
];
const encoded=Buffer.from(JSON.stringify(targets),'utf8').toString('base64');
evalInPortal("window._probeTargetsB64=''");
for(let i=0;i<encoded.length;i+=2500)evalInPortal(`window._probeTargetsB64+='${encoded.slice(i,i+2500)}'`);
evalInPortal("window._probeTargets=JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(window._probeTargetsB64),c=>c.charCodeAt(0))));window._probeTargetsB64=null");
startInPortal(`(async()=>{const out=[];for(const x of window._probeTargets){const r=await TrailRegression.runOne(x);out.push({id:x.id,table:x.table,sysId:x.sysId,field:x.field,ms:r.ms,calls:r.calls,title:r.title,labels:r.labels,fieldLabel:r.fieldLabel,gaps:r.gaps,unaudited:r.unaudited,auditFrom:r.auditFrom,fieldNotInHistory:r.fieldNotInHistory,changes:r.changes});}return JSON.stringify(out)})()`,'_probeMotor');
let result;for(;;){await new Promise(r=>setTimeout(r,2000));const t=readPortalTask('_probeMotor');if(t?.done){if(t.error)throw new Error(t.error);result=JSON.parse(t.result);break;}process.stdout.write('.');}
writeFileSync('tests/regression/escopo/probes-motor.json',JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result.map(x=>({id:x.id,ms:x.ms,calls:x.calls,title:x.title,fieldLabel:x.fieldLabel,changes:x.changes.length,top:x.changes[0]?.ev?.[0],unaudited:x.unaudited})),null,2));
