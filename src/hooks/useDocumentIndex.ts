import type { ImageFrame } from '../utils/imageFrame';
import { useEffect, useState } from 'react';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { useDeskGate } from '../navigation/deskVisibility';

// Every document, reduced to what it takes to DRAW one somewhere else:
// its name, its cover and whether it is in the bin. Not its blocks - a
// card showing another note needs the note's face, not its contents, and
// carrying the contents of every note in the account to draw a title
// would be the expensive version of this.
//
// Live, for the reason useLiveRecords gives at length: a card that
// carries a copy of the title taken at insert time shows the old name
// for ever after a rename, with nothing to say the two have diverged.
//
// Shared by the three things that need it - the card for a 'docRef'
// block, the picker that chooses which document that is, and the list of
// what mentions this one.

export type IndexedDocument = {
  id: string;
  title: string;
  coverImageUri?: string;
  coverDriveFileId?: string;
  coverFrame?: ImageFrame;
  coverGradient?: string;
  updatedAt?: number;
  // In the bin. Kept in the index rather than filtered out here, because
  // the two readers want opposite things: a card for a note that has been
  // binned must still say what it was, while a list of what mentions this
  // note must not offer one.
  deletedAt?: number;
  linksTo?: string[];
  createdAt?: number;
  // The note it is nested in (recordNotes' DocOwner kind 'note').
  parentId?: string;
};

export type DocumentIndex = Map<string, IndexedDocument>;

const EMPTY: DocumentIndex = new Map();

// EVERY NOTE AS IT CAME, kept by the listener below for the editor to open
// from (2026-10-05: the slow-opening report showed "дані (кеш) 435 мс" - the
// editor asked Firestore's local store for a note this listener had already
// handed over whole). The listener is live, so this is never older than
// what that read would have returned; the editor still hears the server
// afterwards, as it always did.
const rawDocuments = new Map<string, Record<string, unknown>>();

export function peekDocument(id: string): Record<string, unknown> | undefined {
  return rawDocuments.get(id);
}

// ONE LISTENER FOR THE WHOLE APP (2026-10-05). Each user of this hook used
// to open its own listener on every document in the account - the editor
// among them, so every note opened began by reading every note there is,
// blocks and all, while it was trying to draw. Now the first user starts
// it, everyone after gets what it already holds at once, and it stops a
// few seconds after the last one leaves (a note closed and the next one
// opened should not pay for a fresh start).
let shared: DocumentIndex = EMPTY;
const subscribers = new Set<(index: DocumentIndex) => void>();
let stopListening: (() => void) | null = null;
let stopTimer: ReturnType<typeof setTimeout> | undefined;
const LINGER_MS = 5000;

function publish(next: DocumentIndex) {
  shared = next;
  subscribers.forEach((s) => s(next));
}

function startListening() {
  stopListening = onSnapshot(
    ownedQuery('documents'),
    (snapshot) => {
      const next: DocumentIndex = new Map();
      rawDocuments.clear();
      snapshot.docs.forEach((d) => {
        const data = d.data();
        rawDocuments.set(d.id, data);
        // Daily notes belong to the calendar, not to this list - the
        // same line DocumentsScreen draws.
        if (data.calendarDate) return;
        // The chat's glue is a draft, not a note anyone links to.
        if (data.owner?.kind === 'chat') return;
        next.set(d.id, {
          id: d.id,
          title: (data.title as string) ?? '',
          coverImageUri: data.coverImageUri as string | undefined,
          coverDriveFileId: data.coverDriveFileId as string | undefined,
          coverFrame: data.coverFrame as ImageFrame | undefined,
          coverGradient: data.coverGradient as string | undefined,
          updatedAt: data.updatedAt as number | undefined,
          deletedAt: data.deletedAt as number | undefined,
          linksTo: (data.linksTo as string[] | undefined) ?? undefined,
          createdAt: data.createdAt as number | undefined,
          parentId: data.owner?.kind === 'note' ? (data.owner.id as string) : undefined,
        });
      });
      publish(next);
    },
    // Never without one: a refused read throws out of a listener that
    // has no error handler and takes the screen with it.
    () => {
      rawDocuments.clear();
      publish(EMPTY);
    }
  );
}

export function useDocumentIndex(): DocumentIndex {
  const [index, setIndex] = useState<DocumentIndex>(shared);
  // Out of sight (a frozen desk), the newest index waits - deskVisibility.
  const gated = useDeskGate();

  useEffect(() => {
    const subscriber = (next: DocumentIndex) => gated('index', () => setIndex(next));
    subscribers.add(subscriber);
    clearTimeout(stopTimer);
    if (!stopListening) startListening();
    // What arrived between the first render and now.
    else setIndex(shared);
    return () => {
      subscribers.delete(subscriber);
      if (subscribers.size > 0) return;
      stopTimer = setTimeout(() => {
        if (subscribers.size > 0 || !stopListening) return;
        stopListening();
        stopListening = null;
        // Kept only while a listener keeps it fresh.
        shared = EMPTY;
        rawDocuments.clear();
      }, LINGER_MS);
    };
  }, []);

  return index;
}
