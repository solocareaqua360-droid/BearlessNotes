import { collection, deleteField, doc, getDocs, onSnapshot, writeBatch, where, type Unsubscribe } from '../firestore';
import { auth, db } from '../firebase';
import { ownedQuery } from './owned';
import { buildBlock, generateId } from './documentBlocks';
import { parseRichLines } from './richText';
import { documentLinksIn } from './documentLinks';
import { keyedAll } from './boardStorage';
import { WORLD_CENTER } from './boardLayout';
import { layoutOutline, outlineToBoard } from './outlineToBoard';
import { chatOwner, isChatOwned, toOutlineNodes } from './chatOwned';
import type { StructNode } from './structureTree';
import type { Block, BoardCard, BoardConnection } from '../types';

// OBJECTS THAT LIVE IN A CONVERSATION (2026-10-24; design in the project memory «project_ai_tree_notes»). What the AI makes
// in a chat - a note, a board of cards - belongs to the chat (`owner: {kind:'chat', id: chatId}`), so it is not in the
// explorer, the lists or the search (utils/chatOwned.isChatOwned is what every list asks) and the conversation can open it in
// a window, list it («Матеріали розмови»), change it, and delete it with the chat. When the user keeps it, it is PROMOTED:
// the owner goes and it is an ordinary note or board, in a folder if one is chosen. No screen uses this yet.
//
// A board's cards are, by default, NOTES owned by the chat (each card a document, so the AI writes into it the way the user
// does); promoting the board hands those notes to the board (owner {kind:'board'}) so they stay hidden and go with it,
// and promoting one card alone makes that one an ordinary note.

const CARD_H = 150;
const BATCH = 400;

// A tree as note blocks: every node a heading (its depth, three levels at most), its text under it. A tree with ONE root
// gives that root to the note's title: its text opens the note and the rest move one level up.
export function blocksFromStructure(nodes: StructNode[]): { title: string | null; blocks: Block[] } {
  const roots = nodes.filter((n) => n.parent === null);
  const single = roots.length === 1 && !roots[0].synthetic ? roots[0] : null;
  const blocks: Block[] = [];
  for (const n of nodes) {
    if (n === single) {
      blocks.push(...bodyBlocks(n.body));
      continue;
    }
    if (!n.synthetic) {
      const level = Math.min(3, Math.max(1, n.depth - (single ? 1 : 0)));
      blocks.push({ ...buildBlock(generateId(), 'heading', n.title), headingLevel: level });
    }
    blocks.push(...bodyBlocks(n.body));
  }
  return { title: single ? single.title : null, blocks };
}

// Lines of text as blocks: lists become list blocks, a `#` line a heading, the rest paragraphs.
export function bodyBlocks(lines: string[]): Block[] {
  const out: Block[] = [];
  parseRichLines(lines.join('\n')).forEach((line) => {
    if (line.kind === 'blank') return;
    if (line.kind === 'heading') out.push({ ...buildBlock(generateId(), 'heading', line.text), headingLevel: Math.min(3, line.level + 1) });
    else if (line.kind === 'number') out.push(buildBlock(generateId(), 'numbered', line.text));
    else if (line.kind === 'bullet') out.push(buildBlock(generateId(), 'bulleted', line.text));
    else out.push(buildBlock(generateId(), 'paragraph', line.text));
  });
  return out;
}

// A note that belongs to the conversation. Either a tree (`nodes`) or ready blocks. Returns its id.
export async function createChatNote(
  chatId: string,
  content: { title?: string; nodes: StructNode[] } | { title: string; blocks: Block[] }
): Promise<string> {
  const now = Date.now();
  let title: string;
  let blocks: Block[];
  if ('nodes' in content) {
    const made = blocksFromStructure(content.nodes);
    title = content.title ?? made.title ?? 'Нотатка розмови';
    blocks = made.blocks;
  } else {
    title = content.title;
    blocks = content.blocks;
  }
  const ref = doc(collection(db, 'documents'));
  const uid = auth.currentUser?.uid;
  await writeBatch(db)
    .set(ref, { title, blocks, linksTo: documentLinksIn(blocks), owner: chatOwner(chatId), createdAt: now, updatedAt: now, ...(uid ? { ownerId: uid } : {}) })
    .commit();
  return ref.id;
}

