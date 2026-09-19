import type { ViewStyle } from 'react-native';

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
  // The three soft blooms the backdrop drifts. They were written into the
  // backdrop itself and were warm - an amber, a sea green, a violet - and
  // that amber is what made the white theme read as yellowish rather than
  // clean. A theme names its own now: the reference the user brought
  // (a milk-white window over an out-of-focus wash) is cool underneath,
  // because blue reads as white and yellow reads as warm.
  clouds: [string, string, string];
  cloudStrength: number;
  // The STATIC ramp under the clouds - top to bottom, never moves,
  // never fades with cloudStrength. Every screen used to pass this
  // triple in themselves (ScreenBackdrop's own `colors` prop) and every
  // one of them passed the SAME three hex values - eight copies of one
  // constant, never actually varied per screen. It belongs here.
  wash: [string, string, string];
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
  // The sheet a note is read on, and what is written on it. A role of
  // its own, not `surface`: in the colour theme the note's paper is white
  // over a dark ground (it always was), so the two cannot be one value.
  // In the black theme the paper is a very dark grey rather than black -
  // black paper on a black ground has no edge, and white on pure black
  // flares at the letters' contours over a long read; the ink there is
  // taken a shade below white for the same reason. `tint` is the small
  // well a code block or a file row stands in, `selected` a picked block.
  paper: {
    fill: string;
    ink: string;
    inkMuted: string;
    inkFaint: string;
    edge: string;
    tint: string;
    selected: string;
  };
  // THE CANVAS a note or a board is laid out on, and the cards lying on
  // it. Its own role, because it is the one place in the app where four
  // surfaces stack on top of each other, and that is what makes it the
  // hardest thing to get right in a dark theme.
  //
  // The user found both ways of getting it wrong, one in each screen:
  // a light canvas inside a dark app is one huge bright rectangle that
  // the eye has to re-adjust for every time it looks at the dock; and a
  // BLACK canvas with white cards is the highest-contrast edge there is,
  // repeated once per card - "з білими картками це був контрастний біль
  // по очах".
  //
  // Both are the same mistake: a jump of about twenty times in lightness
  // at every edge. So these five values are a LADDER with small steps,
  // roughly 1.3-1.6x apart, and it only ever climbs: ground is lighter
  // than the screen behind it, card is lighter than ground. Light comes
  // from above, as it does on a real table - invert that anywhere and
  // the eye reads a hole instead of an object. The canvas is never the
  // same colour as the screen's own ground either: a canvas that matches
  // its surroundings is not a surface, it is an absence, and then every
  // card on it is a light source in a void.
  //
  // `ink` is never pure white for the same reason `paper.ink` is not -
  // white on near-black flares at the contours of the letters.
  canvas: {
    ground: string;
    card: string;
    edge: string;
    edgeActive: string;
    ink: string;
    inkMuted: string;
    inkFaint: string;
    // The round "+" floating over it, and its glyph.
    fab: string;
    fabInk: string;
    // A lane drawn ON the canvas for cards to stand in (the board's
    // columns), and its edge. A wash rather than a fill - it has to
    // read as an area of the canvas, not as a card lying on it, so it
    // goes the SAME way as the ladder but by a much smaller step.
    lane: string;
    laneEdge: string;
  };
  lift: Lift;
  // The glass a floating control is made of - a role in ALL THREE
  // themes, not a trick of the colour one. A white or black theme with
  // no gloss is flat however many shadows it has (the user's own note),
  // and the drops of glass are what carries those two.
  //
  // Every value here is one layer of GlassDrop, and they are separate
  // because the light has to be ASYMMETRIC: the first attempt was a fill
  // plus one uniform hairline, and that is exactly what made it look
  // like a translucent rounded rectangle instead of glass.
  glass: {
    blur: number;
    blurTint: 'light' | 'dark' | 'default';
    // The body: the colour of the glass itself, and how much of it there
    // is. The screen must still be visible through it.
    body: string;
    opacity: number;
    // The lit contour, strongest at the top-left.
    specular: string;
    specularIntensity: number;
    // The rim inside the edge, strongest at the bottom-right - the far
    // wall of a thing with thickness.
    rim: string;
    rimOpacity: number;
    // The shadow that reaches in from the rim, so the edge reads
    // optically thicker than the middle.
    vignette: string;
    vignetteIntensity: number;
    // The ink of a control STANDING on the glass, which is not the ink of
    // the page. The user's reference (Apple's own glass tab bar) settles
    // it: those glyphs are neither white nor black but a mid grey, and
    // only the active one takes a colour. Pure white on glass glares;
    // pure black on it looks stamped on.
    ink: string;
    inkMuted: string;
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
// The drifting amber/sea-green/violet clouds are GONE (2026-09-19) -
// three competing hue families were doing the same job the dock's own
// glow already does now, and doing it worse: "компліментарні, але
// стільки плям і все зливається, жодних акцентів". Black proved the
// case first - no clouds at all, "light on black is the glow on the
// drops" - and once colour got its own glow too (the same evening),
// the backdrop had nothing left to earn its keep with. Flat now, the
// same `ground` colour repeated, exactly the way black's own plain
// backdrop works.
const colour: Theme = {
  key: 'colour',
  name: 'Кольорова',
  scheme: 'dark',
  // Back to 'gradient' - not the old blotchy drifting clouds (still off,
  // see cloudStrength above), but the STATIC ramp underneath them,
  // which was always a separate layer. See `wash`.
  backdrop: 'gradient',
  clouds: ['#2A2522', '#2A2522', '#2A2522'],
  cloudStrength: 0,
  // The blotchy DRIFTING clouds are gone for good (see the note above
  // `lift: 'glow'`) - this is a different, calmer thing: one STILL
  // gradient, warm at the top fading to the theme's own dark ground at
  // the foot, mixed from the accent the same way the dock's own lift
  // now is, rather than the old brown/grey/black every screen
  // duplicated: "хочу... градієнтне тло замість суцільного кольору" -
  // the aesthetic the user pointed at (Pinterest's "Still Ground"
  // reference) as the origin this theme should return to.
  wash: ['#C98A52', '#7A5A42', '#2A2522'],
  ground: '#2A2522',
  surface: 'rgba(255,255,255,0.07)',
  raised: 'rgba(24,21,19,0.42)',
  ink: { primary: '#fff', muted: 'rgba(255,255,255,0.62)', faint: 'rgba(255,255,255,0.3)' },
  accent: '#F5C77E',
  danger: '#FB7185',
  edge: { hairline: 'rgba(255,255,255,0.22)', strong: 'rgba(255,255,255,0.4)' },
  paper: {
    fill: '#FFFFFF',
    ink: '#111827',
    inkMuted: '#6B7280',
    inkFaint: '#9CA3AF',
    edge: '#E5E7EB',
    tint: '#F3F4F6',
    selected: '#EFF6FF',
  },
  // Transparent on purpose: today the canvas has no ground of its own and
  // shows the editor's, and the colour theme is a photograph of where we
  // started. Every other value here is the literal this file replaced.
  canvas: {
    ground: 'transparent',
    card: '#FFFFFF',
    edge: '#E5E7EB',
    edgeActive: '#8AB4FF',
    ink: '#111827',
    inkMuted: '#6B7280',
    inkFaint: '#9CA3AF',
    fab: '#111827',
    fabInk: '#FFFFFF',
    lane: 'rgba(17,24,39,0.05)',
    laneEdge: 'rgba(17,24,39,0.12)',
  },
  // Was 'blur' - "the glass itself does the lifting, a shadow only
  // muddies it" - true for a card ON the glass, but it left the dock
  // with NONE of the light black's own dock got: "кольорова здається
  // якоюсь такою собі в порівнянні з відполірованою чорною". Same
  // mechanism, tuned to this theme's own amber instead of borrowing
  // black's cool white/blue - the accent lights itself, not a
  // colourless imitation of another theme's glow.
  lift: 'glow',
  // `body` USED TO BE DARKER than `ground` (#181513 on #2A2522), fine
  // while a moving backdrop gave the dock constant visual noise to be
  // seen against - a real problem the moment the backdrop went flat.
  // The first fix lifted it with a plain warm brown, which solved that
  // but created a NEW problem: "цей режим все більше схожий на білий" -
  // #4A4038 turned out to be almost the exact swatch white's own accent
  // ended up at (both landed on the same neutral "espresso" by
  // coincidence, picked independently). The user's own steer: keep the
  // accent colours - they are what should tie the two dark themes
  // together - and make everything else unique. So the dock's lift
  // comes from THIS THEME'S OWN accent now (amber, ground mixed toward
  // #F5C77E) rather than an arbitrary neutral brown - gold-brown, not
  // taupe, and nothing white's palette also reaches for. Blends to
  // roughly (70, 54, 36) over the ground - lighter, and on a completely
  // different hue line than white's muted espresso.
  glass: {
    blur: 60,
    blurTint: 'dark',
    body: '#5C4326',
    opacity: 0.55,
    specular: '#FFFFFF',
    specularIntensity: 0.8,
    rim: '#FFFFFF',
    rimOpacity: 0.3,
    vignette: '#000000',
    vignetteIntensity: 0.32,
    ink: '#DCDCE2',
    inkMuted: '#9C9CA6',
  },
  glow: { near: 'rgba(245,199,126,0.45)', far: 'rgba(216,148,92,0.18)', nearRadius: 2, farRadius: 16, drop: 8 },
};

// White: not a flat sheet of paper. The user asked for the drifting
// clouds to stay, bleached until they are almost nothing, so there is
// still something under the glass for it to be glass OVER.
// REBUILT WARM (2026-09-18) - the cool version above shipped and the
// user's verdict, once it was actually in front of them, was the
// opposite of the plan's own bet: "біла здається брудною... на білому
// фоні текст, лінії - все це розмивається в сіру пляму, як брудний
// снig". The plan had gone cool on purpose ("blue reads as white,
// yellow reads as warm") - a reasonable-sounding rule that turned out
// wrong on a real screen. Cool ground + cool navy ink + a plain grey
// accent are all the SAME family with only lightness between them,
// which is exactly the recipe for one smudged wash instead of paper
// with ink on it.
//
// The fix the user pointed at themselves - Claude's own chat surface:
// "не ідеальне біле, є щось схоже на бежеве, але воно гармонійно
// складається в купу". Not pure white, WARM throughout, one undertone
// carried from the ground through the ink to the accent - that
// consistency is what reads as clean, not the lightness.
const white: Theme = {
  key: 'white',
  name: 'Біла',
  scheme: 'light',
  backdrop: 'clouds',
  // Warm sand/blush/cream, not sky-blue - a wash the ground and the
  // ink both agree with, rather than one cool layer under warm paper.
  clouds: ['#E8D9BE', '#E3C7B3', '#DCCFC0'],
  cloudStrength: 1,
  // backdrop is 'clouds' here, not 'gradient' - wash is never drawn,
  // kept equal to ground so nothing could show through by accident.
  wash: ['#EFE8DD', '#EFE8DD', '#EFE8DD'],
  ground: '#EFE8DD',
  // A shade off the ground, same reason as before - only the step and
  // the shadow tell a card from the page - just warm now, so the card
  // reads as brighter paper rather than a colder rectangle on it.
  surface: '#FBF8F2',
  raised: '#FFFEFB',
  // A warm near-black - the SAME undertone the colour theme's own
  // ground (#2A2522) already carries, so "white" and "colour" read as
  // dialects of one app rather than two different ones. Navy-black
  // (#111827) was the other half of the muddiness: cool ink on a warm
  // page fights the page instead of sitting on it.
  ink: { primary: '#2B2621', muted: '#7C7166', faint: '#AEA599' },
  // Still neutral, not the colour theme's amber - danger stays the
  // only colour here, per the user's own earlier call - but warm and
  // DARKER than ink.muted rather than a mid-grey that sat right next
  // to it and vanished into it. Espresso, not graphite.
  accent: '#4A3C2E',
  danger: '#C2410C',
  edge: { hairline: 'rgba(43,32,20,0.10)', strong: 'rgba(43,32,20,0.20)' },
  paper: {
    fill: '#FFFEFB',
    ink: '#2B2621',
    inkMuted: '#7C7166',
    inkFaint: '#AEA599',
    edge: '#E7DFD2',
    tint: '#F3EDE2',
    selected: '#F5E9D9',
  },
  // The ladder runs the other way up here - the card is the brightest
  // thing and the canvas is a shade of desk under it. A white card on a
  // white canvas would have no edge at all.
  canvas: {
    ground: '#EAE2D5',
    card: '#FFFEFB',
    edge: '#DED3C1',
    edgeActive: '#B5793E',
    ink: '#2B2621',
    inkMuted: '#7C7166',
    inkFaint: '#AEA599',
    fab: '#2B2621',
    fabInk: '#FFFEFB',
    lane: 'rgba(43,32,20,0.05)',
    laneEdge: 'rgba(43,32,20,0.12)',
  },
  lift: 'shadow',
  // On white almost nothing can come from the fill - white glass on a
  // white ground has no contrast to spend. So the body stays thin and
  // warm (cream, not the old "white/lavender"), and everything the eye
  // reads comes from the edge: a bright contour, a rim inside it, and a
  // vignette strong enough to actually be seen.
  glass: {
    blur: 28,
    blurTint: 'default',
    body: '#FDFAF4',
    opacity: 0.34,
    specular: '#FFFFFF',
    specularIntensity: 1,
    rim: '#FFFFFF',
    rimOpacity: 0.9,
    vignette: '#2B2621',
    vignetteIntensity: 0.22,
    ink: '#847A6E',
    inkMuted: '#ACA294',
  },
  glow: { near: 'rgba(43,32,20,0.12)', far: 'rgba(43,32,20,0.10)', nearRadius: 2, farRadius: 18, drop: 8 },
};

// Black: outlines and glow, the opposite of shadows. The outline does
// double duty here - it separates the shape from the ground AND is the
// brightest part of it.
const black: Theme = {
  key: 'black',
  name: 'Чорна',
  scheme: 'dark',
  backdrop: 'plain',
  clouds: ['#000000', '#000000', '#000000'],
  cloudStrength: 0,
  // backdrop is 'plain' here - wash is never drawn.
  wash: ['#000000', '#000000', '#000000'],
  ground: '#000000',
  surface: '#0E0F12',
  raised: '#16171B',
  ink: { primary: '#FFFFFF', muted: 'rgba(255,255,255,0.62)', faint: 'rgba(255,255,255,0.32)' },
  accent: '#E5E7EB',
  danger: '#FB7185',
  edge: { hairline: 'rgba(255,255,255,0.18)', strong: 'rgba(255,255,255,0.45)' },
  paper: {
    fill: '#0E0F12',
    ink: '#ECEDEF',
    inkMuted: 'rgba(236,237,239,0.62)',
    inkFaint: 'rgba(236,237,239,0.38)',
    edge: 'rgba(255,255,255,0.14)',
    tint: 'rgba(255,255,255,0.06)',
    selected: 'rgba(255,255,255,0.10)',
  },
  // The ladder: ground #0E0F12 -> canvas #141519 -> card #1E2025, each
  // a small step up, none of them black and none of them white. The "+"
  // is a dark disc with light ink rather than a light disc, which on
  // this ground would be a lamp.
  canvas: {
    ground: '#141519',
    card: '#1E2025',
    edge: '#2C2F36',
    edgeActive: '#7FA8F0',
    ink: '#ECEDEF',
    inkMuted: 'rgba(236,237,239,0.62)',
    inkFaint: 'rgba(236,237,239,0.38)',
    fab: '#2C2F36',
    fabInk: '#ECEDEF',
    // Light, not dark: a dark wash on a dark canvas is nothing at all,
    // which is how the board's columns disappeared.
    lane: 'rgba(255,255,255,0.05)',
    laneEdge: 'rgba(255,255,255,0.12)',
  },
  lift: 'glow',
  // The one the user called bad, and the reason was the milky wash: a
  // bright fill and a bright ring all the way round turn a button on
  // black into a grey blob. So the body is barely there, and the light
  // is a thin bright arc at the top-left with a faint rim opposite it -
  // most of the drop is simply the screen behind it.
  glass: {
    blur: 50,
    blurTint: 'dark',
    body: '#FFFFFF',
    opacity: 0.05,
    specular: '#FFFFFF',
    specularIntensity: 0.9,
    rim: '#DBEAFE',
    rimOpacity: 0.22,
    vignette: '#000000',
    vignetteIntensity: 0.55,
    ink: '#C9C9D1',
    inkMuted: '#8A8A94',
  },
  // Tinted, never pure white: semi-transparent white over black reads as
  // grey fog rather than as light.
  glow: { near: 'rgba(226,232,240,0.55)', far: 'rgba(191,219,254,0.18)', nearRadius: 2, farRadius: 22, drop: 10 },
};

// HOW A SURFACE PARTS FROM WHAT IS BEHIND IT, as one style.
//
// Lives here rather than in GlassDrop because the glow is not a
// property of that one component: it is the black theme's whole answer
// to contrast. The user, looking at the two pills that still carried it
// (the editor's corner capsule and the Полотно pill - the last two
// pieces of pre-dock chrome, which is exactly why they were the only
// things still glowing): "це світіння просто божественне, воно
// розбавляє чорну тему... тема стає живою".
//
// Glow is TWO shadows, never one: a tight bright one right at the shape
// (the source's own edge) and a wide soft one offset DOWN, where the
// light lands. An even halo all round reads as "something blurred and
// unclear" rather than as light; giving the blur a direction is what
// makes the eye call it light.
//
// `strength` is how much of it there is, 0 to 1 - and it exists because
// a lift has to be able to CROSS FADE. In the dock's stack the light
// belongs to whichever card is in front, and that changes during a
// swipe: at the very end of the settle the glow used to hop from one
// card to the other in a single frame ("світіння ніби стрибком
// перескакує з одної на іншу"). Two cards lit at once, one rising and
// one dying, is what makes that a hand-over rather than a jump.
//
// Faded in the COLOUR, not on the view: an opacity on a whole card
// would take its contents with it, and an elevation shadow on
// Android needs a solid background to cast from, so a transparent
// glow layer of its own would silently lose the white theme's shadow.
export function liftStyle(theme: Theme, how: Lift | 'none' = theme.lift, strength = 1): ViewStyle {
  if (strength <= 0) return {};
  const k = Math.min(1, strength);
  if (how === 'glow') {
    const g = theme.glow;
    return {
      boxShadow: `0px 0px ${g.nearRadius * 2}px ${fade(g.near, k)}, 0px ${g.drop}px ${g.farRadius}px ${fade(g.far, k)}`,
    } as ViewStyle;
  }
  if (how === 'shadow') {
    return {
      shadowColor: '#111827',
      shadowOpacity: 0.18 * k,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 8 },
      elevation: Math.round(6 * k),
    };
  }
  // 'blur' (the colour theme) and 'none': the glass itself is what parts
  // it from the screen, and a shadow under it only muddies the blur.
  return {};
}

