/**
 * Bateria de regressão contra a instância viva (PDI).
 *
 *   TRAIL_INSTANCE=https://devXXXXXX.service-now.com TRAIL_USER=admin TRAIL_PASS=... npm run regression
 *
 * Usa autenticação básica (só aqui, nos testes; a extensão usa a sessão do navegador).
 * Falha se algum caso não bater ou se a mediana de tempo passar de 3 s. Nada é gravado na instância.
 * Opcional: TRAIL_IMPERSONATE=pericia.itil roda como outro usuário via sysparm... (não suportado pela
 * Table API; para perfis, use TRAIL_USER/TRAIL_PASS do próprio perfil).
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { FetchRestClient, detectAccess, investigate, type Grade, type Investigation } from '../../packages/core/src/index';

interface Case {
  id: string; table: string; number: string; field: string;
  expectedType?: string; expectedName?: string; minGrade?: Grade; expectUnaudited?: boolean;
}

const here = dirname(fileURLToPath(import.meta.url));
const instance = process.env.TRAIL_INSTANCE;
const user = process.env.TRAIL_USER;
const pass = process.env.TRAIL_PASS;
if (!instance || !user || !pass) {
  console.error('Defina TRAIL_INSTANCE, TRAIL_USER e TRAIL_PASS.');
  process.exit(2);
}

const basic = 'Basic ' + Buffer.from(`${user}:${pass}`).toString('base64');
const fetchImpl: typeof fetch = (input, init) => {
  const headers = new Headers(init?.headers);
  headers.set('Authorization', basic);
  headers.delete('X-UserToken'); // básico dispensa o token
  return fetch(input, { ...init, headers, credentials: 'omit' });
};
const client = new FetchRestClient({ baseUrl: instance, getToken: async () => null, fetchImpl, concurrency: 6 });

const order: Grade[] = ['candidate', 'probable', 'confirmed'];
const cases = JSON.parse(readFileSync(resolve(here, 'cases.json'), 'utf8')) as Case[];
const results: { id: string; ok: boolean; ms: number; detail: string }[] = [];

const access = await detectAccess(client);
console.log(`Acesso: ${access.level}${access.denied.length ? ' (negado: ' + access.denied.join(', ') + ')' : ''}`);

for (const c of cases.filter((x) => !(x as { pending?: boolean }).pending)) {
  const t0 = Date.now();
  let detail = '';
  let ok = false;
  let r: Investigation | undefined;
  try {
    r = await investigate(client, { table: c.table, number: c.number, field: c.field });
    if (c.expectUnaudited) {
      ok = !!r.unaudited;
      detail = r.unaudited ? `${r.unaudited.count} atualização(ões) sem auditoria` : 'nenhuma atualização sem auditoria detectada';
    } else {
      const top = r.changes[0]?.evidence[0];
      const typeOk = top?.type === c.expectedType;
      const nameOk = !c.expectedName || (top?.artifact.name ?? '').includes(c.expectedName);
      const gradeOk = !c.minGrade || (top ? order.indexOf(top.grade) >= order.indexOf(c.minGrade) : false);
      ok = typeOk && nameOk && gradeOk;
      detail = top ? `${top.type} ${top.grade} ${top.score} "${top.artifact.name}"` : 'sem evidência';
      if (!typeOk) detail += ` (esperado ${c.expectedType})`;
    }
  } catch (e) {
    detail = `erro: ${(e as Error).message}`;
  }
  const ms = Date.now() - t0;
  results.push({ id: c.id, ok, ms, detail });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${c.id.padEnd(12)} ${String(ms).padStart(5)} ms  ${detail}${r ? `  [${r.timing.calls} chamadas]` : ''}`);
}

const times = results.map((r) => r.ms).sort((a, b) => a - b);
const median = times[Math.floor(times.length / 2)] ?? 0;
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} casos OK · mediana ${median} ms`);

const outDir = resolve(here, 'results');
mkdirSync(outDir, { recursive: true });
writeFileSync(resolve(outDir, `${new Date().toISOString().replace(/[:.]/g, '-')}.json`), JSON.stringify({ instance, user, access, results, median }, null, 2));

if (failed || median > 3000) process.exit(1);
