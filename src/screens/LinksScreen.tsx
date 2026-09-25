import { useEffect, useState } from 'react';
import { withAlpha } from '../utils/color';
import { useTheme, useStyles } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { railClear } from '../constants/rail';
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
import { GestureDetector } from 'react-native-gesture-handler';
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
import { backfillGeoCoordinatesIfMissing, refreshLinkPreviewIfExpired } from '../utils/linkPreviewRefresh';
import { db } from '../firebase';
import { Block, TaggableKind } from '../types';
import { LINK_CATEGORY_INFO as CATEGORY_INFO, LinkCategory, categoryFromSiteName } from '../utils/linkCategory';
import { RootStackParamList } from '../navigation';
import RenamePrompt from '../components/RenamePrompt';
import GeoPointEntrySheet from '../components/GeoPointEntrySheet';
import GeoMapView, { type GeoMapPoint } from '../components/GeoMapView';
import GeoPointDetailSheet from '../components/GeoPointDetailSheet';
import AddExistingItemModal from '../components/AddExistingItemModal';
import { mapsUrlForLatLng } from '../utils/geoCoordinates';
import DocumentPickerModal, { PickableDocument } from '../components/DocumentPickerModal';
import UndoToast from '../components/UndoToast';
import { LinkGridCell, LinkRow } from '../components/ItemCards';
import GroupSections from '../components/GroupSections';
import TagPicker from '../components/TagPicker';
import { copyObject, labelForBlock } from '../utils/objectClipboard';
import GroupPickerSheet, { GroupKind } from '../components/GroupPickerSheet';
import CopyToNoteModal from '../components/CopyToNoteModal';
import { useDatabaseList } from '../hooks/useDatabaseList';
import { useBin } from '../hooks/useBin';
import { useExplorer, ExplorerFolder, nameOf } from '../hooks/useExplorer';
import ExplorerHead from '../components/ExplorerHead';
import { useExplorerCarry } from '../hooks/useExplorerCarry';
import CardCarryOverlay from '../components/CardCarryOverlay';
import { ask, confirm } from '../components/surfaces/Ask';
import DatabaseChrome, { menuStyles } from '../components/DatabaseChrome';
import { detachTagFromDeletedItem, isTagAllowedForKind } from '../hooks/useTags';
import { appendBlocksToToday, blockFromLink, copyObjectsToNote } from '../utils/copyToNote';
import { addItemToBoard, createBoardAndAddItem } from '../utils/addItemToBoard';
import SaveDestinationSheet from '../components/SaveDestinationSheet';
import { linkDocId } from '../utils/linkId';
import { getVideoEmbedInfo } from '../utils/videoEmbed';
import VideoPlayerModal from '../components/VideoPlayerModal';
import { fetchLinkPreview, LinkPreview } from '../utils/linkPreview';
import { colorForDocument } from '../utils/documentColor';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { SHEET_BACKDROP, SHEET_WINDOW } from '../constants/glass';
import { listenError } from '../utils/listenError';

