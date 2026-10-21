// tests/regression/bateria2000/testar-3.mjs
import { readFileSync } from 'node:fs';
import { evalInPortal } from './gerar-alvos.mjs';

const sample = JSON.parse(readFileSync('tests/regression/bateria2000/alvos.json', 'utf8')).slice(0, 3);
console.log('Testando 3 alvos...');
const code = `TrailRegression.runDifferential(${JSON.stringify(sample)}).then(r => JSON.stringify(r))`;
const res = evalInPortal(code);
console.log('Resultado completo para 3 alvos:');
console.log(JSON.stringify(JSON.parse(res), null, 2));
