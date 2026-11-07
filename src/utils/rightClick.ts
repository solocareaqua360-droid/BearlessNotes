// The right mouse button as a HOLD's twin. A press held down is the phone's
// way to ask "what can I do with this"; on a laptop the hand expects the
// right button, and waiting half a second for a menu feels like the app is
// thinking. On a phone this returns nothing (there is no right button); the
// web sibling turns the browser's own contextmenu event into the same call.
export function rightClick(_handler?: (() => void) | undefined): object {
  return {};
}

// The same thing for a node whose ref is already spoken for.
export function bindRightClick(_node: unknown, _handler?: (() => void) | undefined): void {}
