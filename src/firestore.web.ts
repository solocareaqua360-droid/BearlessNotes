// The browser's half of the seam - see firestore.ts for why it exists.
//
// The same modular API, from the plain JavaScript SDK this time. Metro
// picks this file over its sibling for the web target on its own; nothing
// imports it by name, and nothing should.
export * from 'firebase/firestore';
