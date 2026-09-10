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
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
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
  setDoc,
  updateDoc,
  writeBatch,
} from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { Block, Group, TaggableKind } from '../types';
import { groupAppliesTo } from '../utils/groups';
import { RootStackParamList } from '../navigation';
import RenamePrompt from '../components/RenamePrompt';
import DocumentPickerModal, { PickableDocument } from '../components/DocumentPickerModal';
import UndoToast from '../components/UndoToast';
import TagChips from '../components/TagChips';
import TagPicker from '../components/TagPicker';
import BulkActionBar from '../components/BulkActionBar';
import GroupPickerSheet, { GroupKind } from '../components/GroupPickerSheet';
import ProjectTabsRow, { UNASSIGNED_ID } from '../components/ProjectTabsRow';
import TagsDrawer, { TagFilter, matchesTagFilter, removeTagFromFilter } from '../components/TagsDrawer';
import CopyToNoteModal from '../components/CopyToNoteModal';
import { usePendingDelete } from '../hooks/usePendingDelete';
import { useMultiSelect } from '../hooks/useMultiSelect';
import { useSortPref } from '../hooks/useSortPref';
import { useTags, detachTagFromDeletedItem, isTagAllowedForKind } from '../hooks/useTags';
import { blockFromLink, copyObjectsToNote } from '../utils/copyToNote';
import { linkDocId } from '../utils/linkId';
import { fetchLinkPreview, LinkPreview } from '../utils/linkPreview';
import { sortItems } from '../utils/sortItems';
import { colorForDocument } from '../utils/documentColor';
import SortMenuRows from '../components/SortMenuRows';

const ACCENT = '#3B82F6';
const DANGER = '#EF4444';
const linksCollection = collection(db, 'links');
const groupsCollection = collection(db, 'groups');

type ViewMode = 'list' | 'grid';

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

type LinkCategory = 'video' | 'geo' | 'other';

