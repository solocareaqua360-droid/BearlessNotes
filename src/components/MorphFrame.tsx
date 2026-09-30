import { ReactNode, useEffect, useRef, useState } from 'react';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PAGE_SHEET_INSET } from './documentEditorStyles';
import { TOP_NAV_SPACE } from './TopNavBar';
import { unveilDock, veilDock } from '../utils/dockVeil';
import { measureCard, takeMorphFrom, whenLanded, type Rect } from '../utils/morph';

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
// The card's corner on the phone (DocumentCard's grid tile).
const CARD_RADIUS = 22;
// The editor's sheet's side inset on a phone.
const SHEET_X = PAGE_SHEET_INSET;
// What the page leaves above its title that the card's picture does not:
// the room kept clear for the capsules over the page (the editor's sheet
// pads PAGE_HEADER_TOP + TOP_NAV_SPACE + 12, DocumentPageMiniature's band
// is PAGE_HEADER_TOP + 12). Aligned on the sheet's own top, the page
// folding into its card still showed that empty band above the title, and
// the card that replaced it had none - the title jumped up by it at the
// last moment (2026-10-01). So the card's corner stands on the line the
// card's picture starts on, and the band stays outside the clip.
const PAGE_BAND_EXTRA = TOP_NAV_SPACE;
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
  const box = useRef<Rect | null>(null);
  const landed = useRef(false);
  const started = useRef(false);

  const start = () => {
    if (started.current || !landed.current || !box.current) return;
    started.current = true;
    shown.value = 1;
    t.value = withTiming(1, { duration: OUT_MS, easing: EASE });
    // The note's dock comes in with the page (it was veiled at the tap).
    unveilDock();
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
      // The note's dock steps aside as the page starts to fold, and the
      // list's comes back once the list is the screen again.
      veilDock();
      const leave = () => {
        navigation.dispatch(e.data.action as never);
        requestAnimationFrame(() => requestAnimationFrame(() => unveilDock()));
      };
      const frame = box.current;
      measureCard(morphKey).then((card) => {
        if (!card || !frame) {
          shown.value = withTiming(0, { duration: 160 }, (finished) => {
            if (finished) runOnJS(leave)();
          });
          return;
        }
        cx.value = card.x - frame.x;
        cy.value = card.y - frame.y;
        cw.value = card.width;
        ch.value = card.height;
        t.value = withTiming(0, { duration: BACK_MS, easing: EASE }, (finished) => {
          if (finished) runOnJS(leave)();
        });
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

  const clip = useAnimatedStyle(() => {
    const k = t.value;
    return {
      left: cx.value * (1 - k),
      top: cy.value * (1 - k),
      width: cw.value + (bw.value - cw.value) * k,
      height: ch.value + (bh.value - ch.value) * k,
      borderRadius: CARD_RADIUS * (1 - k),
      opacity: shown.value,
    };
  });
  // The page at its full size, scaled to the clip's width from its top
  // left corner - so what the card showed is what the page's top is.
  //
  // Not the whole screen into the card: the SHEET. The card's picture is
  // the sheet's top, so at the start the sheet's corner stands on the
  // card's corner and the sheet is the card's width; the ground around it
  // comes into view as the page grows.
  const page = useAnimatedStyle(() => {
    const k = t.value;
    const sheetW = bw.value - SHEET_X * 2;
    const s0 = sheetW > 0 ? cw.value / sheetW : 1;
    const s = s0 + (1 - s0) * k;
    return {
      width: bw.value,
      height: bh.value,
      left: -SHEET_X * s0 * (1 - k),
      top: -(sheetY.value + PAGE_BAND_EXTRA) * s0 * (1 - k),
      transform: [{ scale: s }],
    };
  });

  return (
    <View ref={rootRef} style={StyleSheet.absoluteFill} onLayout={onLayout} collapsable={false} pointerEvents="box-none">
      <Animated.View style={[styles.clip, clip]}>
        <Animated.View style={[styles.page, page]}>{children}</Animated.View>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  clip: {
    position: 'absolute',
    overflow: 'hidden',
  },
  page: {
    position: 'absolute',
    left: 0,
    top: 0,
    transformOrigin: 'left top',
  },
});
