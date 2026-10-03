import { ComponentType, useEffect, useMemo, useState } from 'react';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSeeThroughBackdrop } from '../theme/ThemeProvider';
import FloatingIslandTabBar from '../components/FloatingIslandTabBar';
import CalendarDrawer, { DatabasesLayer, SIDE_DRAWER_FRACTION } from '../components/CalendarDrawer';
import { SideDrawersProvider, useSideDrawers } from './sideDrawers';
import { deskScreenFor } from './tabScreens';
import { noteDeskTouched, registerDeskNode } from './deskShots';
import { DeskContext, DesksControlContext, registerDesks, useDesks } from './desks';

// Material top tabs, not bottom tabs: the navigator the desks were built
// on when they were swiped between. Its "top" is nominal here; the tab
// bar is our own (TopNavBar, drawn through the portal), and the navigator
// shows no bar of its own.
//
// The browser gets a different navigator for the same tabs - see
// Tabs.web.tsx - because the pager these swiped on has no web build.
const Tab = createMaterialTopTabNavigator();


export default function Tabs() {
  const { desks, setDesks } = useDesks();
  const control = useMemo(() => ({ desks, setDesks }), [desks, setDesks]);
  // Told to the rest of the app, which sends people to desks by name.
  useEffect(() => {
    registerDesks(control);
    return () => registerDesks(null);
  }, [control]);
  return (
    <DesksControlContext.Provider value={control}>
      <SideDrawersProvider>
        <TabsWithDrawers desks={desks.filter((key) => !!deskScreenFor(key))} />
      </SideDrawersProvider>
    </DesksControlContext.Provider>
  );
}

// One desk: its database, told it is a desk and where its way back goes.
// Its wrapper is what the tab switcher photographs (navigation/deskShots).
function DeskHost({
  deskKey,
  component: Component,
  props,
  back,
}: {
  deskKey: string;
  component: ComponentType<any>;
  props?: Record<string, unknown>;
  back: (() => void) | null;
}) {
  const value = useMemo(() => ({ back }), [back]);
  return (
    <DeskContext.Provider value={value}>
      <View
        ref={(node) => registerDeskNode(deskKey, node)}
        collapsable={false}
        style={styles.fill}
        // Any touch on the desk ending: its picture is retaken once it rests.
        onTouchEnd={() => noteDeskTouched(deskKey)}
      >
        <Component {...props} />
      </View>
    </DeskContext.Provider>
  );
}

function TabsWithDrawers({ desks }: { desks: string[] }) {
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
    swipeEdgeOnly,
    edgeZone,
  } = useSideDrawers();
  const { width } = useWindowDimensions();
  const screenWidth = width;
  const drawerWidth = Math.round(width * SIDE_DRAWER_FRACTION);
  const startX = useSharedValue(0);
  const startY = useSharedValue(0);
  const startAt = useSharedValue(0);
  // Which way this swipe goes, once it is known: 1 the calendar (to the
  // right), -1 the databases (to the left).
  const way = useSharedValue(0);
  // Under the phone's wallpaper the desk FADES AWAY as the calendar or the
  // databases come in (option Б, see wallpaperBoost): the layer's own blur
  // of the desk is off there, and a sharp desk would show through it.
  const wallpaper = useSeeThroughBackdrop();
  const noProgress = useSharedValue(0);
  const calendarShown = calendarProgress ?? noProgress;
  const databasesShown = databasesProgress ?? noProgress;
  const deskFade = useAnimatedStyle(
    () => ({ opacity: wallpaper ? 1 - Math.max(calendarShown.value, databasesShown.value) : 1 }),
    [wallpaper]
  );
  // The desks are swiped between, so each layer's swipe is the one PAST
  // the end of them - iOS's own arrangement: a rightward swipe on the
  // first home page is the widgets page, a leftward one on the last is the
  // app library. Anywhere between, the same swipe is the next desk.
  const [focusedTab, setFocusedTab] = useState(desks[0]);
  const layerOpen = calendarOpen || databasesOpen;
  const canCalendar = !swipeBlocked && !layerOpen && focusedTab === desks[0];
  const canDatabases = !swipeBlocked && !layerOpen && focusedTab === desks[desks.length - 1];
  // Over a screen that scrolls sideways itself, the swipe starts from the
  // edge: EDGE_BAND wide on the side it goes to, and it takes over at once
  // (the scroll's own slop would otherwise win the race).
  const edgeBand = swipeEdgeOnly ? EDGE_BAND : 0;
  // The band in force for THIS touch: the whole screen's when a screen
  // asked for it, or just the zone's (see edgeZone) when the finger landed
  // inside it.
  const touchBand = useSharedValue(0);
  const zone = edgeZone;

  // Manual, so it fails before it activates on anything that is not
  // clearly one of the two - up or down is a list scrolling, and a finger
  // that rested first is picking something up (a card being carried), not
  // swiping.
  const swipe = useMemo(
    () =>
      Gesture.Pan()
        .manualActivation(true)
        .onTouchesDown((e, state) => {
          // No band any more - "свайп витягування ... повинен працювати
          // всюди по екрану обмежень не треба": anywhere is a candidate,
          // and onTouchesMove is what tells a real sideways drag from a
          // scroll or a long-press pickup.
          const touch = e.allTouches[0];
          if ((!canCalendar && !canDatabases) || !touch) {
            state.fail();
            return;
          }
          const z = zone ? zone.value : null;
          const inZone = !!z && z.bottom > z.top && touch.absoluteY >= z.top && touch.absoluteY <= z.bottom;
          const band = edgeBand > 0 ? edgeBand : inZone ? EDGE_BAND : 0;
          touchBand.value = band;
          if (band > 0) {
            const nearLeft = touch.absoluteX <= band;
            const nearRight = touch.absoluteX >= screenWidth - band;
            if (!((canCalendar && nearLeft) || (canDatabases && nearRight))) {
              state.fail();
              return;
            }
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
          if (Math.abs(dx) > (touchBand.value > 0 ? 4 : 14)) {
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
      edgeBand,
      touchBand,
      zone,
      screenWidth,
      canCalendar,
      canDatabases,
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
        <Animated.View style={[styles.fill, deskFade]}>
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
            {desks.map((name, index) => {
              const screen = deskScreenFor(name)!;
              const previous = index > 0 ? desks[index - 1] : null;
              return (
                <Tab.Screen
                  key={name}
                  name={name}
                  listeners={{ focus: () => setFocusedTab(name) }}
                  options={
                    // A board's canvas takes every sideways drag itself.
                    name === 'Дошки'
                      ? ({ route }) => ({ swipeEnabled: getFocusedRouteNameFromRoute(route) !== 'Board' })
                      : undefined
                  }
                >
                  {({ navigation }) => (
                    <DeskHost
                      deskKey={name}
                      component={screen.component}
                      props={screen.props}
                      back={previous ? () => navigation.navigate(previous) : null}
                    />
                  )}
                </Tab.Screen>
              );
            })}
          </Tab.Navigator>
        </Animated.View>
      </GestureDetector>
      <CalendarDrawer />
      <DatabasesLayer />
    </View>
  );
}

// How far from the screen's edge a swipe may begin, over a sideways scroll.
const EDGE_BAND = 32;

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
