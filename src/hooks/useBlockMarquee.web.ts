import { useEffect, useRef, type RefObject } from 'react';
import type { View } from 'react-native';

// PICKING BLOCKS WITH THE MOUSE (the laptop's). Press and drag across
// blocks and they are picked, the way a file manager picks files:
//
//  - from the empty margin, or from a block that is not being written in,
//    the pick starts once the pointer has moved a few points (so a plain
//    click is still a click - it starts writing);
//  - from inside the text of the block being written in, the drag is the
//    text's own selection, until the pointer leaves that block - then it
//    is a pick of whole blocks from there on;
//  - past the top or bottom of the page, the page scrolls under the
//    pointer for as long as it is held there, and the pick follows;
//  - a plain click on the empty place (not on a block) lets the pick go.
//
// What is picked is told to `onSelect` (the whole set each time) - the
// editor's own select mode does the rest. Rows are found in the page by
// their `data-block-id` (see SortableBlockRow), never by measured numbers.

const MOVE_SLOP = 5;
const EDGE = 44;
// Points a second at the far end of the edge zone, and past it.
const SPEED = 450;
const MAX_SPEED = 1100;
// The tap the release would otherwise be taken for is ignored for this long.
const SUPPRESS_MS = 350;

let suppressUntil = 0;
export function dragSelectJustEnded(): boolean {
  return Date.now() < suppressUntil;
}

// What starts nothing: things with a click or a caret of their own.
const NOT_FROM = 'input,select,button,a,[contenteditable="true"],[role="button"],[role="checkbox"],[role="switch"],img,video,iframe,canvas,[data-no-marquee]';

function scrollerOf(node: HTMLElement): HTMLElement | null {
  let e: HTMLElement | null = node.parentElement;
  while (e) {
    const overflow = getComputedStyle(e).overflowY;
    if ((overflow === 'auto' || overflow === 'scroll') && e.scrollHeight > e.clientHeight) return e;
    e = e.parentElement;
  }
  return null;
}

