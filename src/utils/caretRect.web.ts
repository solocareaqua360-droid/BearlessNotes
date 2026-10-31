// WHERE THE CARET STANDS ON THE SCREEN (the Mac's popups, 2026-10-20, «як у Craft»: the «@» window opens right under
// the word being typed, not under the block). A textarea does not say where its caret is, so the text before the caret is
// laid out in a hidden copy of the field - same font, width and padding - and a marker at its end is measured.
export function caretPoint(): { left: number; top: number; height: number } | null {
  const el = document.activeElement as HTMLTextAreaElement | null;
  if (!el || el.tagName !== 'TEXTAREA') return null;
  const box = el.getBoundingClientRect();
  const cs = getComputedStyle(el);
  const mirror = document.createElement('div');
  const props = ['fontFamily', 'fontSize', 'fontWeight', 'fontStyle', 'letterSpacing', 'lineHeight', 'textTransform', 'wordSpacing', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'boxSizing', 'textIndent'] as const;
  for (const p of props) (mirror.style as unknown as Record<string, string>)[p] = cs[p];
  mirror.style.position = 'fixed';
  mirror.style.visibility = 'hidden';
  mirror.style.left = `${box.left}px`;
  mirror.style.top = `${box.top}px`;
  mirror.style.width = `${box.width}px`;
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.textContent = el.value.slice(0, el.selectionStart ?? el.value.length);
  const marker = document.createElement('span');
  marker.textContent = '​';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);
  const at = marker.getBoundingClientRect();
  document.body.removeChild(mirror);
  const line = parseFloat(cs.lineHeight) || at.height || 24;
  return { left: at.left - el.scrollLeft, top: at.top - el.scrollTop, height: line };
}
