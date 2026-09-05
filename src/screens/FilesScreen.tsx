import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Sharing from 'expo-sharing';
import { collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Block } from '../types';
import { RootStackParamList } from '../navigation';
import RenamePrompt from '../components/RenamePrompt';
import DocumentPickerModal, { PickableDocument } from '../components/DocumentPickerModal';
import UndoToast from '../components/UndoToast';
import { usePendingDelete } from '../hooks/usePendingDelete';

const ACCENT = '#8B5CF6';
const DANGER = '#EF4444';

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
  const { filterPending, requestDelete, undo, toast } = usePendingDelete<FileItem>();

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
          };
        })
      );
      setIsLoading(false);
    });
  }, []);

  const displayedFiles = filterPending(files);

  function openSortOrFilter() {
    navigation.navigate('Placeholder', { icon: 'options-outline', label: 'Скоро' });
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

  function confirmDeleteFile(file: FileItem) {
    requestDelete(file, 'Файл видалено', () => deleteFile(file));
  }

  async function deleteFile(file: FileItem) {
    deleteDoc(doc(db, 'files', file.id));
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

  function renderFileRow(item: FileItem) {
    const docCount = item.documentIds.length;
    return (
      <View key={item.id} style={styles.row}>
        <Pressable style={styles.rowTap} onPress={() => openFile(item)}>
          <View style={[styles.thumbIcon, { backgroundColor: `${fileIconColorFor(item.fileName)}1A` }]}>
            <Ionicons name={fileIconFor(item.fileName)} size={20} color={fileIconColorFor(item.fileName)} />
          </View>
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle} numberOfLines={2}>
              {item.title || item.fileName}
            </Text>
            <View style={styles.rowMeta}>
              <View style={styles.tagChip}>
                <Text style={styles.tagChipLabel}>Теги (скоро)</Text>
              </View>
            </View>
          </View>
        </Pressable>
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
        <View style={styles.headerIcons}>
          <Pressable hitSlop={8} onPress={openSortOrFilter}>
            <Ionicons name="swap-vertical-outline" size={20} color="#6B7280" />
          </Pressable>
          <Pressable hitSlop={8} onPress={openSortOrFilter}>
            <Ionicons name="filter-outline" size={20} color="#6B7280" />
          </Pressable>
        </View>
      </View>

      {displayedFiles.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="document-outline" size={32} color={ACCENT} />
          </View>
          <Text style={styles.emptyLabel}>Ще немає файлів</Text>
          <Text style={styles.emptyHint}>
            Прикріпіть файл як блок у будь-якому документі - він з'явиться тут сам
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>{displayedFiles.map(renderFileRow)}</ScrollView>
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
  headerIcons: {
    flexDirection: 'row',
    gap: 16,
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
  tagChip: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  tagChipLabel: {
    fontSize: 11,
    color: '#9CA3AF',
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
