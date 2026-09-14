export type NodeBox = { x: number; y: number; width: number; height: number };

// A ref in react-native-web is the DOM element, and a DOM element has no
// `.measure` - see measureNode.ts for why this exists at all.
//
// getBoundingClientRect is the browser's answer to the same question, and
// it is used rather than returning null flat: the editor also measures the
// focused field, and a real number there is better than none. Coordinates
// are viewport-relative, which is what `measure`'s pageX/pageY mean in the
// places that read them.
export function measureNode(node: unknown): Promise<NodeBox | null> {
  const element = node as { getBoundingClientRect?: () => DOMRect } | null;
  if (!element || typeof element.getBoundingClientRect !== 'function') return Promise.resolve(null);
  const rect = element.getBoundingClientRect();
  return Promise.resolve({ x: rect.left, y: rect.top, width: rect.width, height: rect.height });
}

// No. The browser places the caret itself when the field is clicked, and
// the line data this would need (onTextLayout) is not reported here.
export const canPlaceCaretByTouch = false;
