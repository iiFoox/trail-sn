import type { EvidenceType, Grade } from '@trail/core';

type Lang = 'pt' | 'en';

const dict = {
  pt: {
    whyChanged: 'Por que mudou?',
    investigate: 'Investigar',
    table: 'Tabela',
    record: 'Número ou sys_id',
    field: 'Campo',
    manualTitle: 'Investigar um campo',
    noContext: 'Abra um registro na instância ou preencha o formulário abaixo.',
    running: 'Investigando…',
    changes: 'Mudanças',
    noChanges: 'Nenhuma mudança auditada para este campo.',
    unaudited: 'Atualizações sem auditoria',
    unauditedHint: 'O registro tem {n} atualização(ões) a mais do que a auditoria mostra (setWorkflow(false), importação ou campo não auditado).',
    suspects: 'Suspeitos estáticos',
    suspectsHint: 'O que pode escrever neste campo, independentemente das mudanças acima.',
    gaps: 'Lacunas',
    openInStudio: 'abrir',
    by: 'por',
    accessPartial: 'Verifiquei auditoria e metadados, mas não tenho acesso a {sources} nesta instância. Alguns tipos de automação podem não aparecer. Peça ao administrador o papel de leitura do Trail.',
    accessNone: 'Sem acesso ao histórico de auditoria nesta instância, a perícia não funciona. Veja o que pedir ao administrador.',
    activate: 'Ativar nesta instância',
    deactivate: 'Desativar nesta instância',
    activeHere: 'Ativo nesta instância',
    notServiceNow: 'Esta aba não parece ser uma instância ServiceNow.',
    openPanel: 'Abrir painel',
    options: 'Opções',
    probe: 'Testar autenticação (probe)',
    probing: 'Testando…',
    checkAccess: 'Verificar acesso',
    reloadMeta: 'Recarregar metadados',
    accessFull: 'Acesso completo',
    timing: '{calls} chamadas em {ms} ms',
    tracesExpired: 'Rastros de execução de {table} já expiraram para esta data; só suspeitos estáticos e auditoria.',
    grade: { confirmed: 'CONFIRMADO', probable: 'PROVÁVEL', candidate: 'CANDIDATO' } as Record<Grade, string>,
    type: {
      br_async: 'BR assíncrona',
      br_before: 'BR before',
      br_after: 'BR after',
      br_via_script_include: 'BR → script include',
      script_action: 'Script action (evento)',
      ui_action: 'UI action',
      scheduled_job: 'Job agendado',
      flow: 'Flow',
      workflow: 'Workflow',
      background_script: 'Script de fundo',
      user_action: 'Ação direta do usuário',
      server_change: 'Alteração no servidor ao salvar',
      assignment_rule: 'Regra de atribuição',
      unknown_background: 'Processo em segundo plano',
    } as Record<EvidenceType, string>,
  },
  en: {
    whyChanged: 'Why did it change?',
    investigate: 'Investigate',
    table: 'Table',
    record: 'Number or sys_id',
    field: 'Field',
    manualTitle: 'Investigate a field',
    noContext: 'Open a record in the instance or fill in the form below.',
    running: 'Investigating…',
    changes: 'Changes',
    noChanges: 'No audited change for this field.',
    unaudited: 'Unaudited updates',
    unauditedHint: 'The record has {n} more update(s) than the audit shows (setWorkflow(false), import or non-audited field).',
    suspects: 'Static suspects',
    suspectsHint: 'What can write to this field, regardless of the changes above.',
    gaps: 'Gaps',
    openInStudio: 'open',
    by: 'by',
    accessPartial: 'Audit and metadata were read, but this instance denies access to {sources}. Some automation types may be missing. Ask your admin for the Trail read role.',
    accessNone: 'Without access to the audit history on this instance, forensics cannot run. See what to ask your admin.',
    activate: 'Enable on this instance',
    deactivate: 'Disable on this instance',
    activeHere: 'Enabled on this instance',
    notServiceNow: 'This tab does not look like a ServiceNow instance.',
    openPanel: 'Open panel',
    options: 'Options',
    probe: 'Test authentication (probe)',
    probing: 'Testing…',
    checkAccess: 'Check access',
    reloadMeta: 'Reload metadata',
    accessFull: 'Full access',
    timing: '{calls} calls in {ms} ms',
    tracesExpired: 'Execution traces in {table} have expired for this date; only static suspects and audit remain.',
    grade: { confirmed: 'CONFIRMED', probable: 'PROBABLE', candidate: 'CANDIDATE' } as Record<Grade, string>,
    type: {
      br_async: 'Async business rule',
      br_before: 'Before business rule',
      br_after: 'After business rule',
      br_via_script_include: 'BR → script include',
      script_action: 'Script action (event)',
      ui_action: 'UI action',
      scheduled_job: 'Scheduled job',
      flow: 'Flow',
      workflow: 'Workflow',
      background_script: 'Background script',
      user_action: 'Direct user action',
      server_change: 'Server-side change on save',
      assignment_rule: 'Assignment rule',
      unknown_background: 'Background process',
    } as Record<EvidenceType, string>,
  },
};

export type Strings = typeof dict.pt;

export function detectLang(): Lang {
  const l = (typeof navigator !== 'undefined' ? navigator.language : 'pt').toLowerCase();
  return l.startsWith('pt') ? 'pt' : 'en';
}

export function t(lang: Lang = detectLang()): Strings {
  return dict[lang];
}

export function fmt(s: string, vars: Record<string, string | number>): string {
  return s.replace(/\{(\w+)\}/g, (_, k: string) => String(vars[k] ?? ''));
}
