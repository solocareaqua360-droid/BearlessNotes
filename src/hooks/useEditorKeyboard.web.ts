import { DependencyList } from 'react';

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
