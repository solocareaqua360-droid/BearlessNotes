import type { TextInput } from 'react-native';

// Putting the caret at a known place in a text field.
//
// `setSelection` is React Native's method on a TextInput. In a browser a
// ref is the DOM <input>/<textarea>, which has setSelectionRange instead
// and no setSelection at all - so the call threw and took the page down
// on the first tap into a note. Same job, two names; the `.web` sibling
// holds the other one.
//
// Four callers, all of them about the caret rather than about text:
// opening a block puts it at the end or where a tap landed, and applying
// a format keeps it around the same words it was around before.
export function setSelection(input: TextInput | null | undefined, start: number, end: number): void {
  input?.setSelection(start, end);
}
