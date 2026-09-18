import { ReactNode, useLayoutEffect, useMemo, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleProp, StyleSheet, Text, View, ViewStyle, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue, withTiming, Easing } from 'react-native-reanimated';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { openCapture } from './CaptureWindow';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { BlurView } from 'expo-blur';
import Svg, { Circle } from 'react-native-svg';
import { useBlurTarget } from './GlassTarget';
import { GlassPortal } from './GlassPortal';
import { useTheme } from '../theme/ThemeProvider';
import { hapticButtonDown } from '../utils/haptics';
import { NAV_BOTTOM, NAV_BUTTON, NAV_PADDING } from '../constants/rail';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { DOCK_BOTTOM, dockCardHeight } from '../navigation/dockGeometry';
import { navigationRef } from '../navigationRef';
import {
  DockBead,
  DockFace,
  useNavDockActions,
  useNavDockBeads,
  useNavDockDesks,
  useNavDockFace,
  useNavDockHidden,
  useNavDockLeave,
  useNavDockOwnContext,
  useNavDockTabsInFlux,
  useNavDockTargets,
} from '../navigation/navDock';

// The dock, when it is holding a CONTEXT rather than the four desks.
//
// It used to live inside FloatingIslandTabBar, which was fine while the
// only screens with folders were tabs. They are not: files, photos,
// links, stickers, boards and the custom databases are all PUSHED over
// the tabs, so the tab bar - and with it the dock - is not drawn there at
// all. The path was being published to nobody, which is what the user
// reported as "док залишився старим" in every database but notes.
//
// So the context half of the dock stands on its own, above the whole app,
// and the tab bar stands aside while it is showing (see
// useNavDockHasContext). One control, drawn in one place, whatever screen
// is underneath.
// WHICH SCREEN IS IN FRONT, as one string.
//
// The dock does not stand inside the navigator - it is a sibling of it,
// drawn over everything - so useNavigationState has no navigator to ask.
// The container's own ref does, and it is the same ref on both builds.
// The screen you are actually looking at is the leaf at the end of the
// chain of active routes: the tab inside the stack inside the root.
function leafRouteKey(): string {
  if (!navigationRef.isReady()) return '';
  let state: any = navigationRef.getRootState();
  let key = '';
  while (state && typeof state.index === 'number' && state.routes?.[state.index]) {
    const route = state.routes[state.index];
    key = route.key;
    state = route.state;
  }
  return key;
}

function useScreenKey(): string {
  const [key, setKey] = useState(leafRouteKey);
  useEffect(() => {
    const read = () => setKey((prev) => {
      const next = leafRouteKey();
      return next === prev ? prev : next;
    });
    // The container may have settled between this render and the
    // subscription below.
    read();
    return navigationRef.addListener('state', read);
  }, []);
  return key;
}

const STRIP_ITEM = 38;
const STRIP_VISIBLE = 5;
const STRIP_WIDTH = STRIP_ITEM * STRIP_VISIBLE;
// The same blue the calendar's own history dot uses - a mark has to mean
// the same thing in both places or it means nothing in either.
const STRIP_MARK_ACCENT = '#60A5FA';
// How much of the card behind is visible. Samsung's own measure, read
// off the user's screenshots: a HINT, two or three points, not a band.
// At seven it read as a second capsule parked under the first rather
// than as the same object with more of itself behind.
const BEHIND_EDGE = 3;
// THE WHOLE STACK IS ONE NUMBER.
//
// `progress` says which ring position is in FRONT: 0, 1, 2... and
// fractions in between while a swipe is under way. Given that one
// number, this returns where the card with fixed ring index `i` stands.
// Nothing else feeds it - not which face React thinks is showing, not
// which slot a card is mounted in - so there is nothing for it to
// disagree with.
//
//   slot 0  the front card, full size, in place
//   slot 1  one card back: a little smaller, a little lower
//   slot k  k cards back, the same step again
//
// The card LEAVING the front (rel === 0) does not slide back through
// the others - it rises in an arc, clears the dock's top edge, and comes
// down onto the deepest slot, passing behind whatever is climbing past
// it. Every other card simply steps one slot forward.
//
// Two properties make this race-proof, and both are why it is written
// this way. It is CONTINUOUS at every whole number: a card's place as
// progress approaches k+1 from below is exactly its place at k+1. And it
// is PERIODIC: progress 2 and progress 0 in a ring of two give every
// card the same place, to the pixel. So resetting progress to the front
// card's index - whenever React gets round to it - cannot be seen.
const BACK_SCALE = 0.94;
const BACK_Y = 10;
// How high the departing card rises at the peak of its arc. A full card
// height: short of that the drag never visibly clears the dock's own top
// edge - "картка навіть не дотягується до верхнього краю дока".
const RISE_F = 1.0;
// `eps` alternates between 0 and a hundredth of a point. It exists to
// be READ - see `tick` at the call site - and is far too small to see.
function slotTransform(i: number, f: number, n: number, cardH: number, eps: number) {
  'worklet';
  const k = Math.floor(f);
  const t = f - k;
  const rel = (((i - k) % n) + n) % n;
  let slot: number;
  let y: number;
  if (rel === 0) {
    const deepest = Math.max(1, n - 1);
    slot = t * deepest;
    y = -Math.sin(Math.min(1, t) * Math.PI) * cardH * RISE_F + slot * BACK_Y;
  } else {
    slot = rel - t;
    y = slot * BACK_Y;
  }
  return {
    transform: [{ translateY: y + eps }, { scale: Math.pow(BACK_SCALE, slot) }],
    zIndex: Math.round((n - slot) * 10),
  };
}
// The dock is made of the TAGS DRAWER'S material - and now literally of
// its LAYERS, not of GlassDrop dressed up to look like it. The drawer is
// two flat things: a BlurView at 60, tinted dark in every theme, and a
// View of the theme's surface colour over it, clipped by a rounded
// parent. GlassDrop paints its body as an SVG rectangle instead, and
// two things went wrong with that here: at full strength it was solid
// (white in the white theme, black in the black), and a bead's bottom
// point kept going missing under it. Frost, below, is the drawer's own
// construction with one deliberate difference - the tint is never
// opaque, whatever the theme's surface is, because a dock that is a
// solid slab is not frosted glass in any theme.
const FROST_BLUR = 60;
const FROST_TINT = 0.55;
// The lighter mark on the thing you are on.
const HERE_FILL = 'rgba(255,255,255,0.16)';
// How much smaller than its own button the "here" circle sits. At the
// button's own size its rim ran right up to the card's top and bottom
// edge - the exact edge the card BEHIND this one peeks out through when
// it is the one sliding back, so the rim was the first thing that
// sliver showed: "видно краю... біле коло вибраного екрану". Pulled in
// a few points, its rim clears the card's own edge with room to spare,
// whichever card this happens to be.
const HERE_SHRINK = 6;
// Sizes as FRACTIONS OF THE SCREEN'S WIDTH, read off the reference and
// our own dock side by side at the same pixel scale. Not points: every
// guess at this phone's density was wrong, and a dock sized in points
// came out a fifth too small every time - "я не знаю чому у тебе
// проблеми з розмірами". Fractions cannot be wrong about density.
//   bead diameter    0.111   capsule height   0.148 (a third taller)
//   bead-to-capsule  0.037   edge to bead     0.076
// The way out inside the card: a chevron and a hairline - said in points.
const LEAVE_W = 36;
const BEAD_F = 0.111;

