import { doc, getDocs, setDoc } from '../firestore';
import { db } from '../firebase';
import { ownedQuery } from './owned';
import { keyedAll, readBoardPart } from './boardStorage';
import { BoardCard, BoardColumn, BoardConnection } from '../types';

// Every board's cards/columns/connections, as a map keyed by id - and
// nothing left holding an array.
//
// Both shapes have been readable all along (readBoardPart), and a board
// converts itself the first time anyone edits it (see BoardScreen's
// shapeRef). So a board nobody has touched since the keyed shape arrived
// is still an array, indefinitely, and the two shapes live side by side
// in the same collection.
//
// That is the part that had to end. A field holding an array cannot be
// patched one entry at a time: Firestore does not merge a map into an
// array, it REPLACES the array - so a per-card write, the correct and
// obvious way to write one card, silently deletes every other card on
// that board. It has already happened once here, to a board called
// «mindEva», and the guard that would have caught it existed in one
// caller and not in the next one written. Guards per caller is the wrong
// shape of fix for that; having nothing left to guard against is the
// right one.
//
// Idempotent, and self-limiting: after the one pass that converts them,
// there is nothing to write and this touches the network only to read.
export async function migrateBoardShapes(): Promise<number> {
  const boards = await getDocs(ownedQuery('boards'));
  // A cached answer cannot be trusted for this. The whole document is
  // rewritten here, so acting on a stale local copy would put back
  // whatever another device has changed since. The same reason
  // BoardScreen refuses to save while its shape is 'unknown' - and the
  // same remedy: leave it, and let the next launch ask again.
  if (boards.metadata.fromCache) return 0;

  let converted = 0;
  for (const snapshot of boards.docs) {
    const data = snapshot.data();
    const legacy =
      Array.isArray(data?.cards) || Array.isArray(data?.columns) || Array.isArray(data?.connections);
    if (!legacy) continue;
    await setDoc(
      doc(db, 'boards', snapshot.id),
      {
        cards: keyedAll(readBoardPart<BoardCard>(data?.cards)),
        columns: keyedAll(readBoardPart<BoardColumn>(data?.columns)),
        connections: keyedAll(readBoardPart<BoardConnection>(data?.connections)),
      },
      { merge: true }
    );
    converted += 1;
  }
  return converted;
}
