import { arrayUnion, doc, getDoc, onSnapshot, updateDoc } from '../firestore';
import { auth, db } from '../firebase';
import { setDoc } from './owned';
import type { Block } from '../types';
import type { ChatMessage } from './chat';
import { clipBlocksToNote } from './copyToNote';
import { markChatMessagesUsed } from './chat';

// THE GLUE (2026-10-07): thoughts picked in the chat and stuck together in
// a draft, to be looked at, mended, and only then made into a note. The
// draft is an ordinary note that BELONGS to the chat (`owner: {kind:'chat'}`,
// the way a record's technical notes belong to their record): the documents
// list leaves it out, and the editor, sync, search and backup are the
// note's own - so mending a word or moving a piece is the note editor, not
// a second one. Its text is its own: the chat messages are never touched.
// `chatIds` remembers which messages went in, so that making the draft a
// note can mark them as taken (see markChatMessagesUsed).
function newBlockId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export const glueId = () => `chatglue_${auth.currentUser?.uid ?? 'local'}`;

export type GlueState = { blocks: Block[]; chatIds: string[] };

async function ensureGlue() {
  const ref = doc(db, 'documents', glueId());
  const snap = await getDoc(ref);
  if (!(snap as { exists: () => boolean }).exists()) {
    const now = Date.now();
    await setDoc(
      ref,
      { title: 'Склейка', blocks: [], chatIds: [], owner: { kind: 'chat', id: 'glue' }, createdAt: now, updatedAt: now },
      { merge: true }
    );
  }
  return ref;
}

// Messages, oldest first, become pieces of the glue.
export async function addToGlue(messages: ChatMessage[]) {
  const ordered = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  const blocks: Block[] = ordered.map((m) => ({
    id: newBlockId(),
    text: m.text || (m.attachments?.length ? '[вкладення]' : ''),
    type: 'paragraph' as const,
    createdAt: m.createdAt,
  }));
  if (blocks.length === 0) return;
  const ref = await ensureGlue();
  await updateDoc(ref, { blocks: arrayUnion(...blocks), chatIds: arrayUnion(...ordered.map((m) => m.id)), updatedAt: Date.now() });
}

export function watchGlue(onState: (state: GlueState) => void, onError: (error: Error) => void) {
  return onSnapshot(
    doc(db, 'documents', glueId()),
    (snapshot) => {
      const data = (snapshot as { data: () => Record<string, unknown> | undefined }).data();
      onState({ blocks: (data?.blocks as Block[] | undefined) ?? [], chatIds: (data?.chatIds as string[] | undefined) ?? [] });
    },
    (e) => onError(e as Error)
  );
}

export async function clearGlue() {
  await updateDoc(doc(db, 'documents', glueId()), { blocks: [], chatIds: [], updatedAt: Date.now() });
}

// The draft as it stands (the editor may have changed it) becomes a note of
// its own; the messages that went in are marked as taken into it.
export async function glueToNote(title: string): Promise<string | null> {
  const ref = doc(db, 'documents', glueId());
  const snap = await getDoc(ref);
  const data = (snap as { data: () => Record<string, unknown> | undefined }).data();
  const blocks = (data?.blocks as Block[] | undefined) ?? [];
  if (blocks.length === 0) return null;
  const name = title.trim() || 'Без назви';
  const documentId = await clipBlocksToNote(name, blocks);
  const ids = (data?.chatIds as string[] | undefined) ?? [];
  if (ids.length) await markChatMessagesUsed(ids, documentId, name);
  await clearGlue();
  return documentId;
}
