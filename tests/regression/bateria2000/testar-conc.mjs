// tests/regression/bateria2000/testar-conc.mjs
import { readFileSync } from 'node:fs';
import { evalInPortal } from './gerar-alvos.mjs';

const sample = JSON.parse(readFileSync('tests/regression/bateria2000/alvos.json', 'utf8')).slice(0, 4);
console.log('Testando 4 alvos com concorrência 2...');
const t0 = Date.now();
const code = `TrailRegression.runDifferential(${JSON.stringify(sample)}, undefined, 2).then(r => JSON.stringify({totalMs: r.totalMs, medianMs: r.medianMs, okCount: r.results.filter(x=>x.ok).length}))`;
const res = evalInPortal(code);
console.log('Resultado conc 2:', res, `Tempo real Node: ${Date.now() - t0} ms`);
