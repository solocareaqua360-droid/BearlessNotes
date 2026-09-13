import {
  addDoc as firestoreAddDoc,
  setDoc as firestoreSetDoc,
} from '../firestore';
import { auth } from '../firebase';

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

export function setDoc(
  reference: Parameters<typeof firestoreSetDoc>[0],
  data: Data,
  options?: Parameters<typeof firestoreSetDoc>[2]
) {
  return options
    ? firestoreSetDoc(reference, withOwner(data), options)
    : firestoreSetDoc(reference, withOwner(data));
}
