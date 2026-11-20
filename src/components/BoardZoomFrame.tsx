import { useEffect, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Svg, { Polygon } from 'react-native-svg';
import Animated, {
  useAnimatedProps, Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { measureCard, type Rect } from '../utils/morph';
import { boardZoomKey, takeBoardZoomFrom } from '../utils/boardZoom';

// The board screen standing in its card's rectangle and growing to the screen (see utils/boardZoom).
const OPEN_MS = 380;
const BACK_MS = 300;
const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const START_DELAY_MS = 120;
const AnimatedPolygon = Animated.createAnimatedComponent(Polygon);
const SQRT2 = Math.SQRT2;
const FAR = 5000;

type Nav = {
  addListener: (event: 'beforeRemove', cb: (e: { preventDefault: () => void; data: { action: { type: string } } }) => void) => () => void;
  dispatch: (action: never) => void;
};

export default function BoardZoomFrame({ boardId, navigation, children }: { boardId: string; navigation: Nav; children: ReactNode }) {
  const [from] = useState(() => takeBoardZoomFrom(boardId));
  if (!from) return <>{children}</>;
  return (
    <Zooming boardId={boardId} navigation={navigation} from={from}>
      {children}
    </Zooming>
  );
}

function Zooming({ boardId, navigation, from, children }: { boardId: string; navigation: Nav; from: Rect; children: ReactNode }) {
  const { width: W, height: H } = useWindowDimensions();
  const t = useSharedValue(0);
  const shown = useSharedValue(0);
  const cx = useSharedValue(from.x);
  const cy = useSharedValue(from.y);
  const cw = useSharedValue(from.width);
  const ch = useSharedValue(from.height);
  const [leaving, setLeaving] = useState(false);
  const left = useRef(false);

  useEffect(() => {
    const id = setTimeout(() => {
      shown.value = 1;
      t.value = withTiming(1, { duration: OPEN_MS, easing: EASE });
    }, START_DELAY_MS);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    return navigation.addListener('beforeRemove', (e) => {
      if (left.current) return;
      const type = e.data.action.type;
      if (type !== 'GO_BACK' && type !== 'POP') return;
      e.preventDefault();
      left.current = true;
      setLeaving(true);
      let popped = false;
      const pop = () => {
        if (popped) return;
        popped = true;
        navigation.dispatch(e.data.action as never);
      };
      measureCard(boardZoomKey(boardId)).then((card) => {
        if (card) {
          cx.value = card.x;
          cy.value = card.y;
          cw.value = card.width;
          ch.value = card.height;
        }
        t.value = withTiming(0, { duration: card ? BACK_MS : 160, easing: EASE }, (finished) => {
          if (finished) runOnJS(pop)();
        });
      });
      setTimeout(pop, BACK_MS + 500);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, boardId]);

  const clip = useAnimatedStyle(() => ({
    position: 'absolute',
    left: cx.value * (1 - t.value),
    top: cy.value * (1 - t.value),
    width: cw.value + (W - cw.value) * t.value,
    height: ch.value + (H - ch.value) * t.value,
    borderTopLeftRadius: 18 * (1 - t.value),
    borderTopRightRadius: 18 * (1 - t.value),
    opacity: shown.value * Math.min(1, 0.35 + t.value * 1.6),
  }));
  // The whole screen at its own size, scaled so its width is the card's, from the top-left corner.
  const page = useAnimatedStyle(() => ({
    transform: [{ scale: (cw.value + (W - cw.value) * t.value) / W }],
  }));

  // THE WHITENING (the user, 2026-10-11): the real board and its picture change into each other through a
  // white veil whose edge runs from the card's top-right corner to its bottom-left one, together with the
  // zoom. The veil covers what lies beyond the edge (distance from the top-right corner along the diagonal
  // >= f); opening, the edge goes out of the frame and the board is bare; closing, it comes back.
  const veil = useAnimatedProps(() => {
    const w = cw.value + (W - cw.value) * t.value;
    const h = ch.value + (H - ch.value) * t.value;
    const f = Math.min(1, t.value * 1.25) * 1.05 * ((w + h) / SQRT2);
    // u: from the top-right corner towards the bottom-left; v: along the edge.
    const ux = -1 / SQRT2;
    const uy = 1 / SQRT2;
    const vx = 1 / SQRT2;
    const vy = 1 / SQRT2;
    const ax = w + ux * f + vx * FAR;
    const ay = uy * f + vy * FAR;
    const bx = w + ux * f - vx * FAR;
    const by = uy * f - vy * FAR;
    return { points: `${ax},${ay} ${bx},${by} ${bx + ux * FAR},${by + uy * FAR} ${ax + ux * FAR},${ay + uy * FAR}` };
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View style={[styles.clip, clip]} pointerEvents={leaving ? 'none' : 'auto'}>
        <Animated.View style={[{ width: W, height: H, transformOrigin: 'left top' }, page]}>{children}</Animated.View>
        <Svg style={StyleSheet.absoluteFill} pointerEvents="none">
          <AnimatedPolygon animatedProps={veil} fill="#FFFFFF" fillOpacity={0.97} />
        </Svg>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: { overflow: 'hidden' },
});
