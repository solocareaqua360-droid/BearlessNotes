import { useEffect, useState } from 'react';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';

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
  coverGradient?: string;
  updatedAt?: number;
  // In the bin. Kept in the index rather than filtered out here, because
  // the two readers want opposite things: a card for a note that has been
  // binned must still say what it was, while a list of what mentions this
  // note must not offer one.
  deletedAt?: number;
  linksTo?: string[];
};

export type DocumentIndex = Map<string, IndexedDocument>;

const EMPTY: DocumentIndex = new Map();

export function useDocumentIndex(): DocumentIndex {
  const [index, setIndex] = useState<DocumentIndex>(EMPTY);

  useEffect(() => {
    return onSnapshot(
      ownedQuery('documents'),
      (snapshot) => {
        const next: DocumentIndex = new Map();
        snapshot.docs.forEach((d) => {
          const data = d.data();
          // Daily notes belong to the calendar, not to this list - the
          // same line DocumentsScreen draws.
          if (data.calendarDate) return;
          next.set(d.id, {
            id: d.id,
            title: (data.title as string) ?? '',
            coverImageUri: data.coverImageUri as string | undefined,
            coverDriveFileId: data.coverDriveFileId as string | undefined,
            coverGradient: data.coverGradient as string | undefined,
            updatedAt: data.updatedAt as number | undefined,
            deletedAt: data.deletedAt as number | undefined,
            linksTo: (data.linksTo as string[] | undefined) ?? undefined,
          });
        });
        setIndex(next);
      },
      // Never without one: a refused read throws out of a listener that
      // has no error handler and takes the screen with it.
      () => setIndex(EMPTY)
    );
  }, []);

  return index;
}
