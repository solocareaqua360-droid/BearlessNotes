import { useSoft, type SoftTokens } from './soft';

// THE LAPTOP'S RULES (agreed 2026-10-01, for the whole interface): one scale
// for shape, size, position and colour, built on «М'який» (soft.ts) - not a
// second style beside it. Where a screen draws a number of its own that is
// not here, it is a deviation, and `sh scripts/audit-desktop-theme.sh`
// lists every one.

// Shape: see scale.ts (three corners and a pill; nothing in between).
export { RADIUS, cardRadius, controlRadius, deskSize } from './scale';

// Type. Five sizes, three weights (regular, medium, semibold - never bold).
export const TYPE = {
  xs: 12, // a caption, a count
  sm: 13.5, // a control's label, a small row
  md: 15, // body, a record's title
  lg: 17, // a heading inside a screen
  xl: 22, // a screen's own title
} as const;

// Size. What a thing is tall.
export const CONTROL = {
  button: 30,
  row: 36,
  icon: 16,
  tab: 28,
  // A row of the rail.
  nav: 32,
} as const;

// Position. Spacing runs on four.
export const SPACE = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

// The shell's own measures (points).
export const LAYOUT = {
  rail: 240,
  tabs: 40,
  toolbar: 44,
  // A panel stands off the window's edges by this, so its shadow has room.
  panelInset: 8,
  // Where macOS puts the traffic lights: the rail and the tabs leave it empty.
  titleBand: 44,
} as const;

// Colour. FOUR ROLES, and three meanings that are not roles:
//   ground  - what content stands on (lists, panels)
//   chrome  - the frame round it (the rail, the tab row): a half-tone darker
//   card    - a thing lying on the ground
//   accent  - selection and focus, and nothing else
//   danger / success / warn - what a colour MEANS
// Black is for the ONE main action of a screen; "on" elsewhere is `fill`.
export type DeskColors = {
  ground: string;
  chrome: string;
  card: string;
  accent: string;
  ink: string;
  ink2: string;
  ink3: string;
  fill: string;
  line: string;
  danger: string;
  success: string;
  warn: string;
  soft: SoftTokens;
};

export function deskColors(S: SoftTokens): DeskColors {
  return {
    ground: S.bg,
    chrome: S.fillSolid,
    card: S.card,
    accent: S.accent,
    ink: S.ink,
    ink2: S.ink2,
    ink3: S.ink3,
    fill: S.fill,
    line: S.line,
    danger: S.dark ? '#FF7A6E' : '#C8452F',
    success: S.dark ? '#5FD39A' : '#2E8B62',
    // A warning is quiet: a tinted ground and the ink, never a bright slab.
    warn: S.dark ? 'rgba(232,154,98,0.16)' : 'rgba(217,121,63,0.12)',
    soft: S,
  };
}

export function useDeskColors(): DeskColors {
  return deskColors(useSoft());
}
