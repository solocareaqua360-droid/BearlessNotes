import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DockFrost from './DockFrost';
import { GlassPortal } from './GlassPortal';
import { useLift, useTheme } from '../theme/ThemeProvider';
import { CHROME_TOP } from '../constants/rail';
import { DOCK_PIECE_RADIUS, dockCardHeight, dockRowLeft, dockRowWidth } from '../navigation/dockGeometry';
import { DockContext, useNavDockOwnContext, useNavDockTargets, useNavTopBack } from '../navigation/navDock';
import { FONT_MEDIUM, FONT_SEMIBOLD } from '../utils/fonts';
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
export const TOP_NAV_SPACE = TOP_NAV_H + 10;
// The plate's own padding and the cut between its pieces - the bottom
// dock's numbers (ContextDock's PLATE_PAD and DOCK_CUT).
const PLATE_PAD = 6;
const CUT = 3;
const PIECE_H = TOP_NAV_H - PLATE_PAD * 2;
// A closed desk: a little wider than tall, big enough to hit.
const PILL_W = 44;
const GAP = 6;

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
};

type PathContext = Extract<DockContext, { kind: 'path' }>;

export default function TopNavBar({ desks, onLongPress }: { desks: TopDesk[]; onLongPress?: () => void }) {
  const theme = useTheme();
  const lift = useLift();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const back = useNavTopBack();
  const rowWidth = dockRowWidth(windowWidth);
  const corners = cornersFor(windowWidth);
  const plateWidth = rowWidth - TOP_NAV_H - GAP;
  const innerWidth = plateWidth - PLATE_PAD * 2;
  // The open desk takes whatever the plate has left once the closed desks
  // and the cuts between them have theirs - so the widths always add up,
  // and one desk grows by exactly what the other gives up.
  const openWidth = innerWidth - CUT * (desks.length - 1) - PILL_W * (desks.length - 1);

  // The path, kept drawn from the last one while the plate rolls back to
  // the desks, so it does not empty in the middle of its way out.
  const own = useNavDockOwnContext();
  const path = own?.kind === 'path' ? own : null;
  const lastPath = useRef<PathContext | null>(null);
  if (path) lastPath.current = path;
  const shownPath = path ?? lastPath.current;

  // 0 = the desks, 1 = the path: one number rolls both, one out as the
  // other comes in.
  const roll = useSharedValue(path ? 1 : 0);
  useEffect(() => {
    roll.value = withTiming(path ? 1 : 0, { duration: 280, easing: Easing.inOut(Easing.cubic) });
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

  return (
    <GlassPortal priority={1}>
      <View
        pointerEvents="box-none"
        style={[styles.row, { top: insets.top + CHROME_TOP, left: dockRowLeft(windowWidth), width: rowWidth }]}
      >
        <Pressable
          disabled={!back || back.dimmed}
          onPress={() => back?.onPress()}
          accessibilityLabel="Назад"
          style={{ width: TOP_NAV_H, height: TOP_NAV_H }}
        >
          <DockFrost style={[styles.piece, lift]} radius={corners.plate}>
            <Ionicons
              name="arrow-back"
              size={21}
              color={theme.glass.ink}
              style={(!back || back.dimmed) && { opacity: 0.3 }}
            />
          </DockFrost>
        </Pressable>

        {/* The plate, and on it whichever of the two rows is in front. */}
        <View style={[styles.plate, lift, { width: plateWidth, borderRadius: corners.plate }]}>
          <DockFrost style={StyleSheet.absoluteFill} radius={corners.plate} />
          <View style={[styles.viewport, { borderRadius: corners.piece }]}>
            <Animated.View
              style={[styles.layer, desksStyle]}
              pointerEvents={path ? 'none' : 'box-none'}
            >
              {desks.map((desk) => (
                <DeskPill
                  key={desk.key}
                  radius={corners.piece}
                  desk={desk}
                  openWidth={openWidth}
                  onLongPress={onLongPress}
                  ink={theme.glass.ink}
                  inkMuted={theme.glass.inkMuted}
                />
              ))}
            </Animated.View>
            {shownPath && (
              <Animated.View style={[styles.layer, pathStyle]} pointerEvents={path ? 'box-none' : 'none'}>
                <PathRow path={shownPath} radius={corners.piece} ink={theme.glass.ink} inkMuted={theme.glass.inkMuted} />
              </Animated.View>
            )}
          </View>
        </View>
      </View>
    </GlassPortal>
  );
}

// ONE desk, sized by one number that eases between closed and open - so
// the one closing gives up exactly what the one opening takes, and the
// name opens with the room it is given rather than all at once.
function DeskPill({
  radius,
  desk,
  openWidth,
  onLongPress,
  ink,
  inkMuted,
}: {
  radius: number;
  desk: TopDesk;
  openWidth: number;
  onLongPress?: () => void;
  ink: string;
  inkMuted: string;
}) {
  const target = desk.active ? openWidth : PILL_W;
  const width = useSharedValue(target);
  useEffect(() => {
    width.value = withTiming(target, { duration: 260, easing: Easing.inOut(Easing.cubic) });
  }, [target, width]);
  const pillStyle = useAnimatedStyle(() => ({ width: width.value }));
  // How open, 0..1 - the label's room and how visible it is.
  const labelStyle = useAnimatedStyle(() => {
    const open = interpolate(width.value, [PILL_W, openWidth], [0, 1], Extrapolation.CLAMP);
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
        <DockFrost style={[styles.piece, styles.clip]} radius={radius}>
          <Ionicons
            name={(desk.active ? desk.icon.replace(/-outline$/, '') : desk.icon) as keyof typeof Ionicons.glyphMap}
            size={20}
            color={desk.active ? ink : inkMuted}
          />
          <Animated.View style={[styles.labelBox, labelStyle]}>
            <Text numberOfLines={1} ellipsizeMode="clip" style={[styles.label, { color: ink }]}>
              {desk.label}
            </Text>
          </Animated.View>
        </DockFrost>
      </Pressable>
    </Animated.View>
  );
}

// The folder path in the desks' place: the database's own icon first (the
// root), then the folders down to the one you are in. Every crumb but the
// last is a way up; a card being carried can be stepped into them too
// (the targets the dock's own path registered).
function PathRow({ path, radius, ink, inkMuted }: { path: PathContext; radius: number; ink: string; inkMuted: string }) {
  const targets = useNavDockTargets();
  const scroll = useRef<ScrollView>(null);
  return (
    <>
      <View ref={targets?.('')} collapsable={false}>
        <Pressable onPress={() => path.onGo('')} accessibilityLabel="Корінь" style={{ width: PILL_W, height: PIECE_H }}>
          <DockFrost style={styles.piece} radius={radius}>
            <Ionicons name={path.icon as keyof typeof Ionicons.glyphMap} size={20} color={ink} />
          </DockFrost>
        </Pressable>
      </View>
      <DockFrost style={[styles.piece, styles.crumbsPiece]} radius={radius}>
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
      </DockFrost>
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
});
