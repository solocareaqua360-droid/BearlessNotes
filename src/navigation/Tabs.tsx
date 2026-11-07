import { ComponentType, memo, useEffect, useMemo, useRef, useState } from 'react';
import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { StyleSheet, View, useWindowDimensions } from 'react-native';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Easing, runOnJS, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSeeThroughBackdrop } from '../theme/ThemeProvider';
import FloatingIslandTabBar from '../components/FloatingIslandTabBar';
import CalendarDrawer, { DatabasesLayer, SIDE_DRAWER_FRACTION } from '../components/CalendarDrawer';
import { FEATURES } from '../features';
import { SideDrawersProvider, databasesDrawerWidth, useSideDrawers } from './sideDrawers';
import { deskScreenFor } from './tabScreens';
import { noteDeskTouched, registerDeskNode } from './deskShots';
import Freeze from '../components/Freeze';
import { DeskVisibilityContext, makeVisibilityBox, setBoxVisible, type VisibilityBox } from './deskVisibility';
import { DeskContext, DesksControlContext, registerDesks, useDesks } from './desks';
import { threeDesksOnly } from './deskRegistry';
import { useRenderTimer } from '../utils/perfWatch';
import { useBelowCovered } from '../utils/belowCover';

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
  // Out of the tree while a page covers them (utils/belowCover).
  const covered = useBelowCovered();
  return (
    <View style={[styles.fill, covered && styles.gone]}>
      <DesksControlContext.Provider value={control}>
        <SideDrawersProvider>
          <TabsWithDrawers desks={desks.filter((key) => !!deskScreenFor(key))} />
        </SideDrawersProvider>
      </DesksControlContext.Provider>
    </View>
  );
}

// One desk: its database, told it is a desk and where its way back goes.
// Its wrapper is what the tab switcher photographs (navigation/deskShots).
function DeskHost({
  deskKey,
  component: Component,
  props,
  back,
  frozen,
  active,
}: {
  deskKey: string;
  component: ComponentType<any>;
  props?: Record<string, unknown>;
  back: (() => void) | null;
  // Not on screen and not next to it: kept, not rendered (see Freeze).
  frozen: boolean;
  // The one in front. Only it hears its data as it comes; a neighbour - drawn,
  // ready for a swipe, but not looked at - catches up the moment it is
  // arrived at (deskVisibility). The start desk next to the documents used
  // to redraw its «Нещодавні» on every note opened from them.
  active: boolean;
}) {
  const value = useMemo(() => ({ back, key: deskKey }), [back, deskKey]);
  // Flipped directly, during this host's own render - the desk below is
  // frozen and will not render to hear a context change (deskVisibility).
  const box = useRef<VisibilityBox | null>(null);
  if (!box.current) box.current = makeVisibilityBox(active);
  setBoxVisible(box.current, active);
  return (
    <DeskVisibilityContext.Provider value={box.current}>
    <DeskContext.Provider value={value}>
      <View
        ref={(node) => registerDeskNode(deskKey, node)}
        collapsable={false}
        style={styles.fill}
        // Any touch on the desk ending: its picture is retaken once it rests.
        onTouchEnd={() => noteDeskTouched(deskKey)}
      >
        <Freeze freeze={frozen}>
          <Component {...props} />
        </Freeze>
      </View>
    </DeskContext.Provider>
    </DeskVisibilityContext.Provider>
  );
}

// A desk renders when ITS OWN things change, not whenever the pager over
// it does - opening a note re-rendered the navigator, and with it every
// mounted desk (measured: Старт, Календар, Бази and the rest, on every
// note opened and closed, 2026-10-05). The props are compared by value;
// `back` is kept stable below.
function sameProps(a?: Record<string, unknown>, b?: Record<string, unknown>) {
  if (a === b) return true;
  if (!a || !b) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}
const DeskHostMemo = memo(
  DeskHost,
  (a, b) =>
    a.deskKey === b.deskKey &&
    a.component === b.component &&
    a.back === b.back &&
    a.frozen === b.frozen &&
    a.active === b.active &&
    sameProps(a.props, b.props)
);
// The two drawers take no props: only their own state moves them.
const CalendarDrawerMemo = memo(CalendarDrawer);
const DatabasesLayerMemo = memo(DatabasesLayer);

