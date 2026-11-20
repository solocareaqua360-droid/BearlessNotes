// The browser's name for the same thing - see setSelection.ts.
//
// Guarded rather than called flat: a ref can be a DOM node that is not a
// field (react-native-web renders some inputs through a wrapper), and a
// caret that lands in the wrong place is a nuisance while an exception
// here is a blank page.
type Selectable = {
  setSelectionRange?: (start: number, end: number) => void;
  focus?: () => void;
};

export function setSelection(input: unknown, start: number, end: number): void {
  const element = input as Selectable | null;
  if (!element || typeof element.setSelectionRange !== 'function') return;
  try {
    element.setSelectionRange(start, end);
  } catch {
    // Fields that are not yet laid out, or not text at all, refuse this.
    // The caret then sits where the browser put it, which is where the
    // click was - no worse than not asking.
  }
}
