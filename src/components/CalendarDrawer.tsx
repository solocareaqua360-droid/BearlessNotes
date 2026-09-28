import { useEffect, useMemo, useState } from 'react';
import { BackHandler, Pressable, StyleSheet, View, useWindowDimensions } from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import CalendarScreen from '../screens/CalendarScreen';
import { CalendarDrawerContext, useSideDrawers } from '../navigation/sideDrawers';
import { DockLayerContext } from '../navigation/navDock';
import { LayoutFrameContext } from '../hooks/useResponsiveLayout';
import { useTheme } from '../theme/ThemeProvider';

// How much of the window the drawer takes: the old smartfolders drawer's
// two thirds, widened by half of what was left beside it - "розширити ще
// на половину її відстані до правого краю екрану".
export const SIDE_DRAWER_FRACTION = 5 / 6;

// THE CALENDAR, IN A DRAWER FROM THE LEFT - the whole calendar, not a
// preview of it ("функціонал залишається повний"): the same screen, told
// the width it really has (LayoutFrameContext) and that it lives in a
// drawer (CalendarDrawerContext). It publishes to the bar and the dock on
// a layer above the desks (DockLayerContext) for as long as it is open,
// so its search, pencil and "⋯" take over and the desk's come straight
// back when it closes.
//
// Drawn IN the tree, not through the glass portal: the calendar needs the
// navigation around it (it opens notes, the diary), and a portal renders
// outside that. Being in the tree also puts it under the bar and the dock,
// which are portal-drawn - exactly where they should be. No live blur in
// it for the same reason every board surface has none: it is inside the
// blur target, so it is painted solid.
export default function CalendarDrawer() {
  const theme = useTheme();
  const { calendarOpen, closeCalendar } = useSideDrawers();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const width = Math.round(windowWidth * SIDE_DRAWER_FRACTION);
  // Mounted the first time it is opened, and kept: the day, the month and
  // the note stay where they were left, the way a desk does.
  const [mounted, setMounted] = useState(false);
  const progress = useSharedValue(0);

  useEffect(() => {
    if (calendarOpen) setMounted(true);
    progress.value = withTiming(calendarOpen ? 1 : 0, { duration: 260, easing: Easing.out(Easing.cubic) });
  }, [calendarOpen, progress]);

  useEffect(() => {
    if (!calendarOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeCalendar();
      return true;
    });
    return () => sub.remove();
  }, [calendarOpen, closeCalendar]);

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (progress.value - 1) * width }] }), [width]);
  const dimStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const frame = useMemo(() => ({ width, height: windowHeight }), [width, windowHeight]);
  const drawer = useMemo(() => ({ open: calendarOpen, close: closeCalendar }), [calendarOpen, closeCalendar]);

  if (!mounted) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Animated.View
        style={[StyleSheet.absoluteFill, { backgroundColor: theme.scrim }, dimStyle]}
        pointerEvents={calendarOpen ? 'auto' : 'none'}
      >
        <Pressable style={StyleSheet.absoluteFill} onPress={closeCalendar} />
      </Animated.View>
      <Animated.View
        style={[styles.panel, { width, backgroundColor: theme.ground }, panelStyle]}
        pointerEvents={calendarOpen ? 'auto' : 'none'}
      >
        <LayoutFrameContext.Provider value={frame}>
          <DockLayerContext.Provider value={1}>
            <CalendarDrawerContext.Provider value={drawer}>
              <CalendarScreen />
            </CalendarDrawerContext.Provider>
          </DockLayerContext.Provider>
        </LayoutFrameContext.Provider>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  panel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    overflow: 'hidden',
    borderTopRightRadius: 24,
    borderBottomRightRadius: 24,
    borderRightWidth: 1,
    borderRightColor: 'rgba(255,255,255,0.18)',
  },
});
