import { useEffect, useRef, useSyncExternalStore } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { releaseCapture } from 'react-native-view-shot';
import { GlassPortal } from './GlassPortal';
import { foldTransforms } from './foldGeometry';
import { currentPageFold, endPageFold, subscribePageFold, type Fold } from '../utils/pageFold';

// THE PAGE FOLDING BACK INTO ITS CARD, AS A PICTURE (2026-10-06).
//
// The page used to fold as itself: the note's screen stayed on the stack for
// the whole fold and was taken away after it. For that time - the fold, and
// the moment the navigator needs to take the screen down - the screen lay
// over the list, invisible once the page had folded, and took every tap
// meant for the list: "перший тап не проходить". The phone's log showed it
// to the millisecond (lost taps 314-403 ms after the back press, the next
// one through).
//
// So the way back is done the way the phone's own apps do it: the page is
// photographed once, the picture folds into the card with exactly the
// numbers MorphFrame used, and the note's screen goes at once. The list is
// live under the picture from the first frame of the fold.
//
// The fold's geometry is MorphFrame's own, copied: the clip shrinks from
// the frame to the card's rectangle with the card's corner, and the page in
// it scales from 1 to the card's width over the sheet, from its top left.

const EASE = Easing.bezier(0.22, 1, 0.36, 1);
export const PAGE_FOLD_MS = 300;

function releaseQuietly(uri: string) {
  try {
    releaseCapture(uri);
  } catch {
    // Already gone.
  }
}

// Mounted once at the app's root, inside the portal host: in the portal at a
// low priority, so it stands over every screen (as the note's screen did)
// and under the top bar and the dock (as the note's screen did).
export default function PageFoldHost() {
  const fold = useSyncExternalStore(subscribePageFold, currentPageFold, () => null);
  if (!fold) return null;
  return (
    <GlassPortal priority={-5}>
      <Folding key={fold.id} fold={fold} />
    </GlassPortal>
  );
}

function Folding({ fold }: { fold: Fold }) {
  // Plain numbers for the worklets - a worklet takes in everything it names,
  // and `fold` carries a function.
  const fx = fold.frame.x;
  const fy = fold.frame.y;
  const fw = fold.frame.width;
  const fh = fold.frame.height;
  const cx = fold.card.x;
  const cy = fold.card.y;
  const cw = fold.card.width;
  const ch = fold.card.height;
  const sheetY = fold.sheetY;
  const squareBottom = fold.squareBottom;
  const id = fold.id;

  const t = useSharedValue(1);
  const started = useRef(false);
  const start = () => {
    if (started.current) return;
    started.current = true;
    fold.onShown();
    t.value = withTiming(0, { duration: PAGE_FOLD_MS, easing: EASE }, (finished) => {
      if (finished) runOnJS(endPageFold)(id);
    });
  };
  // A picture that never says it has loaded must not keep the note's screen
  // up: the fold starts anyway (the page has its own fallback, too).
  useEffect(() => {
    const timer = setTimeout(start, 250);
    const safety = setTimeout(() => endPageFold(id), PAGE_FOLD_MS + 1200);
    return () => {
      clearTimeout(timer);
      clearTimeout(safety);
      // The picture's file goes with it.
      releaseQuietly(fold.uri);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The same move as MorphFrame's, in transforms only (foldGeometry).
  const clip = useAnimatedStyle(() => {
    const g = foldTransforms(t.value, fw, fh, cx, cy, cw, ch, sheetY, squareBottom);
    return g.clip;
  });
  const page = useAnimatedStyle(() => {
    const g = foldTransforms(t.value, fw, fh, cx, cy, cw, ch, sheetY, squareBottom);
    return { transform: g.page.transform };
  });

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Animated.View style={[styles.clip, { left: fx, top: fy, width: fw, height: fh }, clip]}>
        <Animated.View style={[styles.page, page]}>
          <Image source={{ uri: fold.uri }} style={{ width: fw, height: fh }} fadeDuration={0} onLoad={start} />
        </Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    position: 'absolute',
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
