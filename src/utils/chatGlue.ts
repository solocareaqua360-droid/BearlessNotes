import { arrayUnion, doc, getDoc, onSnapshot, updateDoc } from '../firestore';
import { auth, db } from '../firebase';
import { setDoc } from './owned';
import type { Block } from '../types';
import type { ChatMessage } from './chat';
import { appendBlocksToToday, blockFromFile, blockFromLink, blockFromPhoto, clipBlocksToNote, copyObjectsToNote } from './copyToNote';
import { markChatMessagesUsed } from './chat';
import { linkDocId } from './linkId';

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

// `sources`: piece (block id) -> the chat message it came from.
export type GlueState = { blocks: Block[]; chatIds: string[]; sources: Record<string, string> };

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

// A message's pictures, files and links as the blocks a note holds them in.
// A photo or file keeps ITS OWN record's id (so it stays one record, as in
// any note); what the record knows (the Drive copy) is read from it.
async function attachmentBlocks(message: ChatMessage): Promise<Block[]> {
  const out: Block[] = [];
  for (const a of message.attachments ?? []) {
    try {
      if (a.kind === 'photo') {
        const data = ((await getDoc(doc(db, 'photos', a.id))) as { data: () => Record<string, unknown> | undefined }).data();
        out.push(
          blockFromPhoto({
            id: a.id,
            imageUri: (data?.imageUri as string | undefined) ?? a.uri,
            imageFit: data?.imageFit as 'contain' | 'cover' | undefined,
            title: data?.title as string | undefined,
            createdAt: message.createdAt,
            driveFileId: data?.driveFileId as string | undefined,
            driveBytes: data?.driveBytes as number | undefined,
          })
        );
      } else if (a.kind === 'file') {
        const data = ((await getDoc(doc(db, 'files', a.id))) as { data: () => Record<string, unknown> | undefined }).data();
        out.push(
          blockFromFile({
            id: a.id,
            fileUri: (data?.fileUri as string | undefined) ?? a.uri,
            fileName: (data?.fileName as string | undefined) ?? a.name,
            mimeType: (data?.mimeType as string | undefined) ?? a.mimeType,
            title: data?.title as string | undefined,
            createdAt: message.createdAt,
            driveFileId: data?.driveFileId as string | undefined,
            driveBytes: data?.driveBytes as number | undefined,
          })
        );
      } else {
        // The link's own record knows what the message does not: the point
        // on the map of a geo point, a better title and picture.
        const data = ((await getDoc(doc(db, 'links', linkDocId(a.url)))) as { data: () => Record<string, unknown> | undefined }).data();
        out.push({
          ...blockFromLink({
            url: a.url,
            title: (data?.title as string | undefined) ?? a.title,
            imageUrl: (data?.imageUrl as string | undefined) ?? a.imageUrl,
            siteName: (data?.siteName as string | undefined) ?? a.siteName,
            geoLat: data?.geoLat as number | undefined,
            geoLng: data?.geoLng as number | undefined,
          }),
          createdAt: message.createdAt,
        });
      }
    } catch {
      // A record that will not load is left out rather than stopping the glue.
    }
  }
  return out;
}

// Messages, oldest first, become pieces of the glue: the words first, then
// whatever was attached.
export async function addToGlue(messages: ChatMessage[]) {
  const ordered = [...messages].sort((a, b) => a.createdAt - b.createdAt);
  const blocks: Block[] = [];
  const sources: Record<string, string> = {};
  for (const m of ordered) {
    const mine: Block[] = [];
    if (m.text.trim()) mine.push({ id: newBlockId(), text: m.text, type: 'paragraph' as const, createdAt: m.createdAt });
    mine.push(...(await attachmentBlocks(m)));
    mine.forEach((b) => {
      sources[b.id] = m.id;
    });
    blocks.push(...mine);
  }
  if (blocks.length === 0) return;
  const ref = await ensureGlue();
  const mapped: Record<string, string> = {};
  Object.entries(sources).forEach(([blockId, chatId]) => {
    mapped[`sources.${blockId.replace(/\./g, '_')}`] = chatId;
  });
  await updateDoc(ref, {
    blocks: arrayUnion(...blocks),
    chatIds: arrayUnion(...ordered.map((m) => m.id)),
    ...mapped,
    updatedAt: Date.now(),
  });
}

export function watchGlue(onState: (state: GlueState) => void, onError: (error: Error) => void) {
  return onSnapshot(
    doc(db, 'documents', glueId()),
    (snapshot) => {
      const data = (snapshot as { data: () => Record<string, unknown> | undefined }).data();
      onState({
        blocks: (data?.blocks as Block[] | undefined) ?? [],
        chatIds: (data?.chatIds as string[] | undefined) ?? [],
        sources: (data?.sources as Record<string, string> | undefined) ?? {},
      });
    },
    (e) => onError(e as Error)
  );
}

export async function clearGlue() {
  await updateDoc(doc(db, 'documents', glueId()), { blocks: [], chatIds: [], sources: {}, updatedAt: Date.now() });
}

// The draft as it stands (the editor may have changed it) becomes a note, or
// goes into one; the messages that went in are marked as taken. `groupId`
// puts a NEW note in a project; `into` appends to today's note or to an
// existing one.
export async function glueToNote(
  title: string,
  options: { groupId?: string; into?: 'today' | { id: string; title: string } } = {}
): Promise<string | null> {
  const ref = doc(db, 'documents', glueId());
  const snap = await getDoc(ref);
  const data = (snap as { data: () => Record<string, unknown> | undefined }).data();
  const blocks = (data?.blocks as Block[] | undefined) ?? [];
  if (blocks.length === 0) return null;
  let documentId: string;
  let name = title.trim() || 'Без назви';
  if (options.into === 'today') {
    documentId = await appendBlocksToToday(blocks, []);
    name = `Сьогодні`;
  } else if (options.into) {
    documentId = await copyObjectsToNote(options.into.id, blocks, []);
    name = options.into.title;
  } else {
    documentId = await clipBlocksToNote(name, blocks);
    if (options.groupId) await updateDoc(doc(db, 'documents', documentId), { groupId: options.groupId });
  }
  const ids = (data?.chatIds as string[] | undefined) ?? [];
  if (ids.length) await markChatMessagesUsed(ids, documentId, name);
  await clearGlue();
  return documentId;
}
