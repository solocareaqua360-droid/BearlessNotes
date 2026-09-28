// The shape both callers already hold - deliberately only the four
// fields this needs, so a Text's line from either platform fits.
export type CaretLine = { x: number; y: number; width: number; height: number; text: string };

// Which character a tap landed on, worked out from the lines a Text
// reported laying out.
//
// This is the phone's answer to the question a browser can simply be
// asked (see caretAtPoint.web). React Native gives no character-level
// hit-testing at all, so it is reconstructed: onTextLayout says where
// each line sits and what it says, the tap's y picks the line, and its x
// is turned into a character by walking the line and weighting each
// glyph - an "i" is not as wide as an "m", and pretending otherwise put
// the caret several characters off in a long line.
//
// It lived inside DocumentEditorScreen, for the blocks on the page. The
// canvas needs the same answer for the same reason, and a tap that lands
// where it was aimed is not a thing to have two versions of.

export function glyphWeight(ch: string): number {
  if (/[ .,:;'!|iIlјjtfr()\-іїІ]/.test(ch)) return 0.55;
  if (/[mwMWшщжмюфШЩЖМЮФ@%]/.test(ch)) return 1.45;
  if (ch === ch.toUpperCase() && ch !== ch.toLowerCase()) return 1.2;
  return 1;
}

export function displayIndexForTouch(lines: CaretLine[], displayText: string, x: number, y: number): number {
  if (lines.length === 0) return displayText.length;
  let line = lines[lines.length - 1];
  for (const l of lines) {
    if (y < l.y + l.height) {
      line = l;
      break;
    }
  }
  // Where this line's text starts in the whole string: searched rather
  // than summed, since a wrapped line's reported text may or may not
  // carry the space it broke on.
  let lineStart = 0;
  let cursor = 0;
  for (const l of lines) {
    const at = displayText.indexOf(l.text, cursor);
    const start = at === -1 ? cursor : at;
    if (l === line) {
      lineStart = start;
      break;
    }
    cursor = start + l.text.length;
  }
  const chars = Array.from(line.text);
  const total = chars.reduce((sum, ch) => sum + glyphWeight(ch), 0);
  const target = total > 0 && line.width > 0 ? ((x - line.x) / line.width) * total : 0;
  let acc = 0;
  let index = 0;
  for (; index < chars.length; index++) {
    const w = glyphWeight(chars[index]);
    if (acc + w / 2 >= target) break;
    acc += w;
  }
  // Don't land after the break character of a wrapped line - that's the
  // start of the next line visually.
  const trimmed = line.text.replace(/\s+$/, '');
  index = Math.min(index, Array.from(trimmed).length);
  return Math.min(displayText.length, lineStart + chars.slice(0, index).join('').length);
}
