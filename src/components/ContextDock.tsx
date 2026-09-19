import { useLayoutEffect, useMemo, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, ViewStyle, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { openCapture } from './CaptureWindow';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
import { GlassPortal } from './GlassPortal';
import DockFrost from './DockFrost';
import { useLift, useTheme } from '../theme/ThemeProvider';
import { liftStyle } from '../theme/tokens';
import { hapticButtonDown } from '../utils/haptics';
import { NAV_BOTTOM, NAV_BUTTON, NAV_PADDING } from '../constants/rail';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { DOCK_BOTTOM, dockCardHeight, dockEdgeInset, dockRowWidth } from '../navigation/dockGeometry';
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
  useNavDockPrefersActions,
  useNavDockWide,
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
// How far back one card sits from the one in front of it. 0.94 showed
// too much of the card behind; 0.85 made the two read as different
// sizes and left the descent so short it landed where it started.
// Between them, and back to what these were always meant to be: a
// hint that there is another card there, not a second dock.
const BACK_SCALE = 0.91;
const BACK_Y = 7;
// How high the departing card rises at the peak of its arc. A full card
// height: short of that the drag never visibly clears the dock's own top
// edge - "картка навіть не дотягується до верхнього краю дока".
const RISE_F = 1.0;
// `eps` alternates between 0 and a hundredth of a point. It exists to
// be READ - see `tick` at the call site - and is far too small to see.
// Where card `i` stands when the ring's front is at position `f`, said
// as bare numbers so it can be used both by React (plainly, on the JS
// side) and inside a worklet.
function slotPlace(i: number, f: number, n: number, cardH: number) {
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
  return { y, s: Math.pow(BACK_SCALE, slot), z: Math.round((n - slot) * 10) };
}

function slotTransform(i: number, f: number, n: number, cardH: number) {
  'worklet';
  const p = slotPlace(i, f, n, cardH);
  return {
    transform: [{ translateY: p.y }, { scale: p.s }],
    zIndex: p.z,
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
// INSET_F now lives in dockGeometry, so a panel that wants to be as wide
// as the dock reads the dock's own number instead of a copy of it.
// What the inset narrows to while a screen asks for a wider dock. The
// user's measure, not a guess: "можна на всю ширину тексту" - a note's
// own text starts about a sixteenth of the screen in, and at rest the
// dock stands a good deal further in than that.
const INSET_WIDE_F = 0.045;
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
  const EDGE_INSET = dockEdgeInset(windowW);
  // The row's width is SAID, not left to flex: it was settling at
  // three-quarters of the screen and nobody could tell why. On a screen
  // wider than a phone this is narrower than the window, and the wrap
  // below centres it.
  const rowWidth = dockRowWidth(windowW);
  // And so is the CARD'S. Left to flex it hugged its content - one
  // folder deep the path card shrank to a single word and the whole row
  // bunched up on the left. A card is four buttons wide whatever it
  // holds: the width between the beads, every time, on every screen.
  // The card at REST, with both bead slots standing. `cardWidthNow`
  // below is the one anything drawn actually uses - it grows into those
  // slots while a screen asks for a wider dock (see `stretch`).
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
  // ...unless the screen DECLARES otherwise. A note has no context of
  // its own, so the rule above would open it on the desks - hiding the
  // very buttons that moved into this dock when the note stopped drawing
  // one. It is a declaration and not a new inference on purpose: every
  // other screen with actions and no context keeps opening on the desks.
  const prefersActions = useNavDockPrefersActions();
  const opensOn: DockFace = !own
    ? prefersActions
      ? 'actions'
      : 'desks'
    : own.kind === 'strip'
      ? 'desks'
      : 'context';
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
  // ONE CLOCK. REACT DRAWS THE DOCK, ALWAYS - INCLUDING WHILE IT MOVES.
  //
  // Every bug in this long run had the same cause, and it was never
  // the arithmetic. A card's position was written by TWO hands, React
  // and Reanimated, on two clocks that cannot be made to agree: a
  // shared value written from a layout effect does not reach the UI
  // thread in the frame React just committed, and a worklet rebuilt
  // because its captured numbers changed is rebuilt after the paint.
  // Every hand-over between them was a race, and closing one opened
  // the next - cards a step back, cards a step too far, the old icons
  // under the dock, the dock ballooning, the same card twice.
  //
  // So there is no second hand any more. The ring's position is plain
  // React state and the cards are plain views. At rest there is not
  // even a value to keep in step - `pos` IS `faceIndex`, computed in
  // the render that draws it, so a screen change can never be one
  // frame ahead of its own dock. While a swipe runs the gesture sets
  // that state directly, and the settle is a requestAnimationFrame
  // loop doing the same.
  //
  // The end of a swipe - the moment that defeated every previous
  // design - is now one setState batch: the new front card and the
  // return to rest, together, in a single React commit. And because a
  // whole turn of the ring is the identity, `to` and the new
  // `faceIndex` place every card identically, so even that commit
  // moves nothing on screen.
  const [drag, setDrag] = useState<number | null>(null);
  const pos = drag ?? faceIndex;
  const faceIndexRef = useRef(faceIndex);
  faceIndexRef.current = faceIndex;
  const startRef = useRef(0);
  // Where the finger left the card. Read back in onEnd, which has to
  // glide from the position actually on screen, not from a guess.
  const dragRef = useRef(0);
  const rafRef = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    },
    []
  );
  // The settle, by hand. Short, and the only animation this file has
  // left - which is the point: it runs on the same clock as everything
  // that reads it.
  const glide = useMemo(
    () => (from: number, to: number, ms: number, easing: (t: number) => number, done: () => void) => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      const t0 = Date.now();
      const step = () => {
        const k = Math.min(1, (Date.now() - t0) / ms);
        setDrag(from + (to - from) * easing(k));
        if (k < 1) {
          rafRef.current = requestAnimationFrame(step);
          return;
        }
        rafRef.current = null;
        done();
      };
      rafRef.current = requestAnimationFrame(step);
    },
    []
  );
  const cardStyles = [0, 1, 2].map((i) => slotTransform(i, pos, ringSize, CARD_H));
  // THE STRETCH, 0..1 - see useDockWide. The user's idea: while a note
  // has blocks selected its card carries nine actions, and the room for
  // them is already standing empty, because a note publishes no beads
  // and an empty bead slot is kept rather than closed up (so the dock
  // sits in the same place on every screen).
  //
  // Only where there is actually nothing in those slots. A real bead is
  // a fixed circle with an icon in it; shrinking one would squeeze the
  // icon out of its own capsule, and hiding it would take away a control
  // the screen asked for. No bead, no conflict.
  //
  // Animated on the SAME hand-rolled clock as the stack's own settle,
  // deliberately: this file has exactly one animation mechanism and
  // everything that reads a number reads it from React state on the same
  // frame. A Reanimated shared value here would be a second clock, and
  // the widths, the button sizes and the card positions would each be
  // right on a different one.
  const wideWanted = useNavDockWide() && !beads.left && !beads.right;
  const [stretch, setStretch] = useState(wideWanted ? 1 : 0);
  const stretchRaf = useRef<number | null>(null);
  const stretchRef = useRef(stretch);
  stretchRef.current = stretch;
  useEffect(() => {
    const to = wideWanted ? 1 : 0;
    const from = stretchRef.current;
    if (from === to) return;
    if (stretchRaf.current !== null) cancelAnimationFrame(stretchRaf.current);
    const t0 = Date.now();
    const step = () => {
      const k = Math.min(1, (Date.now() - t0) / 220);
      // Same ease-out shape the stack settles with: quick away from the
      // old width, slow into the new one.
      const e = 1 - Math.pow(1 - k, 3);
      setStretch(from + (to - from) * e);
      if (k < 1) {
        stretchRaf.current = requestAnimationFrame(step);
        return;
      }
      stretchRaf.current = null;
    };
    stretchRaf.current = requestAnimationFrame(step);
    return () => {
      if (stretchRaf.current !== null) cancelAnimationFrame(stretchRaf.current);
      stretchRaf.current = null;
    };
  }, [wideWanted]);
  // What the bead slots give up, and what the card takes. Continuous in
  // `stretch`, so every frame of the morph is a real width rather than a
  // step between two of them.
  const beadSlotW = BEAD * (1 - stretch);
  // The row moves closer to the screen's edges too, so the stretch is
  // worth another half a button on each side rather than only the beads'
  // room.
  const edgeInsetNow = Math.round(EDGE_INSET + (screenW * INSET_WIDE_F - EDGE_INSET) * stretch);
  const rowWidthNow = screenW - edgeInsetNow * 2;
  const cardWidthNow = rowWidthNow - beadSlotW * 2 - GAP * 2;
  // HOW THE DOCK PARTS FROM THE SCREEN. In the black theme that is the
  // glow, and the glow is the whole reason this is here: the two pills
  // that still wore it were the editor's pre-dock chrome, the last two
  // things in the app that had never been moved onto the dock - so
  // everything that DID move lost it, silently. "Воно розбавляє чорну
  // тему просто прекрасно... тема стає живою."
  //
  // Only the FRONT card takes it. A stack of three lit cards is the
  // same mistake as a stack of three glass rims - the sliver of a back
  // card is seven points tall, and a halo on it reads as fog, not as a
  // second light. Same reason the reference draws the cards behind as
  // plain bands.
  const lift = useLift();
  const ringFloor = Math.floor(pos);
  // HOW BRIGHT EACH CARD'S LIGHT IS, as a plain function of where the
  // stack stands - so the hand-over is the same continuous number that
  // moves the cards, not an event at the end of one.
  //
  // The card in front (rel 0) is the lit one; the card right behind it
  // (rel 1) is the one that WILL be in front when `pos` crosses the
  // next whole number. So through a swipe the first dims to nothing
  // while the second comes up, and at the moment the two swap places
  // they are each at zero and full - nothing changes in that frame,
  // which is exactly what a jump is the absence of.
  const carry = pos - ringFloor;
  const glowAt = (i: number) => {
    const rel = (((i - ringFloor) % ringSize) + ringSize) % ringSize;
    if (rel === 0) return 1 - carry;
    if (rel === 1 && ringSize > 1) return carry;
    return 0;
  };
  // The gesture is built once, so what it calls has to be reachable
  // through something whose identity never changes.
  const commitRef = useRef<(f: DockFace) => void>(() => {});
  commitRef.current = setFace;
  const land = useMemo(
    () => ({
      // Both in one call, so React commits them together. `to` and the
      // new `faceIndex` are the same ring position, so nothing moves.
      commit: (next: DockFace) => {
        commitRef.current(next);
        setDrag(null);
      },
      rest: () => setDrag(null),
    }),
    []
  );
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        // Strictly vertical, and it gives up the moment it reads as
        // sideways: the capsule under it scrolls horizontally (the
        // days, the path), and that has to keep working.
        .activeOffsetY([-10, 10])
        .failOffsetX([-16, 16])
        .runOnJS(true)
        .onStart(() => {
          startRef.current = faceIndexRef.current;
          dragRef.current = startRef.current;
          setDrag(startRef.current);
        })
        .onUpdate((e) => {
          if (facesRef.current.length < 2) return;
          // Capped at the peak. Past it the arc comes back DOWN, and a
          // live drag was doing that on its own the moment the finger
          // crossed the midpoint: "я не дотягнув догори, воно вже
          // перелиснуло". A drag may only ever rise; the descent onto
          // the back spot belongs to the release.
          const dragged = Math.max(0, -e.translationY) / cardHRef.current;
          dragRef.current = startRef.current + Math.min(0.5, dragged);
          setDrag(dragRef.current);
        })
        .onEnd((e) => {
          const ring = facesRef.current;
          const len = ring.length;
          // A real swipe, not a nudge - distance OR a fast enough
          // flick, the same as any carousel. Short of two cards there
          // is nothing to cycle to.
          const committed = len >= 2 && (e.translationY < -40 || e.velocityY < -600);
          const from = dragRef.current;
          if (!committed) {
            glide(from, startRef.current, 220, (t) => 1 - Math.pow(1 - t, 3), land.rest);
            return;
          }
          hapticButtonDown();
          // Counted from a POSITION in the ring, never from the stored
          // face: `face` is one value shared by every screen while a
          // ring is a list each screen writes for itself, so a face
          // carried in from another desk may not be in this ring at
          // all.
          const at = ((Math.round(startRef.current) % len) + len) % len;
          const to = at + 1;
          const next = ring[to % len] ?? ring[0];
          glide(
            from,
            to,
            260,
            (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
            () => land.commit(next)
          );
        })
        // Runs for a gesture the pager takes over mid-drag as well as
        // for a clean end, so the dock can never be left mid-swipe.
        .onFinalize(() => {
          if (rafRef.current === null) setDrag(null);
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
                    style={[
                      styles.actionButton,
                      { width: ACT_W, height: CARD_BUTTON, borderRadius: Math.round(CARD_BUTTON / 3) },
                      action.active && styles.actionButtonActive,
                    ]}
                  >
                    {/* Icon over word. The button is a quarter of the
                        card wide and the whole card tall, so the word
                        gets one line and no more - a label that wrapped
                        would push the icon off centre and make one
                        button taller than its neighbours. */}
                    {action.icon.startsWith('mc:') ? (
                      <MaterialCommunityIcons
                        name={action.icon.slice(3) as keyof typeof MaterialCommunityIcons.glyphMap}
                        size={ACT_ICON}
                        color={action.active ? theme.accent : theme.glass.ink}
                      />
                    ) : (
                      <Ionicons name={action.icon as keyof typeof Ionicons.glyphMap} size={ACT_ICON} color={action.active ? theme.accent : theme.glass.ink} />
                    )}
                    {!!action.label && (
                      <Text
                        numberOfLines={1}
                        // A safety net, not a licence for long words: a
                        // label one letter too wide shrinks rather than
                        // ending in an ellipsis, which would hide the
                        // very thing the label was added for.
                        adjustsFontSizeToFit
                        minimumFontScale={0.75}
                        style={[styles.actionLabel, { color: action.active ? theme.accent : theme.glass.ink }]}
                      >
                        {action.label}
                      </Text>
                    )}
                    {!!action.badge && (
                      <Ionicons name={action.badge as keyof typeof Ionicons.glyphMap} size={12} color={theme.glass.ink} style={styles.badge} />
                    )}
                    {/* A number in the badge's own corner instead of a
                        glyph - how many things this action is about to
                        act on. The two never appear together: a count
                        belongs to acting on a selection, a glyph badge
                        to creating something. */}
                    {action.count !== undefined && (
                      <Text style={[styles.badge, styles.countBadge, { color: theme.glass.ink }]}>
                        {action.count}
                      </Text>
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

  const DESK = Math.min(CARD_BUTTON, Math.floor((cardWidthNow - CARD_PAD * 2 - (showLeave ? LEAVE_W : 0)) / 4));
  // An action button carries a word, so unlike a desk it is not a
  // circle and takes the full quarter of the card. Divided by four
  // whatever the count, so the buttons are the same size on a screen
  // with two actions and on one with four.
  // A quarter of the card AT REST - deliberately not of the live width.
  // This was wrong on the first try and the user counted it: sized off
  // the live width, every button grew exactly as fast as the card did,
  // so a visibly wider dock still showed the same four icons ("він став
  // ширшим але показує 4 іконки"). Fixed, the stretch buys what it was
  // meant to buy - more buttons in view, the same size as always.
  //
  // A DESK button still divides the LIVE width just above, because four
  // desks are meant to span the card whatever width it has.
  const ACT_W = Math.floor((cardWidth - CARD_PAD * 2 - (showLeave ? LEAVE_W : 0)) / 4);
  const ACT_ICON = 19;

  return (
    <GlassPortal>
      <View
        style={[styles.wrap, { bottom: DOCK_BOTTOM + bottomInset, paddingHorizontal: edgeInsetNow }]}
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
            { width: rowWidthNow, gap: GAP, height: CARD_H + BEHIND_EDGE * 2, overflow: 'visible' },
          ]}
        >
          {/* A missing bead keeps its place. Without this the stack
              drifted: two beads on documents, one on the calendar, and
              the same control sat in a different spot on each - "док
              зміщений відносно того що є на екрані документів". */}
          {beads.left ? (
            <Bead bead={beads.left} theme={theme} lift={lift} size={BEAD} />
          ) : (
            <View style={[styles.beadSlot, dims.bead, { width: beadSlotW }]} />
          )}
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
              { width: cardWidthNow, height: CARD_H + BEHIND_EDGE * 2, paddingBottom: BEHIND_EDGE * 2 },
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
              // One view per card, one animated style, one source for
              // where it stands. No second layer to keep in step.
              <View
                key={f}
                style={[styles.cardLayer, dims.card, liftStyle(theme, theme.lift, glowAt(i)), cardStyles[i]]}
                pointerEvents={f === showing ? 'auto' : 'none'}
              >
                <DockFrost style={[styles.front, styles.cardEdge, dims.card]} radius={CARD_H / 2}>
                  {renderCard(f)}
                </DockFrost>
              </View>
            ))}
          </View>
          </GestureDetector>
          {beads.right ? (
            <Bead bead={beads.right} theme={theme} lift={lift} size={BEAD} />
          ) : (
            <View style={[styles.beadSlot, dims.bead, { width: beadSlotW }]} />
          )}
        </View>
      </View>
    </GlassPortal>
  );
}

