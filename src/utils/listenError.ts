import { notify } from '../components/surfaces/Ask';

// What a Firestore listener does when its read is refused.
//
// `onSnapshot` takes an error callback and almost nowhere passed one.
// That is not a missing nicety, it is two different silent failures:
// an unhandled error thrown out of a listener takes the screen down
// with it, and where it does not, the screen simply stays as it was -
// so a refused read looks exactly like an empty collection, and «Ще
// немає записів» is shown about data that is right there.
//
// Both were met for real. The owner-only rules refuse a query that does
// not carry the ownerId condition (they are not a filter - see
// utils/owned), and signing in as the wrong Google account refuses
// every read there is.
//
// One message, not sixty. Sixty listeners fail together, because what
// refuses one refuses all of them, and sixty windows in a row is worse
// than the silence it replaces. So the first one speaks and the rest
// are counted into the log.
const QUIET_MS = 15000;
let lastShown = 0;

export function listenError(where: string): (error: Error) => void {
  return (error: Error) => {
    // eslint-disable-next-line no-console
    console.warn('[listener]', where, error?.message ?? error);
    const now = Date.now();
    if (now - lastShown < QUIET_MS) return;
    lastShown = now;
    const refused = /permission|insufficient/i.test(error?.message ?? '');
    notify(
      refused ? 'Немає доступу до даних' : 'Не вдалося прочитати дані',
      refused
        ? 'Схоже, увійдено не тим акаунтом Google, або правила доступу відхилили запит. Перевір акаунт угорі.'
        : (error?.message ?? 'Невідома помилка')
    );
  };
}
