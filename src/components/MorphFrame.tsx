import { ReactNode, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openMark } from '../utils/openTiming';
import { backFoldBegin, backMarkPop } from '../utils/perfWatch';
import { chromeAbort, chromeBackBegin, chromeEnd, chromeOpenArrive, chromeT } from '../utils/chromeMorph';
import { measureCard, takeMorphFrom, whenLanded, type Rect } from '../utils/morph';
import { foldTransforms } from './foldGeometry';
import { captureRef, releaseCapture } from 'react-native-view-shot';
import { startPageFold } from '../utils/pageFold';

// THE PAGE THAT GROWS OUT OF ITS CARD (utils/morph tells the whole story).
// Wraps a pushed note. Opened from a card, it lays the page out at its full
// size and shows it scaled down into the card's rectangle, clipped to the
// card's corners - the card's picture is the top of that very page, so the
// first frame looks like the card. Once the editor has drawn the note, the
// clip grows to the screen and the scale to 1. Back, the page shrinks into
// the card first and the screen goes after. Opened any other way, it is
// just its children.

const EASE = Easing.bezier(0.22, 1, 0.36, 1);
const OUT_MS = 360;
const BACK_MS = 300;
// The card's corner, the sheet's inset and the band above the title the
// card's picture does not have (the title used to jump up by it at the last
// moment, 2026-10-01) are in components/foldGeometry, with the move itself.
// The editor gets this long to draw the note before the page grows anyway.
const LAND_WAIT_MS = 900;

type Nav = {
  addListener: (event: 'beforeRemove', cb: (e: { preventDefault: () => void; data: { action: { type: string } } }) => void) => () => void;
  dispatch: (action: never) => void;
};

export default function MorphFrame({ morphKey, navigation, children }: { morphKey: string; navigation: Nav; children: ReactNode }) {
  // Taken once: a re-render must not find the card again.
  const [from] = useState(() => takeMorphFrom(morphKey));
  if (!from) return <>{children}</>;
  return (
    <Growing morphKey={morphKey} navigation={navigation} from={from}>
      {children}
    </Growing>
  );
}

