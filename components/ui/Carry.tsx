import * as Haptics from "expo-haptics";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Image, StyleSheet, Text, View } from "react-native";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from "react-native-reanimated";

import { Ionicons } from "@/components/icons/Ionicons";
import { FONT, RADIUS, useSoft } from "@/theme/soft";

// «НЕСТИ» (the small version of mindEva's card carry): HOLD a card or a folder
// for a moment and it lifts under your finger. Let go without moving - its
// menu opens. Move - you carry it: the folder tile under the finger lights
// up, let go there and it goes in. With the OTHER finger you can scroll the
// list, tap a folder tile to walk into it, or tap «Нагору» to step out - the
// carried thing stays in the first hand the whole time. Let go over empty
// ground and it lands in whichever folder you are looking at now.
//
// Why it works (mindEva's lesson): the first finger owns ONE long-press Pan on
// the whole list, so it never argues with the ScrollView; the layer that takes
// the second finger only exists while something is carried, so the second
// finger is a fresh touch with no hand-off.
export const UP = "__up__";
const HOLD_MS = 450; // a hold this long lifts the card
const MOVE_PX = 12; // moving less than this is still «a hold»: the menu opens

export type CarryItem = {
  kind: "video" | "folder";
  id: string;
  label: string;
  thumb?: string;
  /** The folder it was lifted from (null = the root). */
  origin: string | null;
};

type Rect = { x: number; y: number; w: number; h: number };
type Node = { measureInWindow: (cb: (x: number, y: number, w: number, h: number) => void) => void } | null | undefined;

const measure = (node: Node) =>
  new Promise<Rect | null>((res) => {
    if (!node) return res(null);
    try {
      node.measureInWindow((x, y, w, h) => res(w || h ? { x, y, w, h } : null));
    } catch {
      res(null);
    }
  });

const inside = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;

