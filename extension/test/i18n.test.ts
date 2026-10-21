import { describe, expect, it } from 'vitest';
import { t } from '../src/shared/i18n';

function collectShape(node: unknown, prefix = ''): { keys: string[]; empty: string[]; texts: Map<string, string>; arrayLens: Map<string, number> } {
  const keys: string[] = [];
  const empty: string[] = [];
  const texts = new Map<string, string>();
  const arrayLens = new Map<string, number>();

  const walk = (v: unknown, path: string) => {
    if (typeof v === 'string') {
      keys.push(path);
      texts.set(path, v);
      if (v.trim().length === 0) empty.push(path);
      return;
    }
    if (Array.isArray(v)) {
      keys.push(path);
      arrayLens.set(path, v.length);
      v.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        const sub = path ? `${path}.${k}` : k;
        walk((v as Record<string, unknown>)[k], sub);
      }
    }
  };

  walk(node, prefix);
  return { keys, empty, texts, arrayLens };
}

function placeholders(s: string): string[] {
  return [...new Set([...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!))].sort();
}

describe('i18n (pt e en)', () => {
  it('tem exatamente as mesmas chaves em pt e en (recursivo, incluindo p e arrays) e nenhum texto vazio', () => {
    const pt = collectShape(t('pt'));
    const en = collectShape(t('en'));

    const missingInEn = pt.keys.filter((k) => !en.keys.includes(k));
    const missingInPt = en.keys.filter((k) => !pt.keys.includes(k));
    expect({ missingInEn, missingInPt }).toEqual({ missingInEn: [], missingInPt: [] });

    for (const [arrPath, ptLen] of pt.arrayLens) {
      expect(en.arrayLens.get(arrPath), `tamanho do array em ${arrPath}`).toBe(ptLen);
    }

    // p.plain.q.confirmed é o prefixo vazio intencional quando a certeza é alta ("{q}o campo...").
    const intentionalEmpty = new Set(['p.plain.q.confirmed']);
    expect({
      emptyPt: pt.empty.filter((k) => !intentionalEmpty.has(k)),
      emptyEn: en.empty.filter((k) => !intentionalEmpty.has(k)),
    }).toEqual({ emptyPt: [], emptyEn: [] });
  });

  it('mantém em en todos os placeholders {x} usados em pt na mesma chave', () => {
    const pt = collectShape(t('pt'));
    const en = collectShape(t('en'));
    const mismatches: Array<{ key: string; ptVars: string[]; enVars: string[] }> = [];

    for (const [key, ptText] of pt.texts) {
      const enText = en.texts.get(key);
      if (enText === undefined) continue;
      const ptVars = placeholders(ptText);
      const enVars = placeholders(enText);
      if (ptVars.some((v) => !enVars.includes(v))) {
        mismatches.push({ key, ptVars, enVars });
      }
    }

    expect(mismatches).toEqual([]);
  });
});
