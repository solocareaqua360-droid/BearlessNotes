import { useMemo, useState } from 'react';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { Easing, runOnJS, useSharedValue, withTiming } from 'react-native-reanimated';
import FloatingIslandTabBar from '../components/FloatingIslandTabBar';
import CalendarDrawer, { DatabasesLayer, SIDE_DRAWER_FRACTION } from '../components/CalendarDrawer';
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
  const {
    openCalendar,
    calendarOpen,
    calendarProgress,
    setCalendarDragging,
    openDatabases,
    databasesOpen,
    databasesProgress,
    setDatabasesDragging,
    swipeBlocked,
  } = useSideDrawers();
  const { width, height } = useWindowDimensions();
  const drawerWidth = Math.round(width * SIDE_DRAWER_FRACTION);
  const bandTop = height * (0.5 - BAND / 2);
  const bandBottom = height * (0.5 + BAND / 2);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startAt = useSharedValue(0);
  // Which way this swipe goes, once it is known: 1 the calendar (to the
  // right), -1 the databases (to the left).
  const way = useSharedValue(0);
  // The desks are swiped between, so each layer's swipe is the one PAST
  // the end of them - iOS's own arrangement: a rightward swipe on the
  // first home page is the widgets page, a leftward one on the last is the
  // app library. Anywhere between, the same swipe is the next desk.
  const [focusedTab, setFocusedTab] = useState(TAB_SCREENS[0].name);
  const layerOpen = calendarOpen || databasesOpen;
  const canCalendar = !swipeBlocked && !layerOpen && focusedTab === TAB_SCREENS[0].name;
  const canDatabases = !swipeBlocked && !layerOpen && focusedTab === TAB_SCREENS[TAB_SCREENS.length - 1].name;

  // Manual, so it fails before it activates on anything that is not
  // clearly one of the two - up or down is a list scrolling, and a finger
  // that rested first is picking something up (a card being carried), not
  // swiping.
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .onTouchesDown((e, state) => {
          const touch = e.allTouches[0];
          if ((!canCalendar && !canDatabases) || !touch || touch.absoluteY < bandTop || touch.absoluteY > bandBottom) {
            state.fail();
            return;
          }
          startX.value = touch.absoluteX;
          startY.value = touch.absoluteY;
          startAt.value = Date.now();
          way.value = 0;
        })
        .onTouchesMove((e, state) => {
          const touch = e.allTouches[0];
          if (!touch) return;
          const dx = touch.absoluteX - startX.value;
          const dy = touch.absoluteY - startY.value;
          if (Math.abs(dy) > 12 || (dx > 8 && !canCalendar) || (dx < -8 && !canDatabases)) {
            state.fail();
            return;
          }
          if (Math.abs(dx) > 14) {
            if (Date.now() - startAt.value > 350) {
              state.fail();
              return;
            }
            way.value = dx > 0 ? 1 : -1;
            state.activate();
          }
        })
        .onStart(() => {
          if (way.value > 0) runOnJS(setCalendarDragging)(true);
          else runOnJS(setDatabasesDragging)(true);
        })
        // The layer follows the finger from the moment the swipe is
        // recognised, measured from where it was recognised.
        .onUpdate((e) => {
          const target = way.value > 0 ? calendarProgress : databasesProgress;
          if (!target) return;
          target.value = Math.min(1, Math.max(0, (e.translationX * way.value) / drawerWidth));
        })
        .onEnd((e) => {
          const target = way.value > 0 ? calendarProgress : databasesProgress;
          if (!target) return;
          const open = e.translationX * way.value > drawerWidth * 0.3 || e.velocityX * way.value > 500;
          target.value = withTiming(open ? 1 : 0, { duration: 180, easing: Easing.out(Easing.cubic) });
          if (open) runOnJS(way.value > 0 ? openCalendar : openDatabases)();
        })
        .onFinalize(() => {
          if (way.value > 0) runOnJS(setCalendarDragging)(false);
          else if (way.value < 0) runOnJS(setDatabasesDragging)(false);
        }),
    [
      canCalendar,
      canDatabases,
      bandTop,
      bandBottom,
      openCalendar,
      openDatabases,
      startX,
      startY,
      startAt,
      way,
      calendarProgress,
      databasesProgress,
      drawerWidth,
      setCalendarDragging,
      setDatabasesDragging,
    ]
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
      <DatabasesLayer />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
