import { useEffect, useState } from 'react';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  getDocs,
  setDoc,
  deleteField,
  doc,
  onSnapshot,
  updateDoc,
  writeBatch,
} from '../firestore';
import { auth, db } from '../firebase';
import { ownedQuery } from '../utils/owned';
import { Tag, TaggableKind } from '../types';
import { listenError } from '../utils/listenError';

const tagsCollection = collection(db, 'tags');

function usedInKey(kind: TaggableKind, itemId: string): string {
  return `${kind}:${itemId}`;
}

// Kinds whose tag pools must not mix even though file/photo/link freely
// cross-tag - see the TaggableKind comment in types.ts.
const MUTUALLY_EXCLUSIVE_KINDS: TaggableKind[] = ['link-video', 'link-geo', 'link-other'];

function isCustomRowKind(kind: TaggableKind): boolean {
  return kind.startsWith('customRow:');
}

// The Firestore collection each kind's items live in - video/geo/"other"
// links all share the one `links` collection (see LinksScreen's
// categoryOf), so this is a many-to-one map, not a 1:1 rename. Every custom
// database's rows (kind `customRow:${databaseId}`) also share one
// collection - handled dynamically in itemsCollectionForKind below rather
// than one static entry per database.
export const ITEMS_COLLECTION_BY_KIND: Record<TaggableKind, string> = {
  file: 'files',
  photo: 'photos',
  'link-video': 'links',
  'link-geo': 'links',
  'link-other': 'links',
  document: 'documents',
};

