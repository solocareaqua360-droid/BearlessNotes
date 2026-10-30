import { FEATURES } from '../features';
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from './icons/Ionicons';
import { MaterialTopTabBarProps } from '@react-navigation/material-top-tabs';
import { StackActions, getFocusedRouteNameFromRoute, useIsFocused } from '@react-navigation/native';
import { forgetBase, hasBase, rememberBase, takeBase } from '../navigation/lastBase';
import { noteCapsuleJourney } from './DeskDock';
import TopNavBar, { useTopNavOn } from './TopNavBar';
import { openCapture } from './CaptureWindow';
import { BASES_DESK, DesksControlContext, FIXED_DESKS, deskFace } from '../navigation/desks';
import { captureAllDesks, captureDesk, forgetDesk, setCurrentDesk, setDeskCapturePaused, useDeskShots } from '../navigation/deskShots';
import DeskSwitcher from './DeskSwitcher';
import { registerDeskSwitcher } from '../navigation/deskSwitcherBus';
import { registerDeskBeads, registerDeskReach } from '../navigation/deskBeadsBus';
import { navigationRef } from '../navigationRef';
import { setChromeCompact } from '../navigation/chromeScroll';
import { deskPull, deskPullEnabled } from '../navigation/deskPull';
import { useDatabaseTiles } from '../hooks/useDatabaseTiles';
import { useDockBase, useDockTabsDriftPublisher, useDockTabsInFluxPublisher, useNavDockSetHidden } from '../navigation/navDock';
import { backMarkFocus, useRenderTimer } from '../utils/perfWatch';

// Outline glyphs at 24, the same set and the same size as everything else
// on this screen - what made these read as thinner and smaller before was
// standing at 20 next to the capsule's 24, not the weight.
const ICON_BY_ROUTE: Record<string, keyof typeof Ionicons.glyphMap> = {
  Документи: 'document-text-outline',
  Календар: 'calendar-outline',
  Дошки: 'easel-outline',
  Більше: 'apps-outline',
};

