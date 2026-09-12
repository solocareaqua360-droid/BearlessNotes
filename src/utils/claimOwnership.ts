import { collection, getDocs, writeBatch } from '@react-native-firebase/firestore';
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
  'links',
  'photos',
  'projects',
  'settings',
  'stickers',
  'tags',
  'tasks',
] as const;

export type ClaimProgress = { collection: string; claimed: number; total: number };

// Stamps `ownerId` on everything that hasn't got one.
//
// Run ONCE, after signing in with Google and BEFORE the rules are tightened
// to owner-only. In that order it is safe in both directions: while the
// rules still accept any signed-in user, a document with no owner is still
// readable, so a half-finished run leaves nothing stranded and simply
// carries on next time. The other order locks the app out of its own data.
//
// Documents that already carry an ownerId are left alone - this is not a
// way to take someone else's data, and re-running it is harmless.
export async function claimExistingData(
  uid: string,
  onProgress?: (progress: ClaimProgress) => void
): Promise<number> {
  let claimed = 0;
  for (const name of OWNED_COLLECTIONS) {
    const snapshot = await getDocs(collection(db, name));
    const unowned = snapshot.docs.filter((d) => !d.data()?.ownerId);
    onProgress?.({ collection: name, claimed: 0, total: unowned.length });
    // Firestore caps a batch at 500 writes.
    for (let i = 0; i < unowned.length; i += 400) {
      const batch = writeBatch(db);
      for (const docSnapshot of unowned.slice(i, i + 400)) {
        batch.update(docSnapshot.ref, { ownerId: uid });
      }
      await batch.commit();
      claimed += Math.min(400, unowned.length - i);
      onProgress?.({ collection: name, claimed: Math.min(i + 400, unowned.length), total: unowned.length });
    }
  }
  return claimed;
}
