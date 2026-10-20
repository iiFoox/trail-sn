/**
 * Service worker (MV3). Recebe pedidos, roda o motor com o cliente REST,
 * guarda estado em chrome.storage.session e abre o painel. Não toca no DOM.
 * Nenhum estado em memória que importe: o worker pode ser encerrado a qualquer momento.
 */
import { FetchRestClient, detectAccess, fetchRetention, fetchTokenFromHtml, investigate, batchItemFrom, fieldMap, previewChange, recordTimeline, scanTableConflicts, type AccessReport, type BatchItem, type MetaCache, type TableMeta } from '@trail/core';
import { addInstance, listInstances, removeInstance } from '../shared/instances';
import { loadPrefs, PREFS_KEY, type PanelMode } from '../shared/prefs';
import { normalizeInstanceLanguage, storageKey, type Message, type PageContext, type ProbeResult, type TabState } from '../shared/messages';

const session = chrome.storage.session;

declare const __TRAIL_BUILD_ID__: string;

// Só a instalação sem compactação observa arquivos locais. A versão da loja não usa esse caminho.
async function isDevelopmentInstall(): Promise<boolean> {
  if (chrome.runtime.getManifest().update_url) return false;
  try { return (await chrome.management.getSelf()).installType === 'development'; }
  catch { return false; }
}

let checkingBuild = false;
let reloadingBuild = false;
async function checkBuild(): Promise<void> {
  if (checkingBuild || reloadingBuild) return;
  checkingBuild = true;
  try {
    // getSelf não exige permissão e a chamada à API mantém o worker ativo entre as verificações.
    if (!(await isDevelopmentInstall())) return;
    const response = await fetch(chrome.runtime.getURL('build.txt'), { cache: 'no-store' });
    if (!response.ok) return; // a cópia para a pasta fixa pode estar em andamento
    const diskBuild = (await response.text()).trim();
    if (diskBuild && diskBuild !== __TRAIL_BUILD_ID__) {
      reloadingBuild = true;
      chrome.runtime.reload();
    }
  } catch { /* arquivo temporariamente indisponível; tenta de novo */ }
  finally { checkingBuild = false; }
}

// Alarms exigiria uma permissão nova e tem período mínimo de 30 s. O intervalo de 3 s
// vale enquanto o worker está vivo; getSelf renova sua atividade. Se ele reiniciar,
// o ID embutido no background.js ainda detecta um build copiado durante o sono.
void isDevelopmentInstall().then((development) => {
  if (!development) return;
  void checkBuild();
  setInterval(() => { void checkBuild(); }, 3000);
});

// ---------- abrir o painel: lateral ou janela separada ----------
const WINDOW_KEY = 'panelWindow';
async function openWindow(): Promise<void> {
  const o = await session.get(WINDOW_KEY);
  const id = o[WINDOW_KEY] as number | undefined;
  if (typeof id === 'number') {
    try { await chrome.windows.update(id, { focused: true }); return; } catch { /* foi fechada */ }
  }
  const w = await chrome.windows.create({ url: chrome.runtime.getURL('src/sidepanel/index.html?window=1'), type: 'popup', width: 440, height: 860, focused: true });
  if (w?.id !== undefined) await session.set({ [WINDOW_KEY]: w.id });
}
/**
 * Painel na página (flutuante): pede ao quadro de cima da aba para mostrar. Sem o Trail na aba (instância não conectada,
 * página que não é do ServiceNow), cai para a janela separada, que não depende de gesto do usuário.
 */
