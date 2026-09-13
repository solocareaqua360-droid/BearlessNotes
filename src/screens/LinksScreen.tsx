import { useEffect, useState } from 'react';
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
import { NativeStackScreenProps } from '@react-navigation/native-stack';
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
import { Block, TaggableKind } from '../types';
import { LinkCategory, categoryFromSiteName } from '../utils/linkCategory';
import { RootStackParamList } from '../navigation';
import RenamePrompt from '../components/RenamePrompt';
import DocumentPickerModal, { PickableDocument } from '../components/DocumentPickerModal';
import UndoToast from '../components/UndoToast';
import TagChips from '../components/TagChips';
import TagPicker from '../components/TagPicker';
import { copyObject, labelForBlock } from '../utils/objectClipboard';
import GroupPickerSheet, { GroupKind } from '../components/GroupPickerSheet';
import CopyToNoteModal from '../components/CopyToNoteModal';
import { useDatabaseList } from '../hooks/useDatabaseList';
import DatabaseChrome, { menuStyles } from '../components/DatabaseChrome';
import { detachTagFromDeletedItem, isTagAllowedForKind } from '../hooks/useTags';
import { appendBlocksToToday, blockFromLink, copyObjectsToNote } from '../utils/copyToNote';
import { addItemToBoard, createBoardAndAddItem } from '../utils/addItemToBoard';
import SaveDestinationSheet from '../components/SaveDestinationSheet';
import { linkDocId } from '../utils/linkId';
import { fetchLinkPreview, LinkPreview } from '../utils/linkPreview';
import { colorForDocument } from '../utils/documentColor';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

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

const CATEGORY_INFO: Record<
  LinkCategory,
  { title: string; icon: keyof typeof Ionicons.glyphMap; color: string; emptyHint: string }
> = {
  video: {
    title: 'YouTube / TikTok',
    icon: 'videocam-outline',
    color: '#EF4444',
    emptyHint: "Вставте посилання на YouTube або TikTok окремим абзацом у документі - картка з'явиться тут сама",
  },
  geo: {
    title: 'Геоточки',
    icon: 'location-outline',
    color: '#16A34A',
    emptyHint: "Вставте посилання на місце з Google Maps окремим абзацом у документі - воно з'явиться тут само",
  },
  other: {
    title: 'Посилання',
    icon: 'link-outline',
    color: ACCENT,
    emptyHint: "Вставте посилання окремим абзацом у будь-якому документі - картка з'явиться тут сама",
  },
};

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

