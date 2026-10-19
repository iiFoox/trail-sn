/**
 * Service worker (MV3). Recebe pedidos, roda o motor com o cliente REST,
 * guarda estado em chrome.storage.session e abre o painel. Não toca no DOM.
 * Nenhum estado em memória que importe: o worker pode ser encerrado a qualquer momento.
 */
import { FetchRestClient, detectAccess, fetchRetention, fetchTokenFromHtml, investigate, type AccessReport, type MetaCache, type TableMeta } from '@trail/core';
import { addInstance, listInstances, removeInstance } from '../shared/instances';
import { storageKey, type Message, type PageContext, type ProbeResult, type TabState } from '../shared/messages';

const session = chrome.storage.session;

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
chrome.runtime.onInstalled.addListener(() => {
  void syncRegistrations();
  chrome.contextMenus.create({ id: 'trail-open', title: 'Trail', contexts: ['page'] });
});
chrome.runtime.onStartup.addListener(() => void syncRegistrations());
chrome.contextMenus.onClicked.addListener((_info, tab) => {
  if (tab?.id) void chrome.sidePanel.open({ tabId: tab.id });
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
      case 'investigate': {
        const id = tabId ?? (await activeTabId());
        if (id === undefined) return;
        // Abrir o painel precisa de gesto do usuário; o clique no ícone conta.
        await chrome.sidePanel.open({ tabId: id }).catch(() => { /* já aberto ou sem gesto */ });
        await runInvestigation(id, msg.origin, msg.target, msg.token);
        return;
      }
      case 'open-panel': {
        const id = tabId ?? (await activeTabId());
        if (id !== undefined) await chrome.sidePanel.open({ tabId: id });
        return;
      }
      case 'probe-auth':
        return probeAuth(msg.origin);
      case 'check-access':
        return checkAccess(msg.origin, true);
      case 'activate':
        await addInstance(msg.origin);
        await registerScripts(msg.origin);
        return true;
      case 'deactivate':
        await removeInstance(msg.origin);
        await unregisterScripts(msg.origin);
        await clearCache(msg.origin);
        return true;
      case 'clear-cache':
        await clearCache(msg.origin);
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