function TabsWithDrawers({ desks }: { desks: string[] }) {
  useRenderTimer('Столи');
  // Each desk's way back to the one before it, one stable function per
  // pair, reading the desk's latest navigation (see DeskHostMemo).
  const navByDesk = useRef(new Map<string, { navigate: (name: string) => void }>());
  const backFns = useRef(new Map<string, () => void>());
  const backFor = (name: string, previous: string | null) => {
    if (!previous) return null;
    const key = `${name}>${previous}`;
    let fn = backFns.current.get(key);
    if (!fn) {
      fn = () => navByDesk.current.get(name)?.navigate(previous);
      backFns.current.set(key, fn);
    }
    return fn;
  };
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
  // The databases are a narrower drawer on a wide screen - the finger
  // pulls it out over its own width, not the window's.
  const databasesWidth = databasesDrawerWidth(width);
  const databasesNarrow = databasesWidth < width;
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
    // A databases DRAWER leaves the desk in sight beside it, so the desk
    // only dims behind it rather than going.
    () => ({
      opacity: wallpaper
        ? 1 - Math.max(calendarShown.value, databasesShown.value * (databasesNarrow ? 0.5 : 1))
        : 1,
    }),
    [wallpaper, databasesNarrow]
  );
  // The desks are swiped between, so each layer's swipe is the one PAST
  // the end of them - iOS's own arrangement: a rightward swipe on the
  // first home page is the widgets page, a leftward one on the last is the
  // app library. Anywhere between, the same swipe is the next desk.
  const [focusedTab, setFocusedTab] = useState(desks[0]);
  // The desk that HEARS ITS DATA (DeskHost's `active`) follows the focused one only once the switch has settled
  // (2026-10-16): arriving, a desk catches up on everything that changed while it was away - a re-render that landed
  // right on the dock capsule's journey and stalled it 2-3 frames. 380 ms: after the capsule has come to rest.
  const [hearingTab, setHearingTab] = useState(desks[0]);
  useEffect(() => {
    if (hearingTab === focusedTab) return;
    const timer = setTimeout(() => setHearingTab(focusedTab), 380);
    return () => clearTimeout(timer);
  }, [focusedTab, hearingTab]);
  const layerOpen = calendarOpen || databasesOpen;
  // The left layer is the chat once the calendar is a desk - archived with features.chatDrawer off.
  const canCalendar = (FEATURES.chatDrawer || !FEATURES.calendarDesk) && !swipeBlocked && !layerOpen && focusedTab === desks[0];
  // No right layer when the bases are a desk of their own (features.basesDesk).
  const canDatabases = !FEATURES.basesDesk && !swipeBlocked && !layerOpen && focusedTab === desks[desks.length - 1];
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
          const span = way.value > 0 ? drawerWidth : databasesWidth;
          target.value = Math.min(1, Math.max(0, (e.translationX * way.value) / span));
        })
        .onEnd((e) => {
          const target = way.value > 0 ? calendarProgress : databasesProgress;
          if (!target) return;
          const span = way.value > 0 ? drawerWidth : databasesWidth;
          const open = e.translationX * way.value > span * 0.3 || e.velocityX * way.value > 500;
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
      databasesWidth,
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
              // Only the three desks (features.threeDesks): no swipe at all - the dock's beads switch, and the swipe
              // is left free for selecting.
              swipeEnabled: !threeDesksOnly,
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
                    name === 'Дошки' && !threeDesksOnly
                      ? ({ route }) => ({ swipeEnabled: getFocusedRouteNameFromRoute(route) !== 'Board' })
                      : undefined
                  }
                >
                  {({ navigation }) => {
                    navByDesk.current.set(name, navigation as never);
                    // THE DESKS NOBODY IS LOOKING AT ARE FROZEN (the preview
                    // plan, stage 1): the one in front and its two
                    // neighbours - what a swipe can show - stay live.
                    const focusedIndex = Math.max(0, desks.indexOf(focusedTab));
                    return (
                      <DeskHostMemo
                        deskKey={name}
                        component={screen.component}
                        props={screen.props}
                        back={backFor(name, previous)}
                        // The three main desks are NEVER frozen (2026-10-16, the user: a «ривок» going Календар -> Бази,
                        // none Старт <-> Календар). Freezing hides by Suspense, and on Fabric a hidden subtree is taken
                        // off the screen: freezing the Start desk unmounted thousands of views, thawing it mounted them
                        // again - 50-80 ms of UI thread right on the switch. Only the desks beyond the three freeze, and
                        // a desk beyond them thaws by the SETTLED desk (hearingTab, 380 ms on): going Календар -> Бази
                        // thawed the fourth desk on the very frame of the switch (the last 34 ms hitch).
                        frozen={index >= 3 && index !== focusedIndex && Math.abs(index - Math.max(0, desks.indexOf(hearingTab))) > 1}
                        active={index === Math.max(0, desks.indexOf(hearingTab))}
                      />
                    );
                  }}
                </Tab.Screen>
              );
            })}
          </Tab.Navigator>
        </Animated.View>
      </GestureDetector>
      <CalendarDrawerMemo />
      {!FEATURES.basesDesk && <DatabasesLayerMemo />}
    </View>
  );
}

// How far from the screen's edge a swipe may begin, over a sideways scroll.
const EDGE_BAND = 32;

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
  gone: {
    display: 'none',
  },
});
