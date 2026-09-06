import { useEffect, useState } from 'react';
import { arrayUnion, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { TaggableKind } from '../types';

function hiddenTagsDoc(kind: TaggableKind) {
  return doc(db, 'hiddenTags', kind);
}

// A tag hidden here only drops out of this one kind's own suggestion tree
// (Files/Photos/Links) - it stays attached to whatever items already carry
// it, and comes back the moment it's assigned to a new item of this kind
// (see useTags' attachTag, which un-hides on attach).
export function useHiddenTags(kind: TaggableKind) {
  const [hiddenIds, setHiddenIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    return onSnapshot(hiddenTagsDoc(kind), (snapshot) => {
      setHiddenIds(new Set(snapshot.data()?.tagIds ?? []));
    });
  }, [kind]);

  async function hideTag(tagId: string) {
    await setDoc(hiddenTagsDoc(kind), { tagIds: arrayUnion(tagId) }, { merge: true });
  }

  return { hiddenIds, hideTag };
}