// The navigation island DRAWS NOTHING any more - it publishes the desks
// to the dock (see ContextDock), which draws every shape the dock takes.
//
// It had to stop drawing them. At a database's root there is no path, so
// the dock was showing this bar's desks and ContextDock's actions as two
// separate components lying on one another, with no way to swipe between
// them: "док досі не гортається на екрані документів". The desks are a
// card in the same stack now, and the stack is one control again.
export default function FloatingIslandTabBar({ state, navigation, position }: MaterialTopTabBarProps) {
  useRenderTimer('Смуга столів');
  // The desks used to collapse to a row of dots on a long press. That
  // press opens the capture window now - the user gave the gesture up for
  // it: "якщо все-таки воно мені знадобиться, придумаємо якийсь інший
  // спосіб". Said as a constant rather than left reading the old
  // preference, because a device that had collapsed them before this
  // change would have no way back out of the dots.
  const collapsed = false;
  // The island used to withdraw when the tabs were not the screen on show
  // - a native stack keeps the screen under the top one mounted. It still
  // must: a note pushed over the tabs has its own dock.
  const tabsFocused = useIsFocused();
  const setDockHidden = useNavDockSetHidden();
  // WHICH DESK IS ACTUALLY ON SCREEN, read off the pager itself rather
  // than off react-navigation.
  //
  // A tap moves both in the same call - `position.setValue(index)` runs
  // synchronously right beside the navigation dispatch - so there is
  // nothing here for a tap to disagree with. A SWIPE is a native
  // gesture: the page settles on the phone's own timeline, and
  // `position` (native-driven, continuous) reports that the instant it
  // happens - but `state.index`, and everything gated on
  // react-navigation's OWN focus (every screen's own context, its
  // actions), only updates once the native `onPageSelected` event has
  // crossed back to JS. `position` is the one signal here that cannot
  // lag behind what the eye already sees.
  const liveIndexRef = useRef(state.index);
  const [tabsInFlux, setLocalTabsInFlux] = useState(false);
  const publishTabsInFlux = useDockTabsInFluxPublisher();
  // Moved off the settled page AT ALL - see navDock's tabsDrifting.
  const [tabsDrifting, setLocalTabsDrifting] = useState(false);
  const publishTabsDrifting = useDockTabsDriftPublisher();
  useEffect(() => {
    // The web build's bottom-tab navigator has no `position` - there is
    // no swipe there to lag behind, so the live index is simply the
    // settled one.
    if (!position || typeof (position as any).addListener !== 'function') return;
    const id = (position as any).addListener(({ value }: { value: number }) => {
      // Same value every frame once it settles, so React bails out of
      // all but the two renders that actually change it.
      setLocalTabsDrifting(Math.abs(value - liveIndexRef.current) > 0.01);
      const rounded = Math.round(value);
      if (rounded === liveIndexRef.current) return;
      liveIndexRef.current = rounded;
      setLocalTabsInFlux(rounded !== state.index);
    });
    return () => (position as any).removeListener(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [position]);
  // Once react-navigation's own index catches up, agreement is restored
  // whichever side moved last - a tap moves state.index first and the
  // listener above never disagreed with it in the first place; a swipe
  // moves the live index first and this is what clears it again.
  useEffect(() => {
    // A new desk in front starts with the chrome whole (it may have been folded by the one before).
    setChromeCompact(false);
    liveIndexRef.current = state.index;
    setLocalTabsInFlux(false);
    setLocalTabsDrifting(false);
  }, [state.index]);
  useEffect(() => {
    publishTabsInFlux?.(tabsInFlux);
    return () => publishTabsInFlux?.(false);
  }, [publishTabsInFlux, tabsInFlux]);
  useEffect(() => {
    publishTabsDrifting?.(tabsDrifting);
    return () => publishTabsDrifting?.(false);
  }, [publishTabsDrifting, tabsDrifting]);
  const liveIndex = liveIndexRef.current;

  // The desks are the user's databases now (see navigation/desks) - their
  // names and icons come from what they are, not from a fixed list.
  const { customDatabases, iconFor } = useDatabaseTiles();
  const deskControl = useContext(DesksControlContext);
  // THE TAB SWITCHER (2026-10-03): a tap on any desk of the bar opens the
  // open desks as cards with their pictures (DeskSwitcher). Each desk is
  // photographed a moment after it settles in front, and again as the
  // switcher opens.
  const [switcherOpen, setSwitcherOpen] = useState(false);
  const shots = useDeskShots();
  const currentDesk = state.routes[state.index]?.name;
  // Told to the quiet captures (deskShots): which desk is in front, and
  // whether the panel is out.
  useEffect(() => {
    setCurrentDesk(tabsFocused ? currentDesk ?? null : null);
  }, [currentDesk, tabsFocused]);
  // Temporary diagnosis: the desks are in front again (perfWatch).
  useEffect(() => {
    if (tabsFocused) backMarkFocus();
  }, [tabsFocused]);
  useEffect(() => {
    setDeskCapturePaused(switcherOpen);
  }, [switcherOpen]);
  useEffect(() => {
    // Not while the panel is out: the desks it steps through are being
    // shown in it, and photographing each as it passes only churns them.
    if (!FEATURES.deskSwitcher || !deskControl || !currentDesk || switcherOpen) return;
    const timer = setTimeout(() => {
      if (deskPull.value < 0.02) captureDesk(currentDesk);
    }, 900);
    return () => clearTimeout(timer);
  }, [deskControl, currentDesk, switcherOpen]);
  // Every desk, a few seconds after the app has come up - so the panel
  // never opens on a desk it has no picture of (deskShots).
  // NOT any more (2026-10-05): every desk, one after another, a few seconds
  // after start and after any desk was added or closed - each a picture of
  // a whole screen drawn on the thread that takes taps. A desk with no
  // picture yet shows its icon in the switcher, and gets one when visited.
  // NOT at the start of a pull: by then the list is already being pulled
  // down, so the picture showed it displaced, and it replaced the last one
  // in the middle of the gesture (2026-10-04). Instead the desk in front is
  // photographed once the panel has gone again and it is at rest - the
  // picture for next time.
  const wasOpen = useRef(false);
  useEffect(() => {
    if (switcherOpen) {
      wasOpen.current = true;
      return;
    }
    if (!FEATURES.deskSwitcher || !wasOpen.current || !currentDesk) return;
    wasOpen.current = false;
    const timer = setTimeout(() => {
      if (deskPull.value < 0.02) captureDesk(currentDesk);
    }, 700);
    return () => clearTimeout(timer);
  }, [switcherOpen, currentDesk]);
  const faceOf = (name: string) =>
    ICON_BY_ROUTE[name] && !deskControl ? { label: name, icon: ICON_BY_ROUTE[name] } : deskFace(name, customDatabases, iconFor);
  const desks = useMemo(
    () =>
      state.routes.map((route, index) => ({
        key: route.key,
        icon: faceOf(route.name).icon as string,
        // The live index, not the settled one - see above. Wrong for at
        // most the same one beat a tap never has, and never wrong for
        // longer than that: the effect above brings it back in line the
        // moment react-navigation's own index reports the same desk.
        active: liveIndex === index,
        onPress: () => {
          // Pressing the desk you are already on brings back a context
          // that was put away - a gesture that was going spare.
          if (state.index === index) {
            setDockHidden(false);
            return;
          }
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!event.defaultPrevented) navigation.navigate(route.name);
        },
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.routes, state.index, liveIndex, navigation, setDockHidden, customDatabases, deskControl, iconFor]
  );

  // THE DESKS MOVED TO THE TOP on the four desks' own screens (see
  // TopNavBar). An open board is inside the boards tab but is not one of
  // those screens: it has its own bar (its name, not the desks), and the
  // dock under it no longer carries the desks' dots either.
  const openSwitcher = () => setSwitcherOpen(true);
  // The desk in front closes onto its neighbour to the left, so nothing
  // vanishes from under the finger; any other just goes.
  const closeDesk = (index: number) => {
    const route = state.routes[index];
    if (!deskControl || !route || FIXED_DESKS.includes(route.name)) return;
    if (liveIndex === index) {
      const previous = state.routes[index - 1]?.name;
      if (previous) navigation.navigate(previous);
    }
    deskControl.setDesks(deskControl.desks.filter((key) => key !== route.name));
    forgetDesk(route.name);
  };
  const topNavOn = useTopNavOn();
  const onBoard =
    state.routes[state.index]?.name === 'Дошки' &&
    getFocusedRouteNameFromRoute(state.routes[state.index]) === 'Board';
  useDockBase(
    tabsFocused && !topNavOn
      ? {
          kind: 'desks',
          icon: ICON_BY_ROUTE[state.routes[state.index]?.name] ?? 'ellipse-outline',
          desks,
          collapsed,
          // Nothing to toggle any more - the dock's long press belongs to
          // the capture window. Kept on the contract because the dock
          // still asks for it.
          onToggleCollapsed: () => {},
        }
      : null
  );

  const barUp = tabsFocused && !onBoard && topNavOn;
  // The dock's round button opens the same switcher (deskSwitcherBus) while
  // the desks are what is in front.
  // The bar's desks, the same array while nothing about them changes (the
  // bar is memoised - a new array per render of this strip rebuilt it every
  // time, three times over on every way back from a note). The handlers go
  // through a ref, so they are always the current ones.
  const barHandlers = useRef({ openSwitcher, closeDesk, desks });
  barHandlers.current = { openSwitcher, closeDesk, desks };
  const barDesks = useMemo(
    () =>
      state.routes.map((route, index) => ({
        key: route.key,
        ...faceOf(route.name),
        active: liveIndex === index,
        // The desk in front opens the open desks as cards; any other
        // desk simply goes there ("на вкладки, які не відкриті, просто
        // перейду").
        onPress: () => {
          const h = barHandlers.current;
          if (FEATURES.deskSwitcher && deskControl && liveIndex === index) h.openSwitcher();
          else if (deskControl && liveIndex === index) return;
          else h.desks[index]?.onPress();
        },
        // "хрестик на вкладці" - the desk in front can be closed, the
        // documents too now (only the start desk stays).
        onClose:
          deskControl && !FIXED_DESKS.includes(route.name) && liveIndex === index
            ? () => barHandlers.current.closeDesk(index)
            : undefined,
      })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.routes, liveIndex, !!deskControl, customDatabases, iconFor]
  );
  const openSwitcherRef = useRef(openSwitcher);
  openSwitcherRef.current = openSwitcher;
  const switcherReachable = barUp && !!deskControl;
  useEffect(() => {
    if (!switcherReachable) return;
    // Registered even with the switcher off: the dock reads «the desks are in front» from it (ContextDock's multitask ->
    // the desk dock); the opener then does nothing and the pull-and-hold stays off.
    registerDeskSwitcher(() => {
      if (FEATURES.deskSwitcher) openSwitcherRef.current();
    });
    deskPullEnabled.value = FEATURES.deskSwitcher;
    return () => {
      registerDeskSwitcher(null);
      deskPullEnabled.value = false;
    };
  }, [switcherReachable]);
  // The three fixed desks, for the bottom dock's round buttons (features.deskDock) - the same list while nothing
  // about them changes; the open desks beyond the three stay in the switcher.
  const dockDesks = useMemo(
    () =>
      state.routes
        .map((route, index) => ({ route, index }))
        .filter(({ route }) => FIXED_DESKS.includes(route.name))
        .map(({ route, index }) => ({
          key: route.key,
          label: faceOf(route.name).label as string,
          icon: faceOf(route.name).icon as string,
          active: liveIndex === index,
          onPress: () => {
            // From another desk, «Бази» opens the base the person left by a desk bead, if one waits (lastBase); else the list as ever.
            if (route.name === BASES_DESK && liveIndexRef.current !== index && hasBase()) {
              const base = takeBase();
              if (base && navigationRef.isReady()) {
                // The desks under are set to «Бази» at once and the base comes in front in the same breath: the list of bases is never
                // seen (a pause for the capsule showed it for a moment - the user, 2026-10-31), and the same bead is lit before and after.
                noteCapsuleJourney(index);
                barHandlers.current.desks[index]?.onPress();
                (navigationRef.navigate as (n: string, p?: object) => void)(base.name, base.params);
                return;
              }
            }
            barHandlers.current.desks[index]?.onPress();
          },
        })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.routes, liveIndex, customDatabases, iconFor]
  );
  useEffect(() => {
    registerDeskBeads(switcherReachable ? dockDesks : null, Math.max(0, state.routes.length - dockDesks.length));
  }, [switcherReachable, dockDesks, state.routes.length]);
  useEffect(() => () => registerDeskBeads(null), []);
  // The same three, to be reached from a base pushed over the tabs (deskBeadsBus's registerDeskReach): the root
  // navigator goes back to the tabs, onto that desk - the base in front is left, as with its own back.
  const reachDesks = useMemo(
    () =>
      dockDesks.map((d, i) => {
        const route = state.routes.filter((r) => FIXED_DESKS.includes(r.name))[i];
        return {
          ...d,
          // A base in front belongs to the «Бази» desk, so that bead is the lit one (the desk under it, where the person came
          // from, used to stay lit: «Старт» over an open base - the user, 2026-10-31).
          active: route?.name === BASES_DESK,
          onPress: () => {
            if (!route || !navigationRef.isReady()) return;
            // BACK to the desks under the screen in front, not a second set of them on top: `navigate` pushed a new
            // Tabs (React Navigation 7), and building every desk anew held the dock still for a second or two (the user,
            // 2026-10-29: «кулька розтягується в овал і завмирає»). popTo leaves the screen; then the desk is picked.
            const routes = navigationRef.getRootState()?.routes ?? [];
            // The base being left is remembered, unless the «Бази» bead itself was pressed (that is a wish for the list).
            if (route?.name === BASES_DESK) forgetBase();
            else rememberBase(routes[routes.length - 1] as { name: string; params?: object } | undefined);
            if (routes.length > 1 && routes[0]?.name === 'Tabs') navigationRef.dispatch(StackActions.popTo('Tabs'));
            navigationRef.navigate('Tabs', { screen: route.name } as never);
          },
        };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dockDesks]
  );
  const reachable = !!deskControl && topNavOn;
  useEffect(() => {
    registerDeskReach(reachable ? reachDesks : null);
  }, [reachable, reachDesks]);
  useEffect(() => () => registerDeskReach(null), []);
  if (!barUp) return null;
  return (
    <>
    <TopNavBar
      desks={barDesks}
      deskPosition={position as never}
      onLongPress={openCapture}
      // The calendar's drawer carries its own bar; this one steps back
      // as it comes in.
      fadeWithDrawer
    />
    {FEATURES.deskSwitcher && (
    <DeskSwitcher
      visible={switcherOpen}
      onDismiss={() => setSwitcherOpen(false)}
      desks={state.routes.map((route, index) => ({
        key: route.key,
        ...faceOf(route.name),
        active: liveIndex === index,
        shot: shots[route.name],
        // Goes there; the panel stays until it is dismissed.
        onGo: () => desks[index].onPress(),
        onClose: deskControl && !FIXED_DESKS.includes(route.name) ? () => closeDesk(index) : undefined,
      }))}
    />
    )}
    </>
  );
}
