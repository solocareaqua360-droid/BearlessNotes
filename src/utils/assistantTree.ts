import { collection, doc, getDoc, updateDoc } from '../firestore';
import { auth, db } from '../firebase';
import { setDoc } from './owned';
import { buildBlock, generateId } from './documentBlocks';
import { parseRichLines } from './richText';
import { documentLinksIn } from './documentLinks';
import { WORLD_CENTER } from './boardLayout';
import { blocksOf, groupsOf, ROOT_TOPIC, titleOf, type AssistantChat, type AssistantTopic } from './assistant';
import type { Block, BoardCard, BoardConnection } from '../types';

// THE CONVERSATION'S MEMORIES AS A TREE OF NOTES (2026-10-23, the user: «схиляюся до вкладених нотаток... і паралельно
// бачити їх деревом на дошці»). The main topic is one note (`chat.noteId`); every branch the talk grew («Детальніше» on a
// block) is a note NESTED in its parent's (owner: {kind:'note'} - hidden from the lists, binned with its root, utils/
// nestedNotes), linked from the parent by a word, as «Карта з тексту» does (utils/outlineToNotes). A board holds a card per
// note with an arrow from each parent. A press writes only what is new: notes, links and cards made once are kept, a memory
// already in its note (by its first line) is not written again, a card the user moved stays where it was put.

const CARD_H = 150;
const CARD_W = 260;

type Doc = { blocks: Block[]; deletedAt?: number };

async function readNote(id: string | undefined): Promise<Doc | null> {
  if (!id) return null;
  const snap = await getDoc(doc(db, 'documents', id));
  if (!snap.exists()) return null;
  const data = snap.data() as Doc;
  return data.deletedAt ? null : { blocks: data.blocks ?? [] };
}

// A memory's text as note blocks: lists become list blocks, the rest paragraphs.
function blocksOfMemory(text: string): Block[] {
  const out: Block[] = [];
  parseRichLines(text).forEach((line) => {
    if (line.kind === 'blank') return;
    if (line.kind === 'number') out.push(buildBlock(generateId(), 'numbered', line.text));
    else if (line.kind === 'bullet') out.push(buildBlock(generateId(), 'bulleted', line.text));
    else if (line.kind === 'heading') out.push(buildBlock(generateId(), 'paragraph', `**${line.text}**`));
    else out.push(buildBlock(generateId(), 'paragraph', line.text));
  });
  return out;
}

const firstLine = (blocks: Block[]) => (blocks[0]?.text ?? '').trim();

export type TreeResult = Pick<AssistantChat, 'noteId' | 'topicNotes' | 'boardId' | 'boardCards' | 'noted'> & { rootNoteId: string; created: number };

