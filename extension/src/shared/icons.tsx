import type { EvidenceType } from '@trail/core';

/** Ícones em linha (SVG, traço 1.75, 24x24), um por tipo de evidência. */
const P = (d: string) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d={d} />
  </svg>
);

/** Logo do Trail: relógio com a seta voltando no tempo (o mesmo do site). */
export const TrailMark = () => (
  <svg viewBox="0 0 128 128" aria-hidden="true">
    <rect width="128" height="128" rx="64" fill="#032d42" />
    <circle cx="64" cy="64" r="38" fill="none" stroke="#244f63" stroke-width="12" />
    <path d="M64 26a38 38 0 1 1-36.4 27" fill="none" stroke="#62d84e" stroke-width="12" stroke-linecap="round" />
    <path d="M18 40l10 15 15-9" fill="none" stroke="#62d84e" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" />
    <path d="M64 44v22l14 9" fill="none" stroke="#fff" stroke-width="9" stroke-linecap="round" stroke-linejoin="round" />
  </svg>
);

/** O mesmo desenho em traço único, para tamanhos pequenos. */
export { TRAIL_GLYPH, TRAIL_MINI } from './mark';

export const Glyph = {
  compare: P('M7 4v16M17 4v16M3 8h8M13 16h8M9 6l2 2-2 2M15 14l-2 2 2 2'),
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
  moon: P('M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z'),
  sun: P('M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4'),
  minus: P('M5 12h14'),
  close: P('M6 6l12 12M18 6L6 18'),
  detach: P('M14 3h7v7M21 3l-9 9M19 14v5a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5'),
  toSide: P('M3 5h18v14H3zM15 5v14M6 12h6M9.5 9l3 3-3 3'),
  copy: P('M9 9h11v11H9zM5 15H4V4h11v1'),
  open: P('M14 3h7v7M21 3l-9 9M5 5h5M5 5v14h14v-5'),
  warn: P('M12 3l10 18H2L12 3zM12 10v4M12 17h.01'),
  check: P('M5 12l5 5 9-10'),
  chevron: P('M9 6l6 6-6 6'),
  gear: P('M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z'),
};

export const typeGlyph: Record<EvidenceType, preact.JSX.Element> = {
  br_async: Glyph.async,
  br_before: Glyph.rule,
  br_after: Glyph.rule,
  br_via_script_include: Glyph.include,
  br_other_record: Glyph.rule,
  script_action: Glyph.event,
  ui_action: Glyph.click,
  scheduled_job: Glyph.clock,
  flow: Glyph.flow,
  workflow: Glyph.flow,
  background_script: Glyph.terminal,
  user_action: Glyph.user,
  server_change: Glyph.server,
  assignment_rule: Glyph.group,
  data_lookup: P('M4 5h16v14H4zM4 10h16M9 10v9'),
  client_script: P('M8 9l-4 3 4 3M16 9l4 3-4 3M13 6l-2 12'),
  ui_policy: P('M4 6h16M4 12h10M4 18h7M17 15l2 2 3-4'),
  import_set: P('M12 3v12M7 10l5 5 5-5M4 19h16'),
  unknown_background: Glyph.question,
};

export const EmptyIllustration = () => (
  <svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true">
    <rect x="8" y="12" width="48" height="40" rx="6" opacity=".5" />
    <path d="M16 24h20M16 32h28M16 40h14" opacity=".5" />
    <circle cx="46" cy="42" r="9" fill="#032d42" stroke="none" />
    <path d="M46 36.3a5.7 5.7 0 1 1-5.4 4" stroke="#62d84e" stroke-width="2" />
    <path d="M46 39v3.2l2 1.3" stroke="#fff" stroke-width="1.6" />
  </svg>
);
