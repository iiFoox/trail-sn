import { fact } from '../scoring';
import { evalExpr, scriptVerdict, writesOf, type Env } from '../scriptEval';
import { assignedLiterals, parseFieldValues, sameVal } from '../util';
import type { Evidence, Fact, Row } from '../types';
import type { ChangeContext } from './context';

/**
 * Valores que o script "via" quando rodou.
 *  - 'save' (BR before, client script, UI action, BR before dentro de uma gravação aninhada): roda DENTRO da gravação
 *    desta mudança. Os outros campos desta gravação já têm o valor novo; o próprio campo ainda tem o de antes.
 *  - 'trigger' (BR after/async, script action, job): é a CAUSA de uma gravação posterior. Avaliou as condições na
 *    gravação que a disparou (a anterior): os campos desta gravação ainda tinham o valor antigo, e o que "mudou"
 *    foram os campos da gravação anterior.
 */
/** Valor do campo desconhecido (ex.: uma BR anterior gravou algo que não dá para calcular). */
export const UNKNOWN_VALUE = '\u0000?';

export function envFor(ctx: ChangeContext, opts: { mode?: 'save' | 'trigger'; trigger?: string; fieldValue?: string } = {}): Env {
  const rows = ctx.checkpoints[String(ctx.checkpoint)] ?? [];
  const rec: Record<string, string> = { ...ctx.record, sys_id: ctx.sysId };
  const old: Record<string, string> = { ...ctx.record };
  const changed = new Set<string>();
  const trig = opts.mode === 'trigger';
  for (const r of rows) {
    const f = r.fieldname ?? '';
    if (!f) continue;
    if (!trig) changed.add(f);
    rec[f] = trig ? (r.oldvalue ?? '') : (r.newvalue ?? '');
    old[f] = r.oldvalue ?? '';
  }
  if (trig) {
    for (const r of ctx.checkpoints[String(ctx.checkpoint - 1)] ?? []) {
      const f = r.fieldname ?? '';
      if (!f) continue;
      changed.add(f); // a mudança da gravação anterior pode reaparecer neste checkpoint (cópia do update()), mas foi lá que "mudou"
      // A regra viu o registro DEPOIS da gravação anterior. A cópia que o update() aninhado grava neste checkpoint traz
      // como "antes" o valor de antes da transação inteira, então o valor certo é o novo da gravação anterior.
      rec[f] = r.newvalue ?? '';
      old[f] = r.oldvalue ?? '';
    }
  } else changed.add(ctx.field);
  const prevRow = trig ? (ctx.checkpoints[String(ctx.checkpoint - 1)] ?? []).find((r) => r.fieldname === ctx.field) : undefined;
  // BR before vê o valor que chegou na gravação (o enviado pelo formulário, quando se sabe); senão, o de antes.
  rec[ctx.field] = opts.fieldValue ?? (prevRow ? prevRow.newvalue ?? '' : ctx.audit.oldvalue ?? '');
  old[ctx.field] = prevRow ? prevRow.oldvalue ?? '' : ctx.audit.oldvalue ?? '';
  if (opts.fieldValue === UNKNOWN_VALUE) delete rec[ctx.field];
  const u = ctx.traces.users?.[ctx.user];
  const env: Env = { rec, old, changed, user: { name: ctx.user, ...(u?.sysId ? { sysId: u.sysId } : {}) } };
  if (opts.trigger) { env.newValue = rec[opts.trigger]; env.oldValue = old[opts.trigger]; }
  return env;
}

const short = (s: string, n = 70) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/**
 * Lê o script e devolve os fatos sobre ESTE campo nesta gravação:
 *  - reads_only: cita o campo mas não grava nele (só lê, ex.: `current.x.changes()`);
 *  - condition_false: toda linha que grava o campo está atrás de uma condição falsa para este registro;
 *  - condition_true: a condição da linha que grava vale (só quando não houve outra condição avaliada);
 *  - sets_same_value / sets_other_value: o valor que o script calcula (literal ou expressão simples) bate ou não.
 * `condition` é o campo Condition da BR (script), avaliado junto.
 */
