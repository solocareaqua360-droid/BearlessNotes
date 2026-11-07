import { collection, doc, writeBatch } from '../firestore';
import { auth, db } from '../firebase';
import { buildBlock } from './documentBlocks';
import { generateId } from './documentBlocks';
import { keyedAll } from './boardStorage';
import { WORLD_CENTER } from './boardLayout';
import { layoutOutline, type OutlineNode } from './outlineToBoard';
import { parseRichLines } from './richText';
import { documentLinksIn } from './documentLinks';
import type { Block, BoardCard, BoardConnection } from '../types';

// «КАРТА З ТЕКСТУ» AS NOTES (2026-10-11, the user's variant А): the root heading is a note, every other
// heading a note NESTED in its parent (owner: {kind:'note'} - hidden from the explorer's lists, and the
// whole tree goes to the bin with its root, see utils/nestedNotes), and a NEW BOARD holds a card for each
// of them with a line from every parent to its children. Returns the board, to be put on the board the
// text was pasted on as one card. Everything is written in one batch: all of it or none.

// A note's card on a board: paper of its own height, the text peeking.
const CARD_H = 150;

function blocksOf(body: string): Block[] {
  const blocks: Block[] = [];
  parseRichLines(body).forEach((line) => {
    if (line.kind === 'blank') return;
    if (line.kind === 'heading') blocks.push({ ...buildBlock(generateId(), 'heading', line.text), headingLevel: Math.min(3, line.level + 1) });
    else if (line.kind === 'number') blocks.push(buildBlock(generateId(), 'numbered', line.text));
    else if (line.kind === 'bullet') blocks.push(buildBlock(generateId(), 'bulleted', line.text));
    else blocks.push(buildBlock(generateId(), 'paragraph', line.text));
  });
  return blocks;
}

export async function createOutlineNotes(nodes: OutlineNode[]): Promise<{ boardId: string; boardTitle: string; count: number }> {
  const uid = auth.currentUser?.uid;
  const batch = writeBatch(db);
  const now = Date.now();
  const docIds = nodes.map(() => doc(collection(db, 'documents')).id);
  const rootIndex = nodes.findIndex((n) => n.parent === null);
  // THE NOTES LINK TO THEIR BRANCHES IN THE TEXT (the user, 2026-10-11: «як сайт»): after its own text each
  // note carries a short list of words linking to the notes nested in it, so the page is not empty and is
  // read - and extended - like a site. A link is only a pointer (nesting is the `owner` field), so there is
  // no loop to worry about; every note also remembers the board (`boardId` - «Показати дошку» in its menu).
  const boardId = doc(collection(db, 'boards')).id;
  const blocks = nodes.map((n, i) => {
    const own = blocksOf(n.body);
    const kids = nodes.map((k, j) => ({ k, j })).filter(({ k }) => k.parent === i);
    if (kids.length === 0) return own;
    const list = kids.map(({ k, j }) => ({ ...buildBlock(generateId(), 'bulleted', `{n:${docIds[j]}}${k.title}{/n}`) }));
    return [...own, ...list];
  });
  nodes.forEach((n, i) => {
    const owner = n.parent === null ? undefined : { kind: 'note', id: docIds[n.parent] };
    batch.set(doc(db, 'documents', docIds[i]), {
      title: n.title,
      createdAt: now,
      updatedAt: now,
      blocks: blocks[i],
      linksTo: documentLinksIn(blocks[i]),
      boardId,
      ...(owner ? { owner } : {}),
      ...(uid ? { ownerId: uid } : {}),
    });
  });
  const places = layoutOutline(nodes, { x: WORLD_CENTER, y: WORLD_CENTER }, CARD_H);
  const cardIds = nodes.map(() => generateId());
  const cards: BoardCard[] = nodes.map((n, i) => ({
    id: cardIds[i],
    text: '',
    type: 'document',
    createdAt: now,
    documentId: docIds[i],
    documentTitle: n.title,
    docHeight: CARD_H,
    ...(n.body ? { documentPreviewText: n.body.slice(0, 280) } : {}),
    ...places[i],
  }));
  const connections: BoardConnection[] = [];
  nodes.forEach((n, i) => {
    if (n.parent !== null) connections.push({ id: generateId(), fromCardId: cardIds[n.parent], toCardId: cardIds[i], kind: 'arrow' });
  });
  const boardTitle = nodes[rootIndex >= 0 ? rootIndex : 0].title;
  batch.set(doc(db, 'boards', boardId), {
    title: boardTitle,
    cards: keyedAll(cards),
    shapes: {},
    connections: keyedAll(connections),
    createdAt: now,
    updatedAt: now,
    ...(uid ? { ownerId: uid } : {}),
  });
  await batch.commit();
  return { boardId, boardTitle, count: nodes.length };
}
