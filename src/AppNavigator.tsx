import { createNativeStackNavigator } from '@react-navigation/native-stack';
import Tabs from './navigation/Tabs';
import PlaceholderScreen from './screens/PlaceholderScreen';
import TasksScreen from './screens/TasksScreen';
import DocumentsScreen from './screens/DocumentsScreen';
import BoardsListScreen from './screens/BoardsListScreen';
import BoardScreen from './screens/BoardScreen';
import LinksScreen from './screens/LinksScreen';
import PhotosScreen from './screens/PhotosScreen';
import FilesScreen from './screens/FilesScreen';
import StickersScreen from './screens/StickersScreen';
import CustomDatabaseScreen from './screens/CustomDatabaseScreen';
import TagManageScreen from './screens/TagManageScreen';
import GroupsScreen from './screens/GroupsScreen';
import TagItemsScreen from './screens/TagItemsScreen';
import SettingsScreen from './screens/SettingsScreen';
import SearchScreen from './screens/SearchScreen';
import DiaryScreen from './screens/DiaryScreen';
import DocumentEditorScreen from './screens/DocumentEditorScreen';
import { RootStackParamList } from './navigation';

// Every screen the app has, in one place, for both builds.
//
// The browser used to carry a navigator of its own with two routes in it,
// the board list and a board, and every other screen was unreachable
// there - not because anything in them failed in a browser (the note
// editor was the one that did, and that is fixed), but because the
// browser's navigator had never heard of them. A screen that navigates to
// 'Search' or 'Editor' warned and went nowhere.
//
// So the tree lives here and the two roots (App.tsx, App.web.tsx) each
// wrap it in what THEY need - the phone in a keyboard provider and the
// share-intent handler, the browser in the account bar - and neither
// lists a screen. The one platform difference inside the tree, the tab
// navigator, is chosen by file (navigation/Tabs vs Tabs.web), the same
// way every other difference in this port is.
const Stack = createNativeStackNavigator<RootStackParamList>();

export default function RootNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      {/* animation: 'none' only on the root screen - the navigator
          mounts after the splash view above hands over, and its
          entry animation played as a blink at startup. Pushes from
          here (Editor and the rest) keep their own animation. */}
      <Stack.Screen name="Tabs" component={Tabs} options={{ animation: 'none' }} />
      <Stack.Screen name="Editor" component={DocumentEditorScreen} />
      <Stack.Screen name="EditorModal" component={DocumentEditorScreen} options={{ presentation: 'modal' }} />
      <Stack.Screen name="Tasks" component={TasksScreen} />
      <Stack.Screen name="DocumentsCopy">{() => <DocumentsScreen standalone />}</Stack.Screen>
      <Stack.Screen name="BoardsCopy">{() => <BoardsListScreen standalone />}</Stack.Screen>
      <Stack.Screen name="BoardCopy" component={BoardScreen} />
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
  );
}
