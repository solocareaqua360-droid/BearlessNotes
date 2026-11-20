import { createContext, MutableRefObject, ReactNode, RefObject, useContext, useMemo, useRef } from 'react';
import { Dimensions, StyleSheet, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { SharedValue, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useDensity } from '../hooks/useDensity';
import { hapticSelectMode, hapticSweepTick } from '../utils/haptics';

// SWIPE TO SELECT ON CARDS (features.swipeSelect, step 3 - the note's blocks have the same in BlockList): a swipe LEFT
// on a card picks it and turns select mode on (on a picked card, lets it go); the finger carried on picks every card it
// passes, in the list's order from the first card to the one under the finger, so going back undoes. Lifted with
// nothing picked, the mode ends. A list or a grid alike: where every card is, is measured on the screen when the swipe
// starts, and the list does not move under the finger meanwhile (the swipe holds the touch).
//
// A screen wraps its list in <SwipeSelectArea> (the order of the ids, the picked set, what to do with a new set) and
// each card in <SwipeSelectItem id>.

type Rect = { x: number; y: number; w: number; h: number };
type Area = {
  register: (id: string, view: View | null) => void;
  start: (id: string) => void;
  move: (x: number, y: number) => void;
  end: () => void;
  toggle: (id: string) => void;
};

const AreaContext = createContext<Area | null>(null);
// Whether select mode is on - the tick strip down a card's right edge is drawn only then.
const ModeContext = createContext(false);

// The list a sweep scrolls at the screen's edges: the same pair the card carry uses (useExplorerCarry).
export type SwipeScroll = {
  scrollRef: RefObject<unknown>;
  scrollYRef: MutableRefObject<SharedValue<number> | null>;
};

// The tick strip (select mode): its width, and how few points of a move up or down start a sweep there - before the
// list's own scroll can take the move.
const EDGE_W = 56;
const EDGE_START = 4;
// Autoscroll at the edges: how deep the zones are, where they start (the top bar, the dock), and the top speed.
const ZONE = 80;
const TOP_BAR = 120;
const DOCK = 110;
const FASTEST = 16;

// How far left a finger goes before the swipe picks; how far up/down or right it may go first before the move is the
// list's own (scroll, or the tap that opens the card).
const SWIPE_START = 14;
// The card's face follows the finger a little, and goes straight back (no spring - the user's, 2026-10-19).
const NUDGE_MAX = 24;

export function SwipeSelectArea({
  enabled,
  order,
  isSelectMode,
  selectedIds,
  onSelect,
  onEnd,
  onToggle,
  scroll,
  children,
}: {
  enabled: boolean;
  // The ids in the order the cards stand in - what «from here to there» means. Left out: the order they stand in on
  // the screen (top to bottom, then left to right), read from the cards measured when the swipe starts.
  order?: string[];
  isSelectMode: boolean;
  selectedIds: Set<string>;
  onSelect: (ids: Set<string>) => void;
  // The finger lifted; the set it left (empty: the screen ends the mode).
  onEnd: (ids: Set<string>) => void;
  // A tap on the tick strip.
  onToggle: (id: string) => void;
  // The list to scroll at the edges while sweeping; left out, no autoscroll.
  scroll?: SwipeScroll;
  children: ReactNode;
}) {
  const views = useRef(new Map<string, View>());
  const live = useRef({ order, isSelectMode, selectedIds, onSelect, onEnd, onToggle, scroll });
  live.current = { order, isSelectMode, selectedIds, onSelect, onEnd, onToggle, scroll };
  // The screen's own order, or the cards' order on the screen.
  const orderNow = (rects: Map<string, Rect>): string[] =>
    live.current.order ??
    [...rects.entries()]
      .sort(([, a], [, b]) => (Math.abs(a.y - b.y) > 4 ? a.y - b.y : a.x - b.x))
      .map(([key]) => key);
  const sweep = useRef<{
    anchor: string;
    picks: boolean;
    base: Set<string>;
    // Every card's place in the list as it stood when the sweep began (window coordinates at that scroll offset).
    rects: Map<string, Rect>;
    range: string;
    last: Set<string>;
    scrollAtStart: number;
    finger: { x: number; y: number } | null;
    target: number | null;
    frame: number | null;
  } | null>(null);
  const scrollNow = () => live.current.scroll?.scrollYRef.current?.value ?? 0;

  const area = useMemo<Area>(() => {
    const apply = (target: string) => {
      const s = sweep.current;
      if (!s) return;
      const list = orderNow(s.rects);
      const a = list.indexOf(s.anchor);
      const t = list.indexOf(target);
      if (a < 0 || t < 0) return;
      const from = Math.min(a, t);
      const to = Math.max(a, t);
      const range = `${from}:${to}`;
      if (range === s.range) return;
      if (s.range) hapticSweepTick();
      s.range = range;
      const next = new Set(s.base);
      for (let i = from; i <= to; i++) {
        if (s.picks) next.add(list[i]);
        else next.delete(list[i]);
      }
      s.last = next;
      live.current.onSelect(next);
    };
    return {
      register: (id, view) => {
        if (view) views.current.set(id, view);
        else views.current.delete(id);
        // A card that comes on screen while a sweep scrolls the list: measured into the sweep's own coordinates.
        const s = sweep.current;
        if (view && s && !s.rects.has(id)) {
          view.measureInWindow((x, y, w, h) => {
            const now = sweep.current;
            if (now && w > 0 && h > 0) now.rects.set(id, { x, y: y + (scrollNow() - now.scrollAtStart), w, h });
          });
        }
      },
      toggle: (id) => live.current.onToggle(id),
      start: (id) => {
        const { isSelectMode: on, selectedIds: picked } = live.current;
        sweep.current = {
          anchor: id,
          picks: !(on && picked.has(id)),
          base: new Set(on ? picked : []),
          rects: new Map(),
          range: '',
          last: new Set(picked),
          scrollAtStart: scrollNow(),
          finger: null,
          target: null,
          frame: null,
        };
        if (on) hapticSweepTick();
        else hapticSelectMode();
        // The swiped card itself, before anything is measured.
        const first = new Set(sweep.current.base);
        if (sweep.current.picks) first.add(id);
        else first.delete(id);
        sweep.current.last = first;
        live.current.onSelect(first);
        // Where every card on screen stands, for the finger to be read against.
        const started = sweep.current;
        views.current.forEach((view, key) => {
          view.measureInWindow((x, y, w, h) => {
            if (w > 0 && h > 0) started.rects.set(key, { x, y: y + (scrollNow() - started.scrollAtStart), w, h });
          });
        });
      },
      move: (x, fingerY) => {
        const s = sweep.current;
        if (!s) return;
        s.finger = { x, y: fingerY };
        edgeScroll();
        // The finger, read in the sweep's own coordinates (the list may have scrolled since it began).
        const y = fingerY + (scrollNow() - s.scrollAtStart);
        let hit: string | null = null;
        let nearest: string | null = null;
        let nearestGap = Infinity;
        s.rects.forEach((r, key) => {
          if (hit) return;
          if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h) {
            hit = key;
            return;
          }
          // Between two cards (the gap of a list or a grid): the nearest one in height, so the pick does not flicker.
          const gap = y < r.y ? r.y - y : y > r.y + r.h ? y - (r.y + r.h) : 0;
          if (gap < nearestGap && x >= r.x - 24 && x <= r.x + r.w + 24) {
            nearestGap = gap;
            nearest = key;
          }
        });
        const target = hit ?? nearest;
        if (target) apply(target);
      },
      end: () => {
        const s = sweep.current;
        sweep.current = null;
        if (s?.frame != null) cancelAnimationFrame(s.frame);
        if (s) live.current.onEnd(s.last);
      },
    };
    // THE LIST SCROLLS ALONG at its edges while a sweep goes on: the nearer the finger to the top bar or the dock, the
    // faster, frame by frame while it stays there; after each step the finger is read again, so the cards scrolling
    // under it are picked. Its own target accumulates (the list's offset comes back a frame late, as the carry found).
    function edgeScroll() {
      const s = sweep.current;
      const scroll = live.current.scroll;
      if (!s || !scroll || s.frame !== null) return;
      const step = () => {
        const now = sweep.current;
        if (!now || !now.finger) return;
        const height = Dimensions.get('window').height;
        const top = TOP_BAR + ZONE;
        const bottom = height - DOCK - ZONE;
        const f = now.finger.y;
        const speed = f < top ? -FASTEST * Math.min(1, (top - f) / ZONE) : f > bottom ? FASTEST * Math.min(1, (f - bottom) / ZONE) : 0;
        if (speed === 0) {
          now.frame = null;
          now.target = null;
          return;
        }
        const base = now.target ?? scrollNow();
        const next = Math.max(0, base + speed);
        now.target = next;
        const list = scroll.scrollRef.current as
          | { scrollToOffset?: (o: { offset: number; animated: boolean }) => void; scrollTo?: (o: { y: number; animated: boolean }) => void }
          | null;
        if (list?.scrollToOffset) list.scrollToOffset({ offset: next, animated: false });
        else list?.scrollTo?.({ y: next, animated: false });
        area.move(now.finger.x, now.finger.y);
        now.frame = requestAnimationFrame(step);
      };
      s.frame = requestAnimationFrame(step);
    }
  }, []);

  return (
    <AreaContext.Provider value={enabled ? area : null}>
      <ModeContext.Provider value={enabled && isSelectMode}>{children}</ModeContext.Provider>
    </AreaContext.Provider>
  );
}

