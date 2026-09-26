import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DockFrost from './DockFrost';
import { GlassPortal } from './GlassPortal';
import { useLift, useTheme } from '../theme/ThemeProvider';
import { CHROME_TOP } from '../constants/rail';
import { DOCK_PIECE_RADIUS, dockRowLeft, dockRowWidth } from '../navigation/dockGeometry';
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
// What a desk's own screen adds above its content so nothing starts
// under the bar - the bar and the breath under it.
export const TOP_NAV_SPACE = TOP_NAV_H + 10;
const PILL_W = 52;

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

  return (
    <GlassPortal>
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
          <Animated.View
            key={desk.key}
            layout={LinearTransition.duration(220)}
            style={desk.active ? styles.activeSlot : { width: PILL_W }}
          >
            <Pressable
              onPress={desk.onPress}
              // The capture window used to open from a long press on the
              // desks in the dock; the desks are here now, so is it.
              onLongPress={onLongPress}
              delayLongPress={400}
              accessibilityLabel={desk.label}
              style={styles.fill}
            >
              <DockFrost style={piece} radius={DOCK_PIECE_RADIUS}>
                <Ionicons
                  name={(desk.active ? desk.icon.replace(/-outline$/, '') : desk.icon) as keyof typeof Ionicons.glyphMap}
                  size={21}
                  color={desk.active ? theme.glass.ink : theme.glass.inkMuted}
                />
                {desk.active && (
                  <Text numberOfLines={1} style={[styles.label, { color: theme.glass.ink }]}>
                    {desk.label}
                  </Text>
                )}
              </DockFrost>
            </Pressable>
          </Animated.View>
        ))}
      </View>
    </GlassPortal>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    height: TOP_NAV_H,
    flexDirection: 'row',
    gap: 6,
  },
  activeSlot: {
    flex: 1,
    minWidth: 0,
  },
  fill: {
    flex: 1,
  },
  piece: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    // The hairline every piece of the dock carries.
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  label: {
    fontSize: 15,
    fontFamily: FONT_MEDIUM,
    flexShrink: 1,
  },
});
