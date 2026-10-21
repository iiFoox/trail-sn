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
