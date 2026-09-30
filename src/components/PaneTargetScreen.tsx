import type { PaneTarget } from '../navigation/paneTarget';
import CustomDatabaseScreen from '../screens/CustomDatabaseScreen';
import DocumentsScreen from '../screens/DocumentsScreen';
import BoardsListScreen from '../screens/BoardsListScreen';
import LinksScreen from '../screens/LinksScreen';
import PhotosScreen from '../screens/PhotosScreen';
import FilesScreen from '../screens/FilesScreen';
import StickersScreen from '../screens/StickersScreen';
import FlashcardsScreen from '../screens/FlashcardsScreen';
import TagManageScreen from '../screens/TagManageScreen';
import GroupsScreen from '../screens/GroupsScreen';
import DiaryScreen from '../screens/DiaryScreen';
import TasksScreen from '../screens/TasksScreen';
import ChatScreen from '../screens/ChatScreen';
import { StyleSheet, View } from 'react-native';
import { NavigationRouteContext, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../navigation';
import DocumentEditorScreen from '../screens/DocumentEditorScreen';
import BoardScreen from '../screens/BoardScreen';

// A note in a pane: the whole editor, title and cover included, as the
// documents list's own second pane draws it. Its back arrow is the pane's.
function NoteInPane({ documentId }: { documentId: string }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return <DocumentEditorScreen key={documentId} pane documentId={documentId} navigation={navigation} onClose={() => navigation.goBack()} />;
}

// A day of the diary: the calendar's own sheet, the same editor the diary
// draws when a day is opened in it - `day_<key>` is that day, not a copy.
function DayInPane({ date }: { date: string }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <View style={styles.day}>
      <View style={styles.daySheet}>
        <DocumentEditorScreen
          key={date}
          embedded
          documentId={`day_${date}`}
          navigation={navigation}
          extraFields={{ calendarDate: date }}
        />
      </View>
    </View>
  );
}

// A board reads its id off its route, so it is given one of its own.
function BoardInPane({ boardId }: { boardId: string }) {
  const route = { key: `board-${boardId}`, name: 'Board', params: { boardId } };
  return (
    <NavigationRouteContext.Provider value={route as never}>
      <BoardScreen key={boardId} />
    </NavigationRouteContext.Provider>
  );
}

// The screen a PaneTarget names, drawn to live inside a pane - one switch,
// shared by the databases screen's own pane and the laptop's side panels.
export default function PaneTargetScreen({ target }: { target: PaneTarget }) {
  if (target.kind === 'custom') return <CustomDatabaseScreen databaseId={target.databaseId} inPane />;
  if (target.kind === 'documents') return <DocumentsScreen inPane />;
  if (target.kind === 'boards') return <BoardsListScreen inPane />;
  if (target.kind === 'links') return <LinksScreen category={target.category} inPane />;
  if (target.kind === 'note') return <NoteInPane documentId={target.documentId} />;
  if (target.kind === 'board') return <BoardInPane boardId={target.boardId} />;
  if (target.kind === 'day') return <DayInPane date={target.date} />;
  switch (target.route) {
    case 'Photos':
      return <PhotosScreen inPane />;
    case 'Files':
      return <FilesScreen inPane />;
    case 'Stickers':
      return <StickersScreen inPane />;
    case 'Flashcards':
      return <FlashcardsScreen inPane />;
    case 'Tags':
      return <TagManageScreen inPane />;
    case 'Groups':
      return <GroupsScreen inPane />;
    case 'Diary':
      return <DiaryScreen inPane />;
    case 'Chat':
      return <ChatScreen />;
    default:
      return <TasksScreen />;
  }
}

const styles = StyleSheet.create({
  day: { flex: 1, padding: 16 },
  // The editor paints its own paper, so it gets a rounded window of its
  // own - the diary's sheetBody.
  daySheet: { flex: 1, borderRadius: 18, overflow: 'hidden' },
});
