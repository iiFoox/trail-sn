import { writeFileSync } from 'node:fs';
import { injectBundle } from '../bateria2000/injetar.mjs';
import { startInPortal, readPortalTask } from './portal.mjs';
injectBundle();
startInPortal(`TrailRegression.runOne({table:'x_2270630_pttrailc_pedido',sysId:'ed83fbbdc3cc17101cbdb8e1b4013175',field:'priority'})`, '_probeC58');
for(;;){await new Promise(resolve=>setTimeout(resolve,500));const t=readPortalTask('_probeC58');if(t?.done){if(t.error)throw new Error(t.error);writeFileSync('tests/regression/escopo/probe-c58.json',JSON.stringify(t.result,null,2)+'\n');console.log(JSON.stringify(t.result,null,2));break}}
