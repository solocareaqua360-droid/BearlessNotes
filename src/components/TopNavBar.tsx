import { Ionicons } from '@expo/vector-icons';
import { useEffect } from 'react';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { Easing, Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DockFrost from './DockFrost';
import { GlassPortal } from './GlassPortal';
import { useLift, useTheme } from '../theme/ThemeProvider';
import { CHROME_TOP } from '../constants/rail';
import { DOCK_PATH_H, DOCK_PIECE_RADIUS, dockRowLeft, dockRowWidth } from '../navigation/dockGeometry';
import { useNavTopBack } from '../navigation/navDock';
import { FONT_MEDIUM } from '../utils/fonts';
import { useDensity } from '../hooks/useDensity';

// THE DESKS, AT THE TOP - the user's plan after looking at Notion: the
// way back in the top-left corner, then one piece per desk, and the desk
// you are on opens out to carry its name. Only on the four desks' own
// screens for now ("поки на головних екранах, щоб все не зламати");
// everywhere else the dock keeps them.
//
// Lined up with the dock under it: the same left and right edges, the
// same material and corner.
export const TOP_NAV_H = 46;
// Where the path or the days rest, measured from the bar's own top: right
// under it (ContextDock draws them there while the bar is up).
export const TOP_STRIP_OFFSET = TOP_NAV_H + 6;
// What a desk's own screen adds above its content so nothing starts
// under the bar - the bar, the room the path or the days rest in, and
// the breath under them. The room is kept whether or not a strip is
// showing, so nothing below jumps when one comes ("зарезервувати місце").
export const TOP_NAV_SPACE = TOP_STRIP_OFFSET + DOCK_PATH_H + 10;
const PILL_W = 52;
const GAP = 6;

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

export default function TopNavBar({ desks, onLongPress }: { desks: TopDesk[]; onLongPress?: () => void }) {
  const theme = useTheme();
  const lift = useLift();
  const insets = useSafeAreaInsets();
  const { width: windowWidth } = useWindowDimensions();
  const back = useNavTopBack();
  const piece = [styles.piece, lift];
  const rowWidth = dockRowWidth(windowWidth);
  // The open desk takes whatever the row has left once the back button
  // and the closed desks have theirs - so the widths always add up to
  // the row, and one desk grows by exactly what the other gives up.
  const openWidth = rowWidth - TOP_NAV_H - GAP * desks.length - PILL_W * (desks.length - 1);

  return (
    // Above the dock's own layer: the path and the days come out from
    // BEHIND this bar.
    <GlassPortal priority={1}>
      <View
        pointerEvents="box-none"
        style={[styles.row, { top: insets.top + CHROME_TOP, left: dockRowLeft(windowWidth), width: dockRowWidth(windowWidth) }]}
      >
        <Pressable
          disabled={!back || back.dimmed}
          onPress={() => back?.onPress()}
          accessibilityLabel="Назад"
          style={{ width: TOP_NAV_H, height: TOP_NAV_H }}
        >
          <DockFrost style={piece} radius={DOCK_PIECE_RADIUS}>
            <Ionicons
              name="arrow-back"
              size={21}
              color={theme.glass.ink}
              style={(!back || back.dimmed) && { opacity: 0.3 }}
            />
          </DockFrost>
        </Pressable>
        {desks.map((desk) => (
          <DeskPill
            key={desk.key}
            desk={desk}
            openWidth={openWidth}
            onLongPress={onLongPress}
            pieceStyle={piece}
            ink={theme.glass.ink}
            inkMuted={theme.glass.inkMuted}
          />
        ))}
      </View>
    </GlassPortal>
  );
}

// ONE desk, sized by one number that eases between closed and open.
//
// It used to be a layout animation on a flex switch, and that is what
// read as "виїжджає звідкись": each desk was moved from its old frame to
// its new one on its own, content already at its final size, so nothing
// said that one desk was growing BECAUSE its neighbour was shrinking.
// Now every desk's width is said outright and eased on the same clock -
// the one closing gives up exactly what the one opening takes, the row
// never changes length, and the others simply ride along. The name
// opens with the room it is given rather than appearing all at once.
function DeskPill({
  desk,
  openWidth,
  onLongPress,
  pieceStyle,
  ink,
  inkMuted,
}: {
  desk: TopDesk;
  openWidth: number;
  onLongPress?: () => void;
  pieceStyle: object[];
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
        <DockFrost style={[pieceStyle, styles.clip]} radius={DOCK_PIECE_RADIUS}>
          <Ionicons
            name={(desk.active ? desk.icon.replace(/-outline$/, '') : desk.icon) as keyof typeof Ionicons.glyphMap}
            size={21}
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

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    height: TOP_NAV_H,
    flexDirection: 'row',
    gap: GAP,
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
  label: {
    fontSize: 15,
    fontFamily: FONT_MEDIUM,
  },
});