function Growing({ morphKey, navigation, from, children }: { morphKey: string; navigation: Nav; from: Rect; children: ReactNode }) {
  // 0: in the card, 1: the whole screen.
  const t = useSharedValue(0);
  const shown = useSharedValue(0);
  // The card, in the frame's own coordinates, and the frame's size.
  const cx = useSharedValue(0);
  const cy = useSharedValue(0);
  const cw = useSharedValue(from.width);
  const ch = useSharedValue(from.height);
  // The window's size until the frame has measured its own: laid out at
  // 0 x 0 first, the editor would measure itself wrong (see the measured-
  // width lessons in this repo's memory).
  const window = useWindowDimensions();
  const bw = useSharedValue(window.width);
  const bh = useSharedValue(window.height);
  // Where the editor's sheet starts: below the status bar.
  const sheetY = useSharedValue(useSafeAreaInsets().top);
  const rootRef = useRef<View>(null);
  // The page itself, photographed on the way back (components/PageFold).
  const pageRef = useRef<View>(null);
  // On the way out: the page no longer takes taps (see the fold below).
  const [leaving, setLeaving] = useState(false);
  const box = useRef<Rect | null>(null);
  const landed = useRef(false);
  const started = useRef(false);

  const endChrome = () => {
    chromeEnd();
  };

  const start = () => {
    if (started.current || !landed.current || !box.current) return;
    started.current = true;
    openMark('landed');
    // The page moves AT ONCE. It used to wait while the note's own dock and
    // bar were photographed - 133 ms measured on the phone (2026-10-05), a
    // still screen after the tap. The list's pictures stay over the chrome
    // meanwhile, and the chrome catches up once its other end is there, in
    // what is left of the page's own time.
    openMark('moving');
    shown.value = 1;
    const began = Date.now();
    t.value = withTiming(1, { duration: OUT_MS, easing: EASE });
    // The chrome's move ends the stand-in, not the page's: it may finish
    // a little later.
    chromeOpenArrive().then(() => {
      const left = Math.max(120, OUT_MS - (Date.now() - began));
      chromeT.value = withTiming(1, { duration: left, easing: EASE }, (finished) => {
        if (finished) runOnJS(endChrome)();
      });
    });
  };

  useEffect(() => {
    whenLanded(morphKey, () => {
      landed.current = true;
      // The frame the note was committed in, and the one it is painted in.
      requestAnimationFrame(() => requestAnimationFrame(start));
    });
    const late = setTimeout(() => {
      landed.current = true;
      start();
    }, LAND_WAIT_MS);
    return () => clearTimeout(late);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [morphKey]);

  // Back: into the card, then the screen goes (its pop carries no slide).
  useEffect(() => {
    let passing = false;
    return navigation.addListener('beforeRemove', (e) => {
      if (passing) return;
      const type = e.data.action.type;
      if (type !== 'GO_BACK' && type !== 'POP') return;
      e.preventDefault();
      passing = true;
      backFoldBegin();
      // A growth that had not started yet must not start under the fold.
      started.current = true;
      const frame = box.current;
      // The page as it stands, photographed alongside the bar and the dock
      // (components/PageFold: the picture folds, the screen goes at once).
      const pagePicture = pageRef.current
        ? captureRef(pageRef.current, { format: 'jpg', quality: 0.92, result: 'tmpfile' }).catch(() => null)
        : Promise.resolve(null);
      Promise.all([measureCard(morphKey), chromeBackBegin(), pagePicture]).then(([card, carrying, picture]) => {
        // The list's own chrome mounts with its focus, after the pop: the
        // stand-in waits for it before it goes.
        // Once, whatever happens to the fold: an interrupted animation
        // (finished false) used to leave the note on the stack, unseen,
        // with the desks' bar waiting for it to go.
        let left = false;
        const leave = () => {
          if (left) return;
          left = true;
          backMarkPop();
          shown.value = 0;
          navigation.dispatch(e.data.action as never);
          if (carrying) chromeEnd('list');
        };
        if (!card || !frame) {
          if (picture) {
            try {
              releaseCapture(picture);
            } catch {
              // Already gone.
            }
          }
          if (carrying) chromeAbort();
          const pop = () => navigation.dispatch(e.data.action as never);
          shown.value = withTiming(0, { duration: 160 }, (finished) => {
            if (finished) runOnJS(pop)();
          });
          return;
        }
        cx.value = card.x - frame.x;
        cy.value = card.y - frame.y;
        cw.value = card.width;
        ch.value = card.height;
        // THE PICTURE FOLDS, THE SCREEN GOES NOW (components/PageFold). The
        // note's screen used to stay over the list for the whole fold and a
        // beat after it, taking the first tap meant for the list. Once the
        // picture stands where the page is, the page hides and the screen is
        // taken away under it; the list is live from the fold's first frame.
        if (picture) {
          setLeaving(true);
          startPageFold({
            uri: picture,
            frame,
            card: { x: card.x - frame.x, y: card.y - frame.y, width: card.width, height: card.height },
            sheetY: sheetY.value,
            // A frame after the picture has loaded: drawn, so hiding the page
            // under it changes nothing anyone can see.
            onShown: () => requestAnimationFrame(leave),
          });
          if (carrying) chromeT.value = withTiming(0, { duration: BACK_MS, easing: EASE });
          // And if the picture never arrives at all.
          setTimeout(leave, BACK_MS + 400);
          return;
        }
        // No picture: the page folds as itself, as before.
        // Folded, the page goes AT ONCE, on the UI thread: the list's own
        // card is right under it, in the same place. It used to stay up
        // until the pop had been committed - the editor taken down, the
        // list redrawn - and for that half second the folded page (the
        // note's own shade and edge fade) stood where the card is and then
        // blinked into it, taking every tap meanwhile (2026-10-05).
        t.value = withTiming(0, { duration: BACK_MS, easing: EASE }, (finished) => {
          if (finished) shown.value = 0;
          runOnJS(leave)();
        });
        // And if the animation never reports at all.
        setTimeout(leave, BACK_MS + 400);
        setLeaving(true);
        if (carrying) chromeT.value = withTiming(0, { duration: BACK_MS, easing: EASE });
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, morphKey]);

  const onLayout = () => {
    rootRef.current?.measureInWindow((x, y, width, height) => {
      if (!width || !height) return;
      const first = !box.current;
      box.current = { x, y, width, height };
      bw.value = width;
      bh.value = height;
      if (first) {
        cx.value = from.x - x;
        cy.value = from.y - y;
        start();
      }
    });
  };

  // The move itself, in transforms only - see components/foldGeometry.
  const clip = useAnimatedStyle(() => {
    const g = foldTransforms(t.value, bw.value, bh.value, cx.value, cy.value, cw.value, ch.value, sheetY.value);
    return { transform: g.clip.transform, borderRadius: g.clip.borderRadius, opacity: shown.value };
  });
  // The page at its full size, scaled to the clip's width from its top
  // left corner - so what the card showed is what the page's top is.
  //
  // Not the whole screen into the card: the SHEET. The card's picture is
  // the sheet's top, so at the start the sheet's corner stands on the
  // card's corner and the sheet is the card's width; the ground around it
  // comes into view as the page grows.
  const page = useAnimatedStyle(() => {
    const g = foldTransforms(t.value, bw.value, bh.value, cx.value, cy.value, cw.value, ch.value, sheetY.value);
    return { transform: g.page.transform };
  });

  return (
    <View ref={rootRef} style={StyleSheet.absoluteFill} onLayout={onLayout} collapsable={false} pointerEvents="box-none" nativeID="рамка-нотатки">
      <Animated.View style={[styles.clip, clip]} pointerEvents={leaving ? 'none' : 'auto'} nativeID="рамка-обріз">
        <Animated.View ref={pageRef} collapsable={false} style={[styles.page, page]}>
          {children}
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Both fill the frame; the animated transforms do the rest.
  clip: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    overflow: 'hidden',
    transformOrigin: 'left top',
  },
  page: {
    position: 'absolute',
    left: 0,
    top: 0,
    right: 0,
    bottom: 0,
    transformOrigin: 'left top',
  },
});
