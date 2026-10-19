import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import '../shared/ui.css';
import { t } from '../shared/i18n';
import { Glyph, TrailMark } from '../shared/icons';
import { listInstances, type InstanceSettings } from '../shared/instances';
import { send } from '../shared/messages';

const s = t();

function Options() {
  const [list, setList] = useState<InstanceSettings[]>([]);
  const refresh = () => void listInstances().then(setList).catch(() => setList([]));
  useEffect(refresh, []);

  return (
    <>
      <header class="topbar"><div class="brand"><span class="mark"><TrailMark /></span>Trail · {s.optionsTitle}</div></header>
      <main class="wrap" style="max-width:720px;margin:0 auto">
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
