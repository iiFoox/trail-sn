/** P1: encoded queries com ^OR e ^NQ, nos formatos vistos no PDI (21/10/2026). */
import { describe, expect, it } from 'vitest';
import { evalCondition } from '../src/util';

describe('evalCondition: ^, ^OR e ^NQ', () => {
  // Policy OOB "Make fields read-only on close".
  const close = 'incident_state=7^ORincident_state=8^EQ';

  it('OU simples da policy OOB de fechamento', () => {
    expect(evalCondition(close, { incident_state: '7' })).toBe(true);
    expect(evalCondition(close, { incident_state: '8' })).toBe(true);
    expect(evalCondition(close, { incident_state: '2' })).toBe(false);
    expect(evalCondition(close, {})).toBeUndefined();
  });

  it('OU liga mais forte que E: a^b^ORc = a E (b OU c)', () => {
    const q = 'active=true^state=6^ORstate=7';
    expect(evalCondition(q, { active: 'true', state: '7' })).toBe(true);
    expect(evalCondition(q, { active: 'false', state: '7' })).toBe(false);
    expect(evalCondition(q, { active: 'true', state: '2' })).toBe(false);
    // a^ORb^c = (a OU b) E c
    expect(evalCondition('state=6^ORstate=7^priority=1', { state: '6', priority: '2' })).toBe(false);
    expect(evalCondition('state=6^ORstate=7^priority=1', { state: '7', priority: '1' })).toBe(true);
  });

  it('^NQ: OU entre consultas inteiras', () => {
    const q = 'state=6^priority=1^NQstate=7^priority=2';
    expect(evalCondition(q, { state: '6', priority: '1' })).toBe(true);
    expect(evalCondition(q, { state: '7', priority: '2' })).toBe(true);
    expect(evalCondition(q, { state: '6', priority: '2' })).toBe(false);
    expect(evalCondition('state=6^NQstate=7^ORstate=8', { state: '8' })).toBe(true);
  });

  it('três valores: falso decide no E, verdadeiro decide no OU, senão "não sei"', () => {
    expect(evalCondition('state=6^ORcaller_id=x', { state: '6' })).toBe(true);
    expect(evalCondition('state=6^ORcaller_id=x', { state: '2' })).toBeUndefined();
    expect(evalCondition('caller_id=x^state=6', { state: '2' })).toBe(false);
    expect(evalCondition('caller_id=x^state=6', { state: '6' })).toBeUndefined();
    expect(evalCondition('state=6^NQcaller_id=x', { state: '2' })).toBeUndefined();
  });

  it('termo desconhecido ou javascript: deixa tudo não avaliável', () => {
    expect(evalCondition('state=6^ORopened_atRELATIVEGT@hour@ago@1', { state: '6', opened_at: '' })).toBeUndefined();
    expect(evalCondition('assigned_to=javascript:gs.getUserID()^ORstate=6', { state: '6', assigned_to: '' })).toBeUndefined();
    expect(evalCondition('state=2^NQpriorityBETWEEN1@3', { state: '2', priority: '1' })).toBeUndefined();
  });

  it('skipField e mudanças continuam como antes', () => {
    expect(evalCondition('state=6^ORstate=7', { state: '6' }, 'state')).toBeUndefined();
    const changes = { set: new Set(['incident_state']), old: { incident_state: '2' } };
    expect(evalCondition('incident_stateCHANGESTO6^ORincident_stateCHANGESTO7', { incident_state: '7' }, undefined, changes)).toBe(true);
    expect(evalCondition('incident_stateCHANGESTO6^ORincident_stateCHANGESTO7', { incident_state: '3' }, undefined, changes)).toBe(false);
    expect(evalCondition('stateVALCHANGES^ORincident_stateVALCHANGES', { state: '2' }, undefined, changes)).toBe(true);
  });

  it('ORDERBY e EQ ignorados; vazio não avalia', () => {
    expect(evalCondition('state=6^ORDERBYnumber^EQ', { state: '6' })).toBe(true);
    expect(evalCondition('^EQ', {})).toBeUndefined();
    expect(evalCondition('', {})).toBeUndefined();
  });
});
