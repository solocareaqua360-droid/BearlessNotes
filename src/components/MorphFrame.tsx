import { ReactNode, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, makeMutable, runOnJS, runOnUI, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { openMark } from '../utils/openTiming';
import { backMarkPop } from '../utils/perfWatch';
import { chromeAbort, chromeBackBegin, chromeEnd, chromeOpenArrive, chromeT } from '../utils/chromeMorph';
import { cardBand, measureCard, takeMorphFrom, whenLanded, type Rect } from '../utils/morph';
import { foldTransforms } from './foldGeometry';
import { captureRef, releaseCapture } from 'react-native-view-shot';
import { endPageFold, startPageFold } from '../utils/pageFold';

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
  // Not useSharedValue: that one stops its animation when the screen goes,
  // and on the way back the clock goes on after it - the page's picture
  // finishes the fold on it (components/PageFold).
  const [t] = useState(() => makeMutable(0));
  const shown = useSharedValue(0);
  // The card, in the frame's own coordinates, and the frame's size.
  const cx = useSharedValue(0);
  const cy = useSharedValue(0);
  const cw = useSharedValue(from.width);
  // The part of the card above its own line (utils/morph's band).
  const band = cardBand(morphKey);
  const ch = useSharedValue(from.height - band);
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
    // Two frames ON THE UI THREAD (2026-10-06): the one the note's commit is
    // mounted in, and the one it is painted in - then the page moves. They
    // used to be counted on the JS thread, which is busiest exactly then
    // (the note's effects, its next rows): 60-90 ms for two frames, a still
    // card after the tap. The UI thread is idle meanwhile.
    runOnUI(() => {
      'worklet';
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          shown.value = 1;
          t.value = withTiming(1, { duration: OUT_MS, easing: EASE });
        });
      });
    })();
    const began = Date.now() + 33;
    // The chrome's move ends the stand-in, not the page's: it may finish
    // a little later.
    chromeOpenArrive().then(() => {
      const left = Math.max(120, OUT_MS - (Date.now() - began));
      chromeT.value = withTiming(1, { duration: left, easing: EASE }, (finished) => {
        if (finished) runOnJS(endChrome)();
      });
    });
  };

  // Where the frame stands in the window. Asked straight away (the answer
  // is the shadow tree's, synchronous) rather than waiting for onLayout: the
  // layout event queues behind the note's own rendering and came 60-80 ms
  // after the note was drawn - and the growth waited for it (2026-10-06).
  const measureBox = () => {
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

  useEffect(() => {
    whenLanded(morphKey, () => {
      landed.current = true;
      if (box.current) start();
      else measureBox();
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
      // A growth that had not started yet must not start under the fold.
      started.current = true;
      const frame = box.current;
      // The page as it stands, photographed alongside the bar and the dock
      // (components/PageFold: the picture folds, the screen goes at once).
      const pagePicture = pageRef.current
        ? captureRef(pageRef.current, { format: 'jpg', quality: 0.92, result: 'tmpfile' }).catch(() => null)
        : Promise.resolve(null);
      const chromeCarried = chromeBackBegin();
      const release = (picture: string | null) => {
        if (!picture) return;
        try {
          releaseCapture(picture);
        } catch {
          // Already gone.
        }
      };
      // Once, whatever happens to the fold: an interrupted animation
      // (finished false) used to leave the note on the stack, unseen, with
      // the desks' bar waiting for it to go.
      let left = false;
      let carrying = false;
      const leave = () => {
        if (left) return;
        left = true;
        backMarkPop();
        shown.value = 0;
        navigation.dispatch(e.data.action as never);
        // The list's own chrome mounts with its focus, after the pop: the
        // stand-in waits for it before it goes.
        if (carrying) chromeEnd('list');
      };
      // The screen goes once the chrome's stand-in is settled one way or
      // the other (it covers the real chrome the pop changes).
      chromeCarried.then((c) => {
        carrying = c;
        // Left already (the safety below): the stand-in still goes.
        if (c && left) chromeEnd('list');
      });
      const leaveWhenChromeIs = () => {
        chromeCarried.then(leave);
      };
      measureCard(morphKey).then((card) => {
        if (!card || !frame) {
          pagePicture.then(release);
          chromeCarried.then((c) => {
            if (c) chromeAbort();
          });
          const pop = () => navigation.dispatch(e.data.action as never);
          shown.value = withTiming(0, { duration: 160 }, (finished) => {
            if (finished) runOnJS(pop)();
          });
          return;
        }
        cx.value = card.x - frame.x;
        cy.value = card.y - frame.y;
        cw.value = card.width;
        ch.value = card.height - band;
        // THE FOLD STARTS AT ONCE, on the page itself (2026-10-06). It used
        // to wait for the photographs below - 80-90 ms of a still page
        // after "back", every time (the phone's trace). The picture takes
        // over mid-way, on the same clock (`t`), so the two are the same
        // frame by frame and the hand-over cannot be seen.
        const began = Date.now();
        let folded = false;
        let foldId: number | null = null;
        const onFolded = () => {
          folded = true;
          if (foldId !== null) endPageFold(foldId);
          // Folded as itself, the page goes AT ONCE: the list's own card is
          // right under it, in the same place. It used to stay up until the
          // pop had been committed, and for that half second the folded page
          // stood where the card is and then blinked into it, taking every
          // tap meanwhile (2026-10-05).
          else leaveWhenChromeIs();
        };
        setLeaving(true);
        t.value = withTiming(0, { duration: BACK_MS, easing: EASE }, (finished) => {
          if (finished) shown.value = 0;
          runOnJS(onFolded)();
        });
        chromeCarried.then((c) => {
          if (!c) return;
          // The chrome catches up in what is left of the page's time.
          const remaining = Math.max(120, BACK_MS - (Date.now() - began));
          chromeT.value = withTiming(0, { duration: remaining, easing: EASE });
        });
        // THE PICTURE TAKES OVER, THE SCREEN GOES (components/PageFold). The
        // note's screen used to stay over the list for the whole fold and a
        // beat after it, taking the first tap meant for the list. Once the
        // picture stands where the page is, the page hides and the screen
        // is taken away under it; the list is live for the rest of the fold.
        pagePicture.then((picture) => {
          if (!picture) return;
          if (folded || left) {
            release(picture);
            return;
          }
          foldId = startPageFold({
            uri: picture,
            frame,
            card: { x: card.x - frame.x, y: card.y - frame.y, width: card.width, height: card.height - band },
            squareBottom: band > 0,
            sheetY: sheetY.value,
            t,
            // A frame after the picture has loaded: drawn, so hiding the page
            // under it changes nothing anyone can see.
            onShown: () => requestAnimationFrame(leaveWhenChromeIs),
          });
        });
        // And if nothing ever reports at all.
        setTimeout(leave, BACK_MS + 400);
      });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [navigation, morphKey]);

  // And again whenever the frame changes size (the Fold opened or closed).
  const onLayout = measureBox;

  // The move itself, in transforms only - see components/foldGeometry.
  const clip = useAnimatedStyle(() => {
    const g = foldTransforms(t.value, bw.value, bh.value, cx.value, cy.value, cw.value, ch.value, sheetY.value, band > 0);
    return { ...g.clip, opacity: shown.value };
  });
  // The page at its full size, scaled to the clip's width from its top
  // left corner - so what the card showed is what the page's top is.
  //
  // Not the whole screen into the card: the SHEET. The card's picture is
  // the sheet's top, so at the start the sheet's corner stands on the
  // card's corner and the sheet is the card's width; the ground around it
  // comes into view as the page grows.
  const page = useAnimatedStyle(() => {
    const g = foldTransforms(t.value, bw.value, bh.value, cx.value, cy.value, cw.value, ch.value, sheetY.value, band > 0);
    return { transform: g.page.transform };
  });

  return (
    <View ref={rootRef} style={StyleSheet.absoluteFill} onLayout={onLayout} collapsable={false} pointerEvents="box-none">
      <Animated.View style={[styles.clip, clip]} pointerEvents={leaving ? 'none' : 'auto'}>
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