// Matches the exact siteName values fetchLinkPreview stamps on conversion
// (see DocumentEditorScreen) - the one `links` collection holds every kind
// of link, and this is what splits it back into three separate-looking
// databases without needing three separate collections.
function categoryFromSiteName(siteName?: string): LinkCategory {
  const s = siteName ?? '';
  if (s.includes('YouTube') || s.includes('TikTok')) return 'video';
  if (s === 'Геоточка') return 'geo';
  return 'other';
}

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
  // "database" from the user's side - view mode (and sort, via useSortPref
  // below) has to be kept per category, not one shared doc, or switching to
  // grid in "Геоточки" would silently flip "YouTube / TikTok" too.
  const linksPrefsKey = `linksPrefs_${category}`;
  const linksPrefsDoc = doc(db, 'settings', linksPrefsKey);
  // Same fixed gradient as Documents/Calendar/Databases - see DocumentsScreen's
  // own comment on why react-native-svg over expo-linear-gradient.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
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
  const [addLinkUrlPromptVisible, setAddLinkUrlPromptVisible] = useState(false);
  const [isAddingLink, setIsAddingLink] = useState(false);
  const [addLinkTitlePrompt, setAddLinkTitlePrompt] = useState<{ url: string; preview: LinkPreview } | null>(null);
  const { sortPref, selectSortField } = useSortPref(linksPrefsKey);
  const { filterPending, requestDeleteMany, undo, toast } = usePendingDelete<LinkItem>();
  const { tags, attachTag, detachTag, createAndAttachTag, renameTag } = useTags();
  const { isSelectMode, selectedIds, toggleSelectMode, toggle: toggleSelected, clear: clearSelection } =
    useMultiSelect();

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

  useEffect(() => {
    return onSnapshot(linksPrefsDoc, (snapshot) => {
      setViewMode((snapshot.data()?.viewMode as ViewMode | undefined) ?? 'list');
    });
  }, [linksPrefsKey]);

  useEffect(() => {
    // Filtered client-side rather than with a `where('kind','==',groupKind)`
    // query - combining an equality filter with `orderBy` on a different
    // field needs a composite index set up by hand in the Firebase
    // console, which this app avoids everywhere else too (see
    // TasksScreen's own comment on the same tradeoff).
    return onSnapshot(query(groupsCollection, orderBy('name')), (snapshot) => {
      setGroups(
        snapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Group, 'id'>) }))
          .filter((g) => groupAppliesTo(g, groupKind))
      );
    });
  }, [groupKind]);

  const categoryLinks = filterPending(links.filter((link) => categoryOf(link) === category));
  const groupFilteredLinks =
    groupFilter === null
      ? categoryLinks
      : groupFilter === UNASSIGNED_ID
        ? categoryLinks.filter((l) => !l.groupId)
        : categoryLinks.filter((l) => l.groupId === groupFilter);
  const tagFilteredLinks = groupFilteredLinks.filter((l) => matchesTagFilter(l.tagIds, tagFilter));
  const needle = searchQuery.trim().toLowerCase();
  const searchedLinks = needle
    ? tagFilteredLinks.filter((link) => (link.title || hostnameOf(link.url)).toLowerCase().includes(needle))
    : tagFilteredLinks;
  const filteredLinks = sortItems(
    searchedLinks,
    sortPref,
    (link) => link.title || hostnameOf(link.url),
    (link) => link.createdAt,
    (link) => link.updatedAt
  );
  // Video/geo/other tags don't mix (see the TaggableKind comment in
  // types.ts) - the drawer here must only ever offer tags relevant to
  // whichever of the three link screens this is, and only ones actually
  // assigned to a link in this category.
  const usedTagIds = new Set(categoryLinks.flatMap((l) => l.tagIds));
  const drawerTags = tags.filter((t) => isTagAllowedForKind(t, tagKind) && usedTagIds.has(t.id));
  const tagPickerLink = tagPickerForId ? links.find((l) => l.id === tagPickerForId) ?? null : null;
  const cardMenuLink = cardMenuLinkId ? links.find((l) => l.id === cardMenuLinkId) ?? null : null;
  const selectedLinks = categoryLinks.filter((l) => selectedIds.has(l.id));

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

  async function changeViewMode(mode: ViewMode) {
    setMenuOpen(false);
    await setDoc(linksPrefsDoc, { viewMode: mode }, { merge: true });
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
    <View style={styles.container}>
      <Svg
        width={windowWidth + 2}
        height={windowHeight + 2}
        style={[StyleSheet.absoluteFill, { top: -1, left: -1 }]}
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="linksBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.03" stopColor="#705648" />
            <Stop offset="0.52" stopColor="#69736E" />
            <Stop offset="1" stopColor="#000000" />
          </LinearGradient>
        </Defs>
        <Rect width={windowWidth + 2} height={windowHeight + 2} fill="url(#linksBg)" />
      </Svg>

      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.header} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.4}>
            {info.title}
          </Text>
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
            placeholder="Пошук за назвою"
            placeholderTextColor="#9CA3AF"
            style={styles.searchInput}
          />
        </View>
      )}

      {isLoading ? (
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
        <ScrollView contentContainerStyle={[styles.gridList, isSelectMode && styles.listWithBulkBar]}>
          {filteredLinks.map(renderLinkGridCell)}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, isSelectMode && styles.listWithBulkBar]}>
          {filteredLinks.map(renderLinkRow)}
        </ScrollView>
      )}

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

      {isAddingLink && (
        <View style={styles.addLinkLoading}>
          <ActivityIndicator color="#fff" />
        </View>
      )}

      <DocumentPickerModal
        visible={documentPicker !== null}
        subtitle={documentPicker?.link.title || (documentPicker ? hostnameOf(documentPicker.link.url) : undefined)}
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
        <Pressable style={styles.fab} onPress={() => setAddLinkUrlPromptVisible(true)}>
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
  // Same floating "+" DocumentsScreen uses, not a header icon - matches how
  // creating a document itself works.
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
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
    // At least 2x the previous 22, matching Documents/Databases - but
    // unlike "Документи", this title varies ("YouTube / TikTok" especially
    // is long), so it needs to be able to shrink and give up space to the
    // header capsule instead of pushing it off-screen.
    flexShrink: 1,
    fontSize: 46,
    fontWeight: '700',
    color: '#fff',
  },
  // One elongated glass capsule instead of three bare gray icons - matches
  // Documents/Calendar's own header capsule.
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
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
    backgroundColor: '#EFF6FF',
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
  },
  gridCaption: {
    fontSize: 11,
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
    color: '#111827',
  },
  rowCaption: {
    fontSize: 12,
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
    color: '#111827',
  },
});
