import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold } from '@expo-google-fonts/inter';
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
import BoardsListScreen from './src/screens/BoardsListScreen';
import BoardScreen from './src/screens/BoardScreen';
import TagManageScreen from './src/screens/TagManageScreen';
import TagItemsScreen from './src/screens/TagItemsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import SearchScreen from './src/screens/SearchScreen';
import DiaryScreen from './src/screens/DiaryScreen';
import DocumentEditorScreen from './src/screens/DocumentEditorScreen';
import FloatingIslandTabBar from './src/components/FloatingIslandTabBar';
import { BoardsStackParamList, RootStackParamList } from './src/navigation';

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RootStackParamList>();
const BoardsStackNav = createNativeStackNavigator<BoardsStackParamList>();

// The "Дошки" tab's own nested stack (list of boards -> one board) - kept
// separate from the root Stack precisely so switching tabs away and back
// preserves it, landing back on whichever board (or the list) was open,
// with no manual "remember the last board" code anywhere (see
// navigation.ts's BoardsStackParamList comment).
function BoardsStack() {
  return (
    <BoardsStackNav.Navigator screenOptions={{ headerShown: false }}>
      <BoardsStackNav.Screen name="BoardsList" component={BoardsListScreen} />
      <BoardsStackNav.Screen name="Board" component={BoardScreen} />
    </BoardsStackNav.Navigator>
  );
}

// "Пошук" isn't a tab anymore - it's a search icon on DocumentsScreen that
// pushes its own stack screen (see navigation.ts) - and these tabs render
// through the floating-island tab bar instead of the default one.
function Tabs() {
  return (
    <Tab.Navigator screenOptions={{ headerShown: false }} tabBar={(props) => <FloatingIslandTabBar {...props} />}>
      <Tab.Screen name="Документи" component={DocumentsScreen} />
      <Tab.Screen name="Календар" component={CalendarScreen} />
      <Tab.Screen name="Дошки" component={BoardsStack} />
      <Tab.Screen name="Більше" component={DatabasesScreen} />
    </Tab.Navigator>
  );
}

export default function App() {
  // Only the redesigned surfaces (Documents/Calendar and the components
  // they share) reference these family names in their own styles - the
  // rest of the app keeps the system font, matching how this whole visual
  // pass has stayed scoped rather than becoming an app-wide reskin.
  const [fontsLoaded] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
    Inter_800ExtraBold,
  });
  if (!fontsLoaded) return <View style={{ flex: 1, backgroundColor: '#fff' }} />;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <NavigationContainer>
        <StatusBar style="auto" />
        <Stack.Navigator screenOptions={{ headerShown: false }}>
          <Stack.Screen name="Tabs" component={Tabs} />
          <Stack.Screen name="Editor" component={DocumentEditorScreen} />
          <Stack.Screen name="EditorModal" component={DocumentEditorScreen} options={{ presentation: 'modal' }} />
          <Stack.Screen name="Tasks" component={TasksScreen} />
          <Stack.Screen name="Links" component={LinksScreen} />
          <Stack.Screen name="Photos" component={PhotosScreen} />
          <Stack.Screen name="Files" component={FilesScreen} />
          <Stack.Screen name="Tags" component={TagManageScreen} />
          <Stack.Screen name="TagItems" component={TagItemsScreen} />
          <Stack.Screen name="Settings" component={SettingsScreen} />
          <Stack.Screen name="Search" component={SearchScreen} />
          <Stack.Screen name="Diary" component={DiaryScreen} />
          <Stack.Screen name="Placeholder">
            {({ route }) => <PlaceholderScreen icon={route.params.icon} label={route.params.label} />}
          </Stack.Screen>
        </Stack.Navigator>
      </NavigationContainer>
    </GestureHandlerRootView>
  );
}
