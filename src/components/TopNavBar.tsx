import { Ionicons } from './icons/Ionicons';
import { chromeCover, chromeNodeRef } from '../utils/chromeMorph';
import { ReactNode, useEffect, useMemo, useRef, useState, memo } from 'react';
import { Animated as RNAnimated } from 'react-native';
import { Keyboard, Pressable, ScrollView, StyleProp, StyleSheet, Text, TextInput, useWindowDimensions, View, ViewStyle } from 'react-native';
import Animated, { Easing, Extrapolation, FadeIn, FadeOut, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withSpring, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DockFrost, { FlatFrostContext } from './DockFrost';
import { GlassPortal } from './GlassPortal';
import DockGlassFill, { useDockSurface } from './DockGlassFill';
import { useDockGlass } from '../utils/dockGlass';
import { useLift, useTheme } from '../theme/ThemeProvider';
import { CHROME_TOP } from '../constants/rail';
import { DOCK_PIECE_RADIUS, dockCardHeight } from '../navigation/dockGeometry';
import Menu from './surfaces/Menu';
import SaveRing from './SaveRing';
import { DockContext, TopBack, TopExtras, TopSearch, useNavChromeStyle, useNavDockOwnContext, useNavDockTargets, useNavDrawerCover, useNavTopBack, useNavTopExtras, useNavTopSearch, useTopNavClaim } from '../navigation/navDock';
import { navigationRef } from '../navigationRef';
import { chromeCompact, useChromeCompactFlag } from '../navigation/chromeScroll';
import { useDeskBeads, useDockCarriesBack } from '../navigation/deskBeadsBus';
import { FEATURES } from '../features';
import SoftIcon, { SoftIconName } from './SoftIcon';
import { SoftTokens, useSoft } from '../theme/soft';
import { FONT_MEDIUM, FONT_REGULAR, FONT_SEMIBOLD, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { useDensity } from '../hooks/useDensity';
import { useRenderTimer } from '../utils/perfWatch';
import { CAPSULE_H, CAPSULE_W, VoiceCapsule, useVoiceCapsuleOn } from './thoughts/VoicePlayer';

// THE DESKS, AT THE TOP - the user's plan after looking at Notion: the
// way back in the top-left corner, then the desks, the one you are on
// opened out to carry its name. Only on the four desks' own screens for
// now ("поки на головних екранах, щоб все не зламати"); everywhere else
// the dock keeps them.
//
// The desks lie on ONE PLATE, pieces of one slab the way the bottom
// dock's are ("4 наші прямокутники іще об'єднуються одним доком"), and
// inside a folder that plate rolls over to the folder path in their
// place - the same swap of one card for another the dock makes - so a
// folder shows where you are in it and no desks at all.
//
// Lined up with the dock under it: the same left and right edges, the
// same material and corners.
export const TOP_NAV_H = 46;
// What a desk's own screen adds above its content so nothing starts
// under the bar - the bar and the breath under it.
// Twenty, not ten: at ten the bar sat so close over the first card that
// the two read as one row of the same list - "все по одній лінії".
export const TOP_NAV_SPACE = TOP_NAV_H + 20;
// The plate's own padding and the cut between its pieces - the bottom
// dock's numbers (ContextDock's PLATE_PAD and DOCK_CUT).
const PLATE_PAD = 6;
const CUT = 3;
const PIECE_H = TOP_NAV_H - PLATE_PAD * 2;
// A closed desk: a square, as tall as the pieces are.
const PILL_W = PIECE_H;
const GAP = 6;
// The buttons standing apart at either end: the way back and choosing a
// touch wider (50 - the user's own measure, "трішки ширшими"; the open
// desk still has room for «Документи» whole), "⋯" narrower between them.
const SIDE_W = 50;
const MENU_W = 40;

// WHERE THE BAR STANDS: along the edges the content itself keeps - the
// cards and folder rows, twenty in from either side ("вирівняти по краях
// наших блоків нотаток і папок") - not the dock's narrower row, and no
// wider than a column on a big screen. The dock's two beads below stand
// on the same two edges.
export const TOP_BAR_SIDE = 20;
const TOP_BAR_MAX = 560;
export function topBarFrame(windowWidth: number): { left: number; width: number } {
  const width = Math.min(windowWidth - TOP_BAR_SIDE * 2, TOP_BAR_MAX);
  return { left: (windowWidth - width) / 2, width };
}

// THE SAME CORNERS AS THE DOCK - in shape, not in points. The same 14
// on a piece half as tall is a curve that takes twice the share of it,
// and read as rounder: "радіуси у цій смужці більші, ніж у нижнього
// дока". So the pieces' corner is the dock's scaled by how much shorter
// they are than its pieces, and the plate's stays concentric with them
// (piece + padding), exactly as the dock's plate is with its own.
function cornersFor(windowWidth: number) {
  const piece = Math.round((DOCK_PIECE_RADIUS * PIECE_H) / dockCardHeight(windowWidth));
  return { piece, plate: piece + PLATE_PAD };
}

// Whether the bar is drawn at all: on a touch screen. With a pointer the
// desktop layout keeps the desks where it has them - this is a phone
// experiment, and the desktop is not to be broken by it.
export function useTopNavOn(): boolean {
  return useDensity() === 'touch';
}

export type TopDesk = {
  key: string;
  label: string;
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  onPress: () => void;
  // The desk in front can be closed - a ✕ at its end (see navigation/desks).
  onClose?: () => void;
};

type PathContext = Extract<DockContext, { kind: 'path' }>;

// A screen pushed over the desks (a database opened from «Більше») says
// where it is instead of listing the desks: its own icon and name, one
// piece on the same plate.
// `onPress` makes the title itself a control - the board's name, tapped
// to rename it, the way its old chip at the top was.
export type TopTitle = {
  icon: string;
  label: string;
  onPress?: () => void;
  // A coloured dot in the icon's place: a thought theme's board shows its theme's colour (2026-10-27).
  dot?: string;
  // Several words in the title's place, each a button, the one in force
  // standing out - the left layer's «календар | чат». Replaces the single
  // title (the icon and label are then only its accessibility name).
  choices?: { label: string; active: boolean; onPress?: () => void }[];
};
// A note says where it lives instead: its folder, then its own name -
// "папка › назва", each folder a way to that folder, the name itself the
// place you are.
// `step`: the folder path this crumb stands for - a card held in a finger can be stepped into it (the
// carry's step targets), as on the folder path row.
export type TopTrail = { icon: string; crumbs: { label: string; onPress?: () => void; step?: string }[] };

function TopNavBar({
  desks: desksAll,
  deskPosition,
  title: titleProp,
  trail: trailProp,
  onLongPress,
  saving,
  inline,
  backOverride,
  extrasOverride,
  searchOverride,
  fadeWithDrawer,
  softInline,
}: {
  desks?: TopDesk[];
  // The pager's live position (react-navigation's tab view): the desks' names ride it - see DeskTitles.
  deskPosition?: RNAnimated.Value | RNAnimated.AnimatedInterpolation<number>;
  title?: TopTitle;
  trail?: TopTrail;
  onLongPress?: () => void;
  // Drawn INSIDE something rather than over the whole window - the
  // calendar's drawer: laid out to its width, in the tree (so it moves
  // with it), flat glass (it sits on an opaque surface), and told its
  // back and "⋯" directly instead of reading what the desks published.
  inline?: { width: number };
  backOverride?: TopBack | null;
  extrasOverride?: TopExtras | null;
  searchOverride?: TopSearch | null;
  // The desks' own bar: fades out as a drawer comes in over the desks.
  fadeWithDrawer?: boolean;
  // An inline bar reads no published chrome style (it belongs to its
  // drawer, not to the screen in front), so a drawer that wears the soft
  // style says so here - the calendar's.
  softInline?: boolean;
  // The save indicator, drawn on the extras cluster's own outline - see
  // the note's own call: "індикатор збереження навколо цієї здвоєної
  // кнопки". Screens that never pass it simply never animate.
  saving?: boolean;
}) {
  useRenderTimer('Верхня смужка');
  // THE DESKS ARE IN THE DOCK NOW (features.deskDock, 2026-10-12, the user's: «буде тільки назва нашого поточного
  // столу»): while the dock carries the three, the bar keeps only the one in front - its name, its cross where it
  // can be closed - and the plate is that wide.
  const dockBeads = useDeskBeads();
  const desks = useMemo(
    () => (FEATURES.deskDock && dockBeads?.length && desksAll ? desksAll.filter((d) => d.active) : desksAll),
    [desksAll, dockBeads]
  );
  // While this bar is drawn, the path is drawn in it (not over the dock).
  // A bar inside a drawer is not the window's bar: it says nothing about
  // where the window's path and days should stand.
  useTopNavClaim(!inline);
  // A BASE OPENED FROM THE BASES DESK says where it is (2026-10-12, the user's: «при відкритті бази у верхній
  // стрічці повинен показуватись шлях»): the bases desk marks what it opens (`fromBases`, see DatabasesScreen),
  // and a plain title becomes the trail «Бази › <name>», the first crumb the way back. Read here, once, rather
  // than taught to each of the dozen screens that draw a title.
  const fromBases =
    !inline &&
    FEATURES.basesDesk &&
    !!titleProp &&
    !titleProp.choices &&
    !!(navigationRef.isReady() && (navigationRef.getCurrentRoute()?.params as { fromBases?: boolean } | undefined)?.fromBases);
  const title = fromBases ? undefined : titleProp;
  const trail: TopTrail | undefined =
    trailProp ??
    (fromBases && titleProp
      ? {
          icon: titleProp.icon,
          crumbs: [
            { label: 'Бази', onPress: () => navigationRef.isReady() && navigationRef.canGoBack() && navigationRef.goBack() },
            { label: titleProp.label },
          ],
        }
      : undefined);
  const theme = useTheme();
  const lift = useLift();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const publishedBack = useNavTopBack();
  const publishedExtras = useNavTopExtras();
  const back = inline ? backOverride ?? null : publishedBack;
  const extras = inline ? extrasOverride ?? null : publishedExtras;
  const publishedSearch = useNavTopSearch();
  const [menuOpen, setMenuOpen] = useState(false);
  // THE SOFT CHROME - the look the screen in front asked for (see
  // useChromeStyle; only the Documents desk asks, for now). One capsule
  // under the whole bar instead of three glass pieces, the icons free
  // inside it, a chevron for the way back. A drawer's own inline bar
  // keeps its look.
  const chromeStyle = useNavChromeStyle();
  const soft = inline ? !!softInline : chromeStyle === 'soft';
  // The soft chrome keeps the top for WHERE you are and the dock for what
  // you DO: its search is the dock's own field (ContextDock), so the plate
  // does not open out here as well - the jump from the field below to one
  // above read as two things that disagree.
  const liveSearch = inline ? searchOverride ?? null : soft ? null : publishedSearch;
  const S = useSoft();
  const glassOn = useDockGlass();
  const glassSurface = useDockSurface(S, glassOn);
  // THE BAR ANSWERS A TOUCH (2026-10-25, the user: «висвітлення та невелике збільшення верхньої стрічки при натисканні»): a
  // hair bigger and lighter while a finger is on it, as the dock's pill is.
  const barTouch = useSharedValue(0);
  const barOn = () => {
    barTouch.value = withSpring(1, { damping: 18, stiffness: 420 });
  };
  const barOff = () => {
    barTouch.value = withSpring(0, { damping: 22, stiffness: 300 });
  };
  const barPress = useAnimatedStyle(() => ({ transform: [{ scale: 1 + 0.035 * barTouch.value }] }));
  const barGlow = useAnimatedStyle(() => ({ opacity: (S.dark ? 0.16 : 0.5) * barTouch.value }));
  const gap = soft ? 0 : GAP;
  const ink = soft ? S.ink : theme.glass.ink;
  const inkMuted = soft ? S.ink2 : theme.glass.inkMuted;
  const frame = topBarFrame(inline ? inline.width : windowWidth);
  const cover = useNavDrawerCover();
  const fading = !!fadeWithDrawer && !!cover?.active;
  // The chrome steps back while a list is read (features.chromeCompact): the bar stays SOLID (a see-through one
  // over scrolling text is a mess) but narrows to the plate with the title, the way back and the "⋯" / choosing
  // cluster fading out and taking no touches while folded.
  const compactOn = useChromeCompactFlag() && FEATURES.chromeCompact && !inline;
  const compactCluster = useAnimatedStyle(() => ({ opacity: 1 - chromeCompact.value }));
  const coverProgress = cover?.progress;
  const fadeStyle = useAnimatedStyle(
    () => ({
      opacity: fading && coverProgress ? 1 - Math.max(coverProgress.left.value, coverProgress.right.value) : 1,
    }),
    [fading, coverProgress]
  );
  const barTop = insets.top + CHROME_TOP;
  const corners = cornersFor(windowWidth);
  // The middle: a plate of desks or a pushed database's title - or, on a
  // note, nothing at all ("по центру вгорі — порожньо"), just the room
  // between the two ends.
  const hasMiddle = !!title || !!desks?.length || !!trail;
  // The extras cluster's own width - each button it actually has, on ONE
  // plate with no gaps between them - so the middle takes what is left.
  const toolCount = extras?.tools?.length ?? 0;
  const clusterCount = toolCount + (extras?.menu ? 1 : 0) + (extras?.select ? 1 : 0) + (extras?.pane ? 1 : 0);
  const clusterWidth =
    toolCount * MENU_W + (extras?.menu ? MENU_W : 0) + (extras?.select ? SIDE_W : 0) + (extras?.pane ? SIDE_W : 0);
  // The way back is the dock's circle now (DeskDock): the bar draws none of its own, and keeps the same room on the
  // left as the buttons take on the right, so the name sits on the middle of the SCREEN, not of what is left.
  const dockCarriesBack = useDockCarriesBack();
  const backHidden = FEATURES.deskDock && dockCarriesBack && !inline && soft;
  const rightW = clusterCount > 0 ? clusterWidth + gap : 0;
  // Soft bar: the left side keeps as much room as the right one even with the back button there (empty room after
  // it), so every name stands on the middle of the SCREEN.
  const leftWBase = soft && !inline ? Math.max(SIDE_W + gap, rightW) : backHidden ? rightW : SIDE_W + gap;
  // THE PLAYER'S CAPSULE on the bar's left edge while something is read aloud (thoughts/VoicePlayer.tsx, the
  // user's sketch 2026-10-15): the left keeps room for it, and the right as much again, so the name still stands
  // on the middle of the SCREEN («головне правильно центрувати»). Where the way back is still at the top, the
  // capsule stands after it.
  const capsuleOn = useVoiceCapsuleOn() && !inline;
  const capsuleX = backHidden ? PLATE_PAD : SIDE_W + gap + 4;
  const leftW = capsuleOn ? Math.max(leftWBase, capsuleX + CAPSULE_W + PLATE_PAD, rightW) : leftWBase;
  const rightRoom = capsuleOn ? leftW : rightW;
  const rightExtra = Math.max(0, rightRoom - rightW - gap);
  const plateWidth = frame.width - leftW - rightRoom;
  // The solid pill narrows to the plate while the chrome is folded (see compactOn above).
  // Not to nothing: a see-through pill over scrolling text left the name lost in it (tried 2026-10-12, rim only).
  const compactFill = useAnimatedStyle(() => ({ opacity: 1 - 0.08 * chromeCompact.value }));
  const compactRim = useAnimatedStyle(() => ({ opacity: chromeCompact.value }));
  // The width of the desk's name in front (DeskTitles reports it): folded, the rim wraps just that, a little wider.
  const titleW = useSharedValue(0);
  // 1 while the plate shows a folder PATH: that is wider than any name, so the folded capsule keeps the whole plate
  // (it hugged the last desk name and cut the path off, 2026-10-13).
  const pathOn = useSharedValue(0);
  // The plate and the cluster ease to their new widths when the screen in front has fewer (or more) buttons at the
  // bar's right end - «⋯» slides across to the end, the checking circle dissolves - instead of jumping.
  const plateW = useSharedValue(plateWidth);
  const clusterW = useSharedValue(clusterWidth);
  const leftWv = useSharedValue(leftW);
  const rightExtraV = useSharedValue(rightExtra);
  const capOn = useSharedValue(capsuleOn ? 1 : 0);
  useEffect(() => {
    plateW.value = withTiming(plateWidth, { duration: 260, easing: Easing.out(Easing.cubic) });
    clusterW.value = withTiming(clusterWidth, { duration: 260, easing: Easing.out(Easing.cubic) });
    leftWv.value = withTiming(leftW, { duration: 260, easing: Easing.out(Easing.cubic) });
    rightExtraV.value = withTiming(rightExtra, { duration: 260, easing: Easing.out(Easing.cubic) });
    capOn.value = capsuleOn ? 1 : 0;
  }, [plateWidth, clusterWidth, leftW, rightExtra, capsuleOn, plateW, clusterW, leftWv, rightExtraV, capOn]);
  const rightSpacer = useAnimatedStyle(() => ({ width: rightExtraV.value, height: TOP_NAV_H }));
  const leftSpacer = useAnimatedStyle(() => ({ width: leftWv.value, height: TOP_NAV_H }));
  const clusterSize = useAnimatedStyle(() => ({ width: clusterW.value }));
  // Folded with the capsule: it rides in from the left edge to stand against the name, and the two are centred
  // as one (the name moves over by half the capsule) - the folded pill wraps both.
  const hugPair = (): { pairLeft: number; pairW: number } | null => {
    'worklet';
    if (capOn.value === 0 || pathOn.value !== 0 || titleW.value <= 0) return null;
    const centre = leftWv.value + plateW.value / 2;
    const w = Math.min(plateW.value, titleW.value + 44);
    const pairW = CAPSULE_W + 4 + w;
    return { pairLeft: centre - pairW / 2, pairW };
  };
  const capsuleRide = useAnimatedStyle(() => {
    const pair = hugPair();
    return { transform: [{ translateX: pair ? chromeCompact.value * (pair.pairLeft + 2 - capsuleX) : 0 }] };
  });
  const titleRide = useAnimatedStyle(() => ({
    transform: [{ translateX: hugPair() ? (chromeCompact.value * (CAPSULE_W + 4)) / 2 : 0 }],
  }));
  const compactBg = useAnimatedStyle(() => {
    const c = chromeCompact.value;
    const pair = hugPair();
    if (pair) {
      return {
        left: c * (pair.pairLeft - 2),
        right: c * (frame.width - (pair.pairLeft + pair.pairW)),
        top: c * 4,
        bottom: c * 4,
      };
    }
    const centre = leftWv.value + plateW.value / 2;
    const w = pathOn.value === 0 && titleW.value > 0 ? Math.min(plateW.value, titleW.value + 44) : plateW.value;
    return {
      left: c * (centre - w / 2),
      right: c * (frame.width - (centre + w / 2)),
      // ...and in height too: the capsule hugs the name's line.
      top: c * 7,
      bottom: c * 7,
    };
  });
  const innerWidth = plateWidth - PLATE_PAD * 2;
  // The open desk takes whatever the plate has left once the closed desks
  // and the cuts between them have theirs - so the widths always add up,
  // and one desk grows by exactly what the other gives up.
  const deskCount = desks?.length ?? 0;
  const openWidth = innerWidth - CUT * (deskCount - 1) - PILL_W * (deskCount - 1);
  // The open desk's name, as the room allows (2026-10-03): whole; then cut
  // short with «…»; then, with many desks open, only its icon (and the
  // cross). When even the squares do not fit, the row scrolls.
  const activeDesk = desks?.find((d) => d.active);
  // The same object while its three inputs stand - DesksRow is memoised
  // on it (a fresh one per render redrew every pill on every publish).
  const activeLabel = activeDesk?.label ?? '';
  const activeClosable = !!activeDesk?.onClose;
  const deskLayout = useMemo(() => deskPillLayout(activeLabel, activeClosable, openWidth), [activeLabel, activeClosable, openWidth]);

  // The path, kept drawn from the last one while the plate rolls back to
  // the desks, so it does not empty in the middle of its way out.
  const own = useNavDockOwnContext();
  // A drawer's bar is not where the desk's folder path belongs.
  const path = !inline && own?.kind === 'path' ? own : null;
  useEffect(() => {
    pathOn.value = path ? 1 : 0;
  }, [path, pathOn]);
  const lastPath = useRef<PathContext | null>(null);
  if (path) lastPath.current = path;
  const shownPath = path ?? lastPath.current;

  // 0 = the desks, 1 = the path: one number rolls both, one out as the
  // other comes in.
  const roll = useSharedValue(path ? 1 : 0);
  // A bar that has only just come up learns where it is a moment later
  // (the folder is published after the screen's focus): that is not a
  // move into the folder, so the path is simply there. Rolled, it slid up
  // from below on every return to a folder - "стрибає вниз на пару
  // міліметрів і назад" (2026-10-01).
  const bornAt = useRef(Date.now());
  useEffect(() => {
    const target = path ? 1 : 0;
    if (Date.now() - bornAt.current < 500) roll.value = target;
    else roll.value = withTiming(target, { duration: 280, easing: Easing.inOut(Easing.cubic) });
  }, [path, roll]);
  const travel = TOP_NAV_H;
  const desksStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: -roll.value * travel }],
    opacity: interpolate(roll.value, [0, 0.7], [1, 0], Extrapolation.CLAMP),
  }));
  const pathStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: (1 - roll.value) * travel }],
    opacity: interpolate(roll.value, [0.3, 1], [0, 1], Extrapolation.CLAMP),
  }));

  // SEARCHING: the plate with the name opens out into the field across
  // the whole bar, and the way back and "⋯" are pushed out past the
  // screen's edges ("стрічка може розширювати витісняючи інші кнопки за
  // краї екрану"). The last search is kept drawn while it folds back.
  const lastSearch = useRef<TopSearch | null>(null);
  if (liveSearch) lastSearch.current = liveSearch;
  const searchOpen = !!liveSearch;
  const [searchShown, setSearchShown] = useState(searchOpen);
  const expand = useSharedValue(searchOpen ? 1 : 0);
  useEffect(() => {
    if (searchOpen) setSearchShown(true);
    expand.value = withTiming(
      searchOpen ? 1 : 0,
      { duration: 240, easing: Easing.out(Easing.cubic) },
      (finished) => {
        if (finished && !searchOpen) runOnJS(setSearchShown)(false);
      }
    );
  }, [searchOpen, expand]);
  const barWidth = inline ? inline.width : windowWidth;
  const rightMargin = barWidth - frame.left - frame.width;
  const backAway = useAnimatedStyle(() => ({
    transform: [{ translateX: -(frame.left + SIDE_W) * expand.value }],
    opacity: interpolate(expand.value, [0, 0.6], [1, 0], Extrapolation.CLAMP),
  }));
  // The plate itself grows - the same plate, the same frame inside it -
  // over the way back and out to the bar's far end; "⋯" is pushed along
  // by it and then on past the edge.
  const clusterAway = useAnimatedStyle(() => ({
    transform: [{ translateX: rightMargin * expand.value }],
    opacity: interpolate(expand.value, [0, 0.6], [1, 0], Extrapolation.CLAMP),
  }));
  const plateGrow = useAnimatedStyle(() => ({
    marginLeft: -leftWv.value * expand.value,
    width: plateW.value + (frame.width - plateW.value) * expand.value,
  }));
  const rowsAway = useAnimatedStyle(() => ({
    opacity: interpolate(expand.value, [0, 0.4], [1, 0], Extrapolation.CLAMP),
  }));
  const searchIn = useAnimatedStyle(() => ({
    opacity: interpolate(expand.value, [0.3, 1], [0, 1], Extrapolation.CLAMP),
  }));
  const plateFrost = hasMiddle || searchShown;
  // The pieces inside the plate: in the soft chrome FULLY round, and
  // concentric with the capsule around them (its 23 less the plate's own
  // 6 of padding is exactly half a piece) - a squarer piece inside a
  // round capsule read as "a rectangle in a world of curves" (the desk's
  // name, 2026-09-28).
  const pieceRadius = soft ? PIECE_H / 2 : corners.piece;

  const Layer = inline ? InlineLayer : PortalLayer;
  return (
    <>
    <Layer>
      <FlatFrostContext.Provider value={!!inline}>
      <Animated.View
        // The list's bar or the note's, as the chrome morph photographs it.
        ref={!inline && desks?.length ? chromeNodeRef('bar', 'list') : !inline && trail ? chromeNodeRef('bar', 'note') : undefined}
        collapsable={false}
        pointerEvents={fading && cover?.open ? 'none' : 'box-none'}
        onTouchStart={soft ? barOn : undefined}
        onTouchEnd={soft ? barOff : undefined}
        onTouchCancel={soft ? barOff : undefined}
        style={[styles.row, { top: barTop, left: frame.left, width: frame.width, gap }, fadeStyle, soft ? barPress : undefined]}
      >
        {soft && (
          <>
            <Animated.View
              pointerEvents="none"
              style={[
                StyleSheet.absoluteFill,
                // «Скло» (utils/dockGlass): the bar's capsule wears the dock's glass too.
                glassOn ? glassSurface : { backgroundColor: S.chrome, boxShadow: S.shadow },
                { borderRadius: TOP_NAV_H / 2 },
                !inline && FEATURES.chromeCompact ? compactBg : undefined,
                !inline && FEATURES.chromeCompact ? compactFill : undefined,
              ]}
            >
              {glassOn && <DockGlassFill soft={S} />}
              {/* Lighter while touched - the dock's pill does the same. */}
              <Animated.View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: '#FFFFFF', borderRadius: TOP_NAV_H / 2 }, barGlow]} />
            </Animated.View>
            {/* Folded: no fill at all, only the rim - drawn the moment the fill goes. */}
            {!inline && FEATURES.chromeCompact && (
              <Animated.View
                pointerEvents="none"
                style={[
                  StyleSheet.absoluteFill,
                  { borderRadius: TOP_NAV_H / 2, boxShadow: `0px 0px 0px 1px ${S.dark ? 'rgba(255,255,255,0.2)' : 'rgba(30,30,28,0.17)'}` },
                  compactBg,
                  compactRim,
                ]}
              />
            )}
          </>
        )}
        {backHidden ? (
          // Its own key: the same kind of view in the same place, the back wrapper below would inherit this one's
          // animated width (90) and push the plate and the «⋯ ✓» cluster off the bar's end (2026-10-13).
          <Animated.View key="left-spacer" style={leftSpacer} pointerEvents="none" />
        ) : (
        <Animated.View
          key="back"
          style={[{ flexDirection: 'row' }, !inline && FEATURES.chromeCompact ? compactCluster : undefined]}
          pointerEvents={compactOn ? 'none' : 'box-none'}
        >
        <Animated.View style={backAway} pointerEvents={searchShown ? 'none' : 'auto'}>
        <Pressable
          disabled={!back || back.dimmed}
          onPress={() => back?.onPress()}
          accessibilityLabel="Назад"
          style={{ width: SIDE_W, height: TOP_NAV_H }}
        >
          <Surface soft={soft} style={[styles.piece, !soft && lift]} radius={corners.plate}>
            <View style={(!back || back.dimmed) && { opacity: 0.3 }}>
              <Glyph name={back?.icon ?? 'arrow-back'} size={soft ? 24 : 21} color={ink} soft={soft} />
            </View>
          </Surface>
        </Pressable>
        </Animated.View>
        {leftW > SIDE_W + gap && <View key="left-room" style={{ width: leftW - (SIDE_W + gap) }} pointerEvents="none" />}
        </Animated.View>
        )}

        {/* The plate, and on it whichever of the two rows is in front -
            or, with neither a title nor desks to show, no plate at all:
            just the room it would have taken, between the two ends. */}
        <Animated.View style={[styles.plate, plateFrost && !soft && lift, { borderRadius: plateFrost ? corners.plate : 0 }, plateGrow]}>
          {plateFrost && (
            <>
              {!soft && <DockFrost style={StyleSheet.absoluteFill} radius={corners.plate} />}
              <View style={[styles.viewport, { borderRadius: pieceRadius }]}>
                <Animated.View style={[StyleSheet.absoluteFill, rowsAway, titleRide]} pointerEvents={searchShown ? 'none' : 'box-none'}>
                <Animated.View
                  style={[styles.layer, desksStyle]}
                  pointerEvents={path ? 'none' : 'box-none'}
                >
                  {trail && <TrailRow trail={trail} radius={pieceRadius} ink={ink} inkMuted={inkMuted} soft={soft} />}
                  {title?.choices && (
                    <View style={styles.titlePress}>
                      <Surface soft={soft} style={styles.piece} radius={pieceRadius}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }}>
                          {title.choices.map((choice) => (
                            <Pressable key={choice.label} onPress={choice.onPress} hitSlop={8} accessibilityLabel={choice.label}>
                              <Text
                                numberOfLines={1}
                                style={[styles.label, styles.titleLabel, { color: choice.active ? ink : inkMuted, opacity: choice.active ? 1 : 0.75 }, soft && styles.softLabel]}
                              >
                                {choice.label}
                              </Text>
                            </Pressable>
                          ))}
                        </View>
                      </Surface>
                    </View>
                  )}
                  {title && !title.choices && (
                    <Pressable
                      disabled={!title.onPress}
                      onPress={title.onPress}
                      accessibilityLabel={title.label}
                      style={styles.titlePress}
                    >
                      <Surface soft={soft} style={styles.piece} radius={pieceRadius}>
                        {title.dot ? (
                          <View style={{ width: 12, height: 12, borderRadius: 6, marginHorizontal: 4, backgroundColor: title.dot }} />
                        ) : (
                          <Glyph name={title.icon} size={20} color={ink} soft={soft} />
                        )}
                        <Text numberOfLines={1} style={[styles.label, styles.titleLabel, { color: ink }, soft && styles.softLabel]}>
                          {title.label}
                        </Text>
                      </Surface>
                    </Pressable>
                  )}
                  {!!desks?.length && soft && FEATURES.deskDock && !!dockBeads?.length && (
                    <DeskTitles
                      desks={deskPosition && desksAll ? desksAll : desks}
                      position={deskPosition}
                      width={innerWidth}
                      ink={ink}
                      inkMuted={inkMuted}
                      onLongPress={onLongPress}
                      onActiveWidth={(w) => {
                        titleW.value = w;
                      }}
                    />
                  )}
                  {!!desks?.length && !(soft && FEATURES.deskDock && !!dockBeads?.length) && (
                    <DesksRow
                      desks={desks}
                      radius={pieceRadius}
                      layout={deskLayout}
                      innerWidth={innerWidth}
                      onLongPress={onLongPress}
                      ink={ink}
                      inkMuted={inkMuted}
                      soft={soft ? S : null}
                    />
                  )}
                </Animated.View>
                {shownPath && (
                  <Animated.View style={[styles.layer, pathStyle]} pointerEvents={path ? 'box-none' : 'none'}>
                    <PathRow path={shownPath} radius={pieceRadius} ink={ink} inkMuted={inkMuted} soft={soft ? S : null} />
                  </Animated.View>
                )}
                </Animated.View>
                {searchShown && lastSearch.current && (
                  <Animated.View style={[styles.layer, searchIn]} pointerEvents={searchOpen ? 'box-none' : 'none'}>
                    <SearchRow
                      key={lastSearch.current.placeholder}
                      search={lastSearch.current}
                      radius={pieceRadius}
                      ink={ink}
                      inkMuted={inkMuted}
                      soft={soft ? S : null}
                    />
                  </Animated.View>
                )}
              </View>
            </>
          )}
        </Animated.View>

        {rightExtra > 0 && <Animated.View key="right-room" style={rightSpacer} pointerEvents="none" />}
        {/* "⋯", choosing and (on a Fold pane) expand/collapse as ONE
            piece - "дві кнопки об'єднати": one plate, a hairline between
            the buttons on it, so they read as one control at rest and
            not only while the save ring is tracing round them. */}
        {clusterCount > 0 && (
          <Animated.View
            pointerEvents={searchShown || compactOn ? 'none' : 'auto'}
            style={[styles.cluster, !soft && lift, { borderRadius: corners.plate }, clusterSize, clusterAway, !inline && FEATURES.chromeCompact ? compactCluster : undefined]}
          >
            {!soft && <DockFrost style={[StyleSheet.absoluteFill, styles.clusterEdge]} radius={corners.plate} />}
            {[
              ...(extras?.tools ?? []).map((t) => ({
                key: `tool:${t.key}`,
                width: MENU_W,
                icon: t.icon,
                label: t.label,
                active: !!t.active,
                dot: !!t.dot,
                dimmed: !!t.dimmed,
                onPress: t.onPress,
              })),
              extras?.menu
                ? { key: 'menu', width: MENU_W, icon: 'ellipsis-horizontal', label: 'Ще', active: menuOpen, onPress: () => setMenuOpen((v) => !v) }
                : null,
              extras?.select
                ? { key: 'select', width: SIDE_W, icon: 'checkmark-circle-outline', label: 'Виділити', active: extras.select.active, onPress: extras.select.onPress }
                : null,
              extras?.pane
                ? { key: 'pane', width: SIDE_W, icon: extras.pane.icon, label: 'Розгорнути', active: false, onPress: extras.pane.onPress }
                : null,
            ]
              .filter((b): b is NonNullable<typeof b> => !!b)
              .map((b, i) => (
                <Animated.View key={b.key} entering={FadeIn.duration(220)} exiting={FadeOut.duration(140)}>
                <Pressable
                  disabled={'dimmed' in b && b.dimmed}
                  onPress={b.onPress}
                  accessibilityLabel={b.label}
                  style={[styles.clusterButton, { width: b.width }]}
                >
                  {i > 0 && !soft && <View style={[styles.clusterDivider, { backgroundColor: theme.glass.inkMuted }]} />}
                  <View style={'dimmed' in b && b.dimmed ? { opacity: 0.3 } : null}>
                    <Glyph name={b.icon} size={soft ? 22 : 21} color={b.active ? (soft ? S.accent : theme.accent) : ink} soft={soft} />
                    {'dot' in b && b.dot && (
                      <View
                        pointerEvents="none"
                        style={[styles.toolDot, { backgroundColor: soft ? S.accent : theme.accent, borderColor: soft ? S.chrome : 'transparent' }]}
                      />
                    )}
                  </View>
                </Pressable>
                </Animated.View>
              ))}
            <SaveRing saving={!!saving} color={ink} radius={corners.plate} />
          </Animated.View>
        )}
        {capsuleOn && (
          <Animated.View style={[{ position: 'absolute', left: capsuleX, top: (TOP_NAV_H - CAPSULE_H) / 2 }, capsuleRide]}>
            <VoiceCapsule />
          </Animated.View>
        )}
      </Animated.View>
      </FlatFrostContext.Provider>
    </Layer>
    {/* The screen's own list, hanging from the bar's right end - its own
        portal, not one inside the bar's. */}
    <Menu
      visible={menuOpen && !!extras?.menu}
      onClose={() => setMenuOpen(false)}
      entries={extras?.menu ?? []}
      style={{ position: 'absolute', right: windowWidth - frame.left - frame.width, top: barTop + TOP_NAV_H + (soft ? 8 : 6) }}
      soft={soft ? S : null}
    />
    </>
  );
}

