import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { Block, Group, Tag } from '../types';
import { groupAppliesTo } from '../utils/groups';
import { RootStackParamList } from '../navigation';
import ZoomableImageViewer, { ViewerAction } from '../components/ZoomableImageViewer';
import RenamePrompt from '../components/RenamePrompt';
import DocumentPickerModal, { PickableDocument } from '../components/DocumentPickerModal';
import UndoToast from '../components/UndoToast';
import TagChips from '../components/TagChips';
import TagPicker from '../components/TagPicker';
import BulkActionBar from '../components/BulkActionBar';
import { copyObject, labelForBlock } from '../utils/objectClipboard';
import GroupPickerSheet, { CAMERA_PHOTOS_GROUP_ID } from '../components/GroupPickerSheet';
import ProjectTabsRow, { UNASSIGNED_ID } from '../components/ProjectTabsRow';
import TagsDrawer, { TagFilter, matchesTagFilter, removeTagFromFilter } from '../components/TagsDrawer';
import CopyToNoteModal from '../components/CopyToNoteModal';
import { usePendingDelete } from '../hooks/usePendingDelete';
import { useMultiSelect } from '../hooks/useMultiSelect';
import { useSortPref } from '../hooks/useSortPref';
import { useTags, detachTagFromDeletedItem } from '../hooks/useTags';
import { useDownloadToast } from '../hooks/useDownloadToast';
import { useCachedAttachment } from '../hooks/useCachedAttachment';
import { appendBlocksToToday, blockFromPhoto, copyObjectsToNote } from '../utils/copyToNote';
import { addItemToBoard, createBoardAndAddItem } from '../utils/addItemToBoard';
import SaveDestinationSheet from '../components/SaveDestinationSheet';
import { backupFileToDrive, deleteFileFromDrive } from '../utils/googleDrive';
import { sortItems } from '../utils/sortItems';
import DownloadToast from '../components/DownloadToast';
import SortMenuRows from '../components/SortMenuRows';
import ContentColumn from '../components/ContentColumn';
import { useRail } from '../hooks/useRail';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { BlurView } from 'expo-blur';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassPortal } from '../components/GlassPortal';
import { useBlurTarget } from '../components/GlassTarget';
import { GLASS_ISLAND } from '../constants/glass';
import { CAPSULE_DROP, CHROME_TOP, RAIL_CLEARANCE, RAIL_RIGHT } from '../constants/rail';

const ACCENT = '#EC4899';
// The same half-strength tint the documents screen's add button takes -
// the blur behind it is what separates it, so the colour only tints.
const ACCENT_GLASS = 'rgba(236,72,153,0.55)';
const groupsCollection = collection(db, 'groups');
const DOWNLOAD_DIR_STORAGE_KEY = 'bearlessNotes.downloadDirUri';

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
};

// Same "pick a folder once, remember it" download flow already built for
// image/file blocks in DocumentEditorScreen - duplicated here (rather than
// exported and shared) since it's a handful of lines and the two screens
// otherwise have nothing else in common worth coupling them for.
async function downloadPhoto(uri: string): Promise<{ destUri: string; fileName: string } | null> {
  const stored = await AsyncStorage.getItem(DOWNLOAD_DIR_STORAGE_KEY);
  let dirUri = stored;
  if (!dirUri) {
    const permission = await LegacyFileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) return null;
    dirUri = permission.directoryUri;
    await AsyncStorage.setItem(DOWNLOAD_DIR_STORAGE_KEY, dirUri);
  }
  const fileName = `photo-${Date.now()}`;
  const destUri = await LegacyFileSystem.StorageAccessFramework.createFileAsync(dirUri, fileName, 'image/jpeg');
  const content = await LegacyFileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  await LegacyFileSystem.writeAsStringAsync(destUri, content, { encoding: 'base64' });
  return { destUri, fileName: `${fileName}.jpg` };
}

