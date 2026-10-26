import { fact } from '../scoring';
import { escapeRegExp, otherRecordWrite, refsField, toMs } from '../util';
import { evidence, type ChangeContext } from './context';
import type { Evidence, Row } from '../types';

/**
 * Regra que roda ao salvar OUTRO registro e grava neste por GlideRecord: o pai que atualiza os filhos, o problema que
 * resolve os incidentes. Achado da caça de uso real (26/10/2026): o filho mudou no mesmo segundo em que admin salvou o
 * pai, sem gravação própria, e a regra do pai ficava como "candidata" sem ligação com a gravação do pai.
 *
 * Só entra quando esta mudança não tem gravação própria (o chamador garante) e outro registro foi salvo no instante.
 * As condições da regra valem para o outro registro, que o Trail não leu: ficam como lacuna.
 */
export function otherRecordRule(ctx: ChangeContext): Evidence[] {
  const at = toMs(ctx.at);
  const saves = ctx.traces.transactions
    .map((t) => ({ t, w: otherRecordWrite(t.url, ctx.sysId) }))
    .filter((x): x is { t: Row; w: { table: string; sysId: string } } => !!x.w && Math.abs(toMs(x.t.sys_created_on ?? '') - at) <= 3000);
  if (!saves.length) return [];
  const opens = (script: string | undefined) => ctx.meta.tables.some((tb) => new RegExp(`GlideRecord(?:Secure)?\\(\\s*['"]${tb}['"]`).test(script ?? ''));
  const seen = new Set<string>();
  const rules = [...ctx.meta.businessRules, ...(ctx.traces.crossRules ?? [])].filter((b) => {
    const key = b.sys_id ?? b.name ?? '';
    if (seen.has(key)) return false;
    seen.add(key);
    return opens(b.script) && refsField(b.script, ctx.field) && !onlySelf(b.script);
  });
  const nv = ctx.audit.newvalue ?? '';
  const out: Evidence[] = [];
  for (const b of rules) {
    // A regra roda na tabela do registro salvo (ou, na mesma hierarquia, numa tabela-mãe dele).
    const save = saves.find(({ w }) => w.table === b.collection || (ctx.meta.tables.includes(w.table) && ctx.meta.tables.includes(b.collection ?? '')));
    if (!save) continue;
    const facts = [
      fact('execution_in_window', 'syslog_transaction', `${save.w.table} ${save.w.sysId} foi salvo às ${save.t.sys_created_on} por ${save.t.sys_created_by}`),
      fact('references_table', 'sys_script', `a regra abre ${ctx.table} por GlideRecord`),
      fact('references_field', 'sys_script', `e grava "${ctx.field}"`),
    ];
    // O código aponta este registro pelo sys_id (guarda exata, gr.get('<sys_id>')): é ele, e não outro, que a regra grava.
    if ((b.script ?? '').includes(ctx.sysId)) facts.push(fact('trace_identifies_mechanism', 'sys_script', 'o código cita este registro pelo sys_id'));
    // Valores fixos que o código grava no campo pelo GlideRecord: se há e nenhum é o gravado, não foi esta regra.
    const lits = literalWrites(b.script, ctx.field);
    if (lits.length && !lits.includes(nv)) facts.push(fact('sets_other_value', 'sys_script', `o código grava ${lits.map((x) => `"${x}"`).join(', ')}, não este valor`));
    if (nv.length >= 3 && (b.script ?? '').includes(nv)) facts.push(fact('sets_same_value', 'sys_script', 'o código traz exatamente o valor gravado'));
    if (save.t.sys_created_by === ctx.user) facts.push(fact('user_matches', 'syslog_transaction', `quem salvou o ${save.w.table} é quem aparece nesta mudança (${ctx.user})`));
    out.push(evidence('br_other_record', { name: b.name ?? '?', sysId: b.sys_id, table: 'sys_script' }, facts,
      [`a regra roda ao salvar ${save.w.table} ${save.w.sysId}; as condições dela não foram avaliadas para aquele registro`]));
  }
  return out;
}

/**
 * O GlideRecord só reabre o próprio registro salvo (gr.get(current.sys_id)), sem consulta por outro: a regra grava o
 * registro que disparou, não outro. No PDI, "[PT] F2 async varios" ficava à frente da regra que de fato gravou o filho.
 */
function onlySelf(script: string | undefined): boolean {
  const s = script ?? '';
  const gets = [...s.matchAll(/\.get\(\s*([^)]*?)\s*\)/g)].map((m) => m[1] ?? '');
  if (!gets.length || /\.(?:addQuery|addEncodedQuery|addNullQuery|addNotNullQuery)\(/.test(s)) return false;
  return gets.every((a) => /^current\.(?:sys_id|getUniqueValue\(\s*\)|getValue\(\s*['"]sys_id['"]\s*\))$/.test(a));
}

/** Valores literais que o script grava no campo de um GlideRecord: `gr.campo = 'x'` e `gr.setValue('campo', 'x')`. */
function literalWrites(script: string | undefined, field: string): string[] {
  const s = script ?? '';
  const f = escapeRegExp(field);
  const str = String.raw`(['"])((?:\\.|(?!\1).)*)\1`;
  const assign = new RegExp(String.raw`\b(?!current\b)[A-Za-z_$][\w$]*\.${f}\s*=(?!=)\s*` + str, 'g');
  const setter = new RegExp(String.raw`\b(?!current\b)[A-Za-z_$][\w$]*\.setValue\(\s*['"]${f}['"]\s*,\s*` + str, 'g');
  return [...s.matchAll(assign), ...s.matchAll(setter)].map((m) => m[2] ?? '');
}

