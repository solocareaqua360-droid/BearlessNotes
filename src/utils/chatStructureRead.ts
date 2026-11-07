import { useEffect, useState } from 'react';
import { doc, getDoc, onSnapshot } from '../firestore';
import { db } from '../firebase';
import { readBoardPart } from './boardStorage';
import { blocksToMarkdown } from './blocksText';
import { boardToStructure, type StructNode } from './structureTree';
import { listenError } from './listenError';
import type { Block, BoardCard, BoardConnection } from '../types';

// THE CHAT'S STRUCTURE, READ (2026-10-24). The draft board of a conversation read as the tree the AI sees (utils/structureTree),
// with each card's FULL note text (a card on the board keeps only a 280-letter preview of it) - for the «Нотатка» view of the
// structure and for the cards' count.

export type BoardStructure = { title: string; nodes: StructNode[]; cardCount: number };

export async function readBoardStructure(boardId: string): Promise<BoardStructure> {
  const snap = await getDoc(doc(db, 'boards', boardId));
  if (!snap.exists()) throw new Error('Дошку не знайдено');
  const data = snap.data() as Record<string, unknown>;
  const cards = readBoardPart<BoardCard>(data.cards);
  const connections = readBoardPart<BoardConnection>(data.connections);
  // The notes the document cards show, read together.
  const texts = new Map<string, { title?: string; text: string }>();
  await Promise.all(
    cards
      .filter((c) => c.type === 'document' && c.documentId)
      .map(async (c) => {
        try {
          const note = await getDoc(doc(db, 'documents', c.documentId as string));
          if (!note.exists()) return;
          const d = note.data() as { title?: string; blocks?: Block[] };
          texts.set(c.id, { title: d.title, text: blocksToMarkdown(d.blocks ?? []).trim() });
        } catch {
          // A note that cannot be read keeps the card's own preview.
        }
      })
  );
  const full = cards.map((c) => {
    const t = texts.get(c.id);
    return t ? { ...c, documentTitle: t.title || c.documentTitle, documentPreviewText: t.text } : c;
  });
  return { title: (data.title as string) || 'Дошка', nodes: boardToStructure(full, connections), cardCount: cards.length };
}

// How many cards the board has now, kept up to date (null until the first read). A refused read leaves it as it was.
export function useBoardCardCount(boardId: string | undefined): number | null {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    setCount(null);
    if (!boardId) return;
    const stop = onSnapshot(
      doc(db, 'boards', boardId),
      (snap: { exists: () => boolean; data: () => Record<string, unknown> | undefined }) => {
        if (snap.exists()) setCount(readBoardPart<BoardCard>(snap.data()?.cards).length);
      },
      listenError('chat board card count')
    );
    return () => stop();
  }, [boardId]);
  return count;
}
