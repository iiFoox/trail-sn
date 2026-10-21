import { describe, expect, it } from 'vitest';
import { comboFromEvent, DEFAULT_PANEL_KEY, normalize } from '../src/shared/prefs';

function keyEvent(code: string, mods: { ctrlKey?: boolean; altKey?: boolean; shiftKey?: boolean; metaKey?: boolean } = {}): KeyboardEvent {
  return {
    code,
    ctrlKey: !!mods.ctrlKey,
    altKey: !!mods.altKey,
    shiftKey: !!mods.shiftKey,
    metaKey: !!mods.metaKey,
  } as unknown as KeyboardEvent;
}

describe('preferências e atalho do painel', () => {
  it('normalize preenche motion=true e panelKey="Alt+Shift+P" por padrão e respeita valores salvos', () => {
    const def = normalize(undefined);
    expect(def.motion).toBe(true);
    expect(def.panelKey).toBe('Alt+Shift+P');
    expect(def.panelKey).toBe(DEFAULT_PANEL_KEY);

    const saved = normalize({ motion: false, panelKey: 'Ctrl+Alt+P', theme: 'light', lang: 'en' });
    expect(saved.motion).toBe(false);
    expect(saved.panelKey).toBe('Ctrl+Alt+P');
    expect(saved.theme).toBe('light');
    expect(saved.lang).toBe('en');

    const disabledKey = normalize({ motion: true, panelKey: '' });
    expect(disabledKey.motion).toBe(true);
    expect(disabledKey.panelKey).toBe('');
  });

  it('comboFromEvent devolve Ctrl+Alt+P, Alt+Shift+7, Alt+F2 e null sem Ctrl/Alt/Meta', () => {
    expect(comboFromEvent(keyEvent('KeyP', { ctrlKey: true, altKey: true }))).toBe('Ctrl+Alt+P');
    expect(comboFromEvent(keyEvent('Digit7', { altKey: true, shiftKey: true }))).toBe('Alt+Shift+7');
    expect(comboFromEvent(keyEvent('F2', { altKey: true }))).toBe('Alt+F2');

    expect(comboFromEvent(keyEvent('KeyP'))).toBeNull();
    expect(comboFromEvent(keyEvent('KeyP', { shiftKey: true }))).toBeNull();
    expect(comboFromEvent(keyEvent('F2'))).toBeNull();
    expect(comboFromEvent(keyEvent('AltLeft', { altKey: true }))).toBeNull();
  });
});
