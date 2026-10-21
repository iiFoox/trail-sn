// tests/regression/bateria2000/testar-bg.mjs
import { readFileSync } from 'node:fs';
import { evalInPortal } from './gerar-alvos.mjs';

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function testBg() {
  const sample = JSON.parse(readFileSync('tests/regression/bateria2000/alvos.json', 'utf8')).slice(0, 10);
  console.log('Iniciando 10 alvos em background na página...');

  // Iniciar execução assíncrona
  const startCode = `
    window._res = null;
    window._err = null;
    window._differentialDone = false;
    TrailRegression.runDifferential(${JSON.stringify(sample)}, undefined, 2)
      .then(r => { window._res = r; window._differentialDone = true; })
      .catch(e => { window._err = String(e); window._differentialDone = true; });
    'started';
  `;
  const started = evalInPortal(startCode);
  console.log('Retorno imediato:', started);

  // Acompanhar progresso
  while (true) {
    await sleep(2000);
    const prog = evalInPortal(`(window._progress || '0/10') + '|' + (window._differentialDone ? 'DONE' : 'RUNNING')`);
    console.log('Progresso:', prog);
    if (prog.endsWith('DONE')) break;
  }

  // Ler resultados
  const count = evalInPortal(`window._differentialResults?.length || 0`);
  console.log('Total de resultados em memória:', count);
  const sampleRes = evalInPortal(`JSON.stringify(window._differentialResults.slice(0, 2))`);
  console.log('Amostra de 2 resultados lida com sucesso!');
}

testBg().catch(console.error);
