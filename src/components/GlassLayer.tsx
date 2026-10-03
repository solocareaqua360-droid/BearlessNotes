import { MOTION } from '../theme/desktopTheme';
import { NO_WINDOW_DRAG } from '../utils/windowDrag';
import { useLeaving } from '../hooks/useLeaving';
import { ReactNode, useEffect, useRef } from 'react';
import { BackHandler, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import { FLIP_MS, flipProgress, type FlipFrom } from '../utils/flipOpen';
import { BlurView } from 'expo-blur';
import Animated, { Easing, SharedValue, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useBlurTarget } from './GlassTarget';
import { GlassPortal } from './GlassPortal';
import { GLASS_BACKDROP } from '../constants/glass';
import { useDensity } from '../hooks/useDensity';

// What a bottom sheet sits in, now that a sheet is a layer rather than a
// window. The reason is the blur: on Android it blurs what is inside ITS
// OWN window, and a Modal is a window of its own - so a sheet in one had
// nothing behind it to blur and the screen showed through sharp. Inside
// the screen, the screen is what it blurs.
//
// Two things a Modal used to provide have to be provided here: the
// hardware back button, and the gesture root - App.tsx's own reaches this
// now that it isn't a separate window.
export default function GlassLayer({
  visible,
  onClose,
  children,
  intensity = 50,
  flipFrom,
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  intensity?: number;
  // Opened from a card (utils/flipOpen): the window turns that card over
  // and grows out of its back, and goes back into it the same way. The
  // phone only.
  flipFrom?: FlipFrom | null;
}) {
  // Without this ref expo-blur falls back to a plain translucent view on
  // Android - which is what made the first two attempts look like a dim.
  const blurTarget = useBlurTarget();
  // At a pointer (the laptop) a window over the app is a Mac's: no blur, the
  // app behind barely dimmed, Esc closes it. The phone keeps its glass.
  const pointer = useDensity() === 'pointer';
  useEffect(() => {
    if (!visible || !pointer || typeof document === 'undefined') return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [visible, pointer, onClose]);

  useEffect(() => {
    if (!visible) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onClose();
      return true;
    });
    return () => sub.remove();
  }, [visible, onClose]);

  // A window grows in and plays its way out, drawing what it showed last -
  // the caller's own content may already be gone. At a pointer by CSS, on
  // the phone by GrowIn below (the soft motion, 2026-10-02).
  const flip = !pointer && flipFrom ? flipFrom : null;
  const { mounted, leaving } = useLeaving(visible, flip ? FLIP_MS : MOTION.out);
  // The card's turn, 0 in the card .. 1 open - and the dim and the blur
  // behind follow the same clock: they came on at once ("ніби світло
  // вимкнули") and went off only after the card had settled.
  const flipT = flipProgress;
  const backdropStyle = useAnimatedStyle(() => ({ opacity: flipT.value }));
  const lastChildren = useRef(children);
  if (visible) lastChildren.current = children;
  if (!mounted) return null;

  return (
    <GlassPortal>
    <View style={[styles.layer, NO_WINDOW_DRAG]}>
      {/* The blur covers the whole screen, not just the sheet: what is
          beside a sheet is as much "behind the glass" as what is under it,
          and blurring only the sheet's own rectangle looks like a cut-out. */}
      <Animated.View style={[StyleSheet.absoluteFill, flip ? backdropStyle : null]} pointerEvents="box-none">
      {!pointer && (
      <BlurView
        intensity={intensity}
        tint="dark"
        blurMethod="dimezisBlurView"
        blurTarget={blurTarget ?? undefined}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      )}
      {/* The dim, and the tap that closes. A SIBLING behind the sheet, not
          its parent: as a parent it took the touch responder for every drag
          that didn't land on a deeper child, which is what used to keep
          these lists from scrolling. */}
      <Pressable style={[StyleSheet.absoluteFill, pointer ? styles.dimLight : styles.dim]} onPress={onClose} />
      </Animated.View>
      {pointer ? (
        <View
          {...({ dataSet: leaving ? { fadeOut: '1', origin: 'center' } : { fadeIn: '1', origin: 'center' } } as object)}
          style={styles.content}
          pointerEvents="box-none"
        >
          {leaving ? lastChildren.current : children}
        </View>
      ) : (
        flip ? (
          <FlipIn leaving={leaving} from={flip} p={flipT}>{leaving ? lastChildren.current : children}</FlipIn>
        ) : (
          <GrowIn leaving={leaving}>{leaving ? lastChildren.current : children}</GrowIn>
        )
      )}
    </View>
    </GlassPortal>
  );
}

