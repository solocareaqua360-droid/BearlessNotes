import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { MaterialTopTabBarProps } from '@react-navigation/material-top-tabs';
import FloatingIslandTabBar from '../components/FloatingIslandTabBar';
import { TAB_SCREENS } from './tabScreens';

// The same four tabs as the phone's, on a navigator that exists in a
// browser. The phone's are material top tabs, chosen because they swipe;
// they swipe on react-native-pager-view, which has no web build, so here
// they would render nothing at all.
//
// Bottom tabs carry the same screens, hand the same {state, navigation,
// descriptors} to the tab bar, and simply do not swipe - which on a laptop
// is no loss, there being no finger to swipe with. The floating island is
// still the bar, so the two builds look the same; only the gesture
// underneath differs.
const Tab = createBottomTabNavigator();

export default function Tabs() {
  return (
    <Tab.Navigator
      // The island is typed against the material navigator's props; the
      // bottom navigator's are the same shape for everything it reads.
      tabBar={(props) => <FloatingIslandTabBar {...(props as unknown as MaterialTopTabBarProps)} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: 'transparent' },
      }}
    >
      {TAB_SCREENS.map(({ name, component }) => (
        <Tab.Screen key={name} name={name} component={component} />
      ))}
    </Tab.Navigator>
  );
}
