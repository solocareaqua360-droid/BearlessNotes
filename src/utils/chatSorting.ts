import { useEffect, useState } from 'react';
import { doc, onSnapshot } from '../firestore';
import { db } from '../firebase';
import { setDoc } from './owned';
import { listenError } from './listenError';

// WHEN THE CHAT'S «НЕРОЗІБРАНЕ» BEGINS. Every message said before this
// moment counts as sorted - one number kept in the account's settings, the
// same for the phone and the Mac, instead of a mark written into every old
// message (isChatMessageSorted). The first device to open the chat after
// this was introduced sets it to "now", and only from the server's own
// answer: an offline first launch must not invent a date the server
// already has another value for.
const prefsDoc = doc(db, 'settings', 'chatPrefs');

// null until it is known - the count stays hidden rather than flashing
// every old message as unsorted.
export function useChatSortedBefore(): number | null {
  const [value, setValue] = useState<number | null>(null);
  useEffect(
    () =>
      onSnapshot(
        prefsDoc,
        { includeMetadataChanges: true },
        (snapshot) => {
          const stored = snapshot.data()?.sortedBefore;
          if (typeof stored === 'number') {
            setValue(stored);
            return;
          }
          if (snapshot.metadata.fromCache) return;
          const now = Date.now();
          setValue(now);
          setDoc(prefsDoc, { sortedBefore: now }, { merge: true }).catch(() => {});
        },
        listenError('chatSorting:prefs')
      ),
    []
  );
  return value;
}
