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

// The screen a PaneTarget names, drawn to live inside a pane - one switch,
// shared by the databases screen's own pane and the laptop's side panels.
export default function PaneTargetScreen({ target }: { target: PaneTarget }) {
  if (target.kind === 'custom') return <CustomDatabaseScreen databaseId={target.databaseId} inPane />;
  if (target.kind === 'documents') return <DocumentsScreen inPane />;
  if (target.kind === 'boards') return <BoardsListScreen inPane />;
  if (target.kind === 'links') return <LinksScreen category={target.category} inPane />;
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
