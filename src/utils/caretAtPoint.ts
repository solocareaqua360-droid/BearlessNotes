// Which character a click landed on, asked of the document itself.
//
// A browser knows this exactly - it is what happens when you click into
// any paragraph on any web page - and it needs neither the node's measured
// position nor the line boxes the phone's version works from. See the
// `.web` sibling.
//
// On a phone there is no such question to ask: the answer is worked out
// from measure() plus onTextLayout, which is what the editor already does.
// So this returns null and the caller falls through to that.
export function caretIndexFromDom(
  _node: unknown,
  _pageX: number,
  _pageY: number
): number | null {
  return null;
}
