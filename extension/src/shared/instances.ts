/** Instâncias ativadas pelo usuário (chrome.storage.sync, por origem). */

export const INSTANCES_KEY = 'instances';
const KEY = INSTANCES_KEY;

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

/**
 * Endereço com cara de ServiceNow: só os domínios do próprio ServiceNow. Instância com domínio próprio não é
 * adivinhada pelo caminho (qualquer site tem .do): ela é conectada de propósito nas opções (connectableOrigin) e,
 * a partir daí, reconhecida por estar na lista de instâncias.
 */
export function looksLikeServiceNow(url: string | undefined): boolean {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (/\.service-now\.com$/.test(u.hostname) || /\.servicenowservices\.com$/.test(u.hostname));
  } catch {
    return false;
  }
}

/** Origem https que o usuário digitou nas opções para conectar uma instância com domínio próprio. */
export function connectableOrigin(input: string): string | undefined {
  const raw = input.trim();
  if (!raw) return undefined;
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (u.protocol !== 'https:' || !u.hostname.includes('.') || u.username || u.password) return undefined;
    return u.origin;
  } catch {
    return undefined;
  }
}

export function originOf(url: string): string {
  return new URL(url).origin;
}

/** Links para abrir o artefato na instância. */
export function recordLink(origin: string, table: string, sysId: string): string {
  return `${origin}/${table}.do?sys_id=${sysId}`;
}
