import { DependencyList } from 'react';
import type { IKeyboardState } from 'react-native-keyboard-controller';

// A browser has no soft keyboard, so there is nothing to follow.
//
// The editor's whole keyboard choreography - lifting the toolbar, scrolling
// the focused block clear, growing the spacer underneath - exists because a
// keyboard slides up over the content on a phone and the focused line has
// to stay visible through the animation. On a laptop the text field is
// already where it will stay.
//
// So this is a no-op rather than an approximation: doing nothing is the
// CORRECT behaviour here, not a gap to fill later. The handlers themselves
// are worklets bound to react-native-keyboard-controller, which has no web
// build - and a hook in node_modules cannot have a `.web` sibling, which
// is the whole reason this thin module exists at this name.
//
// The values those handlers would have written (keyboardSV, keyboardHeight)
// simply stay at zero, and every piece of layout that reads them settles at
// its keyboard-down position - which is the only position there is here.
type Handlers = Record<string, unknown>;

export function useEditorKeyboard(_handlers: Handlers, _deps?: DependencyList): void {}

// The keyboard's state, which here is permanently "down".
//
// Missing from this file until 2026-09-22, and the omission was invisible
// for as long as the browser only ever showed ONE column: the editor is
// the only caller, and on a narrow window the documents list does not
// mount it. Open the same list wide enough for the two-pane layout - the
// Mac window is, by default - and the editor mounts beside it and brings
// this down with "(0 , $.useKeyboardState) is not a function", drawn as
// the app's own crash screen over the whole page.
//
// The shape has to be the real one, not an empty object: callers select a
// field out of it, and a selector reading `undefined.height` fails just
// as loudly as the missing function did.
const DOWN: IKeyboardState = {
  isVisible: false,
  height: 0,
  duration: 0,
  timestamp: 0,
  target: -1,
  type: 'default',
  appearance: 'light',
};

export function useKeyboardState<T = IKeyboardState>(
  selector?: (state: IKeyboardState) => T
): T {
  return (selector ? selector(DOWN) : DOWN) as T;
}
