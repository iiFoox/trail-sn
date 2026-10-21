/** Bundle para rodar a bateria dentro de uma aba logada da instância (console/devtools). */
import { FetchRestClient, detectAccess, investigate, previewChange, fieldMap, type Grade } from '../../../packages/core/src/index';
import cases from '../cases.json';

const order: Grade[] = ['candidate', 'probable', 'confirmed'];

function makeClient() {
  const w = window as unknown as { g_ck?: string };
  const z = window as unknown as { g_user_timezone?: string; g_tz?: string };
  return new FetchRestClient({ baseUrl: location.origin, getToken: async () => w.g_ck ?? null, concurrency: 6, getTimeZone: async () => z.g_user_timezone || z.g_tz });
}

/** Investiga um alvo e devolve um resumo compacto (para conferir rastro, rótulos e evidências). */
export async function runOne(target: { table: string; number?: string; sysId?: string; field: string }): Promise<unknown> {
  const t0 = performance.now();
  const r = await investigate(makeClient(), target);
  return {
    ms: Math.round(performance.now() - t0), calls: r.timing.calls, title: r.target.title, labels: r.labels, gaps: r.gaps, pingPong: r.pingPong, auditFrom: r.auditFrom, fieldNotInHistory: r.fieldNotInHistory,
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

export interface DifferentialTarget {
  id: string;
  table: string;
  sysId: string;
  field: string;
  auditCount?: number;
}

export interface DifferentialItem {
  id: string;
  table: string;
  sysId: string;
  field: string;
  auditCount?: number;
  ok: boolean;
  error?: string;
  errorType?: string;
  ms: number;
  calls: number;
  auditFrom?: string;
  fieldNotInHistory?: boolean;
  historyFields?: string[];
  changeCount: number;
  access?: Record<string, string>;
  changes: Array<{
    at: string;
    oldvalue: string;
    newvalue: string;
    user: string;
    topEvidence?: {
      type: string;
      grade: string;
      score: number;
      artifactName: string;
      facts: Array<{ kind: string; points: number }>;
    } | null;
  }>;
}

/** Executa uma bateria diferencial gravando métricas detalhadas de cada alvo. */
export async function runDifferential(
  alvos: DifferentialTarget[],
  onProgress?: (done: number, total: number, item: DifferentialItem) => void,
  concurrency = 1,
): Promise<{ access: string; denied: string[]; results: DifferentialItem[]; totalMs: number; medianMs: number }> {
  const client = makeClient();
  const acc = await detectAccess(client);
  const results: DifferentialItem[] = [];
  (globalThis as any)._differentialResults = results;
  (globalThis as any)._differentialDone = false;
  const tStart = performance.now();

  let nextIdx = 0;
  async function worker() {
    while (nextIdx < alvos.length) {
      const idx = nextIdx++;
      const target = alvos[idx];
      const t0 = performance.now();
      const callsBefore = client.calls;
      let ok = false;
      let error: string | undefined;
      let errorType: string | undefined;
      let r: any;

      try {
        r = await investigate(client, { table: target.table, sysId: target.sysId, field: target.field });
        ok = true;
      } catch (err: any) {
        error = err?.message || String(err);
        errorType = err?.name || 'Error';
      }
      const ms = Math.round(performance.now() - t0);
      const calls = client.calls - callsBefore;

      const item: DifferentialItem = {
        id: target.id,
        table: target.table,
        sysId: target.sysId,
        field: target.field,
        auditCount: target.auditCount,
        ok,
        ...(error ? { error, errorType } : {}),
        ms,
        calls,
        auditFrom: r?.auditFrom,
        fieldNotInHistory: r?.fieldNotInHistory,
        historyFields: r?.historyFields,
        changeCount: r?.changes?.length || 0,
        access: r?.access,
        changes: (r?.changes || []).map((c: any) => ({
          at: c.at,
          oldvalue: c.oldValue ?? '',
          newvalue: c.newValue ?? '',
          user: c.user ?? '',
          topEvidence: c.evidence?.[0]
            ? {
                type: c.evidence[0].type,
                grade: c.evidence[0].grade,
                score: c.evidence[0].score,
                artifactName: c.evidence[0].artifact?.name ?? '',
                facts: (c.evidence[0].facts || []).map((f: any) => ({ kind: f.kind, points: f.points })),
              }
            : null,
        })),
      };

      results.push(item);
      const done = results.length;
      (globalThis as any)._progress = `${done}/${alvos.length} (${Math.round((done / alvos.length) * 100)}%)`;
      if (onProgress) onProgress(done, alvos.length, item);
    }
  }

  const workers = Array.from({ length: Math.max(1, concurrency) }, () => worker());
  await Promise.all(workers);

  (globalThis as any)._differentialDone = true;
  const totalMs = Math.round(performance.now() - tStart);
  const sortedMs = [...results.map((x) => x.ms)].sort((a, b) => a - b);
  const medianMs = sortedMs[Math.floor(sortedMs.length / 2)] || 0;

  return {
    access: acc.level,
    denied: acc.denied,
    results,
    totalMs,
    medianMs,
  };
}

export async function preview(t: { table: string; sysId: string; field: string; value: string }): Promise<unknown> { return previewChange(makeClient(), t); }

export async function map(t: { table: string; field: string }): Promise<unknown> { return fieldMap(makeClient(), t); }
