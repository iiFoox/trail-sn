import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '../shared/ui.css';
import { bootPage, getPrefs, applyTheme, savePrefs, type Prefs } from '../shared/prefs';
import { t } from '../shared/i18n';
import { Glyph, TrailMark } from '../shared/icons';
import { listInstances, type InstanceSettings } from '../shared/instances';
import { send } from '../shared/messages';

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
          <div class="pref-row"><b>{s.panelMode}</b><div><Seg k="panelMode" value={prefs.panelMode} onPick={pick} options={[['side', s.panelSide], ['window', s.panelWindow]]} /><div class="muted small" style="margin-top:6px">{s.panelModeHint}</div></div></div>
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
        <h2>{s.privacyTitle}</h2>
        <div class="card flat"><p class="muted" style="margin:0">{s.privacy}</p></div>
      </main>
    </>
  );
}

render(<Options />, document.getElementById('app')!);
