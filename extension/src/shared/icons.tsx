import type { EvidenceType } from '@trail/core';

/** Ícones em linha (SVG, traço 1.75, 24x24), um por tipo de evidência. */
const P = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

export const TrailMark = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M4 18c3-6 6-6 9 0s6 6 7-6" />
    <circle cx="20" cy="6" r="1.6" fill="#fff" stroke="none" />
  </svg>
);

export const Glyph = {
  rule: P('M4 6h16M4 12h10M4 18h7M17 15l2 2 4-4'),
  async: P('M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.2 2.2M16.2 16.2l2.2 2.2M5.6 18.4l2.2-2.2M16.2 7.8l2.2-2.2'),
  include: P('M8 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h2M16 4h2a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-2M9 12h6'),
  event: P('M13 2L4 14h7l-1 8 9-12h-7l1-8z'),
  click: P('M4 4l7 16 2-6 6-2L4 4z'),
  clock: P('M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 7v5l3 2'),
  flow: P('M5 6h4v4H5zM15 14h4v4h-4zM9 8h3a3 3 0 0 1 3 3v3'),
  terminal: P('M4 5h16v14H4zM8 9l3 3-3 3M13 15h4'),
  user: P('M20 21a8 8 0 0 0-16 0M12 13a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'),
  server: P('M4 5h16v6H4zM4 13h16v6H4zM8 8h.01M8 16h.01'),
  question: P('M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20z'),
  group: P('M17 21v-2a4 4 0 0 0-3-3.9M9 7a4 4 0 1 0 0 8 4 4 0 0 0 0-8zM3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2M16 3.1a4 4 0 0 1 0 7.8'),
  search: P('M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3'),
  shield: P('M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'),
  refresh: P('M21 12a9 9 0 1 1-3-6.7M21 3v6h-6'),
  plug: P('M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0V8zM12 18v4'),
};

export const typeGlyph: Record<EvidenceType, preact.JSX.Element> = {
  br_async: Glyph.async,
  br_before: Glyph.rule,
  br_after: Glyph.rule,
  br_via_script_include: Glyph.include,
  script_action: Glyph.event,
  ui_action: Glyph.click,
  scheduled_job: Glyph.clock,
  flow: Glyph.flow,
  workflow: Glyph.flow,
  background_script: Glyph.terminal,
  user_action: Glyph.user,
  server_change: Glyph.server,
  assignment_rule: Glyph.group,
  unknown_background: Glyph.question,
};

export const EmptyIllustration = () => (
  <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
    <rect x="8" y="12" width="48" height="40" rx="6" opacity=".5" />
    <path d="M16 24h20M16 32h28M16 40h14" opacity=".5" />
    <path d="M38 44c4-8 8-8 12 0" stroke="#1f8476" stroke-width="2" />
    <circle cx="52" cy="40" r="1.6" fill="#1f8476" stroke="none" />
  </svg>
);
