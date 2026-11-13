import { useCallback, useMemo, useRef, useState } from 'react';
import type { LayoutChangeEvent, NativeScrollEvent, NativeSyntheticEvent, ScrollView } from 'react-native';
import { useSharedValue, type SharedValue } from 'react-native-reanimated';

// A LIST THAT MOVES WHILE SOMETHING IS CARRIED IN IT (2026-10-27, the user about «Справи»: «треба автопрокрутку та
// можливість докрутити пальцем, бо зараз справа рухається в межах видимого екрану - всі механізми в нас вже працюють
// в провіднику»). Two ways, as in the explorer:
//  - the finger near the top or bottom edge of the list scrolls it, faster the closer it is;
//  - a SECOND finger scrolls it (components/DragScrollOverlay - the explorer's own trick: a layer that exists only
//    while carrying, so that finger is a fresh touch of its own and never has to be shared with the first).
// The scroll is driven from here, not read back from the list (its onScroll comes a frame or two late), and `shift` -
// how far the list has gone since the carry began - lets the carried thing stay under the finger and the place it
// would land be worked out in the list's own coordinates.
const EDGE = 80;
const MAX_STEP = 18;

export type DragScroll = {
  begin: () => void;
  move: (absoluteY: number) => void;
  end: () => void;
  scrollBy: (dy: number) => void;
  // How far the list has scrolled since begin (px; positive = content moved up).
  shiftNow: () => number;
  shift: SharedValue<number>;
  onShift: (listener: () => void) => () => void;
  active: boolean;
};

export function useDragScroll() {
  const ref = useRef<ScrollView>(null);
  const offset = useRef(0);
  const target = useRef(0);
  const base = useRef(0);
  const viewH = useRef(0);
  const contentH = useRef(0);
  const box = useRef<{ top: number; bottom: number } | null>(null);
  const finger = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const listeners = useRef(new Set<() => void>());
  const shift = useSharedValue(0);
  const [active, setActive] = useState(false);

  const scrollTo = useCallback(
    (y: number) => {
      const max = Math.max(0, contentH.current - viewH.current);
      const next = Math.max(0, Math.min(max, y));
      if (next === target.current) return;
      target.current = next;
      ref.current?.scrollTo({ y: next, animated: false });
      shift.value = next - base.current;
      listeners.current.forEach((l) => l());
    },
    [shift]
  );

  const api = useMemo<Omit<DragScroll, 'active'>>(
    () => ({
      begin: () => {
        target.current = offset.current;
        base.current = offset.current;
        shift.value = 0;
        finger.current = null;
        box.current = null;
        (ref.current as unknown as { measureInWindow?: (cb: (x: number, y: number, w: number, h: number) => void) => void })?.measureInWindow?.(
          (_x, y, _w, h) => (box.current = { top: y, bottom: y + h })
        );
        setActive(true);
        if (timer.current) clearInterval(timer.current);
        timer.current = setInterval(() => {
          const y = finger.current;
          const b = box.current;
          if (y === null || !b) return;
          const up = b.top + EDGE - y;
          const down = y - (b.bottom - EDGE);
          if (up > 0) scrollTo(target.current - Math.ceil((Math.min(up, EDGE) / EDGE) * MAX_STEP));
          else if (down > 0) scrollTo(target.current + Math.ceil((Math.min(down, EDGE) / EDGE) * MAX_STEP));
        }, 16);
      },
      move: (y) => {
        finger.current = y;
      },
      end: () => {
        if (timer.current) clearInterval(timer.current);
        timer.current = null;
        finger.current = null;
        setActive(false);
      },
      scrollBy: (dy) => scrollTo(target.current - dy),
      shiftNow: () => target.current - base.current,
      shift,
      onShift: (l) => {
        listeners.current.add(l);
        return () => {
          listeners.current.delete(l);
        };
      },
    }),
    [scrollTo, shift]
  );

  // What the list itself needs: its ref and the three things it tells.
  const listProps = {
    ref,
    scrollEventThrottle: 16,
    onScroll: (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      offset.current = e.nativeEvent.contentOffset.y;
      if (!timer.current) target.current = offset.current;
    },
    onLayout: (e: LayoutChangeEvent) => {
      viewH.current = e.nativeEvent.layout.height;
    },
    onContentSizeChange: (_w: number, h: number) => {
      contentH.current = h;
    },
  };

  return { ...api, active, listProps } as DragScroll & { listProps: typeof listProps };
}
