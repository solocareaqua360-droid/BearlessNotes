import { useMemo, useState } from 'react';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Easing, runOnJS, useSharedValue, withTiming } from 'react-native-reanimated';
import FloatingIslandTabBar from '../components/FloatingIslandTabBar';
import CalendarDrawer, { SIDE_DRAWER_FRACTION } from '../components/CalendarDrawer';
import { SideDrawersProvider, useSideDrawers } from './sideDrawers';
import { TAB_SCREENS } from './tabScreens';

// Material top tabs, not bottom tabs: the navigator the desks were built
// on when they were swiped between. Its "top" is nominal here; the tab
// bar is our own (TopNavBar, drawn through the portal), and the navigator
// shows no bar of its own.
//
// The browser gets a different navigator for the same tabs - see
// Tabs.web.tsx - because the pager these swiped on has no web build.
const Tab = createMaterialTopTabNavigator();

// The band across the middle of the screen a sideways swipe has to start
// in - the same band the smartfolders drawer used, away from the top
// (the bar) and the bottom (the dock), and away from the screen's edges,
// which Android keeps for its own "back".
const BAND = 0.3;

export default function Tabs() {
  return (
    <SideDrawersProvider>
      <TabsWithDrawers />
    </SideDrawersProvider>
  );
}

function TabsWithDrawers() {
  const { openCalendar, calendarOpen, swipeBlocked, calendarProgress, setCalendarDragging } = useSideDrawers();
  const { width, height } = useWindowDimensions();
  const drawerWidth = Math.round(width * SIDE_DRAWER_FRACTION);
  const bandTop = height * (0.5 - BAND / 2);
  const bandBottom = height * (0.5 + BAND / 2);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startAt = useSharedValue(0);
  // The desks are swiped between again ("верни свайпи на робочі
  // столи"), so the calendar's swipe is the one PAST the first desk -
  // iOS's own arrangement: a rightward swipe on the first home page is
  // the widgets page. On any other desk the same swipe is the desk
  // before it, and belongs to the pager.
  const [focusedTab, setFocusedTab] = useState(TAB_SCREENS[0].name);
  const blocked = swipeBlocked || calendarOpen || focusedTab !== TAB_SCREENS[0].name;

  // A swipe to the RIGHT across the middle opens the calendar. Manual, so
  // it fails before it activates on anything that is not clearly that -
  // up or down is a list scrolling, leftward is not ours (the databases'
  // drawer will take it), and a finger that rested first is picking
  // something up (a card being carried), not swiping.
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .onTouchesDown((e, state) => {
          const touch = e.allTouches[0];
          if (blocked || !touch || touch.absoluteY < bandTop || touch.absoluteY > bandBottom) {
            state.fail();
            return;
          }
          startX.value = touch.absoluteX;
          startY.value = touch.absoluteY;
          startAt.value = Date.now();
        })
        .onTouchesMove((e, state) => {
          const touch = e.allTouches[0];
          if (!touch) return;
          const dx = touch.absoluteX - startX.value;
          const dy = touch.absoluteY - startY.value;
          if (Math.abs(dy) > 12 || dx < -8) {
            state.fail();
            return;
          }
          if (dx > 14) {
            if (Date.now() - startAt.value > 350) state.fail();
            else state.activate();
          }
        })
        .onStart(() => {
          runOnJS(setCalendarDragging)(true);
        })
        // The drawer follows the finger from the moment the swipe is
        // recognised, measured from where it was recognised.
        .onUpdate((e) => {
          if (!calendarProgress) return;
          calendarProgress.value = Math.min(1, Math.max(0, e.translationX / drawerWidth));
        })
        .onEnd((e) => {
          if (!calendarProgress) return;
          const open = e.translationX > drawerWidth * 0.3 || e.velocityX > 500;
          calendarProgress.value = withTiming(open ? 1 : 0, { duration: 180, easing: Easing.out(Easing.cubic) });
          if (open) runOnJS(openCalendar)();
        })
        .onFinalize(() => {
          runOnJS(setCalendarDragging)(false);
        }),
    [blocked, bandTop, bandBottom, openCalendar, startX, startY, startAt, calendarProgress, drawerWidth, setCalendarDragging]
  );

  return (
    <View style={styles.fill}>
      <GestureDetector gesture={swipe}>
        <View style={styles.fill}>
          <Tab.Navigator
            tabBar={(props) => <FloatingIslandTabBar {...props} />}
            screenOptions={{
              // The pages are full-bleed: each screen paints its own
              // gradient edge to edge, so the pager must not put a colour
              // behind them.
              sceneStyle: { backgroundColor: 'transparent' },
              // Swiped between, as desks are; the calendar waits past the
              // first one (see `blocked` above).
              swipeEnabled: true,
              animationEnabled: false,
            }}
          >
            {TAB_SCREENS.map(({ name, component }) => (
              <Tab.Screen
                key={name}
                name={name}
                component={component}
                listeners={{ focus: () => setFocusedTab(name) }}
                options={
                  // A board's canvas takes every sideways drag itself.
                  name === 'Дошки'
                    ? ({ route }) => ({ swipeEnabled: getFocusedRouteNameFromRoute(route) !== 'Board' })
                    : undefined
                }
              />
            ))}
          </Tab.Navigator>
        </View>
      </GestureDetector>
      <CalendarDrawer />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
