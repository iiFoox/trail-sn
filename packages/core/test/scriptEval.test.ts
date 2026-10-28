import { describe, expect, it } from 'vitest';
import { evalExpr, scriptVerdict, writesOf, fieldsRead, type Env } from '../src/scriptEval';

const env = (o: Partial<Env> = {}): Env => ({ rec: { short_description: '[PT] F5-CALC', contact_type: 'email', impact: '3', category: 'inquiry', description: 'x' }, old: { contact_type: 'phone', impact: '3' }, changed: new Set(['contact_type']), ...o });
const br = (s: string) => `(function executeRule(current, previous) {\n${s}\n})(current, previous);`;

describe('avaliador de expressões', () => {
  it('campos, changes, comparação e concatenação', () => {
    expect(evalExpr("current.contact_type.changes()", env())).toBe(true);
    expect(evalExpr("current.impact.changes()", env())).toBe(false);
    expect(evalExpr("current.contact_type.changesTo('email')", env())).toBe(true);
    expect(evalExpr("current.contact_type.changesFrom('phone')", env())).toBe(true);
    expect(evalExpr("current.impact == 3", env())).toBe(true);
    expect(evalExpr("current.short_description + ' calc'", env())).toBe('[PT] F5-CALC calc');
    expect(evalExpr("current.short_description.indexOf('[PT] F5') == 0", env())).toBe(true);
    expect(evalExpr("g_form.getValue('short_description').indexOf('[PT] F2-CLIENT') != 0", env())).toBe(true);
    expect(evalExpr("current.urgency == 1", env())).toBeUndefined(); // campo que não temos
    expect(evalExpr("current.urgency == 1 && current.impact == 2", env())).toBe(false); // falso vence o desconhecido
    expect(evalExpr("gs.getUserName() == 'admin'", env())).toBeUndefined();
  });

  // Zurich W9: `g_form.getValue('description') || ''` virava true, e o script "gravava" "true [PT] client Zurich".
  it('|| devolve o operando, como no JavaScript', () => {
    expect(evalExpr("g_form.getValue('description') || ''", env())).toBe('x');
    expect(evalExpr("g_form.getValue('urgency') || 'pad'", env({ rec: { urgency: '' }, old: {}, changed: new Set() }))).toBe('pad');
    expect(evalExpr("g_form.getValue('urgency') || ''", env())).toBeUndefined();
    expect(evalExpr("current.urgency == 1 || current.impact == 3", env())).toBe(true); // verdadeiro vence o desconhecido
    expect(evalExpr("current.impact == 2 || current.category == 'x'", env())).toBe(false);
  });
});