export async function writeMemoryTree(chat: AssistantChat): Promise<TreeResult> {
  const uid = auth.currentUser?.uid;
  const now = Date.now();
  const topics = new Map<string, AssistantTopic>((chat.topics ?? []).map((t) => [t.id, t]));
  const parentOf = (id: string) => (id === ROOT_TOPIC ? null : topics.get(id)?.parentId ?? ROOT_TOPIC);
  const titleFor = (id: string) => (id === ROOT_TOPIC ? titleOf(chat) : topics.get(id)?.title ?? 'Гілка');

  // Each memory, its text and the branch it was said in.
  const textByKey = new Map<string, string>();
  const topicOfMessage = new Map<string, string>();
  chat.messages.forEach((m) => {
    topicOfMessage.set(m.id, m.topicId ?? ROOT_TOPIC);
    if (m.role !== 'model' || m.error) return;
    blocksOf(m.text).forEach((t, i) => textByKey.set(`${m.id}:${i}`, t));
  });
  const memories = groupsOf(chat)
    .map((g) => ({
      text: g.map((k) => textByKey.get(k)).filter(Boolean).join('\n\n'),
      topic: topicOfMessage.get(g[0].split(':')[0]) ?? ROOT_TOPIC,
    }))
    .filter((m) => m.text);

  // The branches that hold a memory, with every branch above them up to the main topic - parents before children.
  const needed = new Set<string>([ROOT_TOPIC]);
  memories.forEach((m) => {
    let at: string | null = m.topic;
    while (at && !needed.has(at)) {
      needed.add(at);
      at = parentOf(at);
    }
  });
  const depthOf = (id: string) => {
    let d = 0;
    let at = parentOf(id);
    while (at && d < 20) {
      d += 1;
      at = parentOf(at);
    }
    return d;
  };
  const order = Array.from(needed).sort((a, b) => depthOf(a) - depthOf(b));

  const topicNotes: Record<string, string> = { ...(chat.topicNotes ?? {}) };
  if (chat.noteId) topicNotes[ROOT_TOPIC] = chat.noteId;
  const blocksOfNote = new Map<string, Block[]>();
  const fresh = new Set<string>();
  let created = 0;

  // The notes: an existing one is read, a missing one (never made, binned or gone) is made - nested in its parent's.
  for (const t of order) {
    const known = await readNote(topicNotes[t]).catch(() => null);
    if (known) {
      blocksOfNote.set(t, known.blocks);
      continue;
    }
    const id = doc(collection(db, 'documents')).id;
    const parent = parentOf(t);
    const owner = parent ? { kind: 'note', id: topicNotes[parent] } : undefined;
    await setDoc(doc(db, 'documents', id), {
      title: titleFor(t),
      createdAt: now,
      updatedAt: now,
      blocks: [],
      ...(owner ? { owner } : {}),
    });
    topicNotes[t] = id;
    blocksOfNote.set(t, []);
    fresh.add(t);
    created += 1;
  }

  // What each note gains: its new memories, and a word linking to each child note it does not link to yet.
  const additions = new Map<string, Block[]>();
  memories.forEach((m) => {
    const have = new Set((blocksOfNote.get(m.topic) ?? []).map((b) => (b.text ?? '').trim()));
    const pending = additions.get(m.topic) ?? [];
    const blocks = blocksOfMemory(m.text);
    if (blocks.length && !have.has(firstLine(blocks)) && !pending.some((b) => b.text.trim() === firstLine(blocks))) additions.set(m.topic, [...pending, ...blocks]);
  });
  order.forEach((t) => {
    const parent = parentOf(t);
    if (!parent) return;
    const childId = topicNotes[t];
    const parentBlocks = [...(blocksOfNote.get(parent) ?? []), ...(additions.get(parent) ?? [])];
    if (parentBlocks.some((b) => (b.text ?? '').includes(`{n:${childId}}`))) return;
    additions.set(parent, [...(additions.get(parent) ?? []), buildBlock(generateId(), 'bulleted', `{n:${childId}}${titleFor(t)}{/n}`)]);
  });

  // The board: made once; a card per note, an arrow from each parent's card; new ones placed under their parent.
  let boardId = chat.boardId;
  const boardCards: Record<string, string> = { ...(chat.boardCards ?? {}) };
  let boardExists = false;
  if (boardId) {
    const snap = await getDoc(doc(db, 'boards', boardId)).catch(() => null);
    const data = snap && snap.exists() ? (snap.data() as { deletedAt?: number; cards?: Record<string, BoardCard> }) : null;
    boardExists = !!data && !data.deletedAt;
    if (boardExists) {
      // A card the user deleted from the board is made again only for a note that is new.
      Object.keys(boardCards).forEach((t) => {
        if (!data!.cards?.[boardCards[t]]) delete boardCards[t];
      });
    }
  }
  if (!boardExists) {
    boardId = doc(collection(db, 'boards')).id;
    Object.keys(boardCards).forEach((t) => delete boardCards[t]);
  }
  const placed = new Map<string, { x: number; y: number }>();
  const siblingsPlaced = new Map<string, number>();
  const newCards: BoardCard[] = [];
  const newLines: BoardConnection[] = [];
  order.forEach((t) => {
    if (boardCards[t]) return;
    const parent = parentOf(t);
    const p = parent ? placed.get(parent) : null;
    const n = parent ? siblingsPlaced.get(parent) ?? 0 : 0;
    if (parent) siblingsPlaced.set(parent, n + 1);
    const at = p ? { x: p.x + (n - 0.5) * (CARD_W + 60), y: p.y + CARD_H + 140 } : { x: WORLD_CENTER, y: WORLD_CENTER };
    placed.set(t, at);
    const cardId = generateId();
    boardCards[t] = cardId;
    newCards.push({
      id: cardId,
      text: '',
      type: 'document',
      createdAt: now,
      documentId: topicNotes[t],
      documentTitle: titleFor(t),
      docHeight: CARD_H,
      x: at.x,
      y: at.y,
      width: CARD_W,
    } as BoardCard);
    if (parent && boardCards[parent]) newLines.push({ id: generateId(), fromCardId: boardCards[parent], toCardId: cardId, kind: 'arrow' } as BoardConnection);
  });

  if (!boardExists) {
    await setDoc(doc(db, 'boards', boardId!), {
      title: `Дерево: ${titleOf(chat)}`,
      cards: Object.fromEntries(newCards.map((c) => [c.id, c])),
      shapes: {},
      connections: Object.fromEntries(newLines.map((c) => [c.id, c])),
      createdAt: now,
      updatedAt: now,
      ...(uid ? { ownerId: uid } : {}),
    });
  } else if (newCards.length || newLines.length) {
    const patch: Record<string, unknown> = { updatedAt: now };
    newCards.forEach((c) => (patch[`cards.${c.id}`] = c));
    newLines.forEach((c) => (patch[`connections.${c.id}`] = c));
    await updateDoc(doc(db, 'boards', boardId!), patch);
  }

  // The notes' new blocks, and the board each note shows («Показати дошку» in its menu).
  for (const t of order) {
    const add = additions.get(t) ?? [];
    if (add.length === 0 && !fresh.has(t)) continue;
    const blocks = [...(blocksOfNote.get(t) ?? []), ...add];
    await updateDoc(doc(db, 'documents', topicNotes[t]), { blocks, linksTo: documentLinksIn(blocks), boardId, updatedAt: now });
  }

  return {
    rootNoteId: topicNotes[ROOT_TOPIC],
    noteId: topicNotes[ROOT_TOPIC],
    topicNotes,
    boardId,
    boardCards,
    noted: memories.map((m) => m.text),
    created,
  };
}