// The alpha of a colour, scaled. Handles the two spellings the theme
// actually uses - `rgba(r,g,b,a)` and `#rrggbb` - and leaves anything
// else alone rather than guessing.
function fade(colour: string, k: number): string {
  if (k >= 1) return colour;
  const rgba = colour.match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const parts = rgba[1].split(',').map((v) => v.trim());
    const a = parts.length > 3 ? parseFloat(parts[3]) : 1;
    return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${(a * k).toFixed(3)})`;
  }
  if (/^#[0-9a-fA-F]{6}$/.test(colour)) {
    const v = colour.slice(1);
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
    return `rgba(${r}, ${g}, ${b}, ${k.toFixed(3)})`;
  }
  return colour;
}

export const THEMES: Record<ThemeKey, Theme> = { colour, white, black };
export const THEME_ORDER: ThemeKey[] = ['colour', 'white', 'black'];
export const DEFAULT_THEME_KEY: ThemeKey = 'colour';

// A record's or a tile's own colour, carried into a theme that does not
// speak in colour. White and black mean white and black everywhere, so a
// tile that keeps a saturated fill is the one object left shouting - the
// user's read of the databases screen, and it was right. Blended most of
// the way into the theme's surface it stays recognisable and stops
// competing.
export function mutedForTheme(colour: string, theme: Theme, amount = 0.62): string {
  // The action tile carries no colour at all - it must pass through
  // untouched, not crash the screen (it did, once).
  if (!colour || theme.key === 'colour') return colour;
  const hex = (c: string) => {
    const v = c.replace('#', '');
    const full = v.length === 3 ? v.split('').map((d) => d + d).join('') : v;
    return [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16));
  };
  if (!colour.startsWith('#')) return colour;
  const [r, g, b] = hex(colour);
  const [sr, sg, sb] = hex(theme.surface.startsWith('#') ? theme.surface : '#FFFFFF');
  const mix = (a: number, b2: number) => Math.round(a + (b2 - a) * amount);
  return `#${[mix(r, sr), mix(g, sg), mix(b, sb)].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
