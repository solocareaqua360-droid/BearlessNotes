// What's left of the board-to-document conversion: the comparison the
// board uses to tell "this is news" from "this is my own write coming
// back". Everything else - forming a document out of a column, reading it
// back onto the cards - was removed with the feature it served.

// A value as a string that depends on its CONTENT and nothing else: keys
// in a fixed order, and keys holding undefined dropped the way Firestore
// drops them. Plain JSON.stringify compares key order too, and a document
// read back from Firestore never has the order it was written in - which
// made every comparison say "different" and had two sides writing each
// other in a loop.
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${k}:${stable(v)}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

// A board's own cards and columns, read back from Firestore against the
// ones in memory.
export function contentEqual(a: unknown, b: unknown): boolean {
  return stable(a) === stable(b);
}
