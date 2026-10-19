/**
 * Roda no mundo da página (world: MAIN). Só lê contexto e publica por CustomEvent.
 * Nenhuma chamada de rede, nenhuma alteração no DOM.
 *
 * Expõe: g_ck (X-UserToken), NOW.user_name, g_form.getTableName()/getUniqueValue() no UI16.
 */
(() => {
  const w = window as unknown as {
    g_ck?: string;
    NOW?: { user_name?: string };
    g_form?: { getTableName?: () => string; getUniqueValue?: () => string };
  };

  function publish(): void {
    const detail = {
      token: w.g_ck || undefined,
      userName: w.NOW?.user_name,
      table: safe(() => w.g_form?.getTableName?.()),
      sysId: safe(() => w.g_form?.getUniqueValue?.()),
    };
    document.dispatchEvent(new CustomEvent('trail:context', { detail }));
  }

  function safe<T>(fn: () => T | undefined): T | undefined {
    try { return fn(); } catch { return undefined; }
  }

  publish();
  // O g_form pode carregar depois do script; republica algumas vezes e a pedido.
  let tries = 0;
  const timer = setInterval(() => { publish(); if (++tries >= 5) clearInterval(timer); }, 800);
  document.addEventListener('trail:request-context', publish);
})();