function PhotoThumb({
  uri,
  driveFileId,
  docCount,
  tags,
  onTagPress,
  isSelectMode,
  isSelected,
}: {
  uri: string;
  driveFileId?: string;
  docCount: number;
  tags: Tag[];
  onTagPress: () => void;
  isSelectMode: boolean;
  isSelected: boolean;
}) {
  // This device may never have had the actual bytes (a fresh install, a
  // different device than the one the photo was taken/picked on) - quietly
  // re-pulled from the Drive backup the first time it's rendered here, same
  // as DocumentEditorScreen's own image blocks.
  const cacheStatus = useCachedAttachment(uri, driveFileId);
  return (
    <View style={styles.cellImageWrap}>
      {cacheStatus === 'ready' ? (
        <Image source={{ uri }} style={styles.cellImage} resizeMode="cover" />
      ) : (
        <View style={[styles.cellImage, styles.cellImageStatus]}>
          {cacheStatus === 'missing' ? (
            <Ionicons name="cloud-offline-outline" size={22} color="#9CA3AF" />
          ) : (
            <ActivityIndicator color="#9CA3AF" />
          )}
        </View>
      )}
      {isSelectMode ? (
        <View style={styles.cellCheckbox}>
          <Ionicons
            name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
            size={22}
            color={isSelected ? ACCENT : '#fff'}
          />
        </View>
      ) : (
        <>
          {docCount > 1 && (
            <View style={styles.cellBadge}>
              <Text style={styles.cellBadgeLabel}>{docCount}</Text>
            </View>
          )}
          <View style={styles.cellTagRow}>
            <TagChips tags={tags} onPress={onTagPress} glass />
          </View>
        </>
      )}
    </View>
  );
}

