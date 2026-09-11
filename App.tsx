import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold, Inter_800ExtraBold } from '@expo-google-fonts/inter';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ShareIntentProvider } from 'expo-share-intent';
import { NavigationContainer } from '@react-navigation/native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ensureSignedIn } from './src/firebase';
import DocumentsScreen from './src/screens/DocumentsScreen';
import CalendarScreen from './src/screens/CalendarScreen';
import PlaceholderScreen from './src/screens/PlaceholderScreen';
import DatabasesScreen from './src/screens/DatabasesScreen';
import TasksScreen from './src/screens/TasksScreen';
import LinksScreen from './src/screens/LinksScreen';
import PhotosScreen from './src/screens/PhotosScreen';
import FilesScreen from './src/screens/FilesScreen';
import StickersScreen from './src/screens/StickersScreen';
import CustomDatabaseScreen from './src/screens/CustomDatabaseScreen';
import BoardsListScreen from './src/screens/BoardsListScreen';
import BoardScreen from './src/screens/BoardScreen';
import TagManageScreen from './src/screens/TagManageScreen';
import GroupsScreen from './src/screens/GroupsScreen';
import TagItemsScreen from './src/screens/TagItemsScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import SearchScreen from './src/screens/SearchScreen';
import DiaryScreen from './src/screens/DiaryScreen';
import DocumentEditorScreen from './src/screens/DocumentEditorScreen';
import FloatingIslandTabBar from './src/components/FloatingIslandTabBar';
import ShareIntentHandler from './src/components/ShareIntentHandler';
import { navigationRef } from './src/navigationRef';
import { BoardsStackParamList, RootStackParamList } from './src/navigation';
import { GlassTargetProvider } from './src/components/GlassTarget';

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
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    ensureSignedIn().then(() => setSignedIn(true));
  }, []);

  // ShareIntentProvider wraps BOTH branches below as one stable instance
  // (rather than each branch mounting its own) - a share can arrive while
  // the app is still on the splash view, and the provider needs to keep
  // holding it across the splash -> ready transition, not capture it once
  // and then get remounted from scratch right as ShareIntentHandler
  // (which only renders once signedIn, since it writes to Firestore)
  // would otherwise need to read it.
  return (
    <ShareIntentProvider>
      {!fontsLoaded || !signedIn ? (
        // The same colour the first screen's gradient starts with, not
        // white: this view stands in for the app while fonts and the
        // anonymous sign-in resolve, and a white one made the handover
        // read as a flash of a different screen.
        <View style={{ flex: 1, backgroundColor: '#705648' }} />
      ) : (
        <GestureHandlerRootView style={{ flex: 1 }}>
          {/* Everything the glass sheets blur. expo-blur on Android has to
              be handed the view to blur; wrapped once here, every sheet
              finds it through the context. */}
          <GlassTargetProvider>
          {/* Feeds the document editor per-frame keyboard progress (see
              DocumentEditorScreen's useKeyboardHandler), so the block being
              edited can ride up in the same motion as the keyboard instead of
              jumping after it has finished. */}
          <KeyboardProvider>
          <NavigationContainer ref={navigationRef}>
            <StatusBar style="auto" />
            <ShareIntentHandler />
            <Stack.Navigator screenOptions={{ headerShown: false }}>
              {/* animation: 'none' only on the root screen - the navigator
                  mounts after the splash view above hands over, and its
                  entry animation played as a blink at startup. Pushes from
                  here (Editor and the rest) keep their own animation. */}
              <Stack.Screen name="Tabs" component={Tabs} options={{ animation: 'none' }} />
              <Stack.Screen name="Editor" component={DocumentEditorScreen} />
              <Stack.Screen name="EditorModal" component={DocumentEditorScreen} options={{ presentation: 'modal' }} />
              <Stack.Screen name="Tasks" component={TasksScreen} />
              <Stack.Screen name="Links" component={LinksScreen} />
              <Stack.Screen name="Photos" component={PhotosScreen} />
              <Stack.Screen name="Files" component={FilesScreen} />
              <Stack.Screen name="Stickers" component={StickersScreen} />
              <Stack.Screen name="CustomDatabase" component={CustomDatabaseScreen} />
              <Stack.Screen name="Tags" component={TagManageScreen} />
              <Stack.Screen name="Groups" component={GroupsScreen} />
              <Stack.Screen name="TagItems" component={TagItemsScreen} />
              <Stack.Screen name="Settings" component={SettingsScreen} />
              <Stack.Screen name="Search" component={SearchScreen} />
              <Stack.Screen name="Diary" component={DiaryScreen} />
              <Stack.Screen name="Placeholder">
                {({ route }) => <PlaceholderScreen icon={route.params.icon} label={route.params.label} />}
              </Stack.Screen>
            </Stack.Navigator>
          </NavigationContainer>
          </KeyboardProvider>
          </GlassTargetProvider>
        </GestureHandlerRootView>
      )}
    </ShareIntentProvider>
  );
}
