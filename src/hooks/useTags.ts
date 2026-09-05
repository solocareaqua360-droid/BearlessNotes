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

// Kinds whose tag pools must not mix even though file/photo/link freely
// cross-tag - see the TaggableKind comment in types.ts.
const MUTUALLY_EXCLUSIVE_KINDS: TaggableKind[] = ['link-video', 'link-geo', 'link-other'];

// The Firestore collection each kind's items live in - video/geo/"other"
// links all share the one `links` collection (see LinksScreen's
// categoryOf), so this is a many-to-one map, not a 1:1 rename.
export const ITEMS_COLLECTION_BY_KIND: Record<TaggableKind, string> = {
  file: 'files',
  photo: 'photos',
  'link-video': 'links',
  'link-geo': 'links',
  'link-other': 'links',
  document: 'documents',
};

export function parseUsedInKey(key: string): { kind: TaggableKind; itemId: string } {
  const separatorIndex = key.indexOf(':');
  return { kind: key.slice(0, separatorIndex) as TaggableKind, itemId: key.slice(separatorIndex + 1) };
}

// Whether a tag should be offered/attachable for an item of this kind - the
// picker calls this to filter its suggestion list. A tag already used on a
// *different* mutually-exclusive kind (e.g. a video-only tag, for a geo
// item) is hidden; everything else (including a brand-new tag, or one
// shared with file/photo) is allowed.
export function isTagAllowedForKind(tag: Tag, kind: TaggableKind): boolean {
  if (!MUTUALLY_EXCLUSIVE_KINDS.includes(kind)) return true;
  return !tag.types.some((t) => t !== kind && MUTUALLY_EXCLUSIVE_KINDS.includes(t));
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

  // Explicit delete from TagManageScreen - strips the tag off every item
  // that currently carries it (not just one), then removes the tag doc
  // itself. Distinct from detachTag, which only ever removes one usage and
  // deletes the tag as a side effect of that usage being the last one.
  async function deleteTagCompletely(tag: Tag) {
    const batch = writeBatch(db);
    Object.keys(tag.usedIn).forEach((key) => {
      const { kind, itemId } = parseUsedInKey(key);
      const itemsCollection = ITEMS_COLLECTION_BY_KIND[kind];
      if (itemsCollection) batch.update(doc(db, itemsCollection, itemId), { tagIds: arrayRemove(tag.id) });
    });
    batch.delete(doc(db, 'tags', tag.id));
    await batch.commit();
  }

  return {
    tags,
    isLoading,
    findMatches,
    findExactPath,
    attachTag,
    createAndAttachTag,
    detachTag,
    renameTag,
    deleteTagCompletely,
  };
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
