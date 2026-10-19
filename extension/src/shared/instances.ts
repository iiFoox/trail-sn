/** Instâncias ativadas pelo usuário (chrome.storage.sync, por origem). */

const KEY = 'instances';

export interface InstanceSettings {
  origin: string;
  enabledAt: string;
}

export async function listInstances(): Promise<InstanceSettings[]> {
  const o = await chrome.storage.sync.get(KEY);
  return (o[KEY] as InstanceSettings[] | undefined) ?? [];
}

export async function isEnabled(origin: string): Promise<boolean> {
  return (await listInstances()).some((i) => i.origin === origin);
}

export async function addInstance(origin: string): Promise<void> {
  const list = (await listInstances()).filter((i) => i.origin !== origin);
  list.push({ origin, enabledAt: new Date().toISOString() });
  await chrome.storage.sync.set({ [KEY]: list });
}

export async function removeInstance(origin: string): Promise<void> {
  const list = (await listInstances()).filter((i) => i.origin !== origin);
  await chrome.storage.sync.set({ [KEY]: list });
}

export function looksLikeServiceNow(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (/\.service-now\.com$/.test(u.hostname) || /\.servicenowservices\.com$/.test(u.hostname) || /now\/nav\/ui|\.do(\?|$)/.test(u.pathname + u.search));
  } catch {
    return false;
  }
}

export function originOf(url: string): string {
  return new URL(url).origin;
}

/** Links para abrir o artefato na instância. */
export function recordLink(origin: string, table: string, sysId: string): string {
  return `${origin}/${table}.do?sys_id=${sysId}`;
}
