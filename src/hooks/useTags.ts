import { useEffect, useState } from 'react';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  writeBatch,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Tag, TaggableKind } from '../types';

const tagsCollection = collection(db, 'tags');

function usedInKey(kind: TaggableKind, itemId: string): string {
  return `${kind}:${itemId}`;
}

// Shared across every screen that can carry tags (Files/Photos/Links so
// far). A tag exists only while at least one item still has it: attaching
// is the only way a tag gets created (see createAndAttachTag), and
// detaching the last item deletes it outright rather than leaving an
// orphaned, unattached tag doc around.
export function useTags() {
  const [tags, setTags] = useState<Tag[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const tagsQuery = query(tagsCollection, orderBy('path', 'asc'));
    return onSnapshot(tagsQuery, (snapshot) => {
      setTags(
        snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          return {
            id: docSnapshot.id,
            path: data.path,
            icon: data.icon,
            color: data.color,
            types: data.types ?? [],
            usedIn: data.usedIn ?? {},
          };
        })
      );
      setIsLoading(false);
    });
  }, []);

  // Autocomplete only kicks in from 2 letters, per the picker's own caption.
  function findMatches(prefix: string): Tag[] {
    const needle = prefix.trim().toLowerCase();
    if (needle.length < 2) return tags;
    return tags.filter((tag) => tag.path.toLowerCase().includes(needle));
  }

  function findExactPath(path: string): Tag | undefined {
    const needle = path.trim().toLowerCase();
    return tags.find((tag) => tag.path.toLowerCase() === needle);
  }

  // Attaches an existing tag to an item, silently expanding its `types`
  // list when this is the first time it's used on this kind of item.
  async function attachTag(tag: Tag, kind: TaggableKind, itemId: string, itemsCollection: string) {
    const batch = writeBatch(db);
    batch.update(doc(db, 'tags', tag.id), {
      [`usedIn.${usedInKey(kind, itemId)}`]: true,
      types: arrayUnion(kind),
    });
    batch.update(doc(db, itemsCollection, itemId), { tagIds: arrayUnion(tag.id) });
    await batch.commit();
  }

  // Creation only ever happens alongside a first assignment - there is no
  // standalone "create a tag" path anywhere in the app.
  async function createAndAttachTag(
    path: string,
    icon: string,
    color: string,
    kind: TaggableKind,
    itemId: string,
    itemsCollection: string
  ) {
    const tagRef = doc(tagsCollection);
    const batch = writeBatch(db);
    batch.set(tagRef, {
      path: path.trim(),
      icon,
      color,
      types: [kind],
      usedIn: { [usedInKey(kind, itemId)]: true },
    });
    batch.update(doc(db, itemsCollection, itemId), { tagIds: arrayUnion(tagRef.id) });
    await batch.commit();
    return tagRef.id;
  }

  // Removing the last usage deletes the tag doc outright rather than
  // leaving a zero-usage tag behind - see the Tag doc comment in types.ts.
  async function detachTag(tag: Tag, kind: TaggableKind, itemId: string, itemsCollection: string) {
    const remainingKeys = Object.keys(tag.usedIn).filter((key) => key !== usedInKey(kind, itemId));
    const batch = writeBatch(db);
    batch.update(doc(db, itemsCollection, itemId), { tagIds: arrayRemove(tag.id) });
    if (remainingKeys.length === 0) {
      batch.delete(doc(db, 'tags', tag.id));
    } else {
      batch.update(doc(db, 'tags', tag.id), { [`usedIn.${usedInKey(kind, itemId)}`]: deleteField() });
    }
    await batch.commit();
  }

  // Quick inline rename from the picker's pencil icon.
  async function renameTag(tag: Tag, newPath: string) {
    const batch = writeBatch(db);
    batch.update(doc(db, 'tags', tag.id), { path: newPath.trim() });
    await batch.commit();
  }

  return { tags, isLoading, findMatches, findExactPath, attachTag, createAndAttachTag, detachTag, renameTag };
}

// A tag's detach also has to run when the item carrying it is deleted
// outright (not just untagged) - screens call this once per tag on delete
// rather than going through detachTag's item-doc update, since the item
// doc is being removed anyway.
export async function detachTagFromDeletedItem(tag: Tag, kind: TaggableKind, itemId: string) {
  const remainingKeys = Object.keys(tag.usedIn).filter((key) => key !== usedInKey(kind, itemId));
  if (remainingKeys.length === 0) {
    await deleteDoc(doc(db, 'tags', tag.id));
  } else {
    const batch = writeBatch(db);
    batch.update(doc(db, 'tags', tag.id), { [`usedIn.${usedInKey(kind, itemId)}`]: deleteField() });
    await batch.commit();
  }
}