describe('onde o script grava', () => {
  it('if de uma linha, bloco, else e return antecipado', () => {
    const s = br("if (current.contact_type.changes()) current.impact = 2;\nif (current.category == 'hardware') { current.urgency = 1; } else { current.urgency = 3; }");
    expect(writesOf(s, 'impact')!.writes[0]!.guards.map((g) => g.cond)).toEqual(['current.contact_type.changes()']);
    const u = writesOf(s, 'urgency')!.writes;
    expect(u.map((w) => w.guards.map((g) => (g.neg ? '!' : '') + g.cond))).toEqual([["current.category == 'hardware'"], ["!current.category == 'hardware'"]]);
    const c = "function onChange(control, oldValue, newValue, isLoading) {\n  if (isLoading || newValue === '') return;\n  if (g_form.getValue('short_description').indexOf('[PT] F5-CLIENT2') != 0) return;\n  g_form.setValue('impact', '2');\n}";
    expect(writesOf(c, 'impact')!.writes[0]!.guards.length).toBe(2);
  });
  it('veredito: condição falsa, valor calculado, só lê', () => {
    const e = env();
    expect(scriptVerdict(br("if (current.contact_type.changes()) current.description = current.short_description + ' calc';"), 'description', e)!.values).toEqual(['[PT] F5-CALC calc']);
    const guarded = scriptVerdict(br("var d = current.short_description;\nif (d.indexOf('[PT] C2') == 0) current.impact = 1;"), 'impact', e)!;
    expect(guarded.reachable).toBe(false);
    const reads = scriptVerdict(br("if (current.contact_type.changes()) current.urgency = 1;"), 'contact_type', e)!;
    expect(reads.writes).toBe(false);
    expect(reads.reachable).toBe(false);
    const client = "function onChange(control, oldValue, newValue, isLoading) {\n  if (isLoading) return;\n  var d = g_form.getValue('short_description');\n  if (d.indexOf('[PT] F2-CLIENT') == 0) { g_form.setValue('description', 'F2 client'); g_form.setValue('impact', '2'); }\n}";
    expect(scriptVerdict(client, 'impact', { ...e, newValue: 'email' })!.reachable).toBe(false);
    expect(scriptVerdict(br("current.impact.setValue(1);"), 'impact', e)!.values).toEqual(['1']);
    expect(scriptVerdict(br("// current.impact = 5;\nvar s = 'current.impact = 4';"), 'impact', e)!.writes).toBe(false);
  });
  it('campos lidos', () => {
    expect(fieldsRead("if (current.category == 'x' && g_form.getValue('short_description')) current.impact = previous.urgency;").sort()).toEqual(['category', 'impact', 'short_description', 'urgency']);
  });
});

import { sameVal } from '../src/util';
describe('mesmo valor', () => {
  it('booleanos e data/hora em outro fuso', () => {
    expect(sameVal('true', '1')).toBe(true);
    expect(sameVal('false', '0')).toBe(true);
    expect(sameVal('1', '0')).toBe(false);
    expect(sameVal('2026-12-01 10:00:00', '2026-12-01 18:00:00')).toBe(true);
    expect(sameVal('2026-12-01 10:00:00', '2026-12-01 18:00:07')).toBe(false);
    expect(sameVal('2026-12-01 10:00:00', '2026-12-03 10:00:00')).toBe(false);
  });
});


describe('identidade do registro e da sessão', () => {
  it('g_form.getUniqueValue(), current.getUniqueValue() e gs.getUserID()', () => {
    const env = { rec: { sys_id: 'abc' }, old: {}, changed: new Set<string>(), user: { sysId: 'u1', name: 'admin' } };
    expect(evalExpr("g_form.getUniqueValue() != 'abc'", env)).toBe(false);
    expect(evalExpr("current.getUniqueValue() == 'abc'", env)).toBe(true);
    expect(evalExpr("gs.getUserID() == 'u1' && gs.getUserName() == 'admin'", env)).toBe(true);
    expect(evalExpr("gs.getUserID() == 'u1'", { ...env, user: {} })).toBe(undefined);
  });
});

describe('campo HTML', () => {
  it('texto gravado pelo script = <p>texto</p> guardado pelo editor', () => {
    expect(sameVal('Possível falha DNS', '<p>Possível falha DNS</p>')).toBe(true);
    expect(sameVal('outra coisa', '<p>Possível falha DNS</p>')).toBe(false);
  });
});

describe('avaliação parcial', () => {
  const env = { rec: { a: '1', b: '' }, old: {}, changed: new Set<string>() };
  it('&& com uma parte falsa é falso mesmo com trecho desconhecido', () => {
    expect(evalExpr("current.a == '2' && new Foo().bar(current.getTableName()) < 0", env)).toBe(false);
  });
  it('|| com uma parte verdadeira é verdadeiro', () => {
    expect(evalExpr("current.a == '1' || new Foo().bar()", env)).toBe(true);
  });
  it('sem parte decisiva continua desconhecido', () => {
    expect(evalExpr("current.a == '1' && new Foo().bar()", env)).toBeUndefined();
  });
  it('texto com && dentro de aspas não é dividido', () => {
    expect(evalExpr("current.a == 'x && y' && new Foo()", env)).toBe(false);
  });
});
