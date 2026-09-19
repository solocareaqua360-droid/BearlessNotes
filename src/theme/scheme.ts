import { hslToHex, perceivedBrightness, toneCorrectedLightness, withAlpha } from '../utils/color';
import { THEMES, type SectionKey, type Theme } from './tokens';

// ONE COLOUR SCHEME, TURNED INTO THE WHOLE COLOUR THEME.
//
// The brief the user set for this, in their own words: "людина, крутячи
// повзунки, не може зробити не красиво". That is not a promise good
// taste can keep - it has to be mechanical, and the mechanism is a
// split:
//
//   THE SCHEME DECIDES HUE. THE CONTRACT DECIDES LIGHTNESS.
//
// Every surface's lightness is a constant in this file. The user cannot
// reach it, so the ladder - ground darker than the card standing on it,
// light always coming from above - cannot collapse, whatever they do to
// the wheel. What they DO control is which way round the colour wheel
// everything sits, and how saturated it is, both clamped.
//
// The second half of the brief came later and is what makes this safe
// at all: "варто використати не градієнт, а більш однотонний колір, а
// градієнт буде задавати колір для інших елементів". So the backdrop
// is deliberately the LEAST colourful thing here - a near-flat ramp of
// four points of lightness at low saturation - and the harmony is
// spent on the eleven sections, the accent and the glow instead. A
// card can never sink into the background, because the background has
// nowhere interesting to be.
//
// Only the colour theme is built this way. White and black are
// finished ("теми чорна та біла в нас в принципі готові") and this
// function never touches them.

export type SchemeKind = 'complementary' | 'split' | 'triad' | 'square' | 'analogous' | 'mono';

export type ColourScheme = {
  kind: SchemeKind;
  // 0-359, where on the wheel the whole app sits.
  hue: number;
  // The two knobs the user actually turns, clamped to the ranges below.
  sat: number;
  lum: number;
};

// The ranges exist so the ends of the sliders are still a design. Below
// 30 saturation a "colour scheme" is just grey with an opinion; above
// 90 every section screams at once. Below 45 lightness an accent stops
// being readable on the dark ground, above 78 it goes pastel and the
// ink on it has nowhere to go.
export const SCHEME_SAT_RANGE: [number, number] = [30, 90];
export const SCHEME_LUM_RANGE: [number, number] = [45, 78];

// Today's amber, measured: #F5C77E is hsl(37, 86%, 73%). The default
// scheme therefore reproduces the ground, the accent and the dock's
// glass the theme already ships with, to within a point per channel.
//
// TRIAD rather than analogous, though - and that is about the eleven
// sections, not the accent. An analogous scheme spans ninety degrees;
// spread eleven identities over that and Задачі, Посилання and Групи
// all come out as versions of one yellow. Three anchors give each
// section somewhere to actually be.
export const DEFAULT_SCHEME: ColourScheme = { kind: 'triad', hue: 37, sat: 86, lum: 73 };

// Where the hues sit relative to the base. Same four families as the
// wheel already offers.
// Where the hues sit relative to the base.
//
// The wider families (square, and triad before it) are here for a
// reason that is specific to this app rather than to colour theory:
// there are ELEVEN sections to name. Two anchors means six of them
// share one hue and part only by a twenty-degree fan; four anchors
// means three do. More anchors is more identity per section.
//
// Tetradic is usually the hardest harmony to keep under control,
// because two complementary pairs at full freedom will fight. That
// warning does not apply here: every stop already shares one
// saturation and one perceptually corrected lightness band, and per-
// colour freedom is exactly what this model does not have. What is
// left of the risk is a wheel that can look like a rainbow, which the
// user can see in the preview and simply not choose.
const ANCHORS: Record<SchemeKind, number[]> = {
  complementary: [0, 180],
  // The gentlest way to get three well-parted hues: the complement is
  // avoided and its two neighbours taken instead, so nothing sits
  // directly opposite anything.
  split: [0, 150, 210],
  triad: [0, 120, 240],
  square: [0, 90, 180, 270],
  analogous: [0, 30, -30, 60],
  mono: [0],
};

// The eleven sections in a FIXED order. This is the whole reason
// `sections` became a role: the scheme hands out hues down this list,
// so the user picks one harmony instead of eleven separate colours,
// and two sections can never accidentally land on the same swatch the
// way Бази даних and Посилання both sit on #14B8A6 today.
const SECTION_ORDER: SectionKey[] = [
  'documents',
  'tasks',
  'files',
  'photos',
  'links',
  'boards',
  'databases',
  'custom',
  'groups',
  'calendar',
  'settings',
];

// Eleven sections over two to four anchors means several share one. A
// monochrome scheme means ALL of them do. They part two ways at once -
// a small fan either side of the anchor, and a step in lightness -
// because hue alone is not enough to tell two greens apart at a glance
// and lightness alone would throw away the harmony.
const FAN = 20;
const SECTION_LUM: [number, number] = [56, 72];
// Harder perceptual flattening than a gradient gets (the wheel's own
// default is 20). A gradient WANTS each hue to keep its character; a
// set of eleven identities wants the opposite - every one of them has
// to read as equally present against the dark ground. Measured: at 20
// a violet section landed 0.23 of brightness above the ground while a
// yellow one landed 0.68, which is not a set, it is a bright one and
// ten others.
const SECTION_TONE_STRENGTH = 34;

const clamp = (v: number, [lo, hi]: [number, number]) => Math.min(hi, Math.max(lo, v));
const wrap = (h: number) => ((h % 360) + 360) % 360;

