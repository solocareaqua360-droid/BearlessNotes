import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from './icons/Ionicons';
import type { SketchCollageCell, SketchCollageElement } from './format';
import { LAYOUTS, MAX_PHOTOS, currentSplits, layoutsFor, placement, solve } from './collage';
import SketchLayer from './SketchLayer';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from './fonts';

// The collage's own window (like Samsung's Photo Collage): the pictures sit
// in a layout; a tap picks a cell, a finger moves the picture inside it and
// two fingers enlarge it; dividers are dragged (and settle onto each other);
// below: layouts, background, frame (corners, gap, border) and proportions.
// Draws over the editor, in the same window. Nothing here touches the
// canvas until «Готово».
type Photo = { uri: string; aspect: number };
type Tab = 'layout' | 'bg' | 'frame' | 'ratio';

const PAD = 16;
const GRAB = 22; // px: how near a divider's dot a finger grabs it
const SNAP = 8; // px: how near another divider's line a divider settles
const MAX_ZOOM = 6;
const RATIOS: [number, number][] = [[1, 1], [3, 4], [9, 16], [2, 3], [3, 5], [4, 5], [5, 7]];
const COLORS = ['#FFFFFF', '#F3E9D2', '#F7C948', '#7BE0C8', '#4F9BFF', '#2B44FF', '#E0524A', '#1E1E1C'];
const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export default function CollageEditor({
  initial,
  pickPhotos,
  paper,
  ink,
  accent,
  onCancel,
  onDone,
}: {
  initial: SketchCollageElement;
  pickPhotos: (limit: number) => Promise<Photo[]>;
  paper: string;
  ink: string;
  accent: string;
  onCancel: () => void;
  onDone: (el: SketchCollageElement) => void;
}) {
  const insets = useSafeAreaInsets();
  const [el, setEl] = useState<SketchCollageElement>(() => ({ ...initial, rot: undefined }));
  const [sel, setSel] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('layout');
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [guide, setGuide] = useState<{ dir: 'v' | 'h'; pos: number } | null>(null);
  const [portrait, setPortrait] = useState(initial.h >= initial.w);

  const fit = area.w > 0 ? Math.min((area.w - PAD * 2) / el.w, (area.h - PAD * 2) / el.h) : 1;
  const pw = el.w * fit;
  const ph = el.h * fit;
  const { cells, dividers } = useMemo(() => solve(el), [el]);

  const live = useRef({ el, fit, sel, cells, dividers });
  live.current = { el, fit, sel, cells, dividers };
  const drag = useRef<
    | { kind: 'divider'; index: number }
    | { kind: 'cell'; index: number; base: SketchCollageCell }
    | null
  >(null);
  const pinch = useRef<{ index: number; base: number } | null>(null);

  const cellAt = (bx: number, by: number) =>
    live.current.cells.findIndex((r) => bx >= r.x && bx <= r.x + r.w && by >= r.y && by <= r.y + r.h);

  const setCell = (index: number, patch: Partial<SketchCollageCell>) =>
    setEl((e) => ({ ...e, cells: e.cells.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));

  const call = useMemo(
    () => (name: string, a = 0, b = 0) => {
      const { el: cur, fit: f, dividers: divs, cells: rects } = live.current;
      const bx = cur.x + a / f;
      const by = cur.y + b / f;
      if (name === 'begin') {
        // A divider is taken ONLY by its dot. Anywhere else a finger moves the
        // picture under it - so moving a picture never pushes a divider.
        let best: { i: number; dist: number } | null = null;
        for (const d of divs) {
          const dist = Math.hypot(bx - (d.x1 + d.x2) / 2, by - (d.y1 + d.y2) / 2) * f;
          if (dist < GRAB && (!best || dist < best.dist)) best = { i: d.index, dist };
        }
        if (best) {
          drag.current = { kind: 'divider', index: best.i };
          return;
        }
        const c = cellAt(bx, by);
        if (c !== -1 && cur.cells[c]?.uri) {
          setSel(c);
          drag.current = { kind: 'cell', index: c, base: cur.cells[c] };
        } else drag.current = null;
      } else if (name === 'move') {
        const d = drag.current;
        if (!d) return;
        if (d.kind === 'divider') {
          const div = divs.find((x) => x.index === d.index);
          if (!div) return;
          const vertical = div.dir === 'v';
          let coord = (vertical ? div.x1 : div.y1) + (vertical ? a : b) / f;
          const r = div.rect;
          const start = vertical ? r.x : r.y;
          const size = vertical ? r.w : r.h;
          const marks = [start + size / 2, start + size / 3, start + (size * 2) / 3];
          for (const o of divs) if (o.index !== div.index && o.dir === div.dir) marks.push(vertical ? o.x1 : o.y1);
          let snapped: number | null = null;
          for (const m of marks) if (Math.abs(m - coord) < SNAP / f && (snapped === null || Math.abs(m - coord) < Math.abs(snapped - coord))) snapped = m;
          if (snapped !== null) coord = snapped;
          setGuide(snapped !== null ? { dir: div.dir, pos: snapped } : null);
          const ratio = clamp((coord - start) / size, 0.12, 0.88);
          setEl((e) => {
            const next = [...currentSplits(e)];
            next[div.index] = ratio;
            return { ...e, splits: next };
          });
        } else {
          const rect = rects[d.index];
          if (!rect) return;
          const pl = placement(d.base, rect);
          const fx = clamp((d.base.fx ?? 0.5) - a / f / pl.w, rect.w / 2 / pl.w, 1 - rect.w / 2 / pl.w);
          const fy = clamp((d.base.fy ?? 0.5) - b / f / pl.h, rect.h / 2 / pl.h, 1 - rect.h / 2 / pl.h);
          setCell(d.index, { fx, fy });
        }
      } else if (name === 'end') {
        drag.current = null;
        setGuide(null);
      } else if (name === 'tap') {
        const c = cellAt(bx, by);
        setSel(c === -1 ? null : c);
      } else if (name === 'pinchStart') {
        // Two fingers enlarge the picture they are on (else the chosen one).
        let c: number | null = cellAt(bx, by);
        if (c === -1) c = live.current.sel;
        pinch.current = c !== null && c !== -1 && cur.cells[c]?.uri ? { index: c, base: cur.cells[c].zoom ?? 1 } : null;
        if (pinch.current) setSel(pinch.current.index);
      } else if (name === 'pinch') {
        const p = pinch.current;
        if (p) setCell(p.index, { zoom: clamp(p.base * a, 1, MAX_ZOOM) });
      } else if (name === 'pinchEnd') {
        pinch.current = null;
      }
    },
    []
  );

  const gesture = useMemo(() => {
    const pan = Gesture.Pan()
      .maxPointers(1)
      .minDistance(3)
      .onBegin((e) => {
        runOnJS(call)('begin', e.x, e.y);
      })
      .onUpdate((e) => {
        runOnJS(call)('move', e.translationX, e.translationY);
      })
      .onFinalize(() => {
        runOnJS(call)('end');
      });
    const pinchG = Gesture.Pinch()
      .onStart((e) => {
        runOnJS(call)('pinchStart', e.focalX, e.focalY);
      })
      .onUpdate((e) => {
        runOnJS(call)('pinch', e.scale);
      })
      .onEnd(() => {
        runOnJS(call)('pinchEnd');
      });
    const tap = Gesture.Tap()
      .maxDuration(300)
      .onEnd((e, ok) => {
        if (ok) runOnJS(call)('tap', e.x, e.y);
      });
    return Gesture.Simultaneous(pan, pinchG, tap);
  }, [call]);

  // ---- what the panels do ------------------------------------------------------

  const n = el.cells.length;
  const relayout = (cellsNext: SketchCollageCell[], layout?: string) =>
    setEl((e) => {
      const count = cellsNext.length;
      const id = layout ?? (layoutsFor(count).some((l) => l.id === e.layout) ? e.layout : layoutsFor(count)[0]?.id ?? 'one');
      return { ...e, cells: cellsNext, layout: id, splits: undefined };
    });

  const addPhotos = async () => {
    if (n >= MAX_PHOTOS) return;
    const got = await pickPhotos(MAX_PHOTOS - n);
    if (got.length) relayout([...el.cells, ...got.map((g) => ({ uri: g.uri, aspect: g.aspect }))]);
  };
  const replacePhoto = async () => {
    if (sel === null) return;
    const got = await pickPhotos(1);
    if (got[0]) setCell(sel, { uri: got[0].uri, aspect: got[0].aspect, fx: undefined, fy: undefined, zoom: undefined });
  };
  const removePhoto = () => {
    if (sel === null || n <= 1) return;
    relayout(el.cells.filter((_, i) => i !== sel));
    setSel(null);
  };

  const unit = Math.min(el.w, el.h);
  const setRatio = (a: number, b: number, tall: boolean) => {
    setPortrait(tall);
    const aspect = tall ? a / b : b / a;
    setEl((e) => ({ ...e, h: e.w / aspect }));
  };
  const currentRatio = RATIOS.find(([a, b]) => Math.abs(el.w / el.h - (portrait ? a / b : b / a)) < 0.01);

  const dim = 'rgba(128,128,128,0.18)';
  return (
    <View style={[styles.root, { backgroundColor: paper }]}>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={onCancel} hitSlop={10} style={styles.topBtn} accessibilityLabel="Закрити">
          <Ionicons name="close" size={26} color={ink} />
        </Pressable>
        <Pressable onPress={addPhotos} hitSlop={10} style={[styles.topBtn, n >= MAX_PHOTOS && { opacity: 0.35 }]} accessibilityLabel="Додати фото">
          <Ionicons name="add" size={28} color={ink} />
        </Pressable>
        <Text style={[styles.title, { color: ink }]}>Склейка</Text>
        <Pressable onPress={() => onDone({ ...el, rot: initial.rot })} hitSlop={10}>
          <Text style={[styles.done, { color: accent }]}>Готово</Text>
        </Pressable>
      </View>

      <View style={styles.area} onLayout={(e: LayoutChangeEvent) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {area.w > 0 && (
          <GestureDetector gesture={gesture}>
            <View style={{ position: 'absolute', left: (area.w - pw) / 2, top: (area.h - ph) / 2, width: pw, height: ph }}>
              <Svg width={pw} height={ph} viewBox={`${el.x} ${el.y} ${el.w} ${el.h}`}>
                <SketchLayer elements={[el]} ink={ink} />
              </Svg>
              {sel !== null && cells[sel] && (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: (cells[sel].x - el.x) * fit,
                    top: (cells[sel].y - el.y) * fit,
                    width: cells[sel].w * fit,
                    height: cells[sel].h * fit,
                    borderWidth: 2.5,
                    borderColor: accent,
                    borderRadius: Math.min(el.radius ?? 0, cells[sel].w / 2, cells[sel].h / 2) * fit,
                  }}
                />
              )}
              {dividers.map((d) => (
                <View
                  key={d.index}
                  pointerEvents="none"
                  style={[styles.dot, { backgroundColor: accent, left: ((d.x1 + d.x2) / 2 - el.x) * fit - 9, top: ((d.y1 + d.y2) / 2 - el.y) * fit - 9 }]}
                />
              ))}
              {guide && (
                <View
                  pointerEvents="none"
                  style={
                    guide.dir === 'v'
                      ? { position: 'absolute', top: 0, bottom: 0, width: 1.5, left: (guide.pos - el.x) * fit - 0.75, backgroundColor: '#FF4FA3' }
                      : { position: 'absolute', left: 0, right: 0, height: 1.5, top: (guide.pos - el.y) * fit - 0.75, backgroundColor: '#FF4FA3' }
                  }
                />
              )}
            </View>
          </GestureDetector>
        )}
      </View>

      {/* the chosen picture: replace, take out, put back in the middle */}
      <View style={styles.cellBar}>
        {sel !== null && (
          <View style={[styles.pill, { backgroundColor: dim }]}>
            <Pressable onPress={replacePhoto} hitSlop={8} style={styles.pillBtn} accessibilityLabel="Замінити фото">
              <Ionicons name="images" size={20} color={ink} />
            </Pressable>
            <Pressable onPress={() => setCell(sel, { fx: undefined, fy: undefined, zoom: undefined })} hitSlop={8} style={styles.pillBtn} accessibilityLabel="Скинути положення">
              <Ionicons name="refresh" size={20} color={ink} />
            </Pressable>
            <Pressable onPress={removePhoto} hitSlop={8} style={[styles.pillBtn, n <= 1 && { opacity: 0.3 }]} accessibilityLabel="Прибрати фото">
              <Ionicons name="trash" size={20} color={ink} />
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.panel}>
        {tab === 'layout' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
            {layoutsFor(n).map((l) => {
              const thumb = solve({ kind: 'collage', x: 0, y: 0, w: 48, h: 48, layout: l.id, gap: 3, cells: Array.from({ length: n }, () => ({})) });
              const on = el.layout === l.id;
              return (
                <Pressable key={l.id} onPress={() => setEl((e) => ({ ...e, layout: l.id, splits: undefined }))} style={[styles.tile, { backgroundColor: dim, borderColor: on ? accent : 'transparent' }]}>
                  <Svg width={48} height={48} viewBox="0 0 48 48">
                    {thumb.cells.map((r, i) => (
                      <Rect key={i} x={r.x} y={r.y} width={r.w} height={r.h} rx={2} fill={on ? accent : ink} opacity={on ? 1 : 0.55} />
                    ))}
                  </Svg>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        {tab === 'bg' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
            <Pressable onPress={() => setEl((e) => ({ ...e, bg: undefined }))} style={[styles.swatch, { borderColor: !el.bg ? accent : dim }]}>
              <Ionicons name="close" size={18} color={ink} />
            </Pressable>
            {COLORS.map((c) => (
              <Pressable key={c} onPress={() => setEl((e) => ({ ...e, bg: c }))} style={[styles.swatch, { backgroundColor: c, borderColor: el.bg === c ? accent : dim }]} />
            ))}
          </ScrollView>
        )}
        {tab === 'frame' && (
          <View style={styles.sliders}>
            <SliderRow label="Заокруглення" value={(el.radius ?? 0) / (unit * 0.15)} onChange={(f) => setEl((e) => ({ ...e, radius: f * 0.15 * unit }))} ink={ink} accent={accent} />
            <SliderRow label="Проміжок" value={el.gap / (unit * 0.08)} onChange={(f) => setEl((e) => ({ ...e, gap: f * 0.08 * unit }))} ink={ink} accent={accent} />
            <SliderRow label="Рамка" value={(el.outer ?? 0) / (unit * 0.08)} onChange={(f) => setEl((e) => ({ ...e, outer: f * 0.08 * unit }))} ink={ink} accent={accent} />
          </View>
        )}
        {tab === 'ratio' && (
          <View style={{ gap: 12 }}>
            <View style={styles.orient}>
              <Pressable onPress={() => currentRatio && setRatio(currentRatio[0], currentRatio[1], true)} style={[styles.orientBtn, { backgroundColor: portrait ? accent : dim }]}>
                <Text style={[styles.chipText, { color: portrait ? '#FFFFFF' : ink }]}>Вертикально</Text>
              </Pressable>
              <Pressable onPress={() => currentRatio && setRatio(currentRatio[0], currentRatio[1], false)} style={[styles.orientBtn, { backgroundColor: !portrait ? accent : dim }]}>
                <Text style={[styles.chipText, { color: !portrait ? '#FFFFFF' : ink }]}>Горизонтально</Text>
              </Pressable>
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
              {RATIOS.map(([a, b]) => {
                const on = currentRatio?.[0] === a && currentRatio?.[1] === b;
                return (
                  <Pressable key={`${a}:${b}`} onPress={() => setRatio(a, b, portrait)} style={[styles.chip, { backgroundColor: on ? accent : dim }]}>
                    <Text style={[styles.chipText, { color: on ? '#FFFFFF' : ink }]}>{`${a}:${b}`}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>

      <View style={[styles.tabs, { paddingBottom: insets.bottom + 12 }]}>
        {([
          ['layout', 'grid'],
          ['bg', 'color-palette'],
          ['frame', 'square'],
          ['ratio', 'resize'],
        ] as [Tab, string][]).map(([key, icon]) => (
          <Pressable key={key} onPress={() => setTab(key)} hitSlop={8} style={styles.tabBtn}>
            <Ionicons name={icon as never} size={26} color={tab === key ? accent : ink} />
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function SliderRow({ label, value, onChange, ink, accent }: { label: string; value: number; onChange: (v: number) => void; ink: string; accent: string }) {
  const [w, setW] = useState(0);
  const latest = useRef(onChange);
  latest.current = onChange;
  const set = useMemo(() => (x: number, width: number) => latest.current(clamp(x / Math.max(1, width), 0, 1)), []);
  const widthRef = useRef(0);
  widthRef.current = w;
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .onBegin((e) => {
          runOnJS(set)(e.x, widthRef.current);
        })
        .onUpdate((e) => {
          runOnJS(set)(e.x, widthRef.current);
        }),
    [set]
  );
  const v = clamp(value, 0, 1);
  return (
    <View style={styles.sliderRow}>
      <Text style={[styles.sliderLabel, { color: ink }]}>{label}</Text>
      <GestureDetector gesture={gesture}>
        <View style={styles.track} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
          <View style={[styles.rail, { backgroundColor: 'rgba(128,128,128,0.3)' }]} />
          <View style={[styles.rail, { width: v * w, backgroundColor: accent }]} />
          <View style={[styles.knob, { left: v * w - 11, backgroundColor: '#FFFFFF' }]} />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 60, elevation: 60 },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingBottom: 8, gap: 6 },
  topBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  title: { flex: 1, textAlign: 'center', fontSize: 17, fontFamily: SOFT_SEMIBOLD },
  done: { fontSize: 17, fontFamily: SOFT_SEMIBOLD },
  area: { flex: 1 },
  dot: { position: 'absolute', width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#FFFFFF' },
  cellBar: { height: 52, alignItems: 'center', justifyContent: 'center' },
  pill: { flexDirection: 'row', borderRadius: 26, paddingHorizontal: 8, gap: 4 },
  pillBtn: { width: 48, height: 44, alignItems: 'center', justifyContent: 'center' },
  panel: { minHeight: 110, paddingHorizontal: 16, justifyContent: 'center' },
  strip: { gap: 10, alignItems: 'center', paddingRight: 8 },
  tile: { width: 62, height: 62, borderRadius: 14, borderWidth: 2.5, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 44, height: 44, borderRadius: 22, borderWidth: 3, alignItems: 'center', justifyContent: 'center' },
  chip: { height: 40, paddingHorizontal: 18, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 15, fontFamily: SOFT_MEDIUM },
  orient: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  orientBtn: { height: 38, paddingHorizontal: 16, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  sliders: { gap: 6 },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 14, height: 36 },
  sliderLabel: { width: 108, fontSize: 14, fontFamily: SOFT_MEDIUM },
  track: { flex: 1, height: 36, justifyContent: 'center' },
  rail: { position: 'absolute', left: 0, height: 4, borderRadius: 2, right: undefined, width: '100%' },
  knob: { position: 'absolute', width: 22, height: 22, borderRadius: 11, top: 7, boxShadow: '0px 1px 4px rgba(0,0,0,0.35)' },
  tabs: { flexDirection: 'row', justifyContent: 'space-around', paddingTop: 12, paddingHorizontal: 24 },
  tabBtn: { width: 48, height: 40, alignItems: 'center', justifyContent: 'center' },
});
