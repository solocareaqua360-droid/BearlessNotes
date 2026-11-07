import { useEffect, useRef, useState } from 'react';
import { StyleSheet, useWindowDimensions } from 'react-native';
import Animated, { Easing, Extrapolation, interpolate, interpolateColor, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import BalloonMark from './BalloonMark';
import { softTokens } from '../theme/soft';
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
const SLOW_OUT_MS = 520;
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
  // The dock's own orange (theme/soft), the one the balloon wears there.
  const accent = useRef(softTokens(theme.scheme).accent);
  accent.current = softTokens(theme.scheme).accent;
  const x = useSharedValue(0);
  const y = useSharedValue(0);
  const w = useSharedValue(0);
  const h = useSharedValue(0);
  const r = useSharedValue(0);
  const o = useSharedValue(0);
  // THE ROUND JOURNEY (the AI's balloon, 2026-10-23: «натяку на коло немає» - the rounded rectangle went straight to the
  // screen's shape). `sp` 0 = the small thing, 1 = the sheet; up to the middle a true CIRCLE grows out of the small thing
  // and rises to the sheet's centre, from there the circle opens into the sheet. Used while `shaped` is 1.
  const shaped = useSharedValue(0);
  const sp = useSharedValue(0);
  const small = useSharedValue({ x: 0, y: 0, width: 0, height: 0 });
  const big = useSharedValue({ x: 0, y: 0, width: 0, height: 0 });
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
      shaped.value = 0;
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
    const roundTo = (from: Rect, to: Rect, toBig: boolean, ms: number, done: () => void) => {
      small.value = toBig ? from : to;
      big.value = toBig ? to : from;
      shaped.value = 1;
      sp.value = toBig ? 0 : 1;
      sp.value = withTiming(toBig ? 1 : 0, { duration: ms, easing: EVEN }, (finished) => {
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
      open(from, radius, tint, key, update, into, slow, turnTo, onStart) {
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
          // The balloon's sheet is there at once, in the very colour and shape of the circle it takes over (which then
          // hides under it): no fade-in, or for a frame neither was seen.
          if (slow) {
            o.value = 1;
            onStart?.();
          } else o.value = withTiming(1, { duration: COVER_MS });
          // A small round thing (the AI's balloon) grows on an even curve and a little longer: on the card's quick ease
          // it was full-size in the first ~100 ms and read as a flash, not as the circle opening (2026-10-23).
          // Its colour turns on the way, so the full screen is already the conversation's paper (no orange-to-white cut).
          if (turnTo) tc.value = withTiming(1, { duration: SLOW_OUT_MS, easing: EVEN });
          const opened = () => {
            update();
            land();
            setTimeout(() => morphLanded(key), LAND_WAIT_MS);
          };
          if (slow) roundTo(from, sheet.current, true, SLOW_OUT_MS, opened);
          else moveTo(sheet.current, SHEET_RADIUS, OUT_MS, opened);
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
      back(key, tint, leave, from, turnTo, onLanded) {
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
              const landed = () => {
                // Landed on the circle it came out of: that circle is put back under it, and the sheet goes.
                onLanded?.();
                afterPaint(() => fadeOut(COVER_MS));
              };
              if (key === 'assistant') {
                // The way out the same way in: the sheet closes into a circle, the circle shrinks onto the balloon.
                if (turnTo) tc.value = withTiming(1, { duration: SLOW_OUT_MS, easing: EVEN });
                roundTo(sheet.current, card, false, SLOW_OUT_MS, landed);
              } else {
                if (turnTo) tc.value = withTiming(1, { duration: BACK_MS, easing: EASE });
                moveTo(card, round, BACK_MS, landed);
              }
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
  const screenW = width;
  const style = useAnimatedStyle(() => {
    const bg = interpolateColor(tc.value, [0, 1], [from, to]);
    if (shaped.value === 1) {
      const a = small.value;
      const b = big.value;
      const k = sp.value;
      // The circle at the turn: as wide as the screen, standing on the sheet's centre.
      const D = screenW * 0.92;
      const acx = a.x + a.width / 2;
      const acy = a.y + a.height / 2;
      const bcx = b.x + b.width / 2;
      const bcy = b.y + b.height / 2;
      if (k < 0.5) {
        const t = k / 0.5;
        const d0 = Math.min(a.width, a.height);
        const d = d0 + (D - d0) * t;
        // Off the small thing's own shape (a capsule 56x52) into a circle within the first stretch.
        const round = Math.min(1, t * 3);
        const sw = a.width + (d - a.width) * round;
        const sh = a.height + (d - a.height) * round;
        const cx = acx + (bcx - acx) * t;
        const cy = acy + (bcy - acy) * t;
        return { left: cx - sw / 2, top: cy - sh / 2, width: sw, height: sh, borderRadius: Math.min(sw, sh) / 2, opacity: o.value, backgroundColor: bg };
      }
      const t = (k - 0.5) / 0.5;
      const ww = D + (b.width - D) * t;
      const hh = D + (b.height - D) * t;
      return {
        left: bcx - ww / 2,
        top: bcy - hh / 2,
        width: ww,
        height: hh,
        borderRadius: D / 2 + (SHEET_RADIUS - D / 2) * t,
        opacity: o.value,
        backgroundColor: bg,
      };
    }
    return { left: x.value, top: y.value, width: w.value, height: h.value, borderRadius: r.value, opacity: o.value, backgroundColor: bg };
  }, [from, to, screenW]);
  // The balloon: whole while the sheet is about its own size, gone by the time the sheet is a few times wider.
  const glyphStyle = useAnimatedStyle(() => {
    const k = shaped.value === 1 ? sp.value : interpolate(w.value, [64, 200], [0, 0.3], Extrapolation.CLAMP);
    return {
      opacity: interpolate(k, [0, 0.22], [1, 0], Extrapolation.CLAMP),
      transform: [{ scale: interpolate(k, [0, 0.3], [1, 1.6], Extrapolation.CLAMP) }],
    };
  });

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
    // Over the portal layer the dock lives in (GlassPortalHost is zIndex 1000): the sheet grows out of the dock and
    // folds back ONTO it, never behind it (the user, 2026-10-23).
    zIndex: 1001,
    elevation: 1001,
  },
  center: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
