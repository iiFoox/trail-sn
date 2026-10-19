import { fact } from '../scoring';
import { assignedLiterals, evalCondition, refsField, toMs } from '../util';
import { evidence, type ChangeContext, type Signature } from './context';
import type { Evidence, Fact, Row } from '../types';

/**
 * Mudanças sem rastro nomeado: aconteceram na própria transação de quem salvou.
 *
 *  - Checkpoint novo no mesmo segundo do anterior: BR after, BR async rápida ou cadeia BR → script include (C3, F1-SEQ).
 *  - Mesmo checkpoint do salvamento: o formulário diz quem foi.
 *      valor enviado == gravado  -> pessoa, OU algo que preencheu o campo no navegador antes de salvar
 *                                   (data lookup "run on form change", client script) — F1-LOOKUP, F1-CLIENT
 *      valor enviado != gravado  -> o servidor alterou ao salvar: BR before, data lookup, regra de atribuição (C2-FORM, F1-ASSIGN)
 *      sem envio de formulário    -> só suspeitos estáticos, CANDIDATO (C2 via REST)
 *
 * O formulário pode ser de outro usuário: regras de atribuição gravam como "system" na transação de quem salvou.
 */
export const sameTransaction: Signature = (ctx) => {
  const prev = ctx.checkpoints[String(ctx.checkpoint - 1)];
  const prevAt = prev?.[0]?.sys_created_on ?? '';
  const close = ctx.checkpoint > 1 && !!prevAt && Math.abs(toMs(prevAt) - toMs(ctx.at)) <= 2000;
  // Duas ou mais transações do usuário neste registro entre as duas gravações = gravações separadas (ex.: REST em rajada), não cadeia.
  // Só conta escritas (envio de formulário ou REST no registro), não recargas da página.
  const isWrite = (u: string) => u.includes(`sys_uniqueValue=${ctx.sysId}`) || u.includes(`/api/now/table/${ctx.table}/${ctx.sysId}`);
  const userWrites = close ? ctx.traces.transactions.filter((t) => t.sys_created_by === ctx.user && isWrite(t.url ?? '')
    && toMs(t.sys_created_on ?? '') >= toMs(prevAt) - 1000 && toMs(t.sys_created_on ?? '') <= toMs(ctx.at) + 1000).length : 0;
  return close && userWrites < 2 ? chainedUpdate(ctx) : userTransaction(ctx);
};

/** Fato de condição: verdadeira soma, falsa derruba. Avaliada com os valores atuais, nunca com o próprio campo. */
function conditionFacts(ctx: ChangeContext, cond: string | undefined, source: string): Fact[] {
  // O próprio campo é avaliado com o valor de ANTES da mudança: é o que a regra viu quando rodou.
  const r = evalCondition(cond, { ...ctx.record, [ctx.field]: ctx.audit.oldvalue ?? '' }, '');
  if (r === true) return [fact('condition_true', source, 'a condição da regra vale para este registro (valores atuais)')];
  if (r === false) return [fact('condition_false', source, 'a condição da regra não vale para este registro (valores atuais)')];
  return [];
}

const isAsync = (when: string | undefined) => (when ?? '').startsWith('async'); // async e async_always

type Lookup = ChangeContext['traces']['dataLookups'][number];
/** A tabela do lookup tem uma linha ativa que produz o valor gravado e casa com o registro? undefined = não deu para saber. */
function lookupFits(ctx: ChangeContext, d: Lookup): boolean | undefined {
  if (!d.rows || !d.setColumn) return undefined;
  const nv = ctx.audit.newvalue ?? '';
  const rows = d.rows.filter((r) => (r[d.setColumn!] ?? '') === nv);
  if (!rows.length) return false;
  return rows.some((r) => (d.match ?? []).every((m) => {
    const rv = r[m.matcher] ?? '';
    if (!m.exact && rv === '') return true;
    if (!(m.source in ctx.record)) return true;
    return rv === ctx.record[m.source];
  }));
}

/** O script grava um valor literal no campo? Igual ao gravado soma; todos diferentes derruba. */
function valueFacts(ctx: ChangeContext, script: string | undefined, source: string): Fact[] {
  const vals = assignedLiterals(script, ctx.field);
  if (!vals) return [];
  const nv = ctx.audit.newvalue ?? '';
  return vals.includes(nv)
    ? [fact('sets_same_value', source, `o código grava "${nv}" neste campo`)]
    : [fact('sets_other_value', source, `o código grava ${vals.map((v) => `"${v}"`).join(', ')}, não "${nv}"`)];
}

function brCondition(b: Row): string | undefined {
  return b.filter_condition || undefined;
}

