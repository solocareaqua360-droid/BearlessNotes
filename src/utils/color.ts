// Small, dependency-free HSL <-> hex conversion for the colour wheel
// (ColorSchemeSheet) - a scheme rotates hues while each stop keeps its
// own saturation and lightness, so both directions have to be exact
// and cheap enough to run on every frame of a drag around the ring.

export function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const clean = hex.replace('#', '');
  const full = clean.length === 3 ? clean.split('').map((c) => c + c).join('') : clean;
  const r = parseInt(full.slice(0, 2), 16) / 255;
  const g = parseInt(full.slice(2, 4), 16) / 255;
  const b = parseInt(full.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return { h: 0, s: 0, l: Math.round(l * 100) };
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  h *= 60;
  if (h < 0) h += 360;
  return { h: Math.round(h), s: Math.round(s * 100), l: Math.round(l * 100) };
}

export function hslToHex(h: number, s: number, l: number): string {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lN - c / 2;
  let [r, g, b] = [0, 0, 0];
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to255 = (v: number) => Math.round((v + m) * 255);
  const toHex = (v: number) => to255(v).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`.toUpperCase();
}

export function isValidHex(value: string): boolean {
  return /^#[0-9A-Fa-f]{6}$/.test(value);
}

// WHY "the same lightness" is not the same lightness.
//
// HSL's L is a number, not a perception: pure yellow at L=50 reads far
// brighter than pure blue at L=50. A scheme whose stops all sit at one
// nominal L therefore still looks uneven - which is exactly the thing
// that makes a set stop reading as one family ("інакше гармонія
// рушиться"). So the shared tone is corrected PER HUE before it is
// drawn: hues the eye finds bright are pulled down, dark ones pushed
// up, and the set lands on one PERCEIVED tone rather than one number.
//
// Rec. 601 weights, the same ones every "is this text readable on this
// colour" check uses - good enough here, and cheap.
export function perceivedHueBrightness(h: number): number {
  const hex = hslToHex(h, 100, 50).replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

// `strength` is how much of the difference to take out - 0 leaves HSL's
// own uneven lightness alone, 100 would flatten every hue to the same
// perceived brightness and lose the colours' own character with it.
export function toneCorrectedLightness(h: number, l: number, strength = 20): number {
  const corrected = l + (0.5 - perceivedHueBrightness(h)) * strength;
  return Math.max(4, Math.min(96, Math.round(corrected)));
}