// A piece of the bar: the glass everywhere else, and in the soft chrome
// a plain surface - the capsule under the whole bar is the only material,
// and a piece is either nothing on it or a faint tint (`fill`).
function Surface({
  soft,
  style,
  radius,
  fill,
  children,
}: {
  soft: boolean;
  style?: StyleProp<ViewStyle>;
  radius: number;
  fill?: string;
  children?: ReactNode;
}) {
  if (!soft) {
    return (
      <DockFrost style={style} radius={radius}>
        {children}
      </DockFrost>
    );
  }
  return <View style={[style, styles.softPiece, { borderRadius: radius, backgroundColor: fill ?? 'transparent' }]}>{children}</View>;
}

// An Ionicons name, drawn as the soft style's own icon where it has one
// (see SoftIcon) - the few shapes that most gave the old chrome away.
const SOFT_GLYPHS: Record<string, SoftIconName> = {
  'arrow-back': 'back',
  'chevron-back': 'back',
  'ellipsis-horizontal': 'more',
  'checkmark-circle-outline': 'select',
  'search-outline': 'search',
  'close-outline': 'close',
  close: 'close',
  'document-text-outline': 'doc',
  'document-text': 'doc',
  'folder-outline': 'folder',
  'trash-outline': 'trash',
};
function Glyph({ name, size, color, soft }: { name: string; size: number; color: string; soft: boolean }) {
  const own = soft ? SOFT_GLYPHS[name] : undefined;
  if (own) return <SoftIcon name={own} size={size} color={color} />;
  return <Ionicons name={name as keyof typeof Ionicons.glyphMap} size={size - (soft ? 2 : 0)} color={color} />;
}

