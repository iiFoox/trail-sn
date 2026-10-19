import type { AccessReport } from '@trail/core';
import { useEffect, useState } from 'preact/hooks';
import { t } from '../shared/i18n';
import { isEnabled, looksLikeServiceNow } from '../shared/instances';
import { send, type ProbeResult } from '../shared/messages';

const s = t();

export function App() {
  const [origin, setOrigin] = useState<string>();
  const [isSn, setIsSn] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [probe, setProbe] = useState<ProbeResult>();
  const [probing, setProbing] = useState(false);
  const [access, setAccess] = useState<AccessReport>();
  const [err, setErr] = useState<string>();

  useEffect(() => {
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.url) return;
      const o = new URL(tab.url).origin;
      setOrigin(o);
      setIsSn(looksLikeServiceNow(tab.url));
      setEnabled(await isEnabled(o));
    })();
  }, []);

  const activate = async () => {
    if (!origin) return;
    setErr(undefined);
    // Pedido de permissão de host precisa de gesto do usuário: o clique aqui.
    const ok = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!ok) { setErr('Permissão negada.'); return; }
    await send({ type: 'activate', origin });
    setEnabled(true);
  };
  const deactivate = async () => {
    if (!origin) return;
    await send({ type: 'deactivate', origin });
    await chrome.permissions.remove({ origins: [`${origin}/*`] }).catch(() => undefined);
    setEnabled(false);
  };
  const runProbe = async () => {
    if (!origin) return;
    setProbing(true);
    try { setProbe(await send<ProbeResult>({ type: 'probe-auth', origin })); } finally { setProbing(false); }
  };
  const runAccess = async () => {
    if (!origin) return;
    setAccess(await send<AccessReport>({ type: 'check-access', origin }));
  };

  return (
    <div class="wrap">
      <h1>Trail</h1>
      {origin && <div class="muted"><code>{origin}</code></div>}
      {!isSn && <p class="muted">{s.notServiceNow}</p>}

      <div class="row" style="margin-top:10px">
        {enabled
          ? <button onClick={deactivate}>{s.deactivate}</button>
          : <button class="primary" onClick={activate} disabled={!origin}>{s.activate}</button>}
        <button onClick={() => send({ type: 'open-panel' })}>{s.openPanel}</button>
        <button onClick={() => chrome.runtime.openOptionsPage()}>{s.options}</button>
      </div>
      {enabled && <div class="notice ok" style="margin-top:10px">{s.activeHere}</div>}
      {err && <div class="notice bad">{err}</div>}

      {enabled && (
        <div class="card">
          <div class="row">
            <button onClick={runProbe} disabled={probing}>{probing ? s.probing : s.probe}</button>
            <button onClick={runAccess}>{s.checkAccess}</button>
          </div>
          {probe && (
            <div style="margin-top:8px">
              <table>
                {probe.steps.map((st) => <tr><td>{st.ok ? '✅' : '❌'}</td><td>{st.label}</td><td><code>{String(st.status)}</code></td></tr>)}
              </table>
              <p><b>{probe.conclusion}</b></p>
            </div>
          )}
          {access && (
            <div style="margin-top:8px">
              <div><b>{access.level === 'full' ? s.accessFull : access.level}</b></div>
              <table>
                {Object.entries(access.states).map(([k, v]) => <tr><td><code>{k}</code></td><td>{v}</td></tr>)}
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
