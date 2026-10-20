/**
 * Service worker (MV3). Recebe pedidos, roda o motor com o cliente REST,
 * guarda estado em chrome.storage.session e abre o painel. Não toca no DOM.
 * Nenhum estado em memória que importe: o worker pode ser encerrado a qualquer momento.
 */
import { FetchRestClient, detectAccess, fetchRetention, fetchTokenFromHtml, investigate, previewChange, recordTimeline, scanTableConflicts, type AccessReport, type MetaCache, type TableMeta } from '@trail/core';
import { addInstance, listInstances, removeInstance } from '../shared/instances';
import { loadPrefs, PREFS_KEY, type PanelMode } from '../shared/prefs';
import { storageKey, type Message, type PageContext, type ProbeResult, type TabState } from '../shared/messages';

const session = chrome.storage.session;

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
async function openPanel(tabId: number | undefined, mode?: PanelMode): Promise<void> {
  // Com o modo conhecido, sidePanel.open é chamado antes de qualquer await: o Edge descarta o gesto do usuário
  // assim que a primeira promessa resolve, e o painel lateral deixa de abrir.
  if (mode === 'side') {
    if (tabId !== undefined) await chrome.sidePanel.open({ tabId }).catch(() => { /* já aberto ou sem gesto */ });
    return;
  }
  const m = mode ?? (await loadPrefs()).panelMode;
  if (m === 'window') return openWindow();
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

chrome.runtime.onInstalled.addListener(() => {
  void syncRegistrations();
  chrome.contextMenus.create({ id: 'trail-open', title: 'Trail', contexts: ['page'] });
});
chrome.runtime.onStartup.addListener(() => void syncRegistrations());
chrome.contextMenus.onClicked.addListener((_info, tab) => {
  void openPanel(tab?.id);
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
async function runInvestigation(tabId: number, origin: string, target: { table: string; sysId?: string; number?: string; field: string }, token?: string): Promise<void> {
  await rememberToken(origin, token);
  const prev = await getTab(tabId);
  await setTab({ ...prev, tabId, status: 'running', startedAt: new Date().toISOString(), result: undefined, error: undefined });
  try {
    const client = makeClient(origin);
    const retention = await retentionFor(origin, client);
    const [result, access] = await Promise.all([
      investigate(client, target, { retention }, metaCache(origin)),
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
        const safeCtx: PageContext = { ...msg.ctx, token: undefined }; // o token não fica no estado da aba
        await setTab({ ...(await getTab(tabId)), tabId, ctx: safeCtx });
        return;
      }
      case 'toggle-icons':
        toggleIcons();
        return true;
      case 'timeline':
        return recordTimeline(makeClient(msg.origin), msg.target);
      case 'scan-conflicts':
        return scanTableConflicts(makeClient(msg.origin), msg.table);
      case 'preview':
        return previewChange(makeClient(msg.origin), msg.target);
      case 'investigate': {
        const id = tabId ?? (await activeTabId());
        if (id === undefined) return;
        await openPanel(id, msg.mode);
        await runInvestigation(id, msg.origin, msg.target, msg.token);
        return;
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

chrome.tabs.onRemoved.addListener((tabId) => void session.remove(storageKey.tab(tabId)));
