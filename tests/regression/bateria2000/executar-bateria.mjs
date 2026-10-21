// tests/regression/bateria2000/executar-bateria.mjs
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { evalInPortal } from './gerar-alvos.mjs';
import { injectBundle, injectTargets } from './injetar.mjs';
import { impersonate } from './testar-personificar.mjs';

const PORTAL = 'dev457034.service-now.com #2';
const ADMIN_SYS_ID = '6816f79cc0a8016401c5a33be04be441';
const ITIL_SYS_ID = '3fc011fdc3c4d3101cbdb8e1b401311c';
const BATCH_READ = 50;

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function preparePage() {
  console.log('Navegando portal para /incident_list.do para ambiente limpo...');
  execSync(`maestri portal navigate "${PORTAL}" "https://dev457034.service-now.com/incident_list.do"`, { encoding: 'utf8' });
  await sleep(6000);
  console.log('Injetando bundle e alvos...');
  injectBundle();
  injectTargets();
}

async function runPhaseBackground(phaseName, outputFile) {
  console.log(`\n[${phaseName}] Iniciando execução assíncrona de 1000 alvos na página...`);
  evalInPortal(`
    window._res = null;
    window._err = null;
    window._differentialDone = false;
    TrailRegression.runDifferential(window._allTargets, undefined, 2)
      .then(r => { window._res = r; window._differentialDone = true; })
      .catch(e => { window._err = String(e); window._differentialDone = true; });
    'started';
  `);

  let savedResults = [];
  let lastSavedCount = 0;
  const tStart = Date.now();

  while (true) {
    await sleep(4000);
    let status;
    try {
      status = evalInPortal(`(window._differentialResults?.length || 0) + '|' + (window._differentialDone ? 'DONE' : 'RUNNING') + '|' + (window._err || '')`);
    } catch (e) {
      console.warn(`[${phaseName}] Aviso na leitura de status (tentando novamente):`, e.message);
      continue;
    }

    const [countStr, state, errStr] = status.split('|');
    const currentCount = Number(countStr || 0);

    if (currentCount > lastSavedCount && (currentCount - lastSavedCount >= BATCH_READ || state === 'DONE')) {
      while (lastSavedCount < currentCount) {
        const nextSliceEnd = Math.min(currentCount, lastSavedCount + BATCH_READ);
        const sliceJson = evalInPortal(`JSON.stringify(window._differentialResults.slice(${lastSavedCount}, ${nextSliceEnd}))`);
        const slice = JSON.parse(sliceJson);
        savedResults.push(...slice);
        lastSavedCount = nextSliceEnd;
      }

      writeFileSync(outputFile, JSON.stringify(savedResults, null, 2), 'utf8');
      const elapsedSec = ((Date.now() - tStart) / 1000).toFixed(0);
      const pct = Math.round((savedResults.length / 1000) * 100);
      console.log(`[${phaseName}] Parcial salvo: ${savedResults.length}/1000 (${pct}%) em ${elapsedSec}s...`);
    }

    if (state === 'DONE') {
      if (errStr) console.error(`[${phaseName}] Erro ocorrido na página:`, errStr);
      if (lastSavedCount < currentCount) {
        const remainingJson = evalInPortal(`JSON.stringify(window._differentialResults.slice(${lastSavedCount}, ${currentCount}))`);
        savedResults.push(...JSON.parse(remainingJson));
        lastSavedCount = currentCount;
        writeFileSync(outputFile, JSON.stringify(savedResults, null, 2), 'utf8');
      }
      break;
    }
  }

  console.log(`[${phaseName}] Concluído com sucesso! Total gravado em ${outputFile}: ${savedResults.length} resultados.`);
  return savedResults;
}

async function main() {
  console.log('=== BATERIA 2000 (ADMIN x SEM ADMIN) ===');
  const tInicioGeral = Date.now();

  // 1. Verificar usuário inicial e garantir ADMIN
  console.log('\n--- ETAPA 1: Preparação do ADMIN ---');
  let user = evalInPortal(`fetch('/api/now/ui/user/current_user', {headers: {'X-UserToken': window.g_ck}}).then(r=>r.json()).then(d=>d.result.user_name)`);
  console.log('Usuário atual na aba:', user);
  if (user !== 'admin') {
    console.log('Personificando admin...');
    await impersonate(ADMIN_SYS_ID);
  }
  await preparePage();

  // 2. Executar 1000 alvos como ADMIN
  console.log('\n--- ETAPA 2: Executando 1000 investigações como ADMIN ---');
  const adminResults = await runPhaseBackground('ADMIN', 'tests/regression/bateria2000/res-admin.json');

  // 3. Personificar ITIL
  console.log('\n--- ETAPA 3: Personificando pt.trail.itil ---');
  const itilUser = await impersonate(ITIL_SYS_ID);
  if (itilUser !== 'pt.trail.itil') throw new Error(`Falha ao personificar pt.trail.itil: usuário é ${itilUser}`);
  await preparePage();

  // 4. Executar 1000 alvos como ITIL
  console.log('\n--- ETAPA 4: Executando 1000 investigações como ITIL ---');
  let itilResults;
  try {
    itilResults = await runPhaseBackground('ITIL', 'tests/regression/bateria2000/res-itil.json');
  } finally {
    // 5. REGRA OBRIGATÓRIA: SEMPRE RETORNAR AO ADMIN NO FINAL
    console.log('\n--- ETAPA 5: RETORNANDO OBRIGATORIAMENTE AO ADMIN ---');
    try {
      const backUser = await impersonate(ADMIN_SYS_ID);
      console.log('Confirmado retorno ao admin:', backUser);
    } catch (e) {
      console.error('ALERTA CRÍTICO: Erro ao retornar para admin:', e.message);
    }
  }

  // 6. Análise diferencial e geração de relatório
  console.log('\n--- ETAPA 6: Análise diferencial e geração do relatório ---');
  const { analisarEGerarRelatorio } = await import('./analisar.mjs');
  analisarEGerarRelatorio(adminResults, itilResults);

  const tempoTotalMin = ((Date.now() - tInicioGeral) / 60000).toFixed(1);
  console.log(`\n=== BATERIA 2000 CONCLUÍDA EM ${tempoTotalMin} MINUTOS! ===`);
}

main().catch(console.error);
