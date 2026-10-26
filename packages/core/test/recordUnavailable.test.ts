import { describe, expect, it } from 'vitest';
import { investigate } from '../src/investigate';
import { recordTimeline } from '../src/timeline';
import { RecordNotFoundError, RecordUnavailableError } from '../src/types';
import { INC, T0, audit, build, scenario } from './fixtures/builder';

/** Registro que responde com `first` na primeira consulta e com o registro de verdade (ou `then`) depois. */
function flaky(s: ReturnType<typeof scenario>, first: { status: number; access: 'timeout' | 'unknown' }, then?: { status: number; access: 'timeout' | 'unknown' }) {
  const c = build(s);
  let n = 0;
  c.respond('incident', () => {
    n++;
    if (n === 1) return { rows: [], ...first };
    if (then) return { rows: [], ...then };
    return [s.record];
  });
  return { c, count: () => n };
}

describe('registro indisponível não é registro inexistente', () => {
  it('erro 500 nas duas tentativas lança RecordUnavailableError (e repete a consulta uma vez)', async () => {
    const s = scenario();
    audit(s, 'state', '1', '2', T0, 'admin', 1);
    const { c, count } = flaky(s, { status: 500, access: 'unknown' }, { status: 500, access: 'unknown' });
    const err = await investigate(c, { table: 'incident', sysId: INC.sysId, field: 'state' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RecordUnavailableError);
    expect(err).not.toBeInstanceOf(RecordNotFoundError);
    expect((err as RecordUnavailableError).reason).toBe('error');
    expect((err as Error).message).toMatch(/^Record unavailable.*HTTP 500/);
    expect(count()).toBe(2);
  });

  it('prazo estourado nas duas tentativas lança RecordUnavailableError com motivo timeout', async () => {
    const s = scenario();
    const { c } = flaky(s, { status: 0, access: 'timeout' }, { status: 0, access: 'timeout' });
    const err = await investigate(c, { table: 'incident', number: INC.number, field: 'state' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(RecordUnavailableError);
    expect((err as RecordUnavailableError).reason).toBe('timeout');
  });

  it('a segunda tentativa salva a investigação quando a instância volta a responder', async () => {
    const s = scenario();
    audit(s, 'state', '1', '2', T0, 'admin', 1);
    const { c, count } = flaky(s, { status: 0, access: 'timeout' });
    const r = await investigate(c, { table: 'incident', sysId: INC.sysId, field: 'state' });
    expect(r.target.sysId).toBe(INC.sysId);
    expect(r.access.record).toBe('ok');
    expect(count()).toBe(2);
  });

  it('negado ou vazio continua RecordNotFoundError, sem segunda tentativa', async () => {
    const s = scenario();
    const c = build(s).deny('incident');
    await expect(investigate(c, { table: 'incident', sysId: INC.sysId, field: 'state' })).rejects.toBeInstanceOf(RecordNotFoundError);
    expect(c.log.filter((x) => x.table === 'incident')).toHaveLength(1);
    await expect(investigate(build(scenario()), { table: 'incident', number: 'INC9999999', field: 'state' })).rejects.toBeInstanceOf(RecordNotFoundError);
  });

  it('linha do tempo: mesma distinção', async () => {
    const s = scenario();
    const { c } = flaky(s, { status: 503, access: 'unknown' }, { status: 503, access: 'unknown' });
    await expect(recordTimeline(c, { table: 'incident', sysId: INC.sysId })).rejects.toBeInstanceOf(RecordUnavailableError);
    const ok = flaky(scenario(), { status: 0, access: 'timeout' });
    const tl = await recordTimeline(ok.c, { table: 'incident', sysId: INC.sysId });
    expect(tl.saves).toBeDefined();
    await expect(recordTimeline(build(scenario()).deny('incident'), { table: 'incident', sysId: INC.sysId })).rejects.toBeInstanceOf(RecordNotFoundError);
  });
});

describe('hierarquia da tabela sem resposta (1.4.6, M9 no PDI)', () => {
  /** sys_db_object do incident falha `fails` vezes (500 do balanceador) e depois responde que o pai é task. */
  function hierarchyFails(fails: number) {
    const s = scenario();
    audit(s, 'state', '1', '2', T0, 'admin', 1);
    const c = build(s);
    let n = 0;
    c.respond('sys_db_object', (req) => {
      if (req.query === 'name=incident' && n++ < fails) return { rows: [], status: 500, access: 'unknown' };
      if (req.query === 'name=incident') return [{ name: 'incident', 'super_class.name': 'task' }];
      if (req.query === 'name=task') return [{ name: 'task', 'super_class.name': '' }];
      return [];
    });
    const stored: unknown[] = [];
    const cache = { get: async () => undefined, set: async (_t: string, m: unknown) => { stored.push(m); } };
    return { c, cache, stored };
  }

  it('uma falha: repete o passo e acha task', async () => {
    const { c, cache, stored } = hierarchyFails(1);
    await investigate(c, { table: 'incident', sysId: INC.sysId, field: 'state' }, {}, cache);
    expect(c.log.find((x) => x.table === 'sys_script')?.query).toContain('collectionINincident,task');
    expect(stored).toHaveLength(1);
  });

  it('duas falhas: segue só com incident, mas os metadados não vão para o cache', async () => {
    const { c, cache, stored } = hierarchyFails(2);
    const r = await investigate(c, { table: 'incident', sysId: INC.sysId, field: 'state' }, {}, cache);
    expect(r.access.sys_db_object).toBe('timeout');
    expect(r.gaps).toContain('sys_db_object: timeout');
    expect(stored).toHaveLength(0);
  });
});

describe('fonte com uma consulta sem resposta (1.4.6, caça no PDI)', () => {
  it('uma janela de syslog_transaction com 500 e outra respondendo: a fonte entra nas lacunas', async () => {
    const s = scenario();
    audit(s, 'state', '1', '2', T0, 'admin', 1);
    audit(s, 'state', '2', '3', '2026-10-18 05:00:00', 'admin', 2);
    const c = build(s);
    let n = 0;
    c.respond('syslog_transaction', () => (n++ === 0 ? { rows: [], status: 500, access: 'unknown' } : []));
    const r = await investigate(c, { table: 'incident', sysId: INC.sysId, field: 'state' });
    expect(c.log.filter((x) => x.table === 'syslog_transaction').length).toBeGreaterThan(1);
    expect(r.gaps).toContain('syslog_transaction: timeout');
  });

  it('500 em sysevent (unknown) não passa calado', async () => {
    const s = scenario();
    audit(s, 'state', '1', '2', T0, 'admin', 1);
    const c = build(s);
    c.respond('sysevent', () => ({ rows: [], status: 500, access: 'unknown' }));
    const r = await investigate(c, { table: 'incident', sysId: INC.sysId, field: 'state' });
    expect(r.gaps).toContain('sysevent: timeout');
  });

  it('sysevent volta no máximo um dia em sys_created_on (revisão de carga antes da loja)', async () => {
    const s = scenario();
    audit(s, 'state', '1', '2', T0, 'admin', 1);
    const c = build(s);
    await investigate(c, { table: 'incident', sysId: INC.sysId, field: 'state' });
    const ev = c.log.filter((x) => x.table === 'sysevent');
    expect(ev.length).toBeGreaterThan(0);
    for (const e of ev) {
      const from = e.query.match(/sys_created_on>=([^^]+)/)![1]!;
      const to = e.query.match(/processed<=([^^]+)/)![1]!;
      expect(Date.parse(`${to}Z`) - Date.parse(`${from}Z`)).toBeLessThanOrEqual((86400 + 30) * 1000);
    }
  });
});

describe('regras de negócio com 500 (caça 1.4.6, 146d)', () => {
  it('repete, e se faltar de novo a fonte é lenta e os metadados não vão para o cache', async () => {
    const s = scenario();
    audit(s, 'state', '1', '2', T0, 'admin', 1);
    const c = build(s);
    let n = 0;
    c.respond('sys_script', () => { n++; return { rows: [], status: 500, access: 'unknown' }; });
    const stored: unknown[] = [];
    const cache = { get: async () => undefined, set: async (_t: string, m: unknown) => { stored.push(m); } };
    const r = await investigate(c, { table: 'incident', sysId: INC.sysId, field: 'state' }, {}, cache);
    expect(n).toBe(2);
    expect(r.gaps).toContain('sys_script: timeout');
    expect(stored).toHaveLength(0);
    expect(JSON.stringify(r.changes)).not.toContain('no_competing_automation');
  });
});
