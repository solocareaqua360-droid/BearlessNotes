import { useEffect, useState } from 'react';
import { useTheme, useStyles } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { RAIL_CLEARANCE , railClear } from '../constants/rail';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  FlatList,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { GestureDetector } from 'react-native-gesture-handler';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import {
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  writeBatch,
} from '../firestore';
import { ownedQuery, setDoc } from '../utils/owned';
import { db } from '../firebase';
import { Block, SketchElement, Tag } from '../types';
import { RootStackParamList } from '../navigation';
import ZoomableImageViewer, { ViewerAction } from '../components/ZoomableImageViewer';
import SketchEditor from '../components/SketchEditor';
import { useFlattenPhoto } from '../hooks/useFlattenPhoto';
import RenamePrompt from '../components/RenamePrompt';
import DocumentPickerModal, { PickableDocument } from '../components/DocumentPickerModal';
import UndoToast from '../components/UndoToast';
import { PhotoCell, PhotoRow } from '../components/ItemCards';
import GroupSections from '../components/GroupSections';
import TagPicker from '../components/TagPicker';
import { copyObject, labelForBlock } from '../utils/objectClipboard';
import GroupPickerSheet, { CAMERA_PHOTOS_GROUP_ID } from '../components/GroupPickerSheet';
import CopyToNoteModal from '../components/CopyToNoteModal';
import { detachTagFromDeletedItem } from '../hooks/useTags';
import { useDownloadToast } from '../hooks/useDownloadToast';
import { useDatabaseList } from '../hooks/useDatabaseList';
import { useBin } from '../hooks/useBin';
import { useExplorer, ExplorerFolder, nameOf } from '../hooks/useExplorer';
import ExplorerHead from '../components/ExplorerHead';
import { useExplorerCarry } from '../hooks/useExplorerCarry';
import CardCarryOverlay from '../components/CardCarryOverlay';
import { downloadToFolder, showDownloadedFile } from '../utils/downloadToFolder';
import { touchAttachment } from '../utils/attachmentCache';
import DatabaseChrome, { menuStyles } from '../components/DatabaseChrome';
import { useCachedAttachment } from '../hooks/useCachedAttachment';
import { appendBlocksToToday, blockFromPhoto, copyObjectsToNote } from '../utils/copyToNote';
import { addItemToBoard, createBoardAndAddItem } from '../utils/addItemToBoard';
import SaveDestinationSheet from '../components/SaveDestinationSheet';
import { backupFileToDrive, deleteFileFromDrive } from '../utils/googleDrive';
import DownloadToast from '../components/DownloadToast';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { ask, confirm, notify } from '../components/surfaces/Ask';

const ACCENT = '#EC4899';
// The same half-strength tint the documents screen's add button takes -
// the blur behind it is what separates it, so the colour only tints.
const ACCENT_GLASS = 'rgba(236,72,153,0.55)';

type JustAddedPhoto = { id: string; imageUri: string; createdAt: number };

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type PhotoItem = {
  id: string;
  imageUri: string;
  title?: string;
  documentIds: string[];
  tagIds: string[];
  groupId?: string;
  driveFileId?: string;
  driveBytes?: number;
  updatedAt: number;
  createdAt?: number;
  // A drawing kept beside the photo, not merged into it - see
  // DocumentEditorScreen's own image blocks (sketchWidth/sketchHeight are
  // the canvas size the elements' coordinates were captured against).
  // Flattened into one picture only at the moment of sharing/downloading
  // - see useFlattenPhoto.
  sketchElements?: SketchElement[];
  sketchWidth?: number;
  sketchHeight?: number;
  // Set while the photo sits in the bin (see useBin) - hidden from every
  // list, tags/group/references untouched, purged for good after 30 days.
  deletedAt?: number;
};

