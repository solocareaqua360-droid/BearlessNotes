// JSON with the keys in one fixed order, whatever order they were given in.
//
// Firestore hands a document back with every map's keys sorted; the same
// object made here has its keys in the order the code wrote them. As
// text, {id, text, type} and {id, text, type} in another order are
// different strings - and comparing them as strings made every block
// that came back from the server look changed. The editor then merged
// its own echo as if another device had sent it, kept the focused block
// "because it was edited here", saw a difference again, wrote again -
// once a second, for as long as a block had the caret - and never
// applied what the other device had actually changed, because every
// block already looked changed here. One ordering ends that.
export function stableStringify(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const v = (value as Record<string, unknown>)[key];
      // undefined never reaches Firestore, so it must not count here either.
      if (v !== undefined) out[key] = sortKeys(v);
    }
    return out;
  }
  return value;
}
