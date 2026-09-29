import { useContext, useEffect, useRef } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DockFrost from './DockFrost';
import { GlassIcon } from './GlassDrop';
import { GlassPortal } from './GlassPortal';
import { Ionicons } from './icons/Ionicons';
import { useLift, useTheme } from '../theme/ThemeProvider';
import { useSoft } from '../theme/soft';
import { useDensity } from '../hooks/useDensity';
import { LayoutFrameContext } from '../hooks/useResponsiveLayout';
import { DESKTOP_TABS_HEIGHT, DESKTOP_TOOLBAR_ROW, useDesktopRailWidth } from '../constants/desktop';
import { DOCK_PIECE_RADIUS, dockCardHeight, dockRowLeft, dockRowWidth } from '../navigation/dockGeometry';
import { FONT_REGULAR } from '../utils/fonts';

// SEARCH, IN THE TOP-LEFT CORNER - for now. The dock's left bead became
// the way back ("кнопка назад є одним із головних якорів"), and search
// has no settled home yet; it floats over the screen on purpose, so it
// cannot be forgotten that it still needs one.
//
// Lined up with the dock rather than placed by eye: its left edge is the
// back bead's left edge, it is the bead's width and half its height, the
// dock's own material and corner. Open, it widens to exactly the dock's
// row - its right edge is the "+" bead's right edge - and becomes the
// field itself.
//
// A screen whose search is somewhere else (the diary, the search across
// everything) passes no `onClose`: the corner then only takes you there.
// How tall the corner is - half the dock's bead. A screen that keeps room
// for the open field (so the list starts below it) reads this.
export function searchCornerHeight(windowWidth: number): number {
  return Math.round(dockCardHeight(windowWidth) / 2);
}

export default function SearchCorner({
  visible = true,
  open = false,
  query = '',
  onChangeQuery,
  placeholder = 'Пошук',
  onOpen,
  onClose,
  soft = false,
}: {
  visible?: boolean;
  open?: boolean;
  query?: string;
  onChangeQuery?: (next: string) => void;
  placeholder?: string;
  onOpen: () => void;
  onClose?: () => void;
  // The soft style's own pill - a plain card, no frost - for the screens
  // that wear it (theme/soft).
  soft?: boolean;
}) {
  const theme = useTheme();
  const lift = useLift();
  const S = useSoft();
  const { width: windowWidth } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const bead = dockCardHeight(windowWidth);
  const height = searchCornerHeight(windowWidth);
  // At a pointer the corner stands at the main pane's left edge, beside the
  // rail - the dock's row is a phone's geometry, and in a window with side
  // panels it landed under the toolbar's buttons.
  const pointer = useDensity() === 'pointer';
  // Inside a side panel (the frame it really has) the corner stands at the
  // panel's own top-left, in its toolbar's row - the portal it draws
  // through is the panel's, not the window's.
  const frame = useContext(LayoutFrameContext);
  const inPanel = pointer && !!frame;
  const railWidth = useDesktopRailWidth();
  const full = inPanel ? Math.min(320, (frame?.width ?? 320) - 24) : pointer ? 320 : dockRowWidth(windowWidth);
  const left = inPanel ? 12 : pointer ? railWidth + 16 : dockRowLeft(windowWidth);
  const expanded = open && !!onClose;

  const width = useSharedValue(expanded ? full : bead);
  useEffect(() => {
    width.value = withTiming(expanded ? full : bead, { duration: 220, easing: Easing.out(Easing.cubic) });
  }, [expanded, full, bead, width]);
  const widthStyle = useAnimatedStyle(() => ({ width: width.value }));

  // The field takes the keyboard as it opens - a beat late, so it is on
  // screen and focusable by then.
  const input = useRef<TextInput>(null);
  useEffect(() => {
    if (!expanded) return;
    const id = setTimeout(() => input.current?.focus(), 60);
    return () => clearTimeout(id);
  }, [expanded]);

  if (!visible) return null;
  return (
    <GlassPortal>
      <Animated.View
        pointerEvents="box-none"
        style={[
          styles.wrap,
          // At a pointer: in the toolbar's row, under the tabs.
          {
            top: inPanel
              ? Math.round((DESKTOP_TOOLBAR_ROW - height) / 2)
              : pointer
                ? DESKTOP_TABS_HEIGHT + Math.round((DESKTOP_TOOLBAR_ROW - height) / 2)
                : insets.top + 6,
            left,
            height,
          },
          widthStyle,
        ]}
      >
        {soft ? (
          <View
            style={[
              styles.piece,
              { backgroundColor: S.card, borderWidth: 0, borderRadius: DOCK_PIECE_RADIUS, boxShadow: S.shadow },
            ]}
          >
            {expanded ? (
              <>
                <Ionicons name="search-outline" size={17} color={S.ink3} style={styles.lead} />
                <TextInput
                  ref={input}
                  value={query}
                  onChangeText={onChangeQuery}
                  placeholder={placeholder}
                  placeholderTextColor={S.ink3}
                  returnKeyType="search"
                  style={[styles.input, { color: S.ink }]}
                />
                <Pressable
                  hitSlop={10}
                  style={styles.close}
                  onPress={() => {
                    Keyboard.dismiss();
                    onClose?.();
                  }}
                >
                  <Ionicons name="close-outline" size={18} color={S.ink3} />
                </Pressable>
              </>
            ) : (
              <Pressable style={styles.tap} hitSlop={8} onPress={onOpen} accessibilityLabel="Пошук">
                <Ionicons name="search-outline" size={18} color={S.ink} />
              </Pressable>
            )}
          </View>
        ) : (
        <DockFrost style={[styles.piece, lift]} radius={DOCK_PIECE_RADIUS}>
          {expanded ? (
            <>
              <GlassIcon name="search-outline" size={17} tone="muted" style={styles.lead} />
              <TextInput
                ref={input}
                value={query}
                onChangeText={onChangeQuery}
                placeholder={placeholder}
                placeholderTextColor={theme.ink.faint}
                returnKeyType="search"
                style={[styles.input, { color: theme.ink.primary }]}
              />
              <Pressable
                hitSlop={10}
                style={styles.close}
                onPress={() => {
                  Keyboard.dismiss();
                  onClose?.();
                }}
              >
                <GlassIcon name="close-outline" size={18} tone="muted" />
              </Pressable>
            </>
          ) : (
            <Pressable style={styles.tap} hitSlop={8} onPress={onOpen} accessibilityLabel="Пошук">
              <GlassIcon name="search-outline" size={18} />
            </Pressable>
          )}
        </DockFrost>
        )}
      </Animated.View>
    </GlassPortal>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
  },
  piece: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    // The hairline the dock's own pieces carry (ContextDock's cardEdge).
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  tap: {
    flex: 1,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lead: {
    marginLeft: 10,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    paddingVertical: 0,
    paddingHorizontal: 8,
  },
  close: {
    paddingHorizontal: 10,
    alignSelf: 'stretch',
    justifyContent: 'center',
  },
});
