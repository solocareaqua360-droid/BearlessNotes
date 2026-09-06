import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Sharing from 'expo-sharing';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
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
import { useTags, detachTagFromDeletedItem } from '../hooks/useTags';
import { blockFromFile, copyObjectsToNote } from '../utils/copyToNote';
import { deleteFileFromDrive } from '../utils/googleDrive';

const ACCENT = '#8B5CF6';
const DANGER = '#EF4444';
const groupsCollection = collection(db, 'groups');

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
  const { filterPending, requestDelete, requestDeleteMany, undo, toast } = usePendingDelete<FileItem>();
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
          };
        })
      );
      setIsLoading(false);
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
  const displayedFiles = needle
    ? tagFilteredFiles.filter((f) => (f.title || f.fileName).toLowerCase().includes(needle))
    : tagFilteredFiles;
  const tagPickerFile = tagPickerForId ? files.find((f) => f.id === tagPickerForId) ?? null : null;
  const selectedFiles = files.filter((f) => selectedIds.has(f.id));

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

  function confirmDeleteFile(file: FileItem) {
    if (!file.driveFileId) {
      requestDelete(file, 'Файл видалено', () => deleteFile(file, false));
      return;
    }
    Alert.alert('Видалити копію з Google Диску?', undefined, [
      {
        text: 'Залишити на Диску',
        onPress: () => requestDelete(file, 'Файл видалено', () => deleteFile(file, false)),
      },
      {
        text: 'Видалити з Диску',
        style: 'destructive',
        onPress: () => requestDelete(file, 'Файл видалено', () => deleteFile(file, true)),
      },
    ]);
  }

  async function deleteFile(file: FileItem, alsoDeleteFromDrive: boolean) {
    deleteDoc(doc(db, 'files', file.id));
    if (alsoDeleteFromDrive && file.driveFileId) {
      deleteFileFromDrive(file.driveFileId).then((error) => {
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
    const docCount = item.documentIds.length;
    return (
      <View key={item.id} style={styles.row}>
        <Pressable
          style={styles.rowTap}
          onPress={() => (isSelectMode ? toggleSelected(item.id) : openFile(item))}
        >
          {isSelectMode && (
            <Ionicons
              name={selectedIds.has(item.id) ? 'checkbox' : 'square-outline'}
              size={22}
              color={selectedIds.has(item.id) ? ACCENT : '#9CA3AF'}
              style={styles.rowCheckbox}
            />
          )}
          <View style={[styles.thumbIcon, { backgroundColor: `${fileIconColorFor(item.fileName)}1A` }]}>
            <Ionicons name={fileIconFor(item.fileName)} size={20} color={fileIconColorFor(item.fileName)} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle} numberOfLines={2}>
              {item.title || item.fileName}
            </Text>
            <View style={styles.rowMeta}>
              <TagChips
                tags={tags.filter((t) => item.tagIds.includes(t.id))}
                onPress={() => setTagPickerForId(item.id)}
              />
            </View>
          </View>
        </Pressable>
        {!isSelectMode && (
          <View style={styles.rowActions}>
            <Pressable hitSlop={8} onPress={() => setRenamingFile(item)} style={styles.rowActionButton}>
              <Ionicons name="pencil-outline" size={16} color="#9CA3AF" />
            </Pressable>
            <Pressable hitSlop={8} onPress={() => openDocumentIcon(item)} style={styles.rowDocButtonWrap}>
              <View style={styles.rowDocButton}>
                <Ionicons name="document-text-outline" size={16} color={ACCENT} />
              </View>
              {docCount > 1 && (
                <View style={styles.rowDocBadge}>
                  <Text style={styles.rowDocBadgeLabel}>{docCount}</Text>
                </View>
              )}
            </Pressable>
            <Pressable hitSlop={8} onPress={() => confirmDeleteFile(item)} style={styles.rowActionButton}>
              <Ionicons name="trash-outline" size={16} color={DANGER} />
            </Pressable>
          </View>
        )}
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.container, styles.emptyState]}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Файли</Text>
        <View style={styles.headerButtons}>
          <Pressable hitSlop={8} onPress={toggleSelectMode}>
            <Ionicons name={isSelectMode ? 'close' : 'checkmark-circle-outline'} size={20} color="#6B7280" />
          </Pressable>
          <Pressable hitSlop={8} onPress={() => setIsSearching((prev) => !prev)}>
            <Ionicons name={isSearching ? 'close' : 'search'} size={20} color="#6B7280" />
          </Pressable>
        </View>
      </View>

      {groups.length > 0 && (
        <ProjectTabsRow items={groups} selected={groupFilter} onSelect={setGroupFilter} unassignedLabel="Без групи" />
      )}

      {tagFilter && (
        <View style={styles.filterRow}>
          {tagFilter.type === 'untagged' ? (
            <View style={styles.filterChip}>
              <Ionicons name="pricetag-outline" size={13} color="#6B7280" />
              <Text style={styles.filterChipLabel}>Без тегів</Text>
              <Pressable hitSlop={8} onPress={() => setTagFilter(null)}>
                <Ionicons name="close" size={14} color="#6B7280" />
              </Pressable>
            </View>
          ) : (
            tagFilter.tagIds.map((tagId) => {
              const tag = tags.find((t) => t.id === tagId);
              if (!tag) return null;
              return (
                <View key={tagId} style={styles.filterChip}>
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

      {displayedFiles.length === 0 ? (
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
      ) : (
        <ScrollView contentContainerStyle={[styles.list, isSelectMode && styles.listWithBulkBar]}>
          {displayedFiles.map(renderFileRow)}
        </ScrollView>
      )}

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

      {toast && <UndoToast message={toast.message} onUndo={() => undo(toast.id)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 8,
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  filterChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  filterChipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: ACCENT,
  },
  rowCheckbox: {
    alignSelf: 'center',
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
    color: '#111827',
    textAlign: 'center',
  },
  emptyHint: {
    marginTop: 6,
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  list: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    gap: 10,
  },
  listWithBulkBar: {
    paddingBottom: 90,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 10,
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
    color: '#111827',
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 2,
  },
  rowActionButton: {
    padding: 6,
  },
  rowDocButtonWrap: {
    position: 'relative',
  },
  rowDocButton: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: '#F5F3FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowDocBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  rowDocBadgeLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
});