async function openFloat(tabId: number, toggle = false): Promise<void> {
  const ok = await chrome.tabs.sendMessage(tabId, { type: toggle ? 'float-toggle' : 'float-open', tabId }, { frameId: 0 }).then((r) => !!r, () => false);
  if (!ok) await openWindow();
}
async function openPanel(tabId: number | undefined, mode?: PanelMode): Promise<void> {
  // Com o modo conhecido, sidePanel.open é chamado antes de qualquer await: o Edge descarta o gesto do usuário
  // assim que a primeira promessa resolve, e o painel lateral deixa de abrir.
  if (mode === 'side') {
    if (tabId !== undefined) await chrome.sidePanel.open({ tabId }).catch(() => { /* já aberto ou sem gesto */ });
    return;
  }
  const m = mode ?? (await loadPrefs()).panelMode;
  if (m === 'window') return openWindow();
  if (m === 'float') { if (tabId !== undefined) await openFloat(tabId); else await openWindow(); return; }
  // Abrir o painel lateral precisa de gesto do usuário; clique no ícone, no popup ou no menu contam.
  if (tabId !== undefined) await chrome.sidePanel.open({ tabId }).catch(() => { /* já aberto ou sem gesto */ });
}
chrome.windows.onRemoved.addListener((id) => void session.get(WINDOW_KEY).then((o) => { if (o[WINDOW_KEY] === id) void session.remove(WINDOW_KEY); }));

// ---------- estado por aba ----------
async function getTab(tabId: number): Promise<TabState> {
  const o = await session.get(storageKey.tab(tabId));
  return (o[storageKey.tab(tabId)] as TabState | undefined) ?? { tabId, status: 'idle' };
}
async function setTab(state: TabState): Promise<void> {
  await session.set({ [storageKey.tab(state.tabId)]: state });
}

async function languageFor(origin: string, tabId?: number, explicit?: string): Promise<string> {
  if (explicit) return normalizeInstanceLanguage(explicit);
  if (tabId !== undefined) {
    const ctx = (await getTab(tabId)).ctx;
    if (ctx?.origin === origin && ctx.language) return normalizeInstanceLanguage(ctx.language);
  }
  const stored = (await session.get(storageKey.language(origin)))[storageKey.language(origin)];
  return normalizeInstanceLanguage(stored);
}

// ---------- token ----------
async function rememberToken(origin: string, token: string | undefined): Promise<void> {
  if (token) await session.set({ [storageKey.token(origin)]: token });
}
async function tokenProvider(origin: string): Promise<string | null> {
  // Caminho rápido: token repassado pelo page/. Fallback: HTML da instância (confirmado na PDI).
  const o = await session.get(storageKey.token(origin));
  const fromPage = o[storageKey.token(origin)] as string | undefined;
  if (fromPage) {
    await session.remove(storageKey.token(origin)); // usa uma vez; se der 401, o próximo pedido cai no HTML
    return fromPage;
  }
  const fromHtml = await fetchTokenFromHtml(origin).catch(() => null);
  return fromHtml;
}
function makeClient(origin: string): FetchRestClient {
  return new FetchRestClient({ baseUrl: origin, getToken: () => tokenProvider(origin), concurrency: 6 });
}

// ---------- cache de metadados (10 min, por instância+tabela) ----------
const META_TTL_MS = 10 * 60 * 1000;
function metaCache(origin: string): MetaCache {
  return {
    async get(table) {
      const key = storageKey.meta(origin, table);
      const o = await session.get(key);
      const v = o[key] as { at: number; meta: TableMeta } | undefined;
      return v && Date.now() - v.at < META_TTL_MS ? v.meta : undefined;
    },
    async set(table, meta) {
      await session.set({ [storageKey.meta(origin, table)]: { at: Date.now(), meta } });
    },
  };
}
async function clearCache(origin: string): Promise<void> {
  const all = await session.get(null);
  const keys = Object.keys(all).filter((k) => k.startsWith(`meta:${origin}:`) || k === storageKey.access(origin));
  if (keys.length) await session.remove(keys);
}