function chainedUpdate(ctx: ChangeContext): Evidence[] {
  const out: Evidence[] = [];
  const base = () => [
    fact('new_checkpoint_same_second', 'sys_audit', `checkpoint ${ctx.checkpoint} gravado no mesmo segundo do ${ctx.checkpoint - 1}`),
    fact('references_field', 'sys_script', `referencia "${ctx.field}"`),
    fact('references_table', 'sys_script', `BR da hierarquia de ${ctx.table}`),
  ];
  for (const b of ctx.meta.brField.filter((b) => b.when === 'after' || isAsync(b.when))) {
    const gaps = isAsync(b.when) ? ['BR assíncrona rápida: não deixou transação de job; a ligação vem do código e do horário'] : [];
    out.push(evidence(isAsync(b.when) ? 'br_async' : 'br_after', { name: b.name ?? '?', sysId: b.sys_id, table: 'sys_script' }, [...base(), ...conditionFacts(ctx, brCondition(b), 'sys_script'), ...valueFacts(ctx, b.script, 'sys_script')], gaps));
  }
  for (const x of ctx.meta.brViaSi.filter((x) => x.br.when === 'after' || x.br.when === 'before' || isAsync(x.br.when))) {
    out.push(evidence('br_via_script_include', { name: `${x.br.name} → ${x.si.name}`, sysId: x.si.sys_id, table: 'sys_script_include' }, [...base(), ...conditionFacts(ctx, brCondition(x.br), 'sys_script')]));
  }
  return out;
}

/** Envios de formulário deste registro na janela; os do próprio usuário da auditoria primeiro. */
function formSubmits(ctx: ChangeContext): Row[] {
  const subs = ctx.traces.transactions.filter((t) => t.type === 'form' && (t.url ?? '').includes(`sys_uniqueValue=${ctx.sysId}`));
  return subs.sort((a, b) => Number(b.sys_created_by === ctx.user) - Number(a.sys_created_by === ctx.user));
}

/** Campos que mudaram na mesma gravação (mesmo checkpoint), além do investigado. */
function sameWriteFields(ctx: ChangeContext): string[] {
  return (ctx.checkpoints[String(ctx.checkpoint)] ?? []).map((r) => r.fieldname ?? '').filter((f) => f && f !== ctx.field);
}

