import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
import * as LegacyFileSystem from 'expo-file-system/legacy';
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
} from 'firebase/firestore';
import { db } from '../firebase';
import { Block, Group } from '../types';
import { RootStackParamList } from '../navigation';
import RenamePrompt from '../components/RenamePrompt';
import DocumentPickerModal, { PickableDocument } from '../components/DocumentPickerModal';
import UndoToast from '../components/UndoToast';
import TagChips from '../components/TagChips';
import TagPicker from '../components/TagPicker';
import BulkActionBar from '../components/BulkActionBar';
import GroupPickerSheet from '../components/GroupPickerSheet';
import ProjectTabsRow, { UNASSIGNED_ID } from '../components/ProjectTabsRow';
import TagsDrawer, { TagFilter, matchesTagFilter, removeTagFromFilter } from '../components/TagsDrawer';
import CopyToNoteModal from '../components/CopyToNoteModal';
import { usePendingDelete } from '../hooks/usePendingDelete';
import { useMultiSelect } from '../hooks/useMultiSelect';
import { useSortPref } from '../hooks/useSortPref';
import { useTags, detachTagFromDeletedItem } from '../hooks/useTags';
import { blockFromFile, copyObjectsToNote } from '../utils/copyToNote';
import { backupFileToDrive, deleteFileFromDrive } from '../utils/googleDrive';
import { sortItems } from '../utils/sortItems';
import { colorForDocument } from '../utils/documentColor';
import SortMenuRows from '../components/SortMenuRows';

const ACCENT = '#8B5CF6';
const DANGER = '#EF4444';
const groupsCollection = collection(db, 'groups');
const filesPrefsDoc = doc(db, 'settings', 'filesPrefs');

type ViewMode = 'list' | 'grid';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type FileItem = {
  id: string;
  fileUri: string;
  fileName: string;
  mimeType?: string;
  title?: string;
  documentIds: string[];
  tagIds: string[];
  groupId?: string;
  driveFileId?: string;
  driveBytes?: number;
  updatedAt: number;
  createdAt?: number;
};

// Same tinting-by-extension used on the file block itself in
// DocumentEditorScreen - kept as its own small copy here rather than shared,
// since the two versions have nothing else in common.
function fileIconFor(name: string): 'document-text-outline' | 'document-outline' {
  return name.toLowerCase().endsWith('.pdf') ? 'document-text-outline' : 'document-outline';
}

function fileIconColorFor(name: string): string {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'pdf') return '#DC2626';
  if (ext === 'doc' || ext === 'docx') return '#2563EB';
  if (ext === 'xls' || ext === 'xlsx') return '#16A34A';
  return '#6B7280';
}

