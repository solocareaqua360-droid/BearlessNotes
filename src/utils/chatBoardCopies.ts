import { collection, deleteDoc, doc, onSnapshot, updateDoc } from '../firestore';
import { addDoc, ownedQuery } from './owned';
import { db } from '../firebase';

// COPIES ON THE CHAT'S BOARD (2026-10-07). A copy is a message's card put on
// the table outside its day's frame, where it can be dragged anywhere; the
// message itself stays in the chat untouched, and a dashed thread joins the
// copy to it. The position is in the table's own coordinates (the board at
// its nearest height), so it does not depend on the zoom. One document per
// copy, in its own collection: the chat stays a plain chronology, and
// deleting a copy cannot touch a message.
export type BoardCopy = { id: string; messageId: string; x: number; y: number; createdAt: number };

export function watchBoardCopies(onCopies: (copies: BoardCopy[]) => void, onError: (error: Error) => void) {
  return onSnapshot(
    ownedQuery('chatBoardCopies'),
    (snapshot) => {
      onCopies(
        snapshot.docs.map((d) => ({
          id: d.id,
          messageId: (d.data().messageId as string) ?? '',
          x: (d.data().x as number) ?? 0,
          y: (d.data().y as number) ?? 0,
          createdAt: (d.data().createdAt as number) ?? 0,
        }))
      );
    },
    (e) => onError(e as Error)
  );
}

export async function addBoardCopy(messageId: string, x: number, y: number) {
  await addDoc(collection(db, 'chatBoardCopies'), { messageId, x, y, createdAt: Date.now() });
}

export async function moveBoardCopy(id: string, x: number, y: number) {
  await updateDoc(doc(db, 'chatBoardCopies', id), { x, y });
}

export async function removeBoardCopy(id: string) {
  await deleteDoc(doc(db, 'chatBoardCopies', id));
}
