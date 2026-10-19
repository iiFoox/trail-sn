import type { AccessReport } from '@trail/core';
import { useEffect, useState } from 'preact/hooks';
import { DEMO_ORIGIN } from '../shared/demo';
import { fmt, t } from '../shared/i18n';
import { applyTheme, getPrefs, loadPrefs, resolvedTheme, savePrefs } from '../shared/prefs';
import { Glyph, TrailMark } from '../shared/icons';
import { isEnabled, looksLikeServiceNow } from '../shared/instances';
import { send } from '../shared/messages';

const s = t(getPrefs().lang);
const isDemo = new URLSearchParams(location.search).has('demo');

export function App() {
  const [origin, setOrigin] = useState<string>(isDemo ? DEMO_ORIGIN : '');
  const [tabId, setTabId] = useState<number>();
  const [isSn, setIsSn] = useState(isDemo);
  const [enabled, setEnabled] = useState(isDemo);
  const [access, setAccess] = useState<AccessReport | undefined>(isDemo ? ({ level: 'full', denied: [], states: {}, checkedAt: '' } as unknown as AccessReport) : undefined);
  const [icons, setIcons] = useState(getPrefs().showIcons);
  const [shortcut, setShortcut] = useState('Alt+Shift+T');
  const [err, setErr] = useState<string>();
  const [theme, setTheme] = useState(resolvedTheme(getPrefs().theme));
  const flipTheme = () => { const next = theme === 'dark' ? 'light' : 'dark'; setTheme(next); applyTheme(next); if (!isDemo) void savePrefs({ theme: next }); };

  useEffect(() => {
    if (isDemo) return;
    void loadPrefs().then((p) => setIcons(p.showIcons));
    void chrome.commands?.getAll().then((c) => { const k = c.find((x) => x.name === 'toggle-icons')?.shortcut; setShortcut(k || 'Alt+Shift+T'); }).catch(() => undefined);
    void (async () => {
      const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (tab?.id !== undefined) setTabId(tab.id);
      if (!tab?.url) return;
      try {
        const o = new URL(tab.url).origin;
        setOrigin(o);
        setIsSn(looksLikeServiceNow(tab.url));
        let on = await isEnabled(o);
        // Permissão já concedida mas instância ainda desligada (o popup fechou durante o pedido): liga agora.
        if (!on && await chrome.permissions.contains({ origins: [`${o}/*`] }).catch(() => false)) {
          await send({ type: 'activate', origin: o });
          on = true;
        }
        setEnabled(on);
        if (on) setAccess(await send<AccessReport>({ type: 'check-access', origin: o, force: false }));
      } catch { /* chrome:// */ }
    })();
  }, []);

  // Chamado direto no clique, sem mensagem ao worker: no Edge o gesto do usuário não sobrevive ao vai e vem.
  const openSide = () => {
    if (isDemo) return;
    if (tabId !== undefined) {
      chrome.sidePanel.open({ tabId }).then(() => window.close(), () => void send({ type: 'open-panel', mode: 'side' }));
    } else void send({ type: 'open-panel', mode: 'side' });
  };

  const connect = async () => {
    setErr(undefined);
    // O worker liga a instância sozinho quando a permissão é concedida, mesmo que este popup feche no meio.
    const ok = await chrome.permissions.request({ origins: [`${origin}/*`] });
    if (!ok) { setErr(s.permissionDenied); return; }
    await send({ type: 'activate', origin });
    setEnabled(true);
    setAccess(await send<AccessReport>({ type: 'check-access', origin, force: false }));
  };
  const disconnect = async () => {
    await send({ type: 'deactivate', origin });
    await chrome.permissions.remove({ origins: [`${origin}/*`] }).catch(() => undefined);
    setEnabled(false);
    setAccess(undefined);
  };
  const toggleIcons = () => { const next = !icons; setIcons(next); if (!isDemo) void savePrefs({ showIcons: next }); };

  const host = origin ? origin.replace(/^https?:\/\//, '') : '—';
  const denied = (access?.denied ?? []).map((d) => s.p.srcName[d] ?? d).join(', ');
  return (
    <>
      <header class="topbar">
        <div class="brand"><span class="mark"><TrailMark /></span>Trail</div>
        <div class="actions"><button class="icon-btn" title={s.toggleTheme} aria-label={s.toggleTheme} onClick={flipTheme}>{theme === 'dark' ? Glyph.sun : Glyph.moon}</button></div>
      </header>
      <main class="wrap pop">
        <div class="card">
          <div class="inst"><span class="k">{s.instance}</span><span class="mono" title={origin}>{host}</span></div>

          {!isSn && !enabled && <p class="muted small">{s.notServiceNow}</p>}

          {isSn && !enabled && (
            <>
              <p class="lead">{s.connectHint}</p>
              <button class="btn primary big full" onClick={connect} disabled={!origin.startsWith('https://')}>{Glyph.plug} {s.activate}</button>
              {err && <div class="notice bad small">{err}</div>}
            </>
          )}

          {enabled && (
            <>
              <div class={`status ${access?.level ?? 'wait'}`}>
                <span class="sdot" />
                <div>
                  <b>{s.connected}</b>
                  <div class="small">{!access ? s.checking : access.level === 'full' ? s.accessFullHint : access.level === 'partial' ? fmt(s.accessPartialHint, { what: denied }) : s.accessNoneHint}</div>
                </div>
              </div>
              <button class="sw" role="switch" aria-checked={icons} onClick={toggleIcons}>
                <span class="grow">{s.showIcons}<small>{s.shortcut} <kbd>{shortcut}</kbd></small></span>
                <span class="knob" />
              </button>
            </>
          )}
        </div>

        <div class="row" style="margin-top:10px">
          <button class="btn primary grow" onClick={openSide}>{Glyph.search} {s.openPanel}</button>
          <button class="btn" title={s.detach} aria-label={s.detach} onClick={() => send({ type: 'open-panel', mode: 'window' })}>{Glyph.detach}</button>
          <button class="btn" title={s.options} aria-label={s.options} onClick={() => chrome.runtime.openOptionsPage()}>{Glyph.gear}</button>
        </div>
        {enabled && <button class="link quiet" onClick={disconnect}>{s.disconnect}</button>}
      </main>
    </>
  );
}
