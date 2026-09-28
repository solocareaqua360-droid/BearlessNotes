import { createContext, RefObject, useContext, useEffect, useMemo, useState } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useIsFocused } from '@react-navigation/native';
import { BackHandler, InteractionManager, StyleSheet, View, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import CalendarScreen from '../screens/CalendarScreen';
import { CalendarDrawerContext, useSideDrawers } from '../navigation/sideDrawers';
import { DockLayerContext } from '../navigation/navDock';
import { LayoutFrameContext } from '../hooks/useResponsiveLayout';
import { useFrostPaused } from './frostPause';

// The whole window: the calendar is not a drawer any more but a SCREEN
// laid over the desk - iOS's own widgets page, which is the model the
// user settled on ("як в iOS ... ліворуч шторка з віджетами").
export const SIDE_DRAWER_FRACTION = 1;

// What the calendar's layer blurs: the desks, and only the desks - their
// own blur target (see Tabs), so the layer's blur never has to draw the
// layer itself.
export const DeskTargetContext = createContext<RefObject<View | null> | null>(null);

// THE CALENDAR, THE LEFTMOST SCREEN, OVER THE DESK - "календар
// повноцінний ... в крайньому лівому екрані і блюром поверх робочого
// столу". The same CalendarScreen, told it lives here
// (CalendarDrawerContext): it draws its own bar and dock inside the layer
// and publishes nothing for the window's, which fade out as it comes in.
//
// Two parts that move differently, on purpose. The BLUR of the desk
// stands still and only fades in: a live blur that moves every frame is
// the freeze this app has already met (see DockFrost). The CALENDAR on it
// slides with the finger.
//
// Drawn IN the tree, not through the glass portal: the calendar needs the
// navigation around it, and a portal renders outside that.
export default function CalendarDrawer() {
  const { calendarOpen, closeCalendar, calendarProgress, calendarDragging } = useSideDrawers();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const width = Math.round(windowWidth * SIDE_DRAWER_FRACTION);
  const deskTarget = useContext(DeskTargetContext);
  // Mounted AHEAD of the first swipe - once the app has settled - and
  // kept: building the whole calendar at the moment of the first swipe
  // is a stall under the finger. The day, the month and the note then
  // stay where they were left, the way a desk does.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setMounted(true));
    return () => task.cancel();
  }, []);
  const fallback = useSharedValue(0);
  const progress = calendarProgress ?? fallback;
  // The blur is only there while it can be seen - a live blur left
  // mounted behind a shut layer would go on redrawing the desk for
  // nothing. And it steps down to a plain dim while something heavy
  // scrolls over it (the overview's pages - see frostPause).
  const frostPaused = useFrostPaused();
  const blurShown = (calendarOpen || calendarDragging) && !frostPaused;

  // Opened or shut from anywhere but a swipe (back, the bar's arrow): the
  // layer finishes the way there on its own. A swipe has already put it
  // where it is going, so this only settles it.
  useEffect(() => {
    if (calendarOpen) setMounted(true);
    progress.value = withTiming(calendarOpen ? 1 : 0, { duration: 200, easing: Easing.out(Easing.cubic) });
  }, [calendarOpen, progress]);

  // Only while the desks are in front: a note opened from the calendar is
  // pushed over them, and its "back" is its own.
  const tabsFocused = useIsFocused();
  useEffect(() => {
    if (!calendarOpen || !tabsFocused) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeCalendar();
      return true;
    });
    return () => sub.remove();
  }, [calendarOpen, closeCalendar, tabsFocused]);

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: (progress.value - 1) * width }] }), [width]);
  const groundStyle = useAnimatedStyle(() => ({ opacity: progress.value }));
  const frame = useMemo(() => ({ width, height: windowHeight }), [width, windowHeight]);
  const drawer = useMemo(() => ({ open: calendarOpen, close: closeCalendar }), [calendarOpen, closeCalendar]);
  // Shut by a swipe to the LEFT, following the finger the same way it
  // opened. Only a clearly sideways drag: up and down is the calendar's.
  const closeSwipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX(-14)
        .failOffsetY([-12, 12])
        .onUpdate((e) => {
          progress.value = Math.min(1, Math.max(0, 1 + e.translationX / width));
        })
        .onEnd((e) => {
          const shut = e.translationX < -width * 0.3 || e.velocityX < -500;
          progress.value = withTiming(shut ? 0 : 1, { duration: 180, easing: Easing.out(Easing.cubic) });
          if (shut) runOnJS(closeCalendar)();
        }),
    [progress, width, closeCalendar]
  );

  if (!mounted) return null;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents={calendarOpen ? 'box-none' : 'none'}>
      {/* The desk, out of focus: a still blur that fades in, over a dim
          that carries it when the blur is stepped down. */}
      <Animated.View style={[StyleSheet.absoluteFill, styles.dim, groundStyle]} pointerEvents="none">
        {blurShown && deskTarget && (
          <BlurView
            intensity={70}
            tint="dark"
            blurMethod="dimezisBlurView"
            blurTarget={deskTarget}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
        )}
      </Animated.View>
      <GestureDetector gesture={closeSwipe}>
        <Animated.View style={[styles.panel, { width }, panelStyle]} pointerEvents={calendarOpen ? 'auto' : 'none'}>
          <LayoutFrameContext.Provider value={frame}>
            <DockLayerContext.Provider value={1}>
              <CalendarDrawerContext.Provider value={drawer}>
                <CalendarScreen />
              </CalendarDrawerContext.Provider>
            </DockLayerContext.Provider>
          </LayoutFrameContext.Provider>
        </Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: {
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  panel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
});
