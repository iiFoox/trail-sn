import type { AccessReport } from '@trail/core';
import { useEffect, useState } from 'preact/hooks';
import { t } from '../shared/i18n';
import { Glyph, TrailMark } from '../shared/icons';
import { isEnabled, looksLikeServiceNow } from '../shared/instances';
import { send, type ProbeResult } from '../shared/messages';

const s = t();
const isDemo = new URLSearchParams(location.search).has('demo');

export function App() {
  const [origin, setOrigin] = useState<string>(isDemo ? 'https://dev457034.service-now.com' : '');
  const [isSn, setIsSn] = useState(isDemo);
  const [enabled, setEnabled] = useState(isDemo);
  const [probe, setProbe] = useState<ProbeResult>();
  const [probing, setProbing] = useState(false);
  const [access, setAccess] = useState<AccessReport>();
  const [err, setErr] = useState<string>();

  useEffect(() => {
    if (isDemo) return;
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!tab?.url) return;
      try {
        const o = new URL(tab.url).origin;
        setOrigin(o);
        setIsSn(looksLikeServiceNow(tab.url));
        setEnabled(await isEnabled(o));
      } catch { /* chrome:// */ }
    })();
  }, []);

  const activate = async () => {
    setErr(undefined);
    const ok = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!ok) { setErr(s.permissionDenied); return; }
    await send({ type: 'activate', origin });
    setEnabled(true);
  };
  const deactivate = async () => {
    await send({ type: 'deactivate', origin });
    await chrome.permissions.remove({ origins: [`${origin}/*`] }).catch(() => undefined);
    setEnabled(false);
  };
  const runProbe = async () => {
    setProbing(true);
    try { setProbe(await send<ProbeResult>({ type: 'probe-auth', origin })); } finally { setProbing(false); }
  };

  return (
    <>
      <header class="topbar">
        <div class="brand"><span class="mark"><TrailMark /></span>Trail</div>
        {enabled && <span class="dot" />}
      </header>
      <main class="wrap">
        <div class="card">
          <div class="kv">
            <span class="k">{s.instance}</span>
            <span class="mono" style="overflow:hidden;text-overflow:ellipsis">{origin ? origin.replace(/^https?:\/\//, '') : '—'}</span>
          </div>
          {!isSn && <p class="muted small" style="margin:8px 0 0">{s.notServiceNow}</p>}
          <div style="margin-top:10px">
            {enabled
              ? <button class="btn toggle" onClick={deactivate}>{Glyph.plug} {s.deactivate}</button>
              : <button class="btn primary toggle" onClick={activate} disabled={!origin || !origin.startsWith('https://')}>{Glyph.plug} {s.activate}</button>}
          </div>
          {err && <div class="notice bad small">{err}</div>}
        </div>

        <div class="row" style="margin-top:10px">
          <button class="btn grow" onClick={() => send({ type: 'open-panel' })}>{Glyph.search} {s.openPanel}</button>
          <button class="btn" onClick={() => chrome.runtime.openOptionsPage()}>{s.options}</button>
        </div>

        {enabled && (
          <div class="card" style="margin-top:10px">
            <div class="row">
              <button class="btn sm" onClick={runProbe} disabled={probing}>{probing ? <span class="spin" /> : Glyph.shield} {probing ? s.probing : s.probe}</button>
              <button class="btn sm" onClick={async () => setAccess(await send<AccessReport>({ type: 'check-access', origin }))}>{s.checkAccess}</button>
            </div>
            {probe && (
              <div style="margin-top:10px">
                <h2 style="margin-top:0">{s.probeTitle}</h2>
                <table class="simple">
                  {probe.steps.map((st) => <tr><td style="width:18px">{st.ok ? '✅' : '❌'}</td><td>{st.label}</td><td><code>{String(st.status)}</code></td></tr>)}
                </table>
                <div class={`notice ${probe.steps.some((x) => x.ok) ? 'ok' : 'bad'} small`}>{probe.conclusion}</div>
              </div>
            )}
            {access && (
              <div style="margin-top:10px">
                <h2 style="margin-top:0">{s.accessLevel[access.level]}</h2>
                <div class="access-grid">
                  {Object.entries(access.states).map(([k, v]) => <><code>{k}</code><span class={`state ${v}`}>{s.state[v] ?? v}</span></>)}
                </div>
              </div>
            )}
          </div>
        )}
      </main>
    </>
  );
}
