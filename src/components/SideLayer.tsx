import { ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { NavigationContext, NavigationRouteContext, useIsFocused } from '@react-navigation/native';
import { BackHandler, InteractionManager, StyleSheet, View, useWindowDimensions } from 'react-native';
import { BlurView } from 'expo-blur';
import Animated, { Easing, runOnJS, SharedValue, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { SideDrawersContext } from '../navigation/sideDrawers';
import { DockLayerContext } from '../navigation/navDock';
import { LayoutFrameContext } from '../hooks/useResponsiveLayout';
import { GlassPortal } from './GlassPortal';
import { useBlurTarget } from './GlassTarget';
import { usePauseFrost } from './frostPause';

// ONE OF THE TWO SCREENS BESIDE THE DESKS - the user's iOS model: the
// calendar to the left of the first desk (the widgets page), the
// databases to the right of the last (the app library). Each is the whole
// window, laid over the desk with the desk blurred behind it.
//
// Two parts that move differently, on purpose. The BLUR of the desk
// stands still and only fades in: a live blur that moves every frame is
// the freeze this app has already met (see DockFrost). The SCREEN on it
// slides with the finger.
//
// Both go through the glass portal, as every sheet does: a blur only
// works from outside the picture it blurs (the screens), and the screen
// has to stand above that blur. The portal renders outside this tree, so
// the navigation and the drawers' state it needs are handed to it again -
// the desks' own navigation and route, as a screen's children would
// have them.
export default function SideLayer({
  side,
  open,
  close,
  progress: progressValue,
  dragging,
  children,
}: {
  side: 'left' | 'right';
  open: boolean;
  close: () => void;
  progress: SharedValue<number> | null;
  dragging: boolean;
  children: ReactNode;
}) {
  const { width, height: windowHeight } = useWindowDimensions();
  const blurTarget = useBlurTarget();
  const navigation = useContext(NavigationContext);
  const route = useContext(NavigationRouteContext);
  const sideDrawers = useContext(SideDrawersContext);
  // Mounted AHEAD of the first swipe - once the app has settled - and
  // kept: building the whole screen at the moment of the first swipe is a
  // stall under the finger, and what was open in it stays open.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const task = InteractionManager.runAfterInteractions(() => setMounted(true));
    return () => task.cancel();
  }, []);
  const fallback = useSharedValue(0);
  const progress = progressValue ?? fallback;
  // Whether the desks are the screen in front. The layer is drawn above
  // EVERY screen, so anything it opens (a note, a database) would open
  // underneath it: while another screen is in front the layer steps
  // aside, whole, and comes back as it was.
  const tabsFocused = useIsFocused();
  // The blur only while it can be seen - left mounted behind a shut layer
  // it would go on redrawing the desk for nothing.
  const blurShown = (open || dragging) && tabsFocused;
  // The glass UNDER the layer - the desks' bar, the dock, a database's
  // project pills - is only faded out, not gone, and each piece of it
  // went on blurring the screen every frame: half a dozen to a dozen live
  // blurs nobody could see. While the layer is up they stand down to flat
  // glass (frostPause); the layer's own blur is not paused.
  usePauseFrost(open && tabsFocused);

  // Opened or shut from anywhere but a swipe (back, the bar's arrow): the
  // layer finishes the way there on its own. A swipe has already put it
  // where it is going, so this only settles it.
  useEffect(() => {
    if (open) setMounted(true);
    progress.value = withTiming(open ? 1 : 0, { duration: 200, easing: Easing.out(Easing.cubic) });
  }, [open, progress]);

  useEffect(() => {
    if (!open || !tabsFocused) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      close();
      return true;
    });
    return () => sub.remove();
  }, [open, close, tabsFocused]);

  // From the left edge it comes in from -width, from the right from +width.
  const direction = side === 'left' ? -1 : 1;
  const panelStyle = useAnimatedStyle(
    () => ({ transform: [{ translateX: (1 - progress.value) * width * direction }] }),
    [width, direction]
  );
  // An animated opacity outranks a plain one, so stepping aside is said here.
  const groundStyle = useAnimatedStyle(() => ({ opacity: tabsFocused ? progress.value : 0 }), [tabsFocused]);
  const frame = useMemo(() => ({ width, height: windowHeight }), [width, windowHeight]);
  // Shut by a swipe back the way it came, following the finger. Only a
  // clearly sideways drag: up and down belongs to the screen.
  const closeSwipe = useMemo(
    () =>
      Gesture.Pan()
        .activeOffsetX(direction * 14)
        .failOffsetY([-12, 12])
        .onUpdate((e) => {
          progress.value = Math.min(1, Math.max(0, 1 - (e.translationX * direction) / width));
        })
        .onEnd((e) => {
          const travelled = e.translationX * direction;
          const shut = travelled > width * 0.3 || e.velocityX * direction > 500;
          progress.value = withTiming(shut ? 0 : 1, { duration: 180, easing: Easing.out(Easing.cubic) });
          if (shut) runOnJS(close)();
        }),
    [progress, width, close, direction]
  );

  if (!mounted) return null;
  return (
    <>
      {/* The desk, out of focus: a still blur that fades in, over a dim
          that carries it while the blur is not there. */}
      <GlassPortal priority={-2}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.dim, groundStyle]} pointerEvents="none">
          {blurShown && blurTarget && (
            <BlurView
              intensity={70}
              tint="dark"
              blurMethod="dimezisBlurView"
              blurTarget={blurTarget}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
          )}
        </Animated.View>
      </GlassPortal>
      {/* The screen itself: over its blur, under the dock and the bars
          (faded out while it is open) and under every sheet it opens. */}
      <GlassPortal priority={-1}>
        <NavigationContext.Provider value={navigation}>
          <NavigationRouteContext.Provider value={route}>
            <SideDrawersContext.Provider value={sideDrawers}>
              <View
                style={[StyleSheet.absoluteFill, !tabsFocused && styles.aside]}
                pointerEvents={open && tabsFocused ? 'box-none' : 'none'}
              >
                <GestureDetector gesture={closeSwipe}>
                  <Animated.View style={[styles.panel, { width }, panelStyle]} pointerEvents={open ? 'auto' : 'none'}>
                    <LayoutFrameContext.Provider value={frame}>
                      <DockLayerContext.Provider value={1}>{children}</DockLayerContext.Provider>
                    </LayoutFrameContext.Provider>
                  </Animated.View>
                </GestureDetector>
              </View>
            </SideDrawersContext.Provider>
          </NavigationRouteContext.Provider>
        </NavigationContext.Provider>
      </GlassPortal>
    </>
  );
}

const styles = StyleSheet.create({
  dim: {
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  // Out of sight while another screen is in front, but still mounted.
  aside: {
    opacity: 0,
  },
  panel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
  },
});
