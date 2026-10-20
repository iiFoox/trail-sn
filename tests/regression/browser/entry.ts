/** Bundle para rodar a bateria dentro de uma aba logada da instância (console/devtools). */
import { FetchRestClient, detectAccess, investigate, type Grade } from '../../../packages/core/src/index';
import cases from '../cases.json';

const order: Grade[] = ['candidate', 'probable', 'confirmed'];

function makeClient() {
  const w = window as unknown as { g_ck?: string };
  return new FetchRestClient({ baseUrl: location.origin, getToken: async () => w.g_ck ?? null, concurrency: 6 });
}

/** Investiga um alvo e devolve um resumo compacto (para conferir rastro, rótulos e evidências). */
export async function runOne(target: { table: string; number?: string; sysId?: string; field: string }): Promise<unknown> {
  const t0 = performance.now();
  const r = await investigate(makeClient(), target);
  return {
    ms: Math.round(performance.now() - t0), calls: r.timing.calls, title: r.target.title, labels: r.labels, gaps: r.gaps,
    conflicts: (r.conflicts ?? []).map((k) => `${k.overlap} ${k.a.name}=${k.a.values[0]} x ${k.b.name}=${k.b.values[0]} vence:${k.winner ?? '?'}`),
    unaudited: r.unaudited, changes: r.changes.slice(0, 10).map((c) => ({
      at: c.at, old: c.oldValue, neu: c.newValue, cp: c.checkpoint, user: c.user, notes: c.notes,
      ev: c.evidence.slice(0, 3).map((e) => `${e.type} ${e.grade} ${e.score} "${e.artifact.name}" {${e.facts.map((f) => f.kind + (f.points >= 0 ? '+' : '') + f.points).join(' ')}}`),
      trace: c.trace.map((t) => `${t.at.slice(11)} ${t.kind}${t.cause ? '*' : ''} ${t.label || ''}${t.sent !== undefined ? ' sent=' + t.sent : ''}${t.fields ? ' [' + t.fields.map((f) => f.field).join(',') + ']' : ''}${t.ref ? ' ->' + t.ref.table : ''}`),
    })),
  };
}

export async function runCases(list: any[]): Promise<unknown> {
  return runRegression(list);
}

export async function runRegression(list: any[] = cases as any[]): Promise<unknown> {
  const client = makeClient();
  const access = await detectAccess(client);
  const results = [];
  for (const c of list.filter((x) => !x.pending)) {
    const t0 = performance.now();
    let detail = '', ok = false, calls = 0;
    try {
      // Casos gerados: o registro vem pelo short_description (sys_id muda a cada montagem).
      if (c.sd && !c.sysId) c.sysId = (await client.query({ table: c.table, query: `short_description=${c.sd}`, fields: ['sys_id'], limit: 1 })).rows[0]?.sys_id;
      const r = await investigate(client, c.sysId ? { table: c.table, sysId: c.sysId, field: c.field } : { table: c.table, number: c.number, field: c.field });
      calls = r.timing.calls;
      if (c.expectUnaudited) { ok = !!r.unaudited; detail = r.unaudited ? `${r.unaudited.count} sem auditoria` : 'nada detectado'; }
      else {
        const ch = r.changes[c.changeIndex ?? 0];
        const top = ch?.evidence[0];
        ok = top?.type === c.expectedType && (!c.expectedName || (top?.artifact.name ?? '').includes(c.expectedName)) && (!c.minGrade || (top ? order.indexOf(top.grade) >= order.indexOf(c.minGrade) : false));
        detail = top ? `${top.type} ${top.grade} ${top.score} "${top.artifact.name}"` : 'sem evidência';
        if (top?.type !== c.expectedType) detail += ` (esperado ${c.expectedType})`;
        if (!ok && top) detail += ' | outros: ' + ch!.evidence.slice(1, 4).map((e) => `${e.type}:${e.score}`).join(', ');
      }
    } catch (e) { detail = 'erro: ' + (e as Error).message; }
    const ms = Math.round(performance.now() - t0);
    if (c.maxMs && ms > c.maxMs) { ok = false; detail += ` (lento: ${ms} ms)`; }
    results.push({ id: c.id, ok, ms, calls, detail });
    (globalThis as { _progress?: string })._progress = `${results.length}/${list.length}`;
  }
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  return { access: access.level, denied: access.denied, results, median: ms[Math.floor(ms.length / 2)] };
}
export const allCases = cases as any[];