export function SwipeSelectItem({ id, children }: { id: string; children: ReactNode }) {
  const area = useContext(AreaContext);
  const selecting = useContext(ModeContext);
  const pointer = useDensity() === 'pointer';
  const nudge = useSharedValue(0);
  const style = useAnimatedStyle(() => ({ transform: [{ translateX: nudge.value }] }));
  if (!area || pointer) return <>{children}</>;
  const gesture = Gesture.Pan()
    .activeOffsetX([-SWIPE_START, 10000])
    .failOffsetX([-10000, SWIPE_START])
    .failOffsetY([-SWIPE_START, SWIPE_START])
    .runOnJS(true)
    .onStart(() => area.start(id))
    .onUpdate((e) => {
      nudge.value = Math.max(-NUDGE_MAX, Math.min(0, e.translationX * 0.35));
      area.move(e.absoluteX, e.absoluteY);
    })
    .onFinalize(() => {
      nudge.value = withTiming(0, { duration: 120 });
      area.end();
    });
  // In select mode, the strip down the right edge where the ticks stand: a move up or down there picks card after card
  // (and the list scrolls along at the edges), a tap picks this one. The rest of the card keeps the list's scroll.
  const edge = Gesture.Exclusive(
    Gesture.Pan()
      .activeOffsetY([-EDGE_START, EDGE_START])
      .runOnJS(true)
      .onStart(() => area.start(id))
      .onUpdate((e) => area.move(e.absoluteX, e.absoluteY))
      .onFinalize(() => area.end()),
    Gesture.Tap()
      .runOnJS(true)
      .onEnd(() => area.toggle(id))
  );
  return (
    <GestureDetector gesture={gesture}>
      <Animated.View ref={(node: unknown) => area.register(id, node as View | null)} collapsable={false} style={style}>
        {children}
        {selecting && (
          <GestureDetector gesture={edge}>
            <View style={styles.edge} />
          </GestureDetector>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  edge: { position: 'absolute', top: 0, bottom: 0, right: 0, width: EDGE_W },
});