// ---------- ativação por instância ----------
async function registerScripts(origin: string): Promise<void> {
  const id = (kind: string) => `trail-${kind}-${origin.replace(/[^a-z0-9]/gi, '_')}`;
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const have = new Set(existing.map((s) => s.id));
  const matches = [`${origin}/*`];
  const scripts: chrome.scripting.RegisteredContentScript[] = [];
  if (!have.has(id('content'))) scripts.push({ id: id('content'), js: ['content.js'], matches, allFrames: true, runAt: 'document_idle' });
  if (!have.has(id('page'))) scripts.push({ id: id('page'), js: ['page.js'], matches, allFrames: true, runAt: 'document_idle', world: 'MAIN' });
  if (scripts.length) await chrome.scripting.registerContentScripts(scripts);
}
async function unregisterScripts(origin: string): Promise<void> {
  const suffix = origin.replace(/[^a-z0-9]/gi, '_');
  const existing = await chrome.scripting.getRegisteredContentScripts();
  const ids = existing.map((s) => s.id).filter((i) => i.endsWith(suffix));
  if (ids.length) await chrome.scripting.unregisterContentScripts({ ids });
}
async function syncRegistrations(): Promise<void> {
  for (const i of await listInstances()) {
    const granted = await chrome.permissions.contains({ origins: [`${i.origin}/*`] });
    if (granted) await registerScripts(i.origin).catch(() => { /* já registrado */ });
  }
}
/** Scripts antigos continuam nas abas abertas após reload; a pessoa decide quando recarregar o formulário. */
async function notifyOpenTabs(): Promise<void> {
  if (!(await isDevelopmentInstall())) return;
  for (const i of await listInstances()) {
    const granted = await chrome.permissions.contains({ origins: [`${i.origin}/*`] }).catch(() => false);
    if (!granted) continue;
    const tabs = await chrome.tabs.query({ url: `${i.origin}/*` }).catch(() => [] as chrome.tabs.Tab[]);
    for (const tab of tabs) {
      if (tab.id === undefined) continue;
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, func: () => {
        if (document.getElementById('trail-update-notice')) return;
        const pt = (document.documentElement.lang || navigator.language).toLowerCase().startsWith('pt');
        const box = document.createElement('div');
        box.id = 'trail-update-notice';
        box.setAttribute('role', 'status');
        box.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483647;padding:12px 14px;border-radius:10px;background:#16212a;color:#fff;box-shadow:0 8px 24px #0005;font:13px/1.4 system-ui,sans-serif;max-width:320px';
        const text = document.createElement('span');
        text.textContent = pt ? 'O Trail foi atualizado. Recarregue esta aba para usar a nova versão.' : 'Trail was updated. Reload this tab to use the new version.';
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent = pt ? 'Recarregar aba' : 'Reload tab';
        button.style.cssText = 'display:block;margin-top:8px;border:0;background:#5fd3c1;color:#09222a;border-radius:5px;padding:5px 9px;cursor:pointer;font:inherit;font-weight:600';
        button.addEventListener('click', () => location.reload());
        box.append(text, button);
        document.documentElement.appendChild(box);
      } }).catch(() => undefined);
    }
  }
}
/** Liga a instância: guarda, registra os scripts e já injeta nas abas abertas, sem precisar recarregar. */
async function activateOrigin(origin: string): Promise<void> {
  await addInstance(origin);
  await registerScripts(origin);
  const tabs = await chrome.tabs.query({ url: `${origin}/*` }).catch(() => [] as chrome.tabs.Tab[]);
  for (const t of tabs) {
    if (t.id === undefined) continue;
    const already = await chrome.scripting.executeScript({ target: { tabId: t.id }, func: () => !!(window as unknown as { __trailContent?: boolean }).__trailContent }).catch(() => []);
    if (already[0]?.result) continue;
    await chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ['page.js'], world: 'MAIN' }).catch(() => undefined);
    await chrome.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, files: ['content.js'] }).catch(() => undefined);
  }
}
// O pedido de permissão fecha o popup antes de ele avisar o worker; por isso a ativação acontece aqui,
// assim que o navegador concede a permissão, e o usuário não precisa clicar em "conectar" de novo.
chrome.permissions.onAdded.addListener((p) => {
  for (const o of p.origins ?? []) {
    const m = o.match(/^(https:\/\/[^/*]+)\/\*$/);
    if (m?.[1]) void activateOrigin(m[1]);
  }
});

// Atalho (Alt+Shift+T): liga e desliga os ícones nos campos em todas as abas; o content script escuta a mudança.
// O mesmo atalho chega pelo comando da extensão e pela página; se os dois dispararem juntos, conta uma vez só.
let lastToggle = 0;
function toggleIcons(): void {
  if (Date.now() - lastToggle < 500) return;
  lastToggle = Date.now();
  void loadPrefs().then((p) => chrome.storage.sync.set({ [PREFS_KEY]: { ...p, showIcons: !p.showIcons } }));
}
chrome.commands?.onCommand.addListener((cmd) => { if (cmd === 'toggle-icons') toggleIcons(); });

// ---------- clique no ícone da barra ----------
// Botão esquerdo: abre direto o painel (lateral, ou a janela separada se for a preferência).
// Botão direito: o menu do navegador com as opções do Trail (antes ficavam num popup).
async function applyActionBehavior(): Promise<void> {
  const mode = (await loadPrefs()).panelMode;
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: mode === 'side' }).catch(() => undefined);
}
// Só dispara quando o painel lateral não abre sozinho (modos "na página" e "janela").
chrome.action.onClicked.addListener((tab) => {
  void loadPrefs().then((p) => (p.panelMode === 'float' && tab.id !== undefined ? openFloat(tab.id, true) : openWindow()));
});
chrome.storage.onChanged.addListener((ch, area) => { if (area === 'sync' && ch[PREFS_KEY]) void applyActionBehavior(); });

function createMenus(): void {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: 'trail-open', title: 'Trail', contexts: ['page'] });
    chrome.contextMenus.create({ id: 'trail-float', title: menuText('float'), contexts: ['action'] });
    chrome.contextMenus.create({ id: 'trail-side', title: menuText('side'), contexts: ['action'] });
    chrome.contextMenus.create({ id: 'trail-window', title: menuText('window'), contexts: ['action'] });
    chrome.contextMenus.create({ id: 'trail-icons', title: menuText('icons'), contexts: ['action'] });
    chrome.contextMenus.create({ id: 'trail-options', title: menuText('options'), contexts: ['action'] });
  });
}
function menuText(k: 'float' | 'side' | 'window' | 'icons' | 'options'): string {
  const pt = { float: 'Abrir na página', side: 'Abrir no painel lateral', window: 'Abrir em janela separada', icons: 'Mostrar ou esconder os ícones nos campos (Alt+Shift+T)', options: 'Opções do Trail' };
  const en = { float: 'Open on the page', side: 'Open in the side panel', window: 'Open in a separate window', icons: 'Show or hide the field icons (Alt+Shift+T)', options: 'Trail options' };
  return (chrome.i18n?.getUILanguage?.().startsWith('pt') ? pt : en)[k];
}
chrome.runtime.onInstalled.addListener((details) => {
  void syncRegistrations(); createMenus(); void applyActionBehavior();
  if (details.reason === 'update') void notifyOpenTabs();
});
chrome.runtime.onStartup.addListener(() => { void syncRegistrations(); createMenus(); void applyActionBehavior(); });
chrome.contextMenus.onClicked.addListener((info, tab) => {
  switch (info.menuItemId) {
    case 'trail-side': if (tab?.id !== undefined) void chrome.sidePanel.open({ tabId: tab.id }).catch(() => undefined); return;
    case 'trail-float': if (tab?.id !== undefined) void openFloat(tab.id); return;
    case 'trail-window': void openWindow(); return;
    case 'trail-icons': toggleIcons(); return;
    case 'trail-options': void chrome.runtime.openOptionsPage(); return;
    default: void openPanel(tab?.id);
  }
});

// ---------- probe de autenticação ----------
/**
 * Responde à pendência da arquitetura: a partir do service worker, o GET à Table API
 * funciona com cookie puro? Precisa de X-UserToken? O token vindo do HTML serve
 * mesmo com Origin chrome-extension://? Três GETs, nada é gravado.
 */
async function probeAuth(origin: string): Promise<ProbeResult> {
  const url = `${origin}/api/now/table/sys_properties?sysparm_limit=1&sysparm_fields=sys_id`;
  const steps: ProbeResult['steps'] = [];
  const get = async (label: string, headers: Record<string, string>) => {
    try {
      const r = await fetch(url, { headers: { Accept: 'application/json', ...headers }, credentials: 'include' });
      const body = (await r.text()).slice(0, 120);
      steps.push({ label, status: r.status, ok: r.status === 200, detail: body });
      return r.status;
    } catch (e) {
      steps.push({ label, status: String(e), ok: false });
      return 0;
    }
  };
  const s1 = await get('GET só com cookie (sem X-UserToken)', {});
  const o = await session.get(storageKey.token(origin));
  const pageToken = o[storageKey.token(origin)] as string | undefined;
  let tokenSource: ProbeResult['tokenSource'] = 'none';
  let s2 = 0;
  if (pageToken) {
    tokenSource = 'page';
    s2 = await get('GET com X-UserToken vindo da página', { 'X-UserToken': pageToken });
  }
  const htmlToken = await fetchTokenFromHtml(origin).catch(() => null);
  let s3 = 0;
  if (htmlToken) {
    if (tokenSource === 'none') tokenSource = 'html';
    s3 = await get('GET com X-UserToken obtido do HTML (/navpage.do)', { 'X-UserToken': htmlToken });
  } else {
    steps.push({ label: 'Obter g_ck do HTML (/navpage.do)', status: 'não encontrado', ok: false });
  }
  const conclusion =
    s1 === 200 ? 'Cookie puro basta: g_ck é opcional neste contexto.' :
    s2 === 200 || s3 === 200 ? `g_ck é obrigatório e funciona a partir do service worker (fonte: ${s3 === 200 ? 'HTML' : 'página'}).` :
    s1 === 401 || s2 === 401 || s3 === 401 ? 'Nem cookie nem token funcionaram: verifique se está logado e se a permissão de host foi concedida.' :
    'Resultado inconclusivo; veja os passos.';
  const result: ProbeResult = { origin, checkedAt: new Date().toISOString(), tokenSource, steps, conclusion };
  await session.set({ [storageKey.probe(origin)]: result });
  return result;
}

// ---------- acesso ----------
async function checkAccess(origin: string, force = false): Promise<AccessReport> {
  const key = storageKey.access(origin);
  if (!force) {
    const o = await session.get(key);
    const cached = o[key] as AccessReport | undefined;
    if (cached) return cached;
  }
  const report = await detectAccess(makeClient(origin));
  await session.set({ [key]: report });
  return report;
}

async function retentionFor(origin: string, client: FetchRestClient) {
  const key = `retention:${origin}`;
  const o = await session.get(key);
  if (o[key]) return o[key] as Awaited<ReturnType<typeof fetchRetention>>;
  const r = await fetchRetention(client).catch(() => ({}));
  await session.set({ [key]: r });
  return r;
}

// ---------- investigação ----------
/** Investiga o mesmo campo em vários registros (selecionados na lista), três de cada vez, com o cache da tabela. */
async function runBatch(tabId: number, origin: string, table: string, field: string, sysIds: string[], language: string, token?: string): Promise<void> {
  await rememberToken(origin, token);
  const started = Date.now();
  const items: BatchItem[] = sysIds.map((sysId) => ({ sysId, display: sysId, status: 'pending' }));
  const save = async (status: 'running' | 'done') => setTab({ ...(await getTab(tabId)), tabId, status: 'idle', result: undefined, error: undefined, batch: { table, field, items: [...items], status, startedAt: new Date(started).toISOString(), ...(status === 'done' ? { ms: Date.now() - started } : {}) } });
  await save('running');
  const client = makeClient(origin);
  const retention = await retentionFor(origin, client);
  let next = 0;
  let last = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try {
        const r = await investigate(client, { table, sysId: items[i]!.sysId, field }, { retention, language }, metaCache(origin));
        items[i] = batchItemFrom(r);
      } catch (e) { items[i] = { ...items[i]!, status: 'error', error: (e as Error).message }; }
      // Atualiza o painel no máximo a cada 700 ms (cada gravação no storage redesenha o painel).
      if (Date.now() - last > 700) { last = Date.now(); await save('running'); }
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  await save('done');
}

/** Registro inteiro: investiga cada campo que mudou no registro (os mais recentes primeiro, até 25 campos). */
async function runRecord(tabId: number, origin: string, table: string, record: string, language: string, token?: string): Promise<void> {
  await rememberToken(origin, token);
  const started = Date.now();
  const client = makeClient(origin);
  const base = { table, field: '*', kind: 'fields' as const, startedAt: new Date(started).toISOString() };
  const fail = async (error: string) => setTab({ ...(await getTab(tabId)), tabId, status: 'idle', result: undefined, batch: { ...base, items: [], status: 'done', error } });
  await setTab({ ...(await getTab(tabId)), tabId, status: 'idle', result: undefined, error: undefined, batch: { ...base, items: [], status: 'running' } });
  try {
    const isId = /^[0-9a-f]{32}$/.test(record);
    const rec = (await client.query({ table, query: isId ? `sys_id=${record}` : `number=${record}`, fields: ['sys_id', 'number', 'name', 'short_description'], limit: 1 })).rows[0];
    if (!rec?.sys_id) return fail(record);
    const display = rec.number || rec.name || rec.sys_id;
    const audit = (await client.query({ table: 'sys_audit', query: `documentkey=${rec.sys_id}^ORDERBYDESCsys_created_on`, fields: ['fieldname'], limit: 400 })).rows;
    const journal = new Set(['comments', 'work_notes', 'comments_and_work_notes', 'approval_history']);
    const fields = [...new Set(audit.map((a) => a.fieldname ?? '').filter((f) => f && !f.startsWith('sys_') && !journal.has(f)))].slice(0, 25);
    // Rótulos dos campos já na lista de espera: a pessoa vê "Service", não business_service, desde o começo.
    const dict = fields.length ? (await client.query({ table: 'sys_dictionary', query: `nameIN${table},task,cmdb_ci^elementIN${fields.join(',')}`, fields: ['name', 'element', 'column_label'], limit: 200 }).catch(() => ({ rows: [] as Record<string, string>[] }))).rows : [];
    const rank = (n?: string) => (n === table ? 0 : n === 'task' ? 1 : 2);
    const lbl: Record<string, string> = {};
    for (const d of [...dict].sort((a, b) => rank(a.name) - rank(b.name))) if (d.element && d.column_label && !(d.element in lbl)) lbl[d.element] = d.column_label;
    const items: BatchItem[] = fields.map((f) => ({ sysId: rec.sys_id!, display, field: f, ...(lbl[f] ? { label: lbl[f] } : {}), status: 'pending' }));
    const save = async (status: 'running' | 'done') => setTab({ ...(await getTab(tabId)), tabId, status: 'idle', result: undefined, batch: { ...base, sysId: rec.sys_id, display, items: [...items], status, ...(status === 'done' ? { ms: Date.now() - started } : {}) } });
    await save('running');
    const retention = await retentionFor(origin, client);
    let next = 0, last = 0;
    const worker = async () => {
      while (next < items.length) {
        const i = next++;
        try { const prev = items[i]!; const done = batchItemFrom(await investigate(client, { table, sysId: rec.sys_id!, field: prev.field! }, { retention, language }, metaCache(origin))); items[i] = { ...done, field: prev.field!, label: done.label ?? prev.label ?? prev.field! }; }
        catch (e) { items[i] = { ...items[i]!, status: 'error', error: (e as Error).message }; }
        if (Date.now() - last > 700) { last = Date.now(); await save('running'); }
      }
    };
    await Promise.all([worker(), worker(), worker()]);
    await save('done');
  } catch (e) { await fail((e as Error).message); }
}

async function runInvestigation(tabId: number, origin: string, target: { table: string; sysId?: string; number?: string; field: string }, language: string, token?: string): Promise<void> {
  await rememberToken(origin, token);
  const prev = await getTab(tabId);
  await setTab({ ...prev, tabId, status: 'running', startedAt: new Date().toISOString(), result: undefined, error: undefined, batch: undefined });
  try {
    const client = makeClient(origin);
    const retention = await retentionFor(origin, client);
    const [result, access] = await Promise.all([
      investigate(client, target, { retention, language }, metaCache(origin)),
      checkAccess(origin),
    ]);
    await setTab({ ...(await getTab(tabId)), status: 'done', result, access });
  } catch (e) {
    await setTab({ ...(await getTab(tabId)), status: 'error', error: (e as Error).message });
  }
}

// ---------- mensagens ----------
chrome.runtime.onMessage.addListener((msg: Message, sender, sendResponse) => {
  (async () => {
    const tabId = sender.tab?.id;
    switch (msg.type) {
      case 'context': {
        if (tabId === undefined) return;
        await rememberToken(msg.ctx.origin, msg.ctx.token);
        const prev = await getTab(tabId);
        const language = msg.ctx.language ?? (prev.ctx?.origin === msg.ctx.origin ? prev.ctx.language : undefined);
        const safeCtx: PageContext = { ...msg.ctx, token: undefined, language }; // o token não fica no estado da aba
        await setTab({ ...prev, tabId, ctx: safeCtx });
        if (msg.ctx.language) await session.set({ [storageKey.language(msg.ctx.origin)]: normalizeInstanceLanguage(msg.ctx.language) });
        return;
      }
      case 'toggle-icons':
        toggleIcons();
        return true;
      case 'timeline':
        return recordTimeline(makeClient(msg.origin), msg.target, { language: await languageFor(msg.origin, tabId ?? (await activeTabId()), msg.language) });
      case 'scan-conflicts':
        return scanTableConflicts(makeClient(msg.origin), msg.table);
      case 'field-map':
        return fieldMap(makeClient(msg.origin), { table: msg.table, field: msg.field });
      case 'preview':
        return previewChange(makeClient(msg.origin), { ...msg.target, language: await languageFor(msg.origin, tabId ?? (await activeTabId()), msg.language) });
      case 'investigate': {
        const id = tabId ?? (await activeTabId());
        if (id === undefined) return;
        await openPanel(id, msg.mode);
        await runInvestigation(id, msg.origin, msg.target, await languageFor(msg.origin, id, msg.language), msg.token);
        return;
      }
      case 'record': {
        const id = tabId ?? (await activeTabId());
        if (id === undefined) return;
        await openPanel(id, msg.mode);
        await runRecord(id, msg.origin, msg.table, msg.record, await languageFor(msg.origin, id, msg.language), msg.token);
        return;
      }
      case 'batch': {
        const id = tabId ?? (await activeTabId());
        if (id === undefined) return;
        await openPanel(id, msg.mode);
        await runBatch(id, msg.origin, msg.table, msg.field, msg.sysIds.slice(0, 200), await languageFor(msg.origin, id, msg.language), msg.token);
        return;
      }
      case 'float-get': {
        if (tabId === undefined) return;
        const k = `float:${tabId}`;
        return { tabId, ...((await session.get(k))[k] as { open?: boolean; min?: boolean } | undefined ?? {}) };
      }
      case 'float-set': {
        if (tabId === undefined) return;
        await session.set({ [`float:${tabId}`]: { open: msg.open, min: msg.min } });
        return true;
      }
      case 'open-panel': {
        await openPanel(tabId ?? (await activeTabId()), msg.mode);
        return;
      }
      case 'probe-auth':
        return probeAuth(msg.origin);
      case 'check-access':
        return checkAccess(msg.origin, msg.force ?? true);
      case 'activate':
        await activateOrigin(msg.origin);
        return true;
      case 'deactivate':
        await removeInstance(msg.origin);
        await unregisterScripts(msg.origin);
        await clearCache(msg.origin);
        return true;
      case 'clear-cache':
        await clearCache(msg.origin);
        return true;
      case 'open-diff-popup':
        await chrome.windows.create({ url: chrome.runtime.getURL(`src/diff/index.html?k=${encodeURIComponent(msg.key)}`), type: 'popup', width: 1200, height: 860 });
        return true;
    }
  })().then(sendResponse, (e: Error) => sendResponse({ error: e.message }));
  return true;
});

async function activeTabId(): Promise<number | undefined> {
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab?.id;
}

chrome.tabs.onRemoved.addListener((tabId) => void session.remove([storageKey.tab(tabId), `float:${tabId}`]));