// A bead: the same glass, the same height as a capsule, standing on its
// own beside the stack.
// The drawer's two layers, clipped round. `radius` is always half of a
// size the view already has - never 999 (see dims).
// Frost moved to its own file (DockFrost) so the editor's "/" toolbar
// can wear the same material instead of a second recipe of its own -
// see DockFrost's comment for what that second recipe cost.

function Bead({
  bead,
  theme,
  lift,
  size,
}: {
  bead: DockBead;
  theme: ReturnType<typeof useTheme>;
  // Passed in rather than read here: a bead is drawn twice per dock and
  // the row above already knows the answer.
  lift: ViewStyle;
  size: number;
}) {
  return (
    <Pressable
      onPress={bead.onPress}
      onLongPress={bead.onLongPress}
      style={{ width: size, height: size, overflow: 'visible' }}
    >
      <DockFrost style={[styles.bead, { width: size, height: size }, lift]} radius={size / 2}>
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
      </DockFrost>
    </Pressable>
  );
}

const styles = StyleSheet.create({
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
    // Said out loud: the card inside rises clear of this box at the
    // peak of a swipe and must not be cut off doing it.
    overflow: 'visible',
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
  countBadge: {
    fontSize: 11,
    fontFamily: FONT_BOLD,
  },
  badge: {
    // Over the icon's own corner. It used to be measured from the
    // button's bottom, which was the icon's bottom while the button
    // held nothing else; with a word down there it would sit on the
    // word instead.
    position: 'absolute',
    right: 6,
    top: 6,
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
  actionLabel: {
    fontSize: 9.5,
    fontWeight: '600',
    marginTop: 2,
    paddingHorizontal: 2,
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