// A draft board that belongs to the conversation, with the tree laid out as cards and an arrow from each parent to its
// children. `cards: 'notes'` (default) makes each card a chat-owned note; 'text' makes plain sticky cards (outlineToBoard),
// nothing else is written. All of it in one batch, or none. Returns the board and the notes it made.
export async function createChatBoard(
  chatId: string,
  nodes: StructNode[],
  options: { title?: string; cards?: 'notes' | 'text' } = {}
): Promise<{ boardId: string; noteIds: string[]; title: string }> {
  const outline = toOutlineNodes(nodes);
  if (outline.length === 0) throw new Error('chatObjects: an empty tree makes no board');
  const uid = auth.currentUser?.uid;
  const now = Date.now();
  const batch = writeBatch(db);
  const boardRef = doc(collection(db, 'boards'));
  const title = options.title ?? (outline.find((n) => n.parent === null)?.title || 'Дошка розмови');
  const at = { x: WORLD_CENTER, y: WORLD_CENTER };
  let cards: BoardCard[];
  let connections: BoardConnection[];
  const noteIds: string[] = [];
  if ((options.cards ?? 'notes') === 'text') {
    ({ cards, connections } = outlineToBoard(outline, at));
  } else {
    const refs = outline.map(() => doc(collection(db, 'documents')));
    const places = layoutOutline(outline, at, CARD_H);
    const cardIds = outline.map(() => generateId());
    outline.forEach((n, i) => {
      const blocks = bodyBlocks(nodes[i].body);
      noteIds.push(refs[i].id);
      batch.set(refs[i], {
        title: n.title,
        blocks,
        linksTo: documentLinksIn(blocks),
        owner: chatOwner(chatId),
        boardId: boardRef.id,
        createdAt: now,
        updatedAt: now,
        ...(uid ? { ownerId: uid } : {}),
      });
    });
    cards = outline.map((n, i) => ({
      id: cardIds[i],
      text: '',
      type: 'document',
      createdAt: now,
      documentId: refs[i].id,
      documentTitle: n.title,
      docHeight: CARD_H,
      ...(n.body ? { documentPreviewText: n.body.slice(0, 280) } : {}),
      ...places[i],
    }));
    connections = [];
    outline.forEach((n, i) => {
      if (n.parent !== null) connections.push({ id: generateId(), fromCardId: cardIds[n.parent], toCardId: cardIds[i], kind: 'arrow' });
    });
  }
  batch.set(boardRef, {
    title,
    cards: keyedAll(cards),
    shapes: {},
    connections: keyedAll(connections),
    owner: chatOwner(chatId),
    createdAt: now,
    updatedAt: now,
    ...(uid ? { ownerId: uid } : {}),
  });
  await batch.commit();
  return { boardId: boardRef.id, noteIds, title };
}

export type ChatObject = {
  id: string;
  kind: 'note' | 'board';
  title: string;
  createdAt: number;
  updatedAt: number;
  // A note that is a card of one of the chat's boards: the window lists the board, not each of its cards.
  partOfBoard: boolean;
};

const chatQuery = (name: 'documents' | 'boards', chatId: string) => ownedQuery(name, where('owner.id', '==', chatId));

type Snap = { id: string; data: () => Record<string, unknown> };
function objectOf(kind: 'note' | 'board', d: Snap, chatId: string): ChatObject | null {
  const data = d.data();
  if (!isChatOwned(data, chatId) || data.deletedAt || data.trashed === true) return null;
  return {
    id: d.id,
    kind,
    title: (data.title as string) || (kind === 'board' ? 'Дошка' : 'Без назви'),
    createdAt: (data.createdAt as number) ?? 0,
    updatedAt: (data.updatedAt as number) ?? 0,
    partOfBoard: kind === 'note' && typeof data.boardId === 'string',
  };
}

// The conversation's objects, newest first, kept up to date. `onError` is called when a read is refused (never silent:
// a listener without it takes the app down). Returns the function that stops listening.
export function listChatObjects(chatId: string, onChange: (objects: ChatObject[]) => void, onError: (error: unknown) => void): Unsubscribe {
  let notes: ChatObject[] = [];
  let boards: ChatObject[] = [];
  const push = () => onChange([...notes, ...boards].sort((a, b) => b.updatedAt - a.updatedAt));
  const stopNotes = onSnapshot(
    chatQuery('documents', chatId),
    (snap: { docs: Snap[] }) => {
      notes = snap.docs.map((d) => objectOf('note', d, chatId)).filter((o): o is ChatObject => !!o);
      push();
    },
    onError
  );
  const stopBoards = onSnapshot(
    chatQuery('boards', chatId),
    (snap: { docs: Snap[] }) => {
      boards = snap.docs.map((d) => objectOf('board', d, chatId)).filter((o): o is ChatObject => !!o);
      push();
    },
    onError
  );
  return () => {
    stopNotes();
    stopBoards();
  };
}

// Everything the conversation owns goes with it - for good, nothing of it was ever anywhere else. Returns how many.
// TODO(chat deletion): there is no «delete conversation» yet (utils/assistant only ever keeps them); call this from it,
// BEFORE the conversation's own document is deleted, so a failure leaves the chat to try again.
export async function deleteChatObjects(chatId: string): Promise<number> {
  const [notes, boards] = await Promise.all([getDocs(chatQuery('documents', chatId)), getDocs(chatQuery('boards', chatId))]);
  const refs = [...notes.docs, ...boards.docs].filter((d) => isChatOwned(d.data(), chatId)).map((d) => d.ref);
  for (let i = 0; i < refs.length; i += BATCH) {
    const batch = writeBatch(db);
    refs.slice(i, i + BATCH).forEach((r) => batch.delete(r));
    await batch.commit();
  }
  return refs.length;
}

// «Зберегти»: the object stops belonging to the conversation. A note becomes an ordinary note; a board becomes an ordinary
// board and the notes that are its cards go to the board (owner {kind:'board'}: hidden, binned with it). `attachTo` puts it
// in a folder (pass the explorer's tag attach, utils never touches tags itself).
export async function promoteChatObject(
  kind: 'note' | 'board',
  id: string,
  options: { attachTo?: (docId: string, collection: 'documents' | 'boards') => Promise<void> } = {}
): Promise<void> {
  const batch = writeBatch(db);
  if (kind === 'note') {
    batch.update(doc(db, 'documents', id), { owner: deleteField(), ownerMain: deleteField() });
  } else {
    const cards = await getDocs(ownedQuery('documents', where('boardId', '==', id)));
    cards.docs
      .filter((d) => isChatOwned(d.data()))
      .forEach((d) => batch.update(d.ref, { owner: { kind: 'board', id } }));
    batch.update(doc(db, 'boards', id), { owner: deleteField() });
  }
  await batch.commit();
  await options.attachTo?.(id, kind === 'note' ? 'documents' : 'boards');
}