export function useCarry(cfg: {
  enabled: boolean;
  /** Everything that can be lifted right now: the cards' nodes. */
  cardNodes: () => [string, Node][];
  /** Names the thing: null = this cannot be carried. */
  describe: (kind: "video" | "folder", id: string) => Omit<CarryItem, "kind" | "id"> | null;
  onDrop: (item: CarryItem, target: string | null) => void;
  onMenu: (item: CarryItem) => void;
  onEnter: (folderKey: string) => void;
  onUp: () => void;
  onScrollBy: (dy: number) => void;
  onStart: () => void;
}) {
  const C = useRef(cfg);
  C.current = cfg;

  const folderNodes = useRef(new Map<string, Node>()).current;
  const folderCbs = useRef(new Map<string, (n: Node) => void>()).current;
  const upNode = useRef<Node>(null);
  const rects = useRef(new Map<string, Rect>());
  const carry = useRef<{ item: CarryItem; sx: number; sy: number; moved: boolean } | null>(null);
  const poll = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastHover = useRef(0);

  const [ghost, setGhost] = useState<CarryItem | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const gx = useSharedValue(0);
  const gy = useSharedValue(0);
  const lastY = useSharedValue(0);

  /** The callback ref a folder tile uses (one stable function per key). */
  const registerFolder = useCallback(
    (key: string) => {
      let cb = folderCbs.get(key);
      if (!cb) {
        cb = (n: Node) => {
          if (n) folderNodes.set(key, n);
          else folderNodes.delete(key);
        };
        folderCbs.set(key, cb);
      }
      return cb;
    },
    [folderCbs, folderNodes]
  );
  const registerUp = useCallback((n: Node) => {
    upNode.current = n;
  }, []);

  const refreshRects = useCallback(async () => {
    const entries = Array.from(folderNodes.entries());
    const [list, up] = await Promise.all([Promise.all(entries.map(([, n]) => measure(n))), measure(upNode.current)]);
    const next = new Map<string, Rect>();
    entries.forEach(([k], i) => {
      const r = list[i];
      if (r) next.set(k, r);
    });
    if (up) next.set(UP, up);
    rects.current = next;
  }, [folderNodes]);

  const hit = (x: number, y: number): string | null => {
    const self = carry.current?.item;
    for (const [k, r] of rects.current) {
      if (self?.kind === "folder" && k === self.id) continue;
      if (inside(r, x, y)) return k;
    }
    return null;
  };

  const stopPoll = () => {
    if (poll.current) clearInterval(poll.current);
    poll.current = null;
  };
  useEffect(() => stopPoll, []);

  const pickUpAt = useCallback(
    async (x: number, y: number) => {
      if (!C.current.enabled) return;
      const cards = C.current.cardNodes();
      const folders = Array.from(folderNodes.entries());
      const [cr, fr] = await Promise.all([Promise.all(cards.map(([, n]) => measure(n))), Promise.all(folders.map(([, n]) => measure(n)))]);
      let found: { kind: "video" | "folder"; id: string } | null = null;
      cards.forEach(([id], i) => {
        const r = cr[i];
        if (!found && r && inside(r, x, y)) found = { kind: "video", id };
      });
      folders.forEach(([id], i) => {
        const r = fr[i];
        if (!found && r && inside(r, x, y)) found = { kind: "folder", id };
      });
      if (!found) return;
      const f: { kind: "video" | "folder"; id: string } = found;
      const info = C.current.describe(f.kind, f.id);
      if (!info) return;
      const item: CarryItem = { ...f, ...info };
      carry.current = { item, sx: x, sy: y, moved: false };
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      C.current.onStart();
      setHover(null);
      setGhost(item);
      await refreshRects();
      stopPoll();
      poll.current = setInterval(refreshRects, 250);
      // The carry may already be over by the time the measuring is done.
      if (!carry.current) stopPoll();
    },
    [folderNodes, refreshRects]
  );

  const hoverAt = useCallback((x: number, y: number) => {
    const c = carry.current;
    if (!c) return;
    if (!c.moved && Math.hypot(x - c.sx, y - c.sy) > MOVE_PX) c.moved = true;
    const now = Date.now();
    if (now - lastHover.current < 50) return;
    lastHover.current = now;
    const key = hit(x, y);
    setHover((prev) => (prev === key ? prev : key));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = useCallback(
    async (x: number, y: number, ok: boolean) => {
      const c = carry.current;
      if (!c) return;
      stopPoll();
      if (!ok) {
        carry.current = null;
        setGhost(null);
        setHover(null);
        return;
      }
      await refreshRects();
      const target = hit(x, y);
      carry.current = null;
      setGhost(null);
      setHover(null);
      if (!c.moved && !target) C.current.onMenu(c.item);
      else {
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
        C.current.onDrop(c.item, target);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [refreshRects]
  );

  // The tap of the second finger: a folder tile walks in, «Нагору» steps out.
  const tapAt = useCallback((x: number, y: number) => {
    const key = hit(x, y);
    if (!key) return;
    Haptics.selectionAsync().catch(() => {});
    if (key === UP) C.current.onUp();
    else C.current.onEnter(key);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const scrollBy = useCallback((dy: number) => C.current.onScrollBy(dy), []);

  const listGesture = useMemo(
    () =>
      Gesture.Pan()
        .activateAfterLongPress(HOLD_MS)
        .enabled(cfg.enabled)
        .onStart((e) => {
          gx.value = e.absoluteX;
          gy.value = e.absoluteY;
          runOnJS(pickUpAt)(e.absoluteX, e.absoluteY);
        })
        .onUpdate((e) => {
          gx.value = e.absoluteX;
          gy.value = e.absoluteY;
          runOnJS(hoverAt)(e.absoluteX, e.absoluteY);
        })
        .onEnd((e, ok) => {
          runOnJS(finish)(e.absoluteX, e.absoluteY, ok);
        }),
    [cfg.enabled, gx, gy, pickUpAt, hoverAt, finish]
  );

  const second = useMemo(
    () =>
      Gesture.Simultaneous(
        Gesture.Pan()
          .minPointers(1)
          .maxPointers(1)
          .onBegin(() => {
            lastY.value = 0;
          })
          .onUpdate((e) => {
            runOnJS(scrollBy)(lastY.value - e.translationY);
            lastY.value = e.translationY;
          }),
        Gesture.Tap()
          .maxDuration(400)
          .maxDistance(MOVE_PX)
          .onEnd((e, ok) => {
            if (ok) runOnJS(tapAt)(e.absoluteX, e.absoluteY);
          })
      ),
    [scrollBy, tapAt, lastY]
  );

  const folderNodeOf = useCallback((key: string) => folderNodes.get(key), [folderNodes]);
  return { listGesture, second, ghost, hover, gx, gy, registerFolder, registerUp, folderNodeOf };
}

export type Carry = ReturnType<typeof useCarry>;

/** The ghost under the finger, the «Нагору» target, and the layer that takes the second finger. Exists only while something is carried. */
export function CarryLayer({ carry, upLabel, upTop }: { carry: Carry; upLabel: string | null; upTop: number }) {
  const S = useSoft();
  const { ghost, hover, gx, gy } = carry;
  const ghostStyle = useAnimatedStyle(() => ({ transform: [{ translateX: gx.value - 100 }, { translateY: gy.value - 78 }] }));
  if (!ghost) return null;
  return (
    <View style={[StyleSheet.absoluteFill, styles.layer]} pointerEvents="box-none">
      <GestureDetector gesture={carry.second}>
        <View style={StyleSheet.absoluteFill} />
      </GestureDetector>
      {upLabel !== null && (
        <View
          ref={carry.registerUp as any}
          collapsable={false}
          pointerEvents="none"
          style={[styles.up, { top: upTop, backgroundColor: hover === UP ? S.ink : S.card, boxShadow: S.popShadow }]}
        >
          <Ionicons name="arrow-up" size={16} color={hover === UP ? S.chrome : S.ink} />
          <Text style={[styles.upText, { color: hover === UP ? S.chrome : S.ink }]} numberOfLines={1}>
            Нагору · {upLabel}
          </Text>
        </View>
      )}
      <Animated.View pointerEvents="none" style={[styles.ghost, { backgroundColor: S.card, boxShadow: S.popShadow }, ghostStyle]}>
        {ghost.thumb ? <Image source={{ uri: ghost.thumb }} style={styles.ghostThumb} /> : <Ionicons name="folder-outline" size={18} color={S.ink2} />}
        <Text style={[styles.ghostText, { color: S.ink }]} numberOfLines={2}>
          {ghost.label}
        </Text>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  layer: { zIndex: 900, elevation: 30 },
  up: {
    position: "absolute",
    alignSelf: "center",
    left: 60,
    right: 60,
    height: 44,
    borderRadius: 22,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingHorizontal: 16,
  },
  upText: { fontFamily: FONT.semibold, fontWeight: "normal", fontSize: 14, flexShrink: 1 },
  ghost: {
    position: "absolute",
    left: 0,
    top: 0,
    width: 200,
    minHeight: 48,
    borderRadius: RADIUS.row,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    padding: 6,
    paddingRight: 12,
  },
  ghostThumb: { width: 56, height: 36, borderRadius: 9, backgroundColor: "#00000012" },
  ghostText: { flex: 1, fontFamily: FONT.semibold, fontWeight: "normal", fontSize: 12.5, lineHeight: 15 },
});
