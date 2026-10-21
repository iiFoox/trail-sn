/** Ícone de cada tipo de regra (dependentes, simulação, comparação). */
import type { DepKind } from '@trail/core';
import { Glyph, typeGlyph } from '../shared/icons';

const KIND_ICON: Partial<Record<DepKind, preact.JSX.Element>> = {
  client_script: typeGlyph.client_script, ui_policy: typeGlyph.ui_policy, data_lookup: typeGlyph.data_lookup, br_before: Glyph.rule, br_after: Glyph.rule, br_async: Glyph.async, br_display: Glyph.rule,
  br_via_script_include: Glyph.include, data_policy: Glyph.shield, assignment_rule: Glyph.group, sla: Glyph.clock, notification: Glyph.event, flow: Glyph.flow, ui_action: Glyph.click, reference: Glyph.include,
};
export const kindIcon = (k: string): preact.JSX.Element => KIND_ICON[k as DepKind] ?? Glyph.rule;
