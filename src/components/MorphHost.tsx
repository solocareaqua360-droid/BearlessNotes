import { useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/ThemeProvider';
import { PAGE_SHEET_INSET } from './documentEditorStyles';
import { measureCard, morphLanded, setMorphDriver, whenLanded, type Rect } from '../utils/morph';

// THE MOVING SHEET of the card-to-page morph (utils/morph explains the
// whole of it). Mounted once, at the app's root, over everything - the dock
// included. Draws a plain sheet of paper and nothing else, so it never has
// a second picture of the page to disagree with the real one.
//
// Driven by shared values; React state changes only at the two ends of a
// move (the sheet shown, the sheet gone). The 2026-09-24 attempt learned
// that sixty state changes a second in an overlay re-render everything
// around it.

const EASE = Easing.bezier(0.22, 1, 0.36, 1);
// Growing out, and folding back. Out is slower: it is the move that has
// something to say. The same numbers as the laptop's (desktopTheme MOTION).
const OUT_MS = 340;
const BACK_MS = 300;
// The card's picture fading into paper, and the page coming up off it.
const COVER_MS = 100;
const REVEAL_MS = 200;
// The editor gets this long to say it has drawn the note; past it the
// sheet goes anyway (a note that is not in the cache still shows its own
// spinner, which is honest).
const LAND_WAIT_MS = 700;
// The phone's page corner (documentEditorStyles' softSheet).
const SHEET_RADIUS = 26;

export default function MorphHost() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [color, setColor] = useState<string | null>(null);
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const w = useSharedValue(0);
  const h = useSharedValue(0);
  const r = useSharedValue(0);
  const o = useSharedValue(0);
  const busy = useRef(false);

  // Where the editor's sheet stands on a phone: its side insets, below the
  // status bar, down to the rest above the navigation bar.
  const sheet = useRef<Rect>({ x: 0, y: 0, width: 0, height: 0 });
  sheet.current = {
    x: PAGE_SHEET_INSET,
    y: insets.top,
    width: width - PAGE_SHEET_INSET * 2,
    height: height - insets.top - insets.bottom - PAGE_SHEET_INSET,
  };
  const paper = useRef(theme.paper.fill);
  paper.current = theme.paper.fill;

  useEffect(() => {
    const finish = () => {
      setColor(null);
      busy.current = false;
    };
    const place = (rect: Rect, radius: number) => {
      x.value = rect.x;
      y.value = rect.y;
      w.value = rect.width;
      h.value = rect.height;
      r.value = radius;
    };
    const moveTo = (rect: Rect, radius: number, ms: number, done: () => void) => {
      const cfg = { duration: ms, easing: EASE };
      x.value = withTiming(rect.x, cfg);
      y.value = withTiming(rect.y, cfg);
      w.value = withTiming(rect.width, cfg);
      h.value = withTiming(rect.height, cfg);
      r.value = withTiming(radius, cfg, (finished) => {
        if (finished) runOnJS(done)();
      });
    };
    const fadeOut = (ms: number) => {
      o.value = withTiming(0, { duration: ms }, (finished) => {
        if (finished) runOnJS(finish)();
      });
    };
    // Two frames: the one the screen commits, and the one it is painted in.
    const afterPaint = (then: () => void) => requestAnimationFrame(() => requestAnimationFrame(then));

    setMorphDriver({
      open(from, radius, tint, key, update) {
        if (busy.current) {
          update();
          return;
        }
        busy.current = true;
        place(from, radius);
        o.value = 0;
        setColor(tint ?? paper.current);
        o.value = withTiming(1, { duration: COVER_MS });
        moveTo(sheet.current, SHEET_RADIUS, OUT_MS, () => {
          whenLanded(key, () => afterPaint(() => fadeOut(REVEAL_MS)));
          update();
          setTimeout(() => morphLanded(key), LAND_WAIT_MS);
        });
      },
      back(key, tint, leave) {
        if (busy.current) {
          leave();
          return;
        }
        busy.current = true;
        place(sheet.current, SHEET_RADIUS);
        o.value = 0;
        setColor(tint ?? paper.current);
        o.value = withTiming(1, { duration: COVER_MS }, (finished) => {
          if (finished) runOnJS(covered)();
        });
        function covered() {
          leave();
          afterPaint(() => {
            measureCard(key).then((card) => {
              if (!card) {
                fadeOut(REVEAL_MS);
                return;
              }
              moveTo(card, 22, BACK_MS, () => fadeOut(COVER_MS + 40));
            });
          });
        }
      },
    });
    return () => setMorphDriver(null);
    // Shared values are stable; everything else is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const style = useAnimatedStyle(() => ({
    left: x.value,
    top: y.value,
    width: w.value,
    height: h.value,
    borderRadius: r.value,
    opacity: o.value,
  }));

  if (!color) return null;
  return <Animated.View pointerEvents="none" style={[styles.sheet, { backgroundColor: color }, style]} />;
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
  },
});
