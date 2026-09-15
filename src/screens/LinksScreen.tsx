import { useEffect, useState } from 'react';
import { RAIL_CLEARANCE , railClear } from '../constants/rail';
import {
  ActivityIndicator,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  updateDoc,
  writeBatch,
} from '../firestore';
import { ownedQuery, setDoc } from '../utils/owned';
import { refreshLinkPreviewIfExpired } from '../utils/linkPreviewRefresh';
import { db } from '../firebase';
import { Block, TaggableKind } from '../types';
import { LINK_CATEGORY_INFO as CATEGORY_INFO, LinkCategory, categoryFromSiteName } from '../utils/linkCategory';
import { RootStackParamList } from '../navigation';
import RenamePrompt from '../components/RenamePrompt';
import DocumentPickerModal, { PickableDocument } from '../components/DocumentPickerModal';
import UndoToast from '../components/UndoToast';
import { LinkGridCell, LinkRow } from '../components/ItemCards';
import GroupSections from '../components/GroupSections';
import TagPicker from '../components/TagPicker';
import { copyObject, labelForBlock } from '../utils/objectClipboard';
import GroupPickerSheet, { GroupKind } from '../components/GroupPickerSheet';
import CopyToNoteModal from '../components/CopyToNoteModal';
import { useDatabaseList } from '../hooks/useDatabaseList';
import { useExplorer, ExplorerFolder, nameOf } from '../hooks/useExplorer';
import ExplorerHead from '../components/ExplorerHead';
import { ask } from '../components/surfaces/Ask';
import DatabaseChrome, { menuStyles } from '../components/DatabaseChrome';
import { detachTagFromDeletedItem, isTagAllowedForKind } from '../hooks/useTags';
import { appendBlocksToToday, blockFromLink, copyObjectsToNote } from '../utils/copyToNote';
import { addItemToBoard, createBoardAndAddItem } from '../utils/addItemToBoard';
import SaveDestinationSheet from '../components/SaveDestinationSheet';
import { linkDocId } from '../utils/linkId';
import { fetchLinkPreview, LinkPreview } from '../utils/linkPreview';
import { colorForDocument } from '../utils/documentColor';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { GLASS_TEXT, SHEET_BACKDROP, SHEET_WINDOW } from '../constants/glass';

const ACCENT = '#14B8A6';
// The same half-strength tint the documents screen's add button takes -
// the blur behind it is what separates it, so the colour only tints.
const ACCENT_GLASS = 'rgba(20,184,166,0.55)';
const DANGER = '#EF4444';
const linksCollection = collection(db, 'links');


type JustAddedLink = { id: string; url: string; title: string; imageUrl?: string; siteName?: string; createdAt: number };

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// One record per unique URL (see DocumentEditorScreen's linkDocId/
// syncLinksForDocument) - documentIds lists every document that currently
// has a card for this link, derived from the record's own `usedInDocuments`
// map rather than one record per insertion.
type LinkItem = {
  id: string;
  url: string;
  title?: string;
  imageUrl?: string;
  siteName?: string;
  documentIds: string[];
  tagIds: string[];
  groupId?: string;
  updatedAt: number;
  createdAt?: number;
};

function categoryOf(link: LinkItem): LinkCategory {
  return categoryFromSiteName(link.siteName);
}


// Video/geo/"other" tags must not mix (see the TaggableKind comment in
// types.ts) even though all three categories share the one `links` doc
// shape - each maps to its own TaggableKind for tagging purposes.
const TAG_KIND_BY_CATEGORY: Record<LinkCategory, TaggableKind> = {
  video: 'link-video',
  geo: 'link-geo',
  other: 'link-other',
};

// Same split for groups (see the Group comment in types.ts) - a group made
// while viewing "Геоточки" has no business showing up under "YouTube /
// TikTok", even though they're all the same `links` collection underneath.
const GROUP_KIND_BY_CATEGORY: Record<LinkCategory, GroupKind> = {
  video: 'link-video',
  geo: 'link-geo',
  other: 'link-other',
};

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

