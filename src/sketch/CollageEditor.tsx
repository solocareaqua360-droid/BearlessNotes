import { useEffect, useMemo, useRef, useState } from 'react';
import { LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import Svg, { Path, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from './icons/Ionicons';
import type { SketchCollageCell, SketchCollageElement } from './format';
import { MAX_PHOTOS, layoutsFor, placement, solve } from './collage';
import SketchLayer from './SketchLayer';
import { SOFT_SEMIBOLD } from './fonts';

// The collage's own window (like Samsung's Photo Collage): the pictures sit
// in a layout; a tap picks a cell, a finger moves the picture inside it and
// two fingers enlarge it;
// below: layouts, background, frame (corners, gap, border) and proportions.
// Draws over the editor, in the same window. Nothing here touches the
// canvas until «Готово».
type Photo = { uri: string; aspect: number };
type Tab = 'layout' | 'bg' | 'frame' | 'ratio';

const PAD = 16;
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
  const [el, setEl] = useState<SketchCollageElement>(() => ({ ...initial, rot: undefined, splits: undefined }));
  const [sel, setSel] = useState<number | null>(null);
  const [tab, setTab] = useState<Tab>('layout');
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [portrait, setPortrait] = useState(initial.h >= initial.w);

  const fit = area.w > 0 ? Math.min((area.w - PAD * 2) / el.w, (area.h - PAD * 2) / el.h) : 1;
  const pw = el.w * fit;
  const ph = el.h * fit;
  const { cells } = useMemo(() => solve(el), [el]);

  const live = useRef({ el, fit, sel, cells });
  live.current = { el, fit, sel, cells };
  const drag = useRef<{ index: number; base: SketchCollageCell } | null>(null);
  const pinch = useRef<{ index: number; base: number } | null>(null);

  const cellAt = (bx: number, by: number) =>
    live.current.cells.findIndex((r) => bx >= r.x && bx <= r.x + r.w && by >= r.y && by <= r.y + r.h);

  const setCell = (index: number, patch: Partial<SketchCollageCell>) =>
    setEl((e) => ({ ...e, cells: e.cells.map((c, i) => (i === index ? { ...c, ...patch } : c)) }));

  const call = useMemo(
    () => (name: string, a = 0, b = 0) => {
      const { el: cur, fit: f, cells: rects } = live.current;
      const bx = cur.x + a / f;
      const by = cur.y + b / f;
      if (name === 'begin') {
        const c = cellAt(bx, by);
        if (c !== -1 && cur.cells[c]?.uri) {
          setSel(c);
          drag.current = { index: c, base: cur.cells[c] };
        } else drag.current = null;
      } else if (name === 'move') {
        // One finger: the picture under it moves inside its frame, and only it.
        const d = drag.current;
        if (!d) return;
        const rect = rects[d.index];
        if (!rect) return;
        const pl = placement(d.base, rect);
        const fx = clamp((d.base.fx ?? 0.5) - a / f / pl.w, rect.w / 2 / pl.w, 1 - rect.w / 2 / pl.w);
        const fy = clamp((d.base.fy ?? 0.5) - b / f / pl.h, rect.h / 2 / pl.h, 1 - rect.h / 2 / pl.h);
        setCell(d.index, { fx, fy });
      } else if (name === 'end') {
        drag.current = null;
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

  // Anything done in the panels lets go of the chosen picture: its frame
  // and buttons are for that picture only.
  const letGo = () => setSel(null);
  const showTab = (t: Tab) => {
    letGo();
    setTab(t);
  };

  const previewLeft = (area.w - pw) / 2;
  const previewTop = (area.h - ph) / 2;
  const chosen = sel !== null ? cells[sel] : undefined;
  const PILL_W = 3 * 48 + 12;
  const pill = chosen
    ? (() => {
        const below = previewTop + (chosen.y + chosen.h - el.y) * fit + 10;
        const top = below + 48 <= area.h ? below : Math.max(0, previewTop + (chosen.y - el.y) * fit - 58);
        const left = clamp(previewLeft + (chosen.x + chosen.w / 2 - el.x) * fit - PILL_W / 2, 8, area.w - PILL_W - 8);
        return { top, left };
      })()
    : null;
  const ratioLabel = currentRatio ? (portrait ? `${currentRatio[0]}:${currentRatio[1]}` : `${currentRatio[1]}:${currentRatio[0]}`) : '—';

  return (
    <View style={[styles.root, { backgroundColor: C.bg }]}>
      <View style={[styles.top, { paddingTop: insets.top + 8 }]}>
        <Pressable onPress={onCancel} hitSlop={10} style={styles.topBtn} accessibilityLabel="Закрити">
          <Ionicons name="close" size={24} color={C.text} />
        </Pressable>
        <Pressable onPress={addPhotos} hitSlop={10} style={[styles.topBtn, n >= MAX_PHOTOS && { opacity: 0.3 }]} accessibilityLabel="Додати фото">
          <Ionicons name="add" size={26} color={C.text} />
        </Pressable>
        <View style={{ flex: 1 }} />
        <Pressable onPress={() => onDone({ ...el, rot: initial.rot })} hitSlop={10} style={styles.doneBtn}>
          <Text style={[styles.done, { color: C.text }]}>Готово</Text>
        </Pressable>
      </View>

      <View style={styles.area} onLayout={(e: LayoutChangeEvent) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {/* a tap on the empty dark around the collage lets go too */}
        <Pressable style={StyleSheet.absoluteFill} onPress={letGo} />
        {area.w > 0 && (
          <GestureDetector gesture={gesture}>
            <View style={{ position: 'absolute', left: previewLeft, top: previewTop, width: pw, height: ph }}>
              <Svg width={pw} height={ph} viewBox={`${el.x} ${el.y} ${el.w} ${el.h}`}>
                <SketchLayer elements={[el]} ink={C.text} />
              </Svg>
              {chosen && (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    left: (chosen.x - el.x) * fit,
                    top: (chosen.y - el.y) * fit,
                    width: chosen.w * fit,
                    height: chosen.h * fit,
                    borderWidth: 2,
                    borderColor: C.hi,
                    borderRadius: Math.min(el.radius ?? 0, chosen.w / 2, chosen.h / 2) * fit,
                  }}
                />
              )}
            </View>
          </GestureDetector>
        )}
        {/* the chosen picture's own buttons, right under it (Samsung's way) */}
        {pill && sel !== null && (
          <View style={[styles.pill, { top: pill.top, left: pill.left, width: PILL_W, backgroundColor: C.surface2 }]}>
            <Pressable onPress={replacePhoto} hitSlop={6} style={styles.pillBtn} accessibilityLabel="Замінити фото">
              <Ionicons name="images" size={21} color={C.text} />
            </Pressable>
            <Pressable onPress={() => setCell(sel, { fx: undefined, fy: undefined, zoom: undefined })} hitSlop={6} style={styles.pillBtn} accessibilityLabel="Скинути положення">
              <Ionicons name="refresh" size={21} color={C.text} />
            </Pressable>
            <Pressable onPress={removePhoto} hitSlop={6} style={[styles.pillBtn, n <= 1 && { opacity: 0.3 }]} accessibilityLabel="Прибрати фото">
              <Ionicons name="trash" size={21} color={C.text} />
            </Pressable>
          </View>
        )}
      </View>

      <View style={styles.panel}>
        {tab === 'layout' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
            {layoutsFor(n).map((l) => {
              const thumb = solve({ kind: 'collage', x: 0, y: 0, w: 40, h: 40, layout: l.id, gap: 2.5, cells: Array.from({ length: n }, () => ({})) });
              const on = el.layout === l.id;
              return (
                <Pressable
                  key={l.id}
                  onPress={() => {
                    letGo();
                    setEl((e) => ({ ...e, layout: l.id, splits: undefined }));
                  }}
                  style={[styles.tile, { backgroundColor: C.surface, borderColor: on ? C.text : 'transparent' }]}
                >
                  <Svg width={40} height={40} viewBox="-1 -1 42 42">
                    {thumb.cells.map((r, i) => (
                      <Rect
                        key={i}
                        x={r.x}
                        y={r.y}
                        width={r.w}
                        height={r.h}
                        rx={2.5}
                        fill={on ? C.muted : 'none'}
                        stroke={on ? C.muted : C.line}
                        strokeWidth={1.5}
                      />
                    ))}
                  </Svg>
                </Pressable>
              );
            })}
          </ScrollView>
        )}
        {tab === 'bg' && (
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={[styles.strip, { justifyContent: 'center', flexGrow: 1 }]}>
            <Pressable
              onPress={() => {
                letGo();
                setEl((e) => ({ ...e, bg: undefined }));
              }}
              style={[styles.swatch, { backgroundColor: C.surface, borderColor: !el.bg ? C.text : C.surface }]}
              accessibilityLabel="Без фону"
            >
              <Svg width={20} height={20} viewBox="0 0 20 20">
                <Rect x={9} y={-2} width={2} height={24} fill={C.muted} transform="rotate(45 10 10)" />
              </Svg>
            </Pressable>
            {COLORS.map((c) => (
              <Pressable
                key={c}
                onPress={() => {
                  letGo();
                  setEl((e) => ({ ...e, bg: c }));
                }}
                style={[styles.swatch, { backgroundColor: c, borderColor: el.bg === c ? C.text : 'transparent' }]}
              >
                {el.bg === c && <Ionicons name="checkmark" size={16} color={c === '#FFFFFF' || c === '#F3E9D2' || c === '#F7C948' || c === '#7BE0C8' ? '#000000' : '#FFFFFF'} />}
              </Pressable>
            ))}
          </ScrollView>
        )}
        {tab === 'frame' && (
          <View style={styles.sliders}>
            <SliderRow icon="radius" value={(el.radius ?? 0) / (unit * 0.15)} onChange={(f) => { letGo(); setEl((e) => ({ ...e, radius: f * 0.15 * unit })); }} />
            {/* One slider for the frame: the gap between pictures and the border
                round them are the same width (the user's call). */}
            <SliderRow icon="border" value={el.gap / (unit * 0.08)} onChange={(f) => { letGo(); setEl((e) => ({ ...e, gap: f * 0.08 * unit, outer: f * 0.08 * unit })); }} />
          </View>
        )}
        {tab === 'ratio' && (
          <View style={[styles.ratioCard, { backgroundColor: C.surface }]}>
            <View style={styles.orient}>
              {[true, false].map((tall) => {
                const on = portrait === tall;
                return (
                  <Pressable
                    key={String(tall)}
                    onPress={() => {
                      letGo();
                      if (currentRatio) setRatio(currentRatio[0], currentRatio[1], tall);
                    }}
                    hitSlop={8}
                    style={[tall ? styles.orientTall : styles.orientWide, { borderColor: on ? C.text : C.muted, backgroundColor: on ? C.text : 'transparent' }]}
                  />
                );
              })}
            </View>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.ratios}>
              {RATIOS.map(([a, b]) => {
                const on = currentRatio?.[0] === a && currentRatio?.[1] === b;
                return (
                  <Pressable
                    key={`${a}:${b}`}
                    onPress={() => {
                      letGo();
                      setRatio(a, b, portrait);
                    }}
                    hitSlop={6}
                  >
                    <Text style={[styles.ratioText, { color: on ? C.text : C.muted }]}>{portrait ? `${a}:${b}` : `${b}:${a}`}</Text>
                  </Pressable>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>

      <View style={[styles.tabs, { paddingBottom: insets.bottom + 10 }]}>
        <Pressable onPress={() => showTab('layout')} hitSlop={8} style={styles.tabBtn} accessibilityLabel="Макет">
          <Ionicons name="grid" size={24} color={tab === 'layout' ? C.hi : C.text} />
        </Pressable>
        <Pressable onPress={() => showTab('bg')} hitSlop={8} style={styles.tabBtn} accessibilityLabel="Фон">
          <Ionicons name="color-palette" size={24} color={tab === 'bg' ? C.hi : C.text} />
        </Pressable>
        <Pressable onPress={() => showTab('frame')} hitSlop={8} style={styles.tabBtn} accessibilityLabel="Рамка">
          <FrameIcon kind="border" color={tab === 'frame' ? C.hi : C.text} size={24} />
        </Pressable>
        <Pressable onPress={() => showTab('ratio')} hitSlop={8} style={styles.tabBtn} accessibilityLabel="Пропорції">
          <View style={[styles.ratioBadge, { borderColor: tab === 'ratio' ? C.hi : C.text }]}>
            <Text style={[styles.ratioBadgeText, { color: tab === 'ratio' ? C.hi : C.text }]}>{ratioLabel}</Text>
          </View>
        </Pressable>
      </View>
    </View>
  );
}

// The window's own look - dark, like a photo editor, whatever the app's theme.
const C = {
  bg: '#000000',
  surface: '#1C1C1E',
  surface2: '#2C2C2E',
  text: '#FFFFFF',
  muted: '#8E8E93',
  line: '#5A5A5F',
  hi: '#F5C842',
};

// Small drawn signs for the frame sliders (no fitting icons in the set).
function FrameIcon({ kind, color, size = 22 }: { kind: 'radius' | 'gap' | 'border'; color: string; size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      {kind === 'radius' && <Path d="M5 20V13a8 8 0 0 1 8-8h6" stroke={color} strokeWidth={2} strokeLinecap="round" />}
      {kind === 'gap' && (
        <>
          <Rect x={3} y={4} width={7} height={16} rx={1.5} stroke={color} strokeWidth={2} />
          <Rect x={14} y={4} width={7} height={16} rx={1.5} stroke={color} strokeWidth={2} />
        </>
      )}
      {kind === 'border' && (
        <>
          <Rect x={3} y={3} width={18} height={18} rx={3} stroke={color} strokeWidth={2} />
          <Rect x={8} y={8} width={8} height={8} rx={1} stroke={color} strokeWidth={2} />
        </>
      )}
    </Svg>
  );
}

function SliderRow({ icon, value, onChange }: { icon: 'radius' | 'gap' | 'border'; value: number; onChange: (v: number) => void }) {
  const [w, setW] = useState(0);
  const latest = useRef(onChange);
  latest.current = onChange;
  const widthRef = useRef(0);
  widthRef.current = w;
  // The width is read HERE, on the JS side. Passed in from the gesture it was
  // the width at the moment the gesture was built - 0 - so every touch sent
  // the knob to the end (a worklet copies what it captures).
  const set = useMemo(() => (x: number) => latest.current(clamp(x / Math.max(1, widthRef.current), 0, 1)), []);
  const gesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .hitSlop({ top: 12, bottom: 12 })
        .onBegin((e) => {
          runOnJS(set)(e.x);
        })
        .onUpdate((e) => {
          runOnJS(set)(e.x);
        }),
    [set]
  );
  const v = clamp(value, 0, 1);
  return (
    <View style={styles.sliderRow}>
      <FrameIcon kind={icon} color={C.text} />
      <GestureDetector gesture={gesture}>
        <View style={styles.track} onLayout={(e) => setW(e.nativeEvent.layout.width)}>
          <View style={[styles.rail, { width: '100%', backgroundColor: C.surface2 }]} />
          <View style={[styles.rail, { width: v * w, backgroundColor: C.text }]} />
          <View style={[styles.knob, { left: v * w - 10 }]} />
        </View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 60, elevation: 60 },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingBottom: 6, gap: 4 },
  topBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  doneBtn: { height: 44, paddingHorizontal: 12, justifyContent: 'center' },
  done: { fontSize: 17, fontFamily: SOFT_SEMIBOLD },
  area: { flex: 1 },
  pill: { position: 'absolute', height: 48, borderRadius: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  pillBtn: { width: 48, height: 48, alignItems: 'center', justifyContent: 'center' },
  panel: { height: 124, paddingHorizontal: 16, justifyContent: 'center' },
  strip: { gap: 10, alignItems: 'center', paddingHorizontal: 4 },
  tile: { width: 60, height: 60, borderRadius: 12, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  swatch: { width: 36, height: 36, borderRadius: 18, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  sliders: { gap: 4, paddingHorizontal: 28 },
  sliderRow: { flexDirection: 'row', alignItems: 'center', gap: 18, height: 38 },
  track: { flex: 1, height: 38, justifyContent: 'center', marginRight: 8 },
  rail: { position: 'absolute', left: 0, height: 3, borderRadius: 1.5 },
  knob: { position: 'absolute', width: 20, height: 20, borderRadius: 10, top: 9, backgroundColor: '#FFFFFF' },
  ratioCard: { borderRadius: 18, paddingVertical: 12, marginHorizontal: 12, gap: 10 },
  orient: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 22 },
  orientTall: { width: 18, height: 26, borderRadius: 4, borderWidth: 2 },
  orientWide: { width: 30, height: 20, borderRadius: 4, borderWidth: 2 },
  ratios: { gap: 22, paddingHorizontal: 20 },
  ratioText: { fontSize: 16, fontFamily: SOFT_SEMIBOLD },
  tabs: { flexDirection: 'row', justifyContent: 'center', gap: 36, paddingTop: 10 },
  tabBtn: { width: 44, height: 40, alignItems: 'center', justifyContent: 'center' },
  ratioBadge: { minWidth: 30, height: 24, borderRadius: 6, borderWidth: 1.8, paddingHorizontal: 3, alignItems: 'center', justifyContent: 'center' },
  ratioBadgeText: { fontSize: 11, fontFamily: SOFT_SEMIBOLD },
});
