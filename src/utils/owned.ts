import {
  addDoc as firestoreAddDoc,
  collection,
  query,
  setDoc as firestoreSetDoc,
  where,
  type QueryConstraint,
} from '../firestore';
import { auth, db } from '../firebase';

// Every document this app creates carries the uid of whoever created it.
//
// Not a nicety: the owner-only rules require `request.resource.data.ownerId
// == request.auth.uid` on create, so a write that forgets it is REFUSED
// once those land. There are nearly sixty create sites, and one forgotten
// would be a feature that silently stops working - so the field is added
// here, in one place, rather than typed out at each of them.
//
// While no one is signed in (the anonymous user at first launch, before
// Google) there is still a uid, and it is still the right one to stamp:
// linking to Google keeps it.
type Data = Record<string, unknown>;

function withOwner(data: Data): Data {
  const uid = auth.currentUser?.uid;
  return uid ? { ...data, ownerId: uid } : data;
}

export function addDoc(reference: Parameters<typeof firestoreAddDoc>[0], data: Data) {
  return firestoreAddDoc(reference, withOwner(data));
}

// Reading a whole collection, narrowed to this account.
//
// Firestore's rules are NOT a filter. `allow read: if resource.data.ownerId
// == request.auth.uid` does not quietly drop the documents that fail it -
// it refuses the QUERY, whole, unless the query itself is already narrow
// enough to prove it can only return permitted documents. So a plain
// `collection(db, 'documents')` returns everything today and NOTHING the
// moment the owner-only rules land. Every list in the app reads through
// this instead, so the two land together.
//
// Deliberately no `orderBy` here, and none at the call sites any more: an
// equality filter plus a sort on another field needs a composite index,
// eight of them across this app, each one a trip to the Firebase console.
// These collections hold dozens of documents, not thousands - sorting them
// in JS after they arrive costs nothing and keeps the app deployable from
// here.
//
// Any screen mounts only after ensureSignedIn() has resolved (see App.tsx),
// so there is a uid by the time this is called. The empty string is there
// for the impossible case, and it matches nothing - which is the right
// answer: showing another account's data is worse than showing none.
export function ownedQuery(name: string, ...constraints: QueryConstraint[]) {
  return query(
    collection(db, name),
    where('ownerId', '==', auth.currentUser?.uid ?? ''),
    ...constraints
  );
}

export function setDoc(
  reference: Parameters<typeof firestoreSetDoc>[0],
  data: Data,
  options?: Parameters<typeof firestoreSetDoc>[2]
) {
  return options
    ? firestoreSetDoc(reference, withOwner(data), options)
    : firestoreSetDoc(reference, withOwner(data));
}