export function scriptFacts(ctx: ChangeContext, script: string | undefined, source: string, opts: { mode?: 'save' | 'trigger'; trigger?: string; fieldValue?: string; template?: string; condition?: string; hasCondition?: boolean } = {}): Fact[] {
  const env = envFor(ctx, opts);
  const nv = ctx.audit.newvalue ?? '';
  const out: Fact[] = [];
  let condDone = !!opts.hasCondition;

  // Campo Condition da BR (script de uma linha).
  if (opts.condition?.trim()) {
    const c = evalExpr(opts.condition, env);
    if (c === false || c === '' || c === 0) return [fact('condition_false', source, `a condição "${short(opts.condition)}" não vale nesta gravação`)];
    if (c !== undefined && !condDone) { out.push(fact('condition_true', source, `a condição "${short(opts.condition)}" vale nesta gravação`)); condDone = true; }
  }

  // Ações da BR (template "campo=valor^..."): gravam sem condição de script.
  const tpl = parseFieldValues(opts.template);
  if (ctx.field in tpl) {
    const v = tpl[ctx.field]!;
    out.push(sameVal(v, nv) ? fact('sets_same_value', source, `as ações da regra gravam "${v}"`) : fact('sets_other_value', source, `as ações da regra gravam "${v}", não "${nv}"`));
    return out;
  }

  const v = scriptVerdict(script, ctx.field, env);
  if (!v) return out;
  if (!v.writes) {
    if (!v.dynamic) out.push(fact('reads_only', source, `o código cita "${ctx.field}" mas não grava nele`));
    return out;
  }
  if (v.reachable === false) return [...out.filter((f) => f.kind !== 'condition_true'), fact('condition_false', source, `o trecho que grava "${ctx.field}" depende de "${short(v.failed ?? '')}", que não vale nesta gravação`)];
  const scan = writesOf(script, ctx.field);
  const guarded = !!scan?.writes.some((w) => w.guards.length);
  if (v.guardsTrue && guarded && !condDone) out.push(fact('condition_true', source, 'a condição do trecho que grava o campo vale nesta gravação'));
  const known = v.values.filter((x): x is string => x !== undefined);
  if (known.some((x) => sameVal(x, nv))) out.push(fact('sets_same_value', source, `o código grava "${nv}" neste campo`));
  else if (known.length && known.length === v.values.length) out.push(fact('sets_other_value', source, `o código grava ${known.map((x) => `"${short(x, 40)}"`).join(', ')}, não "${short(nv, 40)}"`));
  else if (!known.length) {
    // Expressão que não calculamos: cai no reconhecimento de literais (compatível com a versão anterior).
    const lits = assignedLiterals(script, ctx.field);
    if (lits && !lits.some((x) => sameVal(x, nv))) out.push(fact('sets_other_value', source, `o código grava ${lits.map((x) => `"${x}"`).join(', ')}, não "${nv}"`));
  }
  return out;
}

/**
 * A regra reage a outro campo que mudou nesta mesma gravação (`current.x.changes()` / `changesTo` no script ou na condição)?
 * É o elo de uma cadeia: algo gravou x e a regra respondeu gravando este campo.
 */
export function reactsFacts(ctx: ChangeContext, texts: (string | undefined)[], source: string): Fact[] {
  const rows = ctx.checkpoints[String(ctx.checkpoint)] ?? [];
  const others = new Set(rows.map((r) => r.fieldname ?? '').filter((f) => f && f !== ctx.field));
  for (const t of texts) {
    for (const m of (t ?? '').matchAll(/current\.([a-z0-9_]+)\.changes(?:To|From)?\(|(?:^|\^)([a-z0-9_]+)(?:VALCHANGES|CHANGESTO|CHANGESFROM)/g)) {
      const f = m[1] ?? m[2]!;
      if (others.has(f)) return [fact('reacts_to_change', source, `reage à mudança de "${f}", que mudou nesta mesma gravação`)];
    }
  }
  return [];
}

const ruled = (e: Evidence) => e.facts.some((f) => f.kind === 'condition_false' || f.kind === 'reads_only' || f.kind === 'not_referenced' || f.kind === 'sets_other_value' || f.kind === 'no_step_writes_field');

/**
 * Várias BRs before na mesma gravação: o ServiceNow roda em ordem crescente de `order`; quem grava por último é o valor que fica.
 *  - entre as que podem ter gravado este valor, a de maior order leva "última a gravar";
 *  - as de order menor que também gravariam (mesmo valor) levam "sobrescrita depois";
 *  - as que rodaram antes gravando OUTRO valor ganham uma nota explicando que foram sobrescritas.
 */
export function resolveOrder(evs: { e: Evidence; row: Row }[]): void {
  const order = (r: Row) => Number(r.order ?? 100);
  const possible = evs.filter((x) => !ruled(x.e) && x.e.type === 'br_before');
  // Só quem comprovadamente grava este valor disputa a "última palavra"; sem valor conhecido, a ordem não decide nada.
  const pool = possible.filter((x) => x.e.facts.some((f) => f.kind === 'sets_same_value'));
  if (!pool.length) return;
  const top = [...pool].sort((a, b) => order(b.row) - order(a.row))[0]!;
  if (pool.length > 1) {
    top.e.facts.push(fact('last_writer', 'sys_script', `order ${order(top.row)}: é a última das regras before a gravar este campo`));
    for (const x of pool) if (x !== top && order(x.row) < order(top.row)) x.e.facts.push(fact('overwritten_later', 'sys_script', `order ${order(x.row)}: roda antes de "${top.e.artifact.name}" (order ${order(top.row)}), que grava depois`));
  }
  for (const x of evs) {
    if (x === top || x.e.type !== 'br_before') continue;
    const other = x.e.facts.find((f) => f.kind === 'sets_other_value');
    const condFalse = x.e.facts.some((f) => f.kind === 'condition_false');
    if (other && !condFalse && order(x.row) <= order(top.row)) x.e.gaps.push(`também rodou (order ${order(x.row)}), mas "${top.e.artifact.name}" (order ${order(top.row)}) gravou depois`);
  }
}