const GAP_F = 0.037;
const INSET_F = 0.076;
const CARD_PAD = 2;
// ...but of a PHONE's width, never of whatever screen this happens to be.
// A fraction of the screen is the right answer to "how big on a phone"
// and the wrong answer to "how big on a screen twice as wide": the dock
// is held in a thumb, and a thumb is the same size on a fold as on a
// phone. Unfolded, it came out nearly twice the size - "виглядає
// аномально великим... на великому екрані він буде капець яким
// аномально большим". Above this width the dock simply stops growing
// and stands centred, which is also what it should do in landscape,
// where the width is enormous and the height is not.
// 430 is wider than any phone in portrait, so no phone is touched.


export default function ContextDock() {
  const theme = useTheme();
  const { width: windowW } = useWindowDimensions();
  const CARD_H = dockCardHeight(windowW);
  const screenW = Math.min(windowW, 430);
  const BEAD = Math.round(screenW * BEAD_F);
  const CARD_BUTTON = CARD_H - CARD_PAD * 2;
  const GAP = Math.round(screenW * GAP_F);
  const EDGE_INSET = Math.round(screenW * INSET_F);
  // The row's width is SAID, not left to flex: it was settling at
  // three-quarters of the screen and nobody could tell why. On a screen
  // wider than a phone this is narrower than the window, and the wrap
  // below centres it.
  const rowWidth = screenW - EDGE_INSET * 2;
  // And so is the CARD'S. Left to flex it hugged its content - one
  // folder deep the path card shrank to a single word and the whole row
  // bunched up on the left. A card is four buttons wide whatever it
  // holds: the width between the beads, every time, on every screen.
  const cardWidth = rowWidth - BEAD * 2 - GAP * 2;
  // A desk button is the biggest circle FOUR of which fit in the card
  // side by side - and never more than the card's own inner height.
  // At full card height, four of them were a few points wider than the
  // card, so the last desk's circle stood closer to the capsule's end
  // than its own radius and the capsule's rounded end took a bite out
  // of it: "обрізана, як неповна фаза місяця". A circle is whole inside
  // a capsule as long as its centre is no nearer the end than its
  // radius; laid edge to edge from the card's inner padding, the first
  // and last centres sit exactly where the capsule's own caps are.
  // Every radius is SAID as half the size, never left as 999. Android
  // works a "999" out from the size it knows at the moment it draws the
  // background, and on the first frame that size was not there yet -
  // the "you are here" disc came up a square with rounded corners and
  // stayed one until the next render happened to redraw it (the first
  // swipe). Half of a number the view already has cannot be early.
  const dims = {
    bead: { width: BEAD, height: BEAD, borderRadius: BEAD / 2 },
    card: { height: CARD_H, borderRadius: CARD_H / 2 },
    button: { width: CARD_BUTTON, height: CARD_BUTTON, borderRadius: CARD_BUTTON / 2 },
    rowHeight: { height: CARD_BUTTON, borderRadius: CARD_BUTTON / 2 },
  };
  const insets = useSafeAreaInsets();
  // NEVER LOWER THAN THE BEST READING SEEN. Android's own insets can
  // under-report `bottom` for a frame or two right after a screen
  // change - not this app's measurement, the platform's - and every
  // screen shares this one dock, so a dip on ANY screen briefly drags
  // it down everywhere: "док... опущений трохи нижче... сіпається
  // вниз... а коли знову на інші столи, то док передає їм своє
  // положення". A monotonic maximum cannot be wrong in the direction
  // that shows: it can only ever hold the dock at the best position
  // already confirmed, never invent a new one.
  const stableBottomRef = useRef(insets.bottom);
  if (insets.bottom > stableBottomRef.current) stableBottomRef.current = insets.bottom;
  const bottomInset = stableBottomRef.current;
  // Three cards, and they are three because of the one thing a
  // navigation dock must never do: the desks used to vanish the moment
  // you stepped into a folder or opened the calendar - "навігація між
  // столами пропадає зовсім". They are a card of their own now, so
  // wherever you are, where else you could be is one swipe away.
  const ownPublished = useNavDockOwnContext();
  const desksCard = useNavDockDesks();
  const [hidden] = useNavDockHidden();
  // See FloatingIslandTabBar and navDock's own comment on `tabsInFlux`:
  // for the one beat a swipe's settle has not yet reached
  // react-navigation, whatever is published here can still be the
  // PREVIOUS screen's - the desks card is the only thing in the stack
  // that is already correct that instant, being driven by the pager's
  // own live position rather than by focus. Standing on it, rather than
  // on a stale context, is what used to read as the dock sitting into
  // an extra sliver that should not have been there: "док... опущений
  // трохи нижче... і тому... сіпається вниз", only ever after a swipe.
  const tabsInFlux = useNavDockTabsInFlux();
  // A settling window was tried here and was a mistake of its own: it
  // held BOTH the context and the actions back for 150ms after a
  // screen change, which made the ring fall from two cards to one and
  // climb back - the user's log caught it exactly, `+0ms desks/2/1/-/4`
  // then `+0ms desks/1/0/-/0` then `+157ms desks/2/1/-/4`. The first
  // render after the screen changed was ALREADY correct; the collapse
  // after it was mine. Removed.
  const screenKey = useScreenKey();
  const suppress = tabsInFlux;
  const own = suppress ? null : ownPublished;
  const dock = hidden ? desksCard : (own ?? desksCard);
  // The way out of the SCREEN, which is true even at a database's root,
  // where there is no path to show. The user's own ask: standing in a
  // database, the way back to the databases was the small arrow in the
  // top-right corner of the rail, and it belongs under the thumb.
  const leave = useNavDockLeave();
  // The other card in the stack: what this screen can DO. Two capsules,
  // one behind the other, swapped with a light swipe - the user's own
  // reference, a Samsung lock screen, and the shape it keeps: the back
  // one shows only an EDGE, both are the same size in the same place,
  // and whatever stands beside the stack does not move at all.
  const actionsPublished = useNavDockActions();
  const actions = suppress ? null : actionsPublished;
  // What never changes stands beside the stack and does not move: search
  // on the left, creating on the right. The user's own arrangement, and
  // Samsung's own reasoning - a pile of cards is for what changes.
  const beads = useNavDockBeads();
  // Lives in the provider now - a screen has to be able to ask for the
  // path back when an action finishes somewhere else.
  const [face, setFace] = useNavDockFace();
  // Which card a screen OPENS on. A path is worth seeing straight away -
  // it says where in the database you are standing. A calendar's days
  // are not: the calendar itself is already on the screen above, so the
  // dock is better spent saying where else you could go. With no
  // context of its own - a database's root, the boards list - the
  // screen opens on the DESKS.
  //
  // Cleared of blame by the user's own test: disabled outright, every
  // remaining bug stayed exactly as present as before. Restored as it
  // was; whatever is left lives somewhere else in this file.
  const opensOn: DockFace = !own ? 'desks' : own.kind === 'strip' ? 'desks' : 'context';
  // The cards this screen actually has, in the order they are wanted:
  // what you are in, what you can do in it, where else you could be. A
  // card with nothing on it is not a card and is simply not in the ring.
  const faces: DockFace[] = [
    ...(own ? (['context'] as DockFace[]) : []),
    ...(actions?.length ? (['actions'] as DockFace[]) : []),
    ...(desksCard ? (['desks'] as DockFace[]) : []),
  ];
  // When the card asked for is not in this screen's ring, fall back to
  // where you could go before what you could do - never land someone on
  // the options by accident.
  const showing: DockFace = faces.includes(face)
    ? face
    : faces.includes('desks')
      ? 'desks'
      : (faces[0] ?? 'context');
  // The two numbers the whole stack is drawn from: how many cards it
  // holds, and which of them is in front.
  const ringSize = Math.max(1, faces.length);
  const faceIndex = Math.max(0, faces.indexOf(showing));
  // ONE gesture, not a new one per render. A fresh Gesture object hands
  // GestureDetector a new configuration on every render, and a gesture
  // being reconfigured is a gesture that never activates - the same
  // thing that stopped the reference drag dead two days ago. It was
  // being rebuilt here on every render of a dock that re-renders
  // constantly, which is why the swipe did not exist at all.
  // Read through a ref inside the gesture, which is built once: the
  // gesture must not be rebuilt when the face changes, or it stops
  // activating (the whole reason the swipe did not exist at first).
  // Read through a ref inside the gesture, which is built once: the
  // gesture must not be rebuilt when the face changes, or it stops
  // activating.
  const faceRef = useRef(face);
  faceRef.current = face;
  // Keyed on the SCREEN and on the CONTEXT, because neither alone is
  // early enough or reliable enough on its own. The screen key is read
  // off the navigation state through a subscription and can arrive a
  // frame late; the context (what `own` actually is) is usually
  // available on the very first render of the new screen, but two
  // screens can carry the same KIND of context under the same icon -
  // files and photos both open on a path with a database's glyph - and
  // then it alone never changes between them. A layout effect, so this
  // lands before the frame is shown rather than after it.
  const contextKey = dock ? `${dock.kind}:${dock.icon}` : '';
  useLayoutEffect(() => {
    setFace(opensOn);
  }, [screenKey, contextKey, opensOn, setFace]);
  const facesRef = useRef(faces);
  facesRef.current = faces;
  const cardHRef = useRef(CARD_H);
  cardHRef.current = CARD_H;
  // WHERE THE CARDS STAND, AND WHO IS ALLOWED TO SAY SO.
  //
  // Two facts about this file, both learned the hard way:
  //
  // 1. A card's place must be a function of ONE number, not of two
  //    things that have to agree. Fixed FRONT and BACK slots whose
  //    contents React swapped while a shared value swapped their
  //    positions could never be made simultaneous, and every frame
  //    where only one had landed drew the pair inverted. So the ring is
  //    mounted once, nothing ever moves in the tree, and slotTransform
  //    places every card from a single position.
  //
  // 2. A Reanimated style CANNOT land in the same commit as the content
  //    beside it. useAnimatedStyle computes its inline value exactly
  //    once, on the first render; every change after that reaches the
  //    view from the UI thread, through a mapper started in an effect.
  //    So anything React changes in a commit - which cards exist, which
  //    of them is in front - is on screen a frame before an animated
  //    style that was supposed to change with it. That is what made the
  //    dock flash when switching desks: the new screen's ring and front
  //    card arrived, and the transform saying where they stand arrived
  //    after.
  //
  // Hence: AT REST THE ANIMATED STYLE IS NOT THERE AT ALL. A resting
  // card's place is a plain style, computed right here, and it lands
  // with everything else in the same commit - a desk switch has nothing
  // left to race. The animated style is attached only while a swipe is
  // actually running, and both hand-overs are between two descriptions
  // of the SAME picture:
  //
  //   on   the gesture freezes the front index into dragBase and starts
  //        from drift 0, so the animated placement it attaches with is
  //        pixel-for-pixel the resting one it replaces
  //   off  the swipe ends at dragBase + 1, the face is committed, and
  //        only once React is actually holding the new front card does
  //        the animated style come off - and dragBase + 1 is that new
  //        card's resting place, in a ring, to the pixel
  //
  // Neither hand-over can be seen whichever frame it lands on, which is
  // the only property that has ever made this stop flickering.
  const progress = useSharedValue(0);
  const dragBase = useSharedValue(0);
  // Read from the UI thread, so shared values rather than refs - a ref
  // read inside a worklet is frozen at the value it had when the worklet
  // was built.
  // WHAT THE CARDS ARE PLACED FROM, AND WHY IT IS NO LONGER A MIRROR.
  //
  // The resting numbers - which card is in front, how many there are,
  // how tall one is - used to be copied into shared values for the
  // worklets to read. Every copy is a chance to be out of step, and the
  // debug strip caught exactly that: the assertion logged `SET p=2 n=3`
  // while the strip, in the same breath, read back 0/1 and then 1/2 -
  // the ring's own sizes from earlier in the screen's loading, arriving
  // late and in order. The drawing was always faithful to those
  // numbers; the numbers were behind React.
  //
  // So they are not copied any more. They are ORDINARY VALUES, baked
  // into the worklets and listed as their dependencies, which is what
  // makes Reanimated rebuild the worklets when React changes its mind.
  // Nothing to fall behind, because nothing is being mirrored.
  //
  // One shared value is left, and only a finger moves it: `progress`,
  // the live position while a swipe runs. `gesture` says when to listen
  // to it. At the moment a swipe finishes, progress sits at the front
  // index plus one, which in a ring IS the new front index - so letting
  // go of it and falling back on React's own number changes nothing
  // that can be seen.
  const gesture = useSharedValue(0);
  // THE RESTING NUMBERS, AS SHARED VALUES AGAIN - but written a
  // different way than the mirrors this file tore out.
  //
  // Baking `faceIndex`/`ringSize`/`CARD_H` straight into the worklet as
  // closure values, declared as useAnimatedStyle's own dependencies,
  // fixed which card gets CHOSEN - the log settled that, one line per
  // screen, no more re-choosing. It left one frame of lag in the
  // PLACEMENT, because a change to those dependencies makes
  // useAnimatedStyle rebuild its worklet inside its own internal
  // useEffect - an ordinary one, which Reanimated owns and this file
  // cannot turn into a layout effect - and an ordinary effect runs
  // after the frame is painted.
  //
  // The fix tried next put the same numbers in a plain sibling style,
  // reasoning that React's own commit would win by sitting last in the
  // array. It could not: once an animated style is present on a view,
  // Reanimated owns that view's transform outright, writing to it
  // imperatively from the UI thread - a plain style in the same array
  // is not in a fight it can win, "last" or not. It did not fix the
  // lag and it broke the dock outright, disappearing on a plain side
  // swipe that never touched the dock's own gesture at all.
  //
  // So: shared values once more, but WRITTEN from a layout effect that
  // runs on every render, no dependency list, so nothing about writing
  // them ever depends on noticing a change. A shared value's write from
  // the JS thread reaches the UI thread's own mapper synchronously -
  // that cross-thread reactivity is the whole reason Reanimated's
  // shared values exist, and it is not gated behind any React effect
  // timing. The worklets below read ONLY shared values, never a JS
  // closure number, so there is no second effect anywhere left to lag
  // behind the first.
  const restIndexSV = useSharedValue(0);
  const ringRestSV = useSharedValue(1);
  const cardHRestSV = useSharedValue(0);
  useLayoutEffect(() => {
    restIndexSV.value = faceIndex;
    ringRestSV.value = ringSize;
    cardHRestSV.value = CARD_H;
  });
  // A hard limit on how long a swipe may speak for the placement. Every
  // long-lived bug here has been a flag raised by one callback and
  // lowered by another that had a way of never running.
  const backstop = useRef<ReturnType<typeof setTimeout> | null>(null);
  const armBackstop = (ms: number) => {
    if (backstop.current) clearTimeout(backstop.current);
    backstop.current = setTimeout(() => {
      backstop.current = null;
      gesture.value = 0;
      setSwiping(false);
    }, ms);
  };
  useEffect(
    () => () => {
      if (backstop.current) clearTimeout(backstop.current);
    },
    []
  );
  // TEMPORARY - see the debug strip.
  const dockTrail = useRef<{ t0: number; lines: string[]; last: string }>({ t0: Date.now(), lines: [], last: '' });
  const logDock = (line: string) => {
    if (line === dockTrail.current.last) return;
    dockTrail.current.last = line;
    dockTrail.current.lines = [...dockTrail.current.lines, `+${Date.now() - dockTrail.current.t0}ms ${line}`].slice(-6);
  };
  const restStyles = [0, 1, 2].map((i) => slotTransform(i, faceIndex, ringSize, CARD_H, 0));
  // TEMPORARY - a rolling log of what the dock decided, and when,
  // measured from the moment the screen changed. The two seconds in
  // question are hard to photograph; this way one screenshot taken
  // afterwards carries the whole sequence. Out with the strip above it.
  const screenKeyPrev = useRef(screenKey);
  if (screenKeyPrev.current !== screenKey) {
    screenKeyPrev.current = screenKey;
    dockTrail.current = { t0: Date.now(), lines: [], last: '' };
  }
  logDock(`${showing}/${ringSize}/${faceIndex}/${own ? own.kind : '-'}/${actions?.length ?? 0}`);
  // Three, always: the ring is at most three cards, and a hook cannot be
  // called in a loop whose length changes between renders.
  const slot0 = useAnimatedStyle(() =>
    slotTransform(
      0,
      gesture.value ? progress.value : restIndexSV.value,
      ringRestSV.value,
      cardHRestSV.value,
      0
    )
  );
  const slot1 = useAnimatedStyle(() =>
    slotTransform(
      1,
      gesture.value ? progress.value : restIndexSV.value,
      ringRestSV.value,
      cardHRestSV.value,
      0
    )
  );
  const slot2 = useAnimatedStyle(() =>
    slotTransform(
      2,
      gesture.value ? progress.value : restIndexSV.value,
      ringRestSV.value,
      cardHRestSV.value,
      0
    )
  );
  const slotStyles = [slot0, slot1, slot2];
  // The one moment a swipe stops speaking for the placement: the render
  // where React's own index has caught up with where the swipe left
  // off. In a ring those two are the same position, so nothing moves.
  useLayoutEffect(() => {
    gesture.value = 0;
  }, [faceIndex, ringSize, gesture]);
  // Whether the animated style is attached at all.
  const [swiping, setSwiping] = useState(false);
  const faceIndexRef = useRef(faceIndex);
  faceIndexRef.current = faceIndex;
  // The gesture is built once, so everything it reaches has to be
  // reachable through something whose identity never changes.
  const commitRef = useRef<(f: DockFace) => void>(() => {});
  commitRef.current = setFace;
  const hand = useMemo(
    () => ({
      // A swipe has begun: pin the animated placement to exactly where
      // the cards are resting, then let it take over.
      begin: () => {
        dragBase.value = faceIndexRef.current;
        progress.value = faceIndexRef.current;
        gesture.value = 1;
        setSwiping(true);
        armBackstop(4000);
      },
      // The finger has already lifted, whichever way this resolves -
      // said here, in `onEnd` itself, rather than waited for out of
      // either outcome below. It used to live inside `commit`/`done`,
      // each reached only from ITS OWN withTiming callback's `finished`
      // - true exactly when NOTHING interrupted that animation. A
      // finger lifting and the screen changing underneath it in the
      // same beat both count as "the animation is now pointless", and
      // BOTH cancel it (a plain `.value = x` write, which the safety
      // net below performs, does exactly that) - which means `finished`
      // comes back false and NEITHER callback ever ran. That is the
      // whole bug: `swiping` stayed true and `progress` stayed frozen
      // at wherever the animation was cut off, on a screen the ring
      // might not even still have that face in - "док... опуститься,
      // якщо гортати доки на сусідніх столах", fixed only by the very
      // next swipe, because starting one is the one thing here that
      // writes `progress` unconditionally. Ending the drag here, before
      // either branch even starts its animation, means the safety net
      // is already armed for the whole time that animation runs - so a
      // screen change during it is corrected on its own next render,
      // not left for a swipe that may not come for a while.
      end: () => {
        // The release animation starts right after this returns, and
        // lasts 220 or 260ms. 600 is the outside edge of that.
        armBackstop(600);
      },
      // `setSwiping(false)` here is UNCONDITIONAL, not a response to
      // `setFace` having changed anything - `setFace(next)` is a no-op,
      // scheduling no render at all, exactly when `face` already held
      // `next` (the sticky-desks reset on a screen change can leave it
      // there on its own). A no-op is silent: nothing else was ever
      // going to ask for another render on its behalf, so this is the
      // one call in the whole cycle that is not allowed to depend on
      // anything else having worked.
      // The swipe ended on a NEW card. `gesture` is NOT lowered here:
      // progress is sitting at the old index plus one, and React does
      // not hold the new index yet, so handing the placement back this
      // instant would put the cards one step behind for a frame. The
      // layout effect below lowers it, on the render that actually has
      // the new index.
      commit: (next: DockFace) => {
        if (backstop.current) clearTimeout(backstop.current);
        commitRef.current(next);
        setSwiping(false);
      },
      // Nothing was committed: progress came back to the index React
      // already holds, so letting go of it changes nothing.
      settle: () => {
        if (backstop.current) clearTimeout(backstop.current);
        gesture.value = 0;
        setSwiping(false);
      },

    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  // THE SAFETY NET. Whatever `faceIndex` the CURRENT screen's ring
  // actually resolves to - for any reason: a screen change, a commit
  // that landed, a commit that turned out to be a no-op because `face`
  // already held that value - is where the dock belongs, full stop.
  // Runs on every render `faceIndex` changes, which is every render
  // that could possibly need this, UNLIKE waiting on `showing` to
  // change (the earlier design): `setFace` is React state, and setting
  // it to a value it already holds schedules no re-render at all - so
  // an effect keyed on the state that update was supposed to produce
  // could wait forever for a render that was never coming. `faceIndex`
  // has no such trap: it is a plain value computed fresh every render,
  // never state, so there is no value it can equal that suppresses the
  // next render, and this effect never has a target it can miss.

  const swipe = useMemo(
    () =>
      Gesture.Pan()
        // Strictly vertical, and it gives up the moment it reads as
        // sideways: the capsule under it scrolls horizontally (the days,
        // the path), and that has to keep working.
        .activeOffsetY([-10, 10])
        .failOffsetX([-16, 16])
        .runOnJS(true)
        // UP only, and every swipe swaps them - the user's own
        // correction, and Samsung's own behaviour: a stack of two is a
        // cycle, so there is nothing to remember about which way is
        // which. Down does nothing on purpose; it is the direction the
        // system itself uses just below here.
        // ALWAYS runs, where onEnd does not: a gesture the pager takes
        // over mid-drag is cancelled, not ended. The finger flag is what
        // holds off the assertion above, so it is not allowed to depend
        // on a callback that has any way of being skipped.


        .onStart(() => {
          // On ACTIVATION, not on touch-down: the animated style only
          // needs to exist once something is actually being dragged.
          hand.begin();
        })
        .onUpdate((e) => {
          if (facesRef.current.length < 2) return;
          // Capped EXACTLY at the peak (0.5) - past that point the arc
          // itself starts coming back DOWN, and a live drag was doing
          // that on its own, without release, the moment the finger
          // crossed the midpoint: "я не дотягнув догори, воно вже
          // перелиснуло". A drag may only ever RISE; the descent onto
          // the back spot happens on release, never mid-drag.
          const dragged = Math.max(0, -e.translationY) / cardHRef.current;
          progress.value = dragBase.value + Math.min(0.5, dragged);
        })
        .onEnd((e) => {
          const ring = facesRef.current;
          // A real swipe, not a nudge - distance OR a fast enough flick,
          // same as any carousel. Short of two cards there is nothing to
          // cycle to.
          const committed = ring.length >= 2 && (e.translationY < -40 || e.velocityY < -600);
          hand.end();
          if (committed) {
            hapticButtonDown();
            const at = ring.indexOf(faceRef.current);
            const next = ring[(at + 1) % ring.length] ?? ring[0];
            // Carry the SAME arc on to its end - down onto the back
            // spot - THEN swap, once both cards have actually arrived
            // where a swap would be invisible, rather than mid-flight.
            // If the ring changes under this before it finishes, the
            // safety net above corrects `progress` and `swiping` on its
            // own next render - this callback running or not running is
            // no longer the only way either of those gets set right.
            progress.value = withTiming(
              dragBase.value + 1,
              { duration: 260, easing: Easing.inOut(Easing.cubic) },
              (finished) => {
                // Interrupted or not, SOMETHING here has to ask React
                // for a render - `commit` on the normal path, `settle`
                // when this animation was cut short by a fresh gesture
                // or a screen change taking `progress` for itself
                // before this one finished. Either call ends with the
                // same unconditional `setSwiping(false)`.
                if (finished) runOnJS(hand.commit)(next);
                else runOnJS(hand.settle)();
              }
            );
          } else {
            progress.value = withTiming(
              dragBase.value,
              { duration: 220, easing: Easing.out(Easing.cubic) },
              () => runOnJS(hand.settle)()
            );
          }
        }),
    []
  );

  // A card being carried can step onto a crumb - the same registry the
  // folder rows use, handed up by whichever screen is carrying.
  const targets = useNavDockTargets();

  const trail = own?.kind === 'path' ? own : null;
  const strip = own?.kind === 'strip' ? own : null;
  const desks = desksCard?.kind === 'desks' ? desksCard : null;
  const trailRef = useRef<ScrollView>(null);
  const stripRef = useRef<ScrollView>(null);

  const depth = trail?.crumbs.length ?? 0;
  useEffect(() => {
    if (!depth) return;
    // Deeper means further right, and the deepest is where you are.
    const id = setTimeout(() => trailRef.current?.scrollToEnd({ animated: true }), 0);
    return () => clearTimeout(id);
  }, [depth]);

  // The day you are on sits under your thumb, in the middle - a scrubber
  // you have to hunt along is not a scrubber. It SLIDES there: the days
  // either side stay mounted just off the edge.
  const stripIndex = strip ? strip.items.findIndex((item) => item.key === strip.selected) : -1;
  const stripSettled = useRef(false);
  const [stripWidth, setStripWidth] = useState(STRIP_WIDTH);
  // Where the strip has to be so the day you are on is in the middle.
  const stripOffsetFor = (width: number) =>
    Math.max(0, stripIndex * STRIP_ITEM + STRIP_ITEM / 2 - width / 2);
  // Centred on every SHOWING, not only on every change of day. The days
  // card is unmounted while the desks or the actions are in front, and a
  // scroller that has just been mounted starts at zero - the first day of
  // the run, the 25th of last month - while the day you are on has not
  // changed at all, so nothing else asked for a scroll: "показує умовний
  // початок відліку, а не нашу поточну дату посередині".
  useEffect(() => {
    if (stripIndex < 0) {
      stripSettled.current = false;
      return;
    }
    const x = stripOffsetFor(stripWidth);
    // The first placement is not a journey - opening the calendar should
    // not show the strip travelling in from the first of the month.
    const animated = stripSettled.current;
    stripSettled.current = true;
    const id = setTimeout(() => stripRef.current?.scrollTo({ x, animated }), 0);
    return () => clearTimeout(id);
  }, [stripIndex, stripWidth]);

  if (!dock && !leave && !actions?.length && !beads.left && !beads.right) return null;

  // The way out, as a bead of its own beside the pill rather than a
  // button inside it - the user's own call: inside, it read as an eighth
  // day and had to be aimed at. It carries what this context IS, so it
  // says where it takes you.
  //
  // For folders, leaving the context and walking out to the root are the
  // same move, and the context ends itself when the root is reached. A
  // calendar has no root to walk to, so there it is simply put away.
  // One bead, stepping out one level at a time - the same ladder the
  // note's back arrow walks. Inside folders it walks to the root; at the
  // root it leaves the database altogether; a calendar, which has no
  // root, is simply put away.
  // The bead only appears where it has a job NOBODY ELSE has. Inside
  // folders it had none: it walked to the root, and so does the first
  // crumb - "дві кнопки одна функція це невірно", and the user was
  // right. There the path stands alone, and its first crumb is the
  // database's own icon rather than the word "Всі", so one press still
  // means one thing and the dock still says WHICH database you are
  // walking in. At the root there is no path to show and the bead is the
  // way out of the database. A calendar has neither, so the bead puts it
  // away.
  // Leaving a DATABASE, and nothing else now: the desks are a card, so
  // the calendar has no need of a button meaning "put this away and
  // show me where else I could be" - a swipe does that.
  const stepOut = () => leave?.onLeave();
  // The bead shows only where it has a job nobody else has: at a
  // database's root, where it leaves the database, and on the calendar,
  // which has no root to walk to and is simply put away. Inside folders
  // the first crumb already goes to the root, and two buttons for one
  // job is what the user rightly refused.
  const showLeave = !trail && !!leave;
  // What it carries: the thing it is LEAVING, when there is one.
  const icon = ((leave?.icon ?? dock?.icon) as keyof typeof Ionicons.glyphMap) ?? 'ellipse-outline';
  // Four buttons fit in the card - desks OR actions - whether or not the
  // way out is riding at its left edge. The card does not grow, so the
  // buttons give: at full size a fifth thing simply scrolled off the end
  // of the card, which is where the "..." went on the custom database.
  // One card's whole content, parameterised by WHICH face it draws -
  // called once per card in the ring, since every one of them is
  // mounted the whole time rather than conjured up when a swipe needs
  // it. `showLeave` is the same regardless of which face this draws:
  // it is about whether this SCREEN has a way out, not about which card
  // is showing.
  function renderCard(f: DockFace) {
    return (
      <>
        {showLeave && (
          <Pressable onPress={stepOut} style={[styles.leave, { height: CARD_H }]}>
            <Ionicons name="chevron-back" size={24} color={theme.glass.ink} />
            <View style={[styles.leaveRule, { backgroundColor: theme.glass.inkMuted, opacity: 0.4 }]} />
          </Pressable>
        )}
        <View style={styles.face}>
          {f === 'desks' && desks && (
            desks.collapsed ? (
              <View style={[styles.dotsShell, dims.card]}>
                <Pressable style={styles.dotsRow} onLongPress={openCapture} delayLongPress={400}>
                  {desks.desks.map((desk) => (
                    <Pressable
                      key={desk.key}
                      hitSlop={6}
                      onPress={desk.onPress}
                      onLongPress={openCapture}
                      delayLongPress={400}
                    >
                      <View
                        style={[
                          styles.dot,
                          { backgroundColor: desk.active ? theme.glass.ink : theme.glass.inkMuted },
                          desk.active && styles.dotActive,
                        ]}
                      />
                    </Pressable>
                  ))}
                </Pressable>
              </View>
            ) : (
              <View style={[styles.shell, dims.card]}>
                <Pressable style={[styles.actionRow, styles.spread]} onLongPress={openCapture} delayLongPress={400}>
                  {desks.desks.map((desk) => (
                    <Pressable key={desk.key} onPress={desk.onPress} onLongPress={openCapture} delayLongPress={400}>
                      {desk.active ? (
                        <View style={[styles.actionButton, { width: DESK, height: DESK, borderRadius: DESK / 2 }]}>
                          <Svg width={DESK} height={DESK} style={StyleSheet.absoluteFill} pointerEvents="none">
                            <Circle cx={DESK / 2} cy={DESK / 2} r={DESK / 2 - HERE_SHRINK} fill={HERE_FILL} />
                          </Svg>
                          <Ionicons name={desk.icon as keyof typeof Ionicons.glyphMap} size={22} color={theme.glass.ink} />
                        </View>
                      ) : (
                        <View style={[styles.actionButton, { width: DESK, height: DESK, borderRadius: DESK / 2 }]}>
                          <Ionicons name={desk.icon as keyof typeof Ionicons.glyphMap} size={22} color={theme.glass.ink} />
                        </View>
                      )}
                    </Pressable>
                  ))}
                </Pressable>
              </View>
            )
          )}

          {f === 'context' && strip && (
            <View style={[styles.shell, dims.card]}>
              <ScrollView
                ref={stripRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                style={styles.stripViewport}
                onLayout={(e) => {
                  const width = e.nativeEvent.layout.width;
                  setStripWidth(width);
                  stripRef.current?.scrollTo({ x: stripOffsetFor(width), animated: false });
                }}
              >
                {strip.items.map((item) => {
                  const current = item.key === strip.selected;
                  const ink = item.anchor ? theme.accent : current ? theme.glass.ink : theme.glass.inkMuted;
                  const body = (
                    <>
                      <Text style={[styles.stripLabel, item.anchor && styles.stripLabelAnchor, { color: ink }]}>
                        {item.label}
                      </Text>
                      {/* Between the number and the weekday now, not
                          pinned to the card's own bottom edge - down
                          there they sat in exactly the strip the card
                          BEHIND this one peeks out through, so a stray
                          dot was the first thing that sliver showed:
                          "з країв дока не було видно". A row in the
                          normal flow, the same width as everything
                          else in this cell, cannot sit at an edge it
                          is not part of. Always reserves the room
                          (`minHeight`) whether or not this day HAS a
                          mark, so a plain day does not sit taller than
                          a marked one and shove the weekday down. */}
                      <View style={styles.stripMarks}>
                        {!!item.marks?.length &&
                          item.marks.map((mark, i) => (
                            <View
                              key={`${mark}-${i}`}
                              style={[styles.stripMark, { backgroundColor: mark === 'accent' ? STRIP_MARK_ACCENT : theme.glass.ink }]}
                            />
                          ))}
                      </View>
                      {!!item.sub && <Text style={[styles.stripSub, { color: ink }]}>{item.sub}</Text>}
                    </>
                  );
                  return (
                    <Pressable key={item.key} onPress={() => strip.onPick(item.key)}>
                      {current ? (
                        <View style={[styles.stripItem, dims.rowHeight, styles.here]}>{body}</View>
                      ) : (
                        <View style={[styles.stripItem, dims.rowHeight]}>{body}</View>
                      )}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          )}

          {f === 'context' && trail && (
            <View style={[styles.shell, styles.trailShell, dims.card]}>
              <View style={[styles.trailRow, dims.rowHeight]}>
                <ScrollView ref={trailRef} horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.trailStrip}>
                  <View ref={targets?.('')} collapsable={false}>
                    <Pressable onPress={() => trail.onGo('')} style={styles.trailRoot}>
                      <Ionicons name={icon} size={19} color={theme.glass.ink} />
                    </Pressable>
                  </View>
                  {trail.crumbs.map((segment, index) => {
                    const isLast = index === trail.crumbs.length - 1;
                    const target = trail.crumbs.slice(0, index + 1).join('/');
                    return (
                      <View key={target} style={styles.trailPair}>
                        <Ionicons name="chevron-forward" size={13} color={theme.glass.inkMuted} />
                        {isLast ? (
                          <View style={[styles.trailCurrent, { borderRadius: CARD_BUTTON / 2 }, styles.here]}>
                            <Text style={[styles.trailLabel, styles.trailLabelCurrent, { color: theme.glass.ink }]} numberOfLines={1}>
                              {segment}
                            </Text>
                          </View>
                        ) : (
                          <View ref={targets?.(target)} collapsable={false}>
                            <Pressable onPress={() => trail.onGo(target)} style={styles.trailSegment}>
                              <Text style={[styles.trailLabel, { color: theme.glass.inkMuted }]} numberOfLines={1}>
                                {segment}
                              </Text>
                            </Pressable>
                          </View>
                        )}
                      </View>
                    );
                  })}
                </ScrollView>
              </View>
            </View>
          )}

          {f === 'actions' && !!actions?.length && (
            <View style={[styles.shell, styles.actionsShell, dims.card]}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.actionRow}>
                {actions.map((action) => (
                  <Pressable
                    key={action.key}
                    onPress={() => {
                      action.onPress();
                      if (action.closesStack) setFace('context');
                    }}
                    onLongPress={action.onLongPress}
                    style={[styles.actionButton, { width: DESK, height: DESK, borderRadius: DESK / 2 }, action.active && styles.actionButtonActive]}
                  >
                    {action.icon.startsWith('mc:') ? (
                      <MaterialCommunityIcons
                        name={action.icon.slice(3) as keyof typeof MaterialCommunityIcons.glyphMap}
                        size={21}
                        color={action.active ? theme.accent : theme.glass.ink}
                      />
                    ) : (
                      <Ionicons name={action.icon as keyof typeof Ionicons.glyphMap} size={21} color={action.active ? theme.accent : theme.glass.ink} />
                    )}
                    {!!action.badge && (
                      <Ionicons name={action.badge as keyof typeof Ionicons.glyphMap} size={12} color={theme.glass.ink} style={styles.badge} />
                    )}
                  </Pressable>
                ))}
              </ScrollView>
            </View>
          )}
        </View>
      </>
    );
  }

  const DESK = Math.min(CARD_BUTTON, Math.floor((cardWidth - CARD_PAD * 2 - (showLeave ? LEAVE_W : 0)) / 4));

  return (
    <GlassPortal>
      {/* TEMPORARY - a live readout of the dock's own state, to catch
          "опускається" with real numbers instead of another guess.
          Remove once that is found and fixed. */}
      <View style={[styles.debugHud, { top: insets.top + 4 }]} pointerEvents="none">
        <Text style={styles.debugText}>
          {`ring=${ringSize} idx=${faceIndex} PROG=${progress.value} G=${gesture.value} RI=${restIndexSV.value} RN=${ringRestSV.value} flux=${tabsInFlux?1:0}\nown=${own ? own.kind : '-'} act=${actions?.length ?? 0} leave=${showLeave ? 1 : 0} bottom=${bottomInset} key=${screenKey.slice(-6)}\nfaces=[${faces.join(',')}] restY=${faces
            .map((_, i) => Math.round((restStyles[i].transform[0] as { translateY: number }).translateY * 100) / 100)
            .join('/')}\n${dockTrail.current.lines.join('\n')}`}
        </Text>
      </View>
      <View
        style={[styles.wrap, { bottom: DOCK_BOTTOM + bottomInset, paddingHorizontal: EDGE_INSET }]}
        pointerEvents="box-none"
      >
        <View
          style={[
            styles.row,
            // Height SAID too, with the slivers' room included, so that
            // centring the beads happens inside a box that is really
            // this tall - and nothing in this chain is allowed to clip.
            // ALWAYS the room for two slivers, whether this screen has
            // two, one or none behind. The row is anchored at the bottom,
            // so a row that grew with its slivers pushed the front card
            // UP - a hair higher on the screens with more cards behind,
            // which read as a different dock on every desk.
            { width: rowWidth, gap: GAP, height: CARD_H + BEHIND_EDGE * 2, overflow: 'visible' },
          ]}
        >
          {/* A missing bead keeps its place. Without this the stack
              drifted: two beads on documents, one on the calendar, and
              the same control sat in a different spot on each - "док
              зміщений відносно того що є на екрані документів". */}
          {beads.left ? <Bead bead={beads.left} theme={theme} size={BEAD} /> : <View style={[styles.beadSlot, dims.bead]} />}
          <GestureDetector gesture={swipe}>
          <View
            style={[
              styles.stack,
              // Said explicitly now, not left to its own content: both
              // card layers inside are position:'absolute', which counts
              // for nothing toward a container's own height - `stack`
              // collapsed to just its padding, and centred (`row`'s own
              // alignItems) in a taller row, it dropped toward the
              // middle instead of sitting flush at the top: "док
              // змістився вниз".
              { width: cardWidth, height: CARD_H + BEHIND_EDGE * 2, paddingBottom: BEHIND_EDGE * 2 },
            ]}
          >
            {/* Every card this screen's stack holds, mounted once and
                never moved from its own layer. Which one is in front,
                which is peeking out below it, and which is on its way
                over the top are all one number's doing - see
                slotTransform. The cards behind used to be painted bars
                standing in for cards that were not there; they are the
                real ones now, which is what the user asked for:
                "потрібно щоб це була справжня задня картка". */}
            {faces.map((f, i) => (
              <Animated.View
                key={f}
                style={[styles.cardLayer, dims.card, slotStyles[i]]}
                pointerEvents={f === showing ? 'auto' : 'none'}
              >
                <Frost style={[styles.front, styles.cardEdge, dims.card]} radius={CARD_H / 2}>
                  {renderCard(f)}
                </Frost>
              </Animated.View>
            ))}
          </View>
          </GestureDetector>
          {beads.right ? <Bead bead={beads.right} theme={theme} size={BEAD} /> : <View style={[styles.beadSlot, dims.bead]} />}
        </View>
      </View>
    </GlassPortal>
  );
}

// A bead: the same glass, the same height as a capsule, standing on its
// own beside the stack.
// The drawer's two layers, clipped round. `radius` is always half of a
// size the view already has - never 999 (see dims).
function Frost({
  style,
  radius,
  children,
}: {
  style?: StyleProp<ViewStyle>;
  radius: number;
  children?: ReactNode;
}) {
  const theme = useTheme();
  const blurTarget = useBlurTarget();
  return (
    <View style={[style, { borderRadius: radius, overflow: 'hidden' }]}>
      <BlurView
        intensity={FROST_BLUR}
        tint="dark"
        blurMethod="dimezisBlurView"
        blurTarget={blurTarget ?? undefined}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      <View
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.surface, opacity: FROST_TINT }]}
        pointerEvents="none"
      />
      {children}
    </View>
  );
}

function Bead({ bead, theme, size }: { bead: DockBead; theme: ReturnType<typeof useTheme>; size: number }) {
  return (
    <Pressable
      onPress={bead.onPress}
      onLongPress={bead.onLongPress}
      style={{ width: size, height: size, overflow: 'visible' }}
    >
      <Frost style={[styles.bead, { width: size, height: size }]} radius={size / 2}>
        <Ionicons
          name={bead.icon as keyof typeof Ionicons.glyphMap}
          size={21}
          color={bead.active ? theme.accent : theme.glass.ink}
        />
        {!!bead.badge && (
          <Ionicons
            name={bead.badge as keyof typeof Ionicons.glyphMap}
            size={12}
            color={theme.glass.ink}
            style={styles.badge}
          />
        )}
      </Frost>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  debugHud: {
    position: 'absolute',
    left: 4,
    zIndex: 999,
    backgroundColor: 'rgba(255,0,0,0.85)',
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 4,
  },
  debugText: {
    color: '#fff',
    fontSize: 10,
    fontFamily: FONT_REGULAR,
  },
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    alignItems: 'center',
    // Slack above and below, and no clipping: a bead's bottom point
    // was going missing, and the one thing every ancestor here can be
    // made to promise is that it is not the one cutting it.
    paddingVertical: 6,
    overflow: 'visible',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  // One per card in the ring - absolutely positioned, all of them
  // stacked on the same spot, and each pushed to its own place by its
  // own transform.
  cardLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  // Thin, low-contrast - the two cards are the same glass, same colour,
  // and without SOME line between them the eye cannot tell there are
  // two objects at all, only one thing moving strangely: "два блоки
  // розділяються... кольори у них однакові".
  cardEdge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  front: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
  },
  face: {
    flex: 1,
    minWidth: 0,
    justifyContent: 'center',
  },
  leave: {
    width: LEAVE_W,
    flexShrink: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 1,
  },
  leaveRule: {
    position: 'absolute',
    right: 0,
    top: '30%',
    bottom: '30%',
    width: StyleSheet.hairlineWidth,
  },
  stack: {
    // Room under the front capsule for the cards behind it - exactly as
    // many edges as there are, no more (set inline).
    // The one thing in the row allowed to shrink: the beads either side
    // keep their size, and the card between them takes what is left.
    // minWidth 0 because a flex child will not shrink below its content
    // without it, and the content here is a scroller full of folders.
    flexShrink: 1,
    minWidth: 0,
  },
  shell: {
    padding: CARD_PAD,
    width: '100%',
    justifyContent: 'center',
  },
  actionRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  spread: {
    justifyContent: 'space-between',
    flex: 1,
  },
  actionsShell: {},
  beadSlot: {
    flexShrink: 0,
  },
  bead: {
    // Fixed: a bead never gives up room, it is the card that does.
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    right: 8,
    bottom: 8,
  },
  actionButton: {
    borderRadius: 999,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Where you are: a flat lighter disc on the frost. Not a bead - the
  // reference has no beads inside its capsule.
  here: {
    backgroundColor: 'rgba(255,255,255,0.16)',
  },
  dotsShell: {
    paddingHorizontal: 10,
    width: '100%',
    justifyContent: 'center',
  },
  dotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  dot: {
    width: 7,
    height: 7,
    borderRadius: 999,
  },
  dotActive: {
    width: 8,
    height: 8,
  },
  actionButtonActive: {
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  trailShell: {
    flexShrink: 1,
    minWidth: 0,
  },
  stripViewport: {
    flex: 1,
  },
  stripItem: {
    width: STRIP_ITEM,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 999,
  },
  stripLabel: {
    fontSize: 16,
    fontFamily: FONT_SEMIBOLD,
    fontWeight: '600',
  },
  // Today is heavier as well as coloured: on a dark ground a tint alone
  // is a weak signal, and this is the one day that has to be findable
  // without looking for it.
  stripLabelAnchor: {
    fontFamily: FONT_BOLD,
    fontWeight: '700',
  },
  stripSub: {
    fontSize: 10,
    marginTop: 1,
    fontFamily: FONT_REGULAR,
  },
  stripMarks: {
    flexDirection: 'row',
    gap: 3,
    minHeight: 5,
    marginTop: 2,
    alignItems: 'center',
  },
  stripMark: {
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
  },
  trailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  trailStrip: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 4,
  },
  trailPair: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  trailRoot: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  trailSegment: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  trailCurrent: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
  },
  trailLabel: {
    fontSize: 14,
    maxWidth: 160,
    fontFamily: FONT_REGULAR,
  },
  trailLabelCurrent: {
    fontFamily: FONT_SEMIBOLD,
    fontWeight: '600',
  },
});
