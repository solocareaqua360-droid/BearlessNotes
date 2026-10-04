import { useEffect, useRef, useState } from 'react';
import { Image, LayoutChangeEvent, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { runOnJS } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { SketchCrop } from './format';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from './fonts';

// Cropping a picture: the whole picture shown, a frame on it to pull by its
// corners and sides (or move), the rest dimmed. Draws over the editor (in
// the same window - no Modal of its own). Gives back the frame as
// fractions of the whole picture and the picture's own aspect; the editor
// turns that into the new box. Always starts from what the picture shows
// now, so a picture cropped before can be given back its edges.
type Box = { l: number; t: number; r: number; b: number };
type Mode = 'move' | 'l' | 'r' | 't' | 'b' | 'tl' | 'tr' | 'bl' | 'br';

const MIN = 48;
const TOUCH = 34;
const PAD = 16;
const RATIOS: { label: string; value: number }[] = [
  { label: '1:1', value: 1 },
  { label: '4:3', value: 4 / 3 },
  { label: '3:4', value: 3 / 4 },
  { label: '16:9', value: 16 / 9 },
  { label: '9:16', value: 9 / 16 },
];

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

export default function CropOverlay({
  uri,
  boxAspect,
  crop,
  paper,
  ink,
  accent,
  onCancel,
  onDone,
}: {
  uri: string;
  boxAspect: number; // the box's width / height now, for a picture with no crop yet
  crop: SketchCrop | undefined;
  paper: string;
  ink: string;
  accent: string;
  onCancel: () => void;
  onDone: (crop: SketchCrop, srcAspect: number) => void;
}) {
  const insets = useSafeAreaInsets();
  const [src, setSrc] = useState<number | null>(null); // the picture's own width / height
  const [area, setArea] = useState({ w: 0, h: 0 });
  const [rect, setRect] = useState<Box | null>(null);
  const [lock, setLock] = useState<number | null>(null);

  useEffect(() => {
    Image.getSize(
      uri,
      (w, h) => setSrc(w > 0 && h > 0 ? w / h : 4 / 3),
      () => setSrc(4 / 3)
    );
  }, [uri]);

  // Where the whole picture sits in the area.
  const frame = (() => {
    if (!src || area.w === 0) return null;
    const maxW = area.w - PAD * 2;
    const maxH = area.h - PAD * 2;
    const iw = maxW / maxH > src ? maxH * src : maxW;
    const ih = iw / src;
    return { l: (area.w - iw) / 2, t: (area.h - ih) / 2, w: iw, h: ih };
  })();

  // The starting frame: what the picture shows now.
  useEffect(() => {
    if (!frame || !src || rect) return;
    let c = crop;
    if (!c) {
      if (boxAspect > src) {
        const h = src / boxAspect;
        c = { x: 0, y: (1 - h) / 2, w: 1, h };
      } else {
        const w = boxAspect / src;
        c = { x: (1 - w) / 2, y: 0, w, h: 1 };
      }
    }
    setRect({ l: frame.l + c.x * frame.w, t: frame.t + c.y * frame.h, r: frame.l + (c.x + c.w) * frame.w, b: frame.t + (c.y + c.h) * frame.h });
  }, [frame, src, rect, crop, boxAspect]);

  const drag = useRef<{ mode: Mode; start: Box } | null>(null);
  const live = useRef({ rect, frame, lock });
  live.current = { rect, frame, lock };

  const begin = (x: number, y: number) => {
    const { rect: r, frame: f } = live.current;
    if (!r || !f) return;
    const T = Math.min(TOUCH, (r.r - r.l) / 3, (r.b - r.t) / 3);
    const inside = x > r.l - T && x < r.r + T && y > r.t - T && y < r.b + T;
    if (!inside) {
      drag.current = null;
      return;
    }
    const hx = Math.abs(x - r.l) < T && Math.abs(x - r.l) <= Math.abs(x - r.r) ? 'l' : Math.abs(x - r.r) < T ? 'r' : '';
    const hy = Math.abs(y - r.t) < T && Math.abs(y - r.t) <= Math.abs(y - r.b) ? 't' : Math.abs(y - r.b) < T ? 'b' : '';
    const mode = (hy + hx || 'move') as Mode;
    drag.current = { mode, start: r };
  };

  const update = (dx: number, dy: number) => {
    const d = drag.current;
    const { frame: f, lock: R } = live.current;
    if (!d || !f) return;
    const box = { l: f.l, t: f.t, r: f.l + f.w, b: f.t + f.h };
    const s = d.start;
    if (d.mode === 'move') {
      const w = s.r - s.l;
      const h = s.b - s.t;
      const l = clamp(s.l + dx, box.l, box.r - w);
      const t = clamp(s.t + dy, box.t, box.b - h);
      setRect({ l, t, r: l + w, b: t + h });
      return;
    }
    const hasL = d.mode.includes('l');
    const hasR = d.mode.includes('r');
    const hasT = d.mode.includes('t');
    const hasB = d.mode.includes('b');
    if (!R) {
      setRect({
        l: hasL ? clamp(s.l + dx, box.l, s.r - MIN) : s.l,
        r: hasR ? clamp(s.r + dx, s.l + MIN, box.r) : s.r,
        t: hasT ? clamp(s.t + dy, box.t, s.b - MIN) : s.t,
        b: hasB ? clamp(s.b + dy, s.t + MIN, box.b) : s.b,
      });
      return;
    }
    // A locked shape: the frame keeps its proportions while it is pulled.
    if ((hasL || hasR) && (hasT || hasB)) {
      const ax = hasL ? s.r : s.l;
      const ay = hasT ? s.b : s.t;
      const px = (hasL ? s.l : s.r) + dx;
      const py = (hasT ? s.t : s.b) + dy;
      const sx = hasL ? -1 : 1;
      const sy = hasT ? -1 : 1;
      let w = Math.max((px - ax) * sx, ((py - ay) * sy) * R, MIN);
      const availW = sx > 0 ? box.r - ax : ax - box.l;
      const availH = sy > 0 ? box.b - ay : ay - box.t;
      w = Math.max(Math.min(w, availW, availH * R), Math.min(MIN, availW));
      const h = w / R;
      setRect({ l: sx > 0 ? ax : ax - w, r: sx > 0 ? ax + w : ax, t: sy > 0 ? ay : ay - h, b: sy > 0 ? ay + h : ay });
      return;
    }
    if (hasL || hasR) {
      const nx = (hasL ? s.l : s.r) + dx;
      const avail = hasR ? box.r - s.l : s.r - box.l;
      let w = hasR ? nx - s.l : s.r - nx;
      w = clamp(w, MIN, Math.min(avail, (box.b - box.t) * R));
      const h = w / R;
      const t = clamp((s.t + s.b) / 2 - h / 2, box.t, box.b - h);
      setRect({ l: hasR ? s.l : s.r - w, r: hasR ? s.l + w : s.r, t, b: t + h });
      return;
    }
    const ny = (hasT ? s.t : s.b) + dy;
    const avail = hasB ? box.b - s.t : s.b - box.t;
    let h = hasB ? ny - s.t : s.b - ny;
    h = clamp(h, MIN, Math.min(avail, (box.r - box.l) / R));
    const w = h * R;
    const l = clamp((s.l + s.r) / 2 - w / 2, box.l, box.r - w);
    setRect({ l, r: l + w, t: hasB ? s.t : s.b - h, b: hasB ? s.t + h : s.b });
  };

  const end = () => {
    drag.current = null;
  };

  const gesture = Gesture.Pan()
    .minDistance(0)
    .onBegin((e) => {
      runOnJS(begin)(e.x, e.y);
    })
    .onUpdate((e) => {
      runOnJS(update)(e.translationX, e.translationY);
    })
    .onFinalize(() => {
      runOnJS(end)();
    });

  // A ratio: the frame keeps about its area, takes the shape, stays inside.
  const applyRatio = (R: number | null) => {
    setLock(R);
    if (!R || !rect || !frame) return;
    const area0 = (rect.r - rect.l) * (rect.b - rect.t);
    let w = Math.sqrt(area0 * R);
    let h = w / R;
    if (w > frame.w) {
      w = frame.w;
      h = w / R;
    }
    if (h > frame.h) {
      h = frame.h;
      w = h * R;
    }
    const l = clamp((rect.l + rect.r) / 2 - w / 2, frame.l, frame.l + frame.w - w);
    const t = clamp((rect.t + rect.b) / 2 - h / 2, frame.t, frame.t + frame.h - h);
    setRect({ l, t, r: l + w, b: t + h });
  };
  const whole = () => {
    if (!frame || !src) return;
    setLock(src);
    setRect({ l: frame.l, t: frame.t, r: frame.l + frame.w, b: frame.t + frame.h });
  };

  const done = () => {
    if (!rect || !frame || !src) return;
    onDone(
      {
        x: clamp((rect.l - frame.l) / frame.w, 0, 1),
        y: clamp((rect.t - frame.t) / frame.h, 0, 1),
        w: clamp((rect.r - rect.l) / frame.w, 0.01, 1),
        h: clamp((rect.b - rect.t) / frame.h, 0.01, 1),
      },
      src
    );
  };

  const dim = 'rgba(0,0,0,0.62)';
  return (
    <View style={[styles.root, { backgroundColor: paper }]}>
      <Text style={[styles.title, { color: ink, paddingTop: insets.top + 14 }]}>Кадрування</Text>

      <GestureDetector gesture={gesture}>
        <View style={styles.area} onLayout={(e: LayoutChangeEvent) => setArea({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
          {frame && (
            <Image source={{ uri }} resizeMode="stretch" style={{ position: 'absolute', left: frame.l, top: frame.t, width: frame.w, height: frame.h }} />
          )}
          {frame && rect && (
            <>
              <View pointerEvents="none" style={[styles.dim, { left: frame.l, top: frame.t, width: frame.w, height: rect.t - frame.t, backgroundColor: dim }]} />
              <View pointerEvents="none" style={[styles.dim, { left: frame.l, top: rect.b, width: frame.w, height: frame.t + frame.h - rect.b, backgroundColor: dim }]} />
              <View pointerEvents="none" style={[styles.dim, { left: frame.l, top: rect.t, width: rect.l - frame.l, height: rect.b - rect.t, backgroundColor: dim }]} />
              <View pointerEvents="none" style={[styles.dim, { left: rect.r, top: rect.t, width: frame.l + frame.w - rect.r, height: rect.b - rect.t, backgroundColor: dim }]} />
              <View pointerEvents="none" style={[styles.crop, { left: rect.l, top: rect.t, width: rect.r - rect.l, height: rect.b - rect.t }]}>
                <View style={[styles.gridV, { left: '33.33%' }]} />
                <View style={[styles.gridV, { left: '66.66%' }]} />
                <View style={[styles.gridH, { top: '33.33%' }]} />
                <View style={[styles.gridH, { top: '66.66%' }]} />
                <View style={[styles.corner, { left: -2, top: -2, borderLeftWidth: 4, borderTopWidth: 4 }]} />
                <View style={[styles.corner, { right: -2, top: -2, borderRightWidth: 4, borderTopWidth: 4 }]} />
                <View style={[styles.corner, { left: -2, bottom: -2, borderLeftWidth: 4, borderBottomWidth: 4 }]} />
                <View style={[styles.corner, { right: -2, bottom: -2, borderRightWidth: 4, borderBottomWidth: 4 }]} />
              </View>
            </>
          )}
        </View>
      </GestureDetector>

      <View style={[styles.bar, { paddingBottom: insets.bottom + 14 }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
          <Chip label="Вільно" on={lock === null} onPress={() => applyRatio(null)} ink={ink} accent={accent} />
          <Chip label="Оригінал" on={false} onPress={whole} ink={ink} accent={accent} />
          {RATIOS.map((r) => (
            <Chip key={r.label} label={r.label} on={lock !== null && Math.abs(lock - r.value) < 0.001} onPress={() => applyRatio(r.value)} ink={ink} accent={accent} />
          ))}
        </ScrollView>
        <View style={styles.buttons}>
          <Pressable onPress={onCancel} style={[styles.btn, { backgroundColor: 'rgba(128,128,128,0.18)' }]}>
            <Text style={[styles.btnText, { color: ink }]}>Скасувати</Text>
          </Pressable>
          <Pressable onPress={done} style={[styles.btn, { backgroundColor: ink }]}>
            <Text style={[styles.btnText, { color: paper }]}>Готово</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

function Chip({ label, on, onPress, ink, accent }: { label: string; on: boolean; onPress: () => void; ink: string; accent: string }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, { backgroundColor: on ? accent : 'rgba(128,128,128,0.18)' }]}>
      <Text style={[styles.chipText, { color: on ? '#FFFFFF' : ink }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 50, elevation: 50 },
  title: { fontSize: 18, fontFamily: SOFT_SEMIBOLD, textAlign: 'center' },
  area: { flex: 1 },
  dim: { position: 'absolute' },
  crop: { position: 'absolute', borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.9)' },
  gridV: { position: 'absolute', top: 0, bottom: 0, width: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.5)' },
  gridH: { position: 'absolute', left: 0, right: 0, height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.5)' },
  corner: { position: 'absolute', width: 24, height: 24, borderColor: '#FFFFFF' },
  bar: { paddingHorizontal: 16, gap: 14 },
  chips: { gap: 8, paddingRight: 8 },
  chip: { height: 38, paddingHorizontal: 16, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 14, fontFamily: SOFT_MEDIUM },
  buttons: { flexDirection: 'row', gap: 10 },
  btn: { flex: 1, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  btnText: { fontSize: 16, fontFamily: SOFT_SEMIBOLD },
});
