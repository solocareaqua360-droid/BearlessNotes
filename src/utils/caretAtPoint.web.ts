// Which character a click landed on - see caretAtPoint.ts.
//
// This is what makes the FIRST click on a block put the cursor where it
// was aimed. Without it the first click only woke the block up and the
// caret went wherever, so placing it took a second click - which is not
// how text behaves anywhere else on a laptop.
//
// The two names are the same API under two specs: `caretRangeFromPoint`
// in Chrome and Safari, `caretPositionFromPoint` in Firefox.
type LegacyDocument = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
};

export function caretIndexFromDom(node: unknown, pageX: number, pageY: number): number | null {
  const root = node as HTMLElement | null;
  if (!root || typeof document === 'undefined') return null;

  // The point arrives page-relative (it is `pageX` in a React Native
  // touch); these APIs want it viewport-relative.
  const x = pageX - window.scrollX;
  const y = pageY - window.scrollY;

  const doc = document as LegacyDocument;
  let container: Node | null = null;
  let offset = 0;
  if (typeof doc.caretRangeFromPoint === 'function') {
    const range = doc.caretRangeFromPoint(x, y);
    if (!range) return null;
    container = range.startContainer;
    offset = range.startOffset;
  } else if (typeof doc.caretPositionFromPoint === 'function') {
    const position = doc.caretPositionFromPoint(x, y);
    if (!position) return null;
    container = position.offsetNode;
    offset = position.offset;
  } else {
    return null;
  }

  if (!container || container.nodeType !== Node.TEXT_NODE || !root.contains(container)) return null;

  // The answer is an offset inside ONE text node, and the block is split
  // across several of them - a bold run is its own element. So the text
  // before it is counted, in the order it is drawn, to turn a local
  // offset into an index into the whole visible string.
  //
  // Visible is the point: what this returns matches the text WITHOUT the
  // formatting markers, which is exactly what the caller's
  // rawIndexForDisplayIndex expects to be given.
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let index = 0;
  while (walker.nextNode()) {
    const current = walker.currentNode;
    if (current === container) return index + offset;
    index += current.textContent?.length ?? 0;
  }
  return null;
}
