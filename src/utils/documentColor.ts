// Document card color assignment: each document gets a warm/muted palette
// color derived from its own Firestore id, not a random pick per render
// (which would make cards flicker between colors on every list refresh)
// and not a stored field (which would need a Firestore write on every
// existing document to backfill). A deterministic hash of the id gives
// every document a color that looks "random" between documents, is stable
// across app restarts and re-renders, and works identically for documents
// created before this feature existed.
const DOCUMENT_PALETTE = [
  '#DAA587', // Теплий Бежевий
  '#84B799', // М'який Шорсткий Зелений
  '#BE7657', // Теплий Теракотовий
  '#F8F8F8', // Майже Білий
  '#69736E', // М'який Сірий Гекс
  '#A0B4AF', // Блідо-М'ятний Зелений
  '#E6EBE6', // Світло-Кремовий Зелений
  '#556E78', // Глибокий Шорсткий Зелений
  '#788782', // М'який Блідий Шорсткий Зелений
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
  }
  return hash;
}

// Standard perceptual-luminance threshold for picking readable text over a
// solid fill - reuses the app's own near-black/white rather than pure
// #000/#fff so it still matches the rest of the UI's palette.
function contrastTextColor(hex: string): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const luminance = 0.299 * r + 0.587 * g + 0.114 * b;
  return luminance > 140 ? '#111827' : '#FFFFFF';
}

export function colorForDocument(id: string): { background: string; text: string; textMuted: string } {
  const background = DOCUMENT_PALETTE[hashString(id) % DOCUMENT_PALETTE.length];
  const text = contrastTextColor(background);
  const textMuted = text === '#FFFFFF' ? 'rgba(255,255,255,0.75)' : 'rgba(17,24,39,0.65)';
  return { background, text, textMuted };
}
