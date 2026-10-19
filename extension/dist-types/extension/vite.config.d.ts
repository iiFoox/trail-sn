/**
 * Build principal: páginas (popup, painel lateral, opções) e o service worker,
 * todos como módulos ES. Os scripts injetados na página (content/ e page/) são
 * IIFE e saem de vite.scripts.config.ts, porque não podem importar módulos.
 */
declare const _default: import("vite").UserConfig & Promise<import("vite").UserConfig> & import("vite").UserConfigFnObject & import("vite").UserConfigFnPromise & import("vite").UserConfigFn;
export default _default;
