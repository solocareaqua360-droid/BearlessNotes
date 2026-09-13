import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
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
  updateDoc,
  writeBatch,
} from '@react-native-firebase/firestore';
import { setDoc } from '../utils/owned';
import { db } from '../firebase';
import { Block } from '../types';
import { RootStackParamList } from '../navigation';
import RenamePrompt from '../components/RenamePrompt';
import DocumentPickerModal, { PickableDocument } from '../components/DocumentPickerModal';
import UndoToast from '../components/UndoToast';
import { FileGridCell, FileRow } from '../components/ItemCards';
import GroupSections from '../components/GroupSections';
import TagPicker from '../components/TagPicker';
import { copyObject, labelForBlock } from '../utils/objectClipboard';
import GroupPickerSheet from '../components/GroupPickerSheet';
import CopyToNoteModal from '../components/CopyToNoteModal';
import { useDatabaseList } from '../hooks/useDatabaseList';
import DatabaseChrome, { menuStyles } from '../components/DatabaseChrome';
import { detachTagFromDeletedItem } from '../hooks/useTags';
import { appendBlocksToToday, blockFromFile, copyObjectsToNote } from '../utils/copyToNote';
import { addItemToBoard, createBoardAndAddItem } from '../utils/addItemToBoard';
import SaveDestinationSheet from '../components/SaveDestinationSheet';
import { backupFileToDrive, deleteFileFromDrive } from '../utils/googleDrive';
import { colorForDocument } from '../utils/documentColor';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { ensureFileIsHere, openFileExternally } from '../utils/openFileExternally';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout';
import { downloadToFolder } from '../utils/downloadToFolder';
import { useDownloadToast } from '../hooks/useDownloadToast';
import DownloadToast from '../components/DownloadToast';
import DocumentQuickLook, { QuickLookKind, quickLookKindFor } from '../components/DocumentQuickLook';
import FilePreviewWorker from '../components/FilePreviewWorker';
import { GLASS_ISLAND } from '../constants/glass';
import { CAPSULE_DROP, CHROME_TOP, RAIL_CLEARANCE, RAIL_RIGHT } from '../constants/rail';
import { ask, confirm, notify } from '../components/surfaces/Ask';

const ACCENT = '#0EA5E9';
// The same half-strength tint the documents screen's add button takes -
// the blur behind it is what separates it, so the colour only tints.
const ACCENT_GLASS = 'rgba(14,165,233,0.55)';
const DANGER = '#EF4444';


type JustAddedFile = { id: string; fileUri: string; fileName: string; mimeType?: string; createdAt: number };

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

