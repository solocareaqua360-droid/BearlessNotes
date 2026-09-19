import { ComponentType } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import DocumentsScreen from '../screens/DocumentsScreen';
import CalendarScreen from '../screens/CalendarScreen';
import DatabasesScreen from '../screens/DatabasesScreen';
import BoardsListScreen from '../screens/BoardsListScreen';
import BoardScreen from '../screens/BoardScreen';
import { BoardsStackParamList } from '../navigation';

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
