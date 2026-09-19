// The one door the app uses to reach Firestore.
//
// Every screen, hook and helper imports the database API from here rather
// than from a package, and that indirection is the whole point: the
// native app talks to @react-native-firebase, a browser cannot (it is a
// native module), and the browser build will get a sibling of this file
// pointing at the plain JavaScript SDK instead. Metro picks the sibling
// for the web target by itself.
//
// It costs nothing on the phone - a re-export is not a layer, it compiles
// to the same calls - and it is the difference between "swap one file"
// and "edit fifty".
//
// Both SDKs expose the SAME modular API, name for name: collection, doc,
// onSnapshot, query, where, writeBatch and the rest. That is what makes
// this possible at all, and it is why nothing here wraps or renames
// anything: the moment this file starts having opinions, the two sides
// can drift.
export * from '@react-native-firebase/firestore';
