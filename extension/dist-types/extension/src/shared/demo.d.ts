import type { TabState } from './messages';
/**
 * Dados de demonstração do painel (sidepanel/index.html?demo=1&field=<campo>).
 *
 * Um único incidente, INC0010001, com uma história coerente: 14 atualizações (sys_mod_count 14),
 * 13 delas auditadas. Cada mecanismo reproduz um caso que rodou de verdade na PDI de testes
 * (BR async, BR before, script include, script action, script de fundo, job, UI action...).
 * A instância é fictícia de propósito: o site não pode depender de uma PDI que expira.
 */
export declare const DEMO_ORIGIN = "https://sua-instancia.service-now.com";
export declare const DEMO_FIELDS: string[];
/** Estado do painel para o campo pedido; campo desconhecido cai em state. */
export declare function demoState(field?: string): TabState;
/** Rótulo do destino de um link, para o aviso "na extensão, isto abriria...". */
export declare function describeLink(href: string): string;
