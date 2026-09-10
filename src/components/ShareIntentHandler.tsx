import { useEffect, useRef } from 'react';
import { Alert } from 'react-native';
import { useShareIntentContext, ShareIntentFile } from 'expo-share-intent';
import { addDoc, collection, doc, setDoc, updateDoc } from '@react-native-firebase/firestore';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { db } from '../firebase';
import { Block, BlockType } from '../types';
import { fetchLinkPreview, LinkPreview } from '../utils/linkPreview';
import { backupFileToDrive } from '../utils/googleDrive';
import { navigationRef } from '../navigationRef';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function buildBlock(type: BlockType, text: string): Block {
  return { id: generateId(), text, type, createdAt: Date.now() };
}

// Something shared into mindEva via Android's Share sheet (app.json's
// expo-share-intent plugin registers the app for it - see
// project_pending_share_intent memory for why this was queued). No UI of
// its own; mounted once inside NavigationContainer (see App.tsx) so
// navigationRef is already attached by the time anything here needs it.
//
// Routing: photos/files land straight in their database, same as those
// screens' own "+" button (standalone, no document); a link or plain text
// becomes a new document, since neither has a "standalone, no document"
// home the way Photos/Files do - a shared link still needs the same
// og:title/image lookup a pasted link gets inside a document
// (convertUrlToLinkBlock), so it's built the exact same way, just as the
// first block of a fresh document instead of one typed into an existing one.
export default function ShareIntentHandler() {
  const { hasShareIntent, shareIntent, resetShareIntent } = useShareIntentContext();
  // Guards against processing the same pending share twice - e.g. a
  // re-render landing while the async import below is still running,
  // before resetShareIntent has had a chance to flip hasShareIntent back.
  const processingRef = useRef(false);

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
      await importSharedFiles(files);
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

  async function importSharedFiles(files: ShareIntentFile[]) {
    let photoCount = 0;
    let fileCount = 0;
    for (const file of files) {
      const isImage = (file.mimeType ?? '').startsWith('image/');
      const id = generateId();
      const safeName = file.fileName || `${id}${isImage ? '.jpg' : ''}`;
      const destUri = `${LegacyFileSystem.cacheDirectory}${id}-${safeName}`;
      try {
        // content:// on Android, file:// on iOS - copyAsync handles both,
        // same as the document-picker/scanner flows elsewhere in the app.
        // Copying (rather than referencing file.path directly) matters
        // here specifically: a share's source URI can be revoked by the
        // sending app once its own activity is gone, so this needs its
        // own persistent local copy the same way every other attachment
        // in this app has one.
        await LegacyFileSystem.copyAsync({ from: file.path, to: destUri });
      } catch (e) {
        console.warn('[ShareIntentHandler] copy failed', file.path, e);
        continue;
      }
      const now = Date.now();
      if (isImage) {
        await setDoc(
          doc(db, 'photos', id),
          { imageUri: destUri, imageFit: 'contain', updatedAt: now, createdAt: now, usedInDocuments: {} },
          { merge: true }
        );
        backupFileToDrive(destUri, safeName, file.mimeType || 'image/jpeg', 'Photos').then((uploaded) => {
          if (uploaded) updateDoc(doc(db, 'photos', id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
        });
        photoCount++;
      } else {
        await setDoc(
          doc(db, 'files', id),
          {
            fileUri: destUri,
            fileName: safeName,
            mimeType: file.mimeType || 'application/octet-stream',
            updatedAt: now,
            createdAt: now,
            usedInDocuments: {},
          },
          { merge: true }
        );
        backupFileToDrive(destUri, safeName, file.mimeType || 'application/octet-stream', 'Files').then((uploaded) => {
          if (uploaded) updateDoc(doc(db, 'files', id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
        });
        fileCount++;
      }
    }
    const parts: string[] = [];
    if (photoCount) parts.push(`${photoCount} ${photoCount === 1 ? 'фото' : 'фото'}`);
    if (fileCount) parts.push(`${fileCount} ${fileCount === 1 ? 'файл' : 'файлів'}`);
    if (parts.length > 0) Alert.alert('Додано в mindEva', parts.join(', '));
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

  return null;
}