export default function LinksScreen({ route, navigation }: Props) {
  const { category } = route.params;
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
    const linksQuery = query(linksCollection, orderBy('updatedAt', 'desc'));
    return onSnapshot(linksQuery, (snapshot) => {
      setLinks(
        snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
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
    const itemInfo = CATEGORY_INFO[categoryOf(item)];
    const { background, text, textMuted } = colorForDocument(item.id);
    return (
      <View key={item.id} style={[styles.row, { backgroundColor: background }]}>
        <Pressable
          style={styles.rowTap}
          onPress={() => (isSelectMode ? toggleSelected(item.id) : openLinkUrl(item.url))}
          onLongPress={() => setCardMenuLinkId(item.id)}
        >
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={[styles.thumbIcon, { backgroundColor: `${itemInfo.color}1A` }]}>
              <Ionicons name={itemInfo.icon} size={20} color={itemInfo.color} />
            </View>
          )}
          <View style={styles.rowBody}>
            <Text style={[styles.rowTitle, { color: text }]} numberOfLines={2}>
              {item.title || hostnameOf(item.url)}
            </Text>
            <Text style={[styles.rowCaption, { color: textMuted }]} numberOfLines={1}>
              {item.siteName ?? hostnameOf(item.url)}
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
          <Pressable hitSlop={8} onPress={() => setCardMenuLinkId(item.id)} style={styles.rowActionButton}>
            <Ionicons name="ellipsis-horizontal" size={16} color={textMuted} />
          </Pressable>
        )}
      </View>
    );
  }

  // Compact grid variant - thumbnail on top instead of beside the text,
  // select-checkbox as a corner overlay instead of a trailing icon, same
  // shape as DocumentCard's own 'grid' layout.
  function renderLinkGridCell(item: LinkItem) {
    const itemInfo = CATEGORY_INFO[categoryOf(item)];
    const { background, text, textMuted } = colorForDocument(item.id);
    return (
      <View key={item.id} style={[styles.gridCard, { backgroundColor: background }]}>
        <Pressable
          style={styles.gridTap}
          onPress={() => (isSelectMode ? toggleSelected(item.id) : openLinkUrl(item.url))}
          onLongPress={() => setCardMenuLinkId(item.id)}
        >
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={styles.gridThumb} resizeMode="cover" />
          ) : (
            <View style={[styles.gridThumb, styles.gridThumbIcon, { backgroundColor: `${itemInfo.color}1A` }]}>
              <Ionicons name={itemInfo.icon} size={26} color={itemInfo.color} />
            </View>
          )}
          <Text style={[styles.gridTitle, { color: text }]} numberOfLines={2}>
            {item.title || hostnameOf(item.url)}
          </Text>
          <Text style={[styles.gridCaption, { color: textMuted }]} numberOfLines={1}>
            {item.siteName ?? hostnameOf(item.url)}
          </Text>
          <TagChips
            tags={tags.filter((t) => item.tagIds.includes(t.id))}
            onPress={() => setTagPickerForId(item.id)}
            glass
          />
        </Pressable>
        {isSelectMode ? (
          // pointerEvents="none" - a sibling View absolutely positioned in
          // front of gridTap still intercepts touch even with no onPress of
          // its own, which made tapping near the icon miss most taps (see
          // DocumentCard's identical fix).
          <View style={styles.gridSelectBox} pointerEvents="none">
            <Ionicons
              name={selectedIds.has(item.id) ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={selectedIds.has(item.id) ? text : '#fff'}
            />
          </View>
        ) : (
          <Pressable hitSlop={8} onPress={() => setCardMenuLinkId(item.id)} style={styles.gridMenuButton}>
            <Ionicons name="ellipsis-horizontal" size={14} color={textMuted} />
          </Pressable>
        )}
      </View>
    );
  }


  return (
    <DatabaseChrome
      list={list}
      accent={ACCENT}
      accentGlass={ACCENT_GLASS}
      onBack={() => navigation.goBack()}
      searchPlaceholder="Пошук за назвою"
      onAdd={() => setAddLinkUrlPromptVisible(true)}
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
      {(listTopPad) =>
        isLoading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : filteredLinks.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: `${info.color}1A` }]}>
              <Ionicons name={info.icon} size={32} color={info.color} />
            </View>
            <Text style={styles.emptyLabel}>{needle ? 'Нічого не знайдено' : 'Ще немає збережених посилань'}</Text>
            {!needle && <Text style={styles.emptyHint}>{info.emptyHint}</Text>}
          </View>
        ) : viewMode === 'grid' ? (
          <ScrollView
            contentContainerStyle={[
              styles.gridList,
              { paddingTop: listTopPad },
              isSelectMode && styles.listWithBulkBar,
            ]}
          >
            {filteredLinks.map(renderLinkGridCell)}
          </ScrollView>
        ) : (
          <ScrollView
            contentContainerStyle={[
              styles.list,
              { paddingTop: listTopPad },
              isSelectMode && styles.listWithBulkBar,
            ]}
          >
            {filteredLinks.map(renderLinkRow)}
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
  gridCard: {
    // Fixed proportion, not flex:1 - a flex card stretches to fill
    // whatever's left in its row, which breaks when a row has only one
    // card left (a filter down to an odd count) - see DocumentCard's own
    // fix for the identical bug.
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
  },
  gridThumbIcon: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridTitle: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
  },
  gridCaption: {
    fontSize: 11,
    fontFamily: FONT_REGULAR,
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
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: '#E5E7EB',
  },
  thumbIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(59,130,246,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: '#111827',
  },
  rowCaption: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: '#9CA3AF',
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
