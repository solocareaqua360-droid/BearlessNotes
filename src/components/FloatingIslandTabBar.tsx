import { useEffect, useMemo, useRef, useState } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { MaterialTopTabBarProps } from '@react-navigation/material-top-tabs';
import { getFocusedRouteNameFromRoute, useIsFocused } from '@react-navigation/native';
import TopNavBar, { useTopNavOn } from './TopNavBar';
import { openCapture } from './CaptureWindow';
import { useDockBase, useDockTabsDriftPublisher, useDockTabsInFluxPublisher, useNavDockHidden } from '../navigation/navDock';

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
  const [, setDockHidden] = useNavDockHidden();
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

  const desks = useMemo(
    () =>
      state.routes.map((route, index) => ({
        key: route.key,
        icon: (ICON_BY_ROUTE[route.name] ?? 'ellipse-outline') as string,
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
    [state.routes, state.index, liveIndex, navigation, setDockHidden]
  );

  // THE DESKS MOVED TO THE TOP on the four desks' own screens (see
  // TopNavBar) - the dock keeps them only on an open board, which is
  // inside the boards tab but is not one of those screens.
  const topNavOn = useTopNavOn();
  const onBoard =
    state.routes[state.index]?.name === 'Дошки' &&
    getFocusedRouteNameFromRoute(state.routes[state.index]) === 'Board';
  useDockBase(
    tabsFocused && (onBoard || !topNavOn)
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

  if (!tabsFocused || onBoard || !topNavOn) return null;
  return (
    <TopNavBar
      desks={state.routes.map((route, index) => ({
        key: route.key,
        label: route.name,
        icon: ICON_BY_ROUTE[route.name] ?? 'ellipse-outline',
        active: liveIndex === index,
        onPress: desks[index].onPress,
      }))}
      onLongPress={openCapture}
    />
  );
}
