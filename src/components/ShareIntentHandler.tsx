import { useRef, useState, useEffect } from 'react';
import { Alert } from 'react-native';
import { useShareIntentContext, ShareIntentFile } from 'expo-share-intent';
import { addDoc, collection, doc, setDoc, updateDoc } from '@react-native-firebase/firestore';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { db } from '../firebase';
import { Block, BlockType } from '../types';
import { fetchLinkPreview, LinkPreview } from '../utils/linkPreview';
import { backupFileToDrive } from '../utils/googleDrive';
import { navigationRef } from '../navigationRef';
import RenamePrompt from './RenamePrompt';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function buildBlock(type: BlockType, text: string): Block {
  return { id: generateId(), text, type, createdAt: Date.now() };
}

// A shared photo/file waiting for its rename prompt (see renameQueue
// below) - already copied to its own local file by the time it's queued,
// just not written to Firestore yet.
type PendingImport = {
  kind: 'photo' | 'file';
  id: string;
  destUri: string;
  originalName: string;
  mimeType: string;
};

// Something shared into mindEva via Android's Share sheet (app.json's
// expo-share-intent plugin registers the app for it - see
// project_pending_share_intent memory for why this was queued). No UI of
// its own besides the rename prompt below; mounted once inside
// NavigationContainer (see App.tsx) so navigationRef is already attached
// by the time anything here needs it.
//
// Routing: photos/files land straight in their database, same as those
// screens' own "+" button (standalone, no document) - but with a chance
// to rename first (see renameQueue), since a shared file's own name is
// often something like "IMG-20250910-WA0002.jpg", not a name anyone
// would recognize later. A link or plain text becomes a new document
// instead, since neither has a "standalone, no document" home the way
// Photos/Files do - a shared link still needs the same og:title/image
// lookup a pasted link gets inside a document (convertUrlToLinkBlock),
// so it's built the exact same way, just as the first block of a fresh
// document instead of one typed into an existing one.
export default function ShareIntentHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  // Guards against processing the same pending share twice - e.g. a
  // re-render landing while the async import below is still running,
  // before resetShareIntent has had a chance to flip hasShareIntent back.
  const processingRef = useRef(false);
  // Queued photos/files still waiting on their rename prompt - one Modal
  // instance cycles through them rather than stacking several. Emptied
  // one at a time in handleRenameDecision.
  const [renameQueue, setRenameQueue] = useState<PendingImport[]>([]);
  const addedCountRef = useRef({ photos: 0, files: 0 });

  useEffect(() => {
    if (!hasShareIntent || processingRef.current) return;
    processingRef.current = true;
    handleShareIntent()
      .catch((e) => {
        console.warn('[ShareIntentHandler] failed', e);
        Alert.alert('Не вдалося додати', 'Спробуйте поділитися ще раз.');
      })
      .finally(() => {
        processingRef.current = false;
        resetShareIntent();
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasShareIntent]);

  async function handleShareIntent() {
    const files = shareIntent.files ?? [];
    if (files.length > 0) {
      await queueSharedFiles(files);
      return;
    }
    if (shareIntent.webUrl) {
      await importSharedLink(shareIntent.webUrl);
      return;
    }
    if (shareIntent.text && shareIntent.text.trim()) {
      await importSharedText(shareIntent.text.trim());
    }
  }

  // Copies every shared file to its own local, persistent path (content://
  // on Android, file:// on iOS - copyAsync handles both, same as the
  // document-picker/scanner flows elsewhere in the app; needed because a
  // share's source URI can be revoked by the sending app once its own
  // activity is gone) and queues them for the rename prompt below - none
  // of them touch Firestore yet, that happens once each one's name is
  // confirmed (see finalizeImport).
  async function queueSharedFiles(files: ShareIntentFile[]) {
    const queued: PendingImport[] = [];
    for (const file of files) {
      const isImage = (file.mimeType ?? '').startsWith('image/');
      const id = generateId();
      const safeName = file.fileName || `${id}${isImage ? '.jpg' : ''}`;
      const destUri = `${LegacyFileSystem.cacheDirectory}${id}-${safeName}`;
      try {
        await LegacyFileSystem.copyAsync({ from: file.path, to: destUri });
      } catch (e) {
        console.warn('[ShareIntentHandler] copy failed', file.path, e);
        continue;
      }
      queued.push({
        kind: isImage ? 'photo' : 'file',
        id,
        destUri,
        originalName: safeName,
        mimeType: file.mimeType || (isImage ? 'image/jpeg' : 'application/octet-stream'),
      });
    }
    if (queued.length === 0) return;
    addedCountRef.current = { photos: 0, files: 0 };
    setRenameQueue(queued);
  }

  async function finalizeImport(item: PendingImport, title: string) {
    const now = Date.now();
    if (item.kind === 'photo') {
      await setDoc(
        doc(db, 'photos', item.id),
        { imageUri: item.destUri, imageFit: 'contain', title, updatedAt: now, createdAt: now, usedInDocuments: {} },
        { merge: true }
      );
      backupFileToDrive(item.destUri, item.originalName, item.mimeType, 'Photos').then((uploaded) => {
        if (uploaded) updateDoc(doc(db, 'photos', item.id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
      });
    } else {
      await setDoc(
        doc(db, 'files', item.id),
        {
          fileUri: item.destUri,
          fileName: item.originalName,
          title,
          mimeType: item.mimeType,
          updatedAt: now,
          createdAt: now,
          usedInDocuments: {},
        },
        { merge: true }
      );
      backupFileToDrive(item.destUri, item.originalName, item.mimeType, 'Files').then((uploaded) => {
        if (uploaded) updateDoc(doc(db, 'files', item.id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
      });
    }
  }

  // Fires on both buttons of the rename prompt - "Скасувати" keeps the
  // original name (this is a naming courtesy on top of content the user
  // already chose to share, not a "do you want to add this at all?"
  // gate), "Зберегти" uses whatever they typed. Either way the item gets
  // added; only the name differs.
  function handleRenameDecision(title: string) {
    const [current, ...rest] = renameQueue;
    if (!current) return;
    finalizeImport(current, title).catch((e) => console.warn('[ShareIntentHandler] finalize failed', e));
    if (current.kind === 'photo') addedCountRef.current.photos++;
    else addedCountRef.current.files++;
    if (rest.length === 0) {
      const { photos, files } = addedCountRef.current;
      const parts: string[] = [];
      if (photos) parts.push(`${photos} фото`);
      if (files) parts.push(`${files} ${files === 1 ? 'файл' : 'файлів'}`);
      if (parts.length > 0) Alert.alert('Додано в mindEva', parts.join(', '));
    }
    setRenameQueue(rest);
  }

  async function importSharedLink(url: string) {
    const preview: LinkPreview = await fetchLinkPreview(url).catch(() => ({}) as LinkPreview);
    const block: Block = { ...buildBlock('link', url), linkUrl: url };
    if (preview.title) block.linkTitle = preview.title;
    if (preview.imageUrl) block.linkImageUrl = preview.imageUrl;
    if (preview.siteName) block.linkSiteName = preview.siteName;
    const now = Date.now();
    const newDoc = await addDoc(collection(db, 'documents'), {
      title: preview.title || url,
      createdAt: now,
      updatedAt: now,
      blocks: [block],
    });
    if (navigationRef.isReady()) navigationRef.navigate('Editor', { documentId: newDoc.id });
  }

  async function importSharedText(text: string) {
    const firstLine = text.split('\n')[0].trim();
    const title = firstLine.length > 0 ? firstLine.slice(0, 80) : 'Без назви';
    const now = Date.now();
    const newDoc = await addDoc(collection(db, 'documents'), {
      title,
      createdAt: now,
      updatedAt: now,
      blocks: [buildBlock('paragraph', text)],
    });
    if (navigationRef.isReady()) navigationRef.navigate('Editor', { documentId: newDoc.id });
  }

  const current = renameQueue[0];
  return (
    <RenamePrompt
      visible={current !== undefined}
      title={current?.kind === 'photo' ? 'Назва фото' : 'Назва файлу'}
      initialValue={current?.originalName ?? ''}
      onCancel={() => handleRenameDecision(current?.originalName ?? '')}
      onSave={(title) => handleRenameDecision(title)}
    />
  );
}
