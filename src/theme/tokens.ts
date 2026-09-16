// The theme contract: ROLES, never colours.
//
// A screen says what a surface IS - the ground, a card on it, the ink on
// the card - and the theme decides what that looks like. That is the
// whole point of doing it this way: a screen is converted once, and all
// three themes come out of it, instead of three sets of styles that have
// to be kept in step by hand. The user's condition, in their own words:
// "я не хочу потім переробляти триста вікон - ти повинен все
// систематизувати".
//
// Three themes, agreed 2026-09-16: «кольоровий» (today's look),
// «білий» (white everywhere, parted by thin frames and shadows) and
// «чорний» (black everywhere, white ink, parted by outlines and glow).

export type ThemeKey = 'colour' | 'white' | 'black';

// How a surface parts from what is behind it. The one parameter that
// turns "shadows here, glow there, glass in the third" into a value a
// theme can hold, so a card only ever has to say "lift me".
export type Lift = 'shadow' | 'glow' | 'blur';

export type Theme = {
  key: ThemeKey;
  name: string;
  // What the native chrome needs to know - the status bar's ink, and
  // which way round every platform control should draw itself.
  scheme: 'light' | 'dark';
  // What stands behind everything: today's drifting gradient, the same
  // gradient bleached almost to nothing (white), or a flat fill (black).
  backdrop: 'gradient' | 'clouds' | 'plain';
  // The screen itself, a panel on it, and something floating over that.
  ground: string;
  surface: string;
  raised: string;
  ink: { primary: string; muted: string; faint: string };
  // The interface accent - buttons, active states, the live parts of a
  // control. Warm in the colour theme; deliberately neutral in white and
  // black, where colour is left to danger alone. The record colours
  // (photos pink, links teal, a note's own card colour) flatten with it:
  // the user was explicit that white and black mean white and black
  // everywhere, databases included.
  accent: string;
  danger: string;
  edge: { hairline: string; strong: string };
  lift: Lift;
  // The glass a floating control is made of - a role in ALL THREE
  // themes, not a trick of the colour one. A white or black theme with
  // no gloss is flat however many shadows it has (the user's own note),
  // and the drops of glass are what carries those two.
  glass: {
    tint: string;
    blur: number;
    blurTint: 'light' | 'dark' | 'default';
    // The specular, laid top-left, and the two edges that make a drop
    // read as a raised thing: light where it catches, dark where it
    // turns away.
    gloss: string;
    edgeTop: string;
    edgeBottom: string;
  };
  // Only where lift === 'glow'. TWO shadows, never one: a tight bright
  // one right at the shape (the source's own edge) and a wide soft one
  // offset DOWN, where the light lands. An even halo all round reads as
  // "something blurred and unclear" rather than as light - the user's
  // own observation, and it is how light actually behaves.
  glow: { near: string; far: string; nearRadius: number; farRadius: number; drop: number };
};

// Today's look, unchanged - every value here is one the app already
// draws, so the colour theme is a photograph of where we started rather
// than a new design.
const colour: Theme = {
  key: 'colour',
  name: 'Кольорова',
  scheme: 'dark',
  backdrop: 'gradient',
  ground: '#2A2522',
  surface: 'rgba(255,255,255,0.07)',
  raised: 'rgba(24,21,19,0.42)',
  ink: { primary: '#fff', muted: 'rgba(255,255,255,0.62)', faint: 'rgba(255,255,255,0.3)' },
  accent: '#F5C77E',
  danger: '#FB7185',
  edge: { hairline: 'rgba(255,255,255,0.22)', strong: 'rgba(255,255,255,0.4)' },
  lift: 'blur',
  glass: {
    tint: 'rgba(24,21,19,0.42)',
    blur: 60,
    blurTint: 'dark',
    gloss: 'rgba(255,255,255,0.28)',
    edgeTop: 'rgba(255,255,255,0.45)',
    edgeBottom: 'rgba(0,0,0,0.25)',
  },
  glow: { near: 'rgba(255,255,255,0.25)', far: 'rgba(255,255,255,0.10)', nearRadius: 2, farRadius: 14, drop: 6 },
};

// White: not a flat sheet of paper. The user asked for the drifting
// clouds to stay, bleached until they are almost nothing, so there is
// still something under the glass for it to be glass OVER.
const white: Theme = {
  key: 'white',
  name: 'Біла',
  scheme: 'light',
  backdrop: 'clouds',
  ground: '#FFFFFF',
  surface: '#FFFFFF',
  raised: '#FFFFFF',
  ink: { primary: '#111827', muted: '#6B7280', faint: '#9CA3AF' },
  // Graphite, not the warm amber: colour in this theme is for danger.
  accent: '#374151',
  danger: '#DC2626',
  edge: { hairline: 'rgba(17,24,39,0.10)', strong: 'rgba(17,24,39,0.18)' },
  lift: 'shadow',
  glass: {
    tint: 'rgba(255,255,255,0.62)',
    blur: 40,
    blurTint: 'light',
    // Stronger than it would be on a dark ground: a drop has to read as
    // raised against white, and the specular is the only thing saying so.
    gloss: 'rgba(255,255,255,0.95)',
    edgeTop: 'rgba(255,255,255,0.95)',
    edgeBottom: 'rgba(17,24,39,0.12)',
  },
  glow: { near: 'rgba(17,24,39,0.12)', far: 'rgba(17,24,39,0.10)', nearRadius: 2, farRadius: 18, drop: 8 },
};

// Black: outlines and glow, the opposite of shadows. The outline does
// double duty here - it separates the shape from the ground AND is the
// brightest part of it.
const black: Theme = {
  key: 'black',
  name: 'Чорна',
  scheme: 'dark',
  backdrop: 'plain',
  ground: '#000000',
  surface: '#000000',
  raised: '#0A0A0A',
  ink: { primary: '#FFFFFF', muted: 'rgba(255,255,255,0.62)', faint: 'rgba(255,255,255,0.32)' },
  accent: '#E5E7EB',
  danger: '#FB7185',
  edge: { hairline: 'rgba(255,255,255,0.18)', strong: 'rgba(255,255,255,0.45)' },
  lift: 'glow',
  glass: {
    tint: 'rgba(255,255,255,0.06)',
    blur: 50,
    blurTint: 'dark',
    gloss: 'rgba(255,255,255,0.38)',
    edgeTop: 'rgba(255,255,255,0.5)',
    edgeBottom: 'rgba(0,0,0,0.7)',
  },
  // Tinted, never pure white: semi-transparent white over black reads as
  // grey fog rather than as light.
  glow: { near: 'rgba(226,232,240,0.55)', far: 'rgba(191,219,254,0.18)', nearRadius: 2, farRadius: 22, drop: 10 },
};

export const THEMES: Record<ThemeKey, Theme> = { colour, white, black };
export const THEME_ORDER: ThemeKey[] = ['colour', 'white', 'black'];
export const DEFAULT_THEME_KEY: ThemeKey = 'colour';
