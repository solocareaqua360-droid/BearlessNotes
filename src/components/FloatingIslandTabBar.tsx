import { useMemo } from 'react';
import { Ionicons } from '@expo/vector-icons';
import { MaterialTopTabBarProps } from '@react-navigation/material-top-tabs';
import { useIsFocused } from '@react-navigation/native';
import { useDockBase, useNavDockHidden } from '../navigation/navDock';

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
export default function FloatingIslandTabBar({ state, navigation }: MaterialTopTabBarProps) {
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

  const desks = useMemo(
    () =>
      state.routes.map((route, index) => ({
        key: route.key,
        icon: (ICON_BY_ROUTE[route.name] ?? 'ellipse-outline') as string,
        active: state.index === index,
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
    [state.routes, state.index, navigation, setDockHidden]
  );

  useDockBase(
    tabsFocused
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

  return null;
}
