import { describe, expect, it } from 'vitest';
import { investigate } from '../src/investigate';
import { otherRecordWrite } from '../src/util';
import { INC, T0, audit, br, build, id, scenario, tx } from './fixtures/builder';

/**
 * Achado do Codex na caça de uso real (26/10/2026): uma BR [PT] do pai gravou a descrição do filho por GlideRecord ao
 * salvar o pai. O filho não tem gravação própria; o Trail deixava a regra como candidata fraca, ao lado de um job.
 */
const PARENT = id();
const CHILD_SCRIPT = (table: string) => `var gr = new GlideRecord('incident');\nif (gr.get('${INC.sysId}')) {\n  gr.description = '[PT] Cascade da BR para filho';\n  gr.update();\n}\n// ${table}`;

function cascade(parentTable: string) {
  const s = scenario();
  audit(s, 'description', '[PT] antes', '[PT] Cascade da BR para filho', T0, 'admin', 2);
  tx(s, T0, 'form', `/${parentTable}.do?sys_row=0&${parentTable}.short_description=[PT] Cascade parent&sys_uniqueValue=${PARENT}&sys_action=sysverb_update`, 'admin');
  return s;
}

describe('regra de outro registro que grava neste (pai → filho)', () => {
  it('reconhece a gravação de outro registro na URL', () => {
    expect(otherRecordWrite(`/incident.do?x=1&sys_uniqueValue=${PARENT}`, INC.sysId)).toEqual({ table: 'incident', sysId: PARENT });
    expect(otherRecordWrite(`/api/now/table/problem/${PARENT}?x`, INC.sysId)).toEqual({ table: 'problem', sysId: PARENT });
    expect(otherRecordWrite(`/incident.do?sys_uniqueValue=${INC.sysId}`, INC.sysId)).toBeNull();
    expect(otherRecordWrite(`/incident.do?sys_id=${PARENT}`, INC.sysId)).toBeNull();
  });

  it('mesma tabela: a BR do pai é a causa no filho, acima de job ou processo desconhecido', async () => {
    const s = cascade('incident');
    const rule = br(s, '[PT] Cascata pai para filho', 'before', CHILD_SCRIPT('incident'));
    const r = await investigate(build(s), { table: 'incident', number: INC.number, field: 'description' });
    const e = r.changes[0]!.evidence[0]!;
    expect([e.type, e.artifact.sysId]).toEqual(['br_other_record', rule.sys_id]);
    expect(e.grade).not.toBe('candidate');
    expect(e.gaps.join(' ')).toContain('não foram avaliadas');
  });

  it('outra tabela (problema que atualiza o incidente): a regra vem da tabela do registro salvo', async () => {
    const s = cascade('problem');
    const c = build(s);
    const rule = { sys_id: id(), name: '[PT] Problema atualiza incidentes', when: 'after', order: '100', collection: 'problem', script: CHILD_SCRIPT('problem'), condition: '', filter_condition: '', active: 'true', action_update: 'true', action_insert: 'false' };
    c.rows('sys_script', [...s.brs, rule]);
    const r = await investigate(c, { table: 'incident', number: INC.number, field: 'description' });
    expect(r.changes[0]!.evidence[0]!.artifact.sysId).toBe(rule.sys_id);
  });

  it('regra que não abre esta tabela por GlideRecord não entra', async () => {
    const s = cascade('incident');
    br(s, '[PT] Só cita o campo', 'before', "current.description = '[PT] Cascade da BR para filho';");
    const r = await investigate(build(s), { table: 'incident', number: INC.number, field: 'description' });
    expect(r.changes[0]!.evidence.some((e) => e.type === 'br_other_record')).toBe(false);
  });
});

describe('leitura do filho pela API depois da cascata', () => {
  it('GET /api/now/table/incident/<filho> 12 s depois não esconde a regra do pai', async () => {
    const s = cascade('incident');
    const rule = br(s, '[PT] Cascata pai para filho', 'before', CHILD_SCRIPT('incident'));
    tx(s, '2026-10-18 01:37:12', 'rest', `/api/now/table/incident/${INC.sysId}`, 'admin');
    const r = await investigate(build(s), { table: 'incident', number: INC.number, field: 'description' });
    const e = r.changes[0]!.evidence[0]!;
    expect([e.type, e.artifact.sysId]).toEqual(['br_other_record', rule.sys_id]);
  });
});

describe('desempate entre regras de outro registro', () => {
  it('a que cita este registro pelo sys_id fica na frente', async () => {
    const s = cascade('incident');
    br(s, '[PT] Genérica', 'before', "var gr = new GlideRecord('incident'); gr.addQuery('parent_incident', current.sys_id); gr.query(); while (gr.next()) { gr.description = 'x'; gr.update(); }");
    const exact = br(s, '[PT] Exata', 'before', CHILD_SCRIPT('incident').replace("'[PT] Cascade da BR para filho'", 'current.description'));
    const r = await investigate(build(s), { table: 'incident', number: INC.number, field: 'description' });
    expect(r.changes[0]!.evidence[0]!.artifact.sysId).toBe(exact.sys_id);
  });
});

describe('regras que não gravam outro registro', () => {
  it('reabre só o próprio registro salvo (gr.get(current.sys_id)): fora', async () => {
    const s = cascade('incident');
    br(s, '[PT] F2 async varios', 'async_always', "var gr = new GlideRecord('incident');\nif (gr.get(current.sys_id) && gr.description != 'F2 async') { gr.description = 'F2 async'; gr.update(); }");
    const r = await investigate(build(s), { table: 'incident', number: INC.number, field: 'description' });
    expect(r.changes[0]!.evidence.some((e) => e.type === 'br_other_record')).toBe(false);
  });

  it('grava outro valor fixo: fica descartada', async () => {
    const s = cascade('incident');
    br(s, '[PT] Outro valor', 'before', "var gr = new GlideRecord('incident'); gr.addQuery('parent_incident', current.sys_id); gr.query(); while (gr.next()) { gr.setValue('description', 'outro texto'); gr.update(); }");
    const r = await investigate(build(s), { table: 'incident', number: INC.number, field: 'description' });
    const e = r.changes[0]!.evidence.find((x) => x.type === 'br_other_record')!;
    expect(e.facts.map((f) => f.kind)).toContain('sets_other_value');
    expect(e.grade).toBe('candidate');
  });
});
