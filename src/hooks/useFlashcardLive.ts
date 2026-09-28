import { useEffect, useState } from 'react';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { Flashcard } from '../types';
import { listenError } from '../utils/listenError';

// Every flashcard, read ONCE for however many of them a note or a board
// is showing - one listener shared by all their blocks rather than one
// each, opened by the first to ask and closed when the last one goes.
let cards = new Map<string, Flashcard>();
let unsubscribe: (() => void) | null = null;
const listeners = new Set<() => void>();

function subscribe(listener: () => void) {
  listeners.add(listener);
  if (!unsubscribe) {
    unsubscribe = onSnapshot(
      ownedQuery('flashcards'),
      (snapshot) => {
        const next = new Map<string, Flashcard>();
        snapshot.docs.forEach((d) => {
          const data = d.data() as Omit<Flashcard, 'id'>;
          next.set(d.id, {
            id: d.id,
            ...data,
            term: data.term ?? '',
            explanation: data.explanation ?? '',
            images: data.images ?? [],
            updatedAt: data.updatedAt ?? 0,
          });
        });
        cards = next;
        listeners.forEach((l) => l());
      },
      listenError('useFlashcardLive:flashcards')
    );
  }
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0 && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}

// The card as it is now - or, until it arrives (or if it was deleted),
// the snapshot the block was made with.
export function useFlashcardLive(id: string | undefined, fallback: Omit<Flashcard, 'updatedAt'>): Flashcard {
  const [, setTick] = useState(0);
  useEffect(() => subscribe(() => setTick((t) => t + 1)), []);
  const live = id ? cards.get(id) : undefined;
  return live ?? { ...fallback, updatedAt: 0 };
}
