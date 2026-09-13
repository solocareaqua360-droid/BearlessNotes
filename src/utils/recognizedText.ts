// What comes back off a photographed page, and how to turn it into text
// a person would want in a note.
//
// Tesseract reads everything it can see, and a photograph of a book is
// not only text: the shadow in the gutter, the frayed edge of the paper,
// the texture of the margin all come back as "words" with boxes, and they
// come back IN READING ORDER - so they land in the middle of sentences
// rather than somewhere they could be ignored.
//
// The first attempt at this threw away everything the recogniser was less
// than half sure of, and that was the wrong instrument: a shadow makes
// REAL words uncertain, and a speck in a clean margin can be read with
// confidence. It cut the page off along the shadow - "Велике Місто"
// vanished while being perfectly legible.
//
// So the signal is geometry instead. Printed text lives in a column, and
// everything outside that column is the paper, not the book. Confidence
// is left to do the one thing it is good at: dropping what the recogniser
// itself considers barely a guess.

export type RecognizedWord = {
  text: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  // "Join me to the next word with no space, and drop my hyphen": a word
  // the line break cut in half.
  glue?: boolean;
};

// A word as the recogniser hands it over, before any of this.
export type ScoredWord = RecognizedWord & { confidence: number };

export type RecognizedPage = {
  text: string;
  words: RecognizedWord[];
  width: number;
  height: number;
  image: string;
};

// Written out rather than using a Unicode property class: those need a
// regex feature the engine here does not reliably have.
const LETTER = /[A-Za-zА-Яа-яЁёЇїІіЄєҐґ']/g;
const DIGIT = /[0-9]/g;

// The one-letter words Ukrainian actually has. Anything else standing
// alone is a speck on the paper that happened to look like a letter.
const SINGLE_LETTER = new Set(['і', 'й', 'у', 'в', 'з', 'а', 'я', 'о', 'є', 'б', 'ж', 'е', 'и']);

// Marks that can stand by themselves in real text - the dash that opens a
// line of dialogue above all. Everything else on its own (the bars and
// slashes a page edge produces) is noise.
const DASHES = new Set(['-', '\u2013', '\u2014']);
const STANDALONE = new Set(['—', '–', '-', '...', '…', '.', ',', '!', '?', ':', ';', '«', '»', '"']);

function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

// Shapes that are not words in any language, and the recogniser's own
// admission that it was guessing. Deliberately forgiving: a word in a
// shadow is still a word.
function shapeOk(word: ScoredWord): boolean {
  const text = word.text.trim();
  if (!text) return false;
  if (word.confidence < 30) return false;
  const letters = count(text, LETTER);
  const digits = count(text, DIGIT);
  if (letters === 0 && digits === 0) return STANDALONE.has(text);
  if (text.length === 1 && letters === 1) {
    return SINGLE_LETTER.has(text.toLowerCase()) || word.confidence >= 80;
  }
  // Short and mostly not letters: "||", "| (", "з." and their kind.
  if (text.length <= 3 && letters + digits <= text.length - 2) return false;
  return true;
}

// A word solid enough to say where the text is: long enough not to be a
// speck, and read well enough not to be a guess.
function isAnchor(word: ScoredWord): boolean {
  return count(word.text, LETTER) >= 4 && word.confidence >= 60;
}

function percentile(values: number[], share: number): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * share)))];
}

function median(values: number[]): number {
  return values.length ? percentile(values, 0.5) : 0;
}

// Words in the order they were read, cut into lines. Their bands overlap
// while they are on the same line, which survives the rise and fall of
// text photographed on a curved page.
function sameLine(a: RecognizedWord, b: RecognizedWord): boolean {
  const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  const shorter = Math.min(a.y1 - a.y0, b.y1 - b.y0);
  return shorter > 0 && overlap > shorter * 0.5;
}

function groupLines<T extends RecognizedWord>(words: T[]): T[][] {
  const lines: T[][] = [];
  words.forEach((word) => {
    const line = lines[lines.length - 1];
    if (line && sameLine(line[line.length - 1], word)) line.push(word);
    else lines.push([word]);
  });
  return lines;
}

