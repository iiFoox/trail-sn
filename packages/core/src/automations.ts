/**
 * "O que roda neste registro": tudo que está ativo para a tabela (e as tabelas-pai), separado por tipo, para a seção
 * do registro inteiro. Diferente do mapa de automações (fieldMap), não filtra por campo: mostra o desenho da tabela.
 * Só leitura, com o acesso de quem está logado; cada fonte negada fica marcada em `access` e o grupo some.
 */
import type { RestClient } from './client/RestClient';
import { writtenFields } from './conflicts';
import { recordFlows, type RecordFlows } from './flows';
import type { AccessState, Row } from './types';
import { failureLog, walkHierarchy } from './util';

export interface AutomationItem {
  sysId: string;
  name: string;
  /** Tabela onde está definida (a do registro ou uma tabela-pai). */
  table: string;
  /** Detalhe curto: "before · ordem 100 · ao atualizar", "onChange de state"... */
  detail: string;
  /** Campos que grava, quando dá para ler no script. */
  writes: string[];
  scope?: string;
}

export interface TableAutomations {
  table: string;
  tables: string[];
  businessRules: AutomationItem[];
  /** Script includes chamados pelas regras de negócio acima (com quem chama). */
  scriptIncludes: AutomationItem[];
  clientScripts: AutomationItem[];
  uiPolicies: AutomationItem[];
  uiActions: AutomationItem[];
  dataLookups: AutomationItem[];
  assignmentRules: AutomationItem[];
  jobs: AutomationItem[];
  flows?: RecordFlows;
  access: Record<string, AccessState>;
  /** Fontes que não responderam (prazo, 5xx, página de login): o resultado pode estar incompleto. */
  missing?: string[];
  timing: { totalMs: number; calls: number };
}

const WHEN_ORDER: Record<string, number> = { display: 0, before: 1, after: 2, async: 3, async_always: 3 };

