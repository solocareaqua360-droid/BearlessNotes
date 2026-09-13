import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import {
  useFonts,
  Nunito_400Regular,
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ShareIntentProvider } from 'expo-share-intent';
import { NavigationContainer, getFocusedRouteNameFromRoute } from '@react-navigation/native';
import { createMaterialTopTabNavigator } from '@react-navigation/material-top-tabs';
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
import * as SplashScreen from 'expo-splash-screen';
import { sweepIfDue } from './src/utils/attachmentCache';
import { navigationRef } from './src/navigationRef';
import { BoardsStackParamList, RootStackParamList } from './src/navigation';
import { GlassTargetProvider } from './src/components/GlassTarget';
import { GlassPortalHost } from './src/components/GlassPortal';
import { AskHost } from './src/components/surfaces/Ask';

// Material top tabs, not bottom tabs, for one reason: they are the
// navigator that can be swiped. Documents and the calendar are the two
// halves of a day and the swipe between them is how they are meant to be
// crossed - the island is only the shortcut. Its "top" is nominal here;
// the tab bar is our own floating island, drawn through the portal at the
// right edge, and the navigator itself shows no bar of its own.
const Tab = createMaterialTopTabNavigator();
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
      <Tab.Screen name="Документи" component={DocumentsScreen} />
      <Tab.Screen name="Календар" component={CalendarScreen} />
      {/* An open board is a canvas dragged with the finger, so the swipe
          steps aside there - but only there. Turning it off for the whole
          tab meant that once a swipe landed on the boards, no swipe could
          leave them again, which reads as the gesture hanging. The list of
          boards is an ordinary list and swipes like every other screen. */}
      <Tab.Screen
        name="Дошки"
        component={BoardsStack}
        options={({ route }) => ({
          swipeEnabled: getFocusedRouteNameFromRoute(route) !== 'Board',
        })}
      />
      <Tab.Screen name="Більше" component={DatabasesScreen} />
    </Tab.Navigator>
  );
}

// Android dismisses the splash as soon as the app draws its first frame,
// and this app's first frame is a stand-in view that appears almost at
// once - so the icon-to-app morph was cut off just as it began. Held here
// instead, and let go below once the fonts and the sign-in have resolved,
// which is when there is really something to show.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  // Only the redesigned surfaces (Documents/Calendar and the components
  // they share) reference these family names in their own styles - the
  // rest of the app keeps the system font, matching how this whole visual
  // pass has stayed scoped rather than becoming an app-wide reskin.
  const [fontsLoaded] = useFonts({
    Nunito_400Regular,
    Nunito_500Medium,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    ensureSignedIn().then(() => setSignedIn(true));
  }, []);
  const ready = fontsLoaded && signedIn;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
    // The bytes of files nobody has opened in three months go, quietly,
    // once a day - their records stay, and they come back from Drive on
    // the next open. See attachmentCache.
    if (ready) sweepIfDue();
  }, [ready]);

  // ShareIntentProvider wraps BOTH branches below as one stable instance
  // (rather than each branch mounting its own) - a share can arrive while
  // the app is still on the splash view, and the provider needs to keep
  // holding it across the splash -> ready transition, not capture it once
  // and then get remounted from scratch right as ShareIntentHandler
  // (which only renders once signedIn, since it writes to Firestore)
  // would otherwise need to read it.
  return (
    <ShareIntentProvider>
      {!ready ? (
        // The splash's own colour, not white and no longer the gradient's
        // brown: the splash is still up while this stands behind it, and
        // two different grounds handing over to each other is exactly the
        // flash this is meant to avoid.
        <View style={{ flex: 1, backgroundColor: '#0F1839' }} />
      ) : (
        <GestureHandlerRootView style={{ flex: 1 }}>
        {/* At the root, so the pieces mounted here - the question
            window below - can read the insets too. Every screen gets
            its own from the navigator; nothing above it did. */}
        <SafeAreaProvider>
          {/* Feeds the document editor per-frame keyboard progress (see
              DocumentEditorScreen's useKeyboardHandler), so the block being
              edited can ride up in the same motion as the keyboard instead of
              jumping after it has finished. */}
          <KeyboardProvider>
          <NavigationContainer ref={navigationRef}>
          {/* The glass, in two halves that must stay in this order. The
              portal host is where every sheet is actually drawn - inside
              NavigationContainer, so a sheet that navigates still can, and
              OUTSIDE the blur target below, because a blur inside the
              picture it blurs tries to draw itself. The target wraps only
              the screens: that is what a sheet blurs. */}
          <GlassPortalHost>
            <StatusBar style="auto" />
            <ShareIntentHandler />
            {/* «Питання» - every confirmation in the app, drawn once
                here so that asking is a function call anywhere else. */}
            <AskHost />
            <GlassTargetProvider>
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
            </GlassTargetProvider>
          </GlassPortalHost>
          </NavigationContainer>
          </KeyboardProvider>
        </SafeAreaProvider>
        </GestureHandlerRootView>
      )}
    </ShareIntentProvider>
  );
}
