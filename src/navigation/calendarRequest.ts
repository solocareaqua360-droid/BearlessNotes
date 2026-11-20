// "Show me this day in the calendar" - from anywhere (the diary, a note
// shared into today). The calendar is not a desk on the phone any more
// but the layer left of the desks, so asking for a day means opening that
// layer on it. Whoever holds the layer (SideDrawersProvider) listens; a
// request made before it is listening waits for it.
type Listener = (dateKey: string) => void;

let listener: Listener | null = null;
let pending: string | null = null;

export function requestCalendarDay(dateKey: string) {
  if (listener) listener(dateKey);
  else pending = dateKey;
}

export function listenCalendarRequests(next: Listener): () => void {
  listener = next;
  if (pending) {
    const waiting = pending;
    pending = null;
    next(waiting);
  }
  return () => {
    if (listener === next) listener = null;
  };
}
