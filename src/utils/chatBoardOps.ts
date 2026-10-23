import { collection, deleteField, doc, getDoc, writeBatch } from '../firestore';
import { auth, db } from '../firebase';
import { setDoc } from './owned';
import { askCosted } from './assistant';
import { bodyBlocks } from './chatObjects';
import { chatOwner } from './chatOwned';
import { readBoardPart } from './boardStorage';
import { blocksToMarkdown } from './blocksText';
import { documentLinksIn } from './documentLinks';
import { boardToStructure, structureToOutline, type StructNode } from './structureTree';
import { generateId } from './documentBlocks';
import type { Block, BoardCard, BoardConnection } from '../types';

// WHAT THE AI DOES TO A CARD OF THE CHAT'S BOARD (2026-10-24, the sketches chatj/chatk): «Поглибити» writes more into the
// card's own note; «Розгалузити» adds new cards under it, each a note of the chat, with an arrow from the card. Both are
// PROPOSALS: the result carries `undo`, which puts everything back (the window shows it as «Скасувати»). Nothing is ever
// deleted that the AI did not itself add in the same step.

export type ChatOpResult = { summary: string; costUsd: number; undo: () => Promise<void> };

const CARD_W = 230;
const CARD_H = 150;
const GAP_X = 90;
const GAP_Y = 22;

async function loadBoard(boardId: string) {
  const snap = await getDoc(doc(db, 'boards', boardId));
  if (!snap.exists()) throw new Error('Дошку не знайдено');
  const data = snap.data() as Record<string, unknown>;
  return {
    title: (data.title as string) || 'Дошка',
    cards: readBoardPart<BoardCard>(data.cards),
    connections: readBoardPart<BoardConnection>(data.connections),
  };
}

const titleOf = (c: BoardCard) => (c.type === 'document' ? c.documentTitle : c.text.split('\n')[0]) || 'Без назви';

// The titles from the root down to the card, by the arrows (a card has one parent, a loop is not followed twice).
function pathTo(cards: BoardCard[], connections: BoardConnection[], cardId: string): string[] {
  const byId = new Map(cards.map((c) => [c.id, c]));
  const parentOf = new Map<string, string>();
  connections.forEach((k) => {
    if (k.kind === 'arrow' && !parentOf.has(k.toCardId)) parentOf.set(k.toCardId, k.fromCardId);
  });
  const out: string[] = [];
  const seen = new Set<string>();
  let at: string | undefined = cardId;
  while (at && !seen.has(at) && byId.has(at)) {
    seen.add(at);
    out.unshift(titleOf(byId.get(at)!));
    at = parentOf.get(at);
  }
  return out;
}

// «Поглибити»: the card's note gets a fuller text - its own content kept, with the detail, the reasons and an example.
export async function deepenCard(boardId: string, cardId: string): Promise<ChatOpResult> {
  const { cards, connections } = await loadBoard(boardId);
  const card = cards.find((c) => c.id === cardId);
  if (!card || card.type !== 'document' || !card.documentId) throw new Error('Це не картка-нотатка');
  const noteRef = doc(db, 'documents', card.documentId);
  const noteSnap = await getDoc(noteRef);
  if (!noteSnap.exists()) throw new Error('Нотатку картки не знайдено');
  const old = ((noteSnap.data() as { blocks?: Block[] }).blocks ?? []) as Block[];
  const oldText = blocksToMarkdown(old).trim();
  const path = pathTo(cards, connections, cardId);
  const prompt = `Ти допомагаєш поглибити картку теми в схемі людини. Пиши українською.
Шлях картки в схемі: ${path.join(' › ')}.
Картка «${titleOf(card)}» зараз містить:
${oldText || '(поки порожньо)'}

Напиши ПОГЛИБЛЕНИЙ текст цієї картки: збережи зміст наявного, додай конкретику, причини й один приклад. 2-4 короткі абзаци або короткий список через «- ». Без заголовків і без вступу. Не вигадуй фактів, яких не знаєш: так і скажи. Відповідай лише текстом картки.`;
  const { text, costUsd } = await askCosted(prompt);
  const blocks = bodyBlocks(text.split('\n'));
  if (blocks.length === 0) throw new Error('ШІ не дав тексту');
  const preview = text.slice(0, 280);
  const now = Date.now();
  await setDoc(noteRef, { blocks, linksTo: documentLinksIn(blocks), updatedAt: now }, { merge: true });
  await setDoc(doc(db, 'boards', boardId), { cards: { [cardId]: { documentPreviewText: preview } }, updatedAt: now }, { merge: true });
  return {
    summary: `Поглибив «${titleOf(card)}».`,
    costUsd,
    undo: async () => {
      await setDoc(noteRef, { blocks: old, linksTo: documentLinksIn(old), updatedAt: Date.now() }, { merge: true });
      await setDoc(
        doc(db, 'boards', boardId),
        { cards: { [cardId]: { documentPreviewText: card.documentPreviewText ?? deleteField() } }, updatedAt: Date.now() },
        { merge: true }
      );
    },
  };
}

