/** Quanto tempo uma janela de diferença ou de relatório ainda consegue recarregar o que recebeu. */
const KEEP_MS = 30 * 60 * 1000;

/**
 * Entrega dados grandes (scripts da diferença, investigação do relatório) a uma página da extensão aberta em outra
 * janela, pelo chrome.storage.session. A cota é de 10 MB e é a mesma do estado das abas: a cada entrega, as do mesmo
 * tipo com mais de 30 min saem, senão abrir diferenças e PDFs a tarde toda acabava derrubando a investigação.
 */
export async function handoff(kind: 'diff' | 'report', data: unknown): Promise<string> {
  const now = Date.now();
  const all = await chrome.storage.session.get(null).catch(() => ({} as Record<string, unknown>));
  const old = Object.keys(all).filter((k) => k.startsWith(`${kind}:`) && now - Number(k.split(':')[1]) > KEEP_MS);
  if (old.length) await chrome.storage.session.remove(old).catch(() => undefined);
  const key = `${kind}:${now}:${Math.random().toString(36).slice(2)}`;
  await chrome.storage.session.set({ [key]: data });
  return key;
}
