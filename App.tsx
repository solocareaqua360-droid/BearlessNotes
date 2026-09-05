import { StatusBar } from 'expo-status-bar';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import './src/firebase';
import DocumentsScreen from './src/screens/DocumentsScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import PlaceholderScreen from './src/screens/PlaceholderScreen';
import DatabasesScreen from './src/screens/DatabasesScreen';
import TasksScreen from './src/screens/TasksScreen';
import LinksScreen from './src/screens/LinksScreen';
import PhotosScreen from './src/screens/PhotosScreen';
import FilesScreen from './src/screens/FilesScreen';
import TagManageScreen from './src/screens/TagManageScreen';
import TagItemsScreen from './src/screens/TagItemsScreen';
import SearchScreen from './src/screens/SearchScreen';
import DocumentEditorScreen from './src/screens/DocumentEditorScreen';
import FloatingIslandTabBar from './src/components/FloatingIslandTabBar';
import { RootStackParamList } from './src/navigation';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParamList>();

// "Пошук" isn't a tab anymore - it's a search icon on DocumentsScreen that
// pushes its own stack screen (see navigation.ts) - and these three tabs
// render through the floating-island tab bar instead of the default one.
function Tabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <FloatingIslandTabBar {...props} />}>
      <Tab.Screen name="Документи" component={DocumentsScreen} />
      <Tab.Screen name="Календар" component={CalendarScreen} />
      <Tab.Screen name="Більше" component={DatabasesScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer>
        <StatusBar style="auto" />
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Tabs" component={Tabs} />
          <Stack.Screen name="Editor" component={DocumentEditorScreen} />
          <Stack.Screen name="Tasks" component={TasksScreen} />
          <Stack.Screen name="Links" component={LinksScreen} />
          <Stack.Screen name="Photos" component={PhotosScreen} />
          <Stack.Screen name="Files" component={FilesScreen} />
          <Stack.Screen name="Tags" component={TagManageScreen} />
          <Stack.Screen name="TagItems" component={TagItemsScreen} />
          <Stack.Screen name="Search" component={SearchScreen} />
          <Stack.Screen name="Placeholder">
            {({ route }) => <PlaceholderScreen icon={route.params.icon} label={route.params.label} />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}
