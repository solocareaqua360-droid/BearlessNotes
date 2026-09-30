import { withTransition } from './viewTransition';

// THE CARD THAT BECOMES THE PAGE (the soft motion, stage 3): a note's card
// grows into the note's sheet when it is opened, and the sheet shrinks back
// into its card when it is left - one thing moving, not one screen swapped
// for another.
//
// Both ends carry the same key (morphKey - `note:<id>`). For the length of
// one view transition (withTransition) the end that is on screen now takes
// the name `morph`, and once the change is drawn it hands the name to the
// other end - the browser then moves the one named piece from the first
// rectangle to the second. The name is on nothing the rest of the time: two
// elements holding one name at once abort the transition outright, and a
// note has a card in more than one list.
//
// `part: 'child'` marks a scroll view whose FIRST CHILD is the end - the
// note's sheet is the scroll's content, and a scroll view is where a marker
// can be put.
export function morphKey(key: string, part?: 'child'): object {
  return { dataSet: part ? { morph: key, morphPart: part } : { morph: key } };
}

// The end on screen: of the elements with this key, one that is laid out
// (a screen the stack has put away is display:none), shown, and inside the
// window.
function find(key: string): HTMLElement | null {
  const all = document.querySelectorAll<HTMLElement>(`[data-morph="${CSS.escape(key)}"]`);
  for (const el of Array.from(all)) {
    const end = el.dataset.morphPart === 'child' ? (el.firstElementChild as HTMLElement | null) : el;
    if (!end) continue;
    // A screen standing behind the start page is visibility:hidden, and
    // still has its rectangles.
    const check = (end as HTMLElement & { checkVisibility?: (o: object) => boolean }).checkVisibility;
    if (check && !check.call(end, { visibilityProperty: true })) continue;
    const r = end.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth) return end;
  }
  return null;
}

function fill(el: HTMLElement | null): string | null {
  if (!el) return null;
  const color = getComputedStyle(el).backgroundColor;
  return color && color !== 'transparent' && color !== 'rgba(0, 0, 0, 0)' ? color : null;
}

// How long the window may stand still waiting for the other end; past it
// the card simply fades, the way everything else moves.
const WAIT_MS = 400;

export function morph(key: string, open: (morphing: boolean) => void, _opts?: { color?: string; radius?: number; into?: string }): void {
  const update = () => open(false);
  const from = find(key);
  if (!from) {
    withTransition(update);
    return;
  }
  let to: HTMLElement | null = null;
  from.style.setProperty('view-transition-name', 'morph');
  withTransition(
    update,
    async () => {
      from.style.removeProperty('view-transition-name');
      // The note draws its sheet once it has read the note (from the
      // cache - a few milliseconds): the picture waits for it, a little.
      const until = Date.now() + WAIT_MS;
      to = find(key);
      while (!to && Date.now() < until) {
        await new Promise((resolve) => setTimeout(resolve, 16));
        to = find(key);
      }
      to?.style.setProperty('view-transition-name', 'morph');
      // The colour the moving piece is while neither picture shows: the
      // page's (a note's paper can be tinted), else the card's.
      document.documentElement.style.setProperty('--morph-fill', fill(to) ?? fill(from) ?? 'transparent');
    },
    () => {
      from.style.removeProperty('view-transition-name');
      to?.style.removeProperty('view-transition-name');
    }
  );
}

export function dataSets(...parts: object[]): object {
  const dataSet = Object.assign({}, ...parts.map((p) => (p as { dataSet?: object }).dataSet ?? {}));
  return Object.keys(dataSet).length ? { dataSet } : {};
}

// The phone's half of the API (utils/morph.ts): here the move is the view
// transition above, and none of this is needed.
export type Rect = { x: number; y: number; width: number; height: number };
export function setMorphDriver(_driver: unknown): void {}
export function morphCardRef(_key: string): undefined {
  return undefined;
}
export function measureCard(_key: string): Promise<Rect | null> {
  return Promise.resolve(null);
}
export function whenLanded(_key: string, _then: () => void): void {}
export function morphLanded(_key: string): void {}
export function morphBack(_key: string, leave: () => void, _opts?: { color?: string; from?: string }): void {
  leave();
}
export function takeMorphFrom(_key: string): Rect | null {
  return null;
}