// Where the bar is drawn: over the whole window through the glass layer,
// or - inline - right where it is in the tree, covering what it is in.
// Hidden at once under the chrome morph's stand-in (utils/chromeMorph),
// which draws its picture in exactly its place.
function PortalLayer({ children }: { children: ReactNode }) {
  const cover = useAnimatedStyle(() => ({ opacity: 1 - chromeCover.value }));
  return (
    <GlassPortal priority={1} name="topBar">
      <Animated.View style={[StyleSheet.absoluteFill, cover]} pointerEvents="box-none">
        {children}
      </Animated.View>
    </GlassPortal>
  );
}

function InlineLayer({ children }: { children: ReactNode }) {
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      {children}
    </View>
  );
}

// The field inside the plate: the same frame the name sits in, holding
// the input instead. It keeps what is typed itself and hands every change
// to the screen.
function SearchRow({
  search,
  radius,
  ink,
  inkMuted,
  soft,
}: {
  search: TopSearch;
  radius: number;
  ink: string;
  inkMuted: string;
  soft: SoftTokens | null;
}) {
  useRenderTimer('Смужка: пошук');
  const [text, setText] = useState(search.initialQuery);
  return (
    <Surface soft={!!soft} fill={soft?.fill} style={[styles.piece, styles.searchPiece]} radius={radius}>
      {soft ? <SoftIcon name="search" size={20} color={inkMuted} /> : <Ionicons name="search" size={19} color={inkMuted} />}
      <TextInput
        autoFocus
        value={text}
        onChangeText={(next) => {
          setText(next);
          search.onChangeQuery(next);
        }}
        placeholder={search.placeholder}
        placeholderTextColor={inkMuted}
        returnKeyType="search"
        selectionColor={soft?.accent}
        cursorColor={soft?.accent}
        style={[styles.searchInput, { color: ink }, soft && { fontFamily: SOFT_REGULAR }]}
      />
      <Pressable
        hitSlop={8}
        onPress={() => {
          // The field's own close: puts the keyboard away too - it was
          // only ever the screen behind it (useSearchDismissal, on
          // keyboardDidHide) that did that, and this button skipped it
          // ("хрестик в пошуку також повинен опускати клавіатуру").
          Keyboard.dismiss();
          search.onClose();
        }}
        accessibilityLabel="Закрити пошук"
        style={styles.searchClose}
      >
        {soft ? <SoftIcon name="close" size={20} color={ink} /> : <Ionicons name="close" size={20} color={ink} />}
      </Pressable>
    </Surface>
  );
}

