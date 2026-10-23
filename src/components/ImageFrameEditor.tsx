import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from './icons/Ionicons';
import { FONT_MEDIUM, FONT_SEMIBOLD } from '../utils/fonts';
import { cleanFrame, MAX_ZOOM, type ImageFrame } from '../utils/imageFrame';

// CHOOSING A COVER'S FRAME (utils/imageFrame), the way a social app does it: the frame stands still, the picture moves behind
// it - one finger moves it, two fingers bring it closer or further, around the point between them. What falls outside the
// frame is dimmed, not hidden, so you see what you are leaving out. `also` draws thin outlines of the other shapes the same
// cover is shown in (a card, a wider screen), centred in the frame, so one choice can be checked for all of them.
// The one place covers are framed - every cover in the app opens this (the user: «єдиний модуль»). It replaced ImageCropper,
// which cut a copy and was never used.
export default function ImageFrameEditor({
  visible,
  uri,
  aspect,
  also = [],
  initial,
  onCancel,
  onDone,
}: {
  visible: boolean;
  uri: string | null;
  // The main box's width / height.
  aspect: number;
  // Other boxes the cover is drawn in, as width / height, with a word for each.
  also?: { aspect: number; label: string }[];
  initial?: ImageFrame | null;
  onCancel: () => void;
  onDone: (frame: ImageFrame) => void;
}) {
  const { width: winW, height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const [natural, setNatural] = useState<{ w: number; h: number } | null>(null);

  const frameW = Math.min(winW - 32, 640, (winH * 0.55) * aspect);
  const frameH = frameW / aspect;
  const cover = natural ? Math.max(frameW / natural.w, frameH / natural.h) : 1;
  const baseW = natural ? natural.w * cover : frameW;
  const baseH = natural ? natural.h * cover : frameH;

  // The picture's centre, from the frame's centre; and how close it is (1 = it just covers the frame).
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const zoom = useSharedValue(1);
  const lastPinch = useSharedValue(1);

  useEffect(() => {
    if (!visible || !uri) return;
    setNatural(null);
    const start = (w: number, h: number) => {
      setNatural({ w, h });
      const c = Math.max(frameW / w, frameH / h);
      const z = initial ? Math.min(MAX_ZOOM, Math.max(1, initial.zoom)) : 1;
      zoom.value = z;
      x.value = initial ? (0.5 - initial.cx) * w * c * z : 0;
      y.value = initial ? (0.5 - initial.cy) * h * c * z : 0;
    };
    if (initial?.w && initial?.h) start(initial.w, initial.h);
    else Image.getSize(uri, start, () => setNatural(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, uri]);

  // The frame must stay covered: the picture is held inside what the current closeness leaves over.
  function settle() {
    'worklet';
    const limX = Math.max(0, (baseW * zoom.value - frameW) / 2);
    const limY = Math.max(0, (baseH * zoom.value - frameH) / 2);
    x.value = withTiming(Math.min(limX, Math.max(-limX, x.value)), { duration: 140 });
    y.value = withTiming(Math.min(limY, Math.max(-limY, y.value)), { duration: 140 });
  }

  // Both gestures move the picture by STEPS, so they add up when two fingers move and pinch at once.
  const pan = Gesture.Pan()
    .averageTouches(true)
    .onChange((e) => {
      x.value += e.changeX;
      y.value += e.changeY;
    })
    .onEnd(settle);

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      lastPinch.value = 1;
    })
    .onChange((e) => {
      const next = Math.min(MAX_ZOOM, Math.max(1, zoom.value * (e.scale / lastPinch.value)));
      const ratio = next / zoom.value;
      lastPinch.value = e.scale;
      // About the point between the fingers, measured from the frame's centre (the surface is the whole screen).
      const fx = e.focalX - winW / 2;
      const fy = e.focalY - (winH - insets.bottom - 88) / 2;
      x.value = fx - (fx - x.value) * ratio;
      y.value = fy - (fy - y.value) * ratio;
      zoom.value = next;
    })
    .onEnd(settle);

  const imageStyle = useAnimatedStyle(() => ({
    width: baseW,
    height: baseH,
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: zoom.value }],
  }));

  function finish() {
    if (!natural) return;
    const shownW = baseW * zoom.value;
    const shownH = baseH * zoom.value;
    onDone(cleanFrame({ cx: 0.5 - x.value / shownW, cy: 0.5 - y.value / shownH, zoom: zoom.value, w: natural.w, h: natural.h }));
  }

  // The surface: the whole screen above the buttons; the frame in its middle.
  const surfaceH = winH - insets.bottom - 88;
  const frameLeft = (winW - frameW) / 2;
  const frameTop = (surfaceH - frameH) / 2;

  return (
    <Modal visible={visible && !!uri} transparent animationType="fade" onRequestClose={onCancel} statusBarTranslucent>
      <GestureHandlerRootView style={styles.root}>
        <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}>
          <View style={[styles.surface, { height: surfaceH }]}>
            <View style={styles.center} pointerEvents="none">
              {uri && <Animated.Image source={{ uri }} style={imageStyle} resizeMode="cover" />}
            </View>
            {/* Outside the frame: dimmed, still seen. */}
            <View pointerEvents="none" style={[styles.dim, { left: 0, right: 0, top: 0, height: frameTop }]} />
            <View pointerEvents="none" style={[styles.dim, { left: 0, right: 0, top: frameTop + frameH, bottom: 0 }]} />
            <View pointerEvents="none" style={[styles.dim, { left: 0, width: frameLeft, top: frameTop, height: frameH }]} />
            <View pointerEvents="none" style={[styles.dim, { right: 0, width: frameLeft, top: frameTop, height: frameH }]} />
            <View pointerEvents="none" style={[styles.frame, { left: frameLeft, top: frameTop, width: frameW, height: frameH }]}>
              <View style={[styles.third, { left: '33.33%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
              <View style={[styles.third, { left: '66.66%', top: 0, bottom: 0, width: StyleSheet.hairlineWidth }]} />
              <View style={[styles.third, { top: '33.33%', left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
              <View style={[styles.third, { top: '66.66%', left: 0, right: 0, height: StyleSheet.hairlineWidth }]} />
              {also.map((o) => {
                // The other shape, as large as fits in the frame.
                const w = Math.min(frameW, frameH * o.aspect);
                const h = w / o.aspect;
                return (
                  <View key={o.label} style={[styles.also, { width: w, height: h, left: (frameW - w) / 2, top: (frameH - h) / 2 }]}>
                    <Text style={styles.alsoLabel}>{o.label}</Text>
                  </View>
                );
              })}
            </View>
            <Text pointerEvents="none" style={[styles.hint, { top: frameTop + frameH + 12 }]}>
              Рухай одним пальцем, наближай двома
            </Text>
          </View>
        </GestureDetector>
        <View style={[styles.actions, { paddingBottom: insets.bottom + 16 }]}>
          <Pressable style={styles.action} onPress={onCancel}>
            <Ionicons name="close-outline" size={20} color="#FFFFFF" />
            <Text style={styles.actionLabel}>Скасувати</Text>
          </Pressable>
          <Pressable style={[styles.action, styles.actionPrimary]} onPress={finish} disabled={!natural}>
            <Ionicons name="checkmark" size={20} color="#171310" />
            <Text style={[styles.actionLabel, { color: '#171310' }]}>Готово</Text>
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0E0D0C' },
  surface: { width: '100%', overflow: 'hidden' },
  center: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
  dim: { position: 'absolute', backgroundColor: 'rgba(14,13,12,0.62)' },
  frame: { position: 'absolute', borderWidth: 1.5, borderColor: '#FFFFFF', borderRadius: 4 },
  third: { position: 'absolute', backgroundColor: 'rgba(255,255,255,0.35)' },
  also: { position: 'absolute', borderWidth: 1, borderColor: 'rgba(255,255,255,0.7)', borderStyle: 'dashed', borderRadius: 4 },
  alsoLabel: { position: 'absolute', left: 6, top: 4, fontSize: 11, fontFamily: FONT_MEDIUM, color: 'rgba(255,255,255,0.85)' },
  hint: { position: 'absolute', left: 0, right: 0, textAlign: 'center', fontSize: 12, fontFamily: FONT_MEDIUM, color: 'rgba(255,255,255,0.7)' },
  actions: { flexDirection: 'row', justifyContent: 'center', gap: 12, paddingTop: 16 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, paddingHorizontal: 22, borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.12)' },
  actionPrimary: { backgroundColor: '#FFFFFF' },
  actionLabel: { fontSize: 14, fontFamily: FONT_SEMIBOLD, color: '#FFFFFF' },
});