type Rect = { x: number; y: number; w: number; h: number };

// WHAT A STEP OF CHANGE KNOWS WHILE IT IS BEING PLANNED: the board as it will be, the writes so far (so several new groups in one
// step see each other), and the way back.
type Plan = {
  boardId: string;
  chatId: string;
  cards: BoardCard[];
  connections: BoardConnection[];
  patchCards: Record<string, BoardCard | { y: number }>;
  patchLinks: Record<string, BoardConnection>;
  noteIds: string[];
  movedFrom: Map<string, number>;
  batch: ReturnType<typeof writeBatch>;
  now: number;
  uid?: string;
};
const rectOf = (c: BoardCard): Rect => ({ x: c.x, y: c.y, w: c.width || CARD_W, h: c.docHeight || CARD_H });

// New cards under a card, a note of the chat each, an arrow from the card to each. They stand in the column to the right of the
// card, under the children it already has; whatever stood from that line down in this column and to the right of it slides down
// to make room, so nothing is covered and the rest keeps its arrangement. Returns the new cards' ids.
function placeChildren(plan: Plan, parent: BoardCard, items: { title: string; text: string }[]): string[] {
  const kids = plan.connections
    .filter((k) => k.kind === 'arrow' && k.fromCardId === parent.id)
    .map((k) => plan.cards.find((c) => c.id === k.toCardId))
    .filter((c): c is BoardCard => !!c);
  const x = parent.x + (parent.width || CARD_W) + GAP_X;
  const y0 = kids.length ? Math.max(...kids.map((c) => c.y + rectOf(c).h)) + GAP_Y : parent.y;
  const room = items.length * (CARD_H + GAP_Y);
  plan.cards
    .filter((c) => c.id !== parent.id && c.x >= x - 5 && c.y >= y0 - 1)
    .forEach((c) => {
      if (!plan.movedFrom.has(c.id) && !(c.id in plan.patchCards)) plan.movedFrom.set(c.id, c.y);
      c.y += room;
      const prior = plan.patchCards[c.id];
      plan.patchCards[c.id] = prior && 'x' in prior ? { ...prior, y: c.y } : { y: c.y };
    });
  const made: string[] = [];
  items.forEach((item, i) => {
    const noteRef = doc(collection(db, 'documents'));
    const blocks = bodyBlocks(item.text ? item.text.split('\n') : []);
    plan.batch.set(noteRef, {
      title: item.title,
      blocks,
      linksTo: documentLinksIn(blocks),
      owner: chatOwner(plan.chatId),
      boardId: plan.boardId,
      createdAt: plan.now,
      updatedAt: plan.now,
      ...(plan.uid ? { ownerId: plan.uid } : {}),
    });
    plan.noteIds.push(noteRef.id);
    const id = generateId();
    const card: BoardCard = {
      id,
      text: '',
      type: 'document',
      createdAt: plan.now,
      documentId: noteRef.id,
      documentTitle: item.title,
      docHeight: CARD_H,
      ...(item.text ? { documentPreviewText: item.text.slice(0, 280) } : {}),
      x,
      y: y0 + i * (CARD_H + GAP_Y),
      width: CARD_W,
    };
    const linkId = generateId();
    const link: BoardConnection = { id: linkId, fromCardId: parent.id, toCardId: id, kind: 'arrow' };
    plan.cards.push(card);
    plan.connections.push(link);
    plan.patchCards[id] = card;
    plan.patchLinks[linkId] = link;
    made.push(id);
  });
  return made;
}