export function useBlockMarquee(
  container: RefObject<View | null>,
  enabled: boolean,
  onSelect: (ids: string[]) => void,
  onClear?: () => void
) {
  const latest = useRef(onSelect);
  latest.current = onSelect;
  const clearLatest = useRef(onClear);
  clearLatest.current = onClear;

  useEffect(() => {
    if (!enabled || typeof document === 'undefined') return;

    type Row = { id: string; top: number; bottom: number };
    let down: null | {
      scroller: HTMLElement;
      startContentY: number;
      // Inside the text being written in: not a pick until the pointer leaves that block.
      textRow: string | null;
      engaged: boolean;
      // Pressed on the empty place, not on a block.
      blank: boolean;
      x: number;
      y: number;
      startX: number;
      startY: number;
    } = null;
    let raf = 0;
    let lastKey = '';

    const node = () => container.current as unknown as HTMLElement | null;

    // The rows in CONTENT coordinates - independent of how far the page is scrolled.
    function rows(scroller: HTMLElement): Row[] {
      const host = node();
      if (!host) return [];
      const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
      return Array.from(host.querySelectorAll<HTMLElement>('[data-block-id]')).map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.getAttribute('data-block-id') as string, top: r.top - base, bottom: r.bottom - base };
      });
    }

    function indexAt(list: Row[], contentY: number): number {
      if (list.length === 0) return -1;
      if (contentY <= list[0].top) return 0;
      if (contentY >= list[list.length - 1].bottom) return list.length - 1;
      let best = 0;
      let bestDistance = Infinity;
      list.forEach((row, i) => {
        const d = contentY >= row.top && contentY <= row.bottom ? 0 : Math.min(Math.abs(contentY - row.top), Math.abs(contentY - row.bottom));
        if (d < bestDistance) {
          best = i;
          bestDistance = d;
        }
      });
      return best;
    }

    function pick() {
      if (!down || !down.engaged) return;
      const list = rows(down.scroller);
      const base = down.scroller.getBoundingClientRect().top - down.scroller.scrollTop;
      const a = indexAt(list, down.startContentY);
      const b = indexAt(list, down.y - base);
      if (a < 0 || b < 0) return;
      const ids = list.slice(Math.min(a, b), Math.max(a, b) + 1).map((r) => r.id);
      const key = ids.join(',');
      if (key === lastKey) return;
      lastKey = key;
      latest.current(ids);
    }

    function engage() {
      if (!down || down.engaged) return;
      down.engaged = true;
      // Whatever text selection the press began is let go.
      window.getSelection()?.removeAllRanges();
      const active = document.activeElement as HTMLElement | null;
      if (active && /^(TEXTAREA|INPUT)$/.test(active.tagName)) active.blur();
      document.body.style.cursor = 'default';
      loop();
    }

    // The page follows a pointer held past its edge, and the pick follows the page.
    function loop() {
      cancelAnimationFrame(raf);
      let before = performance.now();
      const step = (now: number) => {
        if (!down || !down.engaged) return;
        // By the clock, not the frame: a fast screen must not scroll faster.
        const seconds = Math.min(0.05, (now - before) / 1000);
        before = now;
        const rect = down.scroller.getBoundingClientRect();
        let speed = 0;
        if (down.y < rect.top + EDGE) speed = -Math.min(MAX_SPEED, ((rect.top + EDGE - down.y) / EDGE) * SPEED);
        else if (down.y > rect.bottom - EDGE) speed = Math.min(MAX_SPEED, ((down.y - (rect.bottom - EDGE)) / EDGE) * SPEED);
        if (speed !== 0) down.scroller.scrollTop += speed * seconds;
        pick();
        raf = requestAnimationFrame(step);
      };
      raf = requestAnimationFrame(step);
    }

    function onDown(event: PointerEvent) {
      if (event.button !== 0 || event.pointerType !== 'mouse') return;
      const host = node();
      const target = event.target as HTMLElement | null;
      if (!host || !target) return;
      const scroller = scrollerOf(host);
      if (!scroller || !scroller.contains(target)) return;
      // A window over the page (a sheet, a menu) is not the page.
      if (target.closest('[role="dialog"],[aria-modal="true"]')) return;
      const textarea = target.closest('textarea');
      if (!textarea && target.closest(NOT_FROM)) return;
      const base = scroller.getBoundingClientRect().top - scroller.scrollTop;
      down = {
        scroller,
        startContentY: event.clientY - base,
        textRow: textarea ? (textarea.closest('[data-block-id]')?.getAttribute('data-block-id') ?? null) : null,
        engaged: false,
        blank: !target.closest('[data-block-id]'),
        x: event.clientX,
        y: event.clientY,
        startX: event.clientX,
        startY: event.clientY,
      };
      lastKey = '';
      // A press that began in text being written in that is not in a block
      // row at all (the title) is not ours.
      if (textarea && !down.textRow) down = null;
    }

    function onMove(event: PointerEvent) {
      if (!down || event.pointerType !== 'mouse') return;
      down.x = event.clientX;
      down.y = event.clientY;
      if (!down.engaged) {
        if (event.buttons !== 1) {
          down = null;
          return;
        }
        if (down.textRow) {
          // Its own text selection, until the pointer is off that block.
          const row = node()?.querySelector<HTMLElement>(`[data-block-id="${CSS.escape(down.textRow)}"]`);
          const r = row?.getBoundingClientRect();
          if (r && event.clientY >= r.top && event.clientY <= r.bottom) return;
        } else if (Math.hypot(event.clientX - down.startX, event.clientY - down.startY) < MOVE_SLOP) {
          return;
        }
        engage();
      }
      event.preventDefault();
      pick();
    }

    function onUp() {
      // A click that went nowhere, on the empty place: let the pick go.
      if (down && !down.engaged && down.blank) clearLatest.current?.();
      if (down?.engaged) suppressUntil = Date.now() + SUPPRESS_MS;
      cancelAnimationFrame(raf);
      if (down?.engaged) document.body.style.cursor = '';
      down = null;
    }

    const onSelectStart = (event: Event) => {
      if (down?.engaged) event.preventDefault();
    };

    document.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    document.addEventListener('selectstart', onSelectStart, true);
    return () => {
      cancelAnimationFrame(raf);
      document.body.style.cursor = '';
      document.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
      document.removeEventListener('selectstart', onSelectStart, true);
    };
  }, [container, enabled]);
}
