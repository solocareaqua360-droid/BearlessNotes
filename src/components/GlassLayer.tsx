import { MOTION } from '../theme/desktopTheme';
import { useLeaving } from '../hooks/useLeaving';
import { ReactNode, useEffect, useRef } from 'react';
import { BackHandler, Pressable, StyleSheet, View } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
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
}: {
  visible: boolean;
  onClose: () => void;
  children: ReactNode;
  intensity?: number;
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
  const { mounted, leaving } = useLeaving(visible, MOTION.out);
  const lastChildren = useRef(children);
  if (visible) lastChildren.current = children;
  if (!mounted) return null;

  return (
    <GlassPortal>
    <View style={styles.layer}>
      {/* The blur covers the whole screen, not just the sheet: what is
          beside a sheet is as much "behind the glass" as what is under it,
          and blurring only the sheet's own rectangle looks like a cut-out. */}
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
      {pointer ? (
        <View
          {...({ dataSet: leaving ? { fadeOut: '1', origin: 'center' } : { fadeIn: '1', origin: 'center' } } as object)}
          style={styles.content}
          pointerEvents="box-none"
        >
          {leaving ? lastChildren.current : children}
        </View>
      ) : (
        <GrowIn leaving={leaving}>{leaving ? lastChildren.current : children}</GrowIn>
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