type Props = NativeStackScreenProps<RootStackParamList, 'Links'>;

// Same as the custom database screen: `category` can arrive as a prop,
// because in the tile board's left pane there is no route of its own.
export default function LinksScreen({
  route,
  category: categoryProp,
  inPane,
}: Partial<Props> & { category?: 'video' | 'geo' | 'other'; inPane?: boolean }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const category = categoryProp ?? route?.params.category ?? 'other';
  const info = CATEGORY_INFO[category];
  // Geo/video/other share this one screen's code, but each is its own
  // "database" from the user's side - the preferences (view mode, sort,
  // the hidden group row) have to be kept per category, not in one shared
  // doc, or switching to grid in "Геоточки" would silently flip
  // "YouTube / TikTok" too.
  const linksPrefsKey = `linksPrefs_${category}`;
  const tagKind = TAG_KIND_BY_CATEGORY[category];
  const groupKind = GROUP_KIND_BY_CATEGORY[category];
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [renamingLink, setRenamingLink] = useState<LinkItem | null>(null);
  const [documentPicker, setDocumentPicker] = useState<{ link: LinkItem; documents: PickableDocument[] } | null>(
    null
  );
  const [tagPickerForId, setTagPickerForId] = useState<string | null>(null);
  // Per-card "..." menu (rename / documents) - one shared piece of state
  // rather than per-row, since only ever one card's menu is open at a time.
  const [cardMenuLinkId, setCardMenuLinkId] = useState<string | null>(null);
  const [bulkTagPickerVisible, setBulkTagPickerVisible] = useState(false);
  const [bulkGroupPickerVisible, setBulkGroupPickerVisible] = useState(false);
  const [bulkCopyModalVisible, setBulkCopyModalVisible] = useState(false);
  const [addLinkUrlPromptVisible, setAddLinkUrlPromptVisible] = useState(false);
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [addLinkTitlePrompt, setAddLinkTitlePrompt] = useState<{ url: string; preview: LinkPreview } | null>(null);
  const [justAddedLink, setJustAddedLink] = useState<JustAddedLink | null>(null);
  const [saveDestinationVisible, setSaveDestinationVisible] = useState(false);
  useEffect(() => {
    if (!justAddedLink || saveDestinationVisible) return;
    const timeoutId = setTimeout(() => setJustAddedLink(null), 4000);
    return () => clearTimeout(timeoutId);
  }, [justAddedLink, saveDestinationVisible]);

  // Only this category's links go into the shared machine - the other two
  // categories live in the same collection and are a different database
  // from the user's side.
  const categoryLinks = links.filter((link) => categoryOf(link) === category);
  const list = useDatabaseList<LinkItem>({
    prefsKey: linksPrefsKey,
    groupKind,
    tagKind,
    items: categoryLinks,
    tagIdsOf: (l) => l.tagIds,
    groupIdOf: (l) => l.groupId,
    titleOf: (l) => l.title || hostnameOf(l.url),
    createdAtOf: (l) => l.createdAt,
    updatedAtOf: (l) => l.updatedAt,
    // Video/geo/other tags don't mix (see the TaggableKind comment in
    // types.ts) - the drawer must only ever offer tags belonging to
    // whichever of the three link screens this is.
    tagAllowed: (t) => isTagAllowedForKind(t, tagKind),
  });
  const {
    displayed: filteredLinks,
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
    selected: selectedLinks,
    needle,
    viewMode,
    changeViewMode,
  } = list;

  useEffect(() => {
    return onSnapshot(ownedQuery('links'), (snapshot) => {
      setLinks(
        [...snapshot.docs]
          .sort((a, b) => ((b.data().updatedAt as number) ?? 0) - ((a.data().updatedAt as number) ?? 0))
          .map((docSnapshot) => {
          const data = docSnapshot.data();
          // A TikTok cover past its deadline is fetched again and written
          // back; this same listener then delivers the live one. See
          // linkPreviewRefresh.
          refreshLinkPreviewIfExpired({ id: docSnapshot.id, url: data.url, imageUrl: data.imageUrl });
          return {
            id: docSnapshot.id,
            url: data.url,
            title: data.title,
            imageUrl: data.imageUrl,
            siteName: data.siteName,
            documentIds: Object.keys(data.usedInDocuments ?? {}),
            tagIds: data.tagIds ?? [],
            groupId: data.groupId,
            updatedAt: data.updatedAt ?? 0,
            createdAt: data.createdAt,
          };
        })
      );
      setIsLoading(false);
    });
  }, []);

  // Folders, read off the tag tree - see useExplorer. One screen, three
  // kinds: the video, geo and other links each keep their own tree,
  // because tagKind is what a folder's tag is filed under.
  const explorer = useExplorer<LinkItem>({
    kind: tagKind,
    collection: 'links',
    items: links,
    displayed: filteredLinks,
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
  const linksHere = explorer.visibleItems;

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

  const tagPickerLink = tagPickerForId ? links.find((l) => l.id === tagPickerForId) ?? null : null;
  const cardMenuLink = cardMenuLinkId ? links.find((l) => l.id === cardMenuLinkId) ?? null : null;

  // The one selected row, put on the app's own clipboard as the block that
  // REFERENCES it - pasted into a document it stays this same record
  // rather than becoming a second copy of it (see objectClipboard).
  function copySelectedToClipboard() {
    const [only] = selectedLinks;
    if (!only) return;
    const block = blockFromLink(only);
    copyObject({ label: labelForBlock(block), block });
    clearSelection();
  }

  function openLinkUrl(url: string) {
    Linking.openURL(url).catch(() => {});
  }

  // The document icon jumps straight to the one document a link is used in,
  // or - when it's inserted in several - shows a picker to choose which.
  async function openDocumentIcon(link: LinkItem) {
    if (link.documentIds.length === 0) return;
    if (link.documentIds.length === 1) {
      navigation.navigate('Editor', { documentId: link.documentIds[0] });
      return;
    }
    const documents = await Promise.all(
      link.documentIds.map(async (id) => {
        const snapshot = await getDoc(doc(db, 'documents', id));
        return { id, title: (snapshot.data()?.title as string) || 'Без назви' };
      })
    );
    setDocumentPicker({ link, documents });
  }

  function pickDocument(documentId: string) {
    setDocumentPicker(null);
    navigation.navigate('Editor', { documentId });
  }

  // The "+" button - a link straight into the database, no document
  // involved at all (usedInDocuments starts empty). Same dedup/preview
  // machinery as pasting a URL into a document (linkDocId + fetchLinkPreview
  // from utils/), so a link added here and later pasted into a document (or
  // vice versa) converge onto the exact same record instead of duplicating.
  async function saveNewLink(url: string, preview: LinkPreview, title: string) {
    const id = linkDocId(url);
    const now = Date.now();
    const data: Record<string, unknown> = { url, updatedAt: now, createdAt: now, usedInDocuments: {} };
    if (title) data.title = title;
    if (preview.imageUrl) data.imageUrl = preview.imageUrl;
    if (preview.siteName) data.siteName = preview.siteName;
    await setDoc(doc(db, 'links', id), data, { merge: true });
    // Made inside a folder, it belongs to that folder - see useExplorer.
    await explorer.assignToCurrentFolder(id);
    // A YouTube link added while viewing "Геоточки" (say) would otherwise
    // just seem to vanish - it's really sitting in a different category's
    // list. Jump the screen to wherever it actually landed.
    const newCategory = categoryFromSiteName(preview.siteName);
    if (newCategory !== category) navigation.setParams({ category: newCategory });
    // Lands in the base either way (unchanged, fast) - see FilesScreen's
    // identical justAddedFile for why "Перемістити" only ADDS a block
    // elsewhere rather than moving anything.
    setJustAddedLink({ id, url, title, imageUrl: preview.imageUrl, siteName: preview.siteName, createdAt: now });
  }

  function linkToBlock(item: JustAddedLink) {
    return blockFromLink({ url: item.url, title: item.title, imageUrl: item.imageUrl, siteName: item.siteName });
  }

  function linkToImportableItem(item: JustAddedLink) {
    return {
      id: item.id,
      kind: `link-${categoryFromSiteName(item.siteName)}`,
      title: item.title || hostnameOf(item.url),
      data: { url: item.url, title: item.title, imageUrl: item.imageUrl, siteName: item.siteName },
    };
  }

  function relocateJustAddedLink(destination: (item: JustAddedLink) => Promise<unknown>) {
    const item = justAddedLink;
    if (!item) return;
    setJustAddedLink(null);
    setSaveDestinationVisible(false);
    destination(item).catch((e) => console.warn('[LinksScreen] relocate failed', e));
  }

  async function submitNewLinkUrl(rawUrl: string) {
    setAddLinkUrlPromptVisible(false);
    const url = rawUrl.trim();
    if (!url) return;
    setIsAddingLink(true);
    const preview = await fetchLinkPreview(url);
    setIsAddingLink(false);
    if (preview.title) {
      await saveNewLink(url, preview, preview.title);
    } else {
      // No title to show (a raw-coordinates Maps link, or a page with no
      // fetchable og:title) - ask instead of quietly filing an unnamed link,
      // same as the document-editor's own linkTitlePrompt.
      setAddLinkTitlePrompt({ url, preview });
    }
  }

  function confirmAddLinkTitle(title: string) {
    const prompt = addLinkTitlePrompt;
    setAddLinkTitlePrompt(null);
    if (prompt && title.trim()) saveNewLink(prompt.url, prompt.preview, title.trim());
  }

  // A rename is always available, not just at first creation - it updates
  // the shared record AND every card that already shows the old name
  // (matched by URL, since a document could hold more than one block for
  // the same link), the same two-way-sync pattern tasks already use for
  // project/today changes.
  async function renameLink(link: LinkItem, title: string) {
    setRenamingLink(null);
    await updateDoc(doc(db, 'links', link.id), { title });
    await Promise.all(
      link.documentIds.map(async (docId) => {
        const documentRef = doc(db, 'documents', docId);
        const snapshot = await getDoc(documentRef);
        const data = snapshot.data();
        if (!data) return;
        const blocks: Block[] = data.blocks ?? [];
        let changed = false;
        const updatedBlocks = blocks.map((b) => {
          if ((b.type ?? 'paragraph') === 'link' && b.linkUrl === link.url) {
            changed = true;
            return { ...b, linkTitle: title };
          }
          return b;
        });
        if (changed) await updateDoc(documentRef, { blocks: updatedBlocks });
      })
    );
  }

  async function deleteLink(link: LinkItem) {
    deleteDoc(doc(db, 'links', link.id));
    await Promise.all(
      link.tagIds.map((tagId) => {
        const tag = tags.find((t) => t.id === tagId);
        return tag ? detachTagFromDeletedItem(tag, tagKind, link.id) : Promise.resolve();
      })
    );
    await Promise.all(
      link.documentIds.map(async (docId) => {
        const documentRef = doc(db, 'documents', docId);
        const snapshot = await getDoc(documentRef);
        const data = snapshot.data();
        if (!data) return;
        const blocks: Block[] = data.blocks ?? [];
        const remaining = blocks.filter((b) => !((b.type ?? 'paragraph') === 'link' && b.linkUrl === link.url));
        if (remaining.length !== blocks.length) {
          updateDoc(documentRef, {
            blocks: remaining.length > 0 ? remaining : [{ id: generateId(), text: '' }],
          });
        }
      })
    );
  }

  function confirmDeleteSelected() {
    requestDeleteMany(selectedLinks, `Видалено посилань: ${selectedLinks.length}`, () => {
      selectedLinks.forEach(deleteLink);
    });
    clearSelection();
  }

  async function bulkAttachTag(tag: Parameters<typeof attachTag>[0]) {
    setBulkTagPickerVisible(false);
    await Promise.all(selectedLinks.map((l) => attachTag(tag, tagKind, l.id, 'links')));
    clearSelection();
  }

  async function bulkCreateAndAttachTag(path: string, icon: string, color: string) {
    setBulkTagPickerVisible(false);
    await Promise.all(selectedLinks.map((l) => createAndAttachTag(path, icon, color, tagKind, l.id, 'links')));
    clearSelection();
  }

  async function bulkAssignGroup(groupId: string | null) {
    setBulkGroupPickerVisible(false);
    const batch = writeBatch(db);
    selectedLinks.forEach((l) => {
      batch.update(doc(db, 'links', l.id), { groupId: groupId ?? deleteField() });
    });
    await batch.commit();
    clearSelection();
  }

  async function bulkCopyToExisting(documentId: string) {
    setBulkCopyModalVisible(false);
    const blocks = selectedLinks.map(blockFromLink);
    await copyObjectsToNote(
      documentId,
      blocks,
      selectedLinks.map((l) => ({ collectionName: 'links', id: linkDocId(l.url) }))
    );
    clearSelection();
  }

  async function bulkCopyToNew() {
    setBulkCopyModalVisible(false);
    const blocks = selectedLinks.map(blockFromLink);
    const newDocumentId = await copyObjectsToNote(
      null,
      blocks,
      selectedLinks.map((l) => ({ collectionName: 'links', id: linkDocId(l.url) }))
    );
    clearSelection();
    navigation.navigate('Editor', { documentId: newDocumentId });
  }

  function renderLinkRow(item: LinkItem) {
    return (
      <LinkRow
        key={item.id}
        link={item}
        tags={tags.filter((t) => item.tagIds.includes(t.id))}
        onPress={() => (isSelectMode ? toggleSelected(item.id) : openLinkUrl(item.url))}
        onLongPress={() => setCardMenuLinkId(item.id)}
        onMenu={() => setCardMenuLinkId(item.id)}
        onTagPress={() => setTagPickerForId(item.id)}
        isSelectMode={isSelectMode}
        isSelected={selectedIds.has(item.id)}
        onToggleSelect={() => toggleSelected(item.id)}
      />
    );
  }

  function renderLinkGridCell(item: LinkItem) {
    return (
      <LinkGridCell
        key={item.id}
        link={item}
        tags={tags.filter((t) => item.tagIds.includes(t.id))}
        onPress={() => (isSelectMode ? toggleSelected(item.id) : openLinkUrl(item.url))}
        onLongPress={() => setCardMenuLinkId(item.id)}
        onMenu={() => setCardMenuLinkId(item.id)}
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
      railSide={inPane ? 'left' : 'right'}
      accent={ACCENT}
      accentGlass={ACCENT_GLASS}
      onBack={() => navigation.goBack()}
      searchPlaceholder="Пошук за назвою"
      onAdd={() => setAddLinkUrlPromptVisible(true)}
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
          {toast && <UndoToast message={toast.message} onUndo={() => undo(toast.id)} />}
          {!toast && justAddedLink && (
            <UndoToast
              message={`Додано у ${CATEGORY_INFO[category].title}`}
              actionLabel="Перемістити"
              onUndo={() => setSaveDestinationVisible(true)}
            />
          )}

          {isAddingLink && (
            <View style={styles.addLinkLoading}>
              <ActivityIndicator color="#fff" />
            </View>
          )}

          {/* The per-card "..." - rename, and the documents this link sits
              in when it sits in any. */}
          <Modal
            visible={cardMenuLink !== null}
            transparent
            animationType="fade"
            onRequestClose={() => setCardMenuLinkId(null)}
          >
            <Pressable style={styles.cardMenuBackdrop} onPress={() => setCardMenuLinkId(null)}>
              <Pressable style={styles.cardMenuSheet} onPress={() => {}}>
                <View style={styles.cardMenuHandle} />
                <Pressable
                  style={styles.cardMenuRow}
                  onPress={() => {
                    if (cardMenuLink) setRenamingLink(cardMenuLink);
                    setCardMenuLinkId(null);
                  }}
                >
                  <Ionicons name="pencil-outline" size={18} color="#111827" />
                  <Text style={styles.cardMenuRowLabel}>Редагувати назву</Text>
                </Pressable>
                {cardMenuLink && cardMenuLink.documentIds.length > 0 && (
                  <Pressable
                    style={styles.cardMenuRow}
                    onPress={() => {
                      if (cardMenuLink) openDocumentIcon(cardMenuLink);
                      setCardMenuLinkId(null);
                    }}
                  >
                    <Ionicons name="document-text-outline" size={18} color="#111827" />
                    <Text style={styles.cardMenuRowLabel}>
                      Документи{cardMenuLink.documentIds.length > 1 ? ` (${cardMenuLink.documentIds.length})` : ''}
                    </Text>
                  </Pressable>
                )}
              </Pressable>
            </Pressable>
          </Modal>

          <RenamePrompt
            visible={renamingLink !== null}
            title="Назва посилання"
            initialValue={renamingLink?.title ?? ''}
            onCancel={() => setRenamingLink(null)}
            onSave={(title) => {
              if (renamingLink) renameLink(renamingLink, title);
            }}
          />

          <RenamePrompt
            visible={addLinkUrlPromptVisible}
            title="Нове посилання"
            placeholder="https://…"
            initialValue=""
            onCancel={() => setAddLinkUrlPromptVisible(false)}
            onSave={submitNewLinkUrl}
          />

          <RenamePrompt
            visible={addLinkTitlePrompt !== null}
            title="Назва посилання"
            initialValue=""
            onCancel={() => setAddLinkTitlePrompt(null)}
            onSave={confirmAddLinkTitle}
          />

          <DocumentPickerModal
            visible={documentPicker !== null}
            subtitle={
              documentPicker?.link.title || (documentPicker ? hostnameOf(documentPicker.link.url) : undefined)
            }
            documents={documentPicker?.documents ?? []}
            onPick={pickDocument}
            onClose={() => setDocumentPicker(null)}
          />

          <TagPicker
            visible={tagPickerLink !== null}
            kind={tagKind}
            tags={tags}
            selectedTagIds={tagPickerLink?.tagIds ?? []}
            onAttach={(tag) => tagPickerLink && attachTag(tag, tagKind, tagPickerLink.id, 'links')}
            onDetach={(tag) => tagPickerLink && detachTag(tag, tagKind, tagPickerLink.id, 'links')}
            onCreateAndAttach={(path, icon, color) =>
              tagPickerLink && createAndAttachTag(path, icon, color, tagKind, tagPickerLink.id, 'links')
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
            kind={tagKind}
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
            kind={groupKind}
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
            title="Куди додати посилання?"
            defaultLabel="Лишити в базі"
            onPickDefault={() => relocateJustAddedLink(async () => {})}
            onPickToday={() =>
              relocateJustAddedLink((item) =>
                appendBlocksToToday([linkToBlock(item)], [{ collectionName: 'links', id: item.id }])
              )
            }
            onPickNew={() =>
              relocateJustAddedLink((item) =>
                copyObjectsToNote(null, [linkToBlock(item)], [{ collectionName: 'links', id: item.id }]).then(
                  (newId) => navigation.navigate('Editor', { documentId: newId })
                )
              )
            }
            onPickExisting={(documentId) =>
              relocateJustAddedLink((item) =>
                copyObjectsToNote(documentId, [linkToBlock(item)], [{ collectionName: 'links', id: item.id }])
              )
            }
            onPickNewBoard={() =>
              relocateJustAddedLink((item) => createBoardAndAddItem('Без назви', linkToImportableItem(item)))
            }
            onPickExistingBoard={(boardId) =>
              relocateJustAddedLink((item) => addItemToBoard(boardId, linkToImportableItem(item)))
            }
            onClose={() => setSaveDestinationVisible(false)}
          />
        </>
      }
    >
      {(listTopPad, listProps, listWidth) =>
        isLoading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : linksHere.length === 0 && explorer.folders.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: `${info.color}1A` }]}>
              <Ionicons name={info.icon} size={32} color={info.color} />
            </View>
            <Text style={styles.emptyLabel}>{needle ? 'Нічого не знайдено' : 'Ще немає збережених посилань'}</Text>
            {!needle && <Text style={styles.emptyHint}>{info.emptyHint}</Text>}
          </View>
        ) : viewMode === 'grid' ? (
          <ScrollView
            {...listProps}
            contentContainerStyle={[
              styles.gridPage,
              railClear(inPane ? 'left' : 'right', 20),
              { paddingTop: listTopPad },
              isSelectMode && styles.listWithBulkBar,
            ]}
          >
            {list.explorerMode && (
              <ExplorerHead
                crumbs={explorer.crumbs}
                path={explorer.path}
                folders={explorer.folders}
                showCrumbs={explorer.active}
                itemIcon="link-outline"
                onGo={(next) => {
                  explorer.setPath(next);
                  if (needle !== '') {
                    list.setSearchQuery('');
                    list.setIsSearching(false);
                  }
                }}
                onUp={() => explorer.setPath((prev) => prev.split('/').slice(0, -1).join('/'))}
                onFolderMenu={openFolderMenu}
              />
            )}
            <View style={styles.gridRows}>{linksHere.map((item) => renderLinkGridCell(item))}</View>
            <GroupSections groupId={list.selectedGroupId} currentKind={tagKind} tags={tags} />
          </ScrollView>
        ) : (
          <ScrollView
            {...listProps}
            contentContainerStyle={[
              styles.list,
              railClear(inPane ? 'left' : 'right', 20),
              { paddingTop: listTopPad },
              isSelectMode && styles.listWithBulkBar,
            ]}
          >
            {list.explorerMode && (
              <ExplorerHead
                crumbs={explorer.crumbs}
                path={explorer.path}
                folders={explorer.folders}
                showCrumbs={explorer.active}
                itemIcon="link-outline"
                onGo={(next) => {
                  explorer.setPath(next);
                  if (needle !== '') {
                    list.setSearchQuery('');
                    list.setIsSearching(false);
                  }
                }}
                onUp={() => explorer.setPath((prev) => prev.split('/').slice(0, -1).join('/'))}
                onFolderMenu={openFolderMenu}
              />
            )}
            {linksHere.map(renderLinkRow)}
            {/* What else is in this group - see GroupSections. */}
            <GroupSections groupId={list.selectedGroupId} currentKind={tagKind} tags={tags} />
          </ScrollView>
        )
      }
    </DatabaseChrome>
  );
}

const styles = StyleSheet.create({
  addLinkLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.35)',
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
    backgroundColor: '#EFF6FF',
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
    paddingRight: RAIL_CLEARANCE,
    gap: 10,
  },
  // See FilesScreen: the page is a column, only the cards are a row.
  gridPage: {
    paddingVertical: 8,
  },
  gridRows: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 12,
  },
  listWithBulkBar: {
    paddingBottom: 90,
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
