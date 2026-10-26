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