export default function PhotosScreen({ inPane }: { inPane?: boolean } = {}) {
  const { width: windowWidth } = useWindowDimensions();
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [trashedPhotos, setTrashedPhotos] = useState<PhotoItem[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [viewerPhotoId, setViewerPhotoId] = useState<string | null>(null);
  const [renamingPhoto, setRenamingPhoto] = useState<PhotoItem | null>(null);
  const [documentPicker, setDocumentPicker] = useState<{ photo: PhotoItem; documents: PickableDocument[] } | null>(
    null
  );
  const [tagPickerForId, setTagPickerForId] = useState<string | null>(null);
  const [bulkTagPickerVisible, setBulkTagPickerVisible] = useState(false);
  const [bulkGroupPickerVisible, setBulkGroupPickerVisible] = useState(false);
  const [bulkCopyModalVisible, setBulkCopyModalVisible] = useState(false);
  const [justAddedPhoto, setJustAddedPhoto] = useState<JustAddedPhoto | null>(null);
  const [saveDestinationVisible, setSaveDestinationVisible] = useState(false);
  useEffect(() => {
    if (!justAddedPhoto || saveDestinationVisible) return;
    const timeoutId = setTimeout(() => setJustAddedPhoto(null), 4000);
    return () => clearTimeout(timeoutId);
  }, [justAddedPhoto, saveDestinationVisible]);

  // Groups, tags, the filters, the search, the sort, the selection and the
  // delete that can be taken back - all of it is the same on every
  // database, and lives in one place now (useDatabaseList). What is left
  // in this file is only what photos themselves do.
  const list = useDatabaseList<PhotoItem>({
    prefsKey: 'photosPrefs',
    groupKind: 'photo',
    tagKind: 'photo',
    items: photos,
    tagIdsOf: (p) => p.tagIds,
    groupIdOf: (p) => p.groupId,
    titleOf: (p) => p.title || 'Без назви',
    createdAtOf: (p) => p.createdAt,
    updatedAtOf: (p) => p.updatedAt,
    searchTextOf: (p) => p.title ?? '',
  });
  const {
    displayed: displayedPhotos,
    groups,
    tags,
    attachTag,
    detachTag,
    createAndAttachTag,
    renameTag,
    isSelectMode,
    selectedIds,
    toggle: toggleSelected,
    clear: clearSelection,
    selected: selectedPhotos,
    needle,
    viewMode,
    changeViewMode,
  } = list;
  const { downloadToast, showDownloadToast, dismissDownloadToast } = useDownloadToast();
  const { flatten: flattenPhoto, node: flattenPhotoNode } = useFlattenPhoto();
  const [sketchPhotoId, setSketchPhotoId] = useState<string | null>(null);
  // The bin - see useBin. Auto-purge always keeps the Drive copy; a
  // human-initiated purge (openPhotoTrashMenu/emptyPhotoBin below) is the
  // only path that ever asks about deleting it too.
  const bin = useBin<PhotoItem>('photos', trashedPhotos, (photo) => purgePhoto(photo, false));

  async function handleDownloadPhoto(photo: PhotoItem) {
    const uri = await flattenPhoto(photo.imageUri, photo.driveFileId, photo.sketchElements, photo.sketchWidth, photo.sketchHeight);
    const result = await downloadToFolder(uri, `photo-${Date.now()}.jpg`, 'image/jpeg');
    if (result) showDownloadToast(result.fileName, result.destUri, 'image/jpeg');
  }

  function showDownloadedFileInFolder(uri: string, mimeType: string) {
    dismissDownloadToast();
    // See showDownloadedFile: a SAF destination is a content:// URI, which
    // is not something expo-sharing can take.
    showDownloadedFile(uri, mimeType);
  }

  useEffect(() => {
    return onSnapshot(ownedQuery('photos'), (snapshot) => {
      const all = snapshot.docs
        .map((docSnapshot) => {
          const data = docSnapshot.data();
          return {
            id: docSnapshot.id,
            imageUri: data.imageUri,
            title: data.title,
            documentIds: Object.keys(data.usedInDocuments ?? {}),
            tagIds: data.tagIds ?? [],
            groupId: data.groupId,
            driveFileId: data.driveFileId,
            driveBytes: data.driveBytes,
            updatedAt: data.updatedAt ?? 0,
            createdAt: data.createdAt,
            sketchElements: data.sketchElements,
            sketchWidth: data.sketchWidth,
            sketchHeight: data.sketchHeight,
            deletedAt: data.deletedAt,
          };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);
      setPhotos(all.filter((p) => !p.deletedAt));
      setTrashedPhotos(all.filter((p) => !!p.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)));
      setIsLoading(false);
    });
  }, []);

  // The fixed "Фото" group every camera capture lands in (see
  // syncPhotosForDocument in DocumentEditorScreen) has to exist as a real
  // group document for it to show up as a tab/option at all - {merge:true}
  // makes this a harmless no-op on every mount after the first.
  useEffect(() => {
    setDoc(
      doc(db, 'groups', CAMERA_PHOTOS_GROUP_ID),
      { name: 'Фото', color: '#EC4899', kind: 'photo' },
      { merge: true }
    );
  }, []);

  const viewerPhoto = viewerPhotoId ? photos.find((p) => p.id === viewerPhotoId) ?? null : null;
  // Opening the viewer is looking at the photo - see attachmentCache.
  useEffect(() => {
    if (viewerPhoto) touchAttachment(viewerPhoto.imageUri);
  }, [viewerPhoto]);
  // Folders, read off the tag tree - see useExplorer.
  const explorer = useExplorer<PhotoItem>({
    kind: 'photo',
    collection: 'photos',
    items: photos,
    displayed: displayedPhotos,
    tagIdsOf: (item) => item.tagIds,
    tags: list.tags,
    drawerTags: list.drawerTags,
    explorerMode: list.explorerMode,
    searching: needle !== '',
    needle,
    createFolderTag: list.createFolderTag,
    deleteTagCompletely: list.deleteTagCompletely,
    renameTag: list.renameTag,
    attachTag: list.attachTag,
    detachTag: list.detachTag,
  });
  const itemsHere = explorer.visibleItems;

  // Carrying a photo into a folder - see useExplorerCarry. This screen is
  // why the gesture had to leave the rows: its grid is virtualized, so a
  // row that scrolls off is unmounted, and a gesture that belongs to one
  // dies with it.
  const carrying = useExplorerCarry<PhotoItem>({
    path: explorer.path,
    folders: explorer.folders,
    moveItem: (item, destination) => explorer.moveItem(item, destination),
    items: photos,
    isSelectMode,
    selectedIds,
    active: explorer.active,
    onMoved: () => {
      if (isSelectMode) clearSelection();
    },
  });
  // The pictures either side of the open one, in the order this screen is
  // actually showing - the folder you are in, the filter you set, the
  // search you typed. Not the whole database: what the viewer pages
  // through should be what you were looking at.
  const viewerIndex = viewerPhotoId ? itemsHere.findIndex((p) => p.id === viewerPhotoId) : -1;
  const viewerPrevId = viewerIndex > 0 ? itemsHere[viewerIndex - 1].id : null;
  const viewerNextId =
    viewerIndex >= 0 && viewerIndex < itemsHere.length - 1 ? itemsHere[viewerIndex + 1].id : null;

  function openFolderMenu(folder: ExplorerFolder) {
    ask({
      title: nameOf(folder.fullPath),
      actions: [
        { id: 'rename', label: 'Перейменувати', icon: 'pencil-outline' },
        { id: 'move', label: 'Перемістити', icon: 'arrow-forward-outline' },
        { id: 'delete', label: 'Видалити', icon: 'trash-outline', tone: 'danger' },
      ],
    }).then(async (answer) => {
      if (answer === 'rename') explorer.setFolderPrompt({ mode: 'rename', path: folder.fullPath });
      if (answer === 'delete') explorer.deleteFolder(folder.fullPath);
      if (answer === 'move') {
        const destination = await explorer.pickDestination('Куди перемістити папку?', folder.fullPath);
        if (destination === 'cancel') return;
        const name = nameOf(folder.fullPath);
        await explorer.renameFolder(folder.fullPath, destination ? `${destination}/${name}` : name);
      }
    });
  }

  const tagPickerPhoto = tagPickerForId ? photos.find((p) => p.id === tagPickerForId) ?? null : null;

  // The one selected row, put on the app's own clipboard as the block that
  // REFERENCES it - pasted into a document it stays this same record
  // rather than becoming a second copy of it (see objectClipboard).
  function copySelectedToClipboard() {
    const [only] = selectedPhotos;
    if (!only) return;
    const block = blockFromPhoto(only);
    copyObject({ label: labelForBlock(block), block });
    clearSelection();
  }

  // Same resize-then-compress DocumentEditorScreen's own image blocks go
  // through before ever being saved anywhere.
  async function compressPickedImage(uri: string, width: number, height: number): Promise<string> {
    const MAX_DIMENSION = 1600;
    try {
      const longest = Math.max(width, height);
      let context = ImageManipulator.manipulate(uri);
      if (longest > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / longest;
        context = context.resize({ width: Math.round(width * scale), height: Math.round(height * scale) });
      }
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
      return saved.uri;
    } catch {
      return uri;
    }
  }

  // The "+" button - a photo straight into the database, no document
  // involved (usedInDocuments starts empty). A camera shot still lands in
  // the fixed, non-deletable "Фото" group, same rule DocumentEditorScreen's
  // own camera block applies - only the source (gallery vs camera) decides
  // that, not whether a document happens to be open.
  // The white sheet this replaces asked the same two things in nothing
  // like the app's own colours.
  function askWhereFrom() {
    ask({
      title: 'Нове фото',
      actions: [
        { id: 'gallery', label: 'Галерея', icon: 'images-outline' },
        { id: 'camera', label: 'Камера', icon: 'camera-outline' },
      ],
    }).then((answer) => {
      if (answer === 'gallery' || answer === 'camera') addPhotoDirectly(answer);
    });
  }

  async function addPhotoDirectly(source: 'gallery' | 'camera') {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
        // The gallery takes as many as you tick. Importing a trip one
        // picture at a time was the user's own complaint; the camera stays
        // one at a time, because it is one shutter.
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            quality: 1,
            allowsMultipleSelection: true,
          });
    if (result.canceled || result.assets.length === 0) return;
    const now = Date.now();
    const added: JustAddedPhoto[] = [];
    // In the order they were picked, and each one written before the next
    // is compressed - a batch of twenty on a phone is enough to matter.
    for (const asset of result.assets) {
      const imageUri = await compressPickedImage(asset.uri, asset.width, asset.height);
      const id = generateId();
      const data: Record<string, unknown> = {
        imageUri,
        imageFit: 'contain',
        updatedAt: now,
        createdAt: now,
        usedInDocuments: {},
      };
      if (source === 'camera') data.groupId = CAMERA_PHOTOS_GROUP_ID;
      await setDoc(doc(db, 'photos', id), data, { merge: true });
      // Made inside a folder, it belongs to that folder - see useExplorer.
      await explorer.assignToCurrentFolder(id);
      backupFileToDrive(imageUri, `${id}.jpg`, 'image/jpeg', 'Photos').then((uploaded) => {
        if (uploaded) updateDoc(doc(db, 'photos', id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
      });
      added.push({ id, imageUri, createdAt: now });
    }
    // Lands in the base either way (unchanged, fast) - see FilesScreen's
    // identical justAddedFile for why "Перемістити" only ADDS a block
    // elsewhere rather than moving anything. With several, the offer is
    // about the last one; the rest are already where they belong.
    if (added.length === 1) setJustAddedPhoto(added[0]);
    else notify(`Додано зображень: ${added.length}`);
  }

  function photoToBlock(item: JustAddedPhoto) {
    return blockFromPhoto({ id: item.id, imageUri: item.imageUri, createdAt: item.createdAt });
  }

  function photoToImportableItem(item: JustAddedPhoto) {
    return { id: item.id, kind: 'photo', title: 'Фото', data: { imageUri: item.imageUri, createdAt: item.createdAt } };
  }

  function relocateJustAddedPhoto(destination: (item: JustAddedPhoto) => Promise<unknown>) {
    const item = justAddedPhoto;
    if (!item) return;
    setJustAddedPhoto(null);
    setSaveDestinationVisible(false);
    destination(item).catch((e) => console.warn('[PhotosScreen] relocate failed', e));
  }

  async function openDocumentIcon(photo: PhotoItem) {
    if (photo.documentIds.length === 0) return;
    if (photo.documentIds.length === 1) {
      setViewerPhotoId(null);
      navigation.navigate('Editor', { documentId: photo.documentIds[0] });
      return;
    }
    const documents = await Promise.all(
      photo.documentIds.map(async (id) => {
        const snapshot = await getDoc(doc(db, 'documents', id));
        return { id, title: (snapshot.data()?.title as string) || 'Без назви' };
      })
    );
    setViewerPhotoId(null);
    setDocumentPicker({ photo, documents });
  }

  function pickDocument(documentId: string) {
    setDocumentPicker(null);
    navigation.navigate('Editor', { documentId });
  }

  async function shareImage(photo: PhotoItem) {
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) return;
      const uri = await flattenPhoto(
        photo.imageUri,
        photo.driveFileId,
        photo.sketchElements,
        photo.sketchWidth,
        photo.sketchHeight
      );
      await Sharing.shareAsync(uri);
    } catch {
      // No sharing app available or the user backed out - nothing to do.
    }
  }

  // Rename is always available, and propagates into every document block
  // that shows this photo - same two-way-sync pattern as links.
  async function renamePhoto(photo: PhotoItem, title: string) {
    setRenamingPhoto(null);
    await updateDoc(doc(db, 'photos', photo.id), { title });
    await Promise.all(
      photo.documentIds.map(async (docId) => {
        const documentRef = doc(db, 'documents', docId);
        const snapshot = await getDoc(documentRef);
        const data = snapshot.data();
        if (!data) return;
        const blocks: Block[] = data.blocks ?? [];
        let changed = false;
        const updatedBlocks = blocks.map((b) => {
          if (b.id === photo.id && (b.type ?? 'paragraph') === 'image') {
            changed = true;
            return { ...b, imageTitle: title };
          }
          return b;
        });
        if (changed) await updateDoc(documentRef, { blocks: updatedBlocks });
      })
    );
  }

  // "Delete" puts a photo in the bin (see useBin) - the record, its tags
  // and every note that references it stay exactly as they were. Nothing
  // real happens until it is purged, by hand or by time.
  function confirmDeletePhoto(photo: PhotoItem) {
    setViewerPhotoId(null);
    bin.moveToBin(photo.id);
  }

  // Gone for good: what deleting used to be, now only reached by purging
  // from the bin. Detaches every tag, drops the photo out of any note
  // that still references it, and optionally takes its Drive backup with
  // it - asked here rather than at bin time, since the whole point of the
  // bin is that nothing irreversible happens until this.
  async function purgePhoto(photo: PhotoItem, alsoDeleteFromDrive: boolean) {
    deleteDoc(doc(db, 'photos', photo.id));
    if (alsoDeleteFromDrive && photo.driveFileId) {
      deleteFileFromDrive(photo.driveFileId, photo.driveBytes).then((error) => {
        if (error) notify('Копія на Диску залишилась', error);
      });
    }
    await Promise.all(
      photo.tagIds.map((tagId) => {
        const tag = tags.find((t) => t.id === tagId);
        return tag ? detachTagFromDeletedItem(tag, 'photo', photo.id) : Promise.resolve();
      })
    );
    await Promise.all(
      photo.documentIds.map(async (docId) => {
        const documentRef = doc(db, 'documents', docId);
        const snapshot = await getDoc(documentRef);
        const data = snapshot.data();
        if (!data) return;
        const blocks: Block[] = data.blocks ?? [];
        const remaining = blocks.filter((b) => b.id !== photo.id);
        if (remaining.length !== blocks.length) {
          updateDoc(documentRef, {
            blocks: remaining.length > 0 ? remaining : [{ id: generateId(), text: '' }],
          });
        }
      })
    );
  }

  // Held down in the bin: back, or away for good - the drive question
  // only comes up on the "away for good" branch, and only when there is
  // a Drive copy to ask about.
  async function openPhotoTrashMenu(photo: PhotoItem) {
    const choice = await ask({
      title: photo.title || 'Без назви',
      actions: [
        { id: 'restore', label: 'Відновити', icon: 'arrow-undo-outline', tone: 'primary' },
        { id: 'purge', label: 'Видалити назавжди', icon: 'trash-outline', tone: 'danger' },
      ],
    });
    if (choice === 'restore') {
      await bin.restore(photo.id);
      return;
    }
    if (choice !== 'purge') return;
    if (!photo.driveFileId) {
      await purgePhoto(photo, false);
      return;
    }
    const driveAnswer = await ask({
      title: 'Видалити копію з Google Диску?',
      actions: [
        { id: 'keep', label: 'Залишити на Диску', icon: 'cloud-done-outline' },
        { id: 'drive', label: 'Видалити з Диску', tone: 'danger', icon: 'cloud-offline-outline' },
      ],
    });
    if (driveAnswer === 'cancel') return;
    await purgePhoto(photo, driveAnswer === 'drive');
  }

  async function emptyPhotoBin() {
    if (trashedPhotos.length === 0) return;
    const yes = await confirm({
      title: `Очистити кошик (${trashedPhotos.length})?`,
      message: 'Ці фото буде видалено назавжди.',
      confirmLabel: 'Очистити',
    });
    if (!yes) return;
    const anyOnDrive = trashedPhotos.some((p) => p.driveFileId);
    if (!anyOnDrive) {
      await Promise.all(trashedPhotos.map((p) => purgePhoto(p, false)));
      return;
    }
    const driveAnswer = await ask({
      title: 'Видалити копії з Google Диску?',
      actions: [
        { id: 'keep', label: 'Залишити на Диску', icon: 'cloud-done-outline' },
        { id: 'drive', label: 'Видалити з Диску', tone: 'danger', icon: 'cloud-offline-outline' },
      ],
    });
    if (driveAnswer === 'cancel') return;
    await Promise.all(trashedPhotos.map((p) => purgePhoto(p, driveAnswer === 'drive')));
  }

  function confirmDeleteSelected() {
    const photosToDelete = selectedPhotos;
    confirm({
      title: photosToDelete.length === 1 ? 'У кошик?' : `У кошик (${photosToDelete.length})?`,
      message: 'Можна буде повернути з кошика протягом 30 днів.',
      confirmLabel: 'У кошик',
    }).then((yes) => {
      if (!yes) return;
      Promise.all(photosToDelete.map((p) => bin.moveToBin(p.id)));
      clearSelection();
    });
  }

  async function bulkAttachTag(tag: Parameters<typeof attachTag>[0]) {
    setBulkTagPickerVisible(false);
    await Promise.all(selectedPhotos.map((p) => attachTag(tag, 'photo', p.id, 'photos')));
    clearSelection();
  }

  async function bulkCreateAndAttachTag(path: string, icon: string, color: string) {
    setBulkTagPickerVisible(false);
    await Promise.all(selectedPhotos.map((p) => createAndAttachTag(path, icon, color, 'photo', p.id, 'photos')));
    clearSelection();
  }

  async function bulkAssignGroup(groupId: string | null) {
    setBulkGroupPickerVisible(false);
    const batch = writeBatch(db);
    selectedPhotos.forEach((p) => {
      batch.update(doc(db, 'photos', p.id), { groupId: groupId ?? deleteField() });
    });
    await batch.commit();
    clearSelection();
  }

  async function bulkCopyToExisting(documentId: string) {
    setBulkCopyModalVisible(false);
    const blocks = selectedPhotos.map(blockFromPhoto);
    await copyObjectsToNote(
      documentId,
      blocks,
      selectedPhotos.map((p) => ({ collectionName: 'photos', id: p.id }))
    );
    clearSelection();
  }

  async function bulkCopyToNew() {
    setBulkCopyModalVisible(false);
    const blocks = selectedPhotos.map(blockFromPhoto);
    const newDocumentId = await copyObjectsToNote(
      null,
      blocks,
      selectedPhotos.map((p) => ({ collectionName: 'photos', id: p.id }))
    );
    clearSelection();
    navigation.navigate('Editor', { documentId: newDocumentId });
  }

  // What a photo can be told to do from the LIST - the menu a note, a
  // file and a link have all had, and a photo had not: every one of its
  // actions lived inside the full-screen viewer, so managing photos never
  // felt like managing anything else in the app ("не можу управляти
  // фотографіями, як нотатками"). Reached the two ways every other card
  // is reached: the "..." on the card, and a short hold on it.
  async function openPhotoMenu(photo: PhotoItem) {
    const choice = await ask({
      title: photo.title || 'Без назви',
      actions: [
        { id: 'move', label: 'Перемістити в папку', icon: 'folder-outline' },
        { id: 'rename', label: 'Перейменувати', icon: 'pencil-outline' },
        { id: 'tags', label: 'Папки', icon: 'pricetag-outline' },
        { id: 'draw', label: 'Малювати', icon: 'brush-outline' },
        { id: 'bin', label: 'У кошик', icon: 'trash-outline', tone: 'danger' },
      ],
    });
    if (choice === 'move') {
      const destination = await explorer.pickDestination(`Перемістити «${photo.title || 'Без назви'}» в…`);
      if (destination === 'cancel') return;
      await explorer.moveItem(photo, destination);
    } else if (choice === 'rename') setRenamingPhoto(photo);
    else if (choice === 'tags') setTagPickerForId(photo.id);
    else if (choice === 'draw') setSketchPhotoId(photo.id);
    else if (choice === 'bin') confirmDeletePhoto(photo);
  }

  function viewerActionsFor(photo: PhotoItem): ViewerAction[] {
    return [
      { key: 'rename', icon: 'pencil-outline', label: 'Назва', onPress: () => setRenamingPhoto(photo) },
      {
        key: 'tags',
        icon: 'pricetag-outline',
        label: 'Теги',
        onPress: () => {
          setViewerPhotoId(null);
          setTagPickerForId(photo.id);
        },
      },
      {
        key: 'document',
        icon: 'document-text-outline',
        label: 'Документ',
        badge: photo.documentIds.length,
        onPress: () => openDocumentIcon(photo),
      },
      {
        key: 'draw',
        icon: 'brush-outline',
        label: 'Малювати',
        onPress: () => setSketchPhotoId(photo.id),
      },
      { key: 'share', icon: 'share-social-outline', label: 'Поділитись', onPress: () => shareImage(photo) },
      {
        key: 'download',
        icon: 'download-outline',
        label: 'Завантажити',
        onPress: () => handleDownloadPhoto(photo),
      },
      {
        key: 'delete',
        icon: 'trash-outline',
        label: 'Видалити',
        color: '#F87171',
        onPress: () => confirmDeletePhoto(photo),
      },
    ];
  }

  const sketchPhoto = sketchPhotoId ? photos.find((p) => p.id === sketchPhotoId) ?? null : null;

  async function saveSketchToPhoto(elements: SketchElement[], width: number, height: number) {
    const photo = sketchPhoto;
    setSketchPhotoId(null);
    if (!photo) return;
    await updateDoc(doc(db, 'photos', photo.id), {
      sketchElements: elements,
      sketchWidth: width,
      sketchHeight: height,
      updatedAt: Date.now(),
    });
    // Same propagation renamePhoto does for a title change - a photo used
    // in a note stays one record, not two copies that can drift apart.
    await Promise.all(
      photo.documentIds.map(async (docId) => {
        const documentRef = doc(db, 'documents', docId);
        const snapshot = await getDoc(documentRef);
        const data = snapshot.data();
        if (!data) return;
        const blocks: Block[] = data.blocks ?? [];
        let changed = false;
        const updatedBlocks = blocks.map((b) => {
          if (b.id === photo.id && (b.type ?? 'paragraph') === 'image') {
            changed = true;
            return { ...b, sketchElements: elements, sketchWidth: width, sketchHeight: height };
          }
          return b;
        });
        if (changed) await updateDoc(documentRef, { blocks: updatedBlocks });
      })
    );
  }

  // Three across on a wide column - the fold open, a tablet, the browser.
  // Off the window here rather than the measured column: the photo grid is
  // a FlatList, whose column count is fixed at mount, and the chrome's
  // width arrives one render later than that.
  const photoColumns = windowWidth >= 640 ? 3 : 2;

  return (
    <DatabaseChrome
      list={list}
      railSide={inPane ? 'left' : 'right'}
      accent={ACCENT}
      accentGlass={ACCENT_GLASS}
      onBack={() => navigation.goBack()}
      searchPlaceholder="Пошук фото за назвою"
      onAdd={() => askWhereFrom()}
      // The same two rows Files and Links already have. Photos had only
      // the grid, which shows the picture and nothing else - so a photo's
      // name, its date and how many notes use it were invisible here,
      // and the name was invisible everywhere.
      // The shape of the list is a button on the rail now - it was two
      // rows here saying the same thing, on three screens.
      shape={{
        icon: viewMode === 'grid' ? 'grid-outline' : 'reorder-four-outline',
        onToggle: () => changeViewMode(viewMode === 'list' ? 'grid' : 'list'),
      }}
      explorer={{
        mode: list.listMode,
        onChangeMode: list.setListMode,
        active: explorer.active,
        onNewFolder: () => explorer.setFolderPrompt({ mode: 'new', parent: explorer.path }),
        onBack: explorer.back,
        onForward: explorer.forward,
        canBack: explorer.historyState.canBack,
        canForward: explorer.historyState.canForward,
      }}
      bulk={{
        onTag: () => setBulkTagPickerVisible(true),
        onGroup: () => setBulkGroupPickerVisible(true),
        onCopy: () => setBulkCopyModalVisible(true),
        onCopyObject: copySelectedToClipboard,
        onDelete: confirmDeleteSelected,
      }}
      overlay={
        <>
          {carrying.movedToast && <UndoToast message={carrying.toastMessage} onUndo={carrying.undoMove} />}
          {/* The floating photo while one is being carried into a folder. */}
          <CardCarryOverlay
            carry={carrying.carry}
            label={(items) => (items.length > 1 ? `${items.length} фото` : items[0].title || 'Фото')}
            icon="image-outline"
            onEnterFolder={(path) => explorer.setPath(path)}
          />
          {justAddedPhoto && (
            <UndoToast
              message="Додано у Фото"
              actionLabel="Перемістити"
              onUndo={() => setSaveDestinationVisible(true)}
            />
          )}
          {downloadToast && (
            <DownloadToast
              fileName={downloadToast.fileName}
              onShowInFolder={() => showDownloadedFileInFolder(downloadToast.uri, downloadToast.mimeType)}
              onIgnore={dismissDownloadToast}
            />
          )}

          {viewerPhoto && (
            <Modal visible transparent animationType="fade" onRequestClose={() => setViewerPhotoId(null)}>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <ZoomableImageViewer
                  uri={viewerPhoto.imageUri}
                  driveFileId={viewerPhoto.driveFileId}
                  onClose={() => setViewerPhotoId(null)}
                  actions={viewerActionsFor(viewerPhoto)}
                  onPrev={viewerPrevId ? () => setViewerPhotoId(viewerPrevId) : undefined}
                  onNext={viewerNextId ? () => setViewerPhotoId(viewerNextId) : undefined}
                  sketchElements={viewerPhoto.sketchElements}
                  sketchWidth={viewerPhoto.sketchWidth}
                  sketchHeight={viewerPhoto.sketchHeight}
                />
              </GestureHandlerRootView>
            </Modal>
          )}

          <SketchEditor
            visible={sketchPhotoId !== null}
            initialElements={sketchPhoto?.sketchElements ?? []}
            background={sketchPhoto ? { uri: sketchPhoto.imageUri } : undefined}
            onSave={saveSketchToPhoto}
            onClose={() => setSketchPhotoId(null)}
          />
          {flattenPhotoNode}

          <RenamePrompt
            visible={renamingPhoto !== null}
            title="Назва фото"
            initialValue={renamingPhoto?.title ?? ''}
            onCancel={() => setRenamingPhoto(null)}
            onSave={(title) => {
              if (renamingPhoto) renamePhoto(renamingPhoto, title);
            }}
          />

          {/* Where a photo can come from when it is made here rather than
              inside a document - the one database whose "+" has a choice
              to offer. */}

          <DocumentPickerModal
            visible={documentPicker !== null}
            subtitle={documentPicker?.photo.title}
            documents={documentPicker?.documents ?? []}
            onPick={pickDocument}
            onClose={() => setDocumentPicker(null)}
          />

          <TagPicker
            visible={tagPickerPhoto !== null}
            kind="photo"
            tags={tags}
            selectedTagIds={tagPickerPhoto?.tagIds ?? []}
            onAttach={(tag) => tagPickerPhoto && attachTag(tag, 'photo', tagPickerPhoto.id, 'photos')}
            onDetach={(tag) => tagPickerPhoto && detachTag(tag, 'photo', tagPickerPhoto.id, 'photos')}
            onCreateAndAttach={(path, icon, color) =>
              tagPickerPhoto && createAndAttachTag(path, icon, color, 'photo', tagPickerPhoto.id, 'photos')
            }
            onRenameTag={renameTag}
            onClose={() => setTagPickerForId(null)}
          />

          <RenamePrompt
            visible={explorer.folderPrompt !== null}
            title={explorer.folderPrompt?.mode === 'rename' ? 'Назва папки' : 'Нова папка'}
            initialValue={explorer.folderPrompt?.mode === 'rename' ? nameOf(explorer.folderPrompt.path) : ''}
            onCancel={() => explorer.setFolderPrompt(null)}
            onSave={(name) => explorer.saveFolderName(name)}
          />

          <TagPicker
            visible={bulkTagPickerVisible}
            kind="photo"
            tags={tags}
            selectedTagIds={[]}
            onAttach={bulkAttachTag}
            onDetach={() => {}}
            onCreateAndAttach={bulkCreateAndAttachTag}
            onRenameTag={renameTag}
            onClose={() => setBulkTagPickerVisible(false)}
          />

          <GroupPickerSheet
            visible={bulkGroupPickerVisible}
            kind="photo"
            groups={groups}
            onPick={bulkAssignGroup}
            onClose={() => setBulkGroupPickerVisible(false)}
          />

          <CopyToNoteModal
            visible={bulkCopyModalVisible}
            onPickExisting={bulkCopyToExisting}
            onPickNew={bulkCopyToNew}
            onClose={() => setBulkCopyModalVisible(false)}
          />

          <SaveDestinationSheet
            visible={saveDestinationVisible}
            title="Куди додати фото?"
            defaultLabel="Лишити в базі"
            onPickDefault={() => relocateJustAddedPhoto(async () => {})}
            onPickToday={() =>
              relocateJustAddedPhoto((item) =>
                appendBlocksToToday([photoToBlock(item)], [{ collectionName: 'photos', id: item.id }])
              )
            }
            onPickNew={() =>
              relocateJustAddedPhoto((item) =>
                copyObjectsToNote(null, [photoToBlock(item)], [{ collectionName: 'photos', id: item.id }]).then(
                  (newId) => navigation.navigate('Editor', { documentId: newId })
                )
              )
            }
            onPickExisting={(documentId) =>
              relocateJustAddedPhoto((item) =>
                copyObjectsToNote(documentId, [photoToBlock(item)], [{ collectionName: 'photos', id: item.id }])
              )
            }
            onPickNewBoard={() =>
              relocateJustAddedPhoto((item) => createBoardAndAddItem('Без назви', photoToImportableItem(item)))
            }
            onPickExistingBoard={(boardId) =>
              relocateJustAddedPhoto((item) => addItemToBoard(boardId, photoToImportableItem(item)))
            }
            onClose={() => setSaveDestinationVisible(false)}
          />
        </>
      }
    >
      {(listTopPad, listProps, listWidth, scrollY) => {
        carrying.scrollYRef.current = scrollY;
        return (
        isLoading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : !trashOpen && itemsHere.length === 0 && explorer.folders.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="image-outline" size={32} color={ACCENT} />
            </View>
            <Text style={styles.emptyLabel}>{needle ? 'Нічого не знайдено' : 'Ще немає фото'}</Text>
            {!needle && (
              <Text style={styles.emptyHint}>
                Додайте зображення як блок у будь-якому документі - воно з'явиться тут само
              </Text>
            )}
          </View>
        ) : (
          <GestureDetector gesture={carrying.listGesture}>
          <FlatList
            ref={carrying.scrollRef as React.RefObject<FlatList<PhotoItem>>}
            {...listProps}
            // Remounted when the shape changes: FlatList cannot be told a
            // new column count in place, and it refuses columnWrapperStyle
            // on a single column outright.
            // The column count is part of the key: FlatList cannot be
            // told a new one in place.
            key={`${viewMode}-${photoColumns}-${trashOpen ? 'trash' : 'list'}`}
            data={trashOpen ? trashedPhotos : itemsHere}
            keyExtractor={(photo) => photo.id}
            numColumns={viewMode === 'list' ? 1 : photoColumns}
            columnWrapperStyle={viewMode === 'list' ? undefined : styles.gridRow}
            // Only what is on screen, and a screen either side of it.
            //
            // The whole database used to be mounted at once - forty
            // photographs is forty decoded bitmaps held together, and
            // however small each one is decoded (see AttachmentImage),
            // the collector has to walk all of them. That is the frame
            // rate the user has been watching drop. Off-screen rows are
            // detached on Android as well, which is what actually frees
            // the bitmap rather than merely hiding it.
            initialNumToRender={8}
            maxToRenderPerBatch={6}
            windowSize={5}
            removeClippedSubviews
            contentContainerStyle={[
              // The grid wraps cells across the row; the list stacks them
              // down it. Same list, two container styles - the one thing
              // that cannot be shared between the two views.
              viewMode === 'list' ? styles.list : styles.gridPage,
              railClear(inPane ? 'left' : 'right', viewMode === 'list' ? 20 : 16),
              { paddingTop: listTopPad },
              isSelectMode && styles.gridWithBulkBar,
            ]}
            ListHeaderComponent={
              trashOpen ? (
                <View style={styles.trashHead}>
                  <View style={styles.trashHeadRow}>
                    <Pressable hitSlop={8} onPress={() => setTrashOpen(false)} style={styles.trashBack}>
                      <Ionicons name="chevron-back" size={18} color={theme.ink.primary} />
                    </Pressable>
                    <Text style={styles.trashTitle}>Кошик · {trashedPhotos.length}</Text>
                    <View style={{ flex: 1 }} />
                    {trashedPhotos.length > 0 && (
                      <Pressable hitSlop={8} onPress={emptyPhotoBin}>
                        <Text style={styles.trashClear}>Очистити</Text>
                      </Pressable>
                    )}
                  </View>
                  <Text style={styles.trashHint}>
                    Затисни фото, щоб відновити або видалити назавжди. Через 30 днів кошик очищається сам.
                  </Text>
                </View>
              ) : list.explorerMode ? (
                <ExplorerHead
                  folderRef={carrying.carry.registerFolder}
                  path={explorer.path}
                  folders={explorer.folders}
                  itemIcon="image-outline"
                  onGo={(next) => {
                    explorer.setPath(next);
                    if (needle !== '') {
                      list.setSearchQuery('');
                      list.setIsSearching(false);
                    }
                  }}
                  onFolderMenu={openFolderMenu}
                  trash={{ count: trashedPhotos.length, onOpen: () => setTrashOpen(true) }}
                />
              ) : null
            }
            // What else is in this group - see GroupSections.
            ListFooterComponent={
              trashOpen ? null : <GroupSections groupId={list.selectedGroupId} currentKind="photo" tags={tags} />
            }
            renderItem={({ item: photo }) => {
              const shared = trashOpen
                ? {
                    photo,
                    tags: tags.filter((t) => photo.tagIds.includes(t.id)),
                    onPress: () => openPhotoTrashMenu(photo),
                    onLongPress: () => openPhotoTrashMenu(photo),
                  }
                : {
                    photo,
                    tags: tags.filter((t) => photo.tagIds.includes(t.id)),
                    onPress: () => (isSelectMode ? toggleSelected(photo.id) : setViewerPhotoId(photo.id)),
                    onMenu: () => openPhotoMenu(photo),
                    onLongPress: explorer.active ? undefined : () => openPhotoMenu(photo),
                    onTagPress: () => setTagPickerForId(photo.id),
                    isSelectMode,
                    isSelected: selectedIds.has(photo.id),
                  };
              // Only the explorer carries; the bin never does.
              const carried =
                !trashOpen && explorer.active ? carrying.cardProps(photo, () => openPhotoMenu(photo)) : {};
              return viewMode === 'list' ? (
                <PhotoRow {...shared} {...carried} />
              ) : (
                <PhotoCell {...shared} {...carried} />
              );
            }}
          />
          </GestureDetector>
        )
        );
      }}
    </DatabaseChrome>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
  trashHead: {
    gap: 8,
    marginBottom: 8,
  },
  trashHeadRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  trashBack: {
    padding: 4,
  },
  trashTitle: {
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  trashClear: {
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.muted,
  },
  trashHint: {
    fontSize: 13,
    lineHeight: 18,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
    paddingHorizontal: 4,
  },
    menuRule: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 6,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#FCE7F3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyLabel: {
    marginTop: 16,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
  },
  emptyHint: {
    marginTop: 6,
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
  },
  // See FilesScreen: the page is a column, only the cells are a row -
  // the path strip standing IN that row was what squeezed and stretched
  // them.
  gridPage: {
    paddingBottom: 8,
    // Between the rows; the gap ACROSS a row is columnWrapperStyle's.
    gap: 12,
  },
  // One row of the grid. alignItems flex-start so a taller cell can
  // never stretch the one beside it.
  gridRow: {
    alignItems: 'flex-start',
    gap: 12,
  },
  // The same measurements Files and Links use for their own row lists, so
  // the three databases read as one app rather than three.
  list: {
    paddingVertical: 8,
    paddingLeft: 20,
    // The rail stands at the right edge; the rows stop short of it rather
    // than running under it - the same clearance the calendar keeps.
    paddingRight: RAIL_CLEARANCE,
    gap: 10,
  },
  gridWithBulkBar: {
    paddingBottom: 90,
  },
  });
