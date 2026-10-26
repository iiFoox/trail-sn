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
});
