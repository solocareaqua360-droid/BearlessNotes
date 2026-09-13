// What comes back off a photographed page, and how to turn it into text
// a person would want in a note.
//
// Tesseract reads everything it can see, and a photograph of a book is
// not only text: the shadow in the gutter, the frayed edge of the paper,
// the texture of the margin all come back as "words" with boxes, and they
// come back IN READING ORDER - which means they land in the middle of
// sentences rather than at the end where they could be ignored. That is
// what "лам | (справи" was.
//
// Three things are done here, and nowhere else, so the selection screen
// and the note always agree:
//   - noise is dropped, mostly on the recogniser's own confidence;
//   - a word broken across a line ("при-" / "пливною") is put back
//     together;
//   - lines are joined into prose, and only a real gap starts a new
//     paragraph.

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
// slashes the page edge produces) is noise.
const STANDALONE = new Set(['—', '–', '-', '...', '…', '.', ',', '!', '?', ':', ';', '«', '»', '"']);

function count(text: string, pattern: RegExp): number {
  return (text.match(pattern) ?? []).length;
}

function worthKeeping(word: ScoredWord): boolean {
  const text = word.text.trim();
  if (!text) return false;
  // The recogniser's own judgement, and by far the most useful signal:
  // real print on a lit page comes back in the eighties and nineties,
  // while shadow read as letters rarely clears fifty.
  if (word.confidence < 50) return false;
  const letters = count(text, LETTER);
  const digits = count(text, DIGIT);
  if (letters === 0 && digits === 0) return STANDALONE.has(text);
  if (text.length === 1 && letters === 1) {
    return SINGLE_LETTER.has(text.toLowerCase()) || word.confidence >= 88;
  }
  // Short and mostly not letters: "||", "| (", "з." and their kind.
  if (text.length <= 3 && letters + digits <= text.length - 2) return false;
  return true;
}

function sameLine(a: RecognizedWord, b: RecognizedWord): boolean {
  // Two words share a line when their bands overlap by more than half the
  // shorter of the two - which survives the slight rise and fall of text
  // photographed on a curved page.
  const overlap = Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0);
  const shorter = Math.min(a.y1 - a.y0, b.y1 - b.y0);
  return shorter > 0 && overlap > shorter * 0.5;
}

function medianHeight(words: RecognizedWord[]): number {
  const heights = words.map((word) => word.y1 - word.y0).sort((a, b) => a - b);
  return heights.length ? heights[Math.floor(heights.length / 2)] : 0;
}

// Noise out, broken words put back together.
export function tidyWords(words: ScoredWord[]): RecognizedWord[] {
  const kept: RecognizedWord[] = words.filter(worthKeeping).map((word) => ({
    text: word.text.trim(),
    x0: word.x0,
    y0: word.y0,
    x1: word.x1,
    y1: word.y1,
  }));
  kept.forEach((word, index) => {
    const next = kept[index + 1];
    if (!next) return;
    if (/[-¬]$/.test(word.text) && !sameLine(word, next)) word.glue = true;
  });
  return kept;
}

// The words as prose. A line break inside a paragraph is a space, not a
// new line: a book wraps mid-sentence, and keeping those breaks would
// paste a column of ragged lines into the note.
export function joinWords(words: RecognizedWord[]): string {
  if (words.length === 0) return '';
  const line = medianHeight(words);
  let out = '';
  words.forEach((word, index) => {
    out += word.glue ? word.text.replace(/[-¬]$/, '') : word.text;
    const next = words[index + 1];
    if (!next) return;
    if (word.glue) return;
    if (sameLine(word, next)) {
      out += ' ';
      return;
    }
    // A gap noticeably bigger than a line of type is a paragraph; the
    // ordinary gap between lines is not.
    const gap = next.y0 - word.y1;
    out += gap > line * 0.9 ? '\n\n' : ' ';
  });
  return out.trim();
}