// ONE desk, sized by one number that eases between closed and open - so
// the one closing gives up exactly what the one opening takes, and the
// name opens with the room it is given rather than all at once.
// HOW THE OPEN DESK IS DRAWN, from the room it has: its name whole, cut
// short with «…», or not at all. `width` is what it takes.
type DeskPillLayout = { mode: 'full' | 'cut' | 'icon'; width: number; labelRoom: number };
// The cross: a roomy target (34) standing 14 clear of the icon - at 22 and
// 6 they stood so close that a thumb aimed at one hit the other
// (2026-10-03).
const CROSS_ROOM = 48;
const CHAR_W = 8.6;
function deskPillLayout(label: string, closable: boolean, room: number): DeskPillLayout {
  const cross = closable ? CROSS_ROOM : 0;
  // Icon, the gap before the name, a little air at either end.
  const chrome = 20 + 8 + 16 + cross;
  const natural = chrome + label.length * CHAR_W;
  // The shortest name worth showing: three letters and the dots.
  const shortest = chrome + 4 * CHAR_W;
  if (room >= natural) return { mode: 'full', width: room, labelRoom: Math.max(0, room - chrome) };
  if (room >= shortest) return { mode: 'cut', width: room, labelRoom: Math.max(0, room - chrome) };
  // Icon alone: the icon and its cross with air round both - wider than
  // the closed desks, which makes the row scroll sooner, as a browser's
  // does.
  return { mode: 'icon', width: 20 + 24 + cross, labelRoom: 0 };
}