export async function tableAutomations(client: RestClient, target: { table: string; sysId?: string }, opts: { lang?: 'pt' | 'en' } = {}): Promise<TableAutomations> {
  const started = Date.now();
  const calls0 = client.calls;
  const access: Record<string, AccessState> = {};
  const q = async (table: string, query: string, fields: string[], limit: number): Promise<Row[]> => {
    try {
      const r = await client.query({ table, query, fields, limit });
      // A resposta seguinte à mesma fonte vale mais que a falha (a hierarquia repete o passo); o que ficou sem resposta
      // no fim volta como lento, abaixo.
      const prev = access[table];
      if (!prev || prev === 'empty' || prev === 'unknown' || (prev === 'timeout' && r.access !== 'timeout')) access[table] = r.access;
      fails.note({ table, query, fields, limit }, r.access);
      return r.rows;
    } catch { fails.note({ table, query, fields, limit }, 'unknown'); return []; }
  };
  // Fonte sem resposta vira lista vazia, mas fica anotada: o painel avisa que a lista pode estar incompleta.
  const fails = failureLog();
  const { tables } = await walkHierarchy(q, target.table);
  const inT = `IN${tables.join(',')}`;
  const en = opts.lang === 'en';
  const [brs, cs, pols, uas, dls, rules, jobs, flows] = await Promise.all([
    q('sys_script', `collection${inT}^active=true^ORDERBYorder`, ['sys_id', 'name', 'when', 'order', 'collection', 'script', 'template', 'action_insert', 'action_update', 'action_delete', 'action_query', 'sys_scope.name'], 500),
    q('sys_script_client', `table${inT}^active=true`, ['sys_id', 'name', 'type', 'field', 'table', 'sys_scope.name'], 300),
    q('sys_ui_policy', `table${inT}^active=true^ORDERBYorder`, ['sys_id', 'short_description', 'table', 'order', 'run_scripts', 'sys_scope.name'], 300),
    q('sys_ui_action', `table${inT}^active=true^ORDERBYorder`, ['sys_id', 'name', 'table', 'action_name', 'form_button', 'list_button', 'sys_scope.name'], 300),
    q('dl_definition', `source_table${inT}^active=true`, ['sys_id', 'name', 'source_table', 'sys_scope.name'], 50),
    q('sysrule_assignment', `table${inT}^active=true^ORDERBYorder`, ['sys_id', 'name', 'table', 'order'], 100),
    q('sysauto_script', `active=true^scriptLIKE${target.table}`, ['sys_id', 'name', 'run_type', 'sys_scope.name'], 50),
    target.sysId ? recordFlows(client, { table: target.table, sysId: target.sysId }, opts).catch(() => undefined) : Promise.resolve(undefined),
  ]);

  const scope = (r: Row) => (r['sys_scope.name'] ? { scope: r['sys_scope.name'] } : {});
  const ops = (b: Row) => {
    const o = [b.action_insert === 'true' && (en ? 'insert' : 'ao criar'), b.action_update === 'true' && (en ? 'update' : 'ao atualizar'), b.action_delete === 'true' && (en ? 'delete' : 'ao apagar'), b.action_query === 'true' && (en ? 'query' : 'ao consultar')].filter(Boolean);
    return o.join(', ');
  };
  const businessRules = brs
    .sort((a, b) => (WHEN_ORDER[a.when ?? ''] ?? 9) - (WHEN_ORDER[b.when ?? ''] ?? 9) || Number(a.order ?? 0) - Number(b.order ?? 0))
    .map((b): AutomationItem => ({
      sysId: b.sys_id ?? '', name: b.name ?? '?', table: b.collection ?? '',
      detail: [b.when, b.order ? `${en ? 'order' : 'ordem'} ${b.order}` : '', ops(b)].filter(Boolean).join(' · '),
      writes: writtenFields(b.script, b.template), ...scope(b),
    }));

  // Script includes chamados pelas BRs: "new Nome(" ou "Nome.metodo(" com inicial maiúscula.
  const callers = new Map<string, string[]>();
  for (const b of brs) for (const m of (b.script ?? '').matchAll(/(?:new\s+|\b)([A-Z][A-Za-z0-9_]{2,})\s*(?:\(|\.\w+\s*\()/g)) {
    const n = m[1]!;
    if (['GlideRecord', 'GlideAggregate', 'GlideDateTime', 'GlideDate', 'GlideSysAttachment', 'JSON', 'Math', 'Date', 'String', 'Number', 'Object', 'Array', 'RegExp'].includes(n)) continue;
    const list = callers.get(n) ?? [];
    if (!list.includes(b.name ?? '')) list.push(b.name ?? '');
    callers.set(n, list);
  }
  const siRows = callers.size ? await q('sys_script_include', `nameIN${[...callers.keys()].slice(0, 60).join(',')}^active=true`, ['sys_id', 'name', 'sys_scope.name'], 60) : [];
  const scriptIncludes = siRows.map((s): AutomationItem => ({
    sysId: s.sys_id ?? '', name: s.name ?? '?', table: 'sys_script_include',
    detail: `${en ? 'called by' : 'chamado por'} ${(callers.get(s.name ?? '') ?? []).join(', ')}`, writes: [], ...scope(s),
  }));

  for (const t of fails.missing()) if (access[t] !== 'denied' && access[t] !== 'no_filter') access[t] = 'timeout';
  return {
    table: target.table, tables, businessRules, scriptIncludes,
    clientScripts: cs.map((c) => ({ sysId: c.sys_id ?? '', name: c.name ?? '?', table: c.table ?? '', detail: c.type === 'onChange' && c.field ? `onChange ${en ? 'of' : 'de'} ${c.field}` : c.type ?? '', writes: [], ...scope(c) })),
    uiPolicies: pols.map((p) => ({ sysId: p.sys_id ?? '', name: p.short_description ?? '?', table: p.table ?? '', detail: `${en ? 'order' : 'ordem'} ${p.order ?? 0}${p.run_scripts === 'true' ? (en ? ' · runs scripts' : ' · roda script') : ''}`, writes: [], ...scope(p) })),
    uiActions: uas.map((u) => ({ sysId: u.sys_id ?? '', name: u.name ?? '?', table: u.table ?? '', detail: [u.action_name, u.form_button === 'true' ? (en ? 'form button' : 'botão do formulário') : '', u.list_button === 'true' ? (en ? 'list button' : 'botão da lista') : ''].filter(Boolean).join(' · '), writes: [], ...scope(u) })),
    dataLookups: dls.map((d) => ({ sysId: d.sys_id ?? '', name: d.name ?? '?', table: d.source_table ?? '', detail: '', writes: [], ...scope(d) })),
    assignmentRules: rules.map((r) => ({ sysId: r.sys_id ?? '', name: r.name ?? '?', table: r.table ?? '', detail: `${en ? 'order' : 'ordem'} ${r.order ?? 0}`, writes: ['assignment_group', 'assigned_to'], })),
    jobs: jobs.map((j) => ({ sysId: j.sys_id ?? '', name: j.name ?? '?', table: 'sysauto_script', detail: j.run_type ?? '', writes: [], ...scope(j) })),
    ...(flows ? { flows } : {}),
    access,
    ...(fails.missing().length ? { missing: fails.missing() } : {}),
    timing: { totalMs: Date.now() - started, calls: client.calls - calls0 },
  };
}
