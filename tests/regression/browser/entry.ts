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
    unaudited: r.unaudited, changes: r.changes.slice(0, 3).map((c) => ({
      at: c.at, old: c.oldValue, neu: c.newValue, cp: c.checkpoint, user: c.user, notes: c.notes,
      ev: c.evidence.slice(0, 3).map((e) => `${e.type} ${e.grade} ${e.score} "${e.artifact.name}"`),
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
  }
  const ms = results.map((r) => r.ms).sort((a, b) => a - b);
  return { access: access.level, denied: access.denied, results, median: ms[Math.floor(ms.length / 2)] };
}
