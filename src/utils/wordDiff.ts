// WHAT CHANGED, WORD BY WORD (2026-10-24, «Показати зміни» of the AI edit window, sketch V4): the old text and the new one cut
// into words, spaces and marks, the longest run they share kept, the rest marked as gone or added. A change is shown as ONE
// piece gone followed by ONE piece added (not word for word interleaved), which reads the way a person corrects on paper.

export type DiffPiece = { kind: 'same' | 'del' | 'ins'; text: string };

const TOKEN = /\s+|[\p{L}\p{N}'’ʼ-]+|[^\s\p{L}\p{N}]/gu;
// Past this many words on either side the table of the shared run grows too big for a phone: the whole is shown as replaced.
const LIMIT = 1800;

export function wordDiff(before: string, after: string): DiffPiece[] {
  const a = before.match(TOKEN) ?? [];
  const b = after.match(TOKEN) ?? [];
  if (a.length > LIMIT || b.length > LIMIT) return merge([{ kind: 'del', text: before }, { kind: 'ins', text: after }]);
  const n = a.length;
  const m = b.length;
  // lcs[i][j]: the longest shared run of a[i..] and b[j..], one flat array.
  const w = m + 1;
  const lcs = new Uint16Array((n + 1) * w);
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i * w + j] = a[i] === b[j] ? lcs[(i + 1) * w + j + 1] + 1 : Math.max(lcs[(i + 1) * w + j], lcs[i * w + j + 1]);
    }
  }
  const out: DiffPiece[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] });
      i++;
      j++;
    } else if (lcs[(i + 1) * w + j] >= lcs[i * w + j + 1]) out.push({ kind: 'del', text: a[i++] });
    else out.push({ kind: 'ins', text: b[j++] });
  }
  while (i < n) out.push({ kind: 'del', text: a[i++] });
  while (j < m) out.push({ kind: 'ins', text: b[j++] });
  return merge(out);
}

// One change = everything gone, then everything added, between two shared WORDS. A shared space between two changes belongs
// to the change (or «довга історія ~~розмови, яку~~ її надсилають» would split into four bits around the spaces).
function merge(pieces: DiffPiece[]): DiffPiece[] {
  const out: DiffPiece[] = [];
  let del = '';
  let ins = '';
  const flush = () => {
    if (del) out.push({ kind: 'del', text: del });
    if (ins) out.push({ kind: 'ins', text: ins });
    del = '';
    ins = '';
  };
  for (let k = 0; k < pieces.length; k++) {
    const p = pieces[k];
    if (p.kind === 'del') del += p.text;
    else if (p.kind === 'ins') ins += p.text;
    else if ((del || ins) && /^\s+$/.test(p.text) && pieces[k + 1] && pieces[k + 1].kind !== 'same') {
      del += p.text;
      ins += p.text;
    } else {
      flush();
      const last = out[out.length - 1];
      if (last && last.kind === 'same') last.text += p.text;
      else out.push({ kind: 'same', text: p.text });
    }
  }
  flush();
  return out;
}
