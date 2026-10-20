import { fact } from '../scoring';
import { evalCondition, refsField, toMs, batchAt } from '../util';
import { evalExpr, scriptVerdict, writesOf } from '../scriptEval';
import { envFor, reactsFacts, resolveOrder, scriptFacts, UNKNOWN_VALUE } from './scriptFacts';
import { conditionFields as conditionFieldsOf, isFormSubmitFor, isRecordWrite, parseFieldValues, sameVal, uiActionMatches, uiActionRef } from '../util';
import { isSaveButton } from './uiAction';
import { evidence, isSystemUser, type ChangeContext, type Signature } from './context';
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
  const isWrite = (u: string) => isFormSubmitFor(u, ctx.sysId) || u.includes(`/api/now/table/${ctx.table}/${ctx.sysId}`);
  const userWrites = close ? ctx.traces.transactions.filter((t) => t.sys_created_by === ctx.user && isWrite(t.url ?? '')
    && toMs(t.sys_created_on ?? '') >= toMs(prevAt) - 1000 && toMs(t.sys_created_on ?? '') <= toMs(ctx.at) + 1000).length : 0;
  return close && userWrites < 2 ? chainedUpdate(ctx) : userTransaction(ctx);
};

/**
 * Gravação aninhada numa gravação de fundo (job, script action, evento): a gravação anterior foi no mesmo segundo,
 * então uma BR after / async / script include pode ter gravado este campo em seguida (cadeia).
 */
export function backgroundChain(ctx: ChangeContext): Evidence[] {
  const prevAt = ctx.checkpoints[String(ctx.checkpoint - 1)]?.[0]?.sys_created_on ?? '';
  const close = ctx.checkpoint > 1 && !!prevAt && Math.abs(toMs(prevAt) - toMs(ctx.at)) <= 2000;
  return close ? chainedUpdate(ctx).filter((e) => e.type !== 'br_before') : [];
}