export default function FilesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [renamingFile, setRenamingFile] = useState<FileItem | null>(null);
  const [documentPicker, setDocumentPicker] = useState<{ file: FileItem; documents: PickableDocument[] } | null>(
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [cardMenuFileId, setCardMenuFileId] = useState<string | null>(null);
  const { sortPref, selectSortField } = useSortPref('filesPrefs');
  const { filterPending, requestDeleteMany, undo, toast } = usePendingDelete<FileItem>();
  const { tags, attachTag, detachTag, createAndAttachTag, renameTag } = useTags();
  const { isSelectMode, selectedIds, toggleSelectMode, toggle: toggleSelected, clear: clearSelection } =
    useMultiSelect();

  useEffect(() => {
    const filesQuery = query(collection(db, 'files'), orderBy('updatedAt', 'desc'));
    return onSnapshot(filesQuery, (snapshot) => {
      setFiles(
        snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          return {
            id: docSnapshot.id,
            fileUri: data.fileUri,
            fileName: data.fileName,
            mimeType: data.mimeType,
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
    return onSnapshot(filesPrefsDoc, (snapshot) => {
      setViewMode((snapshot.data()?.viewMode as ViewMode | undefined) ?? 'list');
    });
  }, []);

  useEffect(() => {
    // Filtered client-side rather than with a `where('kind','==','file')`
    // query - combining an equality filter with `orderBy` on a different
    // field needs a composite index set up by hand in the Firebase
    // console, which this app avoids everywhere else too (see
    // TasksScreen's own comment on the same tradeoff).
    return onSnapshot(query(groupsCollection, orderBy('name')), (snapshot) => {
      setGroups(
        snapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as { name: string; color: string; kind: Group['kind'] }) }))
          .filter((g) => g.kind === 'file')
      );
    });
  }, []);

  const pendingFilteredFiles = filterPending(files);
  const groupFilteredFiles =
    groupFilter === null
      ? pendingFilteredFiles
      : groupFilter === UNASSIGNED_ID
        ? pendingFilteredFiles.filter((f) => !f.groupId)
        : pendingFilteredFiles.filter((f) => f.groupId === groupFilter);
  const tagFilteredFiles = groupFilteredFiles.filter((f) => matchesTagFilter(f.tagIds, tagFilter));
  // Only offer tags actually assigned to at least one file - not the whole
  // app-wide tag list - so this drawer stays a short, relevant menu.
  const usedTagIds = new Set(files.flatMap((f) => f.tagIds));
  const drawerTags = tags.filter((t) => usedTagIds.has(t.id));
  const needle = searchQuery.trim().toLowerCase();
  const searchedFiles = needle
    ? tagFilteredFiles.filter((f) => (f.title || f.fileName).toLowerCase().includes(needle))
    : tagFilteredFiles;
  const displayedFiles = sortItems(
    searchedFiles,
    sortPref,
    (f) => f.title || f.fileName,
    (f) => f.createdAt,
    (f) => f.updatedAt
  );
  const tagPickerFile = tagPickerForId ? files.find((f) => f.id === tagPickerForId) ?? null : null;
  const cardMenuFile = cardMenuFileId ? files.find((f) => f.id === cardMenuFileId) ?? null : null;
  const selectedFiles = files.filter((f) => selectedIds.has(f.id));

  // The "+" button - attaching a file straight into the database, no
  // document involved (usedInDocuments starts empty). Same picker call and
  // content://-preserving copy DocumentEditorScreen's own pickFileForBlock
  // uses (see its comment on why copyToCacheDirectory stays false), and the
  // same fire-and-forget Drive backup every new file block already gets.
  async function addFileDirectly() {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const id = generateId();
    const fileUri = `${LegacyFileSystem.cacheDirectory}${id}-${asset.name}`;
    await LegacyFileSystem.copyAsync({ from: asset.uri, to: fileUri });
    const now = Date.now();
    const data: Record<string, unknown> = { fileUri, fileName: asset.name, updatedAt: now, createdAt: now, usedInDocuments: {} };
    if (asset.mimeType) data.mimeType = asset.mimeType;
    await setDoc(doc(db, 'files', id), data, { merge: true });
    backupFileToDrive(fileUri, asset.name, asset.mimeType ?? 'application/octet-stream', 'Files').then((uploaded) => {
      if (uploaded) updateDoc(doc(db, 'files', id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
    });
  }

  async function openFile(file: FileItem) {
    const available = await Sharing.isAvailableAsync();
    if (!available) return;
    await Sharing.shareAsync(file.fileUri, { mimeType: file.mimeType, dialogTitle: file.fileName });
  }

  async function openDocumentIcon(file: FileItem) {
    if (file.documentIds.length === 0) return;
    if (file.documentIds.length === 1) {
      navigation.navigate('Editor', { documentId: file.documentIds[0] });
      return;
    }
    const documents = await Promise.all(
      file.documentIds.map(async (id) => {
        const snapshot = await getDoc(doc(db, 'documents', id));
        return { id, title: (snapshot.data()?.title as string) || 'Без назви' };
      })
    );
    setDocumentPicker({ file, documents });
  }

  function pickDocument(documentId: string) {
    setDocumentPicker(null);
    navigation.navigate('Editor', { documentId });
  }

  // Rename overrides the display title only - the actual attached file and
  // its original fileName are untouched. Propagates into every document
  // block that shows this file, same two-way-sync pattern as links.
  async function renameFile(file: FileItem, title: string) {
    setRenamingFile(null);
    await updateDoc(doc(db, 'files', file.id), { title });
    await Promise.all(
      file.documentIds.map(async (docId) => {
        const documentRef = doc(db, 'documents', docId);
        const snapshot = await getDoc(documentRef);
        const data = snapshot.data();
        if (!data) return;
        const blocks: Block[] = data.blocks ?? [];
        let changed = false;
        const updatedBlocks = blocks.map((b) => {
          if (b.id === file.id && (b.type ?? 'paragraph') === 'file') {
            changed = true;
            return { ...b, fileTitle: title };
          }
          return b;
        });
        if (changed) await updateDoc(documentRef, { blocks: updatedBlocks });
      })
    );
  }

  async function deleteFile(file: FileItem, alsoDeleteFromDrive: boolean) {
    deleteDoc(doc(db, 'files', file.id));
    if (alsoDeleteFromDrive && file.driveFileId) {
      deleteFileFromDrive(file.driveFileId, file.driveBytes).then((error) => {
        if (error) Alert.alert('Копія на Диску залишилась', error);
      });
    }
    await Promise.all(
      file.tagIds.map((tagId) => {
        const tag = tags.find((t) => t.id === tagId);
        return tag ? detachTagFromDeletedItem(tag, 'file', file.id) : Promise.resolve();
      })
    );
    await Promise.all(
      file.documentIds.map(async (docId) => {
        const documentRef = doc(db, 'documents', docId);
        const snapshot = await getDoc(documentRef);
        const data = snapshot.data();
        if (!data) return;
        const blocks: Block[] = data.blocks ?? [];
        const remaining = blocks.filter((b) => b.id !== file.id);
        if (remaining.length !== blocks.length) {
          updateDoc(documentRef, {
            blocks: remaining.length > 0 ? remaining : [{ id: generateId(), text: '' }],
          });
        }
      })
    );
  }

  function confirmDeleteSelected() {
    const filesToDelete = selectedFiles;
    const anyOnDrive = filesToDelete.some((f) => f.driveFileId);
    if (!anyOnDrive) {
      requestDeleteMany(filesToDelete, `Видалено файлів: ${filesToDelete.length}`, () => {
        filesToDelete.forEach((f) => deleteFile(f, false));
      });
      clearSelection();
      return;
    }
    Alert.alert('Видалити копії з Google Диску?', undefined, [
      {
        text: 'Залишити на Диску',
        onPress: () => {
          requestDeleteMany(filesToDelete, `Видалено файлів: ${filesToDelete.length}`, () => {
            filesToDelete.forEach((f) => deleteFile(f, false));
          });
          clearSelection();
        },
      },
      {
        text: 'Видалити з Диску',
        style: 'destructive',
        onPress: () => {
          requestDeleteMany(filesToDelete, `Видалено файлів: ${filesToDelete.length}`, () => {
            filesToDelete.forEach((f) => deleteFile(f, true));
          });
          clearSelection();
        },
      },
    ]);
  }

  async function bulkAttachTag(tag: Parameters<typeof attachTag>[0]) {
    setBulkTagPickerVisible(false);
    await Promise.all(selectedFiles.map((f) => attachTag(tag, 'file', f.id, 'files')));
    clearSelection();
  }

  async function bulkCreateAndAttachTag(path: string, icon: string, color: string) {
    setBulkTagPickerVisible(false);
    await Promise.all(selectedFiles.map((f) => createAndAttachTag(path, icon, color, 'file', f.id, 'files')));
    clearSelection();
  }

  async function changeViewMode(mode: ViewMode) {
    setMenuOpen(false);
    await setDoc(filesPrefsDoc, { viewMode: mode }, { merge: true });
  }

  async function bulkAssignGroup(groupId: string | null) {
    setBulkGroupPickerVisible(false);
    const batch = writeBatch(db);
    selectedFiles.forEach((f) => {
      batch.update(doc(db, 'files', f.id), { groupId: groupId ?? deleteField() });
    });
    await batch.commit();
    clearSelection();
  }

  async function bulkCopyToExisting(documentId: string) {
    setBulkCopyModalVisible(false);
    const blocks = selectedFiles.map(blockFromFile);
    await copyObjectsToNote(
      documentId,
      blocks,
      selectedFiles.map((f) => ({ collectionName: 'files', id: f.id }))
    );
    clearSelection();
  }

  async function bulkCopyToNew() {
    setBulkCopyModalVisible(false);
    const blocks = selectedFiles.map(blockFromFile);
    const newDocumentId = await copyObjectsToNote(
      null,
      blocks,
      selectedFiles.map((f) => ({ collectionName: 'files', id: f.id }))
    );
    clearSelection();
    navigation.navigate('Editor', { documentId: newDocumentId });
  }

  function renderFileRow(item: FileItem) {
    const { background, text, textMuted } = colorForDocument(item.id);
    return (
      <View key={item.id} style={[styles.row, { backgroundColor: background }]}>
        <Pressable
          style={styles.rowTap}
          onPress={() => (isSelectMode ? toggleSelected(item.id) : openFile(item))}
        >
          <View style={[styles.thumbIcon, { backgroundColor: `${fileIconColorFor(item.fileName)}1A` }]}>
            <Ionicons name={fileIconFor(item.fileName)} size={20} color={fileIconColorFor(item.fileName)} />
          </View>
          <View style={styles.rowBody}>
            <Text style={[styles.rowTitle, { color: text }]} numberOfLines={2}>
              {item.title || item.fileName}
            </Text>
            <View style={styles.rowMeta}>
              <TagChips
                tags={tags.filter((t) => item.tagIds.includes(t.id))}
                onPress={() => setTagPickerForId(item.id)}
                glass
              />
            </View>
          </View>
        </Pressable>
        {isSelectMode ? (
          <Pressable hitSlop={8} onPress={() => toggleSelected(item.id)} style={styles.rowActionButton}>
            <Ionicons
              name={selectedIds.has(item.id) ? 'checkmark-circle' : 'ellipse-outline'}
              size={22}
              color={selectedIds.has(item.id) ? text : textMuted}
            />
          </Pressable>
        ) : (
          <Pressable hitSlop={8} onPress={() => setCardMenuFileId(item.id)} style={styles.rowActionButton}>
            <Ionicons name="ellipsis-horizontal" size={16} color={textMuted} />
          </Pressable>
        )}
      </View>
    );
  }

  // Compact grid variant - same shape as DocumentCard/LinksScreen's own
  // grid layout.
  function renderFileGridCell(item: FileItem) {
    const { background, text, textMuted } = colorForDocument(item.id);
    return (
      <View key={item.id} style={[styles.gridCard, { backgroundColor: background }]}>
        <Pressable
          style={styles.gridTap}
          onPress={() => (isSelectMode ? toggleSelected(item.id) : openFile(item))}
        >
          <View style={[styles.gridThumb, { backgroundColor: `${fileIconColorFor(item.fileName)}1A` }]}>
            <Ionicons name={fileIconFor(item.fileName)} size={26} color={fileIconColorFor(item.fileName)} />
          </View>
          <Text style={[styles.gridTitle, { color: text }]} numberOfLines={2}>
            {item.title || item.fileName}
          </Text>
          <TagChips
            tags={tags.filter((t) => item.tagIds.includes(t.id))}
            onPress={() => setTagPickerForId(item.id)}
            glass
          />
        </Pressable>
        {isSelectMode ? (
          <View style={styles.gridSelectBox} pointerEvents="none">
            <Ionicons
              name={selectedIds.has(item.id) ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={selectedIds.has(item.id) ? text : '#fff'}
            />
          </View>
        ) : (
          <Pressable hitSlop={8} onPress={() => setCardMenuFileId(item.id)} style={styles.gridMenuButton}>
            <Ionicons name="ellipsis-horizontal" size={14} color={textMuted} />
          </Pressable>
        )}
      </View>
    );
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
          <LinearGradient id="filesBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.03" stopColor="#705648" />
            <Stop offset="0.52" stopColor="#69736E" />
            <Stop offset="1" stopColor="#000000" />
          </LinearGradient>
        </Defs>
        <Rect width={windowWidth + 2} height={windowHeight + 2} fill="url(#filesBg)" />
      </Svg>

      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.header}>Файли</Text>
        </View>
        <View style={styles.headerButtons}>
          <Pressable hitSlop={8} onPress={() => setMenuOpen((v) => !v)}>
            <Ionicons name="ellipsis-horizontal" size={17} color="#fff" />
          </Pressable>
          <View style={styles.headerButtonsDivider} />
          <Pressable hitSlop={8} onPress={toggleSelectMode}>
            <Ionicons name={isSelectMode ? 'close' : 'checkmark-circle-outline'} size={17} color="#fff" />
          </Pressable>
          <View style={styles.headerButtonsDivider} />
          <Pressable hitSlop={8} onPress={() => setIsSearching((prev) => !prev)}>
            <Ionicons name={isSearching ? 'close' : 'search'} size={17} color="#fff" />
          </Pressable>
        </View>
      </View>

      {menuOpen && <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)} />}
      {menuOpen && (
        <View style={styles.menuPanel}>
          <Text style={styles.menuSectionLabel}>Вигляд</Text>
          <Pressable style={styles.menuRow} onPress={() => changeViewMode('list')}>
            <Ionicons name="reorder-four-outline" size={17} color="#111827" />
            <Text style={styles.menuRowLabel}>Список</Text>
            {viewMode === 'list' && <Ionicons name="checkmark" size={18} color={ACCENT} />}
          </Pressable>
          <Pressable style={styles.menuRow} onPress={() => changeViewMode('grid')}>
            <Ionicons name="grid-outline" size={17} color="#111827" />
            <Text style={styles.menuRowLabel}>Сітка</Text>
            {viewMode === 'grid' && <Ionicons name="checkmark" size={18} color={ACCENT} />}
          </Pressable>
          <SortMenuRows sortPref={sortPref} onSelectField={selectSortField} accentColor={ACCENT} />
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
            placeholder="Пошук файлів"
            placeholderTextColor="#9CA3AF"
            style={styles.searchInput}
          />
        </View>
      )}

      {isLoading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : displayedFiles.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="document-outline" size={32} color={ACCENT} />
          </View>
          <Text style={styles.emptyLabel}>{needle ? 'Нічого не знайдено' : 'Ще немає файлів'}</Text>
          {!needle && (
            <Text style={styles.emptyHint}>
              Прикріпіть файл як блок у будь-якому документі - він з'явиться тут сам
            </Text>
          )}
        </View>
      ) : viewMode === 'grid' ? (
        <ScrollView contentContainerStyle={[styles.gridList, isSelectMode && styles.listWithBulkBar]}>
          {displayedFiles.map(renderFileGridCell)}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, isSelectMode && styles.listWithBulkBar]}>
          {displayedFiles.map(renderFileRow)}
        </ScrollView>
      )}

      <Modal
        visible={cardMenuFile !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setCardMenuFileId(null)}
      >
        <Pressable style={styles.cardMenuBackdrop} onPress={() => setCardMenuFileId(null)}>
          <Pressable style={styles.cardMenuSheet} onPress={() => {}}>
            <View style={styles.cardMenuHandle} />
            <Pressable
              style={styles.cardMenuRow}
              onPress={() => {
                if (cardMenuFile) setRenamingFile(cardMenuFile);
                setCardMenuFileId(null);
              }}
            >
              <Ionicons name="pencil-outline" size={18} color="#111827" />
              <Text style={styles.cardMenuRowLabel}>Редагувати назву</Text>
            </Pressable>
            {cardMenuFile && cardMenuFile.documentIds.length > 0 && (
              <Pressable
                style={styles.cardMenuRow}
                onPress={() => {
                  if (cardMenuFile) openDocumentIcon(cardMenuFile);
                  setCardMenuFileId(null);
                }}
              >
                <Ionicons name="document-text-outline" size={18} color="#111827" />
                <Text style={styles.cardMenuRowLabel}>
                  Документи{cardMenuFile.documentIds.length > 1 ? ` (${cardMenuFile.documentIds.length})` : ''}
                </Text>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </Modal>

      <RenamePrompt
        visible={renamingFile !== null}
        title="Назва файлу"
        initialValue={renamingFile?.title ?? renamingFile?.fileName ?? ''}
        onCancel={() => setRenamingFile(null)}
        onSave={(title) => {
          if (renamingFile) renameFile(renamingFile, title);
        }}
      />

      <DocumentPickerModal
        visible={documentPicker !== null}
        subtitle={documentPicker?.file.title || documentPicker?.file.fileName}
        documents={documentPicker?.documents ?? []}
        onPick={pickDocument}
        onClose={() => setDocumentPicker(null)}
      />

      <TagPicker
        visible={tagPickerFile !== null}
        kind="file"
        tags={tags}
        selectedTagIds={tagPickerFile?.tagIds ?? []}
        onAttach={(tag) => tagPickerFile && attachTag(tag, 'file', tagPickerFile.id, 'files')}
        onDetach={(tag) => tagPickerFile && detachTag(tag, 'file', tagPickerFile.id, 'files')}
        onCreateAndAttach={(path, icon, color) =>
          tagPickerFile && createAndAttachTag(path, icon, color, 'file', tagPickerFile.id, 'files')
        }
        onRenameTag={renameTag}
        onClose={() => setTagPickerForId(null)}
      />

      <TagPicker
        visible={bulkTagPickerVisible}
        kind="file"
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
        kind="file"
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
        onDelete={confirmDeleteSelected}
      />

      {!isSelectMode && (
        <Pressable style={styles.fab} onPress={addFileDirectly}>
          <Ionicons name="add" size={28} color="#fff" />
        </Pressable>
      )}

      {toast && <UndoToast message={toast.message} onUndo={() => undo(toast.id)} />}
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
    bottom: 100,
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: ACCENT,
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    // Matches Documents/Databases' own header capsule vertical position.
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
    // At least 2x the previous 22, matching Documents/Databases.
    fontSize: 46,
    fontWeight: '700',
    color: '#fff',
  },
  // One elongated glass capsule instead of three bare gray icons - matches
  // Documents/Calendar's own header capsule.
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 38,
    borderRadius: 19,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(20,20,20,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  headerButtonsDivider: {
    width: 1,
    height: 16,
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
  menuPanel: {
    position: 'absolute',
    top: 96,
    right: 20,
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
  menuSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.04,
    textTransform: 'uppercase',
    color: '#9CA3AF',
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 2,
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
    color: '#111827',
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
    backgroundColor: '#EDE9FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyLabel: {
    marginTop: 16,
    fontSize: 15,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
  },
  emptyHint: {
    marginTop: 6,
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
  },
  list: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    gap: 10,
  },
  gridList: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  listWithBulkBar: {
    paddingBottom: 90,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    borderRadius: 14,
    padding: 10,
    // Thin border + drop shadow, same as DocumentCard - a light-colored
    // card needs an edge to read against the gradient page behind it.
    borderWidth: 1,
    borderColor: 'rgba(176,176,176,0.5)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  rowTap: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
  },
  thumbIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    justifyContent: 'center',
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  rowActionButton: {
    padding: 6,
  },
  gridCard: {
    width: '48%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(176,176,176,0.5)',
    padding: 10,
    gap: 4,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  gridTap: {
    gap: 4,
  },
  gridThumb: {
    width: '100%',
    height: 96,
    borderRadius: 10,
    marginBottom: 4,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridTitle: {
    fontSize: 13,
    fontWeight: '700',
  },
  gridSelectBox: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridMenuButton: {
    position: 'absolute',
    top: 6,
    right: 6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: 'rgba(255,255,255,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  cardMenuSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  cardMenuHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  cardMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  cardMenuRowLabel: {
    fontSize: 15,
    color: '#111827',
  },
});
