// Where a rendered node sits on the screen.
//
// `measure` is a React Native method on a host component: it hands back
// the node's size and its position on the page. The editor uses it for
// two things - placing the caret where a finger landed on locked text,
// and keeping the focused field clear of the keyboard.
//
// It is not a browser method. There a ref is the DOM element itself, and
// a DOM element has no `.measure`, so the call throws - which is what a
// tap on a note's text did in the browser: the editor opened, the tap
// took the whole page down. Behind this name, the browser can answer
// "cannot measure" instead of crashing.
type Measurable = { measure?: (cb: (x: number, y: number, w: number, h: number, px: number, py: number) => void) => void };

export type NodeBox = { x: number; y: number; width: number; height: number };

export function measureNode(node: Measurable | null): Promise<NodeBox | null> {
  return new Promise((resolve) => {
    if (!node || typeof node.measure !== 'function') {
      resolve(null);
      return;
    }
    try {
      node.measure((_x, _y, width, height, pageX, pageY) =>
        resolve({ x: pageX, y: pageY, width, height })
      );
    } catch {
      resolve(null);
    }
  });
}

// Whether a tap can place the caret at the character it landed on.
//
// This needs two things the browser does not give: measure above, and
// `onTextLayout`, which react-native-web does not implement - so the
// lines a touch would be matched against are never reported and the
// answer would be guesswork even if measuring worked.
//
// Nothing is lost by saying no here. On a phone the text is deliberately
// inert so a swipe can scroll from anywhere (see the edit-mode toggle),
// and this is what gives the caret back. In a browser the field is a real
// text field: clicking it puts the caret where it was clicked, natively,
// which is exactly what this reimplements.
export const canPlaceCaretByTouch = true;

// The same node, in WINDOW coordinates - the space a gesture-handler
// event's absoluteX/absoluteY are in.
//
// `measure` answers relative to the app's root view, which on Android
// starts below the status bar; a gesture's absolute position counts from
// the top of the window, status bar included. Subtracting one from the
// other therefore put every tap on the canvas a status bar's height too
// low - the caret landed on the right character of the WRONG line, which
// read as "the caret obeys a tap at the start of a line and not at the
// end". Where the touch came from a gesture, measure in the window.
type MeasurableInWindow = { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void };

export function measureNodeInWindow(node: MeasurableInWindow | null): Promise<NodeBox | null> {
  return new Promise((resolve) => {
    if (!node || typeof node.measureInWindow !== 'function') {
      resolve(null);
      return;
    }
    try {
      node.measureInWindow((x, y, width, height) => resolve({ x, y, width, height }));
    } catch {
      resolve(null);
    }
  });
}
