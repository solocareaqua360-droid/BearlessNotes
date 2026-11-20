import { requestOpen } from './openRequest';
import type { FolderItem } from '../hooks/useAllFolderItems';

// Open one record of a folder from any screen that lists them mixed - the
// note in its editor, a board on its canvas, and the rest in their own
// database, asked to open this very record as it arrives.
// `back`: opened from the single explorer - closing the thing returns there.
export function openFolderItem(navigation: unknown, item: FolderItem, options: { back?: boolean } = {}) {
  const nav = navigation as { navigate: (name: string, params?: object) => void };
  switch (item.kind) {
    case 'document':
      nav.navigate('Editor', { documentId: item.docId });
      return;
    case 'row':
      if (item.databaseId) nav.navigate('CustomDatabase', { databaseId: item.databaseId, openRowId: item.docId });
      return;
    case 'board':
      nav.navigate('BoardCopy', { boardId: item.docId });
      return;
    case 'photo':
      requestOpen('photos', item.docId, options);
      nav.navigate('Photos');
      return;
    case 'file':
      requestOpen('files', item.docId, options);
      nav.navigate('Files');
      return;
    case 'link':
      requestOpen('links', item.docId, options);
      nav.navigate('Links', { category: item.linkCategory ?? 'other' });
      return;
    case 'flashcard':
      requestOpen('flashcards', item.docId, options);
      nav.navigate('Flashcards');
      return;
  }
}
