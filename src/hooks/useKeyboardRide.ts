// The keyboard's height, frame by frame, as a shared value (negative
// while it is up) - what the soft dock's search field rides on.
//
// A module of its own for the same reason useEditorKeyboard is one:
// react-native-keyboard-controller has no web build, and a hook in
// node_modules cannot have a `.web` sibling. See useKeyboardRide.web.ts.
export { useReanimatedKeyboardAnimation as useKeyboardRide } from 'react-native-keyboard-controller';
