/**
 * Roda no mundo da página (world: MAIN). Só lê contexto e publica por CustomEvent.
 * Nenhuma chamada de rede, nenhuma alteração no DOM.
 *
 * Expõe: g_ck (X-UserToken), usuário/idioma da sessão, g_form.getTableName()/getUniqueValue() no UI16.
 */
(() => {
  const w = window as unknown as {
    g_ck?: string;
    g_lang?: string;
    g_user_lang?: string;
    g_user_timezone?: string;
    g_tz?: string;
    NOW?: { user_name?: string; language?: string };
    g_form?: {
      getTableName?: () => string; getUniqueValue?: () => string;
      getControl?: (f: string) => HTMLElement | null; isMandatory?: (f: string) => boolean; hasField?: (f: string) => boolean;
      /** UI16: isReadOnly(ge, control) — com um nome de campo (sem control) responde sempre true. Outros g_form: isReadOnly(campo). */
      isReadOnly?: (...args: unknown[]) => boolean; getGlideUIElement?: (f: string) => unknown;
      isVisible?: (f: string) => boolean; getLabelOf?: (f: string) => string; getFieldNames?: () => string[]; elements?: { fieldName?: string }[];
    };
  };

  function publish(): void {
    const detail = {
      token: w.g_ck || undefined,
      userName: w.NOW?.user_name,
      language: w.g_user_lang || w.NOW?.language || w.g_lang || document.documentElement.lang || undefined,
      // Fuso do usuário no ServiceNow (ex.: America/Los_Angeles): o histórico do formulário mostra datas nele.
      timeZone: w.g_user_timezone || w.g_tz || undefined,
      table: safe(() => w.g_form?.getTableName?.()),
      sysId: safe(() => w.g_form?.getUniqueValue?.()),
    };
    document.dispatchEvent(new CustomEvent('trail:context', { detail }));
  }

  function safe<T>(fn: () => T | undefined): T | undefined {
    try { return fn(); } catch { return undefined; }
  }

  /**
   * Estado do campo no formulário (só leitura do g_form e do DOM): somente leitura, obrigatório, visível.
   * Pedido pelo content script com `trail:request-field-state` (detalhe em JSON); responde com `trail:field-state`.
   * Sem g_form (Workspace, portal) não responde nada: o painel segue sem estado observado.
   */
  function stateOf(f: string, table: string): Record<string, unknown> {
    const g = w.g_form!;
    const byId = (id: string) => document.getElementById(id);
    const box = byId(`element.${table}.${f}`);
    const ctrl = safe(() => g.getControl?.(f)) ?? byId(`${table}.${f}`);
    const display = byId(`sys_display.${table}.${f}`) as HTMLInputElement | null;
    const roMark = byId(`sys_readonly.${table}.${f}`) || byId(`sys_readonly.sys_display.${table}.${f}`);
    const onForm = !!(box || ctrl || display || roMark || safe(() => g.hasField?.(f)));
    const input = (display ?? ctrl) as (HTMLInputElement & { readOnly?: boolean; disabled?: boolean }) | null;
    const domRO = !!roMark || !!(input && (input.readOnly || input.disabled || input.getAttribute('readonly') !== null || input.getAttribute('writeaccess') === 'false' || input.classList.contains('readonly') || input.classList.contains('disabled')));
    // No UI16 o g_form.isReadOnly é (ge, control) e devolve true quando falta o control: chamado só com o nome do campo,
    // dizia "somente leitura" para TODOS os campos (visto no PDI, 21/10/2026). Lá passamos o elemento e o input visível.
    const apiRO = safe(() => {
      if (typeof g.isReadOnly !== 'function') return undefined;
      if (g.isReadOnly.length >= 2) return input ? !!g.isReadOnly(safe(() => g.getGlideUIElement?.(f)), input) : undefined;
      return !!g.isReadOnly(f);
    });
    const style = box ? getComputedStyle(box) : undefined;
    const domVisible = box && style ? !(box.style.display === 'none' || style.display === 'none' || style.visibility === 'hidden') : undefined;
    const apiVisible = safe(() => (typeof g.isVisible === 'function' ? !!g.isVisible(f) : undefined));
    const labelEl = document.querySelector(`label[for="${table}.${f}"], label[for="sys_display.${table}.${f}"], label[for="ni.${table}.${f}"]`);
    const label = safe(() => g.getLabelOf?.(f)) || labelEl?.textContent?.replace(/\s+/g, ' ').trim() || undefined;
    return {
      field: f, label, onForm,
      ...(onForm ? {
        readOnly: apiRO === true || domRO,
        mandatory: safe(() => (typeof g.isMandatory === 'function' ? !!g.isMandatory(f) : undefined)),
        visible: domVisible === false ? false : apiVisible ?? domVisible,
      } : { visible: false }),
    };
  }

  function fieldState(e: Event): void {
    let req: { id?: string; field?: string } = {};
    try { req = JSON.parse(String((e as CustomEvent).detail ?? '{}')) as typeof req; } catch { return; }
    const f = req.field ?? '';
    const table = safe(() => w.g_form?.getTableName?.());
    if (!w.g_form || !table || !/^[a-z0-9_]+$/.test(f)) return;
    const out = { id: req.id, table, sysId: safe(() => w.g_form?.getUniqueValue?.()), ...stateOf(f, table) };
    document.dispatchEvent(new CustomEvent('trail:field-state', { detail: JSON.stringify(out) }));
  }

  /** Todos os campos do formulário, inclusive os escondidos (g_form.elements, nomes do g_form e o DOM do UI16). */
  function formStates(e: Event): void {
    let req: { id?: string } = {};
    try { req = JSON.parse(String((e as CustomEvent).detail ?? '{}')) as typeof req; } catch { return; }
    const g = w.g_form;
    const table = safe(() => g?.getTableName?.());
    if (!g || !table) return;
    const names = new Set<string>();
    for (const el of safe(() => g.elements) ?? []) if (el?.fieldName) names.add(el.fieldName);
    for (const n of safe(() => g.getFieldNames?.()) ?? []) names.add(n);
    const prefix = `element.${table}.`;
    for (const el of document.querySelectorAll<HTMLElement>(`[id^="${prefix}"]`)) names.add(el.id.slice(prefix.length));
    const fields = [...names].filter((f) => /^[a-z0-9_]+$/.test(f) && !f.startsWith('sys_')).slice(0, 300).map((f) => stateOf(f, table));
    const out = { id: req.id, table, sysId: safe(() => g.getUniqueValue?.()), fields };
    document.dispatchEvent(new CustomEvent('trail:form-states', { detail: JSON.stringify(out) }));
  }

  publish();
  document.addEventListener('trail:request-field-state', fieldState);
  document.addEventListener('trail:request-form-states', formStates);
  // O g_form pode carregar depois do script; republica algumas vezes e a pedido.
  let tries = 0;
  const timer = setInterval(() => { publish(); if (++tries >= 5) clearInterval(timer); }, 800);
  document.addEventListener('trail:request-context', publish);
})();
