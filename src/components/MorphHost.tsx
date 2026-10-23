import { useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { Easing, Extrapolation, interpolate, interpolateColor, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import BalloonMark from './BalloonMark';
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
// The balloon's window (utils/assistMorph): longer, on an even in-out curve.
const SLOW_OUT_MS = 420;
const EVEN = Easing.bezier(0.45, 0, 0.2, 1);
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
// Longer than any whole move, waits included.
const WATCHDOG_MS = 2500;
// A pane on the Fold's inner screen is flat to the screen's edges.
const PANE_RADIUS = 0;

export default function MorphHost() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [color, setColor] = useState<string | null>(null);
  // The colour the sheet turns into on its way (none: it keeps `color`), and how far it has turned (0..1).
  const [toColor, setToColor] = useState<string | null>(null);
  const tc = useSharedValue(0);
  // The AI's balloon, drawn in the middle of its sheet while the sheet is still small (utils/assistMorph).
  const [glyph, setGlyph] = useState(false);
  const accent = useRef(theme.accent);
  accent.current = theme.accent;
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
    let watchdog: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      clearTimeout(watchdog);
      setColor(null);
      setToColor(null);
      setGlyph(false);
      busy.current = false;
    };
    // Whatever goes wrong on the way (a callback that never comes, an
    // animation cut short), the sheet is never left standing over the app.
    const guard = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        o.value = 0;
        finish();
      }, WATCHDOG_MS);
    };
    const place = (rect: Rect, radius: number) => {
      x.value = rect.x;
      y.value = rect.y;
      w.value = rect.width;
      h.value = rect.height;
      r.value = radius;
    };
    const moveTo = (rect: Rect, radius: number, ms: number, done: () => void) => {
      const cfg = { duration: ms, easing: ms === SLOW_OUT_MS ? EVEN : EASE };
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
      open(from, radius, tint, key, update, into, slow, turnTo) {
        if (busy.current) {
          update();
          return;
        }
        busy.current = true;
        guard();
        place(from, radius);
        o.value = 0;
        setColor(tint ?? paper.current);
        setToColor(turnTo ?? null);
        setGlyph(key === 'assistant');
        tc.value = 0;
        // The page comes up off the sheet once BOTH are true: the sheet
        // has arrived, and the editor has drawn the note.
        let arrived = false;
        let landed = false;
        const reveal = () => {
          if (arrived && landed) afterPaint(() => fadeOut(REVEAL_MS));
        };
        whenLanded(key, () => {
          landed = true;
          reveal();
        });
        const land = () => {
          arrived = true;
          reveal();
        };
        if (!into) {
          // A pushed screen: the sheet grows to where the page will stand,
          // and the screen is opened under it once it is there.
          o.value = withTiming(1, { duration: slow ? 60 : COVER_MS });
          // A small round thing (the AI's balloon) grows on an even curve and a little longer: on the card's quick ease
          // it was full-size in the first ~100 ms and read as a flash, not as the circle opening (2026-10-23).
          // Its colour turns on the way, so the full screen is already the conversation's paper (no orange-to-white cut).
          if (turnTo) tc.value = withTiming(1, { duration: SLOW_OUT_MS, easing: EVEN });
          moveTo(sheet.current, SHEET_RADIUS, slow ? SLOW_OUT_MS : OUT_MS, () => {
            update();
            land();
            setTimeout(() => morphLanded(key), LAND_WAIT_MS);
          });
          return;
        }
        // A pane beside the list (the Fold's inner screen): it only exists
        // once the note is open, and the list narrows to make room for it.
        // So the card is covered first, the pane opened under the cover,
        // and the sheet grows into the pane where it has actually landed.
        o.value = withTiming(1, { duration: COVER_MS }, (finished) => {
          if (finished) runOnJS(covered)();
        });
        function covered() {
          update();
          setTimeout(() => morphLanded(key), LAND_WAIT_MS);
          afterPaint(() => {
            measureCard(into as string).then((pane) => {
              if (!pane) {
                land();
                return;
              }
              moveTo(pane, PANE_RADIUS, OUT_MS, land);
            });
          });
        }
      },
      back(key, tint, leave, from, turnTo) {
        if (busy.current) {
          leave();
          return;
        }
        busy.current = true;
        guard();
        const start = (rect: Rect, radius: number) => {
          place(rect, radius);
          o.value = 0;
          setColor(tint ?? paper.current);
          setToColor(turnTo ?? null);
          setGlyph(key === 'assistant');
          tc.value = 0;
          o.value = withTiming(1, { duration: COVER_MS }, (finished) => {
            if (finished) runOnJS(covered)();
          });
        };
        if (from) {
          measureCard(from).then((pane) => start(pane ?? sheet.current, pane ? PANE_RADIUS : SHEET_RADIUS));
        } else {
          start(sheet.current, SHEET_RADIUS);
        }
        function covered() {
          leave();
          // The card may be drawn a moment after the screen is gone (the AI balloon lives in a dock that comes back with
          // the desks): asked again a few times before the sheet gives up and only fades.
          const fold = (tries: number) =>
            measureCard(key).then((card) => {
              if (!card) {
                if (tries > 0) setTimeout(() => fold(tries - 1), 60);
                else fadeOut(REVEAL_MS);
                return;
              }
              const round = key === 'assistant' ? Math.min(card.width, card.height) / 2 : 22;
              if (turnTo) tc.value = withTiming(1, { duration: BACK_MS, easing: EASE });
              moveTo(card, round, BACK_MS, () => fadeOut(COVER_MS + 40));
            });
          afterPaint(() => fold(4));
        }
      },
    });
    return () => setMorphDriver(null);
    // Shared values are stable; everything else is read through refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const from = color ?? '#FFFFFF';
  const to = toColor ?? from;
  const style = useAnimatedStyle(
    () => ({
      left: x.value,
      top: y.value,
      width: w.value,
      height: h.value,
      borderRadius: r.value,
      opacity: o.value,
      backgroundColor: interpolateColor(tc.value, [0, 1], [from, to]),
    }),
    [from, to]
  );
  // The balloon: whole while the sheet is about its own size, gone by the time the sheet is a few times wider.
  const glyphStyle = useAnimatedStyle(() => ({
    opacity: interpolate(w.value, [70, 200], [1, 0], Extrapolation.CLAMP),
    transform: [{ scale: interpolate(w.value, [40, 200], [1, 1.5], Extrapolation.CLAMP) }],
  }));

  if (!color) return null;
  return (
    <Animated.View pointerEvents="none" style={[styles.sheet, styles.center, style]}>
      {glyph && (
        <Animated.View style={glyphStyle}>
          <BalloonMark size={26} color={accent.current} />
        </Animated.View>
      )}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  sheet: {
    position: 'absolute',
  },
  center: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
