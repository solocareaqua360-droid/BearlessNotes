import { useEffect, useRef, useState } from 'react';
import { useTheme, useStyles } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
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
import { GestureDetector } from 'react-native-gesture-handler';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as Sharing from 'expo-sharing';
import * as DocumentPicker from 'expo-document-picker';
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
import { useBin } from '../hooks/useBin';
import { useExplorer, ExplorerFolder, nameOf } from '../hooks/useExplorer';
import ExplorerHead from '../components/ExplorerHead';
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
import { downloadToFolder, showDownloadedFile } from '../utils/downloadToFolder';
import { useDownloadToast } from '../hooks/useDownloadToast';
import DownloadToast from '../components/DownloadToast';
import DocumentQuickLook, { QuickLookKind, quickLookKindFor } from '../components/DocumentQuickLook';
import FilePreviewWorker from '../components/FilePreviewWorker';
import { SHEET_BACKDROP, SHEET_WINDOW } from '../constants/glass';
import { CAPSULE_DROP, CHROME_TOP, RAIL_CLEARANCE, RAIL_RIGHT , railClear } from '../constants/rail';
import { ask, confirm, notify } from '../components/surfaces/Ask';
import { useExplorerCarry } from '../hooks/useExplorerCarry';
import CardCarryOverlay from '../components/CardCarryOverlay';

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
  // Set while the file sits in the bin (see useBin) - hidden from every
  // list, tags/group/references untouched, purged for good after 30 days.
  deletedAt?: number;
};

// Same tinting-by-extension used on the file block itself in
// DocumentEditorScreen - kept as its own small copy here rather than shared,
// since the two versions have nothing else in common.

