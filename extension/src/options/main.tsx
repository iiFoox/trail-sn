import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '../shared/ui.css';
import { bootPage, getPrefs, applyTheme, savePrefs, type Prefs } from '../shared/prefs';
import { t } from '../shared/i18n';
import { Glyph, TrailMark } from '../shared/icons';
import { listInstances, type InstanceSettings } from '../shared/instances';
import { send, type ProbeResult } from '../shared/messages';
import type { AccessReport } from '@trail/core';

bootPage();
const s = t(getPrefs().lang);
const isDemo = new URLSearchParams(location.search).has('demo');

function Seg<K extends keyof Prefs>({ k, value, options, onPick }: { k: K; value: Prefs[K]; options: [Prefs[K], string][]; onPick: (k: K, v: Prefs[K]) => void }) {
  return <div class="seg2" role="group">{options.map(([v, label]) => <button aria-pressed={value === v} onClick={() => onPick(k, v)}>{label}</button>)}</div>;
}

function Options() {
  const [list, setList] = useState<InstanceSettings[]>([]);
  const [prefs, setPrefs] = useState<Prefs>(getPrefs());
  const pick = <K extends keyof Prefs>(k: K, v: Prefs[K]) => {
    const next = { ...prefs, [k]: v };
    setPrefs(next);
    if (k === 'theme') applyTheme(v as Prefs['theme']);
    if (isDemo) return;
    void savePrefs({ [k]: v }).then(() => { if (k === 'lang') location.reload(); });
  };
  const refresh = () => void listInstances().then(setList).catch(() => setList([]));
  useEffect(refresh, []);

  return (
    <>
      <header class="topbar"><div class="brand"><span class="mark"><TrailMark /></span>Trail · {s.optionsTitle}</div></header>
      <main class="wrap" style="max-width:720px;margin:0 auto">
        <h2>{s.prefsTitle}</h2>
        <div class="card flat">
          <div class="pref-row"><b>{s.theme}</b><Seg k="theme" value={prefs.theme} onPick={pick} options={[['dark', s.themeDark], ['light', s.themeLight], ['system', s.themeSystem]]} /></div>
          <div class="pref-row"><b>{s.language}</b><Seg k="lang" value={prefs.lang} onPick={pick} options={[['pt', 'Português'], ['en', 'English']]} /></div>
          <div class="pref-row"><b>{s.panelMode}</b><div><Seg k="panelMode" value={prefs.panelMode} onPick={pick} options={[['float', s.panelFloat], ['side', s.panelSide], ['window', s.panelWindow]]} /><div class="muted small" style="margin-top:6px">{s.panelModeHint}</div></div></div>
          <div class="pref-row"><b>{s.showIcons}</b><div><Seg k="showIcons" value={prefs.showIcons} onPick={pick} options={[[true, s.iconsOn], [false, s.iconsOff]]} /><div class="muted small" style="margin-top:6px">{s.shortcut}: <kbd>Alt+Shift+T</kbd> · {s.shortcutHint}</div><div class="muted small" style="margin-top:4px">{s.keysHint}</div></div></div>
          <div class="pref-row"><b>{s.showBubble}</b><Seg k="showBubble" value={prefs.showBubble} onPick={pick} options={[[true, s.iconsOn], [false, s.iconsOff]]} /></div>
        </div>
        <h2>{s.instancesTitle}</h2>
        <div class="card flat">
          {list.length === 0 && <p class="muted" style="margin:0">{s.noInstances}</p>}
          <ul class="list">
            {list.map((i) => (
              <li>
                <span class="ev-icon">{Glyph.plug}</span>
                <div class="grow"><code>{i.origin}</code><div class="muted small">{s.enabledOn} {new Date(i.enabledAt).toLocaleString()}</div></div>
                <button class="btn sm" onClick={() => send({ type: 'clear-cache', origin: i.origin })}>{Glyph.refresh} {s.clearCache}</button>
                <button class="btn sm" onClick={async () => { await send({ type: 'deactivate', origin: i.origin }); await chrome.permissions.remove({ origins: [`${i.origin}/*`] }).catch(() => undefined); refresh(); }}>{s.deactivate}</button>
              </li>
            ))}
          </ul>
        </div>
        {list.length > 0 && <Diagnostics origins={list.map((i) => i.origin)} />}
        <h2>{s.privacyTitle}</h2>
        <div class="card flat"><p class="muted" style="margin:0">{s.privacy}</p></div>
      </main>
    </>
  );
}

/** Diagnóstico técnico, recolhido: probe de autenticação e leitura de cada tabela, com explicação. */
function Diagnostics({ origins }: { origins: string[] }) {
  const [origin, setOrigin] = useState(origins[0]!);
  const [probe, setProbe] = useState<ProbeResult>();
  const [access, setAccess] = useState<AccessReport>();
  const [busy, setBusy] = useState(false);
  const run = async <T,>(f: () => Promise<T>, set: (v: T) => void) => { setBusy(true); try { set(await f()); } finally { setBusy(false); } };
  return (
    <details class="card flat diag">
      <summary><h2 style="margin:0">{s.diagTitle}</h2><span class="muted small">{s.diagHint}</span></summary>
      {origins.length > 1 && <select value={origin} onChange={(e) => setOrigin((e.target as HTMLSelectElement).value)}>{origins.map((o) => <option value={o}>{o}</option>)}</select>}
      <div class="diag-row">
        <div><b>{s.probe}</b><p class="muted small">{s.probeExplain}</p></div>
        <button class="btn sm" disabled={busy} onClick={() => run(() => send<ProbeResult>({ type: 'probe-auth', origin }), setProbe)}>{Glyph.shield} {s.run}</button>
      </div>
      {probe && <table class="simple">{probe.steps.map((st) => <tr><td style="width:18px">{st.ok ? '✅' : '❌'}</td><td>{st.label}</td><td><code>{String(st.status)}</code></td></tr>)}</table>}
      <div class="diag-row">
        <div><b>{s.checkAccess}</b><p class="muted small">{s.accessExplain}</p></div>
        <button class="btn sm" disabled={busy} onClick={() => run(() => send<AccessReport>({ type: 'check-access', origin, force: true }), setAccess)}>{Glyph.refresh} {s.run}</button>
      </div>
      {access && <div><b>{s.accessLevel[access.level]}</b><div class="access-grid" style="margin-top:8px">{Object.entries(access.states).map(([k, v]) => <><code>{k}</code><span class={`state ${v}`}>{s.state[v] ?? v}</span></>)}</div></div>}
    </details>
  );
}

render(<Options />, document.getElementById('app')!);