/** Fato de condição: verdadeira soma, falsa derruba. Avaliada com os valores atuais, nunca com o próprio campo. */
function conditionFacts(ctx: ChangeContext, cond: string | undefined, source: string, fieldValue?: string, mode: 'save' | 'trigger' = 'save'): Fact[] {
  // O próprio campo é avaliado com o valor de ANTES da mudança: é o que a regra viu quando rodou.
  // VALCHANGES/CHANGESTO/CHANGESFROM: o que mudou na gravação avaliada (a desta mudança, ou a anterior quando a regra é a causa).
  const env = envFor(ctx, { mode });
  const r = evalCondition(cond, { ...ctx.record, [ctx.field]: fieldValue ?? ctx.audit.oldvalue ?? '' }, '', { set: env.changed, old: env.old });
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

/** Fatos do script de uma BR: grava o campo? com que valor? as condições (filtro, Condition e ifs) valem? */
function brScriptFacts(ctx: ChangeContext, b: Row, mode: 'save' | 'trigger', cond: Fact[], fieldValue?: string): Fact[] {
  return scriptFacts(ctx, b.script, 'sys_script', { mode, template: b.template, condition: b.condition, hasCondition: cond.length > 0, fieldValue });
}

/** Quem fez a gravação aninhada: BRs after que chamam update() e gravam um campo que mudou neste checkpoint. */
function nestedBy(ctx: ChangeContext): Row | undefined {
  const others = (ctx.checkpoints[String(ctx.checkpoint)] ?? []).map((r) => r.fieldname ?? '').filter((f) => f && f !== ctx.field);
  return ctx.meta.businessRules.find((b) => (b.when === 'after' || isAsync(b.when)) && /\.update\(\s*\)/.test(b.script ?? '')
    && others.some((f) => (writesOf(b.script, f)?.writes.length ?? 0) > 0));
}

/** BRs before que podem ter gravado o campo numa gravação feita por automação (update() de outra regra, script action, job). */
/** Valor que uma importação mandou para o campo nesta gravação (linha de staging + mapeamento direto), se houver. */
function importedValue(ctx: ChangeContext): { value: string; map: string } | undefined {
  const at = toMs(ctx.at);
  const rows = (ctx.traces.importRows ?? []).filter((r) => Math.abs(toMs(r.sys_updated_on ?? '') - at) <= 3000);
  for (const r of rows) {
    const entry = (ctx.traces.transformEntries ?? []).find((e) => e.map === r.sys_transform_map && e.use_source_script !== 'true' && e.source_field);
    const stage = (ctx.traces.stageRows ?? []).find((x) => x.sys_id === r.sys_id);
    if (entry && stage && entry.source_field! in stage) return { value: stage[entry.source_field!] ?? '', map: r['sys_transform_map.name'] || 'transform map' };
  }
  return undefined;
}

function nestedBefores(ctx: ChangeContext, base: () => Fact[]): { e: Evidence; row: Row }[] {
  const by = nestedBy(ctx);
  const imp = importedValue(ctx);
  return ctx.meta.brField.filter((b) => b.when === 'before').map((b) => {
    const cond = conditionFacts(ctx, brCondition(b), 'sys_script', imp?.value);
    const facts = [...base(), ...cond, ...brScriptFacts(ctx, b, 'save', cond, imp?.value), ...reactsFacts(ctx, [b.script, b.condition, b.filter_condition], 'sys_script')];
    // A importação mandou outro valor e esta regra, rodando na gravação, transforma no valor que ficou.
    if (imp && !sameVal(imp.value, ctx.audit.newvalue ?? '') && facts.some((f) => f.kind === 'sets_same_value') && !facts.some((f) => f.kind === 'condition_false'))
      facts.push(fact('trace_identifies_mechanism', 'sys_import_set_row', `a importação (${imp.map}) mandou "${imp.value}" e a regra grava "${ctx.audit.newvalue ?? ''}" ao salvar`));
    const gaps = [imp ? `rodou dentro da gravação feita pela importação (${imp.map})` : by ? `rodou dentro da gravação feita por "${by.name}" (update() numa regra after)` : 'rodou dentro de uma gravação feita por automação'];
    return { e: evidence('br_before', { name: b.name ?? '?', sysId: b.sys_id, table: 'sys_script' }, facts, gaps), row: b };
  });
}

/** Gravação por lote da Batch API (a URL não cita o registro): a pessoa ou integração do lote no mesmo instante. */
export const batchWrite = (ctx: ChangeContext, explained: boolean): Evidence[] => {
  const b = batchAt(ctx.traces.transactions, ctx.user, ctx.at).filter((t) => toMs(t.sys_created_on ?? '') - toMs(ctx.at) >= -2000 && toMs(t.sys_created_on ?? '') - toMs(ctx.at) <= 3000)[0];
  if (!b) return [];
  const who = ctx.traces.users?.[ctx.user];
  const facts = [fact('execution_in_window', 'syslog_transaction', `lote ${b.url?.split('?')[0]} às ${b.sys_created_on}`), fact('user_matches', 'syslog_transaction', `por ${ctx.user}`)];
  if (who?.integration) facts.push(fact('integration_user', 'sys_user', `${who.name} é uma conta de integração (só API)`));
  if (!explained && !ctx.meta.incomplete) facts.push(fact('no_competing_automation', 'sys_script', 'nenhuma automação ativa explica este valor'));
  return [evidence('user_action', { name: ctx.user }, facts, ['gravação por um lote da Batch API: o lote não registra quais registros alterou, então a ligação com este registro vem do horário e do usuário'])];
};

/**
 * Edição direto na lista (célula da lista): o ServiceNow não registra transação para ela. Uma pessoa de verdade
 * (não system, não integração) que abriu a lista da tabela pouco antes, sem automação que explique, é a pista.
 */
export const listEdit = (ctx: ChangeContext, explained: boolean): Evidence[] => {
  const view = (ctx.traces.listViews ?? [])[0];
  const who = ctx.traces.users?.[ctx.user];
  if (!view || isSystemUser(ctx.user) || !who || who.integration) return [];
  const mins = Math.round((toMs(ctx.at) - toMs(view.sys_created_on ?? '')) / 60000);
  const facts = [
    fact('execution_in_window', 'syslog_transaction', `${ctx.user} abriu a lista ${(view.url ?? '').split('?')[0]} às ${view.sys_created_on}${mins > 0 ? ` (${mins} min antes)` : ''}`),
    fact('user_matches', 'sys_audit', `a auditoria registra ${ctx.user} como autor`),
  ];
  if (!explained && !ctx.meta.incomplete) facts.push(fact('no_competing_automation', 'sys_script', 'nenhuma automação ativa explica este valor'));
  return [evidence('user_action', { name: ctx.user }, facts, ['edição direto na lista: o ServiceNow não registra transação para ela; a ligação vem do autor na auditoria e da lista aberta pouco antes'])];
};

/** Mudança numa gravação de fundo (script action, job, evento): as BRs before rodam ali também. */
export const backgroundBefores = (ctx: ChangeContext): Evidence[] => {
  // Sem nenhum rastro de execução no instante (transação, evento, flow), a ligação é só o código: não passa de baixa.
  const t = ctx.traces;
  const traceless = !t.transactions.length && !t.events.length && !t.flows.length && !t.workflows.length;
  const evs = nestedBefores(ctx, () => [
    fact('references_field', 'sys_script', `referencia "${ctx.field}"`),
    fact('references_table', 'sys_script', `BR da hierarquia de ${ctx.table}`),
    ...(traceless ? [fact('no_trace', 'syslog_transaction', 'nenhum registro de execução no instante da mudança (pode ter expirado)')] : []),
  ]);
  resolveOrder(evs);
  const out = evs.map((x) => x.e);
  // Regras de atribuição também rodam na gravação de fundo (job, script action) e gravam como "system".
  for (const rule of ctx.traces.assignmentRules) {
    const target = rule.group || rule.user;
    if (!target) continue;
    const facts = [fact('references_table', 'sysrule_assignment', `regra da tabela ${rule.table}`), ...conditionFacts(ctx, rule.condition, 'sysrule_assignment')];
    if (target !== (ctx.audit.newvalue ?? '')) facts.push(fact('sets_other_value', 'sysrule_assignment', 'a regra atribui outro valor'));
    else {
      facts.push(fact('references_field', 'sysrule_assignment', 'a regra atribui exatamente o valor gravado'));
      const others = (ctx.checkpoints[String(ctx.checkpoint)] ?? []).map((r) => r.fieldname ?? '').filter((f) => f && f !== ctx.field);
      if (others.some((f) => conditionFieldsOf(rule.condition).includes(f))) facts.push(fact('trace_identifies_mechanism', 'sys_audit', 'o campo da condição da regra mudou na mesma gravação'));
    }
    out.push(evidence('assignment_rule', { name: rule.name ?? '?', sysId: rule.sys_id, table: 'sysrule_assignment' }, facts));
  }
  return out;
};

/**
 * A BR before com certeza rodou e gravou exatamente o novo valor: condição (filtro e script) verdadeira ou ausente,
 * e o trecho que grava o campo sem condição desconhecida. Nesse caso o valor enviado pela API não importa:
 * a BR roda depois de aplicado o envio e é ela quem deixa o valor.
 */
function surelyWrites(ctx: ChangeContext, b: Row, cond: Fact[]): boolean {
  const nv = ctx.audit.newvalue ?? '';
  if (brCondition(b) && !cond.some((f) => f.kind === 'condition_true')) return false;
  const env = envFor(ctx, { mode: 'save' });
  if (b.condition?.trim()) { const c = evalExpr(b.condition, env); if (c === undefined || c === false || c === '' || c === 0) return false; }
  const tpl = parseFieldValues(b.template);
  if (ctx.field in tpl) return sameVal(tpl[ctx.field], nv);
  const v = scriptVerdict(b.script, ctx.field, env);
  return !!v && v.writes && !v.dynamic && v.reachable === true && v.guardsTrue && v.values.length > 0 && v.values.every((x) => sameVal(x, nv));
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
    const cond = conditionFacts(ctx, brCondition(b), 'sys_script', undefined, 'trigger');
    out.push(evidence(isAsync(b.when) ? 'br_async' : 'br_after', { name: b.name ?? '?', sysId: b.sys_id, table: 'sys_script' }, [...base(), ...cond, ...brScriptFacts(ctx, b, 'trigger', cond)], gaps));
  }
  // A gravação aninhada (update() de uma regra after) roda as BRs before de novo.
  const befores = nestedBefores(ctx, base);
  resolveOrder(befores);
  out.push(...befores.map((x) => x.e));
  for (const x of ctx.meta.brViaSi.filter((x) => x.br.when === 'after' || x.br.when === 'before' || isAsync(x.br.when))) {
    const cond = conditionFacts(ctx, brCondition(x.br), 'sys_script', undefined, x.br.when === 'before' ? 'save' : 'trigger');
    const facts = [...base(), ...cond];
    if (x.arg) {
      // A chamada vira uma "gravação" na leitura do script da BR: avalia as condições em volta e o valor passado.
      const pseudo = (x.br.script ?? '').replace(x.arg.call, x.arg.value !== undefined ? `current.${ctx.field} = '${x.arg.value.replace(/'/g, "\\'")}'` : `current.${ctx.field} = __dinamico__`);
      facts[1] = fact('references_field', 'sys_script', `passa "${ctx.field}" para ${x.si.name}`);
      facts.push(...scriptFacts(ctx, pseudo, 'sys_script', { mode: 'trigger', condition: x.br.condition, hasCondition: cond.length > 0 }), ...reactsFacts(ctx, [x.br.script, x.br.condition, x.br.filter_condition], 'sys_script'));
    }
    out.push(evidence('br_via_script_include', { name: `${x.br.name} → ${x.si.name}`, sysId: x.si.sys_id, table: 'sys_script_include' }, facts));
  }
  return out;
}

