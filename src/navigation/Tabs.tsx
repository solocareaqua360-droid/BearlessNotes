import { getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
import FloatingIslandTabBar from '../components/FloatingIslandTabBar';
import { TAB_SCREENS } from './tabScreens';

// Material top tabs, not bottom tabs, for one reason: they are the
// navigator that can be swiped. Documents and the calendar are the two
// halves of a day and the swipe between them is how they are meant to be
// crossed - the island is only the shortcut. Its "top" is nominal here;
// the tab bar is our own floating island, drawn through the portal at the
// right edge, and the navigator itself shows no bar of its own.
//
// The browser gets a different navigator for the same four tabs - see
// Tabs.web.tsx - because the pager these swipe on has no web build.
const Tab = createMaterialTopTabNavigator();

// "Пошук" isn't a tab anymore - it's a search icon on DocumentsScreen that
// pushes its own stack screen (see navigation.ts) - and these tabs render
// through the floating-island tab bar instead of the default one.
export default function Tabs() {
  return (
    <Tab.Navigator
      tabBar={(props) => <FloatingIslandTabBar {...props} />}
      screenOptions={{
        // The pages are full-bleed: each screen paints its own gradient
        // edge to edge, so the pager must not put a colour behind them.
        sceneStyle: { backgroundColor: 'transparent' },
        // A swipe that has to travel a little before it takes over, so a
        // list scrolled with a slightly crooked finger still scrolls.
        swipeEnabled: true,
      }}
    >
      {TAB_SCREENS.map(({ name, component }) => (
        <Tab.Screen
          key={name}
          name={name}
          component={component}
          // An open board is a canvas dragged with the finger, so the swipe
          // steps aside there - but only there. Turning it off for the
          // whole tab meant that once a swipe landed on the boards, no
          // swipe could leave them again, which reads as the gesture
          // hanging. The list of boards is an ordinary list and swipes
          // like every other screen.
          options={
            name === 'Дошки'
              ? ({ route }) => ({ swipeEnabled: getFocusedRouteNameFromRoute(route) !== 'Board' })
              : undefined
          }
        />
      ))}
    </Tab.Navigator>
  );
}
