import { describe, expect, it } from 'vitest';
import { investigate, type MetaCache } from '../src/investigate';
import type { TableMeta } from '../src/signatures';
import { INC, T0, audit, br, build, formTx, scenario, shiftStr } from './fixtures/builder';

/**
 * Achado do Codex na caça de uso real (26/10/2026): uma BR before [PT] reescreveu short_description e foi desativada
 * logo depois; a investigação, feita em seguida, só lia regras ativas e não a apontou. E o cache de metadados (10 min na
 * extensão) escondia uma regra criada ou ativada depois de guardado.
 */
const REWRITE = "current.setValue('short_description', '[PT] BR reescreveu');";

function rewritten(ruleUpdatedAt: string) {
  const s = scenario();
  audit(s, 'short_description', '[PT] antes', '[PT] BR reescreveu', T0, 'admin', 11);
  formTx(s, T0, 'admin', { short_description: '[PT] Form pediu outro valor' });
  const rule = br(s, '[PT] Reescreve short_description', 'before', REWRITE);
  rule.active = 'false';
  rule.sys_updated_on = ruleUpdatedAt;
  return { s, rule };
}

describe('regra desativada depois da mudança', () => {
  it('entra como suspeita, com o aviso de que está desativada hoje', async () => {
    const { s, rule } = rewritten(shiftStr(T0, 23));
    const r = await investigate(build(s), { table: 'incident', number: INC.number, field: 'short_description' });
    const e = r.changes[0]!.evidence[0]!;
    expect([e.type, e.artifact.sysId]).toEqual(['br_before', rule.sys_id]);
    expect(e.gaps.join(' ')).toContain('desativado hoje');
  });

  it('regra desativada antes da mudança não conta', async () => {
    const { s, rule } = rewritten(shiftStr(T0, -3600));
    const r = await investigate(build(s), { table: 'incident', number: INC.number, field: 'short_description' });
    expect(r.changes[0]!.evidence.some((e) => e.artifact.sysId === rule.sys_id)).toBe(false);
  });
});

describe('cache de metadados confere se alguma regra mudou', () => {
  const memo = (): MetaCache & { store: Map<string, TableMeta> } => {
    const store = new Map<string, TableMeta>();
    return { store, get: async (t) => store.get(t), set: async (t, m) => { store.set(t, m); } };
  };

  it('regra ativada depois de guardar o cache entra na investigação seguinte', async () => {
    const s = scenario();
    audit(s, 'short_description', '[PT] antes', '[PT] BR reescreveu', T0, 'admin', 11);
    formTx(s, T0, 'admin', { short_description: '[PT] Form pediu outro valor' });
    const cache = memo();
    await investigate(build(s), { table: 'incident', number: INC.number, field: 'short_description' }, {}, cache);
    expect(cache.store.get('incident')?.loadedAt).toBeTruthy();
    const rule = br(s, '[PT] Reescreve short_description', 'before', REWRITE);
    rule.sys_updated_on = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const r = await investigate(build(s), { table: 'incident', number: INC.number, field: 'short_description' }, {}, cache);
    expect(r.changes[0]!.evidence[0]!.artifact.sysId).toBe(rule.sys_id);
  });

  it('sem regra alterada, o cache vale e as regras não são lidas de novo', async () => {
    const s = scenario();
    audit(s, 'short_description', 'a', 'b', T0, 'admin', 1);
    const cache = memo();
    await investigate(build(s), { table: 'incident', number: INC.number, field: 'short_description' }, {}, cache);
    const c = build(s);
    const before = c.log.length;
    await investigate(c, { table: 'incident', number: INC.number, field: 'short_description' }, {}, cache);
    const rules = c.log.slice(before).filter((x) => x.table === 'sys_script').map((x) => x.query);
    expect(rules.some((q) => q.includes('active=true'))).toBe(false);
    expect(rules.filter((q) => !q.includes('active='))).toHaveLength(1);
  });
});

describe('client script desativado depois da mudança', () => {
  it('onChange que preencheu o campo no formulário aparece, com o aviso', async () => {
    const s = scenario();
    audit(s, 'short_description', '[PT] a', '[PT] onChange', T0, 'admin', 12);
    audit(s, 'description', 'antes', '[PT] Descricao preenchida pelo client script', T0, 'admin', 12);
    formTx(s, T0, 'admin', { short_description: '[PT] onChange', description: '[PT] Descricao preenchida pelo client script' });
    const cs = { sys_id: 'bae73debc3c853101cbdb8e1b40131f3', name: '[PT] Preenche Descricao', type: 'onChange', field: 'short_description', table: 'incident', ui_type: '0', active: 'false', sys_updated_on: shiftStr(T0, 30),
      script: "function onChange(control, oldValue, newValue) { if (newValue.indexOf('[PT]') === 0) g_form.setValue('description', '[PT] Descricao preenchida pelo client script'); }" };
    const c = build(s);
    c.rows('sys_script_client', [cs]);
    const r = await investigate(c, { table: 'incident', number: INC.number, field: 'description' });
    const e = r.changes[0]!.evidence.find((x) => x.artifact.sysId === cs.sys_id);
    expect(e?.type).toBe('client_script');
    expect(e?.gaps.join(' ')).toContain('desativado hoje');
    const top = r.changes[0]!.evidence[0]!;
    if (top.type === 'user_action') expect(top.grade).not.toBe('confirmed');
  });
});
