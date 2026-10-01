import { Ionicons } from './icons/Ionicons';
import { chromeCover, chromeNodeRef } from '../utils/chromeMorph';
import { ReactNode, useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleProp, StyleSheet, Text, TextInput, useWindowDimensions, View, ViewStyle } from 'react-native';
import Animated, { Easing, Extrapolation, interpolate, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DockFrost, { FlatFrostContext } from './DockFrost';
import { GlassPortal } from './GlassPortal';
import { useLift, useTheme } from '../theme/ThemeProvider';
import { CHROME_TOP } from '../constants/rail';
import { DOCK_PIECE_RADIUS, dockCardHeight } from '../navigation/dockGeometry';
import Menu from './surfaces/Menu';
import SaveRing from './SaveRing';
import { DockContext, TopBack, TopExtras, TopSearch, useNavChromeStyle, useNavDockOwnContext, useNavDockTargets, useNavDrawerCover, useNavTopBack, useNavTopExtras, useNavTopSearch, useTopNavClaim } from '../navigation/navDock';
import SoftIcon, { SoftIconName } from './SoftIcon';
import { SoftTokens, useSoft } from '../theme/soft';
import { FONT_MEDIUM, FONT_REGULAR, FONT_SEMIBOLD, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { useDensity } from '../hooks/useDensity';

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
export type TopTitle = { icon: string; label: string; onPress?: () => void };
// A note says where it lives instead: its folder, then its own name -
// "папка › назва", each folder a way to that folder, the name itself the
// place you are.
export type TopTrail = { icon: string; crumbs: { label: string; onPress?: () => void }[] };

export default function TopNavBar({
  desks,
  title,
  trail,
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
  // While this bar is drawn, the path is drawn in it (not over the dock).
  // A bar inside a drawer is not the window's bar: it says nothing about
  // where the window's path and days should stand.
  useTopNavClaim(!inline);
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
  const gap = soft ? 0 : GAP;
  const ink = soft ? S.ink : theme.glass.ink;
  const inkMuted = soft ? S.ink2 : theme.glass.inkMuted;
  const frame = topBarFrame(inline ? inline.width : windowWidth);
  const cover = useNavDrawerCover();
  const fading = !!fadeWithDrawer && !!cover?.active;
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
  const plateWidth = frame.width - (SIDE_W + gap) - (clusterCount > 0 ? clusterWidth + gap : 0);
  const innerWidth = plateWidth - PLATE_PAD * 2;
  // The open desk takes whatever the plate has left once the closed desks
  // and the cuts between them have theirs - so the widths always add up,
  // and one desk grows by exactly what the other gives up.
  const deskCount = desks?.length ?? 0;
  const openWidth = innerWidth - CUT * (deskCount - 1) - PILL_W * (deskCount - 1);
  // The name only where it fits whole: on a narrow screen the open desk
  // is its highlighted icon alone rather than a name cut in half.
  const nameFits = (label: string) => openWidth - 20 - 8 - 16 >= label.length * 8.4;

  // The path, kept drawn from the last one while the plate rolls back to
  // the desks, so it does not empty in the middle of its way out.
  const own = useNavDockOwnContext();
  // A drawer's bar is not where the desk's folder path belongs.
  const path = !inline && own?.kind === 'path' ? own : null;
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
    marginLeft: -(SIDE_W + gap) * expand.value,
    width: plateWidth + (frame.width - plateWidth) * expand.value,
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
        style={[styles.row, { top: barTop, left: frame.left, width: frame.width, gap }, fadeStyle]}
      >
        {soft && (
          <View
            pointerEvents="none"
            style={[StyleSheet.absoluteFill, { backgroundColor: S.chrome, borderRadius: TOP_NAV_H / 2, boxShadow: S.shadow }]}
          />
        )}
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

        {/* The plate, and on it whichever of the two rows is in front -
            or, with neither a title nor desks to show, no plate at all:
            just the room it would have taken, between the two ends. */}
        <Animated.View style={[styles.plate, plateFrost && !soft && lift, { borderRadius: plateFrost ? corners.plate : 0 }, plateGrow]}>
          {plateFrost && (
            <>
              {!soft && <DockFrost style={StyleSheet.absoluteFill} radius={corners.plate} />}
              <View style={[styles.viewport, { borderRadius: pieceRadius }]}>
                <Animated.View style={[StyleSheet.absoluteFill, rowsAway]} pointerEvents={searchShown ? 'none' : 'box-none'}>
                <Animated.View
                  style={[styles.layer, desksStyle]}
                  pointerEvents={path ? 'none' : 'box-none'}
                >
                  {trail && <TrailRow trail={trail} radius={pieceRadius} ink={ink} inkMuted={inkMuted} soft={soft} />}
                  {title && (
                    <Pressable
                      disabled={!title.onPress}
                      onPress={title.onPress}
                      accessibilityLabel={title.label}
                      style={styles.titlePress}
                    >
                      <Surface soft={soft} style={styles.piece} radius={pieceRadius}>
                        <Glyph name={title.icon} size={20} color={ink} soft={soft} />
                        <Text numberOfLines={1} style={[styles.label, styles.titleLabel, { color: ink }, soft && styles.softLabel]}>
                          {title.label}
                        </Text>
                      </Surface>
                    </Pressable>
                  )}
                  {desks?.map((desk) => (
                    <DeskPill
                      key={desk.key}
                      radius={pieceRadius}
                      showName={nameFits(desk.label)}
                      desk={desk}
                      openWidth={openWidth}
                      onLongPress={onLongPress}
                      ink={ink}
                      inkMuted={inkMuted}
                      soft={soft ? S : null}
                    />
                  ))}
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

        {/* "⋯", choosing and (on a Fold pane) expand/collapse as ONE
            piece - "дві кнопки об'єднати": one plate, a hairline between
            the buttons on it, so they read as one control at rest and
            not only while the save ring is tracing round them. */}
        {clusterCount > 0 && (
          <Animated.View
            pointerEvents={searchShown ? 'none' : 'auto'}
            style={[styles.cluster, !soft && lift, { width: clusterWidth, borderRadius: corners.plate }, clusterAway]}
          >
            {!soft && <DockFrost style={[StyleSheet.absoluteFill, styles.clusterEdge]} radius={corners.plate} />}
            {[
              ...(extras?.tools ?? []).map((t) => ({
                key: `tool:${t.key}`,
                width: MENU_W,
                icon: t.icon,
                label: t.label,
                active: false,
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
                <Pressable
                  key={b.key}
                  disabled={'dimmed' in b && b.dimmed}
                  onPress={b.onPress}
                  accessibilityLabel={b.label}
                  style={[styles.clusterButton, { width: b.width }]}
                >
                  {i > 0 && !soft && <View style={[styles.clusterDivider, { backgroundColor: theme.glass.inkMuted }]} />}
                  <View style={'dimmed' in b && b.dimmed ? { opacity: 0.3 } : null}>
                    <Glyph name={b.icon} size={soft ? 22 : 21} color={b.active ? (soft ? S.accent : theme.accent) : ink} soft={soft} />
                  </View>
                </Pressable>
              ))}
            <SaveRing saving={!!saving} color={ink} radius={corners.plate} />
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
    <GlassPortal priority={1}>
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
function DeskPill({
  radius,
  showName,
  desk,
  openWidth,
  onLongPress,
  ink,
  inkMuted,
  soft,
}: {
  radius: number;
  showName: boolean;
  desk: TopDesk;
  openWidth: number;
  onLongPress?: () => void;
  ink: string;
  inkMuted: string;
  // The soft chrome: the open desk is a faint tint on the capsule, the
  // closed ones nothing at all - no glass piece for each.
  soft: SoftTokens | null;
}) {
  const target = desk.active ? openWidth : PILL_W;
  const width = useSharedValue(target);
  useEffect(() => {
    width.value = withTiming(target, { duration: 260, easing: Easing.inOut(Easing.cubic) });
  }, [target, width]);
  const pillStyle = useAnimatedStyle(() => ({ width: width.value }));
  // How open, 0..1 - the label's room and how visible it is.
  const labelStyle = useAnimatedStyle(() => {
    const open = showName ? interpolate(width.value, [PILL_W, openWidth], [0, 1], Extrapolation.CLAMP) : 0;
    return {
      // The room left beside the icon once fully open (icon, the gap,
      // a little air each side), handed out as the desk opens.
      maxWidth: open * Math.max(0, openWidth - 21 - 8 - 16),
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
            <Text numberOfLines={1} ellipsizeMode="clip" style={[styles.label, { color: ink }, soft && styles.softLabel]}>
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
                  <Pressable hitSlop={6} onPress={crumb.onPress}>
                    <Text numberOfLines={1} style={[styles.crumb, { color: inkMuted }]}>
                      {crumb.label}
                    </Text>
                  </Pressable>
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
  const targets = useNavDockTargets();
  const scroll = useRef<ScrollView>(null);
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
    marginLeft: 6,
    width: 22,
    height: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