// The desks of the bar, in a row that scrolls when there are more than fit,
// the open one kept in view.
const DesksRow = memo(function DesksRow({
  desks,
  radius,
  layout,
  innerWidth,
  onLongPress,
  ink,
  inkMuted,
  soft,
}: {
  desks: TopDesk[];
  radius: number;
  layout: DeskPillLayout;
  innerWidth: number;
  onLongPress?: () => void;
  ink: string;
  inkMuted: string;
  soft: SoftTokens | null;
}) {
  useRenderTimer('Смужка: столи');
  const scroll = useRef<ScrollView>(null);
  const activeIndex = Math.max(0, desks.findIndex((d) => d.active));
  const total = (desks.length - 1) * (PILL_W + CUT) + layout.width;
  const overflows = total > innerWidth + 1;
  // The closed desks before it are all squares, so where it starts is
  // known without measuring.
  const activeAt = activeIndex * (PILL_W + CUT);
  useEffect(() => {
    if (!overflows) {
      scroll.current?.scrollTo({ x: 0, animated: false });
      return;
    }
    // After the desk has opened out (its width animates).
    const timer = setTimeout(
      () => scroll.current?.scrollTo({ x: Math.max(0, activeAt - (innerWidth - layout.width) / 2), animated: true }),
      280
    );
    return () => clearTimeout(timer);
  }, [overflows, activeAt, innerWidth, layout.width]);
  return (
    <ScrollView
      ref={scroll}
      horizontal
      scrollEnabled={overflows}
      showsHorizontalScrollIndicator={false}
      style={styles.desksScroll}
      contentContainerStyle={styles.desksRow}
    >
      {desks.map((desk) => (
        <DeskPill
          key={desk.key}
          radius={radius}
          layout={layout}
          desk={desk}
          onLongPress={onLongPress}
          ink={ink}
          inkMuted={inkMuted}
          soft={soft}
        />
      ))}
    </ScrollView>
  );
});

