import { describe, expect, it } from 'vitest';
import { investigate } from '../src/investigate';
import { INC, T0, audit, build, formTx, scenario } from './fixtures/builder';

/**
 * Caça de uso real (26/10/2026): client script onSubmit que grava o campo ao salvar. Só os onChange contavam como
 * mecanismo identificado; com o onSubmit gravando exatamente o valor, a pessoa saía "confirmada".
 */
function withOnSubmit(value: string) {
  const s = scenario();
  audit(s, 'description', 'antes', '[PT] onSubmit 146n', T0, 'admin', 1);
  formTx(s, T0, 'admin', { short_description: '[PT] gatilho', description: '[PT] onSubmit 146n' });
  const c = build(s);
  const cs = { sys_id: 'd7838f6bc34493101cbdb8e1b40131ed', name: '[PT] onSubmit description', type: 'onSubmit', field: '', table: 'incident', ui_type: '0', active: 'true',
    script: `function onSubmit() {\n  g_form.setValue('description', '${value}');\n  return true;\n}` };
  c.rows('sys_script_client', [cs]);
  return { c, cs };
}

describe('client script onSubmit', () => {
  it('grava exatamente o valor enviado: a pessoa não fica confirmada sozinha', async () => {
    const { c, cs } = withOnSubmit('[PT] onSubmit 146n');
    const r = await investigate(c, { table: 'incident', number: INC.number, field: 'description' });
    const ev = r.changes[0]!.evidence;
    const user = ev.find((e) => e.type === 'user_action')!;
    expect(user.facts.map((f) => f.kind)).toContain('client_side_possible');
    expect(user.grade).not.toBe('confirmed');
    expect(ev.find((e) => e.artifact.sysId === cs.sys_id)!.grade).not.toBe('candidate');
  });

  it('grava outro valor: o script fica descartado e a pessoa segue confirmada', async () => {
    const { c } = withOnSubmit('outro texto');
    const r = await investigate(c, { table: 'incident', number: INC.number, field: 'description' });
    expect(r.changes[0]!.evidence[0]!.type).toBe('user_action');
    expect(r.changes[0]!.evidence[0]!.grade).toBe('confirmed');
  });

  // Zurich W9 (28/10/2026): onSubmit ativo no envio acrescentou um texto ao que a pessoa digitou e foi desligado logo
  // depois. O Trail lia o campo no navegador como o valor antigo (e `|| ''` como true), achava que o script gravava outro
  // valor e deixava a pessoa confirmada 80. No navegador o valor do campo antes do script não é conhecido.
  it('acrescenta texto ao valor do formulário (e foi desligado depois): a pessoa não fica confirmada', async () => {
    const s = scenario();
    const nv = '[PT] W9 CS text submitted with active onSubmit [PT] client Zurich';
    audit(s, 'description', '[PT] human W9 CS Zurich', nv, T0, 'admin', 1);
    formTx(s, T0, 'admin', { short_description: '[PT] W9-CS', description: nv });
    const c = build(s);
    c.rows('sys_script_client', [{ sys_id: '2c3c9d4847509310dda61af2e16d43f3', name: '[PT] W9 client descrição', type: 'onSubmit', field: 'description', table: 'incident', ui_type: '0', active: 'false', sys_updated_on: '2030-01-01 00:00:00',
      script: "var sd=g_form.getValue('short_description')||'';var d=g_form.getValue('description')||'';if ((sd.indexOf('[PT] W9-CS')===0||sd.indexOf('[PT] W9-BOTH')===0) && d.indexOf('[PT] client Zurich')<0) g_form.setValue('description',d+' [PT] client Zurich');" }]);
    const r = await investigate(c, { table: 'incident', number: INC.number, field: 'description' });
    const ev = r.changes[0]!.evidence;
    expect(ev[0]!.grade).not.toBe('confirmed');
    const cs = ev.find((e) => e.type === 'client_script')!;
    expect(cs.facts.map((f) => f.kind)).not.toContain('sets_other_value');
    expect(cs.grade).not.toBe('candidate');
    expect(ev.find((e) => e.type === 'user_action')!.facts.map((f) => f.kind)).toContain('client_side_possible');
  });
});
