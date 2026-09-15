import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector, GestureHandlerRootView } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { FONT_MEDIUM, FONT_SEMIBOLD } from '../utils/fonts';
import { GLASS_BODY, GLASS_TEXT, GLASS_TEXT_MUTED } from '../constants/glass';

// Crop an image to a given shape: the frame stands still and the picture
// is moved and scaled behind it, which is the way every phone does it -
// dragging a box around instead means fighting the box and the picture at
// the same time.
//
// It hands back a NEW file rather than a rectangle: whatever asked for the
// crop then has an image of exactly the shape it wanted, and never has to
// carry the original plus a set of coordinates to apply on every render.

export default function ImageCropper({
  visible,
  uri,
  // Width divided by height. A tile's own proportion, a square, whatever
  // the caller needs to end up with.
  aspect,
  onCancel,
  onDone,
}: {
  visible: boolean;
  uri: string | null;
  aspect: number;
  onCancel: () => void;
  onDone: (uri: string) => void;
}) {
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [natural, setNatural] = useState<{ width: number; height: number } | null>(null);
  const [busy, setBusy] = useState(false);

  // The window the crop is taken through, as large as fits with room for
  // the buttons under it.
  const frameWidth = Math.min(windowWidth - 48, 520);
  const frameHeight = Math.min(frameWidth / aspect, windowHeight * 0.6);
  const fittedFrameWidth = frameHeight * aspect;

  // The picture at rest: scaled to cover the frame, centred in it.
  const cover = natural
    ? Math.max(fittedFrameWidth / natural.width, frameHeight / natural.height)
    : 1;
  const baseWidth = natural ? natural.width * cover : fittedFrameWidth;
  const baseHeight = natural ? natural.height * cover : frameHeight;

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const savedX = useSharedValue(0);
  const savedY = useSharedValue(0);

  useEffect(() => {
    if (!visible || !uri) return;
    setNatural(null);
    scale.value = 1;
    savedScale.value = 1;
    x.value = 0;
    y.value = 0;
    savedX.value = 0;
    savedY.value = 0;
    Image.getSize(
      uri,
      (width, height) => setNatural({ width, height }),
      () => setNatural(null)
    );
  }, [visible, uri]);

  // The picture may never be dragged far enough to show a gap: the frame
  // has to stay covered, so both offsets are held inside what the current
  // scale leaves over.
  function clampBack() {
    'worklet';
    const limitX = Math.max(0, (baseWidth * scale.value - fittedFrameWidth) / 2);
    const limitY = Math.max(0, (baseHeight * scale.value - frameHeight) / 2);
    x.value = withTiming(Math.min(limitX, Math.max(-limitX, x.value)), { duration: 120 });
    y.value = withTiming(Math.min(limitY, Math.max(-limitY, y.value)), { duration: 120 });
  }

  const pan = Gesture.Pan()
    .onBegin(() => {
      savedX.value = x.value;
      savedY.value = y.value;
    })
    .onUpdate((e) => {
      x.value = savedX.value + e.translationX;
      y.value = savedY.value + e.translationY;
    })
    .onEnd(clampBack);

  const pinch = Gesture.Pinch()
    .onBegin(() => {
      savedScale.value = scale.value;
    })
    .onUpdate((e) => {
      scale.value = Math.min(6, Math.max(1, savedScale.value * e.scale));
    })
    .onEnd(clampBack);

  const imageStyle = useAnimatedStyle(() => ({
    width: baseWidth,
    height: baseHeight,
    transform: [{ translateX: x.value }, { translateY: y.value }, { scale: scale.value }],
  }));

  async function apply() {
    if (!uri || !natural || busy) return;
    setBusy(true);
    try {
      // From what is on screen back to pixels in the original: the frame's
      // top-left corner, expressed in the picture's own coordinates.
      const shown = { width: baseWidth * scale.value, height: baseHeight * scale.value };
      const perPixel = natural.width / shown.width;
      const originX = (shown.width / 2 - fittedFrameWidth / 2 - x.value) * perPixel;
      const originY = (shown.height / 2 - frameHeight / 2 - y.value) * perPixel;
      const cropWidth = fittedFrameWidth * perPixel;
      const cropHeight = frameHeight * perPixel;
      const context = ImageManipulator.manipulate(uri).crop({
        originX: Math.max(0, Math.min(natural.width - 1, Math.round(originX))),
        originY: Math.max(0, Math.min(natural.height - 1, Math.round(originY))),
        width: Math.max(1, Math.min(natural.width, Math.round(cropWidth))),
        height: Math.max(1, Math.min(natural.height, Math.round(cropHeight))),
      });
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
      onDone(saved.uri);
    } catch {
      // A crop that cannot be computed leaves the picture alone rather
      // than handing back something wrong.
      onCancel();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal visible={visible && !!uri} transparent animationType="fade" onRequestClose={onCancel}>
      <GestureHandlerRootView style={styles.root}>
        <View style={styles.frameWrap}>
          <View style={[styles.frame, { width: fittedFrameWidth, height: frameHeight }]}>
            <GestureDetector gesture={Gesture.Simultaneous(pan, pinch)}>
              <Animated.View style={styles.imageWrap}>
                {uri && <Animated.Image source={{ uri }} style={imageStyle} resizeMode="cover" />}
              </Animated.View>
            </GestureDetector>
            {/* The thirds, drawn over the picture - the one piece of
                furniture a crop window really needs. */}
            <View style={styles.guides} pointerEvents="none">
              <View style={[styles.guideLine, { left: '33.33%' }]} />
              <View style={[styles.guideLine, { left: '66.66%' }]} />
              <View style={[styles.guideLineH, { top: '33.33%' }]} />
              <View style={[styles.guideLineH, { top: '66.66%' }]} />
            </View>
          </View>
          <Text style={styles.hint}>Перетягуй і зводь пальцями</Text>
        </View>

        <View style={styles.actions}>
          <Pressable style={styles.action} onPress={onCancel}>
            <Ionicons name="close-outline" size={20} color={GLASS_TEXT} />
            <Text style={styles.actionLabel}>Скасувати</Text>
          </Pressable>
          <Pressable style={[styles.action, styles.actionPrimary]} onPress={apply} disabled={busy}>
            <Ionicons name="checkmark" size={20} color="#171310" />
            <Text style={[styles.actionLabel, styles.actionPrimaryLabel]}>Обрізати</Text>
          </Pressable>
        </View>
      </GestureHandlerRootView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  frameWrap: {
    alignItems: 'center',
    gap: 12,
  },
  frame: {
    overflow: 'hidden',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.6)',
    backgroundColor: '#000',
  },
  imageWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  guides: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
  },
  guideLine: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 1,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  guideLineH: {
    position: 'absolute',
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  hint: {
    fontSize: 12,
    fontFamily: FONT_MEDIUM,
    color: GLASS_TEXT_MUTED,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    borderRadius: 999,
    backgroundColor: GLASS_BODY,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  actionPrimary: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderColor: 'transparent',
  },
  actionLabel: {
    fontSize: 14,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT,
  },
  actionPrimaryLabel: {
    color: '#171310',
  },
});
