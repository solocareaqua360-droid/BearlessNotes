import { useEffect, useMemo, useState } from 'react';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { listenError } from '../utils/listenError';
import type { DocOwner } from '../utils/recordNotes';
import type { Block } from '../types';

export type TechnicalDoc = { id: string; title: string; owner: DocOwner; main: boolean; blocks: Block[]; updatedAt: number };

// Every technical note (a document with an `owner` - see recordNotes), live.
// Filtered in the callback, not by a query on `owner`: ownerId plus another
// condition wants a composite index, and without one the listener fails and
// the screen says "empty" (see the missing-index memory).
export function useTechnicalDocs(): TechnicalDoc[] {
  const [docs, setDocs] = useState<TechnicalDoc[]>([]);
  useEffect(
    () =>
      onSnapshot(
        ownedQuery('documents'),
        (snapshot) => {
          const next: TechnicalDoc[] = [];
          snapshot.docs.forEach((d) => {
            const data = d.data();
            if (!data.owner || data.deletedAt) return;
            next.push({
              id: d.id,
              title: (data.title as string) ?? '',
              owner: data.owner as DocOwner,
              main: !!data.ownerMain,
              blocks: (data.blocks as Block[]) ?? [],
              updatedAt: (data.updatedAt as number) ?? 0,
            });
          });
          setDocs(next);
        },
        listenError('useTechnicalDocs')
      ),
    []
  );
  return docs;
}

// Just their ids: what makes a picture, a link or a file used in them
// technical rather than "used in a note".
export function useTechnicalDocIds(): Set<string> {
  const docs = useTechnicalDocs();
  return useMemo(() => new Set(docs.map((d) => d.id)), [docs]);
}
