import { collection, getDocs, writeBatch } from '../firestore';
import { db } from '../firebase';

// Every collection this app writes. Listed rather than discovered: Firestore
// has no way to enumerate collections from a client, and a collection left
// off this list is data that silently stays unowned - and so, once the rules
// tighten, unreachable.
export const OWNED_COLLECTIONS = [
  'boards',
  'customDatabaseRows',
  'customDatabaseViews',
  'customDatabases',
  'documents',
  'files',
  'groups',
  'hiddenTags',
  'links',
  'photos',
  'settings',
  'stickers',
  'tags',
  'taskLists',
  'tasks',
] as const;

export type ClaimProgress = { collection: string; claimed: number; total: number };

// Makes `uid` the owner of everything in this project.
//
// Run ONCE, after signing in with Google and BEFORE the rules are tightened
// to owner-only. In that order it is safe in both directions: while the
// rules still accept any signed-in user, a document with no owner is still
// readable, so a half-finished run leaves nothing stranded and simply
// carries on next time. The other order locks the app out of its own data.
//
// It claims documents that carry SOMEONE ELSE'S uid too, and that is
// deliberate. `owned.setDoc` stamps the writer's uid on every write, merges
// included - so while the browser was still an anonymous session, every
// board it saved quietly changed hands. Three documents ended up that way,
// «Дошка 1» among them. They were never another person's: they are this
// app, on this user's own machine, before it had a name. Leaving them where
// they lie means the owner-only rules hide them from the account that
// actually uses them, with no way in from the client afterwards.
//
// Which is why this runs from Settings, from the phone, under the account
// that is signing in - one account ends up owning the project, which is
// exactly what the rules below it assume.
export async function claimExistingData(
  uid: string,
  onProgress?: (progress: ClaimProgress) => void
): Promise<number> {
  let claimed = 0;
  for (const name of OWNED_COLLECTIONS) {
    // The one read in the app that is NOT narrowed by ownedQuery, and it
    // has to be: this is what finds the documents that are under the wrong
    // owner, so it cannot ask only for the ones already under the right
    // one. Which is also why it only works while the rules are still open -
    // the whole reason it runs before they tighten, not after.
    const snapshot = await getDocs(collection(db, name));
    const toClaim = snapshot.docs.filter((d) => d.data()?.ownerId !== uid);
    onProgress?.({ collection: name, claimed: 0, total: toClaim.length });
    // Firestore caps a batch at 500 writes.
    for (let i = 0; i < toClaim.length; i += 400) {
      const batch = writeBatch(db);
      for (const docSnapshot of toClaim.slice(i, i + 400)) {
        batch.update(docSnapshot.ref, { ownerId: uid });
      }
      await batch.commit();
      claimed += Math.min(400, toClaim.length - i);
      onProgress?.({ collection: name, claimed: Math.min(i + 400, toClaim.length), total: toClaim.length });
    }
  }
  return claimed;
}
