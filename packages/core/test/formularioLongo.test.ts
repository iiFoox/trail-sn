import { describe, expect, it } from 'vitest';
import { investigate } from '../src/investigate';
import { formSent } from '../src/util';
import { INC, T0, audit, br, build, scenario, shiftStr, tx } from './fixtures/builder';

/**
 * Achado do dono no PDI (26/10/2026): comentário acrescentado num script include de 1.914 caracteres. A instância guarda
 * a URL do formulário já decodificada e corta cada valor em 999 caracteres + "...". O Trail lia isso como "o formulário
 * enviou outro valor" e culpava uma BR before que só cita o campo. E a leitura dos pontos de depuração do editor
 * (/api/now/js/debugpoints/...) aparecia no rastro como "Gravação via API".
 */
const script = (extra: string) => Array.from({ length: 60 }, (_, i) => `    var linha${i} = 'texto ' + ${i};${i === 3 ? extra : ''}`).join('\r\n');
const OLD = script('');
const NEW = script('\r\n\t\t//quero cagar');
/** URL como a instância guarda: valores decodificados, cortados em 999 + "...". */
const formUrl = (field: string, value: string) => {
  const cut = (v: string) => (v.length > 999 ? v.slice(0, 999) + '...' : v);
  return `/incident.do?sys_row=0&sys_original.incident.${field}=${cut(OLD)}&incident.${field}=${cut(value)}&sysparm_encoded_record&sys_uniqueValue=${INC.sysId}&sys_action=sysverb_update`;
};

describe('valor enviado pelo formulário: corte de 999 + "..." e URL decodificada', () => {
  it('formSent tira os "..." e marca o corte; "+" continua "+"', () => {
    const s = formSent(formUrl('description', NEW), 'incident', 'description', NEW)!;
    expect(s.cut).toBe(true);
    expect(s.value).toBe(NEW.slice(0, 999));
    expect(s.value).toContain(" + 1;");
  });

  it('mudança num texto longo pelo formulário: a pessoa, não a BR before que cita o campo', async () => {
    expect(NEW.length).toBeGreaterThan(1000);
    const s = scenario();
    audit(s, 'description', OLD, NEW, T0, 'admin', 7);
    tx(s, T0, 'form', formUrl('description', NEW), 'admin');
    br(s, 'Valida a descrição', 'before', "if (current.description.toString().indexOf('x') > 0) gs.addErrorMessage('x');");
    const r = await investigate(build(s), { table: 'incident', number: INC.number, field: 'description' });
    const e = r.changes[0]!.evidence[0]!;
    expect(e.type).toBe('user_action');
    expect(e.facts.map((f) => f.kind)).not.toContain('form_value_differs');
  });

  it('texto curto com "+" pela URL decodificada: o formulário enviou o novo valor', async () => {
    const s = scenario();
    audit(s, 'short_description', 'a', 'a + b', T0, 'admin', 2);
    tx(s, T0, 'form', `/incident.do?incident.short_description=a + b&sys_uniqueValue=${INC.sysId}&sys_action=sysverb_update`, 'admin');
    const r = await investigate(build(s), { table: 'incident', number: INC.number, field: 'short_description' });
    expect(r.changes[0]!.evidence[0]!.type).toBe('user_action');
  });

  it('pontos de depuração do editor de scripts não são "Gravação via API"', async () => {
    const s = scenario();
    audit(s, 'description', OLD, NEW, T0, 'admin', 7);
    tx(s, T0, 'form', formUrl('description', NEW), 'admin');
    tx(s, shiftStr(T0, 1), 'rest', `/api/now/js/debugpoints/script/incident/${INC.sysId}/script?`, 'admin');
    const r = await investigate(build(s), { table: 'incident', number: INC.number, field: 'description' });
    expect(r.changes[0]!.trace!.some((t) => t.kind === 'api')).toBe(false);
  });
});
