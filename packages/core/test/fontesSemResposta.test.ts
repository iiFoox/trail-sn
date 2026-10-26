import { describe, expect, it } from 'vitest';
import { tableAutomations } from '../src/automations';
import { scanTableConflicts } from '../src/conflicts';
import { fieldMap } from '../src/fieldMap';
import { fieldRules } from '../src/fieldDeps';
import { recordFlows } from '../src/flows';
import { previewChange } from '../src/preview';
import { recordTimeline } from '../src/timeline';
import { INC, T0, audit, build, scenario } from './fixtures/builder';

/**
 * Caça de defeitos da 1.4.6 no PDI: com dois 500 seguidos em sys_db_object, os módulos fora da investigação perdiam a
 * hierarquia (e com ela o que vem de task) sem aviso; e uma fonte que não respondia virava lista vazia calada.
 */
function hierarchyFlaky(fails: number) {
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
  return c;
}

const sysScriptQuery = (c: ReturnType<typeof build>) => c.log.filter((x) => x.table === 'sys_script').map((x) => x.query).join(' | ');

describe('hierarquia com uma falha: o passo repete e acha task', () => {
  it('mapa do campo', async () => {
    const c = hierarchyFlaky(1);
    const r = await fieldMap(c, { table: 'incident', field: 'state' });
    expect(r.tables).toEqual(['incident', 'task']);
    expect(r.missing).toBeUndefined();
  });
  it('automações, flows, conflitos, prévia e linha do tempo', async () => {
    expect((await tableAutomations(hierarchyFlaky(1), { table: 'incident' })).access).toBeDefined();
    let c = hierarchyFlaky(1);
    await tableAutomations(c, { table: 'incident' });
    expect(sysScriptQuery(c)).toContain('incident,task');
    c = hierarchyFlaky(1);
    expect((await scanTableConflicts(c, 'incident')).tables).toEqual(['incident', 'task']);
    c = hierarchyFlaky(1);
    await recordFlows(c, { table: 'incident', sysId: INC.sysId });
    expect(c.log.filter((x) => x.table === 'sys_db_object' && x.query === 'name=task')).toHaveLength(1);
    c = hierarchyFlaky(1);
    await previewChange(c, { table: 'incident', sysId: INC.sysId, field: 'state', value: '2' });
    expect(sysScriptQuery(c)).toContain('incident,task');
    c = hierarchyFlaky(1);
    await recordTimeline(c, { table: 'incident', sysId: INC.sysId });
    expect(c.log.filter((x) => x.table === 'sys_db_object' && x.query === 'name=task')).toHaveLength(1);
  });
});

describe('hierarquia sem resposta nas duas tentativas: aparece como fonte que faltou', () => {
  it('mapa, conflitos, automações e prévia avisam', async () => {
    expect((await fieldMap(hierarchyFlaky(9), { table: 'incident', field: 'state' })).missing).toContain('sys_db_object');
    expect((await scanTableConflicts(hierarchyFlaky(9), 'incident')).missing).toContain('sys_db_object');
    expect((await tableAutomations(hierarchyFlaky(9), { table: 'incident' })).missing).toContain('sys_db_object');
    expect((await previewChange(hierarchyFlaky(9), { table: 'incident', sysId: INC.sysId, field: 'state', value: '2' })).missing).toContain('sys_db_object');
  });
  it('regras do campo: a hierarquia vira fonte lenta', async () => {
    const r = await fieldRules(hierarchyFlaky(9), { table: 'incident', field: 'state' });
    expect(r.slow).toContain('sys_db_object');
  });
});

describe('fonte com 500: não passa calada', () => {
  it('mapa do campo com sys_script em 500', async () => {
    const s = scenario();
    const c = build(s).respond('sys_script', () => ({ rows: [], status: 500, access: 'unknown' }));
    expect((await fieldMap(c, { table: 'incident', field: 'state' })).missing).toEqual(['sys_script']);
  });
  it('regras do campo com sys_script em 500: fonte lenta', async () => {
    const c = build(scenario()).respond('sys_script', () => ({ rows: [], status: 500, access: 'unknown' }));
    expect((await fieldRules(c, { table: 'incident', field: 'state' })).slow).toContain('sys_script');
  });
});