// The order a person reads in, rebuilt from the boxes: lines top to
// bottom, words left to right. The recogniser's own order is not that -
// it hands over the blocks it found in the order it found them, and a
// short reply it took for a block of its own ("— Я думаю...") arrived
// after the paragraph it belongs at the head of. Every box has a place;
// the place says where the word goes.
function readingOrder<T extends RecognizedWord>(words: T[]): T[] {
  const byMiddle = [...words].sort((a, b) => a.y0 + a.y1 - (b.y0 + b.y1));
  const lines: { top: number; bottom: number; words: T[] }[] = [];
  byMiddle.forEach((word) => {
    const line = lines.find((candidate) => {
      const overlap = Math.min(candidate.bottom, word.y1) - Math.max(candidate.top, word.y0);
      const shorter = Math.min(candidate.bottom - candidate.top, word.y1 - word.y0);
      return shorter > 0 && overlap > shorter * 0.5;
    });
    if (!line) {
      lines.push({ top: word.y0, bottom: word.y1, words: [word] });
      return;
    }
    line.words.push(word);
    // The line's band is the average of its words, so one tall or low
    // box cannot drag it into the line below on a page that is not flat.
    const n = line.words.length;
    line.top = line.top + (word.y0 - line.top) / n;
    line.bottom = line.bottom + (word.y1 - line.bottom) / n;
  });
  lines.sort((a, b) => a.top - b.top);
  return lines.flatMap((line) => line.words.sort((a, b) => a.x0 - b.x0));
}

// Noise out, broken words put back together.
export function tidyWords(raw: ScoredWord[]): RecognizedWord[] {
  const shaped = readingOrder(raw.filter(shapeOk));
  const anchors = shaped.filter(isAnchor);
  // Where the printed column is. Percentiles rather than the extremes, so
  // one surviving speck cannot widen it to the whole photograph - and
  // nothing at all if there is too little to be sure of.
  const column =
    anchors.length >= 6
      ? {
          // Very nearly the outermost anchors, trimming only a true
          // outlier: in justified print the word that reaches the right
          // margin is often a SHORT one - "міц-" at the end of a line -
          // and measuring the column by the solid words alone drew it
          // narrower than the text, cutting those off.
          left: percentile(anchors.map((w) => w.x0), 0.02),
          right: percentile(anchors.map((w) => w.x1), 0.98),
        }
      : null;
  const slack = column ? Math.max(12, (column.right - column.left) * 0.03) : 0;

  const kept: RecognizedWord[] = [];
  groupLines(shaped).forEach((line) => {
    // A line with no word on it at all - only specks and marks - is a
    // crease, or the edge of the page caught in the frame. That is the
    // whole test: it used to demand a SOLID word (four letters, read with
    // confidence), and "— Я думаю..." - a short reply, its confidence
    // dented by the ellipsis, handed over as a piece of its own - went
    // out with the creases.
    if (!line.some((word) => count(word.text, LETTER) >= 2)) return;
    line.forEach((word) => {
      if (column && (word.x0 > column.right + slack || word.x1 < column.left - slack)) return;
      kept.push({ text: word.text.trim(), x0: word.x0, y0: word.y0, x1: word.x1, y1: word.y1 });
    });
  });

  // A dash is one dash. The em dash that opens a line of dialogue comes
  // back as a hyphen, or as two of them, often enough to be worth saying
  // so here rather than leaving it in every scanned page.
  const merged: RecognizedWord[] = [];
  kept.forEach((word) => {
    const previous = merged[merged.length - 1];
    if (!DASHES.has(word.text)) {
      merged.push(word);
      return;
    }
    if (previous && DASHES.has(previous.text)) {
      previous.x1 = word.x1;
      return;
    }
    merged.push({ ...word, text: '—' });
  });

  merged.forEach((word, index) => {
    const next = merged[index + 1];
    if (!next) return;
    if (/[-¬]$/.test(word.text) && !sameLine(word, next)) word.glue = true;
  });
  return merged;
}

// The words as prose. A line break inside a paragraph is a space, not a
// new line: a book wraps mid-sentence, and keeping those breaks would
// paste a ragged column into the note.
export function joinWords(words: RecognizedWord[]): string {
  const lines = groupLines(words);
  if (lines.length === 0) return '';
  const tops = lines.map((line) => Math.min(...line.map((word) => word.y0)));
  // How far it is from one line to the next, and where the column starts.
  const pitch = median(tops.slice(1).map((top, index) => top - tops[index]));
  const lefts = lines.map((line) => line[0].x0);
  const columnLeft = percentile(lefts, 0.15);
  const columnWidth = Math.max(...lines.map((line) => line[line.length - 1].x1)) - columnLeft;

  let out = '';
  lines.forEach((line, index) => {
    line.forEach((word, position) => {
      out += word.glue ? word.text.replace(/[-¬]$/, '') : word.text;
      if (position < line.length - 1) out += ' ';
    });
    const next = lines[index + 1];
    if (!next) return;
    if (line[line.length - 1].glue) return;
    // Two marks of a new paragraph, and either will do: a gap wider than
    // the usual step between lines, or an indented first line - which is
    // how a printed book says it, and the more reliable of the two on a
    // page that is not quite flat.
    const step = tops[index + 1] - tops[index];
    const gapped = pitch > 0 && step > pitch * 1.6;
    const indented = columnWidth > 0 && next[0].x0 - columnLeft > columnWidth * 0.015;
    out += gapped || indented ? '\n\n' : ' ';
  });
  return out.trim();
}