export function itemsCollectionForKind(kind: TaggableKind): string | undefined {
  if (isCustomRowKind(kind)) return 'customDatabaseRows';
  return ITEMS_COLLECTION_BY_KIND[kind];
}

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
  // Every custom database is its own vocabulary, same reasoning as the
  // link sub-categories below - a "recipes" database's tags shouldn't leak
  // into a "books" database's suggestions. Unlike the link kinds, a
  // customRow tag is still freely shared with file/photo/document's own
  // pool (only OTHER customRow kinds are excluded), so a database can still
  // reuse a tag that's already used across the rest of the app.
  if (isCustomRowKind(kind)) {
    return !tag.types.some((t) => isCustomRowKind(t) && t !== kind);
  }
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
    return onSnapshot(ownedQuery('tags'), (snapshot) => {
      setTags(
        [...snapshot.docs]
          .sort((a, b) => String(a.data().path ?? '').localeCompare(String(b.data().path ?? '')))
          .map((docSnapshot) => {
          const data = docSnapshot.data();
          return {
            id: docSnapshot.id,
            path: data.path,
            icon: data.icon,
            color: data.color,
            types: data.types ?? [],
            usedIn: data.usedIn ?? {},
            keep: !!data.keep,
          };
        })
      );
      setIsLoading(false);
    }, listenError('useTags:tags'));
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
  // list when this is the first time it's used on this kind of item. Also
  // un-hides it from this kind's own suggestion tree (see useHiddenTags) -
  // a fresh assignment is exactly the signal that should bring a
  // previously-hidden tag back.
  async function attachTag(tag: Tag, kind: TaggableKind, itemId: string, itemsCollection: string) {
    const batch = writeBatch(db);
    batch.update(doc(db, 'tags', tag.id), {
      [`usedIn.${usedInKey(kind, itemId)}`]: true,
      types: arrayUnion(kind),
    });
    batch.update(doc(db, itemsCollection, itemId), { tagIds: arrayUnion(tag.id) });
    batch.set(
      doc(db, 'hiddenTags', kind),
      { tagIds: arrayRemove(tag.id), ownerId: auth.currentUser?.uid ?? null },
      { merge: true }
    );
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
      // By hand here: a batched write has no wrapper to go through (see
      // utils/owned), and the owner-only rules refuse a create without it.
      ownerId: auth.currentUser?.uid ?? null,
    });
    batch.update(doc(db, itemsCollection, itemId), { tagIds: arrayUnion(tagRef.id) });
    await batch.commit();
    return tagRef.id;
  }

  // The bulk twin: every screen's own "new tag from a multi-select"
  // used to just map createAndAttachTag over the selected ids, which
  // means "one call per item" - and this function creates a document
  // every single time it runs. Six identical items selected made six
  // identical-looking tags, each `usedIn` exactly one of them, because
  // nothing was ever shared between the calls. This is the shared
  // creation happening ONCE, with every id folded into that one tag's
  // `usedIn` before it is ever written - there is no smaller unit than
  // "the whole selection" for a brand new tag to be created against.
  //
  // One batch, so no per-item cap beyond Firestore's own 500 writes to a
  // batch (1 create + N updates here) - well past anything a hand-made
  // selection reaches.
  async function createAndAttachTagToMany(
    path: string,
    icon: string,
    color: string,
    kind: TaggableKind,
    itemIds: string[],
    itemsCollection: string
  ) {
    const tagRef = doc(tagsCollection);
    const batch = writeBatch(db);
    const usedIn: Record<string, true> = {};
    for (const itemId of itemIds) usedIn[usedInKey(kind, itemId)] = true;
    batch.set(tagRef, {
      path: path.trim(),
      icon,
      color,
      types: [kind],
      usedIn,
      ownerId: auth.currentUser?.uid ?? null,
    });
    for (const itemId of itemIds) {
      batch.update(doc(db, itemsCollection, itemId), { tagIds: arrayUnion(tagRef.id) });
    }
    await batch.commit();
    return tagRef.id;
  }

  // A folder made on purpose in «Провідник»: a tag with nothing in it
  // yet, kept alive by `keep` (see the Tag doc comment in types.ts) so
  // the empty-tag rule below leaves it alone. Given a folder's own icon
  // and a colour from the palette, like a tag made from a note is.
  async function createFolderTag(path: string, kind: TaggableKind, color: string) {
    const tagRef = doc(tagsCollection);
    await setDoc(tagRef, {
      path: path.trim(),
      icon: 'folder-outline',
      color,
      types: [kind],
      usedIn: {},
      keep: true,
      ownerId: auth.currentUser?.uid ?? null,
    });
    return tagRef.id;
  }

  // Removing the last usage deletes the tag doc outright rather than
  // leaving a zero-usage tag behind - see the Tag doc comment in types.ts.
  // Unless the tag is kept: a folder made on purpose survives being
  // emptied.
  async function detachTag(tag: Tag, kind: TaggableKind, itemId: string, itemsCollection: string) {
    const remainingKeys = Object.keys(tag.usedIn).filter((key) => key !== usedInKey(kind, itemId));
    const batch = writeBatch(db);
    batch.update(doc(db, itemsCollection, itemId), { tagIds: arrayRemove(tag.id) });
    if (remainingKeys.length === 0 && !tag.keep) {
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

  // Full edit from TagManageScreen - path, icon and color all at once,
  // unlike renameTag's path-only quick fix from the per-item picker.
  async function updateTag(tag: Tag, updates: { path: string; icon: string; color: string }) {
    await updateDoc(doc(db, 'tags', tag.id), {
      path: updates.path.trim(),
      icon: updates.icon,
      color: updates.color,
    });
  }

  // Explicit delete from TagManageScreen - strips the tag off every item
  // that currently carries it (not just one), then removes the tag doc
  // itself. Distinct from detachTag, which only ever removes one usage and
  // deletes the tag as a side effect of that usage being the last one.
  async function deleteTagCompletely(tag: Tag) {
    const batch = writeBatch(db);
    Object.keys(tag.usedIn).forEach((key) => {
      const { kind, itemId } = parseUsedInKey(key);
      const itemsCollection = itemsCollectionForKind(kind);
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
    createAndAttachTagToMany,
    createFolderTag,
    detachTag,
    renameTag,
    updateTag,
    deleteTagCompletely,
  };
}

// A tag's detach also has to run when the item carrying it is deleted
// outright (not just untagged) - screens call this once per tag on delete
// rather than going through detachTag's item-doc update, since the item
// doc is being removed anyway.
export async function detachTagFromDeletedItem(tag: Tag, kind: TaggableKind, itemId: string) {
  const remainingKeys = Object.keys(tag.usedIn).filter((key) => key !== usedInKey(kind, itemId));
  if (remainingKeys.length === 0 && !tag.keep) {
    await deleteDoc(doc(db, 'tags', tag.id));
  } else {
    const batch = writeBatch(db);
    batch.update(doc(db, 'tags', tag.id), { [`usedIn.${usedInKey(kind, itemId)}`]: deleteField() });
    await batch.commit();
  }
}

// A ONE-TIME repair, run from Settings: before createAndAttachTagToMany
// existed, a new tag made from a multi-select created one tag PER
// SELECTED ITEM (see the memory `bulk_tag_duplication_fixed`) - every one
// named alike, each carrying exactly the one item it was made for. This
// finds every such set of same-name, same-kind tags still sitting in the
// user's own data and folds each set back into the single tag it should
// always have been.
//
// Not batched: two array-transform writes to the SAME item doc
// (un-tagging every duplicate, then tagging the survivor) can land in one
// write batch, but only by reading the field first to merge them by hand -
// more risk than a one-time, low-frequency repair is worth. Plain
// sequential updates instead; slower, and correct without a read.
export async function mergeDuplicateTags(): Promise<{ groups: number; tagsRemoved: number }> {
  const snapshot = await getDocs(ownedQuery('tags'));
  const all = snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Tag, 'id'>) }));
  const groups = new Map<string, Tag[]>();
  for (const tag of all) {
    const key = `${tag.path}\u0000${[...tag.types].sort().join(',')}`;
    const list = groups.get(key);
    if (list) list.push(tag);
    else groups.set(key, [tag]);
  }

  let groupsFixed = 0;
  let tagsRemoved = 0;
  for (const list of groups.values()) {
    if (list.length < 2) continue;
    groupsFixed++;
    // Whichever member happens first - every one of them looks and
    // behaves identically, so which specific id survives makes no
    // difference to the app or the user.
    const [keep, ...dupes] = list;
    const mergedUsedIn: Record<string, true> = { ...keep.usedIn };
    const mergedTypes = new Set(keep.types);
    // A dupe kept on purpose (an empty folder made in «Провідник») still
    // deserves that - the merge must not quietly turn it deletable.
    let mergedKeep = !!keep.keep;

    for (const dupe of dupes) {
      mergedKeep = mergedKeep || !!dupe.keep;
      for (const key of Object.keys(dupe.usedIn)) {
        mergedUsedIn[key] = true;
        mergedTypes.add(parseUsedInKey(key).kind);
        const { kind, itemId } = parseUsedInKey(key);
        const collectionName = itemsCollectionForKind(kind);
        // A kind this repair has no map for (see itemsCollectionForKind)
        // is left exactly as it was on that one item - still tagged with
        // the dupe, which stays reachable through it, rather than risking
        // a write against a collection this cannot name.
        if (!collectionName) continue;
        await updateDoc(doc(db, collectionName, itemId), { tagIds: arrayRemove(dupe.id) });
        await updateDoc(doc(db, collectionName, itemId), { tagIds: arrayUnion(keep.id) });
      }
      await deleteDoc(doc(db, 'tags', dupe.id));
      tagsRemoved++;
    }

    await updateDoc(doc(db, 'tags', keep.id), {
      usedIn: mergedUsedIn,
      types: Array.from(mergedTypes),
      ...(mergedKeep ? { keep: true } : {}),
    });
  }

  return { groups: groupsFixed, tagsRemoved };
}
