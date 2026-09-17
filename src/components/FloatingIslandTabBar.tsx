import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from '../firestore';
import { setDoc } from '../utils/owned';
import { db } from '../firebase';
import { hapticButtonDown } from '../utils/haptics';
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
  // Held down, the desks shrink to the row of dots a home screen uses to
  // say which page you are on. Kept in settings, so it stays as left.
  const [collapsed, setCollapsed] = useState(false);
  useEffect(
    () =>
      onSnapshot(doc(db, 'settings', 'navIsland'), (snapshot) => {
        setCollapsed(!!snapshot.data()?.collapsed);
      }),
    []
  );
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
          onToggleCollapsed: () => {
            hapticButtonDown();
            setDoc(doc(db, 'settings', 'navIsland'), { collapsed: !collapsed }, { merge: true });
          },
        }
      : null
  );

  return null;
}