async function startPlan(chatId: string, boardId: string): Promise<Plan> {
  const { cards, connections } = await loadBoard(boardId);
  return {
    boardId,
    chatId,
    cards: cards.map((c) => ({ ...c })),
    connections: [...connections],
    patchCards: {},
    patchLinks: {},
    noteIds: [],
    movedFrom: new Map(),
    batch: writeBatch(db),
    now: Date.now(),
    uid: auth.currentUser?.uid,
  };
}

async function commitPlan(plan: Plan): Promise<() => Promise<void>> {
  const boardRef = doc(db, 'boards', plan.boardId);
  plan.batch.set(boardRef, { cards: plan.patchCards, connections: plan.patchLinks, updatedAt: plan.now }, { merge: true });
  await plan.batch.commit();
  return async () => {
    const undo = writeBatch(db);
    plan.noteIds.forEach((nid) => undo.delete(doc(db, 'documents', nid)));
    const patch: Record<string, unknown> = { updatedAt: Date.now() };
    Object.keys(plan.patchCards).forEach((id) => {
      const was = plan.movedFrom.get(id);
      if (was !== undefined) patch[`cards.${id}.y`] = was;
      else patch[`cards.${id}`] = deleteField();
    });
    Object.keys(plan.patchLinks).forEach((id) => (patch[`connections.${id}`] = deleteField()));
    undo.update(boardRef, patch);
    await undo.commit();
  };
}

const plural = (n: number) => `${n} ${n === 1 ? 'картку' : n < 5 ? 'картки' : 'карток'}`;

// «Розгалузити»: two to four new cards under the card.
export async function branchCard(chatId: string, boardId: string, cardId: string): Promise<ChatOpResult> {
  const { cards, connections } = await loadBoard(boardId);
  const card = cards.find((c) => c.id === cardId);
  if (!card) throw new Error('Картку не знайдено');
  const outline = structureToOutline(boardToStructure(cards, connections), { seeAlso: false });
  const path = pathTo(cards, connections, cardId);
  const prompt = `Ти допомагаєш розгалузити тему в схемі людини. Пиши українською.
Уся схема зараз:
${outline}

Вибрана картка: «${titleOf(card)}» (шлях ${path.join(' › ')}).
Запропонуй від 2 до 4 НОВИХ підтем для цієї картки, яких у схемі ще немає. Відповідай лише JSON-масивом об'єктів: [{"title": "назва до 6 слів", "text": "1-3 речення"}].`;
  const { text, costUsd } = await askCosted(prompt, { json: true });
  let items: { title: string; text: string }[] = [];
  try {
    const parsed = JSON.parse(text);
    if (Array.isArray(parsed)) items = parsed.filter((x) => x && typeof x.title === 'string' && x.title.trim()).map((x) => ({ title: String(x.title).trim(), text: String(x.text ?? '').trim() }));
  } catch {
    throw new Error('ШІ відповів не так, як треба. Спробуй ще раз');
  }
  const have = new Set(cards.map((c) => titleOf(c).toLowerCase()));
  items = items.filter((x) => !have.has(x.title.toLowerCase())).slice(0, 4);
  if (items.length === 0) throw new Error('ШІ не знайшов нових підтем');
  const plan = await startPlan(chatId, boardId);
  const parent = plan.cards.find((c) => c.id === cardId)!;
  placeChildren(plan, parent, items);
  const undo = await commitPlan(plan);
  return { summary: `Додав ${plural(items.length)} до «${titleOf(card)}»: ${items.map((i) => `«${i.title}»`).join(', ')}.`, costUsd, undo };
}

