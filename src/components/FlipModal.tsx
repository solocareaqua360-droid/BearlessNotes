import { ReactNode, useEffect, useRef } from 'react';
import { Modal, Platform, StyleSheet, View, useWindowDimensions, type ModalProps } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useLeaving } from '../hooks/useLeaving';
import { FLIP_MS, flipProgress, type FlipFrom } from '../utils/flipOpen';

// A FULL-SCREEN WINDOW OPENED FROM A CARD (a photo's viewer, a file's
// quick look) - the native-Modal twin of GlassLayer's flip (utils/flipOpen).
// The card turns edge-on in the app's window; this window, already up and
// clear, comes round from the card's back over the second half, growing
// from the card's place; closing plays it backwards into the card before
// the window goes. A Modal is a window of its own, so where the card was
// is worked out against this window's own place on the screen.
//
// Without `flipFrom` (or in the browser) it is the plain Modal it was.
const PERSPECTIVE = 1100;

type Props = Pick<ModalProps, 'onRequestClose' | 'animationType' | 'transparent' | 'statusBarTranslucent'> & {
  visible: boolean;
  flipFrom?: FlipFrom | null;
  children: ReactNode;
};

export default function FlipModal({ visible, flipFrom, children, animationType, transparent, ...rest }: Props) {
  const flip = Platform.OS !== 'web' && flipFrom ? flipFrom : null;
  const { mounted, leaving } = useLeaving(visible, flip ? FLIP_MS : 0);
  const last = useRef(children);
  if (visible) last.current = children;
  if (!flip) {
    return (
      <Modal visible={visible} animationType={animationType} transparent={transparent} {...rest}>
        {children}
      </Modal>
    );
  }
  if (!mounted) return null;
  return (
    <Modal visible transparent animationType="none" {...rest}>
      <FlipBack from={flip} leaving={leaving}>
        {leaving ? last.current : children}
      </FlipBack>
    </Modal>
  );
}

function FlipBack({ from, leaving, children }: { from: FlipFrom; leaving: boolean; children: ReactNode }) {
  const p = flipProgress;
  const window = useWindowDimensions();
  // This window's own place and size, once measured - until then the
  // content stays out of sight and the turn waits.
  const ready = useSharedValue(0);
  const ox = useSharedValue(0);
  const oy = useSharedValue(0);
  const cw = useSharedValue(window.width);
  const ch = useSharedValue(window.height);
  const rootRef = useRef<View>(null);
  const started = useRef(false);
  const leavingRef = useRef(leaving);
  leavingRef.current = leaving;
  const rx = from.rect.x;
  const ry = from.rect.y;
  const rw = from.rect.width;
  const rh = from.rect.height;

  const run = (toOpen: boolean) => {
    p.value = withTiming(toOpen ? 1 : 0, { duration: FLIP_MS, easing: Easing.inOut(Easing.cubic) });
  };
  useEffect(() => {
    if (started.current) run(!leaving);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  const onLayout = () => {
    rootRef.current?.measureInWindow((x, y, width, height) => {
      if (!width || !height) return;
      ox.value = x;
      oy.value = y;
      cw.value = width;
      ch.value = height;
      ready.value = 1;
      if (!started.current) {
        started.current = true;
        run(!leavingRef.current);
      }
    });
  };

  const dim = useAnimatedStyle(() => ({ opacity: ready.value * p.value }));
  const back = useAnimatedStyle(() => {
    const q = Math.max(0, (p.value - 0.5) * 2);
    const s0 = cw.value > 0 ? rw / cw.value : 1;
    const s = s0 + (1 - s0) * q;
    return {
      opacity: ready.value > 0 && p.value >= 0.5 ? 1 : 0,
      transform: [
        { perspective: PERSPECTIVE },
        { translateX: (rx - ox.value + rw / 2 - cw.value / 2) * (1 - q) },
        { translateY: (ry - oy.value + rh / 2 - ch.value / 2) * (1 - q) },
        { rotateY: `${-90 * (1 - q)}deg` },
        { scale: s },
      ],
    };
  });

  return (
    <View ref={rootRef} style={StyleSheet.absoluteFill} onLayout={onLayout} collapsable={false}>
      <Animated.View style={[StyleSheet.absoluteFill, styles.dim, dim]} pointerEvents="none" />
      <Animated.View style={[StyleSheet.absoluteFill, back]} pointerEvents={leaving ? 'none' : 'box-none'}>
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: {
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
});