// The same half-strength tint the documents screen's add button takes -
// the blur behind it is what separates it, so the colour only tints.
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
  // Geo category only - see extractMapsCoordinates. Absent on an older
  // point saved before this existed, or one whose short link never got
  // resolved (no network at the time).
  geoLat?: number;
  geoLng?: number;
  // Geo category only - the same two fields a Task carries for the same
  // reason (see TasksScreen's own Task type): a short note and whatever
  // photos were attached, both belonging to the point itself rather than
  // to any one document that happens to reference it.
  comment?: string;
  attachments?: Block[];
  // Set while the link sits in the bin (see useBin) - hidden from every
  // list, tags/group/references untouched, purged for good after 30 days.
  deletedAt?: number;
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
  const theme = useTheme();
  const accent = theme.sections.links;
  const accentGlass = withAlpha(accent, 0.55);
  const styles = useStyles(makeStyles);
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
  const [trashedLinks, setTrashedLinks] = useState<LinkItem[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
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
  // The badge on a single card, opened outside select mode - distinct
  // from the bulk sheet above, which acts on the whole selection.
  const [singleGroupTargetId, setSingleGroupTargetId] = useState<string | null>(null);
  // Which card is playing in its own window, and the one full-screen
  // player behind «розгорнути». One at a time: each is a live WebView.
  const [playingLinkId, setPlayingLinkId] = useState<string | null>(null);
  const [fullscreenVideoUrl, setFullscreenVideoUrl] = useState<string | null>(null);
  const [bulkCopyModalVisible, setBulkCopyModalVisible] = useState(false);
  const [addLinkUrlPromptVisible, setAddLinkUrlPromptVisible] = useState(false);
  const [geoPointSheetVisible, setGeoPointSheetVisible] = useState(false);
  // «Геоточки» only - see the rail's own shape.onToggle above.
  const [mapVisible, setMapVisible] = useState(false);
  const [geoDetailId, setGeoDetailId] = useState<string | null>(null);
  const [geoAttachPickerVisible, setGeoAttachPickerVisible] = useState(false);
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
    createAndAttachTagToMany,
    renameTag,
    isSelectMode,
    selectedIds,
    toggle: toggleSelected,
    clear: clearSelection,
    selected: selectedLinks,
    needle,
    viewMode,
    changeViewMode,
  } = list;
  // The bin - see useBin.
  const bin = useBin<LinkItem>('links', trashedLinks, (link) => purgeLink(link));

  useEffect(() => {
    return onSnapshot(ownedQuery('links'), (snapshot) => {
      const all = [...snapshot.docs]
        .sort((a, b) => ((b.data().updatedAt as number) ?? 0) - ((a.data().updatedAt as number) ?? 0))
        .map((docSnapshot) => {
          const data = docSnapshot.data();
          // A trashed link is not being looked at - no point refreshing a
          // cover for something on its way to being purged.
          if (!data.deletedAt) {
            // A TikTok cover past its deadline is fetched again and written
            // back; this same listener then delivers the live one. See
            // linkPreviewRefresh.
            refreshLinkPreviewIfExpired({ id: docSnapshot.id, url: data.url, imageUrl: data.imageUrl });
            backfillGeoCoordinatesIfMissing({
              id: docSnapshot.id,
              url: data.url,
              siteName: data.siteName,
              geoLat: data.geoLat,
              geoLng: data.geoLng,
            });
          }
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
            deletedAt: data.deletedAt,
            geoLat: data.geoLat,
            geoLng: data.geoLng,
            comment: data.comment,
            attachments: data.attachments,
          };
        });
      setLinks(all.filter((l) => !l.deletedAt));
      setTrashedLinks(all.filter((l) => !!l.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)));
      setIsLoading(false);
    }, listenError('LinksScreen:links'));
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
  // The map draws exactly this list, filtered to what it can actually
  // place - search, tags, group and folder all already narrowed
  // `linksHere` down before this ever runs, so the map needs no filtering
  // machinery of its own; see the plan's "одночасний пошук і показ".
  const geoMapPoints: GeoMapPoint[] = linksHere
    .filter((l): l is LinkItem & { geoLat: number; geoLng: number } => l.geoLat != null && l.geoLng != null)
    .map((l) => ({ id: l.id, title: l.title || hostnameOf(l.url), lat: l.geoLat, lng: l.geoLng }));

  // Carrying a card into a folder - see useExplorerCarry, which is all of
  // it: the gesture, the undo toast, and keeping a carried card alive
  // when the second finger walks into a folder it does not belong to.
  const carrying = useExplorerCarry<LinkItem>({
    path: explorer.path,
    folders: explorer.folders,
    moveItem: (item, destination) => explorer.moveItem(item, destination),
    items: links,
    isSelectMode,
    selectedIds,
    active: explorer.active,
    onMoved: () => {
      if (isSelectMode) clearSelection();
    },
  });

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

  // A YouTube/TikTok link plays IN ITS OWN CARD (see ItemCards' own
  // `playing`), the same as a board's video card does; anything else
  // still opens in the browser, which is the only thing this app can
  // usefully do with a page.
  function openLinkUrl(url: string, id?: string) {
    if (id && getVideoEmbedInfo(url)) {
      setPlayingLinkId((current) => (current === id ? null : id));
      return;
    }
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
    if (preview.geoLat != null && preview.geoLng != null) {
      data.geoLat = preview.geoLat;
      data.geoLng = preview.geoLng;
    }
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

  // The manual side of the same door - a point entered by hand (any of
  // the three ways GeoPointEntrySheet offers) lands through the exact
  // same saveNewLink a pasted URL does. Built here rather than given a
  // path of its own: a Maps URL is always constructible from a plain
  // lat/lng (mapsUrlForLatLng), so this point is, from here on, simply
  // ANOTHER geo link - every list, filter, tag and group already knows
  // what to do with one.
  async function saveGeoPointByHand(title: string, point: { lat: number; lng: number }) {
    setGeoPointSheetVisible(false);
    const url = mapsUrlForLatLng(point);
    await saveNewLink(url, { siteName: 'Геоточка', geoLat: point.lat, geoLng: point.lng }, title);
  }

  // Geo card tapped: opens the point's own record instead of launching
  // straight out to Google Maps the way every other link's tap still
  // does - "Перейти в Google Maps" inside the sheet is now the one
  // button that leaves the app, not the tap itself.
  function openLinkCard(item: LinkItem) {
    if (categoryOf(item) === 'geo') {
      setGeoDetailId(item.id);
      return;
    }
    openLinkUrl(item.url, item.id);
  }

  function saveGeoComment(link: LinkItem, comment: string) {
    const trimmed = comment.trim();
    if (trimmed === (link.comment ?? '')) return;
    updateDoc(doc(db, 'links', link.id), { comment: trimmed || deleteField() });
  }

  function addGeoAttachment(link: LinkItem, block: Block) {
    setGeoAttachPickerVisible(false);
    const next = [...(link.attachments ?? []), block];
    updateDoc(doc(db, 'links', link.id), { attachments: next });
  }

  function removeGeoAttachment(link: LinkItem, attachmentId: string) {
    const next = (link.attachments ?? []).filter((a) => a.id !== attachmentId);
    updateDoc(doc(db, 'links', link.id), { attachments: next });
  }

  // The "+" button on the Геоточки category alone asks which of the two
  // doors in first - paste a link, or type the point straight in - since
  // "Нове посилання" as a prompt makes no sense for someone who has
  // coordinates, not a URL, in hand.
  async function handleAddPress() {
    if (category !== 'geo') {
      setAddLinkUrlPromptVisible(true);
      return;
    }
    const choice = await ask({
      title: 'Нова геоточка',
      actions: [
        { id: 'url', label: 'Вставити посилання' },
        { id: 'coords', label: 'Ввести координати' },
      ],
    });
    if (choice === 'url') setAddLinkUrlPromptVisible(true);
    else if (choice === 'coords') setGeoPointSheetVisible(true);
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

  // Gone for good: what deleting used to be, now only reached by purging
  // from the bin - see useBin. Detaches every tag and drops the link out
  // of any note that still references it.
  async function purgeLink(link: LinkItem) {
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

  // "Delete" puts a link in the bin (see useBin) - the record, its tags
  // and every note that references it stay exactly as they were.
  function confirmDeleteSelected() {
    const linksToDelete = selectedLinks;
    confirm({
      title: linksToDelete.length === 1 ? 'У кошик?' : `У кошик (${linksToDelete.length})?`,
      message: 'Можна буде повернути з кошика протягом 30 днів.',
      confirmLabel: 'У кошик',
    }).then((yes) => {
      if (!yes) return;
      Promise.all(linksToDelete.map((l) => bin.moveToBin(l.id)));
      clearSelection();
    });
  }

  async function bulkAttachTag(tag: Parameters<typeof attachTag>[0]) {
    setBulkTagPickerVisible(false);
    await Promise.all(selectedLinks.map((l) => attachTag(tag, tagKind, l.id, 'links')));
    clearSelection();
  }

  async function bulkCreateAndAttachTag(path: string, icon: string, color: string) {
    setBulkTagPickerVisible(false);
    await createAndAttachTagToMany(path, icon, color, tagKind, selectedLinks.map((l) => l.id), 'links');
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

  async function assignSingleGroup(groupId: string | null) {
    const targetId = singleGroupTargetId;
    setSingleGroupTargetId(null);
    if (!targetId) return;
    await updateDoc(doc(db, 'links', targetId), { groupId: groupId ?? deleteField() });
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
    // Carried, the row gives up its own onLongPress - the list's drag
    // gesture opens the menu itself, on its own timing, instead of racing
    // it (see useExplorerCarry).
    const carried = explorer.active;
    const row = (
      <LinkRow
        key={item.id}
        link={item}
        tags={tags.filter((t) => item.tagIds.includes(t.id))}
        onPress={() => (isSelectMode ? toggleSelected(item.id) : openLinkCard(item))}
        onLongPress={carried ? undefined : () => setCardMenuLinkId(item.id)}
        onMenu={() => setCardMenuLinkId(item.id)}
        onTagPress={() => setTagPickerForId(item.id)}
        isSelectMode={isSelectMode}
        isSelected={selectedIds.has(item.id)}
        onToggleSelect={() => toggleSelected(item.id)}
        project={groups.find((g) => g.id === item.groupId) ?? null}
        onProjectPress={() => setSingleGroupTargetId(item.id)}
        playing={playingLinkId === item.id}
        onStopPlaying={() => setPlayingLinkId(null)}
        onOpenFullscreen={() => {
          setPlayingLinkId(null);
          setFullscreenVideoUrl(item.url);
        }}
        {...(carried ? carrying.cardProps(item, () => setCardMenuLinkId(item.id)) : {})}
      />
    );
    return row;
  }

  // Three across where the column is actually wide enough to hold them -
  // the fold open, a tablet, the browser - and two on a phone. Measured
  // off the column the chrome hands down, not the window: in a pane the
  // two are not the same number.
  function renderLinkGridCell(item: LinkItem, columns: number) {
    const carried = explorer.active;
    const cell = (
      <LinkGridCell
        key={item.id}
        columns={columns}
        link={item}
        tags={tags.filter((t) => item.tagIds.includes(t.id))}
        onPress={() => (isSelectMode ? toggleSelected(item.id) : openLinkCard(item))}
        onLongPress={carried ? undefined : () => setCardMenuLinkId(item.id)}
        onMenu={() => setCardMenuLinkId(item.id)}
        onTagPress={() => setTagPickerForId(item.id)}
        isSelectMode={isSelectMode}
        isSelected={selectedIds.has(item.id)}
        onToggleSelect={() => toggleSelected(item.id)}
        project={groups.find((g) => g.id === item.groupId) ?? null}
        onProjectPress={() => setSingleGroupTargetId(item.id)}
        playing={playingLinkId === item.id}
        onStopPlaying={() => setPlayingLinkId(null)}
        onOpenFullscreen={() => {
          setPlayingLinkId(null);
          setFullscreenVideoUrl(item.url);
        }}
        {...(carried ? carrying.cardProps(item, () => setCardMenuLinkId(item.id)) : {})}
      />
    );
    return cell;
  }

  // The bin's own rows - a tap or a hold both open the same restore/purge
  // menu, same as Documents' own bin.
  function renderLinkTrashRow(item: LinkItem) {
    return (
      <LinkRow
        key={item.id}
        link={item}
        tags={tags.filter((t) => item.tagIds.includes(t.id))}
        onPress={() => bin.openTrashMenu(item, item.title || item.url)}
        onLongPress={() => bin.openTrashMenu(item, item.title || item.url)}
      />
    );
  }

  function renderLinkTrashGridCell(item: LinkItem, columns: number) {
    return (
      <LinkGridCell
        key={item.id}
        columns={columns}
        link={item}
        tags={tags.filter((t) => item.tagIds.includes(t.id))}
        onPress={() => bin.openTrashMenu(item, item.title || item.url)}
        onLongPress={() => bin.openTrashMenu(item, item.title || item.url)}
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
            <Text style={styles.trashTitle}>Кошик · {trashedLinks.length}</Text>
            <View style={{ flex: 1 }} />
            {trashedLinks.length > 0 && (
              <Pressable hitSlop={8} onPress={() => bin.emptyBin('посилання')}>
                <Text style={styles.trashClear}>Очистити</Text>
              </Pressable>
            )}
          </View>
          <Text style={styles.trashHint}>
            Затисни посилання, щоб відновити або видалити назавжди. Через 30 днів кошик очищається сам.
          </Text>
        </View>
      );
    }
    if (!list.explorerMode) return null;
    return (
      <ExplorerHead
        folderRef={carrying.carry.registerFolder}
        path={explorer.path}
        folders={explorer.folders}
        itemIcon="link-outline"
        onGo={(next) => {
          explorer.setPath(next);
          if (needle !== '') {
            list.setSearchQuery('');
            list.setIsSearching(false);
          }
        }}
        onFolderMenu={openFolderMenu}
        trash={{ count: trashedLinks.length, onOpen: () => setTrashOpen(true) }}
      />
    );
  }

  return (
    <DatabaseChrome
      list={list}
      railSide={inPane ? 'left' : 'right'}
      accent={accent}
      accentGlass={accentGlass}
      onBack={() => navigation.goBack()}
      leaveIcon="link-outline"
      searchPlaceholder="Пошук за назвою"
      onAdd={handleAddPress}
      // The shape of the list is a button on the rail now - it was two
      // rows here saying the same thing, on three screens. On «Геоточки»
      // alone it cycles a third stop - the map - rather than earning a
      // second button next to it: list/grid already share this one, and
      // a point either has a place on a map or it does not, the same
      // binary a representation switch already is everywhere else.
      shape={{
        icon: mapVisible ? 'map-outline' : viewMode === 'grid' ? 'grid-outline' : 'reorder-four-outline',
        onToggle: () => {
          if (category !== 'geo') {
            changeViewMode(viewMode === 'list' ? 'grid' : 'list');
            return;
          }
          if (mapVisible) {
            setMapVisible(false);
          } else if (viewMode === 'list') {
            changeViewMode('grid');
          } else {
            setMapVisible(true);
          }
        },
      }}
      explorer={{
        mode: list.listMode,
        onChangeMode: list.setListMode,
        active: explorer.active,
        onNewFolder: () => explorer.setFolderPrompt({ mode: 'new', parent: explorer.path }),
        paths: explorer.allFolderPaths,
        path: explorer.path,
        onGo: explorer.setPath,
        onNewFolderIn: (parent) => explorer.setFolderPrompt({ mode: 'new', parent }),
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
          {/* The floating card while one is being carried into a folder -
              see useCardCarry. Always mounted, invisible until then. */}
          <CardCarryOverlay
            carry={carrying.carry}
            label={(items) => (items.length > 1 ? `${items.length} посилання` : items[0].title || items[0].url)}
            icon="link-outline"
            onEnterFolder={(path) => explorer.setPath(path)}
          />
          {justAddedLink && (
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
                {/* Where the drag-and-drop lands a card, for anyone who
                    would rather pick the folder from a list - and the only
                    way to reach a folder that is nowhere near the screen. */}
                <Pressable
                  style={styles.cardMenuRow}
                  onPress={async () => {
                    const link = cardMenuLink;
                    setCardMenuLinkId(null);
                    if (!link) return;
                    const destination = await explorer.pickDestination(
                      `Перемістити «${link.title || link.url}» в…`
                    );
                    if (destination === 'cancel') return;
                    await explorer.moveItem(link, destination);
                  }}
                >
                  <Ionicons name="folder-outline" size={18} color="#111827" />
                  <Text style={styles.cardMenuRowLabel}>Перемістити в папку</Text>
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
                {/* The only way to a single delete used to be select-mode
                    on exactly one item - "в посиланнях немає функції
                    видалення". Straight to the bin, no confirmation: the
                    bin is the undo, same as Photos' own single delete. */}
                <Pressable
                  style={styles.cardMenuRow}
                  onPress={() => {
                    if (cardMenuLink) bin.moveToBin(cardMenuLink.id);
                    setCardMenuLinkId(null);
                  }}
                >
                  <Ionicons name="trash-outline" size={18} color="#EF4444" />
                  <Text style={[styles.cardMenuRowLabel, { color: '#EF4444' }]}>Видалити</Text>
                </Pressable>
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

          <GeoPointEntrySheet
            visible={geoPointSheetVisible}
            onCancel={() => setGeoPointSheetVisible(false)}
            onSave={({ title, point }) => saveGeoPointByHand(title, point)}
          />

          <GeoPointDetailSheet
            link={geoDetailId ? (links.find((l) => l.id === geoDetailId) ?? null) : null}
            onClose={() => setGeoDetailId(null)}
            onSaveComment={(comment) => {
              const link = links.find((l) => l.id === geoDetailId);
              if (link) saveGeoComment(link, comment);
            }}
            onAddPhoto={() => setGeoAttachPickerVisible(true)}
            onRemovePhoto={(attachmentId) => {
              const link = links.find((l) => l.id === geoDetailId);
              if (link) removeGeoAttachment(link, attachmentId);
            }}
          />

          <AddExistingItemModal
            visible={geoAttachPickerVisible}
            allowedTabs={['photo']}
            onClose={() => setGeoAttachPickerVisible(false)}
            onPick={(block) => {
              const link = links.find((l) => l.id === geoDetailId);
              if (link) addGeoAttachment(link, block);
            }}
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

          <GroupPickerSheet
            visible={!!singleGroupTargetId}
            kind={groupKind}
            groups={groups}
            onPick={assignSingleGroup}
            onClose={() => setSingleGroupTargetId(null)}
          />

          {/* Where «розгорнути» on a playing card goes - the same
              player, on a black screen, for a video worth watching
              properly. */}
          <VideoPlayerModal url={fullscreenVideoUrl} onClose={() => setFullscreenVideoUrl(null)} />

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
      {(listTopPad, listProps, listWidth, scrollY) => {
        carrying.scrollYRef.current = scrollY;
        return (
        isLoading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : // linksHere, not linksHere: stepping into an empty folder
        // mid-carry would otherwise swap the list for the empty state and
        // unmount the carried row with it.
        !trashOpen && linksHere.length === 0 && explorer.folders.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={[styles.emptyIcon, { backgroundColor: `${info.color}1A` }]}>
              <Ionicons name={info.icon} size={32} color={info.color} />
            </View>
            <Text style={styles.emptyLabel}>{needle ? 'Нічого не знайдено' : 'Ще немає збережених посилань'}</Text>
            {!needle && <Text style={styles.emptyHint}>{info.emptyHint}</Text>}
          </View>
        ) : mapVisible && category === 'geo' ? (
          <GeoMapView points={geoMapPoints} onPressPoint={(id) => setGeoDetailId(id)} />
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
              {(trashOpen ? trashedLinks : linksHere).map((item) =>
                trashOpen
                  ? renderLinkTrashGridCell(item, listWidth >= 640 ? 3 : 2)
                  : renderLinkGridCell(item, listWidth >= 640 ? 3 : 2)
              )}
            </View>
            {!trashOpen && <GroupSections groupId={list.selectedGroupId} currentKind={tagKind} tags={tags} />}
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
            {(trashOpen ? trashedLinks : linksHere).map((item) =>
              trashOpen ? renderLinkTrashRow(item) : renderLinkRow(item)
            )}
            {/* What else is in this group - see GroupSections. */}
            {!trashOpen && <GroupSections groupId={list.selectedGroupId} currentKind={tagKind} tags={tags} />}
          </ScrollView>
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
    backgroundColor: t.selected,
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
  cardMenuBackdrop: {
    backgroundColor: t.scrim,
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