/** Envios de formulário deste registro na janela; os do próprio usuário da auditoria primeiro. */
function formSubmits(ctx: ChangeContext): Row[] {
  const subs = ctx.traces.transactions.filter((t) => t.type === 'form' && isFormSubmitFor(t.url, ctx.sysId));
  return subs.sort((a, b) => Number(b.sys_created_by === ctx.user) - Number(a.sys_created_by === ctx.user));
}

/** Campos que mudaram na mesma gravação (mesmo checkpoint), além do investigado. */
function sameWriteFields(ctx: ChangeContext): string[] {
  return (ctx.checkpoints[String(ctx.checkpoint)] ?? []).map((r) => r.fieldname ?? '').filter((f) => f && f !== ctx.field);
}

function userTransaction(ctx: ChangeContext): Evidence[] {
  const out: Evidence[] = [];
  /** Client script que pode ter preenchido o campo no navegador (onChange de um campo que mudou na mesma gravação). */
  const clientEvidence = (scripts: Row[]): Evidence[] => scripts.map((cs) => {
    const trigger = cs.field ?? '';
    const triggered = cs.type === 'onChange' && changedTogether.includes(trigger);
    const facts = [fact('references_field', 'sys_script_client', `o client script altera "${ctx.field}"`), fact('references_table', 'sys_script_client', `client script da tabela ${cs.table}`), ...scriptFacts(ctx, cs.script, 'sys_script_client', { trigger: cs.type === 'onChange' ? trigger : undefined, hasCondition: triggered })];
    if (triggered) facts.push(fact('trace_identifies_mechanism', 'sys_audit', `${trigger} mudou na mesma gravação e dispara o script`), fact('condition_true', 'sys_script_client', 'onChange do campo que mudou'));
    return evidence('client_script', { name: cs.name ?? '?', sysId: cs.sys_id, table: 'sys_script_client' }, facts, ['o navegador não registra se a pessoa digitou ou se o script preencheu']);
  });
  // UI policy com script: roda no navegador quando a condição muda (e ao carregar). O ramo "true" roda com a condição
  // verdadeira; o "false" (reverse if false), com ela falsa. Um campo da condição que mudou nesta gravação é o gatilho.
  const policyEvidence = (rows: Row[]): Evidence[] => rows.map((p) => {
    const cond = conditionFacts(ctx, p.conditions, 'sys_ui_policy');
    const holds = cond.some((f) => f.kind === 'condition_true') ? true : cond.some((f) => f.kind === 'condition_false') ? false : undefined;
    const want = p.branch !== 'false';
    const facts = [fact('references_field', 'sys_ui_policy', `o script da UI policy altera "${ctx.field}"`), fact('references_table', 'sys_ui_policy', `UI policy da tabela ${p.table}`)];
    if (holds !== undefined) facts.push(holds === want
      ? fact('condition_true', 'sys_ui_policy', want ? 'a condição da UI policy vale para este registro' : 'a condição da UI policy não vale para este registro, e o script do "senão" roda')
      : fact('condition_false', 'sys_ui_policy', want ? 'a condição da UI policy não vale para este registro' : 'a condição da UI policy vale, então o script do "senão" não roda'));
    const trig = conditionFieldsOf(p.conditions).filter((f) => f !== ctx.field && changedTogether.includes(f));
    if (trig.length && holds === want) facts.push(fact('trace_identifies_mechanism', 'sys_audit', `${trig.join(', ')} mudou na mesma gravação e a UI policy reage`));
    facts.push(...scriptFacts(ctx, p.script, 'sys_ui_policy', { hasCondition: true }).filter((f) => f.kind !== 'condition_true'));
    return evidence('ui_policy', { name: p.name ?? '?', sysId: p.sys_id, table: 'sys_ui_policy' }, facts, ['o navegador não registra se a pessoa digitou ou se a UI policy preencheu']);
  });
  const isStrong = (es: Evidence[]) => es.some((e) => e.facts.some((f) => f.kind === 'trace_identifies_mechanism') && !e.facts.some((f) => f.kind === 'condition_false' || f.kind === 'sets_other_value' || f.kind === 'reads_only'));
  const tx = ctx.traces.transactions;
  let userTx = tx.filter((t) => t.sys_created_by === ctx.user && isRecordWrite(t.url, ctx.sysId));
  // Gravado como "system" dentro do salvamento de outra pessoa (regra de atribuição): a transação é a dessa pessoa.
  if (!userTx.length && isSystemUser(ctx.user)) userTx = tx.filter((t) => !/^JOB: /.test(t.url ?? '') && isRecordWrite(t.url, ctx.sysId) && Math.abs(toMs(t.sys_created_on ?? '') - toMs(ctx.at)) <= 2000);
  // Batch API: a URL não cita o registro; um lote da mesma pessoa no mesmo instante é a melhor pista de quem gravou.
  const viaBatch = !userTx.length && batchAt(tx, ctx.user, ctx.at).length > 0;
  if (viaBatch) userTx = batchAt(tx, ctx.user, ctx.at);

  let verdict: 'user' | 'server' | null = null;
  let formAt = '';
  let formUser = ctx.user;
  let sentValue: string | undefined;
  for (const t of formSubmits(ctx)) {
    const p = new URLSearchParams((t.url ?? '').split('?')[1] ?? '');
    const sent = p.get(`${ctx.table}.${ctx.field}`);
    if (sent === null) continue;
    // A URL da transação é cortada (tamanho da coluna ou caractere acentuado): valor enviado incompleto.
    // Se ele é o começo do valor novo e não do antigo, o formulário mandou o novo; se é o começo dos dois, não dá para saber.
    const nv = ctx.audit.newvalue ?? '', ov = ctx.audit.oldvalue ?? '';
    const cut = sent.length >= 3 && sent.length < nv.length && nv.startsWith(sent);
    if (cut && ov.startsWith(sent)) continue;
    verdict = sameVal(sent, nv) || cut ? 'user' : 'server';
    sentValue = sent;
    formAt = t.sys_created_on ?? '';
    formUser = t.sys_created_by ?? ctx.user;
    break;
  }

  const befores = ctx.meta.brField.filter((b) => b.when === 'before');
  // As BRs before rodam em ordem crescente na mesma gravação: cada uma vê o valor que a anterior deixou no campo.
  const seen = new Map<Row, string | undefined>();
  {
    // Gravação pela API ou pelo Workspace sem formulário clássico: o corpo não fica registrado, então o valor que chegou
    // neste campo é desconhecido (pode ter vindo na requisição). Só o formulário clássico mostra o valor enviado.
    const blind = sentValue === undefined && userTx.some((t) => /\/api\//.test(t.url ?? '') && Math.abs(toMs(t.sys_created_on ?? '') - toMs(ctx.at)) <= 3000);
    let running: string | undefined = blind ? undefined : sentValue ?? ctx.audit.oldvalue ?? '';
    for (const b of [...ctx.meta.brField.filter((x) => x.when === 'before')].sort((x, y) => Number(x.order ?? 100) - Number(y.order ?? 100))) {
      seen.set(b, running);
      if (conditionFacts(ctx, brCondition(b), 'sys_script', running).some((f) => f.kind === 'condition_false')) continue;
      const env = envFor(ctx, { mode: 'save', fieldValue: running });
      if (b.condition?.trim()) { const c = evalExpr(b.condition, env); if (c !== true) { if (c === undefined) running = undefined; continue; } }
      const tpl = parseFieldValues(b.template);
      if (ctx.field in tpl) { running = tpl[ctx.field]; continue; }
      const v = scriptVerdict(b.script, ctx.field, env);
      if (!v || !v.writes || v.reachable === false) continue;
      // Grava com certeza um valor conhecido: o próximo vê esse valor; se não dá para saber, o próximo vê "desconhecido".
      running = v.guardsTrue && !v.dynamic && v.values.length === 1 && v.values[0] !== undefined ? v.values[0] : undefined;
    }
  }
  const brFacts = (b: Row) => {
    const fv = seen.has(b) ? seen.get(b) ?? UNKNOWN_VALUE : sentValue;
    const cond = conditionFacts(ctx, brCondition(b), 'sys_script', fv === UNKNOWN_VALUE ? sentValue : fv);
    return [
      fact('references_field', 'sys_script', `referencia "${ctx.field}"`),
      fact('references_table', 'sys_script', `BR da tabela ${b.collection}`),
      ...cond,
      ...brScriptFacts(ctx, b, 'save', cond, fv),
      ...reactsFacts(ctx, [b.script, b.condition, b.filter_condition], 'sys_script'),
    ];
  };
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
    // Client scripts "Mobile / Service Portal" (ui_type 1) não rodam no formulário clássico.
    clientSide.push(...clientEvidence(ctx.traces.clientScripts.filter((c) => c.ui_type !== '1')));
    clientSide.push(...policyEvidence((ctx.traces.uiPolicies ?? []).filter((p) => p.ui_type !== '1')));
    const strongClient = isStrong(clientSide);
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
    const bs = befores.map((b) => ({ e: evidence('br_before', { name: b.name ?? '?', sysId: b.sys_id, table: 'sys_script' }, [...formFacts(), ...brFacts(b)]), row: b }));
    resolveOrder(bs);
    out.push(...bs.map((x) => x.e));
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
    const server: Evidence[] = [];
    const bs = befores.map((b) => ({ e: evidence('br_before', { name: b.name ?? '?', sysId: b.sys_id, table: 'sys_script' }, brFacts(b), gap), row: b }));
    resolveOrder(bs);
    for (const x of bs) if (!surelyWrites(ctx, x.row, conditionFacts(ctx, brCondition(x.row), 'sys_script'))) x.e.facts = x.e.facts.filter((f) => f.kind !== 'sets_same_value');
    server.push(...bs.map((x) => x.e));
    // Data lookups e regras de atribuição também rodam no servidor quando a gravação vem pela API.
    for (const d of lookups.filter((d) => d.runOnUpdate)) server.push(evidence('data_lookup', { name: d.name, sysId: d.sysId, table: 'dl_definition' }, lookupFacts(d), gap));
    for (const rule of ctx.traces.assignmentRules) {
      const facts = [fact('references_table', 'sysrule_assignment', `regra da tabela ${rule.table}`), ...conditionFacts(ctx, rule.condition, 'sysrule_assignment')];
      const target = rule.group || rule.user;
      if (target && target !== (ctx.audit.newvalue ?? '')) facts.push(fact('sets_other_value', 'sysrule_assignment', 'a regra atribui outro valor'));
      else if (target) facts.push(fact('references_field', 'sysrule_assignment', 'a regra atribui exatamente o valor gravado'));
      // A regra grava como "system" dentro do salvamento de outra pessoa: a autoria "system" é a marca dela.
      if (target && target === (ctx.audit.newvalue ?? '') && isSystemUser(ctx.user)) facts.push(fact('trace_identifies_mechanism', 'sys_audit', 'gravado como "system" dentro do salvamento de outra pessoa'));
      server.push(evidence('assignment_rule', { name: rule.name ?? '?', sysId: rule.sys_id, table: 'sysrule_assignment' }, facts, gap));
    }
    out.push(...server);
    // Concorrentes de verdade: automações que podem ter gravado este valor (sem condição falsa e sem gravar outro valor).
    const rivals: Evidence[] = server.filter((e) => !e.facts.some((f) => f.kind === 'condition_false' || f.kind === 'sets_other_value' || f.kind === 'reads_only'));
    // Salvamento pelo Workspace: o botão Salvar roda como /api/now/ui/ui_action/<id>?sysparm_sys_id=<registro>.
    // Os valores enviados não ficam na URL; client scripts "All" (ui_type 10) rodam no Workspace e podem ter preenchido o campo.
    const ws = userTx.find((t) => /\/api\/now\/ui\/ui_action\/[0-9a-f]{32}/.test(t.url ?? '') && Math.abs(toMs(t.sys_created_on ?? '') - toMs(ctx.at)) <= 3000);
    const wsClient = ws ? [...clientEvidence(ctx.traces.clientScripts.filter((c) => c.ui_type === '10')), ...policyEvidence((ctx.traces.uiPolicies ?? []).filter((p) => p.ui_type === '10'))] : [];
    if (wsClient.length) { out.push(...wsClient); rivals.push(...wsClient.filter((e) => isStrong([e]))); }
    // Botão do Workspace com script próprio que cita o campo: quem grava é o botão (assinatura uiAction), não o "Salvar".
    const wsUa = ws ? ctx.traces.uiActions.find((x) => uiActionMatches(x, uiActionRef(ws.url))) : undefined;
    if (wsUa && !isSaveButton(wsUa) && refsField(wsUa.script, ctx.field)) rivals.push(evidence('ui_action', { name: wsUa.name ?? '?' }, []));
    const u = ws ?? userTx[0];
    if (u) {
      const url = u.url ?? '';
      const api = /\/api\//.test(url) && !ws;
      const onRecord = api && url.includes(ctx.sysId) && Math.abs(toMs(u.sys_created_on ?? '') - toMs(ctx.at)) <= 2000;
      const facts = [
        fact('execution_in_window', 'syslog_transaction', ws ? `salvo pelo Workspace às ${u.sys_created_on}` : `${u.type} ${url.split('?')[0]} às ${u.sys_created_on}`),
        fact('user_matches', 'syslog_transaction', `por ${ctx.user}`),
      ];
      let gaps: string[];
      const onWs = !!ws && url.includes(ctx.sysId);
      const who = ctx.traces.users?.[ctx.user];
      if (api && who?.integration) facts.push(fact('integration_user', 'sys_user', `${who.name} é uma conta de integração (só API)`));
      if (onWs) {
        if (!rivals.length && !ctx.meta.incomplete) {
          facts.push(fact('api_write_on_record', 'syslog_transaction', `${ctx.user} salvou este registro pelo Workspace no mesmo instante`));
          facts.push(fact('no_competing_automation', 'sys_script', server.length || wsClient.length ? 'as regras e client scripts que citam o campo não se aplicam a este registro' : 'nenhuma automação ativa grava este campo'));
        } else if (isStrong(wsClient)) facts.push(fact('client_side_possible', 'sys_script_client', 'um client script do Workspace pode ter preenchido o campo antes de salvar'));
        gaps = ['o Workspace não registra os valores enviados; a conclusão vem das regras que poderiam ter gravado este valor'];
      } else if (onRecord && !rivals.length && !ctx.meta.incomplete) {
        facts.push(fact('api_write_on_record', 'syslog_transaction', `${ctx.user} gravou este registro pela API no mesmo instante`));
        facts.push(fact('no_competing_automation', 'sys_script', server.length ? 'as regras que citam o campo não se aplicam a este registro' : 'nenhuma automação ativa grava este campo'));
        gaps = ['o corpo da requisição não fica registrado; a conclusão vem de não haver outra automação capaz de gravar este valor'];
      } else if (viaBatch && !rivals.length && !ctx.meta.incomplete) {
        facts.push(fact('no_competing_automation', 'sys_script', server.length ? 'as regras que citam o campo não se aplicam a este registro' : 'nenhuma automação ativa grava este campo'));
        gaps = ['gravação por um lote da Batch API: o lote não registra quais registros alterou, então a ligação com este registro vem do horário e do usuário'];
      } else if (api) {
        gaps = [rivals.length
          ? `gravação pela API e ${rivals.length === 1 ? 'uma automação do servidor também pode' : `${rivals.length} automações do servidor também podem`} ter gravado este campo; o corpo da requisição não fica registrado`
          : 'gravação pela API: o corpo da requisição não fica registrado, então o valor enviado não pode ser conferido'];
      } else gaps = gap;
      out.push(evidence('user_action', { name: ctx.user }, facts, gaps));
    }
  }
  return out;
}

export { refsField };