function DeskPill({
  radius,
  layout,
  desk,
  onLongPress,
  ink,
  inkMuted,
  soft,
}: {
  radius: number;
  layout: DeskPillLayout;
  desk: TopDesk;
  onLongPress?: () => void;
  ink: string;
  inkMuted: string;
  // The soft chrome: the open desk is a faint tint on the capsule, the
  // closed ones nothing at all - no glass piece for each.
  soft: SoftTokens | null;
}) {
  const target = desk.active ? layout.width : PILL_W;
  const width = useSharedValue(target);
  useEffect(() => {
    width.value = withTiming(target, { duration: 260, easing: Easing.inOut(Easing.cubic) });
  }, [target, width]);
  const pillStyle = useAnimatedStyle(() => ({ width: width.value }));
  // How open, 0..1 - the label's room and how visible it is.
  const showName = layout.mode !== 'icon';
  const labelRoom = layout.labelRoom;
  const openTo = layout.width;
  const labelStyle = useAnimatedStyle(() => {
    const open = showName ? interpolate(width.value, [PILL_W, Math.max(PILL_W + 1, openTo)], [0, 1], Extrapolation.CLAMP) : 0;
    return {
      // The room left beside the icon once fully open (icon, the gap,
      // a little air each side and the cross), handed out as it opens.
      maxWidth: open * labelRoom,
      marginLeft: 8 * open,
      opacity: open,
    };
  });
  return (
    <Animated.View style={pillStyle}>
      <Pressable
        onPress={desk.onPress}
        // The capture window used to open from a long press on the desks
        // in the dock; the desks are here now, so is it.
        onLongPress={onLongPress}
        delayLongPress={400}
        accessibilityLabel={desk.label}
        style={styles.fill}
      >
        <Surface soft={!!soft} fill={desk.active ? soft?.fill : undefined} style={[styles.piece, styles.clip]} radius={radius}>
          {soft ? (
            <Glyph name={desk.icon} size={20} color={desk.active ? ink : soft.ink3} soft />
          ) : (
            <Ionicons
              name={(desk.active ? desk.icon.replace(/-outline$/, '') : desk.icon) as keyof typeof Ionicons.glyphMap}
              size={20}
              color={desk.active ? ink : inkMuted}
            />
          )}
          <Animated.View style={[styles.labelBox, labelStyle]}>
            <Text numberOfLines={1} ellipsizeMode="tail" style={[styles.label, { color: ink }, soft && styles.softLabel]}>
              {desk.label}
            </Text>
          </Animated.View>
          {desk.active && desk.onClose && (
            <Pressable hitSlop={8} onPress={desk.onClose} accessibilityLabel="Закрити стіл" style={styles.deskClose}>
              {soft ? <SoftIcon name="close" size={15} color={inkMuted} /> : <Ionicons name="close" size={16} color={inkMuted} />}
            </Pressable>
          )}
        </Surface>
      </Pressable>
    </Animated.View>
  );
}

