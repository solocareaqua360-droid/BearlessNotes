// A browser's multi-line field does NOT grow with its text.
//
// react-native-web renders `multiline` as a <textarea>, and a textarea has
// a fixed height - two rows by default - with everything past that
// scrolled out of sight inside it. Which is what a long note block did
// here: tapping it collapsed six paragraphs into a two-line box and hid
// the rest, looking for all the world like the text had been lost.
//
// The fix is the one every textarea uses: measure the content and set the
// height to it. `height = 0` first, and that is not superstition - a
// textarea's scrollHeight can never report LESS than its current height,
// so without collapsing it first the field would grow and never shrink
// again when text is deleted.
export function autoGrowInput(input: unknown): void {
  const element = input as HTMLTextAreaElement | null;
  if (!element || typeof element.scrollHeight !== 'number' || !element.style) return;
  // `flex` is deliberately left alone. The block row lays out
  // HORIZONTALLY, so the shared style's flex: 1 governs the field's WIDTH,
  // not its height - clearing it made the field shrink to a textarea's
  // default twenty columns while fixing nothing, since height was never
  // flex's to decide here.
  element.style.overflow = 'hidden';
  element.style.height = '0px';
  element.style.height = `${element.scrollHeight}px`;
}
