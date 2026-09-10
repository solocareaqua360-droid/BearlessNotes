import { useRef, useState, useEffect } from 'react';
import { Alert } from 'react-native';
import { useShareIntentContext, ShareIntentFile } from 'expo-share-intent';
import {
  addDoc,
  arrayUnion,
  collection,
  doc,
  getDocs,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from '@react-native-firebase/firestore';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { db } from '../firebase';
import { Block, BlockType } from '../types';
import { fetchLinkPreview, LinkPreview } from '../utils/linkPreview';
import { linkDocId } from '../utils/linkId';
import { backupFileToDrive } from '../utils/googleDrive';
import { navigationRef } from '../navigationRef';
import { FREE_STICKER_LIMIT } from '../screens/DocumentsScreen';
import { dateKey } from '../utils/dateLocale';
import { addItemToBoard, createBoardAndAddItem } from '../utils/addItemToBoard';
import RenamePrompt from './RenamePrompt';
import SaveDestinationSheet from './SaveDestinationSheet';

// Identical to LinksScreen.tsx's/AddExistingItemModal.tsx's own copy of
// this same small classifier - see those for why it isn't shared.
function categoryOf(siteName: string | undefined): 'link-video' | 'link-geo' | 'link-other' {
  if (siteName?.includes('YouTube') || siteName?.includes('TikTok')) return 'link-video';
  if (siteName === 'Геоточка') return 'link-geo';
  return 'link-other';
}

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

// A shared link or plain text waiting on "where should this land?" (see
// SaveDestinationSheet below) - a link's preview is fetched up front, since
// every destination needs its title either way.
type PendingShare = { kind: 'link'; url: string; preview: LinkPreview } | { kind: 'text'; text: string };

// Something shared into mindEva via Android's Share sheet (app.json's
// expo-share-intent plugin registers the app for it - see
// project_pending_share_intent memory for why this was queued). No UI of
// its own besides the two prompts below; mounted once inside
// NavigationContainer (see App.tsx) so navigationRef is already attached
// by the time anything here needs it.
//
// Routing: photos/files land straight in their database, same as those
// screens' own "+" button (standalone, no document) - but with a chance to
// rename first (see renameQueue), since a shared file's own name is often
// something like "IMG-20250910-WA0002.jpg", not a name anyone would
// recognize later. A link or plain text asks where it should land (see
// pendingShare, SaveDestinationSheet) - a new or existing note, today's
// daily note, a new or existing board, or standalone (Посилання for a
// link, a sticker for text) - rather than always burying it in a
// brand-new, otherwise-empty document the way this used to work
// unconditionally.
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
  const [pendingShare, setPendingShare] = useState<PendingShare | null>(null);

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
      const url = shareIntent.webUrl;
      const preview: LinkPreview = await fetchLinkPreview(url).catch(() => ({}) as LinkPreview);
      setPendingShare({ kind: 'link', url, preview });
      return;
    }
    if (shareIntent.text && shareIntent.text.trim()) {
      setPendingShare({ kind: 'text', text: shareIntent.text.trim() });
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

  // The block a pending link/text share becomes - same shape either
  // destination inserts, just built once here.
  function blockForPendingShare(share: PendingShare): Block {
    if (share.kind === 'text') return buildBlock('paragraph', share.text);
    const block: Block = { ...buildBlock('link', share.url), linkUrl: share.url };
    if (share.preview.title) block.linkTitle = share.preview.title;
    if (share.preview.imageUrl) block.linkImageUrl = share.preview.imageUrl;
    if (share.preview.siteName) block.linkSiteName = share.preview.siteName;
    return block;
  }

  function titleForPendingShare(share: PendingShare): string {
    if (share.kind === 'link') return share.preview.title || share.url;
    const firstLine = share.text.split('\n')[0].trim();
    return firstLine.length > 0 ? firstLine.slice(0, 80) : 'Без назви';
  }

  // The block becomes the first (and only) thing in a fresh document, same
  // as this used to be the only option. The link's own mirror record isn't
  // written here: DocumentEditorScreen's own syncLinksForDocument does that
  // the moment this document is opened (which the navigate below does
  // immediately), same as if the link had been typed in by hand. A plain
  // function rather than a button handler, so the sticker-limit fallback in
  // finalizeShareStandalone can fall through to it without fighting the
  // pendingShare state it already cleared.
  async function createNewDocumentFromShare(share: PendingShare) {
    const now = Date.now();
    const newDoc = await addDoc(collection(db, 'documents'), {
      title: titleForPendingShare(share),
      createdAt: now,
      updatedAt: now,
      blocks: [blockForPendingShare(share)],
    });
    if (navigationRef.isReady()) navigationRef.navigate('Editor', { documentId: newDoc.id });
  }

  // The ImportableItem shape addItemToBoard/createBoardAndAddItem (and,
  // through cardFor, importGroupToBoard) already build a card from - a
  // shared link's kind is its video/geo/other category, a shared text has
  // no real "kind" of its own so it gets the synthetic 'text' one (see
  // groups.ts' labelForKind, which knows how to label it).
  function importableItemForShare(share: PendingShare): { id: string; kind: string; title: string; data: Record<string, unknown> } {
    if (share.kind === 'text') {
      return { id: generateId(), kind: 'text', title: titleForPendingShare(share), data: { text: share.text } };
    }
    return {
      id: linkDocId(share.url),
      kind: categoryOf(share.preview.siteName),
      title: share.preview.title || share.url,
      data: {
        url: share.url,
        title: share.preview.title,
        imageUrl: share.preview.imageUrl,
        siteName: share.preview.siteName,
      },
    };
  }

  // "Сьогодні" - appended to today's own daily note, creating it (with the
  // calendarDate field CalendarScreen looks for) if today doesn't have one
  // yet. Same lazy-mirror reasoning as "Додати в документ": opening the
  // Calendar tab, which lands on today by default, is what lets
  // DocumentEditorScreen's own sync effects catch the link/text block up.
  function finalizeShareToday() {
    const share = pendingShare;
    if (!share) return;
    setPendingShare(null);
    const documentId = `day_${dateKey(new Date())}`;
    setDoc(
      doc(db, 'documents', documentId),
      {
        blocks: arrayUnion(blockForPendingShare(share)),
        calendarDate: dateKey(new Date()),
        updatedAt: Date.now(),
      },
      { merge: true }
    )
      .then(() => {
        if (navigationRef.isReady())
          navigationRef.navigate('Tabs', { screen: 'Календар', params: { jumpToDate: dateKey(new Date()) } });
      })
      .catch(reportShareFailure);
  }

  // "Нова дошка" / "Існуюча дошка" - the link/text becomes a card instead
  // of a document block; no navigation, same as the standalone path below,
  // since jumping into a board the user hasn't asked to see would be more
  // disruptive than a confirmation toast.
  function finalizeShareNewBoard() {
    const share = pendingShare;
    if (!share) return;
    setPendingShare(null);
    createBoardAndAddItem('Без назви', importableItemForShare(share))
      .then(() => Alert.alert('Додано в mindEva', 'Створено нову дошку.'))
      .catch(reportShareFailure);
  }

  function finalizeShareExistingBoard(boardId: string) {
    const share = pendingShare;
    if (!share) return;
    setPendingShare(null);
    addItemToBoard(boardId, importableItemForShare(share))
      .then(() => Alert.alert('Додано в mindEva', 'Додано на дошку.'))
      .catch(reportShareFailure);
  }

  function reportShareFailure(e: unknown) {
    console.warn('[ShareIntentHandler] finalize failed', e);
    Alert.alert('Не вдалося зберегти', 'Спробуйте ще раз.');
  }

  // "Новий документ" button.
  function finalizeShareAsNewDocument() {
    const share = pendingShare;
    if (!share) return;
    setPendingShare(null);
    createNewDocumentFromShare(share).catch(reportShareFailure);
  }

  // "Додати в документ" - appended to the end of an already-existing
  // document's own blocks array. Same lazy-mirror reasoning as above:
  // opening that document (the navigate below) is what lets its own sync
  // effects catch the new link/text block up.
  function finalizeShareIntoDocument(documentId: string) {
    const share = pendingShare;
    if (!share) return;
    setPendingShare(null);
    updateDoc(doc(db, 'documents', documentId), {
      blocks: arrayUnion(blockForPendingShare(share)),
      updatedAt: Date.now(),
    })
      .then(() => {
        if (navigationRef.isReady()) navigationRef.navigate('Editor', { documentId });
      })
      .catch(reportShareFailure);
  }

  // "Зберегти окремо" - no document at all, so unlike the two paths above
  // there's no editor visit ahead to write the mirror record lazily; it's
  // written directly here, in full, the same shape syncLinksForDocument
  // would produce.
  function finalizeShareStandalone() {
    const share = pendingShare;
    if (!share) return;
    setPendingShare(null);
    saveShareStandalone(share).catch(reportShareFailure);
  }

  async function saveShareStandalone(share: PendingShare) {
    const now = Date.now();
    if (share.kind === 'link') {
      const linkId = linkDocId(share.url);
      const linkDocData: Record<string, unknown> = {
        url: share.url,
        createdAt: now,
        updatedAt: now,
        usedInDocuments: {},
      };
      if (share.preview.title) linkDocData.title = share.preview.title;
      if (share.preview.imageUrl) linkDocData.imageUrl = share.preview.imageUrl;
      if (share.preview.siteName) linkDocData.siteName = share.preview.siteName;
      await setDoc(doc(db, 'links', linkId), linkDocData, { merge: true });
      Alert.alert('Додано в mindEva', 'Посилання збережено в базі "Посилання".');
      return;
    }
    // Same cap DocumentsScreen's own sticker FAB enforces - falls back to
    // a new document instead of just refusing outright, since there's no
    // composer open here for the user to try something else from.
    const freeStickersSnapshot = await getDocs(query(collection(db, 'stickers'), orderBy('updatedAt', 'desc')));
    const freeStickerCount = freeStickersSnapshot.docs.filter((d) => {
      const data = d.data() as { trashed?: boolean; usedInDocuments?: Record<string, boolean> };
      return !data.trashed && Object.keys(data.usedInDocuments ?? {}).length === 0;
    }).length;
    if (freeStickerCount >= FREE_STICKER_LIMIT) {
      Alert.alert(
        'Забагато вільних стікерів',
        `Уже є ${FREE_STICKER_LIMIT} - цей текст додано як новий документ замість стікера.`
      );
      await createNewDocumentFromShare(share);
      return;
    }
    const id = generateId();
    await setDoc(
      doc(db, 'stickers', id),
      { type: 'paragraph', text: share.text, createdAt: now, updatedAt: now, usedInDocuments: {} },
      { merge: true }
    );
    Alert.alert('Додано в mindEva', 'Текст збережено як стікер.');
  }

  const current = renameQueue[0];
  return (
    <>
      <RenamePrompt
        visible={current !== undefined}
        title={current?.kind === 'photo' ? 'Назва фото' : 'Назва файлу'}
        initialValue={current?.originalName ?? ''}
        onCancel={() => handleRenameDecision(current?.originalName ?? '')}
        onSave={(title) => handleRenameDecision(title)}
      />
      <SaveDestinationSheet
        visible={pendingShare !== null}
        title={pendingShare?.kind === 'link' ? 'Куди зберегти посилання?' : 'Куди зберегти текст?'}
        defaultLabel={pendingShare?.kind === 'link' ? 'Зберегти в Посилання' : 'Зберегти як стікер'}
        onPickDefault={finalizeShareStandalone}
        onPickToday={finalizeShareToday}
        onPickNew={finalizeShareAsNewDocument}
        onPickExisting={finalizeShareIntoDocument}
        onPickNewBoard={finalizeShareNewBoard}
        onPickExistingBoard={finalizeShareExistingBoard}
        onClose={() => setPendingShare(null)}
      />
    </>
  );
}