export default function FilesScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { isTwoPane } = useResponsiveLayout();
  const { downloadToast, showDownloadToast, dismissDownloadToast } = useDownloadToast();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [renamingFile, setRenamingFile] = useState<FileItem | null>(null);
  const [documentPicker, setDocumentPicker] = useState<{ file: FileItem; documents: PickableDocument[] } | null>(
    null
  );
  const [tagPickerForId, setTagPickerForId] = useState<string | null>(null);
  const [bulkTagPickerVisible, setBulkTagPickerVisible] = useState(false);
  const [bulkGroupPickerVisible, setBulkGroupPickerVisible] = useState(false);
  const [bulkCopyModalVisible, setBulkCopyModalVisible] = useState(false);
  const [cardMenuFileId, setCardMenuFileId] = useState<string | null>(null);
  // The file being looked at in the quick look, with the record it came
  // from so "open elsewhere" can hand the same file on.
  const [quickLook, setQuickLook] = useState<{
    uri: string;
    name: string;
    kind: QuickLookKind;
    file: FileItem;
  } | null>(null);
  // The record a "+" add just created, waiting on the "Перемістити" toast
  // (see relocateJustAddedFile) - the file itself already lives in the
  // base regardless of what happens here.
  const [justAddedFile, setJustAddedFile] = useState<JustAddedFile | null>(null);
  const [saveDestinationVisible, setSaveDestinationVisible] = useState(false);
  // Same 4s window usePendingDelete's own undo toast uses - ignored (not
  // cleared) while the sheet is actually open so it can't vanish mid-choice.
  useEffect(() => {
    if (!justAddedFile || saveDestinationVisible) return;
    const timeoutId = setTimeout(() => setJustAddedFile(null), 4000);
    return () => clearTimeout(timeoutId);
  }, [justAddedFile, saveDestinationVisible]);

  // The machine every database shares - see useDatabaseList. What stays in
  // this file is only what files themselves do.
  const list = useDatabaseList<FileItem>({
    prefsKey: 'filesPrefs',
    groupKind: 'file',
    tagKind: 'file',
    items: files,
    tagIdsOf: (f) => f.tagIds,
    groupIdOf: (f) => f.groupId,
    titleOf: (f) => f.title || f.fileName,
    createdAtOf: (f) => f.createdAt,
    updatedAtOf: (f) => f.updatedAt,
  });
  const {
    displayed: displayedFiles,
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
    requestDeleteMany,
    undo,
    toast,
    selected: selectedFiles,
    needle,
    viewMode,
    changeViewMode,
  } = list;

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

  const tagPickerFile = tagPickerForId ? files.find((f) => f.id === tagPickerForId) ?? null : null;
  const cardMenuFile = cardMenuFileId ? files.find((f) => f.id === cardMenuFileId) ?? null : null;

  // The one selected row, put on the app's own clipboard as the block that
  // REFERENCES it - pasted into a document it stays this same record
  // rather than becoming a second copy of it (see objectClipboard).
  function copySelectedToClipboard() {
    const [only] = selectedFiles;
    if (!only) return;
    const block = blockFromFile(only);
    copyObject({ label: labelForBlock(block), block });
    clearSelection();
  }

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
    // Lands in the base either way (unchanged, fast); "Перемістити" on the
    // toast below is the opt-in path to ALSO reference it from a note/
    // today/board, via the same SaveDestinationSheet ShareIntentHandler
    // uses - it never removes the base record, only adds a block elsewhere.
    setJustAddedFile({ id, fileUri, fileName: asset.name, mimeType: asset.mimeType, createdAt: now });
  }

  function fileToBlock(item: JustAddedFile) {
    return blockFromFile({ id: item.id, fileUri: item.fileUri, fileName: item.fileName, mimeType: item.mimeType, createdAt: item.createdAt });
  }

  function fileToImportableItem(item: JustAddedFile) {
    return {
      id: item.id,
      kind: 'file',
      title: item.fileName,
      data: { fileUri: item.fileUri, fileName: item.fileName, mimeType: item.mimeType, createdAt: item.createdAt },
    };
  }

  function relocateJustAddedFile(destination: (item: JustAddedFile) => Promise<unknown>) {
    const item = justAddedFile;
    if (!item) return;
    setJustAddedFile(null);
    setSaveDestinationVisible(false);
    destination(item).catch((e) => console.warn('[FilesScreen] relocate failed', e));
  }

  // A Word or Excel file is looked at right here; anything else goes to
  // the app that opens it. Either way the bytes are fetched back from
  // Drive first when this device does not have them.
  // A copy out of the app, into the folder the user picked once. The bytes
  // are fetched back from Drive first if this device does not have them.
  async function handleDownloadFile(file: FileItem) {
    if (!(await ensureFileIsHere(file))) return;
    try {
      const result = await downloadToFolder(
        file.fileUri,
        file.title || file.fileName,
        file.mimeType || 'application/octet-stream'
      );
      if (result) showDownloadToast(result.fileName, result.destUri, file.mimeType || '*/*');
    } catch (error) {
      notify('Не вдалося завантажити', (error as Error).message);
    }
  }

  async function openFile(file: FileItem) {
    const kind = quickLookKindFor(file.fileName);
    if (kind) {
      if (await ensureFileIsHere(file)) {
        setQuickLook({ uri: file.fileUri, name: file.title || file.fileName, kind, file });
      }
      return;
    }
    await openFileExternally(file);
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
        if (error) notify('Копія на Диску залишилась', error);
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
    // Two real answers, neither of them a confirmation - so it is asked,
    // not confirmed.
    ask({
      title: 'Видалити копії з Google Диску?',
      actions: [
        { id: 'keep', label: 'Залишити на Диску', icon: 'cloud-done-outline' },
        { id: 'drive', label: 'Видалити з Диску', tone: 'danger', icon: 'cloud-offline-outline' },
      ],
    }).then((answer) => {
      if (answer === 'cancel') return;
      requestDeleteMany(filesToDelete, `Видалено файлів: ${filesToDelete.length}`, () => {
        filesToDelete.forEach((f) => deleteFile(f, answer === 'drive'));
      });
      clearSelection();
    });
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
    return (
      <FileRow
        key={item.id}
        file={item}
        // The card says when it arrived - see FileCardItem.createdAt.
        tags={tags.filter((t) => item.tagIds.includes(t.id))}
        onPress={() => (isSelectMode ? toggleSelected(item.id) : openFile(item))}
        onLongPress={() => setCardMenuFileId(item.id)}
        onMenu={() => setCardMenuFileId(item.id)}
        onTagPress={() => setTagPickerForId(item.id)}
        isSelectMode={isSelectMode}
        isSelected={selectedIds.has(item.id)}
        onToggleSelect={() => toggleSelected(item.id)}
      />
    );
  }

  function renderFileGridCell(item: FileItem) {
    return (
      <FileGridCell
        key={item.id}
        file={item}
        tags={tags.filter((t) => item.tagIds.includes(t.id))}
        onPress={() => (isSelectMode ? toggleSelected(item.id) : openFile(item))}
        onLongPress={() => setCardMenuFileId(item.id)}
        onMenu={() => setCardMenuFileId(item.id)}
        onTagPress={() => setTagPickerForId(item.id)}
        isSelectMode={isSelectMode}
        isSelected={selectedIds.has(item.id)}
        onToggleSelect={() => toggleSelected(item.id)}
      />
    );
  }

  return (
    <DatabaseChrome
      list={list}
      accent={ACCENT}
      accentGlass={ACCENT_GLASS}
      onBack={() => navigation.goBack()}
      searchPlaceholder="Пошук файлів"
      onAdd={addFileDirectly}
      menuRows={(close) => (
        <>
          <Text style={menuStyles.menuSectionLabel}>Вигляд</Text>
          <Pressable
            style={menuStyles.menuRow}
            onPress={() => {
              close();
              changeViewMode('list');
            }}
          >
            <Ionicons name="reorder-four-outline" size={17} color="#111827" />
            <Text style={menuStyles.menuRowLabel}>Список</Text>
            {viewMode === 'list' && <Ionicons name="checkmark" size={18} color={ACCENT} />}
          </Pressable>
          <Pressable
            style={menuStyles.menuRow}
            onPress={() => {
              close();
              changeViewMode('grid');
            }}
          >
            <Ionicons name="grid-outline" size={17} color="#111827" />
            <Text style={menuStyles.menuRowLabel}>Сітка</Text>
            {viewMode === 'grid' && <Ionicons name="checkmark" size={18} color={ACCENT} />}
          </Pressable>
        </>
      )}
      bulk={{
        onTag: () => setBulkTagPickerVisible(true),
        onGroup: () => setBulkGroupPickerVisible(true),
        onCopy: () => setBulkCopyModalVisible(true),
        onCopyObject: copySelectedToClipboard,
        onDelete: confirmDeleteSelected,
      }}
      // Beside the list on a wide screen, over everything on a phone - the
      // same quick look either way.
      pane={
        isTwoPane ? (
          <DocumentQuickLook
            embedded
            file={quickLook}
            onClose={() => setQuickLook(null)}
            onOpenElsewhere={() => {
              const file = quickLook?.file;
              setQuickLook(null);
              if (file) openFileExternally(file);
            }}
          />
        ) : undefined
      }
      overlay={
        <>
          {/* The one hidden browser that makes every card's preview, a
              file at a time - see FilePreviewWorker. */}
          <FilePreviewWorker />
          {!isTwoPane && (
            <DocumentQuickLook
              file={quickLook}
              onClose={() => setQuickLook(null)}
              onOpenElsewhere={() => {
                const file = quickLook?.file;
                setQuickLook(null);
                if (file) openFileExternally(file);
              }}
            />
          )}
          {/* Where it landed, and a way to open the folder it landed in. */}
          {downloadToast && (
            <DownloadToast
              fileName={downloadToast.fileName}
              onShowInFolder={() => {
                dismissDownloadToast();
                Sharing.shareAsync(downloadToast.uri, { mimeType: downloadToast.mimeType }).catch(() => {});
              }}
              onIgnore={dismissDownloadToast}
            />
          )}
          {toast && <UndoToast message={toast.message} onUndo={() => undo(toast.id)} />}
          {!toast && justAddedFile && (
            <UndoToast
              message={`Додано у Файли: ${justAddedFile.fileName}`}
              actionLabel="Перемістити"
              onUndo={() => setSaveDestinationVisible(true)}
            />
          )}

          {/* The per-card "..." - rename, and the documents this file sits
              in when it sits in any. */}
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
                {/* Saved where the phone keeps everything else, into the
                  folder picked once - the app's own copy is not somewhere
                  a person can reach. */}
              <Pressable
                style={styles.cardMenuRow}
                onPress={() => {
                  const file = cardMenuFile;
                  setCardMenuFileId(null);
                  if (file) handleDownloadFile(file);
                }}
              >
                <Ionicons name="download-outline" size={18} color="#111827" />
                <Text style={styles.cardMenuRowLabel}>Завантажити</Text>
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

          <SaveDestinationSheet
            visible={saveDestinationVisible}
            title="Куди додати файл?"
            defaultLabel="Лишити в базі"
            onPickDefault={() => relocateJustAddedFile(async () => {})}
            onPickToday={() =>
              relocateJustAddedFile((item) =>
                appendBlocksToToday([fileToBlock(item)], [{ collectionName: 'files', id: item.id }])
              )
            }
            onPickNew={() =>
              relocateJustAddedFile((item) =>
                copyObjectsToNote(null, [fileToBlock(item)], [{ collectionName: 'files', id: item.id }]).then(
                  (newId) => navigation.navigate('Editor', { documentId: newId })
                )
              )
            }
            onPickExisting={(documentId) =>
              relocateJustAddedFile((item) =>
                copyObjectsToNote(documentId, [fileToBlock(item)], [{ collectionName: 'files', id: item.id }])
              )
            }
            onPickNewBoard={() =>
              relocateJustAddedFile((item) => createBoardAndAddItem('Без назви', fileToImportableItem(item)))
            }
            onPickExistingBoard={(boardId) =>
              relocateJustAddedFile((item) => addItemToBoard(boardId, fileToImportableItem(item)))
            }
            onClose={() => setSaveDestinationVisible(false)}
          />
        </>
      }
    >
      {(listTopPad, listProps) =>
        isLoading ? (
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
          <ScrollView
            {...listProps}
            contentContainerStyle={[
              styles.gridList,
              { paddingTop: listTopPad },
              isSelectMode && styles.listWithBulkBar,
            ]}
          >
            {displayedFiles.map(renderFileGridCell)}
            <GroupSections groupId={list.selectedGroupId} currentKind="file" tags={tags} />
          </ScrollView>
        ) : (
          <ScrollView
            {...listProps}
            contentContainerStyle={[
              styles.list,
              { paddingTop: listTopPad },
              isSelectMode && styles.listWithBulkBar,
            ]}
          >
            {displayedFiles.map(renderFileRow)}
            {/* What else is in this group - see GroupSections. */}
            <GroupSections groupId={list.selectedGroupId} currentKind="file" tags={tags} />
          </ScrollView>
        )
      }
    </DatabaseChrome>
  );
}

const styles = StyleSheet.create({
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
    fontFamily: FONT_REGULAR,
    color: '#111827',
  },
});