function userTransaction(ctx: ChangeContext): Evidence[] {
  const out: Evidence[] = [];
  const tx = ctx.traces.transactions;
  const userTx = tx.filter((t) => t.sys_created_by === ctx.user && (t.url ?? '').includes(ctx.sysId));

  let verdict: 'user' | 'server' | null = null;
  let formAt = '';
  let formUser = ctx.user;
  for (const t of formSubmits(ctx)) {
    const p = new URLSearchParams((t.url ?? '').split('?')[1] ?? '');
    const sent = p.get(`${ctx.table}.${ctx.field}`);
    if (sent === null) continue;
    verdict = sent === (ctx.audit.newvalue ?? '') ? 'user' : 'server';
    formAt = t.sys_created_on ?? '';
    formUser = t.sys_created_by ?? ctx.user;
    break;
  }

  const befores = ctx.meta.brField.filter((b) => b.when === 'before');
  const brFacts = (b: Row) => [
    fact('references_field', 'sys_script', `referencia "${ctx.field}"`),
    fact('references_table', 'sys_script', `BR da tabela ${b.collection}`),
    ...conditionFacts(ctx, brCondition(b), 'sys_script'),
    ...valueFacts(ctx, b.script, 'sys_script'),
  ];
  const changedTogether = sameWriteFields(ctx);

  // Data lookups que definem o campo, quando uma das entradas mudou na mesma gravação.
  const lookups = ctx.traces.dataLookups.filter((d) => d.inputs.some((i) => changedTogether.includes(i)));
  const lookupFacts = (d: Lookup) => {
    const inputs = d.inputs.filter((i) => changedTogether.includes(i));
    const fits = lookupFits(ctx, d);
    return [
      ...(fits === true ? [fact('condition_true', 'dl_definition', 'uma linha da tabela do lookup produz exatamente este valor para este registro')] : []),
      ...(fits === false ? [fact('condition_false', 'dl_definition', 'nenhuma linha da tabela do lookup produz este valor para este registro')] : []),
      fact('references_field', 'dl_definition', `o data lookup define "${ctx.field}"`),
      fact('references_table', 'dl_definition', `data lookup da tabela ${ctx.table}`),
      fact('trace_identifies_mechanism', 'sys_audit', `${inputs.join(', ')} mudou na mesma gravação`),
    ];
  };

  if (verdict === 'user') {
    // O formulário enviou o valor final. Pode ter sido a pessoa ou algo que preencheu o campo no navegador.
    const clientSide: Evidence[] = [];
    for (const d of lookups.filter((d) => d.runOnForm)) {
      clientSide.push(evidence('data_lookup', { name: d.name, sysId: d.sysId, table: 'dl_definition' },
        [...lookupFacts(d), fact('condition_true', 'dl_definition', 'roda ao mudar o formulário (no navegador)')],
        ['o navegador não registra se a pessoa digitou ou se o data lookup preencheu']));
    }
    for (const cs of ctx.traces.clientScripts) {
      const trigger = cs.field ?? '';
      const triggered = cs.type === 'onChange' && changedTogether.includes(trigger);
      const facts = [fact('references_field', 'sys_script_client', `o client script altera "${ctx.field}"`), fact('references_table', 'sys_script_client', `client script da tabela ${cs.table}`), ...valueFacts(ctx, cs.script, 'sys_script_client')];
      if (triggered) facts.push(fact('trace_identifies_mechanism', 'sys_audit', `${trigger} mudou na mesma gravação e dispara o script`), fact('condition_true', 'sys_script_client', 'onChange do campo que mudou'));
      clientSide.push(evidence('client_script', { name: cs.name ?? '?', sysId: cs.sys_id, table: 'sys_script_client' }, facts, ['o navegador não registra se a pessoa digitou ou se o script preencheu']));
    }
    const strongClient = clientSide.some((e) => e.facts.some((f) => f.kind === 'trace_identifies_mechanism') && !e.facts.some((f) => f.kind === 'condition_false' || f.kind === 'sets_other_value'));
    out.push(evidence('user_action', { name: formUser }, [
      fact('form_value_equals', 'syslog_transaction', 'o formulário enviou exatamente o novo valor'),
      fact('execution_in_window', 'syslog_transaction', `salvo às ${formAt}`),
      fact('user_matches', 'syslog_transaction', `por ${formUser}`),
      ...(strongClient ? [fact('client_side_possible', 'sys_script_client', 'algo pode ter preenchido o campo no navegador antes de salvar')] : []),
    ]));
    out.push(...clientSide);
  } else if (verdict === 'server') {
    const formFacts = () => [
      fact('form_value_differs', 'syslog_transaction', 'o formulário enviou outro valor; o servidor alterou ao salvar'),
      fact('execution_in_window', 'syslog_transaction', `salvo às ${formAt} por ${formUser}`),
    ];
    for (const b of befores) out.push(evidence('br_before', { name: b.name ?? '?', sysId: b.sys_id, table: 'sys_script' }, [...formFacts(), ...brFacts(b)]));
    for (const d of lookups.filter((d) => d.runOnUpdate)) out.push(evidence('data_lookup', { name: d.name, sysId: d.sysId, table: 'dl_definition' }, [...formFacts(), ...lookupFacts(d)]));
    for (const rule of ctx.traces.assignmentRules) {
      const target = rule.group || rule.user;
      const facts = [...formFacts(), fact('references_table', 'sysrule_assignment', `regra da tabela ${rule.table}`), ...conditionFacts(ctx, rule.condition, 'sysrule_assignment')];
      if (target && target === (ctx.audit.newvalue ?? '')) facts.push(fact('references_field', 'sysrule_assignment', 'a regra atribui exatamente o valor gravado'));
      const gaps = ctx.user !== formUser ? [`gravado como "${ctx.user}" dentro do salvamento de ${formUser}`] : [];
      out.push(evidence('assignment_rule', { name: rule.name ?? '?', sysId: rule.sys_id, table: 'sysrule_assignment' }, facts, gaps));
    }
    if (!out.length) {
      out.push(evidence('server_change', { name: 'BR before, data lookup ou regra de atribuição' }, formFacts(),
        ['nenhuma BR before, data lookup ou regra de atribuição ativa explica o campo; verificar outras automações']));
    }
  } else {
    const gap = ['sem envio de formulário para comparar o valor enviado'];
    // Sem o valor enviado, gravar o mesmo valor não prova nada (a pessoa pode ter mandado igual); só o valor diferente descarta.
    for (const b of befores) out.push(evidence('br_before', { name: b.name ?? '?', sysId: b.sys_id, table: 'sys_script' }, brFacts(b).filter((f) => f.kind !== 'sets_same_value'), gap));
    const u = userTx[0];
    if (u) {
      const api = /\/api\//.test(u.url ?? '');
      out.push(evidence('user_action', { name: ctx.user }, [
        fact('execution_in_window', 'syslog_transaction', `${u.type} ${(u.url ?? '').split('?')[0]} às ${u.sys_created_on}`),
        fact('user_matches', 'syslog_transaction', `por ${ctx.user}`),
      ], api ? ['gravação pela API: o corpo da requisição não fica registrado, então o valor enviado não pode ser conferido'] : gap));
    }
  }
  return out;
}

export { refsField };
