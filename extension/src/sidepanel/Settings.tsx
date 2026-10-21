/**
 * Configurações dentro do próprio painel (engrenagem do cabeçalho): o que a pessoa mais muda sem sair dele.
 * Grava nas mesmas preferências da página de opções; o content script e as outras páginas acompanham pelo storage.
 */
import { useEffect, useState } from 'preact/hooks';
import { t } from '../shared/i18n';
import { Glyph } from '../shared/icons';
import { applyMotion, applyTheme, comboFromEvent, DEFAULT_PANEL_KEY, getPrefs, savePrefs, type Prefs } from '../shared/prefs';

const s = t(getPrefs().lang);

function Switch({ on, label, hint, onChange }: { on: boolean; label: string; hint?: string; onChange: (v: boolean) => void }) {
  return (
    <label class="st-row">
      <span class="grow"><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <button type="button" role="switch" aria-checked={on} class={`st-sw ${on ? 'on' : ''}`} onClick={() => onChange(!on)}><i /></button>
    </label>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div class="st-row col">
      <b>{label}</b>
      <div class="st-seg" role="radiogroup" aria-label={label}>
        {options.map(([v, text]) => <button type="button" role="radio" aria-checked={value === v} class={value === v ? 'on' : ''} onClick={() => onChange(v)}>{text}</button>)}
      </div>
    </div>
  );
}

export function Settings({ demo, canPin, onPin, onClose }: { demo: boolean; canPin: boolean; onPin: () => void; onClose: () => void }) {
  const [p, setP] = useState<Prefs>(getPrefs());
  const [recording, setRecording] = useState(false);
  const set = (patch: Partial<Prefs>) => {
    const next = { ...p, ...patch };
    setP(next);
    if ('theme' in patch) applyTheme(next.theme);
    if ('motion' in patch) applyMotion(next.motion);
    if (!demo) void savePrefs(patch).then(() => { if ('lang' in patch) location.reload(); });
  };

  // Gravando o atalho: a próxima combinação com Ctrl, Alt ou Meta vira o atalho; Esc cancela.
  useEffect(() => {
    if (!recording) return;
    const k = (e: KeyboardEvent) => {
      e.preventDefault(); e.stopPropagation();
      if (e.key === 'Escape') { setRecording(false); return; }
      const combo = comboFromEvent(e);
      if (combo) { set({ panelKey: combo }); setRecording(false); }
    };
    addEventListener('keydown', k, true);
    return () => removeEventListener('keydown', k, true);
  }, [recording, p]);

  // Esc fecha a folha (e não o painel).
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === 'Escape' && !recording) { e.preventDefault(); onClose(); } };
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [recording]);

  return (
    <div class="st-sheet" role="dialog" aria-modal="true" aria-label={s.stTitle}>
      <div class="st-head">
        <b>{Glyph.gear} {s.stTitle}</b>
        <button class="icon-btn" title={s.stClose} aria-label={s.stClose} onClick={onClose}>{Glyph.close}</button>
      </div>
      <div class="st-body">
        <Choice label={s.stTheme} value={p.theme} options={[['dark', s.stDark], ['light', s.stLight], ['system', s.stSystem]]} onChange={(theme) => set({ theme })} />
        <Choice label={s.stLang} value={p.lang} options={[['pt', 'Português'], ['en', 'English']]} onChange={(lang) => set({ lang })} />
        <Switch on={p.motion} label={s.stMotion} hint={s.stMotionHint} onChange={(motion) => set({ motion })} />
        <div class="st-row">
          <span class="grow"><b>{s.stKey}</b><small>{s.stKeyHint}</small></span>
          <button type="button" class={`st-key ${recording ? 'rec' : ''}`} onClick={() => setRecording(!recording)}>
            {recording ? s.stKeyPress : p.panelKey ? <kbd>{p.panelKey}</kbd> : s.stKeyNone}
          </button>
        </div>
        <div class="st-links">
          {p.panelKey !== DEFAULT_PANEL_KEY && <button type="button" class="btn link sm" onClick={() => set({ panelKey: DEFAULT_PANEL_KEY })}>{s.stKeyReset}</button>}
          {p.panelKey && <button type="button" class="btn link sm" onClick={() => set({ panelKey: '' })}>{s.stKeyOff}</button>}
        </div>
        <Switch on={p.showIcons} label={s.stIcons} hint={s.stIconsHint} onChange={(showIcons) => set({ showIcons })} />
        <Switch on={p.showBubble} label={s.stBubble} hint={s.stBubbleHint} onChange={(showBubble) => set({ showBubble })} />
        <Choice label={s.stMode} value={p.panelMode} options={[['float', s.stModeFloat], ['side', s.stModeSide], ['window', s.stModeWindow]]} onChange={(panelMode) => set({ panelMode })} />
        {canPin && <button type="button" class="btn sm full" onClick={onPin}>{s.floatPin}</button>}
        <button type="button" class="btn link sm" onClick={() => { if (!demo) void chrome.runtime.openOptionsPage(); }}>{s.stAll}</button>
      </div>
    </div>
  );
}
