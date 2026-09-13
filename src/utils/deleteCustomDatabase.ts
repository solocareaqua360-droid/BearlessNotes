import { collection, getDocs, doc, writeBatch } from '../firestore';
import { db } from '../firebase';

// A database the user made, and everything that only exists because of it:
// its rows, and the saved views that describe it. A view left behind is a
// name pointing at nothing.
//
// Shared because it is reachable from two places now - from inside the
// database, and from its tile on the board - and a second copy of this
// would be a second chance to forget one of the three collections.
export async function deleteCustomDatabase(databaseId: string) {
  const [rows, views] = await Promise.all([
    getDocs(collection(db, 'customDatabaseRows')),
    getDocs(collection(db, 'customDatabaseViews')),
  ]);
  const batch = writeBatch(db);
  rows.docs.forEach((row) => {
    if (row.data().databaseId === databaseId) batch.delete(row.ref);
  });
  views.docs.forEach((view) => {
    if (view.data().databaseId === databaseId) batch.delete(view.ref);
  });
  batch.delete(doc(db, 'customDatabases', databaseId));
  await batch.commit();
}
