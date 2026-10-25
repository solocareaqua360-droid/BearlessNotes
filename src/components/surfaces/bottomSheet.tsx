import { ReactNode, useEffect } from 'react';
import { Platform, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDensity } from '../../hooks/useDensity';
import { useDockGlass } from '../../utils/dockGlass';
import { useSoft } from '../../theme/soft';
import { useTheme } from '../../theme/ThemeProvider';
import DockGlassFill, { useDockSurface } from '../DockGlassFill';
import { SHEET_WINDOW } from '../../constants/glass';

// THE SHEET FROM THE BOTTOM for a window built by hand over GlassLayer (the four windows, 2026-10-25) - what Sheet.tsx
// does for its own windows, in pieces a hand-built one can put on: the frame stands its window on the bottom edge, the
// window goes full width and reaches BELOW the screen (its round foot out of sight), the glass is the sheets' thick coat,
// and `grab` is the top strip a finger drags it down by. Pass `rise={b.on}` to the GlassLayer so it comes up on a spring
// with the app stepping back. The Mac keeps its window in the middle: there `on` is false and every piece is empty.
export const BELOW = 48;

// `glass` false: a window that keeps its own body (the old dark glass palette, white words on it) - the milk would
// swallow those words.
export function useBottomSheet(visible: boolean, onClose: () => void, glass = true) {
  const on = useDensity() !== 'pointer';
  const insets = useSafeAreaInsets();
  const glassOn = useDockGlass() && on && glass;
  const S = useSoft();
  const theme = useTheme();
  const surface = useDockSurface(S, glassOn);
  const drag = useSharedValue(0);
  useEffect(() => {
    if (visible) drag.value = 0;
  }, [visible, drag]);
  const dragStyle = useAnimatedStyle(() => ({ transform: [{ translateY: drag.value }] }));
  const close = () => onClose();
  const pan = Gesture.Pan()
    .activeOffsetY(6)
    .onUpdate((e) => {
      drag.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 110 || e.velocityY > 900) runOnJS(close)();
      else drag.value = withSpring(0, { damping: 22, stiffness: 300 });
    });
  // No paddingBottom here: a hand-built frame lifts its window over the keyboard by its own paddingBottom.
  const frame: ViewStyle | null = on ? { justifyContent: 'flex-end', paddingHorizontal: 0 } : null;
  const window = on
    ? [{ maxWidth: '100%', borderWidth: 0, marginBottom: -BELOW } as ViewStyle, glassOn ? surface : null, dragStyle]
    : null;
  // The window's own bottom padding, plus the gesture bar and the part below the screen.
  const padBottom = (p: number): ViewStyle | null => (on ? { paddingBottom: p + insets.bottom + BELOW } : null);
  const fill: ReactNode = glassOn ? <DockGlassFill soft={S} radius={SHEET_WINDOW.borderRadius} coat={0.88} intensity={100} /> : null;
  const grab: ReactNode = on ? (
    <GestureDetector gesture={pan}>
      <View style={styles.grab} collapsable={false}>
        <View style={[styles.handle, { backgroundColor: theme.edge.hairline }]} />
      </View>
    </GestureDetector>
  ) : null;
  return { on, frame, window, padBottom, fill, grab };
}

const styles = StyleSheet.create({
  // Laid OVER the window's top edge, not in its flow: a hand-built window's own top padding runs from 0 to 20, and in the
  // flow the bar was clipped away in the thin ones. Only the middle of the edge, so a × in a corner stays tappable.
  grab: { position: 'absolute', top: 0, height: 24, width: 160, left: '50%', marginLeft: -80, alignItems: 'center', paddingTop: 7, zIndex: 5 },
  handle: { width: 36, height: 4, borderRadius: 2 },
});

// The same, as a component - for a screen with many hand-built windows in one component (CustomDatabaseScreen), where a
// hook per window would not fit. `catchTaps`: the window stood in a Pressable that only swallowed taps (its parent, the
// dim, closes on a tap) - this keeps that, a tap inside never reaching the dim.
export function BottomWindow({
  visible = true,
  onClose,
  style,
  pad = 0,
  grab = true,
  catchTaps,
  glass = true,
  children,
}: {
  visible?: boolean;
  onClose: () => void;
  style?: StyleProp<ViewStyle>;
  pad?: number;
  grab?: boolean;
  catchTaps?: boolean;
  glass?: boolean;
  children: ReactNode;
}) {
  const b = useBottomSheet(visible, onClose, glass);
  return (
    <Animated.View style={[style, b.window, b.padBottom(pad)]} onStartShouldSetResponder={catchTaps ? () => true : undefined}>
      {b.fill}
      {grab && b.grab}
      {/* Room for the bar, which lies over the edge rather than in the flow. */}
      {grab && b.on && <View style={{ height: 12 }} />}
      {children}
    </Animated.View>
  );
}

// The frame round a hand-built window: on the bottom edge on the phone, as it was on the Mac.
export function useBottomFrame(): ViewStyle | null {
  return useDensity() !== 'pointer' ? { justifyContent: 'flex-end', paddingHorizontal: 0 } : null;
}
export function useRises(): boolean {
  return useDensity() !== 'pointer';
}

// The same three, for a screen that builds its windows inline: whether a window rises (the phone), its frame on the bottom
// edge (transparent - GlassLayer draws the dim; a frame's own scrim on top of that doubled it), and, for a frame padded
// all round, its foot.
export const RISES = Platform.OS !== 'web';
export const BOTTOM_FRAME = RISES ? ({ justifyContent: 'flex-end', paddingHorizontal: 0, backgroundColor: 'transparent' } as const) : null;
export const BOTTOM_FLUSH = RISES ? ({ paddingBottom: 0 } as const) : null;