export default function FilesScreen({ inPane }: { inPane?: boolean } = {}) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // Not two panes INSIDE a pane. Drawn in another screen's pane this
  // screen is already half a window, and a quick look beside the list
  // there would split that half again - which is exactly what it did:
  // the chrome laid the list in the right half of the pane, the cards
  // were squeezed into a strip a quarter of the window wide, and the
  // other half stood empty. The quick look goes over the list instead,
  // as on a phone.
  const isTwoPane = useResponsiveLayout().isTwoPane && !inPane;
  const { downloadToast, showDownloadToast, dismissDownloadToast } = useDownloadToast();
  const [files, setFiles] = useState<FileItem[]>([]);
  const [trashedFiles, setTrashedFiles] = useState<FileItem[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
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
    selected: selectedFiles,
    needle,
    viewMode,
    changeViewMode,
  } = list;
  // The bin - see useBin. Auto-purge always keeps the Drive copy; a
  // human-initiated purge (openFileTrashMenu/emptyFileBin below) is the
  // only path that ever asks about deleting it too.
  const bin = useBin<FileItem>('files', trashedFiles, (file) => purgeFile(file, false));

  useEffect(() => {
    return onSnapshot(ownedQuery('files'), (snapshot) => {
      const all = snapshot.docs
        .map((docSnapshot) => {
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
            deletedAt: data.deletedAt,
          };
        })
        .sort((a, b) => b.updatedAt - a.updatedAt);
      setFiles(all.filter((f) => !f.deletedAt));
      setTrashedFiles(all.filter((f) => !!f.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)));
      setIsLoading(false);
    });
  }, []);

  // Folders, read off the tag tree - see useExplorer. Every database that
  // carries tags can have them, and the user asked for exactly that:
  // "немає папок тут та в інших базах".
  const explorer = useExplorer<FileItem>({
    kind: 'file',
    collection: 'files',
    items: files,
    displayed: displayedFiles,
    tagIdsOf: (f) => f.tagIds,
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
  const filesHere = explorer.visibleItems;

  // Carrying a card into a folder - the whole of it (gesture state, the
  // undo toast, the carried card's survival across a folder change) in
  // useExplorerCarry, shared with every other database screen.
  const carrying = useExplorerCarry<FileItem>({
    path: explorer.path,
    folders: explorer.folders,
    moveItem: (item, destination) => explorer.moveItem(item, destination),
    items: files,
    isSelectMode,
    selectedIds,
    active: explorer.active,
    onMoved: () => {
      if (isSelectMode) clearSelection();
    },
  });
  const listedFiles = filesHere;


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
    // As many as are ticked: importing a folder of documents one at a
    // time was the user's own complaint.
    const result = await DocumentPicker.getDocumentAsync({
      type: '*/*',
      copyToCacheDirectory: false,
      multiple: true,
    });
    if (result.canceled || result.assets.length === 0) return;
    const now = Date.now();
    const added: JustAddedFile[] = [];
    for (const asset of result.assets) {
      const id = generateId();
      const fileUri = `${LegacyFileSystem.cacheDirectory}${id}-${asset.name}`;
      await LegacyFileSystem.copyAsync({ from: asset.uri, to: fileUri });
      const data: Record<string, unknown> = { fileUri, fileName: asset.name, updatedAt: now, createdAt: now, usedInDocuments: {} };
      if (asset.mimeType) data.mimeType = asset.mimeType;
      await setDoc(doc(db, 'files', id), data, { merge: true });
      backupFileToDrive(fileUri, asset.name, asset.mimeType ?? 'application/octet-stream', 'Files').then((uploaded) => {
        if (uploaded) updateDoc(doc(db, 'files', id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
      });
      await explorer.assignToCurrentFolder(id);
      added.push({ id, fileUri, fileName: asset.name, mimeType: asset.mimeType, createdAt: now });
    }
    // Lands in the base either way (unchanged, fast); "Перемістити" on the
    // toast below is the opt-in path to ALSO reference it from a note/
    // today/board, via the same SaveDestinationSheet ShareIntentHandler
    // uses - it never removes the base record, only adds a block elsewhere.
    // With several, the offer is about the last one; the rest are already
    // where they belong.
    if (added.length === 1) setJustAddedFile(added[0]);
    else notify(`Додано файлів: ${added.length}`);
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

  // Gone for good: what deleting used to be, now only reached by purging
  // from the bin - see useBin. Detaches every tag, drops the file out of
  // any note that still references it, and optionally takes its Drive
  // backup with it.
  async function purgeFile(file: FileItem, alsoDeleteFromDrive: boolean) {
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

  // Held down in the bin: back, or away for good - the drive question
  // only comes up on the "away for good" branch, and only when there is
  // a Drive copy to ask about.
  async function openFileTrashMenu(file: FileItem) {
    const choice = await ask({
      title: file.title || file.fileName,
      actions: [
        { id: 'restore', label: 'Відновити', icon: 'arrow-undo-outline', tone: 'primary' },
        { id: 'purge', label: 'Видалити назавжди', icon: 'trash-outline', tone: 'danger' },
      ],
    });
    if (choice === 'restore') {
      await bin.restore(file.id);
      return;
    }
    if (choice !== 'purge') return;
    if (!file.driveFileId) {
      await purgeFile(file, false);
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
    await purgeFile(file, driveAnswer === 'drive');
  }

  async function emptyFileBin() {
    if (trashedFiles.length === 0) return;
    const yes = await confirm({
      title: `Очистити кошик (${trashedFiles.length})?`,
      message: 'Ці файли буде видалено назавжди.',
      confirmLabel: 'Очистити',
    });
    if (!yes) return;
    const anyOnDrive = trashedFiles.some((f) => f.driveFileId);
    if (!anyOnDrive) {
      await Promise.all(trashedFiles.map((f) => purgeFile(f, false)));
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
    await Promise.all(trashedFiles.map((f) => purgeFile(f, driveAnswer === 'drive')));
  }

  // "Delete" puts a file in the bin (see useBin) - the record, its tags
  // and every note that references it stay exactly as they were.
  function confirmDeleteSelected() {
    const filesToDelete = selectedFiles;
    confirm({
      title: filesToDelete.length === 1 ? 'У кошик?' : `У кошик (${filesToDelete.length})?`,
      message: 'Можна буде повернути з кошика протягом 30 днів.',
      confirmLabel: 'У кошик',
    }).then((yes) => {
      if (!yes) return;
      Promise.all(filesToDelete.map((f) => bin.moveToBin(f.id)));
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
    // Only in the explorer. Carried, the row's own onLongPress is dropped
    // - the list's drag gesture opens the menu itself, on its own timing,
    // instead of racing it (see useExplorerCarry).
    const carried = explorer.active;
    const row = (
      <FileRow
        key={item.id}
        file={item}
        // The card says when it arrived - see FileCardItem.createdAt.
        tags={tags.filter((t) => item.tagIds.includes(t.id))}
        onPress={() => (isSelectMode ? toggleSelected(item.id) : openFile(item))}
        onLongPress={carried ? undefined : () => setCardMenuFileId(item.id)}
        onMenu={() => setCardMenuFileId(item.id)}
        onTagPress={() => setTagPickerForId(item.id)}
        isSelectMode={isSelectMode}
        isSelected={selectedIds.has(item.id)}
        onToggleSelect={() => toggleSelected(item.id)}
        {...(carried ? carrying.cardProps(item, () => setCardMenuFileId(item.id)) : {})}
      />
    );
    return row;
  }

  // Three across where the column is actually wide enough to hold them -
  // the fold open, a tablet, the browser - and two on a phone. Measured
  // off the column the chrome hands down, not the window: in a pane the
  // two are not the same number.
  function renderFileGridCell(item: FileItem, columns: number) {
    const carried = explorer.active;
    const cell = (
      <FileGridCell
        key={item.id}
        columns={columns}
        file={item}
        tags={tags.filter((t) => item.tagIds.includes(t.id))}
        onPress={() => (isSelectMode ? toggleSelected(item.id) : openFile(item))}
        onLongPress={carried ? undefined : () => setCardMenuFileId(item.id)}
        onMenu={() => setCardMenuFileId(item.id)}
        onTagPress={() => setTagPickerForId(item.id)}
        isSelectMode={isSelectMode}
        isSelected={selectedIds.has(item.id)}
        onToggleSelect={() => toggleSelected(item.id)}
        {...(carried ? carrying.cardProps(item, () => setCardMenuFileId(item.id)) : {})}
      />
    );
    return cell;
  }

  // The bin's own rows - a tap or a hold both open the same restore/purge
  // menu, same as Documents' own bin.
  function renderFileTrashRow(item: FileItem) {
    return (
      <FileRow
        key={item.id}
        file={item}
        tags={tags.filter((t) => item.tagIds.includes(t.id))}
        onPress={() => openFileTrashMenu(item)}
        onLongPress={() => openFileTrashMenu(item)}
      />
    );
  }

  function renderFileTrashGridCell(item: FileItem, columns: number) {
    return (
      <FileGridCell
        key={item.id}
        file={item}
        columns={columns}
        tags={tags.filter((t) => item.tagIds.includes(t.id))}
        onPress={() => openFileTrashMenu(item)}
        onLongPress={() => openFileTrashMenu(item)}
      />
    );
  }

  // Shared by both the grid and the list body below - the explorer's own
  // head (crumbs/folders/bin entry), or the bin's own head when open.
  function explorerOrTrashHead() {
    if (trashOpen) {
      return (
        <View style={styles.trashHead}>
          <View style={styles.trashHeadRow}>
            <Pressable hitSlop={8} onPress={() => setTrashOpen(false)} style={styles.trashBack}>
              <Ionicons name="chevron-back" size={18} color={theme.ink.primary} />
            </Pressable>
            <Text style={styles.trashTitle}>Кошик · {trashedFiles.length}</Text>
            <View style={{ flex: 1 }} />
            {trashedFiles.length > 0 && (
              <Pressable hitSlop={8} onPress={emptyFileBin}>
                <Text style={styles.trashClear}>Очистити</Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.trashHint}>
            Затисни файл, щоб відновити або видалити назавжди. Через 30 днів кошик очищається сам.
          </Text>
        </View>
      );
    }
    if (!list.explorerMode) return null;
    return (
      <ExplorerHead
        path={explorer.path}
        folders={explorer.folders}
        itemIcon="document-outline"
        onGo={(next) => {
          explorer.setPath(next);
          if (needle !== '') {
            list.setSearchQuery('');
            list.setIsSearching(false);
          }
        }}
        onFolderMenu={openFolderMenu}
        trash={{ count: trashedFiles.length, onOpen: () => setTrashOpen(true) }}
        folderRef={carrying.carry.registerFolder}
      />
    );
  }

  return (
    <DatabaseChrome
      list={list}
      railSide={inPane ? 'left' : 'right'}
      accent={ACCENT}
      accentGlass={ACCENT_GLASS}
      onBack={() => navigation.goBack()}
      leaveIcon="document-outline"
      searchPlaceholder="Пошук файлів"
      onAdd={addFileDirectly}
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
      // Beside the list on a wide screen, over everything on a phone - the
      // same quick look either way.
      //
      // Only while there is actually a file to look at: the chrome splits
      // the window the moment it is GIVEN a pane, so handing it one that
      // renders nothing left the list squeezed into the right half with an
      // empty half beside it. A pane is something to show, not a mode.
      pane={
        isTwoPane && quickLook ? (
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
                showDownloadedFile(downloadToast.uri, downloadToast.mimeType);
              }}
              onIgnore={dismissDownloadToast}
            />
          )}
          {justAddedFile && (
            <UndoToast
              message={`Додано у Файли: ${justAddedFile.fileName}`}
              actionLabel="Перемістити"
              onUndo={() => setSaveDestinationVisible(true)}
            />
          )}
          {carrying.movedToast && <UndoToast message={carrying.toastMessage} onUndo={carrying.undoMove} />}
          {/* The floating card while one is being carried into a folder -
              see useCardCarry. Always mounted, invisible until then. */}
          <CardCarryOverlay
            carry={carrying.carry}
            label={(items) =>
              items.length > 1 ? `${items.length} файли` : items[0].title || items[0].fileName
            }
            icon="document-outline"
            onEnterFolder={(path) => explorer.setPath(path)}
          />

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
                {/* Where the drag-and-drop lands a card, for anyone who
                    would rather pick the folder from a list - and the only
                    way to reach a folder that is not on screen. */}
                <Pressable
                  style={styles.cardMenuRow}
                  onPress={async () => {
                    const file = cardMenuFile;
                    setCardMenuFileId(null);
                    if (!file) return;
                    const destination = await explorer.pickDestination(
                      `Перемістити «${file.title || file.fileName}» в…`
                    );
                    if (destination === 'cancel') return;
                    await explorer.moveItem(file, destination);
                  }}
                >
                  {/* The sheet under it is white in every theme (its own
                      fixed pair with cardMenuRowLabel), so this ink is the
                      literal its siblings use and not the theme's. */}
                  <Ionicons name="folder-outline" size={18} color="#111827" />
                  <Text style={styles.cardMenuRowLabel}>Перемістити в папку</Text>
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

          <RenamePrompt
            visible={explorer.folderPrompt !== null}
            title={explorer.folderPrompt?.mode === 'rename' ? 'Назва папки' : 'Нова папка'}
            initialValue={explorer.folderPrompt?.mode === 'rename' ? nameOf(explorer.folderPrompt.path) : ''}
            onCancel={() => explorer.setFolderPrompt(null)}
            onSave={(name) => explorer.saveFolderName(name)}
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
      {(listTopPad, listProps, listWidth, scrollY) => {
        carrying.scrollYRef.current = scrollY;
        return isLoading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : // listedFiles, not filesHere: stepping into an empty folder while
        // carrying would otherwise swap the whole list for the empty state
        // and unmount the carried row with it - the very thing `orphan`
        // exists to prevent.
        !trashOpen && listedFiles.length === 0 && explorer.folders.length === 0 ? (
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
          <GestureDetector gesture={carrying.listGesture}>
          <ScrollView
            ref={carrying.scrollRef as React.RefObject<ScrollView>}
            {...listProps}
            contentContainerStyle={[
              styles.gridPage,
              railClear(inPane ? 'left' : 'right', 20),
              { paddingTop: listTopPad },
              ]}
          >
{explorerOrTrashHead()}
            <View style={styles.gridRows}>
              {(trashOpen ? trashedFiles : listedFiles).map((item) =>
                trashOpen
                  ? renderFileTrashGridCell(item, listWidth >= 640 ? 3 : 2)
                  : renderFileGridCell(item, listWidth >= 640 ? 3 : 2)
              )}
            </View>
            {!trashOpen && <GroupSections groupId={list.selectedGroupId} currentKind="file" tags={tags} />}
          </ScrollView>
          </GestureDetector>
        ) : (
          <GestureDetector gesture={carrying.listGesture}>
          <ScrollView
            ref={carrying.scrollRef as React.RefObject<ScrollView>}
            {...listProps}
            contentContainerStyle={[
              styles.list,
              railClear(inPane ? 'left' : 'right', 20),
              { paddingTop: listTopPad },
              ]}
          >
{explorerOrTrashHead()}
            {(trashOpen ? trashedFiles : listedFiles).map((item) =>
              trashOpen ? renderFileTrashRow(item) : renderFileRow(item)
            )}
            {/* What else is in this group - see GroupSections. */}
            {!trashOpen && <GroupSections groupId={list.selectedGroupId} currentKind="file" tags={tags} />}
          </ScrollView>
          </GestureDetector>
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
    paddingLeft: 20,
    // The rail stands at the right edge; the rows stop short of it rather
    // than running under it - the same clearance the calendar keeps.
    paddingRight: 20,
    gap: 10,
  },
  // The page: a column, and the paddings. The rail's side is decided by
  // railClear at the call site.
  gridPage: {
    paddingVertical: 8,
  },
  // The cards, and ONLY the cards.
  //
  // They used to be children of this row themselves, beside the path
  // strip and the group sections - so the strip stood in the line and
  // took its width, the cards were pushed along to whatever was left,
  // and (a row stretches its children) each one was pulled as tall as
  // the strip. That is the narrow tall card pressed against the far
  // side that the user kept being shown. alignItems flex-start so that
  // nothing in the line can stretch a card again.
  gridRows: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 12,
  },
  cardMenuBackdrop: {
    backgroundColor: 'rgba(17,24,39,0.45)',
    ...SHEET_BACKDROP,
  },
  cardMenuSheet: {
    backgroundColor: '#fff',
    ...SHEET_WINDOW,
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