const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ').trim();

// THE AI'S UPDATED SCHEME MERGED INTO THE BOARD (2026-10-24): the answer carries the WHOLE scheme (what is there + what is new).
// A node whose title is already a card is that card - its text, place and everything the user did to it stay. A new node becomes a
// new card under the card of its parent. Nothing is ever deleted or rewritten. Returns what was added (undoable).
export async function mergeStructure(chatId: string, boardId: string, nodes: StructNode[]): Promise<ChatOpResult & { added: number }> {
  const plan = await startPlan(chatId, boardId);
  const byTitle = new Map(plan.cards.map((c) => [norm(titleOf(c)), c.id]));
  const cardOf = new Map<string, string>();
  const fresh = new Map<string, { title: string; text: string }[]>();
  const order: string[] = [];
  let added = 0;
  nodes.forEach((n) => {
    const hit = byTitle.get(norm(n.title));
    if (hit) {
      cardOf.set(n.id, hit);
      return;
    }
    const parentCard = n.parent ? cardOf.get(n.parent) : undefined;
    if (!parentCard) return;
    const list = fresh.get(parentCard) ?? [];
    list.push({ title: n.title, text: n.body.join('\n') });
    fresh.set(parentCard, list);
    if (!order.includes(parentCard)) order.push(parentCard);
    added += 1;
    byTitle.set(norm(n.title), `pending-${n.id}`);
    cardOf.set(n.id, `pending-${n.id}`);
  });
  if (added === 0) throw new Error('У схемі немає нових карток');
  // New cards that hang from a card that is itself new are placed after it exists: go in rounds.
  let rounds = 0;
  const placed = new Map<string, string>();
  const pendingNodes = nodes.filter((n) => cardOf.get(n.id)?.startsWith('pending-'));
  const resolve = (id: string) => (id.startsWith('pending-') ? placed.get(id) : id);
  while (pendingNodes.some((n) => !placed.has(`pending-${n.id}`)) && rounds < 8) {
    rounds += 1;
    const groups = new Map<string, { n: StructNode; item: { title: string; text: string } }[]>();
    pendingNodes
      .filter((n) => !placed.has(`pending-${n.id}`))
      .forEach((n) => {
        const parentRef = n.parent ? cardOf.get(n.parent) : undefined;
        const parentId = parentRef ? resolve(parentRef) : undefined;
        if (!parentId) return;
        groups.set(parentId, [...(groups.get(parentId) ?? []), { n, item: { title: n.title, text: n.body.join('\n') } }]);
      });
    if (groups.size === 0) break;
    groups.forEach((entries, parentId) => {
      const parent = plan.cards.find((c) => c.id === parentId);
      if (!parent) return;
      const ids = placeChildren(plan, parent, entries.map((e) => e.item));
      entries.forEach((e, i) => placed.set(`pending-${e.n.id}`, ids[i]));
    });
  }
  const done = placed.size;
  if (done === 0) throw new Error('Не вдалося розмістити нові картки');
  const undo = await commitPlan(plan);
  const titles = pendingNodes.filter((n) => placed.has(`pending-${n.id}`)).map((n) => `«${n.title}»`);
  return { added: done, summary: `Додав ${plural(done)}: ${titles.join(', ')}.`, costUsd: 0, undo };
}

// The board as the outline the AI reads (titles and the first lines of each card), for a conversation that already has one.
export async function currentOutline(boardId: string): Promise<string> {
  const { cards, connections } = await loadBoard(boardId);
  return structureToOutline(boardToStructure(cards, connections), { seeAlso: false });
}