export default function PhotosScreen() {
  const railBlurTarget = useBlurTarget();
  const railFocused = useIsFocused();
  const railInsets = useSafeAreaInsets();
  const rail = useRail();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewerPhotoId, setViewerPhotoId] = useState<string | null>(null);
  const [renamingPhoto, setRenamingPhoto] = useState<PhotoItem | null>(null);
  const [documentPicker, setDocumentPicker] = useState<{ photo: PhotoItem; documents: PickableDocument[] } | null>(
    null
  );
  const [tagPickerForId, setTagPickerForId] = useState<string | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [tagFilter, setTagFilter] = useState<TagFilter | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [addPhotoSheetVisible, setAddPhotoSheetVisible] = useState(false);
  const { sortPref, selectSortField } = useSortPref('photosPrefs');
  const { filterPending, requestDelete, requestDeleteMany, undo, toast } = usePendingDelete<PhotoItem>();
  const { tags, attachTag, detachTag, createAndAttachTag, renameTag } = useTags();
  const { isSelectMode, selectedIds, toggleSelectMode, toggle: toggleSelected, clear: clearSelection } =
    useMultiSelect();
  const { downloadToast, showDownloadToast, dismissDownloadToast } = useDownloadToast();

  async function handleDownloadPhoto(uri: string) {
    const result = await downloadPhoto(uri);
    if (result) showDownloadToast(result.fileName, result.destUri, 'image/jpeg');
  }

  async function showDownloadedFileInFolder(uri: string, mimeType: string) {
    dismissDownloadToast();
    const available = await Sharing.isAvailableAsync();
    if (!available) return;
    await Sharing.shareAsync(uri, { mimeType });
  }

  useEffect(() => {
    const photosQuery = query(collection(db, 'photos'), orderBy('updatedAt', 'desc'));
    return onSnapshot(photosQuery, (snapshot) => {
      setPhotos(
        snapshot.docs.map((docSnapshot) => {
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
          };
        })
      );
      setIsLoading(false);
    });
  }, []);

  useEffect(() => {
    // Filtered client-side rather than with a `where('kind','==','photo')`
    // query - combining an equality filter with `orderBy` on a different
    // field needs a composite index set up by hand in the Firebase
    // console, which this app avoids everywhere else too (see
    // TasksScreen's own comment on the same tradeoff).
    return onSnapshot(query(groupsCollection, orderBy('name')), (snapshot) => {
      setGroups(
        snapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Group, 'id'>) }))
          .filter((g) => groupAppliesTo(g, 'photo'))
      );
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

  const pendingFilteredPhotos = filterPending(photos);
  const groupFilteredPhotos =
    groupFilter === null
      ? pendingFilteredPhotos
      : groupFilter === UNASSIGNED_ID
        ? pendingFilteredPhotos.filter((p) => !p.groupId)
        : pendingFilteredPhotos.filter((p) => p.groupId === groupFilter);
  const tagFilteredPhotos = groupFilteredPhotos.filter((p) => matchesTagFilter(p.tagIds, tagFilter));
  // Only offer tags actually assigned to at least one photo - not the whole
  // app-wide tag list - so this drawer stays a short, relevant menu.
  const usedTagIds = new Set(photos.flatMap((p) => p.tagIds));
  const drawerTags = tags.filter((t) => usedTagIds.has(t.id));
  const needle = searchQuery.trim().toLowerCase();
  const searchedPhotos = needle
    ? tagFilteredPhotos.filter((p) => (p.title ?? '').toLowerCase().includes(needle))
    : tagFilteredPhotos;
  const displayedPhotos = sortItems(
    searchedPhotos,
    sortPref,
    (p) => p.title || 'Без назви',
    (p) => p.createdAt,
    (p) => p.updatedAt
  );
  const viewerPhoto = viewerPhotoId ? photos.find((p) => p.id === viewerPhotoId) ?? null : null;
  const tagPickerPhoto = tagPickerForId ? photos.find((p) => p.id === tagPickerForId) ?? null : null;
  const selectedPhotos = photos.filter((p) => selectedIds.has(p.id));

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
  async function addPhotoDirectly(source: 'gallery' | 'camera') {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const imageUri = await compressPickedImage(asset.uri, asset.width, asset.height);
    const id = generateId();
    const now = Date.now();
    const data: Record<string, unknown> = {
      imageUri,
      imageFit: 'contain',
      updatedAt: now,
      createdAt: now,
      usedInDocuments: {},
    };
    if (source === 'camera') data.groupId = CAMERA_PHOTOS_GROUP_ID;
    await setDoc(doc(db, 'photos', id), data, { merge: true });
    backupFileToDrive(imageUri, `${id}.jpg`, 'image/jpeg', 'Photos').then((uploaded) => {
      if (uploaded) updateDoc(doc(db, 'photos', id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
    });
    // Lands in the base either way (unchanged, fast) - see FilesScreen's
    // identical justAddedFile for why "Перемістити" only ADDS a block
    // elsewhere rather than moving anything.
    setJustAddedPhoto({ id, imageUri, createdAt: now });
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

  async function shareImage(uri: string) {
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) return;
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

  function confirmDeletePhoto(photo: PhotoItem) {
    setViewerPhotoId(null);
    if (!photo.driveFileId) {
      requestDelete(photo, 'Фото видалено', () => deletePhoto(photo, false));
      return;
    }
    Alert.alert('Видалити копію з Google Диску?', undefined, [
      {
        text: 'Залишити на Диску',
        onPress: () => requestDelete(photo, 'Фото видалено', () => deletePhoto(photo, false)),
      },
      {
        text: 'Видалити з Диску',
        style: 'destructive',
        onPress: () => requestDelete(photo, 'Фото видалено', () => deletePhoto(photo, true)),
      },
    ]);
  }

  async function deletePhoto(photo: PhotoItem, alsoDeleteFromDrive: boolean) {
    deleteDoc(doc(db, 'photos', photo.id));
    if (alsoDeleteFromDrive && photo.driveFileId) {
      deleteFileFromDrive(photo.driveFileId, photo.driveBytes).then((error) => {
        if (error) Alert.alert('Копія на Диску залишилась', error);
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

  function confirmDeleteSelected() {
    const photosToDelete = selectedPhotos;
    const anyOnDrive = photosToDelete.some((p) => p.driveFileId);
    if (!anyOnDrive) {
      requestDeleteMany(photosToDelete, `Видалено фото: ${photosToDelete.length}`, () => {
        photosToDelete.forEach((p) => deletePhoto(p, false));
      });
      clearSelection();
      return;
    }
    Alert.alert('Видалити копії з Google Диску?', undefined, [
      {
        text: 'Залишити на Диску',
        onPress: () => {
          requestDeleteMany(photosToDelete, `Видалено фото: ${photosToDelete.length}`, () => {
            photosToDelete.forEach((p) => deletePhoto(p, false));
          });
          clearSelection();
        },
      },
      {
        text: 'Видалити з Диску',
        style: 'destructive',
        onPress: () => {
          requestDeleteMany(photosToDelete, `Видалено фото: ${photosToDelete.length}`, () => {
            photosToDelete.forEach((p) => deletePhoto(p, true));
          });
          clearSelection();
        },
      },
    ]);
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
      { key: 'share', icon: 'share-social-outline', label: 'Поділитись', onPress: () => shareImage(photo.imageUri) },
      {
        key: 'download',
        icon: 'download-outline',
        label: 'Завантажити',
        onPress: () => handleDownloadPhoto(photo.imageUri),
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

  return (
    <View style={styles.container}>
      <Svg
        width={windowWidth + 2}
        height={windowHeight + 2}
        style={[StyleSheet.absoluteFill, { top: -1, left: -1 }]}
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="photosBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.03" stopColor="#705648" />
            <Stop offset="0.52" stopColor="#69736E" />
            <Stop offset="1" stopColor="#000000" />
          </LinearGradient>
        </Defs>
        <Rect width={windowWidth + 2} height={windowHeight + 2} fill="url(#photosBg)" />
      </Svg>
      {/* The rail, as on every other screen: right edge, same width, same
          glass, hanging from the same line. Through the portal, which is
          where a blur is safe - inside the screen it would be blurring a
          picture it is part of. */}
      {railFocused && (
        <GlassPortal>
          <View
            style={[styles.railWrap, { top: railInsets.top + CHROME_TOP + CAPSULE_DROP }]}
            pointerEvents="box-none"
          >
            <View style={styles.headerButtons}>
                <BlurView
                  intensity={60}
                  tint="dark"
                  blurMethod="dimezisBlurView"
                  blurTarget={railBlurTarget ?? undefined}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
              <Pressable hitSlop={8} onPress={() => setMenuOpen((v) => !v)}>
                <Ionicons name="ellipsis-horizontal-outline" size={24} color="#fff" />
              </Pressable>
              <View style={styles.headerButtonsDivider} />
              <Pressable hitSlop={8} onPress={() => setIsSearching((prev) => !prev)}>
                <Ionicons name={isSearching ? 'close-outline' : 'search-outline'} size={24} color="#fff" />
              </Pressable>
            </View>
          </View>
        </GlassPortal>
      )}

      <ContentColumn>
        <View style={styles.headerRow}>
          <View style={styles.headerLeft}>
            <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
              <Ionicons name="chevron-back" size={24} color="#fff" />
            </Pressable>
            <Text style={styles.header}>Зображення</Text>
          </View>
        </View>

        {menuOpen && <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)} />}
        {menuOpen && (
          <View style={styles.menuPanel}>
            <SortMenuRows sortPref={sortPref} onSelectField={selectSortField} accentColor={ACCENT} />
            <View style={styles.menuRule} />
            <Pressable
              style={styles.menuRow}
              onPress={() => {
                setMenuOpen(false);
                toggleSelectMode();
              }}
            >
              <Ionicons
                name={isSelectMode ? 'close-outline' : 'checkmark-circle-outline'}
                size={17}
                color="#111827"
              />
              <Text style={styles.menuRowLabel}>{isSelectMode ? 'Скасувати вибір' : 'Вибрати'}</Text>
            </Pressable>
          </View>
        )}

        {groups.length > 0 && (
          <ProjectTabsRow items={groups} selected={groupFilter} onSelect={setGroupFilter} unassignedLabel="Без групи" dark />
        )}

        {tagFilter && (
          <View style={styles.filterRow}>
            {tagFilter.type === 'untagged' ? (
              <View style={[styles.filterChip, { borderColor: '#6B7280' }]}>
                <Ionicons name="pricetag-outline" size={13} color="#6B7280" />
                <Text style={[styles.filterChipLabel, { color: '#6B7280' }]}>Без тегів</Text>
                <Pressable hitSlop={8} onPress={() => setTagFilter(null)}>
                  <Ionicons name="close" size={14} color="#6B7280" />
                </Pressable>
              </View>
            ) : (
              tagFilter.tagIds.map((tagId) => {
                const tag = tags.find((t) => t.id === tagId);
                if (!tag) return null;
                return (
                  <View key={tagId} style={[styles.filterChip, { borderColor: tag.color }]}>
                    <Ionicons name={tag.icon as keyof typeof Ionicons.glyphMap} size={13} color={tag.color} />
                    <Text style={[styles.filterChipLabel, { color: tag.color }]}>{tag.path}</Text>
                    <Pressable hitSlop={8} onPress={() => setTagFilter(removeTagFromFilter(tagFilter, tagId))}>
                      <Ionicons name="close" size={14} color={tag.color} />
                    </Pressable>
                  </View>
                );
              })
            )}
          </View>
        )}

        {isSearching && (
          <View style={styles.searchRow}>
            <Ionicons name="search" size={14} color="#9CA3AF" />
            <TextInput
              autoFocus
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Пошук фото за назвою"
              placeholderTextColor="#9CA3AF"
              style={styles.searchInput}
            />
          </View>
        )}

        {isLoading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : displayedPhotos.length === 0 ? (
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
          <ScrollView contentContainerStyle={[styles.grid, isSelectMode && styles.gridWithBulkBar]}>
            {displayedPhotos.map((photo) => (
              <Pressable
                key={photo.id}
                style={styles.cell}
                onPress={() => (isSelectMode ? toggleSelected(photo.id) : setViewerPhotoId(photo.id))}
              >
                <PhotoThumb
                  uri={photo.imageUri}
                  driveFileId={photo.driveFileId}
                  docCount={photo.documentIds.length}
                  tags={tags.filter((t) => photo.tagIds.includes(t.id))}
                  onTagPress={() => setTagPickerForId(photo.id)}
                  isSelectMode={isSelectMode}
                  isSelected={selectedIds.has(photo.id)}
                />
              </Pressable>
            ))}
          </ScrollView>
        )}

        {viewerPhoto && (
          <Modal visible transparent animationType="fade" onRequestClose={() => setViewerPhotoId(null)}>
            <GestureHandlerRootView style={{ flex: 1 }}>
              <ZoomableImageViewer
                uri={viewerPhoto.imageUri}
                onClose={() => setViewerPhotoId(null)}
                actions={viewerActionsFor(viewerPhoto)}
              />
            </GestureHandlerRootView>
          </Modal>
        )}

        <RenamePrompt
          visible={renamingPhoto !== null}
          title="Назва фото"
          initialValue={renamingPhoto?.title ?? ''}
          onCancel={() => setRenamingPhoto(null)}
          onSave={(title) => {
            if (renamingPhoto) renamePhoto(renamingPhoto, title);
          }}
        />

        <Modal
          visible={addPhotoSheetVisible}
          transparent
          animationType="fade"
          onRequestClose={() => setAddPhotoSheetVisible(false)}
        >
          <Pressable style={styles.addPhotoBackdrop} onPress={() => setAddPhotoSheetVisible(false)}>
            <Pressable style={styles.addPhotoSheet} onPress={() => {}}>
              <View style={styles.addPhotoHandle} />
              <Pressable
                style={styles.addPhotoRow}
                onPress={() => {
                  setAddPhotoSheetVisible(false);
                  addPhotoDirectly('gallery');
                }}
              >
                <Ionicons name="image-outline" size={18} color="#111827" />
                <Text style={styles.addPhotoRowLabel}>Галерея</Text>
              </Pressable>
              <Pressable
                style={styles.addPhotoRow}
                onPress={() => {
                  setAddPhotoSheetVisible(false);
                  addPhotoDirectly('camera');
                }}
              >
                <Ionicons name="camera-outline" size={18} color="#111827" />
                <Text style={styles.addPhotoRowLabel}>Камера</Text>
              </Pressable>
            </Pressable>
          </Pressable>
        </Modal>

        <DocumentPickerModal
          visible={documentPicker !== null}
          subtitle={documentPicker?.photo.title}
          documents={documentPicker?.documents ?? []}
          onPick={pickDocument}
          onClose={() => setDocumentPicker(null)}
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


      </ContentColumn>


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

      <TagsDrawer
        tags={drawerTags}
        activeFilter={tagFilter}
        onSelectFilter={setTagFilter}
        hideOpenButton={isSelectMode}
      />

      <BulkActionBar
        count={selectedIds.size}
        onTag={() => setBulkTagPickerVisible(true)}
        onGroup={() => setBulkGroupPickerVisible(true)}
        onCopy={() => setBulkCopyModalVisible(true)}
        onCopyObject={copySelectedToClipboard}
        onDelete={confirmDeleteSelected}
      />

      {/* Through the portal, where its blur is safe - inside the screen
          it would be blurring a picture it is itself part of. */}
      {railFocused && !isSelectMode && (
        <GlassPortal>
          <Pressable style={[styles.fab, { bottom: rail.addBottom }]} onPress={() => setAddPhotoSheetVisible(true)}>
            <BlurView
              intensity={60}
              tint="dark"
              blurMethod="dimezisBlurView"
              blurTarget={railBlurTarget ?? undefined}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <Ionicons name="add-outline" size={28} color="#fff" />
          </Pressable>
        </GlassPortal>
      )}

      {toast && <UndoToast message={toast.message} onUndo={() => undo(toast.id)} />}
      {!toast && justAddedPhoto && (
        <UndoToast message="Додано у Фото" actionLabel="Перемістити" onUndo={() => setSaveDestinationVisible(true)} />
      )}
      {downloadToast && (
        <DownloadToast
          fileName={downloadToast.fileName}
          onShowInFolder={() => showDownloadedFileInFolder(downloadToast.uri, downloadToast.mimeType)}
          onIgnore={dismissDownloadToast}
        />
      )}

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
            copyObjectsToNote(null, [photoToBlock(item)], [{ collectionName: 'photos', id: item.id }]).then((newId) =>
              navigation.navigate('Editor', { documentId: newId })
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  // Same floating "+" DocumentsScreen uses, not a header icon.
  fab: {
    position: 'absolute',
    right: 20,
    width: 56,
    height: 56,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: ACCENT_GLASS,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: ACCENT,
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
  },
  addPhotoBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  addPhotoSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  addPhotoHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  addPhotoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  addPhotoRowLabel: {
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: '#111827',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 90,
    paddingBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 1,
  },
  header: {
    fontSize: 46,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: '#fff',
  },
  railWrap: {
    position: 'absolute',
    right: RAIL_RIGHT,
    alignItems: 'center',
  },
  // Stood on its end, like every other screen's.
  headerButtons: {
    alignItems: 'center',
    gap: 18,
    paddingVertical: 18,
    paddingHorizontal: 19,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: GLASS_ISLAND,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  // Turned with the capsule.
  headerButtonsDivider: {
    width: 20,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  menuBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 5,
  },
  menuRule: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 6,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  menuRowLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: '#111827',
  },
  menuPanel: {
    position: 'absolute',
    top: 96,
    right: RAIL_CLEARANCE,
    width: 200,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    zIndex: 6,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  // White capsule, border + text in the tag's own color - same as
  // DocumentsScreen's filterChip.
  filterChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  filterChipLabel: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: '#111827',
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
  },
  gridWithBulkBar: {
    paddingBottom: 90,
  },
  cellCheckbox: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cell: {
    width: '47%',
    aspectRatio: 1,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
  },
  cellImageWrap: {
    flex: 1,
  },
  cellImage: {
    width: '100%',
    height: '100%',
  },
  cellImageStatus: {
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  cellBadgeLabel: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: '#fff',
  },
  cellTagRow: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
});
