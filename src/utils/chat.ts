import { collection, deleteDoc, doc, onSnapshot, updateDoc } from '../firestore';
import { addDoc, ownedQuery } from './owned';
import { ChatAttachment } from './chatAttach';
import { db } from '../firebase';

// «Загальний чат» - the capture inbox. Its whole reason is the cost of
// writing a thought down: the user is testing the app, keeps spotting
// "тут недопрацьовка", and opening a note called "баги" is already too
// much - "це настільки довго що вже й не хочеться". So: hold the dock,
// speak, done.
//
// Its own collection rather than blocks in a note, at the user's own
// call. A message is never consumed: harvesting one into a note leaves
// it here, with a line saying WHICH note took it.
export type ChatMessage = {
  id: string;
  text: string;
  createdAt: number;
  // documentId -> that note's title at the moment it was taken. The title
  // is stored rather than looked up: this is a record of what happened,
  // and renaming the note later does not change what happened.
  usedIn?: Record<string, string>;
  // taskId -> the id of the note the checkbox lives in (today's daily
  // note, see createTaskInToday). Same idea as usedIn: the message says
  // what it became and can take you there.
  tasks?: Record<string, string>;
  // A photo, a video, a link or a geo point. Whatever it is, it is
  // ALREADY a record in its own database (see chatAttach) - this is a
  // pointer to it, so the chat and «Зображення» show one picture.
  attachment?: ChatAttachment;
};

const chatCollection = collection(db, 'chat');

export async function sendChatMessage(
  text: string,
  attachment?: ChatAttachment | null
): Promise<string | null> {
  const trimmed = text.trim();
  // An attachment is a whole message on its own - a photo with nothing
  // said about it is still a thought caught.
  if (!trimmed && !attachment) return null;
  const ref = await addDoc(chatCollection, {
    text: trimmed,
    createdAt: Date.now(),
    ...(attachment ? { attachment } : {}),
  });
  return ref.id;
}

// Every message, oldest first - the order a chat is read in. Sorted here
// rather than in the query: ownedQuery carries an equality filter, and a
// second orderBy on top of one needs a composite index (see its comment).
export function watchChat(
  onMessages: (messages: ChatMessage[]) => void,
  onError: (error: Error) => void
) {
  return onSnapshot(
    ownedQuery('chat'),
    (snapshot) => {
      const messages = snapshot.docs
        .map((d) => ({
          id: d.id,
          text: (d.data().text as string) ?? '',
          createdAt: (d.data().createdAt as number) ?? 0,
          usedIn: d.data().usedIn as Record<string, string> | undefined,
          tasks: d.data().tasks as Record<string, string> | undefined,
          attachment: d.data().attachment as ChatAttachment | undefined,
        }))
        .sort((a, b) => a.createdAt - b.createdAt);
      onMessages(messages);
    },
    (e) => onError(e as Error)
  );
}

// Marks what a message became. Merged one key at a time, so a message
// gathered into a second note keeps the first.
export async function markChatMessagesUsed(
  ids: string[],
  documentId: string,
  documentTitle: string
) {
  await Promise.all(
    ids.map((id) =>
      updateDoc(doc(db, 'chat', id), { [`usedIn.${documentId}`]: documentTitle })
    )
  );
}

export async function editChatMessage(id: string, text: string) {
  await updateDoc(doc(db, 'chat', id), { text: text.trim() });
}

// The one thing here that really removes something. Nothing else in this
// screen consumes a message - harvesting leaves it where it is - so this
// is deliberately the only way a message ever leaves the chat.
export async function deleteChatMessage(id: string) {
  await deleteDoc(doc(db, 'chat', id));
}

// What a message became, when it became something to do.
export async function markChatMessageTask(id: string, taskId: string, documentId: string) {
  await updateDoc(doc(db, 'chat', id), { [`tasks.${taskId}`]: documentId });
}
