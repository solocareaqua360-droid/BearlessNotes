import { ComponentType } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import DocumentsScreen from '../screens/DocumentsScreen';
import CalendarScreen from '../screens/CalendarScreen';
import DatabasesScreen from '../screens/DatabasesScreen';
import BoardsListScreen from '../screens/BoardsListScreen';
import BoardScreen from '../screens/BoardScreen';
import { BoardsStackParamList } from '../navigation';
import TasksScreen from '../screens/TasksScreen';
import PhotosScreen from '../screens/PhotosScreen';
import FilesScreen from '../screens/FilesScreen';
import StickersScreen from '../screens/StickersScreen';
import FlashcardsScreen from '../screens/FlashcardsScreen';
import DiaryScreen from '../screens/DiaryScreen';
import LinksScreen from '../screens/LinksScreen';
import CustomDatabaseScreen from '../screens/CustomDatabaseScreen';
import StartScreen from '../screens/StartScreen';
import { BOARDS_DESK, DeskScreen, PERMANENT_DESK, START_DESK } from './desks';

// The four tabs, as a list - shared by the two tab navigators (Tabs.tsx
// and Tabs.web.tsx), which differ only in the navigator that carries
// them. The list is the thing that must not drift between the phone and
// the browser: a tab that exists on one and not the other is a screen
// nobody can reach.

const BoardsStackNav = createNativeStackNavigator<BoardsStackParamList>();

// The "Дошки" tab's own nested stack (list of boards -> one board) - kept
// separate from the root Stack precisely so switching tabs away and back
// preserves it, landing back on whichever board (or the list) was open,
// with no manual "remember the last board" code anywhere (see
// navigation.ts's BoardsStackParamList comment).
export function BoardsStack() {
  return (
    <BoardsStackNav.Navigator screenOptions={{ headerShown: false }}>
      <BoardsStackNav.Screen name="BoardsList" component={BoardsListScreen} />
      <BoardsStackNav.Screen name="Board" component={BoardScreen} />
    </BoardsStackNav.Navigator>
  );
}

export const TAB_SCREENS: { name: string; component: ComponentType<any> }[] = [
  { name: 'Документи', component: DocumentsScreen },
  { name: 'Календар', component: CalendarScreen },
  { name: 'Дошки', component: BoardsStack },
  { name: 'Більше', component: DatabasesScreen },
];

// THE PHONE'S DESKS - see navigation/desks. What draws each database when
// it stands as a desk; null for the ones that cannot (the registries).
// The browser keeps TAB_SCREENS above until it gets desks of its own.
export function deskScreenFor(key: string): DeskScreen | null {
  if (key === START_DESK) return { component: StartScreen };
  if (key === PERMANENT_DESK) return { component: DocumentsScreen };
  if (key === BOARDS_DESK) return { component: BoardsStack };
  if (key.startsWith('db:custom:')) {
    return { component: CustomDatabaseScreen, props: { databaseId: key.slice('db:custom:'.length) } };
  }
  switch (key) {
    case 'db:tasks':
      return { component: TasksScreen };
    case 'db:photos':
      return { component: PhotosScreen };
    case 'db:files':
      return { component: FilesScreen };
    case 'db:stickers':
      return { component: StickersScreen };
    case 'db:flashcards':
      return { component: FlashcardsScreen };
    case 'db:diary':
      return { component: DiaryScreen };
    case 'db:geo':
      return { component: LinksScreen, props: { category: 'geo' } };
    case 'db:links':
      return { component: LinksScreen, props: { category: 'other' } };
    case 'db:video':
      return { component: LinksScreen, props: { category: 'video' } };
    default:
      return null;
  }
}
