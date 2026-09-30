import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';
import type { View } from 'react-native';

// FLIP (first, last, invert, play): elements that carry data-flip-id are
// measured after every render; when `layoutKey` (the room they have, and
// how many stand in a row) has changed since the last one, each that has
// moved is put back where it was with a transform and released to slide to
// where it is now. It cannot be done with CSS transitions - a card that
// falls from the end of one row to the start of the next has no in-between
// position for a transition to pass through - so it is done by measuring.
//
// Positions are taken relative to the scrolling container's content, so a
// scroll between two renders is not mistaken for a move; and the scroll
// offset is carried over the list being rebuilt (FlatList cannot change its
// column count in place, so it is mounted anew, and would start from the
// top).
const DURATION = 280;
const EASING = 'cubic-bezier(0.22, 0.9, 0.3, 1)';

type Spot = { x: number; y: number };

function scrollerOf(scope: HTMLElement): HTMLElement | null {
  const all = scope.querySelectorAll<HTMLElement>('*');
  for (const el of Array.from(all)) {
    const overflow = getComputedStyle(el).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && el.scrollHeight > el.clientHeight + 1) return el;
  }
  return null;
}

export function useFlipLayout(scope: RefObject<View | null>, layoutKey: string): void {
  const spots = useRef(new Map<string, Spot>());
  const lastKey = useRef(layoutKey);
  const lastScroll = useRef(0);

  // The reader's place, kept as it moves - the render that rebuilds the list
  // comes after the old one is gone, too late to ask it.
  useEffect(() => {
    const root = scope.current as unknown as HTMLElement | null;
    if (!root || typeof root.addEventListener !== 'function') return;
    const onScroll = (event: Event) => {
      const target = event.target as HTMLElement;
      if (target && typeof target.scrollTop === 'number') lastScroll.current = target.scrollTop;
    };
    root.addEventListener('scroll', onScroll, true);
    return () => root.removeEventListener('scroll', onScroll, true);
  }, [scope]);

  useLayoutEffect(() => {
    const root = scope.current as unknown as HTMLElement | null;
    if (!root || typeof root.querySelectorAll !== 'function') return;
    const scroller = scrollerOf(root);
    const changed = lastKey.current !== layoutKey;
    lastKey.current = layoutKey;

    // A rebuilt list starts at the top: put the reader back where they were.
    if (changed && scroller && lastScroll.current > 0) scroller.scrollTop = lastScroll.current;
    const base = scroller ?? root;
    const baseRect = base.getBoundingClientRect();
    const scrollTop = scroller ? scroller.scrollTop : 0;

    const next = new Map<string, Spot>();
    root.querySelectorAll<HTMLElement>('[data-flip-id]').forEach((el) => {
      const id = el.getAttribute('data-flip-id');
      if (!id) return;
      // Where it stands without any slide still in flight.
      el.getAnimations().forEach((a) => a.cancel());
      const r = el.getBoundingClientRect();
      const spot = { x: r.left - baseRect.left, y: r.top - baseRect.top + scrollTop };
      next.set(id, spot);
      const from = spots.current.get(id);
      if (!changed || !from) return;
      const dx = from.x - spot.x;
      const dy = from.y - spot.y;
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return;
      el.animate(
        [{ transform: `translate(${dx}px, ${dy}px)` }, { transform: 'translate(0, 0)' }],
        { duration: DURATION, easing: EASING }
      );
    });
    spots.current = next;
  });
}
