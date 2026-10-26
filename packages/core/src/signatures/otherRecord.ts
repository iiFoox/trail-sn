import { fact } from '../scoring';
import { escapeRegExp, linkFields, otherRecordWrite, refsField, toMs } from '../util';
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
  // brField traz também as regras desligadas depois da mudança (quem investiga costuma desligar a suspeita antes).
  const rules = [...ctx.meta.businessRules, ...ctx.meta.brField, ...(ctx.traces.crossRules ?? [])].filter((b) => {
    const key = b.sys_id ?? b.name ?? '';
    if (seen.has(key)) return false;
    seen.add(key);
    return opens(b.script) && refsField(b.script, ctx.field) && !onlySelf(b.script);
  });
  const nv = ctx.audit.newvalue ?? '';
  const out: Evidence[] = [];
  for (const b of rules) {
    // Desligada hoje só conta se foi alterada depois desta mudança (as do próprio registro já chegam filtradas).
    const off = b.active === 'false';
    if (off && !((b.sys_updated_on ?? '') > ctx.at)) continue;
    // A regra roda na tabela do registro salvo (ou, na mesma hierarquia, numa tabela-mãe dele).
    const fits = saves.filter(({ w }) => w.table === b.collection || (ctx.meta.tables.includes(w.table) && ctx.meta.tables.includes(b.collection ?? '')));
    if (!fits.length) continue;
    // Vínculo entre este registro e o salvo: o código cita este sys_id, ou busca por um campo que aponta para o salvo
    // (addQuery('parent_incident', current.sys_id)) e este registro tem esse campo = sys_id do salvo. Sem vínculo, uma
    // gravação qualquer de outro registro no mesmo segundo não diz nada (na bateria, "Update Child Incidents" virava
    // causa provável de um incidente que não era filho de ninguém).
    const byId = (b.script ?? '').includes(ctx.sysId);
    const links = linkFields(b.script);
    const known = links.filter((f) => f in ctx.record);
    const save = fits.find(({ w }) => known.some((f) => ctx.record[f] === w.sysId)) ?? fits[0]!;
    const linkedBy = known.find((f) => ctx.record[f] === save.w.sysId);
    const unlinked = !byId && links.length > 0 && known.length === links.length && !linkedBy;
    const related = byId || !!linkedBy;
    const facts = [
      ...(related ? [fact('execution_in_window', 'syslog_transaction', `${save.w.table} ${save.w.sysId} foi salvo às ${save.t.sys_created_on} por ${save.t.sys_created_by}`)] : []),
      fact('references_table', 'sys_script', `a regra abre ${ctx.table} por GlideRecord`),
      fact('references_field', 'sys_script', `e grava "${ctx.field}"`),
    ];
    if (byId) facts.push(fact('trace_identifies_mechanism', 'sys_script', 'o código cita este registro pelo sys_id'));
    else if (linkedBy) facts.push(fact('trace_identifies_mechanism', ctx.table, `este registro aponta para o ${save.w.table} salvo pelo campo ${linkedBy}`));
    if (unlinked) facts.push(fact('condition_false', ctx.table, `este registro não aponta para o ${save.w.table} salvo (${links.join(', ')})`));
    // Valores fixos que o código grava no campo pelo GlideRecord: se há e nenhum é o gravado, não foi esta regra.
    const lits = literalWrites(b.script, ctx.field);
    if (lits.length && !lits.includes(nv)) facts.push(fact('sets_other_value', 'sys_script', `o código grava ${lits.map((x) => `"${x}"`).join(', ')}, não este valor`));
    if (nv.length >= 3 && (b.script ?? '').includes(nv)) facts.push(fact('sets_same_value', 'sys_script', 'o código traz exatamente o valor gravado'));
    if (related && save.t.sys_created_by === ctx.user) facts.push(fact('user_matches', 'syslog_transaction', `quem salvou o ${save.w.table} é quem aparece nesta mudança (${ctx.user})`));
    out.push(evidence('br_other_record', { name: b.name ?? '?', sysId: b.sys_id, table: 'sys_script' }, facts,
      [`a regra roda ao salvar ${save.w.table} ${save.w.sysId}; as condições dela não foram avaliadas para aquele registro`,
        ...(related || unlinked ? [] : [`não deu para ligar este registro ao ${save.w.table} salvo: a regra não cita este sys_id nem busca por um campo dele`]),
        ...(off && (ctx.traces.crossRules ?? []).includes(b) ? [`está desativado hoje; foi alterado em ${b.sys_updated_on}, depois da mudança (confira se estava ativo na hora)`] : [])]));
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