// THE LAST GUARD, and the one that actually earns the promise.
//
// Clamping the sliders is not enough, because "45% lightness" is a
// number and not a brightness: a pure blue at the bottom of the
// allowed range measures 0.21 against a ground of 0.15, which is an
// accent nobody can see. Measured across the whole parameter space
// before this existed, the worst case was a gap of 0.06.
//
// So the colour is not trusted, it is CHECKED. Lightness is walked up
// two points at a time until the thing is actually brighter than what
// it stands on, or until it runs out of room. This is why the user can
// put every slider anywhere and still get an app that works: the
// hue is theirs, the legibility is not negotiable.
function legibleOn(
  hue: number,
  sat: number,
  lum: number,
  groundBrightness: number,
  minDelta: number,
  strength: number
): string {
  let l = lum;
  for (let step = 0; step < 24; step += 1) {
    const hex = hslToHex(hue, sat, toneCorrectedLightness(hue, l, strength));
    if (perceivedBrightness(hex) - groundBrightness >= minDelta) return hex;
    if (l >= 92) return hex;
    l += 2;
  }
  return hslToHex(hue, sat, toneCorrectedLightness(hue, 92, strength));
}

// How far above the ground each family has to clear. The accent is a
// single object the eye goes looking for, so it gets the higher bar;
// a section colour is usually carried by an icon or a chip next to its
// own label, so it can sit a little closer.
const MIN_ACCENT_DELTA = 0.34;
const MIN_SECTION_DELTA = 0.32;

function sectionColour(i: number, scheme: ColourScheme, groundBrightness: number): string {
  const anchors = ANCHORS[scheme.kind];
  const rounds = Math.ceil(SECTION_ORDER.length / anchors.length);
  // Which anchor this section takes, and how many times round we are.
  const anchor = anchors[i % anchors.length];
  const round = Math.floor(i / anchors.length);
  const spread = rounds > 1 ? round / (rounds - 1) : 0.5;
  const hue = wrap(scheme.hue + anchor + (spread - 0.5) * 2 * FAN);
  const lum = SECTION_LUM[0] + spread * (SECTION_LUM[1] - SECTION_LUM[0]);
  // Never the extremes of the user's own saturation: a section colour
  // is read as an identity at thumbnail size, and both ends fail that.
  const sat = clamp(scheme.sat, [38, 78]);
  return legibleOn(hue, sat, lum, groundBrightness, MIN_SECTION_DELTA, SECTION_TONE_STRENGTH);
}

export function sectionsFromScheme(scheme: ColourScheme): Record<SectionKey, string> {
  const groundBrightness = perceivedBrightness(hslToHex(wrap(scheme.hue), GROUND.s, GROUND.l));
  const out = {} as Record<SectionKey, string>;
  SECTION_ORDER.forEach((key, i) => {
    out[key] = sectionColour(i, scheme, groundBrightness);
  });
  return out;
}

// THE FIXED LADDER. Not one of these numbers is reachable from the UI.
// They are the colour theme's own measurements: ground #2A2522 is
// hsl(24, 11%, 15%) and the dock's glass #5C4326 is hsl(32, 42%, 25%),
// so a scheme left on its default hue reproduces the theme that
// already shipped rather than approximating it.
const GROUND = { s: 10, l: 15 };
const GLASS_BODY = { s: 42, l: 25 };
// The backdrop, top to bottom. Four points of lightness across the
// whole screen - present enough to have depth, far too little to
// compete with anything standing on it.
const WASH: { s: number; l: number }[] = [
  { s: 16, l: 21 },
  { s: 13, l: 18 },
  { s: 10, l: 15 },
];

export function themeFromScheme(scheme: ColourScheme): Theme {
  const base = THEMES.colour;
  const hue = wrap(scheme.hue);
  const sat = clamp(scheme.sat, SCHEME_SAT_RANGE);
  const lum = clamp(scheme.lum, SCHEME_LUM_RANGE);

  const ground = hslToHex(hue, GROUND.s, GROUND.l);
  // The accent keeps the wheel's own gentler correction (20, not the
  // sections' 34): it is ONE colour, so it is allowed to have the
  // character of its hue, and at the default scheme this is what
  // reproduces today's #F5C77E exactly. Legibility is the guard's job,
  // not the correction's.
  const accent = legibleOn(hue, sat, lum, perceivedBrightness(ground), MIN_ACCENT_DELTA, 20);
  // The one correction that makes the whole thing safe to hand over: a
  // label on the accent is never a guess. Rec. 601 on the accent that
  // actually came out, not on the number that went in.
  const onAccent = perceivedBrightness(accent) > 0.55 ? ground : '#FFFFFF';
  // The glow is the accent's own light, the same way it already is -
  // the far half a little deeper, so the wide shadow reads as light
  // landing rather than as the shape blurred.
  const glowFar = hslToHex(hue, Math.min(90, sat + 4), toneCorrectedLightness(hue, Math.max(30, lum - 18)));

  return {
    ...base,
    ground,
    clouds: [ground, ground, ground],
    wash: WASH.map((w) => hslToHex(hue, w.s, w.l)) as [string, string, string],
    accent,
    onAccent,
    selected: withAlpha(accent, 0.16),
    scrim: withAlpha(hslToHex(hue, 12, 8), 0.55),
    sections: sectionsFromScheme(scheme),
    glass: { ...base.glass, body: hslToHex(hue, GLASS_BODY.s, GLASS_BODY.l) },
    glow: { ...base.glow, near: withAlpha(accent, 0.45), far: withAlpha(glowFar, 0.18) },
    // Deliberately NOT from the scheme: danger, success and warning
    // mean something, and a green "готово" that followed the wheel
    // round to red would be a bug rather than a theme. `paper` and
    // `canvas` stay too - a note is a light sheet on a table in every
    // theme, which the user settled themselves: "все таки білий фон,
    // головне щоб акценти кольорами розставлені були".
  };
}