// THE DESK'S NAME, ALONE (2026-10-12, the user's: «залиш лише текст ... при прокручуванні столів текст назви одного
// вікна їде ліворуч або праворуч, з'являється наступна»): no capsule under it; the names of all the desks lie side
// by side, each as wide as the plate, and the row rides the pager's own position - a swipe between desks carries
// the name out one side and the next in from the other, and a tap does the same, since the pager moves either way.
// Without a position (the web build) only the desk in front is drawn, still.
function DeskTitles({
  desks,
  position,
  width,
  ink,
  inkMuted,
  onLongPress,
  onActiveWidth,
}: {
  desks: TopDesk[];
  position?: RNAnimated.Value | RNAnimated.AnimatedInterpolation<number>;
  width: number;
  ink: string;
  inkMuted: string;
  onLongPress?: () => void;
  // The width of the name in front, for the folded rim to wrap.
  onActiveWidth?: (w: number) => void;
}) {
  const activeIndex = Math.max(0, desks.findIndex((d) => d.active));
  const shift = useMemo(
    () =>
      position && desks.length > 1
        ? position.interpolate({
            inputRange: desks.map((_, i) => i),
            outputRange: desks.map((_, i) => -i * width),
            extrapolate: 'clamp',
          })
        : -activeIndex * width,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [position, desks.length, width, position ? 0 : activeIndex]
  );
  // The name stays centred while the plate's width changes (a screen with fewer buttons at its right end): the
  // plate itself eases to the new width, and the name eases from where it stood to where it now centres.
  const comp = useSharedValue(0);
  const prevWidth = useRef(width);
  useEffect(() => {
    if (prevWidth.current === width) return;
    comp.value = (prevWidth.current - width) / 2;
    comp.value = withTiming(0, { duration: 260, easing: Easing.out(Easing.cubic) });
    prevWidth.current = width;
  }, [width, comp]);
  const compStyle = useAnimatedStyle(() => ({ transform: [{ translateX: comp.value }] }));
  return (
    <View style={{ width, height: PIECE_H, overflow: 'hidden' }}>
      <Animated.View style={compStyle}>
      <RNAnimated.View style={{ flexDirection: 'row', width: width * desks.length, transform: [{ translateX: shift }] }}>
        {desks.map((desk, i) => {
          // The name dissolves as it rides out and as the next rides in.
          const fade =
            position && desks.length > 1
              ? position.interpolate({ inputRange: [i - 0.7, i, i + 0.7], outputRange: [0, 1, 0], extrapolate: 'clamp' })
              : 1;
          const label = [styles.label, styles.softLabel, { color: ink }];
          return (
            <RNAnimated.View key={desk.key} style={{ width, height: PIECE_H, opacity: fade }}>
              <Pressable
                onPress={desk.onPress}
                onLongPress={onLongPress}
                delayLongPress={400}
                accessibilityLabel={desk.label}
                style={{ width, height: PIECE_H, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
              >
                <Text
                  numberOfLines={1}
                  style={label}
                  onLayout={(e) => desk.active && onActiveWidth?.(e.nativeEvent.layout.width)}
                >
                  {desk.label}
                </Text>
                {desk.active && desk.onClose && (
                  <Pressable hitSlop={8} onPress={desk.onClose} accessibilityLabel="Закрити стіл" style={styles.deskClose}>
                    <SoftIcon name="close" size={15} color={inkMuted} />
                  </Pressable>
                )}
              </Pressable>
            </RNAnimated.View>
          );
        })}
      </RNAnimated.View>
      </Animated.View>
    </View>
  );
}
// Where a note lives: its database's glyph, then the folders down to it,
// then its own name - the same look as the folder path below, and the
// same rule: every crumb but the last is a way there.
function TrailRow({
  trail,
  radius,
  ink,
  inkMuted,
  soft = false,
}: {
  trail: TopTrail;
  radius: number;
  ink: string;
  inkMuted: string;
  soft?: boolean;
}) {
  useRenderTimer('Смужка: слід');
  const targets = useNavDockTargets();
  const scroll = useRef<ScrollView>(null);
  return (
    <>
      <View style={{ width: PILL_W, height: PIECE_H }}>
        <Surface soft={soft} style={styles.piece} radius={radius}>
          <Glyph name={trail.icon} size={20} color={ink} soft={soft} />
        </Surface>
      </View>
      <Surface soft={soft} style={[styles.piece, styles.crumbsPiece]} radius={radius}>
        <ScrollView
          ref={scroll}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.crumbs}
          // The note's own name is the one that matters: always in view.
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        >
          {trail.crumbs.map((crumb, i) => {
            const current = i === trail.crumbs.length - 1;
            return (
              <View key={`${i}:${crumb.label}`} style={styles.crumbRow}>
                {i > 0 && <Ionicons name="chevron-forward" size={13} color={inkMuted} />}
                {current || !crumb.onPress ? (
                  <Text numberOfLines={1} style={[styles.crumb, current && styles.crumbCurrent, { color: current ? ink : inkMuted }]}>
                    {crumb.label}
                  </Text>
                ) : (
                  <View ref={crumb.step !== undefined ? targets?.(crumb.step) : undefined} collapsable={false}>
                    <Pressable hitSlop={6} onPress={crumb.onPress}>
                      <Text numberOfLines={1} style={[styles.crumb, { color: inkMuted }]}>
                        {crumb.label}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      </Surface>
    </>
  );
}

// The folder path in the desks' place: the database's own icon first (the
// root), then the folders down to the one you are in. Every crumb but the
// last is a way up; a card being carried can be stepped into them too
// (the targets the dock's own path registered).
function PathRow({
  path,
  radius,
  ink,
  inkMuted,
  soft,
}: {
  path: PathContext;
  radius: number;
  ink: string;
  inkMuted: string;
  soft: SoftTokens | null;
}) {
  useRenderTimer('Смужка: шлях');
  const targets = useNavDockTargets();
  const scroll = useRef<ScrollView>(null);
  // ONE name only (the bin, a folder at the first level): centred like a desk's name, not a circle and a word
  // pushed to the left (the user, 2026-10-13: «назва корзина не по центру»). A tap on it still goes to the root.
  if (soft && path.crumbs.length === 1) {
    return (
      <View ref={targets?.('')} collapsable={false} style={{ flex: 1, height: PIECE_H }}>
        <Pressable
          onPress={() => path.onGo('')}
          accessibilityLabel="Корінь"
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }}
        >
          <Glyph name={path.icon} size={20} color={ink} soft />
          <Text numberOfLines={1} style={[styles.label, styles.softLabel, { color: ink, marginLeft: 8 }]}>
            {path.crumbs[0]}
          </Text>
        </Pressable>
      </View>
    );
  }
  return (
    <>
      <View ref={targets?.('')} collapsable={false}>
        <Pressable onPress={() => path.onGo('')} accessibilityLabel="Корінь" style={{ width: PILL_W, height: PIECE_H }}>
          <Surface soft={!!soft} fill={soft?.fill} style={styles.piece} radius={radius}>
            <Glyph name={path.icon} size={20} color={ink} soft={!!soft} />
          </Surface>
        </Pressable>
      </View>
      <Surface soft={!!soft} style={[styles.piece, styles.crumbsPiece]} radius={radius}>
        <ScrollView
          ref={scroll}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.crumbs}
          // The deepest folder is the one that matters: always in view.
          onContentSizeChange={() => scroll.current?.scrollToEnd({ animated: false })}
        >
          {path.crumbs.map((segment, i) => {
            const target = path.crumbs.slice(0, i + 1).join('/');
            const current = i === path.crumbs.length - 1;
            return (
              <View key={target} style={styles.crumbRow}>
                {i > 0 && <Ionicons name="chevron-forward" size={13} color={inkMuted} />}
                {current ? (
                  <Text numberOfLines={1} style={[styles.crumb, styles.crumbCurrent, { color: ink }]}>
                    {segment}
                  </Text>
                ) : (
                  <View ref={targets?.(target)} collapsable={false}>
                    <Pressable hitSlop={6} onPress={() => path.onGo(target)}>
                      <Text numberOfLines={1} style={[styles.crumb, { color: inkMuted }]}>
                        {segment}
                      </Text>
                    </Pressable>
                  </View>
                )}
              </View>
            );
          })}
        </ScrollView>
      </Surface>
    </>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    height: TOP_NAV_H,
    flexDirection: 'row',
    gap: GAP,
  },
  plate: {
    height: TOP_NAV_H,
  },
  // The "⋯" / choosing / pane buttons on one plate, so the save ring
  // traces one outline around all of them rather than one each.
  cluster: {
    height: TOP_NAV_H,
    flexDirection: 'row',
  },
  clusterEdge: {
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  toolDot: { position: 'absolute', right: -3, top: -2, width: 8, height: 8, borderRadius: 4, borderWidth: 1.5 },
  clusterButton: {
    height: TOP_NAV_H,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The hairline between two buttons on the plate - absolutely placed so
  // it takes no width from either.
  clusterDivider: {
    position: 'absolute',
    left: 0,
    top: '25%',
    height: '50%',
    width: StyleSheet.hairlineWidth,
    opacity: 0.45,
  },
  // The plate's inside, clipped: the rows roll through its edges.
  viewport: {
    flex: 1,
    margin: PLATE_PAD,
    overflow: 'hidden',
  },
  layer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: PIECE_H,
    flexDirection: 'row',
    gap: CUT,
  },
  clip: {
    overflow: 'hidden',
  },
  // The desks' row inside the plate: a scroll, so many desks never push
  // anything out; its pieces stand CUT apart as they always did.
  desksScroll: {
    flex: 1,
  },
  desksRow: {
    gap: CUT,
    height: PIECE_H,
  },
  labelBox: {
    overflow: 'hidden',
  },
  fill: {
    flex: 1,
  },
  piece: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    // The hairline every piece of the dock carries.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  crumbsPiece: {
    justifyContent: 'flex-start',
  },
  crumbs: {
    alignItems: 'center',
    paddingHorizontal: 12,
    gap: 6,
  },
  crumbRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  crumb: {
    fontSize: 14,
    fontFamily: FONT_MEDIUM,
    maxWidth: 160,
  },
  crumbCurrent: {
    fontFamily: FONT_SEMIBOLD,
  },
  label: {
    fontSize: 15,
    fontFamily: FONT_MEDIUM,
  },
  titleLabel: {
    marginLeft: 8,
    flexShrink: 1,
  },
  titlePress: {
    flex: 1,
  },
  searchPiece: {
    justifyContent: 'flex-start',
    paddingLeft: 12,
    paddingRight: 2,
    gap: 8,
  },
  searchInput: {
    flex: 1,
    height: PIECE_H,
    paddingVertical: 0,
    fontSize: 16,
    fontFamily: FONT_REGULAR,
  },
  searchClose: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The soft chrome's piece: no glass, no hairline - see Surface.
  softPiece: {
    borderWidth: 0,
  },
  softLabel: {
    fontFamily: SOFT_SEMIBOLD,
    letterSpacing: -0.2,
  },
  deskClose: {
    marginLeft: 14,
    width: 34,
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

// Rendered only when its own props or the published bar change - see the
// desks' bar in FloatingIslandTabBar, which keeps its props stable for it.
// THE PROPS COMPARED BY WHAT THEY SAY (2026-10-06). Nearly every screen
// hands the bar `title={{ icon, label }}` - a fresh object each render - so
// the default shallow comparison saw a change every time and the memo did
// nothing: the bar redrew whenever its screen did (5x per note opened).
// A title or trail is equal when its words, icons and handlers are.
function sameTitle(a?: TopTitle, b?: TopTitle): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  if (a.icon !== b.icon || a.label !== b.label || a.onPress !== b.onPress) return false;
  const ac = a.choices;
  const bc = b.choices;
  if (ac === bc) return true;
  if (!ac || !bc || ac.length !== bc.length) return false;
  return ac.every((c, i) => c.label === bc[i].label && c.active === bc[i].active && c.onPress === bc[i].onPress);
}
function sameTrail(a?: TopTrail, b?: TopTrail): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.icon === b.icon &&
    a.crumbs.length === b.crumbs.length &&
    // A crumb's handler goes where its label says (the editor builds it from
    // the folder path), so equal words are an equal crumb - the handlers
    // are made fresh on every render of the note.
    a.crumbs.every((c, i) => c.label === b.crumbs[i].label && !!c.onPress === !!b.crumbs[i].onPress)
  );
}
type BarProps = React.ComponentProps<typeof TopNavBar>;
function sameBar(prev: BarProps, next: BarProps): boolean {
  if (!sameTitle(prev.title, next.title) || !sameTrail(prev.trail, next.trail)) return false;
  // `inline` is a `{ width }` made fresh by its caller as well.
  if (prev.inline !== next.inline && prev.inline?.width !== next.inline?.width) return false;
  if (!!prev.inline !== !!next.inline) return false;
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  for (const k of keys) {
    if (k === 'title' || k === 'trail' || k === 'inline') continue;
    if (!Object.is((prev as Record<string, unknown>)[k], (next as Record<string, unknown>)[k])) return false;
  }
  return true;
}
export default memo(TopNavBar, sameBar);