// THE PHONE'S WINDOW COMING AND GOING: it grows in from a little smaller
// and fades up, and plays the same way out. Only the window - the blur
// behind it stays as it was: a live blur that animates is the one thing
// that has frozen this app (see the live-blur memory).
const IN_MS = 220;
const SMALL = 0.96;
function GrowIn({ leaving, children }: { leaving: boolean; children: ReactNode }) {
  const shown = useSharedValue(0);
  useEffect(() => {
    shown.value = leaving
      ? withTiming(0, { duration: MOTION.out, easing: Easing.in(Easing.cubic) })
      : withTiming(1, { duration: IN_MS, easing: Easing.bezier(0.22, 1, 0.36, 1) });
  }, [leaving, shown]);
  const style = useAnimatedStyle(() => ({
    opacity: shown.value,
    transform: [{ scale: SMALL + (1 - SMALL) * shown.value }],
  }));
  return (
    <Animated.View style={[styles.content, style]} pointerEvents={leaving ? 'none' : 'box-none'}>
      {children}
    </Animated.View>
  );
}

// THE CARD TURNING OVER INTO ITS WINDOW (utils/flipOpen). One clock, two
// halves: first the real card turns edge-on where it stands, lifting a
// little (it reads the same clock - usePressSettle); then the window
// comes round from edge-on on its back,
// growing from the card's size and place to its own. Edge-on, neither is
// seen - that is where one hands over to the other. Closing plays it
// backwards into the same card.
const PERSPECTIVE = 1100;
function FlipIn({
  leaving,
  from,
  p,
  children,
}: {
  leaving: boolean;
  from: FlipFrom;
  p: SharedValue<number>;
  children: ReactNode;
}) {
  const window = useWindowDimensions();
  // Plain numbers for the worklets - never the objects they came in.
  const rx = from.rect.x;
  const ry = from.rect.y;
  const rw = from.rect.width;
  const rh = from.rect.height;
  const ww = window.width;
  const wh = window.height;
  useEffect(() => {
    p.value = withTiming(leaving ? 0 : 1, { duration: FLIP_MS, easing: Easing.inOut(Easing.cubic) });
  }, [leaving, p]);
  const back = useAnimatedStyle(() => {
    const q = Math.max(0, (p.value - 0.5) * 2);
    const s0 = ww > 0 ? rw / ww : 1;
    const s = s0 + (1 - s0) * q;
    return {
      opacity: p.value < 0.5 ? 0 : 1,
      transform: [
        { perspective: PERSPECTIVE },
        { translateX: (rx + rw / 2 - ww / 2) * (1 - q) },
        { translateY: (ry + rh / 2 - wh / 2) * (1 - q) },
        { rotateY: `${-90 * (1 - q)}deg` },
        { scale: s },
      ],
    };
  });
  return (
    <Animated.View style={[styles.content, back]} pointerEvents={leaving ? 'none' : 'box-none'}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    // The window sits in the middle of the screen (see SHEET_BACKDROP in
    // constants/glass) - the layer centres what it is given.
    justifyContent: 'center',
    zIndex: 50,
  },
  dim: {
    backgroundColor: GLASS_BACKDROP,
  },
  // The window's own layer (a pointer's), so it can grow in and out without
  // the dim behind it moving: it fills the layer and centres as the layer did.
  content: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    justifyContent: 'center',
  },
  dimLight: {
    backgroundColor: 'rgba(0,0,0,0.12)',
  },
});
