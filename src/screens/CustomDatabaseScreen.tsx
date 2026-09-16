import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
// gesture-handler's own ScrollView (not the core RN one) for the row-editor
// sheet: a drag that starts on one of its TextInput/Pressable fields never
// reaches an RN ScrollView's scroll recognition on Android, so that form
// only scrolled when a finger happened to land in the gap between two
// fields. Same fix (and same reason) as DocumentEditorScreen's block list.
// Everything else on this screen stays on the RN ScrollView it already
// scrolled fine with.
import { ScrollView as GestureScrollView } from 'react-native-gesture-handler';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
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
} from '../firestore';
import { ownedQuery, setDoc } from '../utils/owned';
import {
  GLASS_BODY_BLURRED,
  GLASS_CARD,
  GLASS_LINE,
  GLASS_TEXT,
  GLASS_TEXT_FAINT,
  GLASS_TEXT_MUTED,
  SHEET_BACKDROP,
  SHEET_WINDOW,
} from '../constants/glass';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { TAG_COLORS } from '../constants/tags';
import { LINK_CATEGORY_INFO, LinkCategory, categoryFromSiteName } from '../utils/linkCategory';
import { refreshLinkPreviewIfExpired } from '../utils/linkPreviewRefresh';
import GlassLayer from '../components/GlassLayer';
import RailCapsule from '../components/RailCapsule';
import { db } from '../firebase';
import { deleteCustomDatabase } from '../utils/deleteCustomDatabase';
import {
  CustomDatabase,
  CustomDatabaseRow,
  CustomDatabaseView,
  FieldDef,
  FieldType,
  Group,
  RelationTarget,
} from '../types';
import { groupAppliesTo } from '../utils/groups';
import { hapticSuccess } from '../utils/haptics';
import CustomRowCard, { CustomRowGridCard, RelationThumb } from '../components/CustomRowCard';
import {
  buildRowDisplay,
  coverFieldOf,
  displayFieldValue,
  resolveRelationValue,
  resolveBacklinkRows,
  resolveRelationList,
  rowTitleOf,
  visibleFieldsOf,
  RowDisplayContext,
} from '../utils/customRowDisplay';
import { RootStackParamList } from '../navigation';
import RenamePrompt from '../components/RenamePrompt';
import { ask, confirm, notify } from '../components/surfaces/Ask';
import FieldsEditorSheet, { FIELD_TYPE_ICON, FIELD_TYPE_LABEL } from '../components/FieldsEditorSheet';
import ImportTableSheet from '../components/ImportTableSheet';
import PhotoCarousel from '../components/PhotoCarousel';
import UndoToast from '../components/UndoToast';
import TagChips from '../components/TagChips';
import TagPicker from '../components/TagPicker';
import BulkActionBar from '../components/BulkActionBar';
import GroupPickerSheet from '../components/GroupPickerSheet';
import DocumentPickerModal, { PickableDocument } from '../components/DocumentPickerModal';
import ProjectTabsRow, { UNASSIGNED_ID } from '../components/ProjectTabsRow';
import { usePendingDelete } from '../hooks/usePendingDelete';
import { useMultiSelect } from '../hooks/useMultiSelect';
import { useCachedAttachment } from '../hooks/useCachedAttachment';
import { useTags, detachTagFromDeletedItem } from '../hooks/useTags';
import {
  BUILT_IN_SORT_FIELDS,
  BUILT_IN_SORT_LABELS,
  DEFAULT_ROW_SORT,
  Facet,
  RowFilter,
  RowSort,
  activeFilterFor,
  applyRowFilters,
  clearFilterFor,
  defaultDirFor,
  facetsOf,
  filterableFieldsOf,
  setPresenceOp,
  sortLabelFor,
  sortRows,
  groupRows,
  groupableFieldsOf,
  sortableFieldsOf,
  toggleFacet,
  viewMatchesState,
} from '../utils/customRowQuery';
import { colorForDocument } from '../utils/documentColor';
import { MONTH_FULL, WEEKDAY_SHORT, dateKey, getMonthGrid, isSameDay, parseDateKey } from '../utils/dateLocale';
import { useRail, useRailFree } from '../hooks/useRail';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { BlurView } from 'expo-blur';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassPortal } from '../components/GlassPortal';
import { useBlurTarget } from '../components/GlassTarget';
import { GLASS_ISLAND } from '../constants/glass';
import GlassDrop from '../components/GlassDrop';
import {
  CAPSULE_DROP,
  CAPSULE_HEIGHT,
  CAPSULE_HEIGHT_1,
  CAPSULE_HEIGHT_3,
  CHROME_TOP,
  RAIL_CLEARANCE,
  railClear,
  RAIL_RIGHT,
  capsuleHeightFor,
  railFits,
} from '../constants/rail';
import Menu from '../components/surfaces/Menu';

const ACCENT = '#A05C7B';
// The same half-strength tint the documents screen's add button takes.
const ACCENT_GLASS = 'rgba(160,92,123,0.55)';
const DANGER = '#EF4444';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const VIEW_LABELS: Record<ViewMode, string> = { list: 'Список', cards: 'Картки', table: 'Таблиця' };
const VIEW_ICONS: Record<ViewMode, keyof typeof Ionicons.glyphMap> = {
  list: 'reorder-four-outline',
  cards: 'albums-outline',
  table: 'grid-outline',
};
// The card grid's own padding and gap, as numbers because the tile width is
// computed from them (see gridTileWidth) as well as applied in the style.
const CARD_GRID_PADDING = 20;
const CARD_GRID_GAP = 12;
const TABLE_COLUMN_WIDTH = 150;
const TABLE_HANDLE_WIDTH = 34;
// The title column is the one column whose content the user can't shorten:
// a composed name ("FORD TRANSIT · 7902E6") is as long as the fields that
// make it. So it measures itself against the longest name actually in the
// database instead of sitting at the same fixed width as the rest - never
// narrower than a normal column, never past half the screen (past that the
// frozen part crowds out everything it's supposed to be read next to).
// Width is estimated from the character count rather than measured: an
// onLayout measurement would arrive a frame after the column it has to
// size, and this column has to be the same width in the header, the frozen
// body and every cell at once.
const TABLE_TITLE_CHAR_WIDTH = 7.8;
function titleColumnWidth(titles: string[], windowWidth: number): number {
  const longest = titles.reduce((max, t) => Math.max(max, t.length), 0);
  const wanted = Math.ceil(longest * TABLE_TITLE_CHAR_WIDTH) + 16;
  return Math.max(TABLE_COLUMN_WIDTH, Math.min(wanted, Math.round(windowWidth * 0.55)));
}
// Every cell is exactly this tall so the frozen column and the scrolling
// columns line up row for row - they're two separate stacks, nothing else
// keeps them in step.
const TABLE_ROW_HEIGHT = 46;

type ViewMode = 'list' | 'table' | 'cards';
type ChipLayout = { x: number; y: number; width: number };
// The three tabs of the parameters window. They were three buttons on the
// rail and three anchored lists; the user's own call was that they are one
// window with three tabs, "як менше основного екрану по центру" - the
// sheet shape this app already uses everywhere else.
type ParamsTab = 'sort' | 'filter' | 'group';
type RowEditorState = { mode: 'new'; id: string } | { mode: 'edit'; row: CustomDatabaseRow };

type Props = NativeStackScreenProps<RootStackParamList, 'CustomDatabase'>;

// One user-created database (Notion-style: fields defined by the user, not
// picked from this app's own fixed set) - a direct structural copy of
// FilesScreen's own screen (same onSnapshot/tags/groups/bulk-select/sort
// pattern), with a generic per-field-type cell renderer standing in for
// FilesScreen's fixed file-name/thumbnail row. Editing a row (List or Table
// view alike) opens one shared form with an input per field, rather than
// true inline per-cell editing - Table view is still a real at-a-glance
// overview of every field across every row, it just isn't edited in place.
// `databaseId` as a prop, not only from the route: on a wide screen this
// screen is rendered INSIDE the tile board's left pane, where the route
// belongs to the board and knows nothing about which database was opened.
export default function CustomDatabaseScreen({
  databaseId: databaseIdProp,
  inPane,
}: Partial<Props> & { databaseId?: string; inPane?: boolean }) {
  const railBlurTarget = useBlurTarget();
  const railFocused = useIsFocused();
  const railInsets = useSafeAreaInsets();
  // Three buttons in the capsule here, so the rail spaces what is under
  // it against the taller one.
  // The rail carries an actions capsule here too - see RailCapsule. The
  // strip over the list is where a database says what it is SHOWING
  // (a saved view, list/cards/table, grouping); what it can DO to that
  // list - order it, filter it, choose in it - belongs on the rail, with
  // the same two or three buttons as every other screen.
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const params = (route.params ?? {}) as {
    databaseId?: string;
    openRowId?: string;
    openViewId?: string;
  };
  const databaseId = databaseIdProp ?? params.databaseId ?? '';
  const { openRowId, openViewId } = params;
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const customRowKind = `customRow:${databaseId}`;
  const prefsKey = `customDb_${databaseId}`;
  const prefsDoc = doc(db, 'settings', prefsKey);

  const [database, setDatabase] = useState<CustomDatabase | null>(null);
  const [rows, setRows] = useState<CustomDatabaseRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Why the list is empty, when it is empty for a reason other than having
  // nothing in it - see the rows listener's error handler below.
  const [readError, setReadError] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [menuOpen, setMenuOpen] = useState(false);
  // 'params' is the one window that carries sorting, filtering and
  // grouping on three tabs - they were three separate anchored lists, and
  // they are one family: all three change the same list. 'view' and
  // 'views' stay small anchored lists, because they are one short choice
  // each, not a panel.
  const [openParam, setOpenParam] = useState<'view' | 'views' | 'params' | null>(null);
  // Which of the three tabs opens first: the one used last in THIS
  // database, so the common case stays one tap plus no thinking. Kept in
  // the same per-database prefs document the sort and the filters are.
  const [paramsTab, setParamsTab] = useState<ParamsTab>('sort');
  const [sortPref, setSortPref] = useState<RowSort>(DEFAULT_ROW_SORT);
  const [filters, setFilters] = useState<RowFilter[]>([]);
  // Which field the list is broken into groups by, if any - each group
  // headed by its own value and count.
  const [groupFieldId, setGroupFieldId] = useState<string | null>(null);
  // Which field's values the filter dropdown is currently showing. null is
  // its top level, the list of fields.
  const [filterFieldId, setFilterFieldId] = useState<string | null>(null);
  // Where each capsule sits, so the list can be drawn over the screen at
  // that exact spot instead of inside the capsule's own one-pill-tall row.
  const [stripY, setStripY] = useState(0);
  const [chipLayouts, setChipLayouts] = useState<Record<string, ChipLayout>>({});
  // The capsule strip scrolls horizontally now (see paramsScroll below);
  // a chip's onLayout position is relative to that scrolling content, not
  // the screen, so placing the overlay under it needs the strip's own
  // screen x and the current scroll offset too. Refs, not state - both are
  // read once, at the moment a list opens, and stay correct afterward
  // because opening one freezes the scroll (scrollEnabled below) until it
  // closes.
  const stripXRef = useRef(0);
  const scrollXRef = useRef(0);
  const [savedViews, setSavedViews] = useState<CustomDatabaseView[]>([]);
  // { mode: 'new' } asks for a name for the current state; { mode: 'rename' }
  // carries the view being renamed.
  const [viewPrompt, setViewPrompt] = useState<{ mode: 'new' } | { mode: 'rename'; view: CustomDatabaseView } | null>(
    null
  );
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [renamingDatabase, setRenamingDatabase] = useState(false);
  const [editingFields, setEditingFields] = useState(false);
  const [importing, setImporting] = useState(false);
  const [rowEditor, setRowEditor] = useState<RowEditorState | null>(null);
  // The type chosen for a field being added from inside the record form -
  // the name is asked next, and the two together make the field. Null
  // while nothing is being added. See addFieldFromForm.
  const [fieldPromptType, setFieldPromptType] = useState<FieldType | null>(null);
  // What a 'relation' field being added from the form points at, and
  // whether it holds one or several - asked before the name, kept here
  // until createField writes the field.
  const [fieldPromptRelation, setFieldPromptRelation] = useState<{
    target: RelationTarget;
    multiple: boolean;
  } | null>(null);
  // Opening a row now lands on a READ page - a structured reference for
  // this one record - and editing is a deliberate step from there, rather
  // than every tap dropping straight into a form.
  const [rowPageId, setRowPageId] = useState<string | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string | number | string[]>>({});
  const [draftTagIds, setDraftTagIds] = useState<string[]>([]);
  const [tagPickerVisible, setTagPickerVisible] = useState(false);
  const [datePickerFieldId, setDatePickerFieldId] = useState<string | null>(null);
  const [selectPickerFieldId, setSelectPickerFieldId] = useState<string | null>(null);
  const [relationPickerFieldId, setRelationPickerFieldId] = useState<string | null>(null);
  // Which 'backlink' field's "додати" picker is open. Picking there writes
  // the OTHER row's relation field, never anything on this row - that one
  // field stays the only place the link is stored.
  const [backlinkPickerFieldId, setBacklinkPickerFieldId] = useState<string | null>(null);
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [documentPicker, setDocumentPicker] = useState<{ row: CustomDatabaseRow; documents: PickableDocument[] } | null>(
    null
  );
  const [bulkGroupPickerVisible, setBulkGroupPickerVisible] = useState(false);
  const [bulkTagPickerVisible, setBulkTagPickerVisible] = useState(false);
  // Date/select/multiSelect/relation cells can't be typed into - they open
  // their own picker against that row+field rather than against the row
  // form's draft.
  const [cellPicker, setCellPicker] = useState<{ rowId: string; field: FieldDef } | null>(null);
  // 'relation' fields (see FieldsEditorSheet) resolve against these three
  // caches. photosList is every "Фото" item (id/uri/title only, no full
  // PhotoItem shape) - a relation targeting Photos is the common case, so
  // this is always subscribed, same as tags/groups already are regardless
  // of whether this particular database happens to use them.
  // otherDatabases lists every OTHER custom database, for the "Ціль"
  // picker in FieldsEditorSheet. relatedDatabases/relatedRows hold the
  // field defs + rows of whichever OTHER databases a relation field here
  // actually points at - see the effect below that keeps them in sync
  // with the current field list instead of subscribing to every database
  // in the app up front.
  const [photosList, setPhotosList] = useState<
    { id: string; imageUri: string; title?: string; driveFileId?: string }[]
  >([]);
  // The same for Файли: names only, subscribed unconditionally beside
  // photos - a record that is a contract or a vehicle usually has papers.
  const [filesList, setFilesList] = useState<{ id: string; title?: string; fileName?: string }[]>([]);
  // The three link databases share one collection; each row carries the
  // category it belongs to, worked out from its siteName.
  const [linksList, setLinksList] = useState<
    { id: string; url: string; title?: string; imageUrl?: string; category: LinkCategory }[]
  >([]);
  const [otherDatabases, setOtherDatabases] = useState<{ id: string; name: string }[]>([]);
  const [relatedDatabases, setRelatedDatabases] = useState<Record<string, CustomDatabase>>({});
  const [relatedRows, setRelatedRows] = useState<Record<string, CustomDatabaseRow[]>>({});
  // The header scrolls sideways only as a mirror of the body's own offset.
  const headerScrollRef = useRef<ScrollView>(null);
  const bodyScrollRef = useRef<ScrollView>(null);
  // This Android build doesn't resize the window under the keyboard - it
  // arrives as an inset over the content, not a shrink - so a bottom sheet
  // needs to track its height itself and push up by that much, same as
  // GroupPickerSheet's own "Нова група" input.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  const { filterPending, requestDeleteMany, undo, toast } = usePendingDelete<CustomDatabaseRow>();
  const { tags, attachTag, detachTag, createAndAttachTag, renameTag } = useTags();
  const { isSelectMode, selectedIds, toggleSelectMode, toggle: toggleSelected, clear: clearSelection } =
    useMultiSelect();

  useEffect(() => {
    return onSnapshot(doc(db, 'customDatabases', databaseId), (snapshot) => {
      const data = snapshot.data();
      if (!data) return;
      setDatabase({ id: databaseId, name: data.name, icon: data.icon, color: data.color, fields: data.fields ?? [], createdAt: data.createdAt, updatedAt: data.updatedAt });
    },
    (error) => setReadError(error.message));
  }, [databaseId]);

  useEffect(() => {
    return onSnapshot(ownedQuery('customDatabaseViews'), (snapshot) => {
      setSavedViews(
        snapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<CustomDatabaseView, 'id'>) }))
          .filter((v) => v.databaseId === databaseId)
          .sort((a, b) => a.name.localeCompare(b.name, 'uk', { sensitivity: 'base', numeric: true }))
      );
    },
    (error) => setReadError(error.message));
  }, [databaseId]);

  useEffect(() => {
    // Filtered client-side by databaseId, same "avoid a composite index"
    // tradeoff every other database screen in this app already makes.
    return onSnapshot(ownedQuery('customDatabaseRows'), (snapshot) => {
      setRows(
        snapshot.docs
          .map((docSnapshot) => {
            const data = docSnapshot.data();
            return {
              id: docSnapshot.id,
              databaseId: data.databaseId,
              values: data.values ?? {},
              tagIds: data.tagIds ?? [],
              groupId: data.groupId,
              usedInDocuments: data.usedInDocuments,
              createdAt: data.createdAt ?? 0,
              updatedAt: data.updatedAt ?? 0,
            } as CustomDatabaseRow;
          })
          .filter((r) => r.databaseId === databaseId)
          .sort((a, b) => b.updatedAt - a.updatedAt)
      );
      setReadError(null);
      setIsLoading(false);
    },
    // A listener with no error handler is the shape of the worst bug this
    // app has had: the owner-only rules REFUSE a read they do not like
    // rather than return fewer rows, and with nothing listening for that
    // the screen simply stands there saying "Ще немає записів". An empty
    // database and a refused database have to look different, or the user
    // is left reading data loss into a permissions error.
    (error) => {
      setReadError(error.message);
      setIsLoading(false);
    });
  }, [databaseId]);

  useEffect(() => {
    return onSnapshot(ownedQuery('groups'), (snapshot) => {
      setGroups(
        snapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Group, 'id'>) }))
          .filter((g) => groupAppliesTo(g, customRowKind))
      );
    });
  }, [customRowKind]);

  // See photosList's own comment above - unconditional, same as groups/tags.
  useEffect(() => {
    return onSnapshot(ownedQuery('photos'), (snapshot) => {
      setPhotosList(
        snapshot.docs.map((d) => {
          const data = d.data();
          return { id: d.id, imageUri: data.imageUri, title: data.title, driveFileId: data.driveFileId };
        })
      );
    });
  }, []);

  useEffect(() => {
    return onSnapshot(ownedQuery('files'), (snapshot) => {
      setFilesList(
        snapshot.docs.map((d) => {
          const data = d.data();
          return { id: d.id, title: data.title, fileName: data.fileName };
        })
      );
    });
  }, []);

  useEffect(() => {
    return onSnapshot(ownedQuery('links'), (snapshot) => {
      setLinksList(
        snapshot.docs.map((d) => {
          const data = d.data();
          // An expired TikTok cover is fetched again and written back;
          // this same listener then delivers the live one.
          refreshLinkPreviewIfExpired({ id: d.id, url: data.url, imageUrl: data.imageUrl });
          return {
            id: d.id,
            url: data.url,
            title: data.title,
            imageUrl: data.imageUrl,
            category: categoryFromSiteName(data.siteName),
          };
        })
      );
    });
  }, []);

  useEffect(() => {
    return onSnapshot(ownedQuery('customDatabases'), (snapshot) => {
      setOtherDatabases(
        snapshot.docs.filter((d) => d.id !== databaseId).map((d) => ({ id: d.id, name: d.data().name ?? 'База' }))
      );
    });
  }, [databaseId]);

  // Which OTHER databases a 'relation' field here actually points at right
  // now - recomputed on every render (cheap: just a filter/map over this
  // database's own field list), and the two effects below keep exactly
  // those (and only those) databases' field defs + rows subscribed.
  const referencedDbIds = Array.from(
    new Set([
      ...(database?.fields ?? [])
        .filter((f) => f.type === 'relation' && f.relationTarget?.kind === 'customDb')
        .map((f) => (f.relationTarget as { kind: 'customDb'; databaseId: string }).databaseId),
      // A 'backlink' field points the other way: the rows that matter live
      // in the database that points AT us, so that one has to be loaded
      // too. Same two subscriptions, one more id in the set.
      ...(database?.fields ?? [])
        .filter((f) => f.type === 'backlink' && f.backlinkSource)
        .map((f) => f.backlinkSource!.databaseId),
    ])
  );
  const referencedDbIdsKey = referencedDbIds.join(',');

  useEffect(() => {
    if (referencedDbIds.length === 0) return;
    const unsubs = referencedDbIds.map((id) =>
      onSnapshot(doc(db, 'customDatabases', id), (snapshot) => {
        const data = snapshot.data();
        if (!data) return;
        setRelatedDatabases((prev) => ({
          ...prev,
          [id]: { id, name: data.name, icon: data.icon, color: data.color, fields: data.fields ?? [], createdAt: data.createdAt, updatedAt: data.updatedAt },
        }));
      })
    );
    return () => unsubs.forEach((u) => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referencedDbIdsKey]);

  useEffect(() => {
    if (referencedDbIds.length === 0) {
      setRelatedRows({});
      return;
    }
    // One listener over the whole flat collection (same "avoid a composite
    // index" tradeoff as this screen's own rows effect above), split by
    // databaseId client-side rather than one listener per referenced
    // database.
    return onSnapshot(ownedQuery('customDatabaseRows'), (snapshot) => {
      const grouped: Record<string, CustomDatabaseRow[]> = {};
      snapshot.docs.forEach((d) => {
        const data = d.data();
        if (!referencedDbIds.includes(data.databaseId)) return;
        const row: CustomDatabaseRow = {
          id: d.id,
          databaseId: data.databaseId,
          values: data.values ?? {},
          tagIds: data.tagIds ?? [],
          groupId: data.groupId,
          createdAt: data.createdAt ?? 0,
          updatedAt: data.updatedAt ?? 0,
        };
        (grouped[data.databaseId] ??= []).push(row);
      });
      setRelatedRows(grouped);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [referencedDbIdsKey]);

  // A Modal handled the hardware back button for free; a plain overlay has
  // to claim it, or back would leave the database entirely with the page
  // still notionally open.
  useEffect(() => {
    if (!rowPageId) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setRowPageId(null);
      return true;
    });
    return () => sub.remove();
  }, [rowPageId]);

  // Arrived from a 'dbRow' block in a document (see openCustomRowBlock):
  // open that row's editor as soon as the rows are in. The ref makes it a
  // one-shot - closing the editor mustn't reopen it on the next render.
  const openedRowFromParamRef = useRef(false);
  useEffect(() => {
    if (!openRowId || openedRowFromParamRef.current) return;
    const row = rows.find((r) => r.id === openRowId);
    if (!row) return;
    openedRowFromParamRef.current = true;
    setRowPageId(row.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRowId, rows]);

  // Same one-shot shape, for arriving from a 'dbView' block (see
  // openCustomViewBlock): apply that saved view as soon as it's loaded.
  const openedViewFromParamRef = useRef(false);
  useEffect(() => {
    if (!openViewId || openedViewFromParamRef.current) return;
    const view = savedViews.find((v) => v.id === openViewId);
    if (!view) return;
    openedViewFromParamRef.current = true;
    applySavedView(view);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openViewId, savedViews]);

  useEffect(() => {
    return onSnapshot(prefsDoc, (snapshot) => {
      const data = snapshot.data();
      setViewMode((data?.viewMode as ViewMode | undefined) ?? 'list');
      // Same two keys useSortPref writes on the other database screens, so
      // a sort chosen before this screen grew its own field-aware sorting
      // is still the sort it comes back with.
      setSortPref(
        data?.sortField
          ? { field: data.sortField as string, dir: (data.sortDir as RowSort['dir']) ?? 'desc' }
          : DEFAULT_ROW_SORT
      );
      setFilters((data?.rowFilters as RowFilter[] | undefined) ?? []);
      setGroupFieldId((data?.groupFieldId as string | undefined) ?? null);
      const tab = data?.paramsTab as ParamsTab | undefined;
      setParamsTab(tab === 'filter' || tab === 'group' ? tab : 'sort');
      setReadError(null);
    },
    (error) => setReadError(error.message));
  }, [prefsKey]);

  // ABOVE the early return below, and it has to stay there: a hook that
  // runs only once the database has loaded is a hook that is missing on
  // the render before it, and React ends the screen over it. That is what
  // crashed this screen the moment a database was opened.
  //
  // This screen is PUSHED over the tabs, so there is no navigation island
  // at its foot and the rail must not hold room for one - that reserved
  // height is what drove the capsules up over the top one.
  const railFree = useRailFree(CAPSULE_HEIGHT_3, false);
  // Inside another screen's LEFT pane the window's outer edge is the left
  // one, so the whole rail stands there instead of against the divider.
  const railSide = inPane ? ('left' as const) : ('right' as const);
  // What the rail would like to carry, and the order it gives it up in
  // when the screen is too short to hold it all.
  //
  // Four things, not six: ordering, narrowing and grouping became one
  // button opening one window with three tabs, so the rail carries the
  // shape of the list, that one parameters button, the saved views, and
  // choosing - with making a record in its own capsule below.
  //
  // The strip over the list is the OVERFLOW, not a place of its own:
  // whatever the rail cannot hold appears there as a chip, and on a screen
  // tall enough for everything the strip is not drawn at all.
  //
  // Nothing here decides by screen NAME or a breakpoint - each shape is
  // asked whether it stands clear of the top capsule, and the first that
  // does is the one drawn. A Fold's two screens need no case of their own.
  const RAIL_PLANS = [
    { shape: true, views: true, selectOwn: true },
    { shape: true, views: false, selectOwn: true },
    { shape: true, views: false, selectOwn: false },
    { shape: false, views: false, selectOwn: false },
  ];
  type RailPlan = (typeof RAIL_PLANS)[number];
  const railActionsHeight = (plan: RailPlan) =>
    capsuleHeightFor(
      1 + // the parameters button, which never leaves the rail
        (plan.shape ? 1 : 0) +
        (plan.views ? 1 : 0) +
        (plan.selectOwn ? 0 : 1)
    );
  const railPlan =
    RAIL_PLANS.find((plan) =>
      railFits(railFree, railActionsHeight(plan), CAPSULE_HEIGHT_1, plan.selectOwn ? CAPSULE_HEIGHT_1 : 0)
    ) ?? RAIL_PLANS[RAIL_PLANS.length - 1];
  const rail = useRail(
    CAPSULE_HEIGHT_3,
    railActionsHeight(railPlan),
    CAPSULE_HEIGHT_1,
    railPlan.selectOwn ? CAPSULE_HEIGHT_1 : 0,
    false
  );

  if (!database) {
    return (
      <View style={[styles.container, styles.emptyState]}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  // Card tiles used to be a flat 47% of the row - two columns whatever the
  // screen. On a Fold's inner screen in landscape that's two tiles of ~460,
  // which is a poster, not a card. One tile stays around 300dp wide and the
  // grid takes as many columns as fit: two on a phone, three on that
  // screen, four on a tablet. Widths are exact rather than percentages,
  // since the gaps between columns have to come out of them.
  // The rail's clearance comes off the right, as it does on every other
  // grid in the app - the tiles are an exact pixel width, so the number
  // they are worked out from has to be the width actually left over.
  const gridUsable = windowWidth - CARD_GRID_PADDING - RAIL_CLEARANCE;
  const gridColumns = Math.max(2, Math.min(4, Math.floor(gridUsable / 300)));
  const gridTileWidth = Math.floor(
    (gridUsable - CARD_GRID_GAP * (gridColumns - 1)) / gridColumns
  );

  const titleOf = (row: CustomDatabaseRow) => rowTitleOf(database, row);
  const coverField = coverFieldOf(database);
  // The three live caches a row's values resolve against - shared with the
  // same row rendered inside a document (see useCustomRowData), so the
  // resolution rules live in one place instead of once per screen.
  const displayContext: RowDisplayContext = {
    photos: photosList,
    files: filesList,
    links: linksList,
    relatedDatabases,
    relatedRows,
  };

  function resolveRelation(field: FieldDef, targetId: string | undefined) {
    return resolveRelationValue(field, targetId, displayContext);
  }

  const pendingFilteredRows = filterPending(rows);
  const groupFilteredRows =
    groupFilter === null
      ? pendingFilteredRows
      : groupFilter === UNASSIGNED_ID
        ? pendingFilteredRows.filter((r) => !r.groupId)
        : pendingFilteredRows.filter((r) => r.groupId === groupFilter);
  // Searches the whole row, not just its name: every field's DISPLAYED
  // value, so a select matches by its option's label and a relation by
  // the title of what it points at, rather than by the ids those actually
  // store. Hidden fields are searched too - hiding is about the view, and
  // a value you can't see is exactly the kind you'd go looking for.
  const needle = searchQuery.trim().toLowerCase();
  const searchedRows = needle
    ? groupFilteredRows.filter((row) =>
        database!.fields.some((field) =>
          displayFieldValue(field, row.values[field.id], displayContext).toLowerCase().includes(needle)
        )
      )
    : groupFilteredRows;
  const displayedRows = sortRows(
    applyRowFilters(searchedRows, filters, database),
    sortPref,
    database,
    displayContext
  );
  // The values a facet list offers come from the rows the OTHER filters
  // already allow, not from the whole database - so narrowing one field
  // never leaves another offering values that would return nothing.
  const filterFields = filterableFieldsOf(database);
  const openFilterField = filterFieldId ? filterFields.find((f) => f.id === filterFieldId) ?? null : null;
  const openFilterFacets: Facet[] = openFilterField
    ? facetsOf(
        openFilterField,
        applyRowFilters(searchedRows, clearFilterFor(filters, openFilterField.id), database),
        displayContext
      )
    : [];
  const sortFields = sortableFieldsOf(database);
  const groupFields = groupableFieldsOf(database);
  const groupField = groupFieldId ? (groupFields.find((f) => f.id === groupFieldId) ?? null) : null;
  const rowGroups = groupField ? groupRows(displayedRows, groupField, displayContext) : [];
  const activeView = savedViews.find((v) => viewMatchesState(v, viewMode, sortPref, filters)) ?? null;
  // What the one parameters button has to say without words: how many of
  // the three are doing something. A sort is always in force, so it only
  // counts when it is not the default one this database opens with.
  const activeParamCount =
    filters.length +
    (groupField ? 1 : 0) +
    (sortPref.field === DEFAULT_ROW_SORT.field && sortPref.dir === DEFAULT_ROW_SORT.dir ? 0 : 1);

  // The overflow chips, in the order the rail gives their buttons up. An
  // empty list means the rail holds everything, and then the header row
  // above the list is not drawn at all.
  const stripChips: {
    key: 'view' | 'views';
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    active: boolean;
  }[] = [
    ...(railPlan.shape
      ? []
      : [{ key: 'view' as const, icon: VIEW_ICONS[viewMode], label: VIEW_LABELS[viewMode], active: false }]),
    ...(railPlan.views
      ? []
      : [
          {
            key: 'views' as const,
            icon: 'bookmark-outline' as const,
            label: activeView ? activeView.name : 'Вигляди',
            active: !!activeView,
          },
        ]),
  ];

  // Only while that chip is actually on the screen. A layout remembered
  // from the last time a button was in the strip would otherwise anchor
  // the list to where a chip no longer is, once the same button moved on
  // to the rail.
  const openChipLayout =
    openParam && stripChips.some((chip) => chip.key === openParam)
      ? chipLayouts[openParam] ?? null
      : null;
  // A chip's onLayout position is relative to the scrolling strip's
  // content, not the screen - undo the current scroll offset to place the
  // overlay under where the chip actually sits right now.
  const openChipScreenX = openChipLayout ? stripXRef.current + openChipLayout.x - scrollXRef.current : 0;
  const selectedRows = rows.filter((r) => selectedIds.has(r.id));
  const rowMenuRow = rowMenuId ? rows.find((r) => r.id === rowMenuId) ?? null : null;
  const rowPageRow = rowPageId ? rows.find((r) => r.id === rowPageId) ?? null : null;

  async function changeViewMode(mode: ViewMode) {
    await setDoc(prefsDoc, { viewMode: mode }, { merge: true });
  }

  // Tapping the field already sorted by flips its direction; tapping a
  // different one switches to it with that field's own sensible default
  // direction - the behaviour useSortPref gave the other screens.
  function selectSortField(field: string) {
    const dir = sortPref.field === field ? (sortPref.dir === 'asc' ? 'desc' : 'asc') : defaultDirFor(field, database);
    setDoc(prefsDoc, { sortField: field, sortDir: dir }, { merge: true });
  }

  function applyFilters(next: RowFilter[]) {
    setDoc(prefsDoc, { rowFilters: next }, { merge: true });
  }

  function selectGroupField(fieldId: string | null) {
    setDoc(prefsDoc, { groupFieldId: fieldId ?? deleteField() }, { merge: true });
    // Deliberately does NOT close: grouping is one tab of a window whose
    // other two tabs stay open after a choice, and closing on this one
    // alone would read as the window falling over.
  }

  function rememberChip(key: string, layout: ChipLayout) {
    setChipLayouts((prev) =>
      prev[key] && prev[key].x === layout.x && prev[key].y === layout.y && prev[key].width === layout.width
        ? prev
        : { ...prev, [key]: { x: layout.x, y: layout.y, width: layout.width } }
    );
  }

  function applySavedView(view: CustomDatabaseView) {
    setDoc(
      prefsDoc,
      { viewMode: view.viewMode, sortField: view.sortField, sortDir: view.sortDir, rowFilters: view.filters ?? [] },
      { merge: true }
    );
    closeParamList();
  }

  async function saveCurrentAsView(name: string) {
    setViewPrompt(null);
    const id = generateId();
    await setDoc(doc(db, 'customDatabaseViews', id), {
      databaseId,
      name: name.trim() || 'Вигляд',
      viewMode,
      sortField: sortPref.field,
      sortDir: sortPref.dir,
      filters,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  async function renameSavedView(view: CustomDatabaseView, name: string) {
    setViewPrompt(null);
    await updateDoc(doc(db, 'customDatabaseViews', view.id), { name: name.trim() || view.name, updatedAt: Date.now() });
  }

  function openSavedViewMenu(view: CustomDatabaseView) {
    ask({
      title: view.name,
      actions: [
        { id: 'rename', label: 'Перейменувати', icon: 'pencil-outline' },
        { id: 'delete', label: 'Видалити', tone: 'danger', icon: 'trash-outline' },
      ],
    }).then((answer) => {
      if (answer === 'rename') setViewPrompt({ mode: 'rename', view });
      if (answer === 'delete') deleteDoc(doc(db, 'customDatabaseViews', view.id));
    });
  }

  function openParamsTab(tab: ParamsTab) {
    setParamsTab(tab);
    setDoc(prefsDoc, { paramsTab: tab }, { merge: true });
    setOpenParam('params');
  }

  function openParamList(key: 'view' | 'views' | 'params') {
    setFilterFieldId(null);
    setOpenParam((prev) => (prev === key ? null : key));
  }

  function closeParamList() {
    setOpenParam(null);
    setFilterFieldId(null);
  }

  async function renameDatabase(name: string) {
    setRenamingDatabase(false);
    await updateDoc(doc(db, 'customDatabases', databaseId), { name, updatedAt: Date.now() });
  }

  async function saveFields(fields: FieldDef[]) {
    setEditingFields(false);
    await updateDoc(doc(db, 'customDatabases', databaseId), { fields, updatedAt: Date.now() });
  }

  // A field, made from inside the record form.
  //
  // This is the shape the whole screen is built around: the "+" opens a
  // small form, and the fields a record needs are added THERE, while the
  // first record is being written. Filling one card is how the database
  // gets its columns - which is what a database is here, rather than a
  // schema to be designed first and filled afterwards.
  //
  // The fields editor stays, and stays the place for what this cannot
  // ask in two taps: a select's options, which one is the cover. This
  // adds the field, its type, and - for a relation - what it points at.
  async function addFieldFromForm() {
    const type = (await ask({
      title: 'Яке поле додати?',
      actions: (['text', 'number', 'date', 'select', 'multiSelect', 'relation'] as FieldType[]).map(
        (id) => ({ id, label: FIELD_TYPE_LABEL[id], icon: FIELD_TYPE_ICON[id] })
      ),
    })) as FieldType | null;
    if (!type) return;

    // A relation has to be told what it relates TO. Without this it fell
    // back to "Фото" - which is why every link made from the form was a
    // picture, whatever it was meant to be.
    if (type === 'relation') {
      const targetId = await ask({
        title: 'З чим повʼязати?',
        actions: [
          { id: 'photos', label: 'Зображення', icon: 'image-outline' },
          { id: 'files', label: 'Файли', icon: 'document-outline' },
          ...(['video', 'geo', 'other'] as LinkCategory[]).map((category) => ({
            id: `link:${category}`,
            label: LINK_CATEGORY_INFO[category].title,
            icon: LINK_CATEGORY_INFO[category].icon,
          })),
          ...otherDatabases.map((odb) => ({
            id: `db:${odb.id}`,
            label: odb.name,
            icon: 'albums-outline' as const,
          })),
        ],
      });
      if (targetId === 'cancel') return;
      const target: RelationTarget =
        targetId === 'photos'
          ? { kind: 'photos' }
          : targetId === 'files'
            ? { kind: 'files' }
            : targetId.startsWith('link:')
              ? { kind: 'links', category: targetId.slice(5) as LinkCategory }
              : { kind: 'customDb', databaseId: targetId.slice(3) };

      const howMany = await ask({
        title: 'Скільки можна вибрати?',
        actions: [
          { id: 'one', label: 'Один', hint: 'Одне значення на запис', icon: 'radio-button-on-outline' },
          { id: 'many', label: 'Декілька', hint: 'Список значень', icon: 'layers-outline' },
        ],
      });
      if (howMany === 'cancel') return;
      setFieldPromptRelation({ target, multiple: howMany === 'many' });
    }
    setFieldPromptType(type);
  }

  async function createField(type: FieldType, name: string) {
    setFieldPromptType(null);
    setFieldPromptRelation(null);
    if (!database) return;
    const field: FieldDef = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      name: name.trim() || FIELD_TYPE_LABEL[type],
      type,
      ...(type === 'relation' && fieldPromptRelation
        ? { relationTarget: fieldPromptRelation.target, multiple: fieldPromptRelation.multiple }
        : {}),
    };
    // Appended, not inserted: the first field is the record's title
    // everywhere in the app (see rowTitleOf), and a new field must never
    // quietly become it.
    await updateDoc(doc(db, 'customDatabases', databaseId), {
      fields: [...database.fields, field],
      updatedAt: Date.now(),
    });
  }

  // A variant typed into a list field's picker. Written to the FIELD, so
  // it stands for every record; the colour follows the same cycle the
  // fields editor uses, so a list built here and one built there look the
  // same.
  async function addFieldOption(fieldId: string, label: string): Promise<string> {
    if (!database) return '';
    const field = database.fields.find((f) => f.id === fieldId);
    if (!field) return '';
    const option = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      label: label.trim(),
      color: TAG_COLORS[(field.options?.length ?? 0) % TAG_COLORS.length],
    };
    await updateDoc(doc(db, 'customDatabases', databaseId), {
      fields: database.fields.map((f) =>
        f.id === fieldId ? { ...f, options: [...(f.options ?? []), option] } : f
      ),
      updatedAt: Date.now(),
    });
    return option.id;
  }

  // Asked through «Питання» now, rather than through a confirmation
  // window this screen drew itself - one of several shapes of "are you
  // sure" the app used to have.
  async function askToDeleteDatabase() {
    const yes = await confirm({
      title: `Видалити базу «${database?.name ?? ''}»?`,
      message: `Усі записи (${rows.length}) буде видалено назавжди.`,
      confirmLabel: 'Видалити',
    });
    if (!yes) return;
    // Shared with the tile board, which can delete a database too - see
    // deleteCustomDatabase for what goes with it.
    await deleteCustomDatabase(databaseId);
    navigation.goBack();
  }

  // The draft row is written to Firestore immediately (empty values), not
  // deferred to "Зберегти" - creating a brand-new tag from inside this form
  // needs a real document to attach its usedIn entry to (createAndAttachTag
  // calls update() on it, which fails outright on a doc that doesn't exist
  // yet). cancelRowEditor cleans this up again if the user backs out.
  // Creates a row in ANOTHER database carrying just its title - what the
  // relation picker's "Створити «X»" offers, so a relation can be filled
  // in with something that isn't in that database yet without leaving this
  // screen. Everything else about the new row stays empty; it's a stub the
  // user can go and flesh out later.
  async function createRelatedRow(targetDatabaseId: string, title: string): Promise<string> {
    const targetDb = relatedDatabases[targetDatabaseId];
    const titleFieldId = targetDb?.fields[0]?.id;
    if (!titleFieldId) return '';
    const id = generateId();
    const now = Date.now();
    await setDoc(doc(db, 'customDatabaseRows', id), {
      databaseId: targetDatabaseId,
      values: { [titleFieldId]: title },
      tagIds: [],
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  // Links an existing row of the source database to the row being edited,
  // by writing that row's own relation field. Unlinking clears the same
  // field. Both are single-field writes on the other row.
  async function linkBacklinkRow(field: FieldDef, sourceRowId: string, myRowId: string) {
    const source = field.backlinkSource;
    if (!source) return;
    await updateDoc(doc(db, 'customDatabaseRows', sourceRowId), {
      [`values.${source.fieldId}`]: myRowId,
      updatedAt: Date.now(),
    });
  }

  async function unlinkBacklinkRow(field: FieldDef, sourceRowId: string) {
    const source = field.backlinkSource;
    if (!source) return;
    await updateDoc(doc(db, 'customDatabaseRows', sourceRowId), {
      [`values.${source.fieldId}`]: deleteField(),
      updatedAt: Date.now(),
    });
  }

  // "Створити «X»" from the backlink side: the new row is born already
  // pointing back here, so it shows up in this list immediately.
  async function createBacklinkRow(field: FieldDef, title: string, myRowId: string): Promise<string> {
    const source = field.backlinkSource;
    if (!source) return '';
    const sourceDb = relatedDatabases[source.databaseId];
    const titleFieldId = sourceDb?.fields[0]?.id;
    if (!titleFieldId) return '';
    const id = generateId();
    const now = Date.now();
    await setDoc(doc(db, 'customDatabaseRows', id), {
      databaseId: source.databaseId,
      values: { [titleFieldId]: title, [source.fieldId]: myRowId },
      tagIds: [],
      createdAt: now,
      updatedAt: now,
    });
    return id;
  }

  // Whether the target database currently carries a 'backlink' field
  // pointing back at this relation - the state of its "показувати з іншого
  // боку" switch.
  function isBacklinkEnabled(field: FieldDef): boolean {
    if (field.relationTarget?.kind !== 'customDb') return false;
    const target = relatedDatabases[field.relationTarget.databaseId];
    return (target?.fields ?? []).some(
      (f) =>
        f.type === 'backlink' &&
        f.backlinkSource?.databaseId === databaseId &&
        f.backlinkSource?.fieldId === field.id
    );
  }

  // Adds or removes that field in the OTHER database. Nothing is written to
  // any ROW either way: a backlink is computed from the relation values
  // that already exist, so switching it off is just as free as switching
  // it on, and can't strand data.
  async function toggleBacklink(field: FieldDef, enabled: boolean) {
    if (field.relationTarget?.kind !== 'customDb') return;
    const targetId = field.relationTarget.databaseId;
    const target = relatedDatabases[targetId];
    if (!target) return;
    const without = target.fields.filter(
      (f) =>
        !(
          f.type === 'backlink' &&
          f.backlinkSource?.databaseId === databaseId &&
          f.backlinkSource?.fieldId === field.id
        )
    );
    const next: FieldDef[] = enabled
      ? [
          ...without,
          {
            id: generateId(),
            // Named after THIS database, the way Notion names the reverse
            // property after the related one.
            name: database?.name || 'Зворотні',
            type: 'backlink',
            backlinkSource: { databaseId, fieldId: field.id },
          },
        ]
      : without;
    await updateDoc(doc(db, 'customDatabases', targetId), { fields: next, updatedAt: Date.now() });
  }

  async function openNewRow() {
    const id = generateId();
    const now = Date.now();
    await setDoc(doc(db, 'customDatabaseRows', id), {
      databaseId,
      values: {},
      tagIds: [],
      createdAt: now,
      updatedAt: now,
    });
    setDraftValues({});
    setDraftTagIds([]);
    setRowEditor({ mode: 'new', id });
  }

  function openEditRow(row: CustomDatabaseRow) {
    setDraftValues(row.values);
    setDraftTagIds(row.tagIds ?? []);
    setRowEditor({ mode: 'edit', row });
    setRowMenuId(null);
  }

  function cancelRowEditor() {
    if (rowEditor?.mode === 'new') deleteDoc(doc(db, 'customDatabaseRows', rowEditor.id));
    setRowEditor(null);
  }

  async function saveRow() {
    if (!rowEditor) return;
    const now = Date.now();
    const id = rowEditor.mode === 'new' ? rowEditor.id : rowEditor.row.id;
    await updateDoc(doc(db, 'customDatabaseRows', id), {
      values: draftValues,
      tagIds: draftTagIds,
      updatedAt: now,
    });
    hapticSuccess();
    setRowEditor(null);
  }

  // Which documents embed this row as a card - the reverse of the
  // 'dbRow' block writing usedInDocuments when it's inserted. One
  // document opens straight away; several ask which, same as a file or
  // photo used in more than one place.
  function documentIdsOf(row: CustomDatabaseRow): string[] {
    return Object.keys(row.usedInDocuments ?? {});
  }

  async function openRowDocuments(row: CustomDatabaseRow) {
    setRowMenuId(null);
    const ids = documentIdsOf(row);
    if (ids.length === 0) return;
    if (ids.length === 1) {
      navigation.navigate('Editor', { documentId: ids[0] });
      return;
    }
    const documents = await Promise.all(
      ids.map(async (id) => {
        const snapshot = await getDoc(doc(db, 'documents', id));
        return { id, title: (snapshot.data()?.title as string) || 'Без назви' };
      })
    );
    setDocumentPicker({ row, documents });
  }

  async function deleteRow(row: CustomDatabaseRow) {
    await deleteDoc(doc(db, 'customDatabaseRows', row.id));
    await Promise.all(
      (row.tagIds ?? []).map((tagId) => {
        const tag = tags.find((t) => t.id === tagId);
        return tag ? detachTagFromDeletedItem(tag, customRowKind, row.id) : Promise.resolve();
      })
    );
  }

  function confirmDeleteSelected() {
    const toDelete = selectedRows;
    requestDeleteMany(toDelete, `Видалено записів: ${toDelete.length}`, () => {
      toDelete.forEach(deleteRow);
    });
    clearSelection();
  }

  async function bulkAttachTag(tag: Parameters<typeof attachTag>[0]) {
    setBulkTagPickerVisible(false);
    await Promise.all(selectedRows.map((r) => attachTag(tag, customRowKind, r.id, 'customDatabaseRows')));
    clearSelection();
  }

  async function bulkCreateAndAttachTag(path: string, icon: string, color: string) {
    setBulkTagPickerVisible(false);
    await Promise.all(
      selectedRows.map((r) => createAndAttachTag(path, icon, color, customRowKind, r.id, 'customDatabaseRows'))
    );
    clearSelection();
  }

  async function bulkAssignGroup(groupId: string | null) {
    setBulkGroupPickerVisible(false);
    const batch = writeBatch(db);
    selectedRows.forEach((r) => batch.update(doc(db, 'customDatabaseRows', r.id), { groupId: groupId ?? deleteField() }));
    await batch.commit();
    clearSelection();
  }

  function setDraftValue(fieldId: string, value: string | number | string[]) {
    setDraftValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  // Writes a single cell straight to its row, by nested field path, so
  // editing one value never rewrites the rest of the row's `values` map.
  async function writeRowValue(rowId: string, fieldId: string, value: string | number | string[]) {
    await updateDoc(doc(db, 'customDatabaseRows', rowId), {
      [`values.${fieldId}`]: value,
      updatedAt: Date.now(),
    });
  }

  function beginCellEdit(row: CustomDatabaseRow, field: FieldDef) {
    if (isSelectMode) {
      toggleSelected(row.id);
      return;
    }
    setCellPicker({ rowId: row.id, field });
  }

  function commitCellText(row: CustomDatabaseRow, field: FieldDef, text: string) {
    const value = field.type === 'number' ? (text.trim() === '' ? '' : Number(text.replace(',', '.')) || 0) : text;
    // Leaving a cell without having changed it shouldn't cost a write (and
    // shouldn't bump the row's updatedAt, which drives the default sort).
    if (String(row.values[field.id] ?? '') === String(value)) return;
    writeRowValue(row.id, field.id, value);
  }

  function displayValue(field: FieldDef, value: string | number | string[] | undefined): string {
    return displayFieldValue(field, value, displayContext);
  }

  // The row currently open in the form. A brand-new row is written to
  // Firestore before the form opens (see openNewRow), so it already has a
  // real id - which is what lets backlinks work while creating, not only
  // while editing.
  const editingRowId = rowEditor ? (rowEditor.mode === 'new' ? rowEditor.id : rowEditor.row.id) : null;

  function renderFieldInput(field: FieldDef) {
    const value = draftValues[field.id];
    if (field.type === 'section') return null;
    if (field.type === 'backlink') {
      const linked = editingRowId ? resolveBacklinkRows(field, editingRowId, displayContext) : [];
      const sourceDb = field.backlinkSource ? relatedDatabases[field.backlinkSource.databaseId] : undefined;
      return (
        <View style={styles.backlinkList}>
          {linked.map((r) => (
            <View key={r.id} style={styles.backlinkRow}>
              <Text style={styles.backlinkRowLabel} numberOfLines={1}>
                {rowTitleOf(sourceDb, r)}
              </Text>
              <Pressable
                hitSlop={8}
                onPress={() => unlinkBacklinkRow(field, r.id).catch(() => {})}
              >
                <Ionicons name="close" size={16} color={GLASS_TEXT_FAINT} />
              </Pressable>
            </View>
          ))}
          <Pressable style={styles.backlinkAddRow} onPress={() => setBacklinkPickerFieldId(field.id)}>
            <Ionicons name="add" size={16} color={ACCENT} />
            <Text style={styles.backlinkAddLabel}>Додати</Text>
          </Pressable>
        </View>
      );
    }
    if (field.type === 'text') {
      return (
        <TextInput
          style={styles.fieldInput}
          value={typeof value === 'string' ? value : ''}
          onChangeText={(text) => setDraftValue(field.id, text)}
          placeholder={field.name}
          placeholderTextColor={GLASS_TEXT_FAINT}
        />
      );
    }
    if (field.type === 'number') {
      return (
        <TextInput
          style={styles.fieldInput}
          value={value !== undefined ? String(value) : ''}
          onChangeText={(text) => setDraftValue(field.id, text === '' ? '' : Number(text.replace(',', '.')) || 0)}
          keyboardType="numeric"
          placeholder={field.name}
          placeholderTextColor={GLASS_TEXT_FAINT}
        />
      );
    }
    if (field.type === 'date') {
      return (
        <Pressable style={styles.fieldPressable} onPress={() => setDatePickerFieldId(field.id)}>
          <Text style={value ? styles.fieldPressableValue : styles.fieldPressablePlaceholder}>
            {value ? displayValue(field, value) : 'Обрати дату'}
          </Text>
          <Ionicons name="calendar-outline" size={16} color={GLASS_TEXT_FAINT} />
        </Pressable>
      );
    }
    if (field.type === 'relation' && field.multiple) {
      const resolvedList = resolveRelationList(field, value, displayContext);
      return (
        <Pressable style={styles.fieldPressable} onPress={() => setRelationPickerFieldId(field.id)}>
          {resolvedList.length > 0 ? (
            <View style={styles.galleryThumbs}>
              {resolvedList.slice(0, 4).map((item, i) =>
                item.thumbUri ? (
                  <RelationThumb key={`${item.label}-${i}`} uri={item.thumbUri} driveFileId={item.driveFileId} size={34} radius={8} />
                ) : null
              )}
              {resolvedList.length > 4 && <Text style={styles.fieldPressableValue}>+{resolvedList.length - 4}</Text>}
            </View>
          ) : (
            <Text style={styles.fieldPressablePlaceholder}>Обрати</Text>
          )}
          <Ionicons name="chevron-down" size={16} color={GLASS_TEXT_FAINT} />
        </Pressable>
      );
    }
    if (field.type === 'relation') {
      const resolved = typeof value === 'string' ? resolveRelation(field, value) : null;
      return (
        <Pressable style={styles.fieldPressable} onPress={() => setRelationPickerFieldId(field.id)}>
          {resolved ? (
            <View style={styles.relationValueRow}>
              {resolved.thumbUri && <RelationThumb uri={resolved.thumbUri} driveFileId={resolved.driveFileId} size={28} />}
              <Text style={styles.fieldPressableValue} numberOfLines={1}>
                {resolved.label}
              </Text>
            </View>
          ) : (
            <Text style={styles.fieldPressablePlaceholder}>Обрати</Text>
          )}
          <Ionicons name="chevron-down" size={16} color={GLASS_TEXT_FAINT} />
        </Pressable>
      );
    }
    // select / multiSelect
    const selectedIdsForField = field.type === 'multiSelect' ? (Array.isArray(value) ? value : []) : value ? [value as string] : [];
    return (
      <Pressable style={styles.fieldPressable} onPress={() => setSelectPickerFieldId(field.id)}>
        {selectedIdsForField.length > 0 ? (
          <View style={styles.optionChipsRow}>
            {selectedIdsForField.map((id) => {
              const option = field.options?.find((o) => o.id === id);
              if (!option) return null;
              return (
                <View key={id} style={[styles.optionChip, { backgroundColor: `${option.color}22` }]}>
                  <Text style={[styles.optionChipLabel, { color: option.color }]}>{option.label}</Text>
                </View>
              );
            })}
          </View>
        ) : (
          <Text style={styles.fieldPressablePlaceholder}>Обрати</Text>
        )}
        <Ionicons name="chevron-down" size={16} color={GLASS_TEXT_FAINT} />
      </Pressable>
    );
  }

  const datePickerField = database.fields.find((f) => f.id === datePickerFieldId) ?? null;
  const selectPickerField = database.fields.find((f) => f.id === selectPickerFieldId) ?? null;
  const relationPickerField = database.fields.find((f) => f.id === relationPickerFieldId) ?? null;
  const backlinkPickerField = database.fields.find((f) => f.id === backlinkPickerFieldId) ?? null;

  function renderRowCard(item: CustomDatabaseRow) {
    const { text, textMuted } = colorForDocument(item.id);
    return (
      <CustomRowCard
        key={item.id}
        rowId={item.id}
        display={buildRowDisplay(database, item, displayContext)}
        tags={tags.filter((t) => (item.tagIds ?? []).includes(t.id))}
        documentCount={documentIdsOf(item).length}
        onPress={() => (isSelectMode ? toggleSelected(item.id) : setRowPageId(item.id))}
        onLongPress={() => setRowMenuId(item.id)}
        right={
          isSelectMode ? (
            <Pressable hitSlop={8} onPress={() => toggleSelected(item.id)} style={styles.rowActionButton}>
              <Ionicons
                name={selectedIds.has(item.id) ? 'checkmark-circle' : 'ellipse-outline'}
                size={22}
                color={selectedIds.has(item.id) ? text : textMuted}
              />
            </Pressable>
          ) : (
            <Pressable hitSlop={8} onPress={() => setRowMenuId(item.id)} style={styles.rowActionButton}>
              <Ionicons name="ellipsis-horizontal" size={16} color={textMuted} />
            </Pressable>
          )
        }
      />
    );
  }

  // The first field stays put while the rest scroll sideways, and the header
  // stays put while rows scroll down - a spreadsheet's two fixed edges. That
  // needs the table split in two: a frozen left block (row button + first
  // field) and a horizontally scrolling block holding EVERY row's remaining
  // cells as one stack, so one scroll offset moves all rows together. The
  // header's own scroller is driven from the body's offset (and is itself
  // scrollEnabled={false}), which keeps them in lockstep with no feedback
  // loop between two scrollables.
  function renderTable() {
    // The title column always shows (it's the row's name); the rest drop
    // out when hidden, header and cells alike - same setting that hides
    // them from the list and the cards.
    const fields = database!.fields;
    const firstField = fields[0];
    const restFields = visibleFieldsOf(database).filter((f) => f.id !== firstField?.id);
    const titleWidth = titleColumnWidth(displayedRows.map(titleOf), windowWidth);
    return (
      <View style={styles.tableWrap}>
        <View style={styles.tableHeaderRow}>
          <View style={[styles.tableFrozenHeader, { width: TABLE_HANDLE_WIDTH + titleWidth }]}>
            <View style={styles.tableRowHandle} />
            <View style={[styles.tableHeaderCell, { width: titleWidth }]}>
              <Ionicons name={FIELD_TYPE_ICON[firstField.type]} size={12} color="rgba(255,255,255,0.65)" />
              <Text style={styles.tableHeaderLabel} numberOfLines={1}>
                {firstField.name}
              </Text>
            </View>
          </View>
          <ScrollView horizontal ref={headerScrollRef} scrollEnabled={false} showsHorizontalScrollIndicator={false}>
            {restFields.map((field) => (
              <View key={field.id} style={[styles.tableHeaderCell, { width: TABLE_COLUMN_WIDTH }]}>
                <Ionicons name={FIELD_TYPE_ICON[field.type]} size={12} color="rgba(255,255,255,0.65)" />
                <Text style={styles.tableHeaderLabel} numberOfLines={1}>
                  {field.name}
                </Text>
              </View>
            ))}
          </ScrollView>
        </View>

        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.tableBody}>
          <View style={styles.tableBodyRow}>
            <View style={[styles.tableFrozenColumn, { width: TABLE_HANDLE_WIDTH + titleWidth }]}>
              {displayedRows.map((row) => (
                <View key={row.id} style={styles.tableRow}>
                  {/* Tapping a cell edits that one cell; this button is the
                      way to open the whole row as a card, per the user's own
                      "a cell for one value, the card when I want them all". */}
                  <Pressable
                    style={styles.tableRowHandle}
                    onPress={() => (isSelectMode ? toggleSelected(row.id) : setRowPageId(row.id))}
                    onLongPress={() => setRowMenuId(row.id)}
                  >
                    <Ionicons
                      name={
                        isSelectMode
                          ? selectedIds.has(row.id)
                            ? 'checkmark-circle'
                            : 'ellipse-outline'
                          : 'open-outline'
                      }
                      size={16}
                      color="rgba(255,255,255,0.75)"
                    />
                  </Pressable>
                  {renderTableCell(row, firstField, titleWidth)}
                </View>
              ))}
            </View>

            <ScrollView
              horizontal
              ref={bodyScrollRef}
              keyboardShouldPersistTaps="handled"
              scrollEventThrottle={16}
              onScroll={(e) =>
                headerScrollRef.current?.scrollTo({ x: e.nativeEvent.contentOffset.x, animated: false })
              }
            >
              <View>
                {displayedRows.map((row) => (
                  <View key={row.id} style={styles.tableRow}>
                    {restFields.map((field) => renderTableCell(row, field))}
                  </View>
                ))}
              </View>
            </ScrollView>
          </View>
        </ScrollView>
      </View>
    );
  }

  function renderTableCell(row: CustomDatabaseRow, field: FieldDef, width: number = TABLE_COLUMN_WIDTH) {
    const raw = row.values[field.id];
    // Text/number cells are live inputs rather than a tap-to-swap Pressable:
    // swapping the component on tap remounted it mid-layout, which is what
    // threw the horizontal scroll back to the first column. Uncontrolled
    // (defaultValue + commit when editing ends) so typing doesn't write on
    // every keystroke; the key re-seeds it if the stored value changes.
    if (!isSelectMode && (field.type === 'text' || field.type === 'number')) {
      const asText = raw === undefined || raw === null ? '' : String(raw);
      return (
        <TextInput
          key={`${field.id}:${asText}`}
          style={[styles.tableCellInput, { width }]}
          defaultValue={asText}
          placeholder="—"
          placeholderTextColor="rgba(255,255,255,0.3)"
          keyboardType={field.type === 'number' ? 'numeric' : 'default'}
          returnKeyType="done"
          onEndEditing={(e) => commitCellText(row, field, e.nativeEvent.text)}
        />
      );
    }
    // A backlink holds nothing of its own and is edited from the row form
    // (where the other side's rows can actually be picked), so the table
    // shows how many point here and doesn't open a picker on tap - the
    // generic branch below would otherwise offer an option list with no
    // options in it.
    if (field.type === 'backlink') {
      const count = resolveBacklinkRows(field, row.id, displayContext).length;
      return (
        <View key={field.id} style={[styles.tableCellTap, { width }]}>
          <Text style={count ? styles.tableCell : styles.tableCellEmpty} numberOfLines={1}>
            {count || '—'}
          </Text>
        </View>
      );
    }
    if (field.type === 'relation' && field.multiple) {
      const count = resolveRelationList(field, raw, displayContext).length;
      return (
        <Pressable
          key={field.id}
          style={[styles.tableCellTap, { width }]}
          onPress={() => beginCellEdit(row, field)}
        >
          <Text style={count ? styles.tableCell : styles.tableCellEmpty} numberOfLines={1}>
            {count || '—'}
          </Text>
        </Pressable>
      );
    }
    if (field.type === 'relation') {
      const resolved = typeof raw === 'string' ? resolveRelation(field, raw) : null;
      return (
        <Pressable
          key={field.id}
          style={[styles.tableCellTap, styles.tableCellRelation, { width }]}
          onPress={() => beginCellEdit(row, field)}
        >
          {resolved?.thumbUri && <RelationThumb uri={resolved.thumbUri} driveFileId={resolved.driveFileId} size={22} radius={5} />}
          <Text style={resolved ? styles.tableCell : styles.tableCellEmpty} numberOfLines={1}>
            {resolved?.label || '—'}
          </Text>
        </Pressable>
      );
    }
    const shown = displayValue(field, raw);
    return (
      <Pressable
        key={field.id}
        style={[styles.tableCellTap, { width }]}
        onPress={() => beginCellEdit(row, field)}
      >
        <Text style={shown ? styles.tableCell : styles.tableCellEmpty} numberOfLines={1}>
          {shown || '—'}
        </Text>
      </Pressable>
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
          <LinearGradient id="customDbBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.03" stopColor="#705648" />
            <Stop offset="0.52" stopColor="#69736E" />
            <Stop offset="1" stopColor="#000000" />
          </LinearGradient>
        </Defs>
        <Rect width={windowWidth + 2} height={windowHeight + 2} fill="url(#customDbBg)" />
      </Svg>

      {/* No title, no arrow in the corner: the capsule holds the way out,
          the tile the user came from said the name, and the row cost the
          records a screenful. What is left of the header is the line the
          tabs start on - the same one as every other database. */}
      <View style={{ height: railInsets.top + CHROME_TOP + 8 }} />

      {/* The rail, as on every other screen. */}
      {railFocused && (
        <GlassPortal>
          <View
            style={[styles.railWrap, { top: railInsets.top + CHROME_TOP + CAPSULE_DROP }]}
            pointerEvents="box-none"
          >
            <GlassDrop style={styles.headerButtons}>
              <Pressable
                hitSlop={8}
                onPress={() => {
                  // While selecting, this is the way out of it - see the
                  // same button on the shared chrome.
                  if (isSelectMode) {
                    toggleSelectMode();
                    return;
                  }
                  // Closing the search clears it too - leaving a filter
                  // applied behind a hidden input is how a database looks
                  // half-empty for no visible reason.
                  setIsSearching((prev) => {
                    if (prev) setSearchQuery('');
                    return !prev;
                  });
                }}
              >
                <Ionicons
                  name={isSelectMode || isSearching ? 'close-outline' : 'search-outline'}
                  size={24}
                  color="#fff"
                />
              </Pressable>
              <View style={styles.headerButtonsDivider} />
              <Pressable hitSlop={8} onPress={() => setMenuOpen((v) => !v)}>
                <Ionicons name="ellipsis-horizontal-outline" size={24} color="#fff" />
              </Pressable>
              <View style={styles.headerButtonsDivider} />
              {/* The way out of this database - the same place it is on
                  every other one. */}
              <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
                <Ionicons name="arrow-back-outline" size={24} color="#fff" />
              </Pressable>
            </GlassDrop>
          </View>
        </GlassPortal>
      )}

      {/* The tabs have this row to themselves now that the capsule stands
          on the rail. */}
      <View style={styles.controlsRow}>
        {groups.length > 0 ? (
          <ProjectTabsRow
            items={groups}
            selected={groupFilter}
            onSelect={setGroupFilter}
            unassignedLabel="Без групи"
            dark
            endPadding={RAIL_CLEARANCE}
          />
        ) : (
          <View style={styles.controlsSpacer} />
        )}
      </View>

      <Menu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        style={{ position: 'absolute', top: 96, right: 20 }}
        entries={[
          // View and sort live in the capsule strip below the header, not
          // here: they're changed constantly while working, and a menu
          // can't show which one is active without being opened. What's
          // left is the rare, per-database housekeeping.
          { label: 'Перейменувати базу', icon: 'pencil-outline', onPress: () => setRenamingDatabase(true) },
          { label: 'Поля', icon: 'options-outline', onPress: () => setEditingFields(true) },
          { label: 'Імпортувати таблицю', icon: 'download-outline', onPress: () => setImporting(true) },
          { label: 'Видалити базу', icon: 'trash-outline', tone: 'danger', onPress: askToDeleteDatabase },
          { kind: 'rule' },
          {
            label: isSelectMode ? 'Скасувати вибір' : 'Вибрати',
            icon: isSelectMode ? 'close-outline' : 'checkmark-circle-outline',
            onPress: toggleSelectMode,
          },
        ]}
      />

      {/* What the rail could not hold. Every chip here is a button that
          did not fit on it, in the same order the ladder above gives them
          up - and when the rail holds everything this row is not drawn at
          all, which is the header the user asked to get back. */}
      {stripChips.length > 0 && (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          // Frozen while a list is open: a horizontal drag meant to scroll
          // an open dropdown's own vertical list would otherwise also
          // carry the strip sideways underneath it, and the list's anchor
          // is only ever recomputed at the moment it opens.
          scrollEnabled={openParam === null}
          onScroll={(e) => {
            scrollXRef.current = e.nativeEvent.contentOffset.x;
          }}
          scrollEventThrottle={16}
          style={styles.paramsScroll}
          contentContainerStyle={[styles.paramsStrip, railClear(railSide, 20)]}
          onLayout={(e) => {
            setStripY(e.nativeEvent.layout.y);
            stripXRef.current = e.nativeEvent.layout.x;
          }}
        >
          {stripChips.map((chip) => (
            <Pressable
              key={chip.key}
              style={[styles.paramChip, chip.active && styles.paramChipActive]}
              onLayout={(e) => rememberChip(chip.key, e.nativeEvent.layout)}
              onPress={() => openParamList(chip.key)}
            >
              <Ionicons name={chip.icon} size={13} color="rgba(255,255,255,0.85)" />
              <Text style={styles.paramChipLabel} numberOfLines={1}>
                {chip.label}
              </Text>
              <Ionicons name="chevron-down" size={12} color="rgba(255,255,255,0.6)" />
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* An open list is drawn HERE, over the whole screen, rather than
          inside the capsule it belongs to - even though it's positioned to
          look like it grows straight out of that capsule.

          It has to be: the capsule's own row is one pill tall, and Android
          only dispatches a touch to a view whose ANCESTORS all contain the
          touch point. A list hanging below a 44px-tall row is outside them,
          so its ScrollView never saw the drag and refused to scroll -
          while taps kept working, because React Native hit-tests those
          against its own tree instead of Android's bounds. Anchored to the
          capsule's measured position, so it still reads as the capsule
          stretching downward. */}
      {(openParam === 'view' || openParam === 'views') && (
        <View style={styles.paramOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeParamList} />
          <View
            style={[
              styles.paramExpanded,
              // Opened from a chip in the strip: under that chip. Opened
              // from the rail, where these two have no chip: beside the
              // button that opened it.
              openChipLayout
                ? [
                    { top: stripY + openChipLayout.y, minWidth: openChipLayout.width, left: openChipScreenX },
                  ]
                : { bottom: rail.actionsBottom, right: RAIL_CLEARANCE, minWidth: 220 },
            ]}
          >
            {openParam === 'views' && (
              <>
                <Pressable style={styles.paramExpandedHead} onPress={closeParamList}>
                  <Ionicons name="bookmark-outline" size={13} color="#fff" />
                  <Text style={styles.paramChipLabel} numberOfLines={1}>
                    {activeView ? activeView.name : 'Вигляди'}
                  </Text>
                  <Ionicons name="chevron-up" size={12} color="rgba(255,255,255,0.6)" />
                </Pressable>
                <View style={styles.paramScrollWrap}>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                    {savedViews.map((view) => {
                      const active = activeView?.id === view.id;
                      return (
                        <Pressable
                          key={view.id}
                          style={styles.paramOption}
                          onPress={() => applySavedView(view)}
                          onLongPress={() => openSavedViewMenu(view)}
                        >
                          <Ionicons
                            name={VIEW_ICONS[view.viewMode]}
                            size={14}
                            color={active ? '#fff' : 'rgba(255,255,255,0.7)'}
                          />
                          <Text
                            style={[styles.paramOptionLabel, active && styles.paramOptionLabelActive]}
                            numberOfLines={1}
                          >
                            {view.name}
                          </Text>
                          {(view.filters?.length ?? 0) > 0 && (
                            <Ionicons name="funnel" size={11} color="rgba(255,255,255,0.45)" />
                          )}
                          {active && <Ionicons name="checkmark" size={14} color="#fff" />}
                        </Pressable>
                      );
                    })}
                    {savedViews.length > 0 && <View style={styles.paramDivider} />}
                    {/* Saving is disabled while a view already matches -
                        there would be nothing new to save, and two views
                        with the same contents can't be told apart. */}
                    <Pressable
                      style={styles.paramOption}
                      disabled={!!activeView}
                      onPress={() => {
                        closeParamList();
                        setViewPrompt({ mode: 'new' });
                      }}
                    >
                      <Ionicons
                        name="add-circle-outline"
                        size={15}
                        color={activeView ? 'rgba(255,255,255,0.3)' : ACCENT}
                      />
                      <Text
                        style={[
                          styles.paramOptionLabel,
                          { color: activeView ? 'rgba(255,255,255,0.3)' : ACCENT },
                        ]}
                      >
                        Зберегти поточний
                      </Text>
                    </Pressable>
                  </ScrollView>
                </View>
              </>
            )}

            {openParam === 'view' && (
              <>
                <Pressable style={styles.paramExpandedHead} onPress={closeParamList}>
                  <Ionicons name={VIEW_ICONS[viewMode]} size={13} color="#fff" />
                  <Text style={styles.paramChipLabel} numberOfLines={1}>
                    {VIEW_LABELS[viewMode]}
                  </Text>
                  <Ionicons name="chevron-up" size={12} color="rgba(255,255,255,0.6)" />
                </Pressable>
                <View style={styles.paramScrollWrap}>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                    {(['list', 'cards', 'table'] as ViewMode[]).map((mode) => (
                      <Pressable
                        key={mode}
                        style={styles.paramOption}
                        onPress={() => {
                          changeViewMode(mode);
                          closeParamList();
                        }}
                      >
                        <Ionicons
                          name={VIEW_ICONS[mode]}
                          size={14}
                          color={viewMode === mode ? '#fff' : 'rgba(255,255,255,0.7)'}
                        />
                        <Text style={[styles.paramOptionLabel, viewMode === mode && styles.paramOptionLabelActive]}>
                          {VIEW_LABELS[mode]}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </View>
              </>
            )}

          </View>
        </View>
      )}

      {/* Sorting, filtering and grouping, in one window with three tabs.
          They were three buttons on the rail and three lists hanging off
          it; the user's own reading was that they are one family - all
          three change the same list - and that the shape for that is the
          window this app already uses, a smaller screen in the middle of
          the screen.

          The window remembers its tab per database, so the common case is
          one tap and no thinking. Filtering keeps its two levels inside
          its own tab: fields, then that field's values, with the back
          step in the tab's own header rather than the window's. */}
      <GlassLayer visible={openParam === 'params'} onClose={closeParamList}>
        <View style={styles.layerBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeParamList} />
          <View style={[styles.paramsSheet, { maxHeight: Math.min(windowHeight * 0.6, 520) }]}>
            <View style={styles.paramsTabs}>
              {(
                [
                  { key: 'sort' as const, icon: 'swap-vertical-outline' as const, label: 'Сортування' },
                  { key: 'filter' as const, icon: 'funnel-outline' as const, label: 'Фільтр' },
                  { key: 'group' as const, icon: 'layers-outline' as const, label: 'Групування' },
                ] as const
              )
                // A tab for something this database cannot do would be a
                // tab that opens an empty list.
                .filter((tab) =>
                  tab.key === 'filter' ? filterFields.length > 0 : tab.key === 'group' ? groupFields.length > 0 : true
                )
                .map((tab) => (
                  <Pressable
                    key={tab.key}
                    style={[styles.paramsTab, paramsTab === tab.key && styles.paramsTabActive]}
                    onPress={() => openParamsTab(tab.key)}
                  >
                    <Ionicons
                      name={tab.icon}
                      size={14}
                      color={paramsTab === tab.key ? '#fff' : 'rgba(255,255,255,0.55)'}
                    />
                    <Text
                      style={[styles.paramsTabLabel, paramsTab === tab.key && styles.paramsTabLabelActive]}
                      numberOfLines={1}
                    >
                      {tab.label}
                    </Text>
                  </Pressable>
                ))}
              <Pressable hitSlop={8} style={styles.paramsClose} onPress={closeParamList}>
                <Ionicons name="close" size={18} color="rgba(255,255,255,0.7)" />
              </Pressable>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled" style={styles.paramsBody}>
              {paramsTab === 'sort' && (
                <>
                  {BUILT_IN_SORT_FIELDS.map((field) => (
                    <SortOption
                      key={field}
                      label={BUILT_IN_SORT_LABELS[field]}
                      active={sortPref.field === field}
                      dir={sortPref.dir}
                      onPress={() => selectSortField(field)}
                    />
                  ))}
                  {/* The database's own fields continue the same list under
                      a divider - sorting by "Дата зйомки" is the same kind
                      of choice as sorting by "Змінено", just not one every
                      database has. */}
                  {sortFields.length > 0 && <View style={styles.paramDivider} />}
                  {sortFields.map((field) => (
                    <SortOption
                      key={field.id}
                      label={field.name}
                      icon={FIELD_TYPE_ICON[field.type]}
                      active={sortPref.field === field.id}
                      dir={sortPref.dir}
                      onPress={() => selectSortField(field.id)}
                    />
                  ))}
                </>
              )}

              {paramsTab === 'group' && (
                <>
                  <Pressable style={styles.paramOption} onPress={() => selectGroupField(null)}>
                    <Text style={[styles.paramOptionLabel, !groupField && styles.paramOptionLabelActive]}>
                      Без групування
                    </Text>
                    {!groupField && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </Pressable>
                  {groupFields.map((field) => (
                    <Pressable key={field.id} style={styles.paramOption} onPress={() => selectGroupField(field.id)}>
                      <Ionicons
                        name={FIELD_TYPE_ICON[field.type]}
                        size={14}
                        color={groupField?.id === field.id ? '#fff' : 'rgba(255,255,255,0.7)'}
                      />
                      <Text
                        style={[
                          styles.paramOptionLabel,
                          groupField?.id === field.id && styles.paramOptionLabelActive,
                        ]}
                        numberOfLines={1}
                      >
                        {field.name}
                      </Text>
                      {groupField?.id === field.id && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </Pressable>
                  ))}
                </>
              )}

              {paramsTab === 'filter' && (
                <>
                  {openFilterField && (
                    <Pressable style={styles.paramsBack} onPress={() => setFilterFieldId(null)}>
                      <Ionicons name="chevron-back" size={14} color="#fff" />
                      <Text style={styles.paramsBackLabel} numberOfLines={1}>
                        {openFilterField.name}
                      </Text>
                    </Pressable>
                  )}
                  {!openFilterField &&
                    filterFields.map((field) => {
                      const active = activeFilterFor(filters, field.id);
                      return (
                        <Pressable key={field.id} style={styles.paramOption} onPress={() => setFilterFieldId(field.id)}>
                          <Ionicons
                            name={FIELD_TYPE_ICON[field.type]}
                            size={14}
                            color={active ? '#fff' : 'rgba(255,255,255,0.7)'}
                          />
                          <Text style={[styles.paramOptionLabel, !!active && styles.paramOptionLabelActive]}>
                            {field.name}
                          </Text>
                          {!!active && (
                            <Text style={styles.paramOptionCount}>
                              {active.op === 'filled' ? '≠∅' : active.op === 'empty' ? '∅' : active.values?.length}
                            </Text>
                          )}
                          <Ionicons name="chevron-forward" size={13} color="rgba(255,255,255,0.45)" />
                        </Pressable>
                      );
                    })}
                  {openFilterField && (
                    <>
                      {openFilterFacets.map((facet) => {
                        const active = activeFilterFor(filters, openFilterField.id);
                        const on = active?.op === 'any' && (active.values ?? []).includes(facet.key);
                        return (
                          <Pressable
                            key={facet.key}
                            style={styles.paramOption}
                            onPress={() => applyFilters(toggleFacet(filters, openFilterField.id, facet.key))}
                          >
                            <Ionicons
                              name={on ? 'checkbox' : 'square-outline'}
                              size={15}
                              color={on ? '#fff' : 'rgba(255,255,255,0.5)'}
                            />
                            <Text style={[styles.paramOptionLabel, on && styles.paramOptionLabelActive]} numberOfLines={1}>
                              {facet.label}
                            </Text>
                            <Text style={styles.paramOptionCount}>{facet.count}</Text>
                          </Pressable>
                        );
                      })}
                      <View style={styles.paramDivider} />
                      {(['filled', 'empty'] as const).map((op) => {
                        const on = activeFilterFor(filters, openFilterField.id)?.op === op;
                        return (
                          <Pressable
                            key={op}
                            style={styles.paramOption}
                            onPress={() => applyFilters(setPresenceOp(filters, openFilterField.id, op))}
                          >
                            <Ionicons
                              name={on ? 'radio-button-on' : 'radio-button-off'}
                              size={15}
                              color={on ? '#fff' : 'rgba(255,255,255,0.5)'}
                            />
                            <Text style={[styles.paramOptionLabel, on && styles.paramOptionLabelActive]}>
                              {op === 'filled' ? 'Заповнено' : 'Порожньо'}
                            </Text>
                          </Pressable>
                        );
                      })}
                      {!!activeFilterFor(filters, openFilterField.id) && (
                        <Pressable
                          style={styles.paramOption}
                          onPress={() => applyFilters(clearFilterFor(filters, openFilterField.id))}
                        >
                          <Ionicons name="close-circle-outline" size={15} color={DANGER} />
                          <Text style={[styles.paramOptionLabel, { color: DANGER }]}>Скинути</Text>
                        </Pressable>
                      )}
                    </>
                  )}
                </>
              )}
            </ScrollView>
          </View>
        </View>
      </GlassLayer>

      {isSearching && (
        <View style={styles.searchRow}>
          <Ionicons name="search" size={14} color="#9CA3AF" />
          <TextInput
            autoFocus
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Пошук у базі"
            placeholderTextColor={GLASS_TEXT_FAINT}
            style={styles.searchInput}
          />
        </View>
      )}

      {isLoading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : displayedRows.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name={readError ? 'lock-closed-outline' : 'grid-outline'} size={32} color={ACCENT} />
          </View>
          <Text style={styles.emptyLabel}>
            {readError ? 'Не вдалося прочитати записи' : needle ? 'Нічого не знайдено' : 'Ще немає записів'}
          </Text>
          <Text style={styles.emptyHint}>
            {readError
              ? readError
              : needle
                ? 'Спробуйте інше слово'
                : 'Натисніть "+", щоб додати перший запис'}
          </Text>
        </View>
      ) : viewMode === 'table' ? (
        renderTable()
      ) : viewMode === 'cards' ? (
        <ScrollView
          contentContainerStyle={[styles.cardGrid, railClear(railSide, CARD_GRID_PADDING), isSelectMode && styles.listWithBulkBar]}
        >
          {displayedRows.map((row) => (
            <CustomRowGridCard
              key={row.id}
              rowId={row.id}
              width={gridTileWidth}
              display={buildRowDisplay(database, row, displayContext)}
              documentCount={documentIdsOf(row).length}
              onPress={() => (isSelectMode ? toggleSelected(row.id) : setRowPageId(row.id))}
              onLongPress={() => setRowMenuId(row.id)}
              right={
                isSelectMode ? (
                  <Ionicons
                    name={selectedIds.has(row.id) ? 'checkmark-circle' : 'ellipse-outline'}
                    size={22}
                    color="#fff"
                  />
                ) : (
                  <Pressable hitSlop={8} onPress={() => setRowMenuId(row.id)}>
                    <Ionicons name="ellipsis-horizontal" size={16} color="rgba(255,255,255,0.85)" />
                  </Pressable>
                )
              }
            />
          ))}
        </ScrollView>
      ) : groupField ? (
        // Grouped by one field: a header per value with its own count, and
        // the total under the last group - the "how many working, how many
        // in for repair, how many altogether" read.
        <ScrollView contentContainerStyle={[styles.list, railClear(railSide, 20), isSelectMode && styles.listWithBulkBar]}>
          {rowGroups.map((group) => (
            <View key={group.key || '__empty__'} style={styles.groupSection}>
              <View style={styles.groupHeader}>
                <Text style={styles.groupHeaderLabel} numberOfLines={1}>
                  {group.label}
                </Text>
                <Text style={styles.groupHeaderCount}>{group.rows.length}</Text>
              </View>
              {group.rows.map(renderRowCard)}
            </View>
          ))}
          <View style={styles.groupTotal}>
            <Text style={styles.groupTotalLabel}>Усього</Text>
            <Text style={styles.groupTotalCount}>{displayedRows.length}</Text>
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, railClear(railSide, 20), isSelectMode && styles.listWithBulkBar]}>
          {displayedRows.map(renderRowCard)}
        </ScrollView>
      )}

      {/* Order it, narrow it, group it, and the saved slices of it - the
          four things that decide WHAT this list shows. RailCapsule draws
          its own glass through the portal, so these need no wrapper. */}
      {railFocused && !isSelectMode && (
        <RailCapsule
          side={railSide}
          bottom={rail.actionsBottom}
          buttons={[
            // The shape of the list, which used to be the header's own
            // chip - its icon IS the shape, so the button says which one
            // is in force with no label at all.
            ...(railPlan.shape
              ? [
                  {
                    icon: VIEW_ICONS[viewMode],
                    onPress: () => openParamList('view'),
                    active: openParam === 'view',
                  },
                ]
              : []),
            // Ordering, narrowing and grouping, in one button: they are
            // one family (all three change the same list) and they open
            // one window with three tabs. The numeral says how many of
            // them are in force, because with three buttons the lit one
            // said that by itself and with one button nothing would.
            {
              icon: 'options-outline' as const,
              onPress: () => openParamList('params'),
              active: openParam === 'params',
              count: activeParamCount,
            },
            ...(railPlan.views
              ? [
                  {
                    icon: 'bookmark-outline' as const,
                    onPress: () => openParamList('views'),
                    active: openParam === 'views' || !!activeView,
                  },
                ]
              : []),
            // And where the stack will not stand clear of the top
            // capsule, choosing gives up its own and joins these.
            ...(railPlan.selectOwn
              ? []
              : [{ icon: 'checkmark-circle-outline' as const, onPress: toggleSelectMode }]),
          ]}
        />
      )}
      {/* Choosing several is a mode, not an action - its own capsule,
          while the screen has the height for one. */}
      {railFocused && !isSelectMode && railPlan.selectOwn && (
        <RailCapsule
          side={railSide}
          bottom={rail.historyBottom}
          buttons={[{ icon: 'checkmark-circle-outline', onPress: toggleSelectMode }]}
        />
      )}
      {/* A record. The plus is drawn on the thing it adds. Making a view
          is not here: it is the last entry of the views list, which the
          bookmark button already opens. */}
      {railFocused && !isSelectMode && (
        <RailCapsule
          side={railSide}
          bottom={rail.addBottom}
          buttons={[{ icon: 'albums-outline', badge: 'add-circle-outline', onPress: openNewRow }]}
        />
      )}


      {/* The second half of adding a field from the form: the type is
          picked, this asks what it is called. */}
      <RenamePrompt
        visible={fieldPromptType !== null}
        title={fieldPromptType ? `Нове поле · ${FIELD_TYPE_LABEL[fieldPromptType]}` : 'Нове поле'}
        initialValue=""
        placeholder="Назва поля"
        onCancel={() => {
          setFieldPromptType(null);
          setFieldPromptRelation(null);
        }}
        onSave={(name) => {
          if (fieldPromptType) createField(fieldPromptType, name);
        }}
      />

      <RenamePrompt
        visible={renamingDatabase}
        title="Назва бази"
        initialValue={database.name}
        onCancel={() => setRenamingDatabase(false)}
        onSave={renameDatabase}
      />

      <RenamePrompt
        visible={viewPrompt !== null}
        title={viewPrompt?.mode === 'rename' ? 'Назва вигляду' : 'Зберегти вигляд'}
        initialValue={viewPrompt?.mode === 'rename' ? viewPrompt.view.name : ''}
        placeholder="Наприклад, Цього тижня"
        onCancel={() => setViewPrompt(null)}
        onSave={(name) =>
          viewPrompt?.mode === 'rename' ? renameSavedView(viewPrompt.view, name) : saveCurrentAsView(name)
        }
      />

      <ImportTableSheet
        visible={importing}
        targetDatabase={database ? { id: databaseId, name: database.name, fields: database.fields } : null}
        otherDatabases={otherDatabases}
        onClose={() => setImporting(false)}
        onDone={(_id, rowCount) => {
          setImporting(false);
          notify('Імпортовано', `Додано записів: ${rowCount}`);
        }}
      />

      <FieldsEditorSheet
        visible={editingFields}
        fields={database.fields}
        otherDatabases={otherDatabases}
        isBacklinkEnabled={isBacklinkEnabled}
        onToggleBacklink={(field, enabled) => {
          toggleBacklink(field, enabled).catch((e) => console.warn('[CustomDatabase] backlink toggle failed', e));
        }}
        onSave={saveFields}
        onClose={() => setEditingFields(false)}
      />


      {/* The record as a page: a structured reference to read, with editing
          a deliberate step away rather than the only mode.
          A WINDOW, like everything else here - it used to cover the screen
          edge to edge, which made it the only thing in the app that left
          no sign of where it had been opened from. Same centred shape as
          the form that edits it, one size larger because it is for
          reading. A layer, never a Modal: the form opens on top of this,
          and the form's own pickers on top of THAT, and layers stack in
          the order they mount while a Modal always wins. */}
      {rowPageRow !== null && (
        <GlassLayer visible onClose={() => setRowPageId(null)}>
          <View style={[styles.layerBackdrop, { paddingBottom: keyboardHeight }]}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setRowPageId(null)} />
          <View style={styles.pageContainer}>
            <View style={styles.pageHeader}>
              <Pressable hitSlop={10} onPress={() => setRowPageId(null)}>
                <Ionicons name="close" size={24} color={GLASS_TEXT} />
              </Pressable>
              <Text style={styles.pageHeaderTitle} numberOfLines={1}>
                {rowPageRow ? titleOf(rowPageRow) : ''}
              </Text>
              <Pressable
                style={styles.pageEditButton}
                onPress={() => {
                  if (rowPageRow) openEditRow(rowPageRow);
                }}
              >
                <Ionicons name="create-outline" size={16} color="#fff" />
                <Text style={styles.pageEditLabel}>Редагувати</Text>
              </Pressable>
            </View>

            {rowPageRow && (
              <GestureScrollView contentContainerStyle={styles.pageBody}>
                {/* The cover field leads the page as the record's own
                    picture - no label above it, and skipped further down
                    so the same photos aren't listed twice. A gallery cover
                    is the whole carousel here, not just its first frame:
                    the page has the room a card doesn't. */}
                {(() => {
                  if (!coverField) return null;
                  const photos = resolveRelationList(coverField, rowPageRow.values[coverField.id], displayContext)
                    .filter((item) => !!item.thumbUri)
                    .map((item) => ({ uri: item.thumbUri as string, driveFileId: item.driveFileId }));
                  if (photos.length === 0) return null;
                  if (photos.length === 1) {
                    return (
                      <View style={styles.pageCover}>
                        <RelationThumb uri={photos[0].uri} driveFileId={photos[0].driveFileId} fill />
                      </View>
                    );
                  }
                  return (
                    <View style={styles.pageCoverCarousel}>
                      <PhotoCarousel items={photos} horizontalMargin={16} />
                    </View>
                  );
                })()}

                <Text style={styles.pageTitle}>{titleOf(rowPageRow)}</Text>

                {/* Every field past the title, value-first and read-only.
                    Empty ones are shown too, greyed - on a reference page
                    "this is not filled in" is information. */}
                {database.fields.slice(1).map((field) => {
                  if (field.id === coverField?.id) return null;
                  if (field.type === 'section') {
                    return (
                      <Text key={field.id} style={styles.pageSectionHeading}>
                        {field.name}
                      </Text>
                    );
                  }
                  if (field.type === 'backlink') {
                    const linked = resolveBacklinkRows(field, rowPageRow.id, displayContext);
                    const sourceDb = field.backlinkSource ? relatedDatabases[field.backlinkSource.databaseId] : undefined;
                    return (
                      <View key={field.id} style={styles.pageField}>
                        <Text style={styles.pageFieldLabel}>{field.name}</Text>
                        {linked.length === 0 ? (
                          <Text style={styles.pageFieldEmpty}>—</Text>
                        ) : (
                          linked.map((r) => (
                            <Text key={r.id} style={styles.pageFieldValue}>
                              {rowTitleOf(sourceDb, r)}
                            </Text>
                          ))
                        )}
                      </View>
                    );
                  }
                  const raw = rowPageRow.values[field.id];
                  if (field.type === 'relation' && field.multiple) {
                    const photos = resolveRelationList(field, raw, displayContext)
                      .filter((item) => !!item.thumbUri)
                      .map((item) => ({ uri: item.thumbUri as string, driveFileId: item.driveFileId }));
                    return (
                      <View key={field.id} style={styles.pageField}>
                        <Text style={styles.pageFieldLabel}>{field.name}</Text>
                        {photos.length === 0 ? (
                          <Text style={styles.pageFieldEmpty}>—</Text>
                        ) : (
                          <PhotoCarousel items={photos} horizontalMargin={16} />
                        )}
                      </View>
                    );
                  }
                  if (field.type === 'relation') {
                    const resolved = typeof raw === 'string' ? resolveRelation(field, raw) : null;
                    return (
                      <View key={field.id} style={styles.pageField}>
                        <Text style={styles.pageFieldLabel}>{field.name}</Text>
                        {resolved ? (
                          <View style={styles.pageRelationValue}>
                            {resolved.thumbUri && (
                              <RelationThumb uri={resolved.thumbUri} driveFileId={resolved.driveFileId} size={32} radius={8} />
                            )}
                            <Text style={styles.pageFieldValue}>{resolved.label}</Text>
                          </View>
                        ) : (
                          <Text style={styles.pageFieldEmpty}>—</Text>
                        )}
                      </View>
                    );
                  }
                  const shown = displayValue(field, raw);
                  return (
                    <View key={field.id} style={styles.pageField}>
                      <Text style={styles.pageFieldLabel}>{field.name}</Text>
                      <Text style={shown ? styles.pageFieldValue : styles.pageFieldEmpty}>{shown || '—'}</Text>
                    </View>
                  );
                })}

                {(rowPageRow.tagIds ?? []).length > 0 && (
                  <View style={styles.pageField}>
                    <Text style={styles.pageFieldLabel}>Теги</Text>
                    <View style={styles.pageTags}>
                      <TagChips tags={tags.filter((t) => (rowPageRow.tagIds ?? []).includes(t.id))} onPress={() => {}} />
                    </View>
                  </View>
                )}
              </GestureScrollView>
            )}
          </View>
          </View>
        </GlassLayer>
      )}

      {/* A layer, not a Modal. A Modal is a native window of its own on
          Android, drawn above everything in the screen - including the
          layers this form opens from inside itself: the tag picker, the
          "which type of field" question, the field's name. All three were
          appearing BEHIND the form, which read as "+ Поле does nothing". As
          a layer the form is in the screen with them, and whatever it opens
          mounts after it and so draws above it. */}
      <GlassLayer visible={rowEditor !== null} onClose={cancelRowEditor}>
        {/* The dimmed backdrop is a SIBLING behind the sheet, not its
            parent. As a parent (a Pressable wrapping everything, only there
            to stop a tap from closing the sheet) it took the RN touch
            responder for every drag that didn't land on a deeper child -
            which is exactly what kept the field list from scrolling. With
            it behind instead, nothing above the list claims touches, and a
            tap outside the sheet still closes it. */}
        <View style={[styles.layerBackdrop, { paddingBottom: keyboardHeight }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={cancelRowEditor} />
          {/* maxHeight has to account for the keyboard this sheet is
              lifted above: at a flat 85% of the screen, sheet + keyboard
              added up to more than the screen, and the top of the form
              (title, first fields) ended up above the screen edge with no
              way to scroll back to it. */}
          <View
            style={[
              styles.editorSheet,
              {
                // Small, and deliberately so. It was 85% of the screen,
                // which on a phone is the screen - a page in all but
                // name. The point of this form is that it is a form: it
                // opens over the list, takes what a record needs, and
                // gets out of the way. A database with many fields
                // scrolls inside it rather than growing to swallow the
                // screen.
                maxHeight: Math.min(windowHeight * 0.55, windowHeight - keyboardHeight - 48),
              },
            ]}
          >
            <View style={styles.handle} />
            <Text style={styles.title}>{rowEditor?.mode === 'new' ? 'Новий запис' : 'Редагувати запис'}</Text>
            {/* keyboardShouldPersistTaps: without it, tapping "Теги" (or
                any other control here) while the keyboard is up only
                dismisses the keyboard - the tap never reaches the control,
                so the picker appears not to open at all. */}
            <GestureScrollView style={styles.editorScroll} keyboardShouldPersistTaps="handled">
              {database.fields.map((field) =>
                field.type === 'section' ? (
                  <Text key={field.id} style={styles.sectionHeading}>
                    {field.name}
                  </Text>
                ) : (
                  <View key={field.id} style={styles.editorField}>
                    <View style={styles.editorFieldLabelRow}>
                      <Ionicons name={FIELD_TYPE_ICON[field.type]} size={12} color={GLASS_TEXT_MUTED} />
                      <Text style={styles.editorFieldLabel}>{field.name}</Text>
                    </View>
                    {renderFieldInput(field)}
                  </View>
                )
              )}
              {/* The database grows from here. A field this record needs
                  and does not have is added in place, without leaving the
                  form - see addFieldFromForm for why that is the point
                  rather than a shortcut. */}
              <Pressable style={styles.addFieldRow} onPress={addFieldFromForm}>
                <Ionicons name="add" size={16} color={GLASS_TEXT_MUTED} />
                <Text style={styles.addFieldLabel}>Поле</Text>
              </Pressable>
              <View style={styles.editorField}>
                <Text style={styles.editorFieldLabel}>Теги</Text>
                <Pressable style={styles.fieldPressable} onPress={() => setTagPickerVisible(true)}>
                  {draftTagIds.length > 0 ? (
                    <TagChips tags={tags.filter((t) => draftTagIds.includes(t.id))} onPress={() => setTagPickerVisible(true)} />
                  ) : (
                    <Text style={styles.fieldPressablePlaceholder}>Додати теги</Text>
                  )}
                </Pressable>
              </View>
            </GestureScrollView>
            <View style={styles.buttons}>
              <Pressable style={styles.cancelButton} onPress={cancelRowEditor}>
                <Text style={styles.cancelLabel}>Скасувати</Text>
              </Pressable>
              <Pressable style={styles.saveButton} onPress={saveRow}>
                <Text style={styles.saveLabel}>Зберегти</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </GlassLayer>

      {datePickerField && (
        <MiniDatePicker
          value={typeof draftValues[datePickerField.id] === 'string' ? (draftValues[datePickerField.id] as string) : undefined}
          onPick={(key) => {
            setDraftValue(datePickerField.id, key);
            setDatePickerFieldId(null);
          }}
          onClose={() => setDatePickerFieldId(null)}
        />
      )}

      {selectPickerField && (
        <OptionPickerSheet
          field={selectPickerField}
          value={draftValues[selectPickerField.id]}
          onChange={(value) => setDraftValue(selectPickerField.id, value)}
          onCreateOption={(label) => addFieldOption(selectPickerField.id, label)}
          onClose={() => setSelectPickerFieldId(null)}
        />
      )}

      {/* The backlink side's own picker: the same sheet, driven by a
          relation-shaped field pointed at the SOURCE database, so picking
          (or creating) there writes that row's relation field back here. */}
      {backlinkPickerField && backlinkPickerField.backlinkSource && editingRowId && (
        <RelationPickerSheet
          field={{
            id: backlinkPickerField.id,
            name: backlinkPickerField.name,
            type: 'relation',
            relationTarget: { kind: 'customDb', databaseId: backlinkPickerField.backlinkSource.databaseId },
          }}
          value={undefined}
          photos={photosList}
          files={filesList}
          links={linksList}
          relatedDatabase={relatedDatabases[backlinkPickerField.backlinkSource.databaseId] ?? null}
          relatedRows={relatedRows[backlinkPickerField.backlinkSource.databaseId] ?? []}
          keyboardHeight={keyboardHeight}
          onCreateRow={(title) => createBacklinkRow(backlinkPickerField, title, editingRowId)}
          onChange={(pickedId) => {
            if (pickedId) linkBacklinkRow(backlinkPickerField, pickedId, editingRowId).catch(() => {});
          }}
          onClose={() => setBacklinkPickerFieldId(null)}
        />
      )}

      {relationPickerField && (
        <RelationPickerSheet
          field={relationPickerField}
          value={draftValues[relationPickerField.id]}
          photos={photosList}
          files={filesList}
          links={linksList}
          relatedDatabase={
            relationPickerField.relationTarget?.kind === 'customDb'
              ? (relatedDatabases[relationPickerField.relationTarget.databaseId] ?? null)
              : null
          }
          relatedRows={
            relationPickerField.relationTarget?.kind === 'customDb'
              ? (relatedRows[relationPickerField.relationTarget.databaseId] ?? [])
              : []
          }
          onCreateRow={(title) =>
            relationPickerField.relationTarget?.kind === 'customDb'
              ? createRelatedRow(relationPickerField.relationTarget.databaseId, title)
              : Promise.resolve('')
          }
          onChange={(value) => setDraftValue(relationPickerField.id, value)}
          onChangeMany={(values) => setDraftValue(relationPickerField.id, values)}
          keyboardHeight={keyboardHeight}
          onClose={() => setRelationPickerFieldId(null)}
        />
      )}

      {/* The same pickers again, but driven by a tapped table cell and
          writing straight to that row instead of into the form's draft. */}
      {cellPicker?.field.type === 'date' && (
        <MiniDatePicker
          value={
            typeof rows.find((r) => r.id === cellPicker.rowId)?.values[cellPicker.field.id] === 'string'
              ? (rows.find((r) => r.id === cellPicker.rowId)?.values[cellPicker.field.id] as string)
              : undefined
          }
          onPick={(key) => {
            writeRowValue(cellPicker.rowId, cellPicker.field.id, key);
            setCellPicker(null);
          }}
          onClose={() => setCellPicker(null)}
        />
      )}

      {cellPicker?.field.type === 'relation' && (
        <RelationPickerSheet
          field={cellPicker.field}
          value={rows.find((r) => r.id === cellPicker.rowId)?.values[cellPicker.field.id]}
          photos={photosList}
          files={filesList}
          links={linksList}
          relatedDatabase={
            cellPicker.field.relationTarget?.kind === 'customDb'
              ? (relatedDatabases[cellPicker.field.relationTarget.databaseId] ?? null)
              : null
          }
          relatedRows={
            cellPicker.field.relationTarget?.kind === 'customDb'
              ? (relatedRows[cellPicker.field.relationTarget.databaseId] ?? [])
              : []
          }
          onCreateRow={(title) =>
            cellPicker.field.relationTarget?.kind === 'customDb'
              ? createRelatedRow(cellPicker.field.relationTarget.databaseId, title)
              : Promise.resolve('')
          }
          onChange={(value) => writeRowValue(cellPicker.rowId, cellPicker.field.id, value)}
          onChangeMany={(values) => writeRowValue(cellPicker.rowId, cellPicker.field.id, values)}
          keyboardHeight={keyboardHeight}
          onClose={() => setCellPicker(null)}
        />
      )}

      {cellPicker && cellPicker.field.type !== 'date' && cellPicker.field.type !== 'relation' && (
        <OptionPickerSheet
          // The LIVE field, not the one captured when the cell was
          // tapped: a variant added from inside the sheet has to show up in
          // the list it was just added to.
          field={database.fields.find((f) => f.id === cellPicker.field.id) ?? cellPicker.field}
          value={rows.find((r) => r.id === cellPicker.rowId)?.values[cellPicker.field.id]}
          onChange={(value) => writeRowValue(cellPicker.rowId, cellPicker.field.id, value)}
          onCreateOption={(label) => addFieldOption(cellPicker.field.id, label)}
          onClose={() => setCellPicker(null)}
        />
      )}

      <TagPicker
        visible={tagPickerVisible}
        kind={customRowKind}
        tags={tags}
        selectedTagIds={draftTagIds}
        onAttach={(tag) => setDraftTagIds((prev) => [...prev, tag.id])}
        onDetach={(tag) => setDraftTagIds((prev) => prev.filter((id) => id !== tag.id))}
        onCreateAndAttach={async (path, icon, color) => {
          // A brand-new tag needs a real item to attach to, but this row
          // may not exist yet (still being drafted) - create it against a
          // throwaway id when new, then fold it into the draft either way.
          const tagId = await createAndAttachTag(path, icon, color, customRowKind, generateId(), 'customDatabaseRows');
          setDraftTagIds((prev) => [...prev, tagId]);
        }}
        onRenameTag={renameTag}
        onClose={() => setTagPickerVisible(false)}
      />

      <TagPicker
        visible={bulkTagPickerVisible}
        kind={customRowKind}
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
        kind={customRowKind}
        groups={groups}
        onPick={bulkAssignGroup}
        onClose={() => setBulkGroupPickerVisible(false)}
      />

      <GlassLayer visible={rowMenuRow !== null} onClose={() => setRowMenuId(null)}>
        <Pressable style={styles.layerBackdrop} onPress={() => setRowMenuId(null)}>
          <Pressable style={styles.cardMenuSheet} onPress={() => {}}>
            <View style={styles.handle} />
            <Pressable
              style={styles.cardMenuRow}
              onPress={() => {
                if (rowMenuRow) openEditRow(rowMenuRow);
              }}
            >
              <Ionicons name="pencil-outline" size={18} color={GLASS_TEXT} />
              <Text style={styles.cardMenuRowLabel}>Редагувати</Text>
            </Pressable>
            {rowMenuRow && documentIdsOf(rowMenuRow).length > 0 && (
              <Pressable style={styles.cardMenuRow} onPress={() => openRowDocuments(rowMenuRow)}>
                <Ionicons name="document-text-outline" size={18} color={GLASS_TEXT} />
                <Text style={styles.cardMenuRowLabel}>
                  Документи ({documentIdsOf(rowMenuRow).length})
                </Text>
              </Pressable>
            )}
            <Pressable
              style={styles.cardMenuRow}
              onPress={() => {
                setBulkGroupPickerVisible(true);
                if (rowMenuRow) {
                  // Bulk-group UI acts on `selectedRows` - route a single
                  // row's group change through the same selection so there's
                  // only one grouping code path.
                  toggleSelected(rowMenuRow.id);
                }
                setRowMenuId(null);
              }}
            >
              <Ionicons name="folder-outline" size={18} color={GLASS_TEXT} />
              <Text style={styles.cardMenuRowLabel}>Групування</Text>
            </Pressable>
            <Pressable
              style={styles.cardMenuRow}
              onPress={() => {
                if (rowMenuRow) {
                  confirm({
                    title: 'Видалити запис?',
                    confirmLabel: 'Видалити',
                  }).then((yes) => {
                    if (!yes) return;
                    deleteRow(rowMenuRow);
                  });
                }
                setRowMenuId(null);
              }}
            >
              <Ionicons name="trash-outline" size={18} color={DANGER} />
              <Text style={[styles.cardMenuRowLabel, { color: DANGER }]}>Видалити</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </GlassLayer>

      <DocumentPickerModal
        visible={documentPicker !== null}
        subtitle={documentPicker ? titleOf(documentPicker.row) : undefined}
        documents={documentPicker?.documents ?? []}
        onPick={(documentId) => {
          setDocumentPicker(null);
          navigation.navigate('Editor', { documentId });
        }}
        onClose={() => setDocumentPicker(null)}
      />

      <BulkActionBar
        count={selectedIds.size}
        onTag={() => setBulkTagPickerVisible(true)}
        onGroup={() => setBulkGroupPickerVisible(true)}
        onDelete={confirmDeleteSelected}
      />

      {toast && <UndoToast message={toast.message} onUndo={() => undo(toast.id)} />}
    </View>
  );
}

// One option list serving both the row form and a tapped table cell - the
// caller decides where the picked value goes (a local draft, or straight
// to that row's document), this only knows the field and its current value.
function OptionPickerSheet({
  field,
  value,
  onChange,
  onCreateOption,
  onClose,
}: {
  field: FieldDef;
  value: string | number | string[] | undefined;
  onChange: (value: string | string[]) => void;
  // Adds a variant to the FIELD itself and resolves with its id. The list
  // is the field's, not this row's, so a variant typed here is there for
  // every record from now on - which is the whole point of a list field.
  onCreateOption: (label: string) => Promise<string>;
  onClose: () => void;
}) {
  const isMulti = field.type === 'multiSelect';
  const keyboardHeight = useKeyboardHeight();
  const [search, setSearch] = useState('');
  const currentIds = isMulti
    ? Array.isArray(value)
      ? value
      : []
    : value
      ? [value as string]
      : [];

  const options = field.options ?? [];
  const needle = search.trim().toLowerCase();
  const filtered = needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
  // Only when what's typed isn't already a variant - an exact match means
  // "pick that one", not "make a second with the same name".
  const canCreate = needle.length > 0 && !options.some((o) => o.label.trim().toLowerCase() === needle);

  function choose(optionId: string) {
    if (isMulti) {
      onChange(
        currentIds.includes(optionId)
          ? currentIds.filter((id) => id !== optionId)
          : [...currentIds, optionId]
      );
    } else {
      // Tapping the already-chosen option clears it, so a single-select
      // field can be emptied without a separate "none" row.
      onChange(currentIds.includes(optionId) ? '' : optionId);
      onClose();
    }
  }

  return (
    <GlassLayer visible onClose={onClose}>
      <Pressable style={[styles.layerBackdrop, { paddingBottom: keyboardHeight }]} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>{field.name}</Text>
          {/* The list is built by typing into it, the way the relation
              picker builds rows: a field created from the record form has
              no variants at all, and sending someone to "..." -> "Поля" to
              write the first one is a trip out of the form they are in. */}
          <TextInput
            style={styles.relationSearchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="Пошук або новий варіант"
            placeholderTextColor={GLASS_TEXT_FAINT}
            returnKeyType="done"
            onSubmitEditing={() => {
              if (!canCreate) return;
              const label = search.trim();
              setSearch('');
              onCreateOption(label)
                .then((id) => choose(id))
                .catch(() => {});
            }}
          />
          <GestureScrollView style={styles.relationPickerScroll} keyboardShouldPersistTaps="handled">
            {canCreate && (
              <Pressable
                style={styles.optionPickerRow}
                onPress={() => {
                  const label = search.trim();
                  setSearch('');
                  onCreateOption(label)
                    .then((id) => choose(id))
                    .catch(() => {});
                }}
              >
                <Ionicons name="add-circle-outline" size={18} color={ACCENT} />
                <Text style={[styles.optionPickerLabel, { color: ACCENT }]} numberOfLines={1}>
                  Створити «{search.trim()}»
                </Text>
              </Pressable>
            )}
            {filtered.map((option) => {
              const selected = currentIds.includes(option.id);
              return (
                <Pressable key={option.id} style={styles.optionPickerRow} onPress={() => choose(option.id)}>
                  <View style={[styles.optionDot, { backgroundColor: option.color }]} />
                  <Text style={styles.optionPickerLabel}>{option.label}</Text>
                  {selected && <Ionicons name="checkmark" size={18} color={ACCENT} />}
                </Pressable>
              );
            })}
            {options.length === 0 && !canCreate && (
              <Text style={styles.optionPickerEmpty}>
                Впишіть перший варіант - він стане у списку цього поля.
              </Text>
            )}
          </GestureScrollView>
          {isMulti && (
            <Pressable style={styles.saveButton} onPress={onClose}>
              <Text style={styles.saveLabel}>Готово</Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </GlassLayer>
  );
}

// One picker serving a 'relation' field's value, wherever it's edited from
// (the row form's draft, or a tapped table cell - same split OptionPickerSheet
// already makes). Target "Фото" shows a searchable thumbnail grid, "Файли" a
// searchable list of names; target another custom database shows a
// searchable list of its rows by title (its own fields[0], same convention
// as this screen's own titleOf).
function RelationPickerSheet({
  field,
  value,
  photos,
  files,
  links,
  relatedDatabase,
  relatedRows,
  onCreateRow,
  onChange,
  onChangeMany,
  keyboardHeight,
  onClose,
}: {
  field: FieldDef;
  value: string | number | string[] | undefined;
  photos: { id: string; imageUri: string; title?: string; driveFileId?: string }[];
  files: { id: string; title?: string; fileName?: string }[];
  links: { id: string; url: string; title?: string; imageUrl?: string; category: LinkCategory }[];
  relatedDatabase: CustomDatabase | null;
  relatedRows: CustomDatabaseRow[];
  // Creates a row in the TARGET database carrying just this title, and
  // resolves to its new id - what lets a relation be filled in with
  // something that doesn't exist in that database yet, instead of forcing
  // a trip over there to create it first (the Notion behaviour).
  onCreateRow: (title: string) => Promise<string>;
  onChange: (value: string) => void;
  // Only for a `multiple` field - the whole new list of ids.
  onChangeMany?: (values: string[]) => void;
  // Lifts the sheet above the keyboard its own search field raises -
  // without it the field being typed into is the one thing covered.
  keyboardHeight: number;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const isMulti = !!field.multiple;
  const selectedIds = Array.isArray(value) ? value : typeof value === 'string' && value ? [value] : [];
  const currentId = isMulti ? undefined : typeof value === 'string' ? value : undefined;
  const isPhotos = (field.relationTarget?.kind ?? 'photos') === 'photos';
  const isFiles = field.relationTarget?.kind === 'files';
  const linkCategory =
    field.relationTarget?.kind === 'links' ? field.relationTarget.category : null;
  const needle = search.trim().toLowerCase();

  // In multi mode a tap toggles membership and the sheet stays open, so
  // several photos can be picked in one go; in single mode it picks and
  // closes, as before.
  function choose(id: string) {
    if (!isMulti) {
      onChange(id);
      onClose();
      return;
    }
    onChangeMany?.(selectedIds.includes(id) ? selectedIds.filter((v) => v !== id) : [...selectedIds, id]);
  }

  const clearRow = currentId && !isMulti ? (
    <Pressable
      style={styles.optionPickerRow}
      onPress={() => {
        onChange('');
        onClose();
      }}
    >
      <Ionicons name="close-circle-outline" size={18} color={DANGER} />
      <Text style={[styles.optionPickerLabel, { color: DANGER }]}>Прибрати</Text>
    </Pressable>
  ) : null;

  if (linkCategory) {
    // Only this category's links: the three databases are one collection,
    // and a field pointing at "Геоточки" has no business offering a
    // YouTube cover.
    const nameOfLink = (l: { title?: string; url: string }) => l.title || l.url;
    const categoryLinks = links.filter((l) => l.category === linkCategory);
    const filteredLinks = needle
      ? categoryLinks.filter((l) => nameOfLink(l).toLowerCase().includes(needle))
      : categoryLinks;
    return (
      <GlassLayer visible onClose={onClose}>
        <Pressable style={[styles.layerBackdrop, { paddingBottom: keyboardHeight }]} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.title}>{field.name}</Text>
            <TextInput
              style={styles.relationSearchInput}
              value={search}
              onChangeText={setSearch}
              placeholder={`Пошук: ${LINK_CATEGORY_INFO[linkCategory].title}`}
              placeholderTextColor={GLASS_TEXT_FAINT}
            />
            {clearRow}
            <ScrollView style={styles.relationPickerScroll} keyboardShouldPersistTaps="handled">
              {filteredLinks.map((link) => (
                <Pressable key={link.id} style={styles.optionPickerRow} onPress={() => choose(link.id)}>
                  {link.imageUrl ? (
                    <RelationThumb uri={link.imageUrl} size={32} radius={8} />
                  ) : (
                    <Ionicons
                      name={LINK_CATEGORY_INFO[linkCategory].icon}
                      size={18}
                      color={LINK_CATEGORY_INFO[linkCategory].color}
                    />
                  )}
                  <Text style={styles.optionPickerLabel} numberOfLines={1}>
                    {nameOfLink(link)}
                  </Text>
                  {selectedIds.includes(link.id) && <Ionicons name="checkmark" size={18} color={ACCENT} />}
                </Pressable>
              ))}
              {filteredLinks.length === 0 && (
                <Text style={styles.optionPickerEmpty}>
                  {categoryLinks.length === 0
                    ? LINK_CATEGORY_INFO[linkCategory].emptyHint
                    : 'Нічого не знайдено.'}
                </Text>
              )}
            </ScrollView>
            {isMulti && (
              <Pressable style={styles.relationDoneButton} onPress={onClose}>
                <Text style={styles.relationDoneLabel}>Готово · {selectedIds.length}</Text>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </GlassLayer>
    );
  }

  if (isFiles) {
    // Names only, and no "create": a file is a file on the device, there
    // is nothing here that could make one - unlike a row in another
    // database, which this sheet can and does create.
    const nameOf = (f: { title?: string; fileName?: string }) => f.title || f.fileName || 'Файл';
    const filteredFiles = needle
      ? files.filter((f) => nameOf(f).toLowerCase().includes(needle))
      : files;
    return (
      <GlassLayer visible onClose={onClose}>
        <Pressable style={[styles.layerBackdrop, { paddingBottom: keyboardHeight }]} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.title}>{field.name}</Text>
            <TextInput
              style={styles.relationSearchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Пошук файлу"
              placeholderTextColor={GLASS_TEXT_FAINT}
            />
            {clearRow}
            <ScrollView style={styles.relationPickerScroll} keyboardShouldPersistTaps="handled">
              {filteredFiles.map((file) => (
                <Pressable key={file.id} style={styles.optionPickerRow} onPress={() => choose(file.id)}>
                  <Ionicons name="document-outline" size={18} color={GLASS_TEXT_MUTED} />
                  <Text style={styles.optionPickerLabel} numberOfLines={1}>
                    {nameOf(file)}
                  </Text>
                  {selectedIds.includes(file.id) && <Ionicons name="checkmark" size={18} color={ACCENT} />}
                </Pressable>
              ))}
              {filteredFiles.length === 0 && (
                <Text style={styles.optionPickerEmpty}>
                  {files.length === 0 ? 'У базі "Файли" поки нічого немає.' : 'Нічого не знайдено.'}
                </Text>
              )}
            </ScrollView>
            {isMulti && (
              <Pressable style={styles.relationDoneButton} onPress={onClose}>
                <Text style={styles.relationDoneLabel}>Готово · {selectedIds.length}</Text>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </GlassLayer>
    );
  }

  if (isPhotos) {
    const filtered = needle ? photos.filter((p) => (p.title ?? '').toLowerCase().includes(needle)) : photos;
    return (
      <GlassLayer visible onClose={onClose}>
        <Pressable style={[styles.layerBackdrop, { paddingBottom: keyboardHeight }]} onPress={onClose}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.title}>{field.name}</Text>
            <TextInput
              style={styles.relationSearchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Пошук фото"
              placeholderTextColor={GLASS_TEXT_FAINT}
            />
            {clearRow}
            <ScrollView style={styles.relationPickerScroll} keyboardShouldPersistTaps="handled">
              <View style={styles.relationPhotoGrid}>
                {filtered.map((photo) => (
                  <Pressable key={photo.id} style={styles.relationPhotoCell} onPress={() => choose(photo.id)}>
                    <RelationThumb uri={photo.imageUri} driveFileId={photo.driveFileId} size={72} radius={10} />
                    {selectedIds.includes(photo.id) && (
                      <View style={styles.relationPhotoCheck}>
                        <Ionicons name="checkmark-circle" size={18} color={ACCENT} />
                      </View>
                    )}
                  </Pressable>
                ))}
                {filtered.length === 0 && <Text style={styles.optionPickerEmpty}>Немає фото.</Text>}
              </View>
            </ScrollView>
            {isMulti && (
              <Pressable style={styles.relationDoneButton} onPress={onClose}>
                <Text style={styles.relationDoneLabel}>Готово · {selectedIds.length}</Text>
              </Pressable>
            )}
          </Pressable>
        </Pressable>
      </GlassLayer>
    );
  }

  const titleFieldId = relatedDatabase?.fields[0]?.id;
  const rowsFiltered = needle
    ? relatedRows.filter((r) => String(r.values[titleFieldId ?? ''] ?? '').toLowerCase().includes(needle))
    : relatedRows;
  const canCreate =
    !!relatedDatabase &&
    needle.length > 0 &&
    !relatedRows.some((r) => String(r.values[titleFieldId ?? ''] ?? '').trim().toLowerCase() === needle);

  return (
    <GlassLayer visible onClose={onClose}>
      <Pressable style={[styles.layerBackdrop, { paddingBottom: keyboardHeight }]} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>{field.name}</Text>
          <TextInput
            style={styles.relationSearchInput}
            value={search}
            onChangeText={setSearch}
            placeholder={relatedDatabase ? `Пошук у "${relatedDatabase.name}"` : 'Пошук'}
            placeholderTextColor={GLASS_TEXT_FAINT}
          />
          {clearRow}
          <ScrollView style={styles.relationPickerScroll} keyboardShouldPersistTaps="handled">
            {/* Only when what's typed isn't already one of the rows - an
                exact match means "pick that one", not "make a second with
                the same name". */}
            {canCreate && (
              <Pressable
                style={styles.optionPickerRow}
                onPress={() => {
                  const title = search.trim();
                  setSearch('');
                  onCreateRow(title)
                    .then((newId) => {
                      onChange(newId);
                      onClose();
                    })
                    .catch(() => {});
                }}
              >
                <Ionicons name="add-circle-outline" size={18} color={ACCENT} />
                <Text style={[styles.optionPickerLabel, { color: ACCENT }]} numberOfLines={1}>
                  Створити «{search.trim()}»
                </Text>
              </Pressable>
            )}
            {rowsFiltered.map((r) => {
              // The composed name (see rowTitleOf), not the raw title field
              // - this list is exactly where several rows share a title
              // field and only the composed name tells them apart.
              const title = rowTitleOf(relatedDatabase, r);
              return (
                <Pressable key={r.id} style={styles.optionPickerRow} onPress={() => choose(r.id)}>
                  <Text style={styles.optionPickerLabel}>{title}</Text>
                  {selectedIds.includes(r.id) && <Ionicons name="checkmark" size={18} color={ACCENT} />}
                </Pressable>
              );
            })}
            {rowsFiltered.length === 0 && <Text style={styles.optionPickerEmpty}>Нічого не знайдено.</Text>}
          </ScrollView>
          {isMulti && (
            <Pressable style={styles.relationDoneButton} onPress={onClose}>
              <Text style={styles.relationDoneLabel}>Готово · {selectedIds.length}</Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </GlassLayer>
  );
}

// A minimal month-grid date picker built on this app's own dateLocale
// utilities (no native/date-picker dependency) - deliberately not
// TasksScreen's ReminderSheet, which also carries time-of-day and
// notification scheduling this field type doesn't need.
function MiniDatePicker({ value, onPick, onClose }: { value?: string; onPick: (key: string) => void; onClose: () => void }) {
  const initial = value ? parseDateKey(value) : new Date();
  const [visibleMonth, setVisibleMonth] = useState({ year: initial.getFullYear(), month: initial.getMonth() });
  const grid = getMonthGrid(visibleMonth.year, visibleMonth.month);
  const today = new Date();

  function changeMonth(delta: number) {
    setVisibleMonth((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  return (
    <GlassLayer visible onClose={onClose}>
      <Pressable style={miniStyles.backdrop} onPress={onClose}>
        <Pressable style={miniStyles.card} onPress={() => {}}>
          <View style={miniStyles.navRow}>
            <Pressable hitSlop={10} onPress={() => changeMonth(-1)}>
              <Ionicons name="chevron-back" size={18} color={GLASS_TEXT} />
            </Pressable>
            <Text style={miniStyles.navTitle}>
              {MONTH_FULL[visibleMonth.month]} {visibleMonth.year}
            </Text>
            <Pressable hitSlop={10} onPress={() => changeMonth(1)}>
              <Ionicons name="chevron-forward" size={18} color={GLASS_TEXT} />
            </Pressable>
          </View>
          <View style={miniStyles.weekdayRow}>
            {WEEKDAY_SHORT.map((w) => (
              <Text key={w} style={miniStyles.weekdayLabel}>
                {w}
              </Text>
            ))}
          </View>
          {Array.from({ length: 6 }, (_, row) => (
            <View key={row} style={miniStyles.weekRow}>
              {grid.slice(row * 7, row * 7 + 7).map(({ date, inMonth }) => {
                const key = dateKey(date);
                const isToday = isSameDay(date, today);
                const isSelected = value === key;
                return (
                  <Pressable key={key} style={miniStyles.dayCell} onPress={() => onPick(key)}>
                    <View style={[miniStyles.dayCircle, isSelected && miniStyles.dayCircleSelected, isToday && !isSelected && miniStyles.dayCircleToday]}>
                      <Text
                        style={[
                          miniStyles.dayNum,
                          !inMonth && miniStyles.dayNumMuted,
                          isSelected && miniStyles.dayNumSelected,
                        ]}
                      >
                        {date.getDate()}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
        </Pressable>
      </Pressable>
    </GlassLayer>
  );
}

const miniStyles = StyleSheet.create({
  // The layer draws the dim; this only centres the calendar in it.
  backdrop: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  // A white card with near-black days, in a dark app: the calendar was
  // written before the glass palette existed and never converted with the
  // rest. Same body, same hairline edge as every other window now.
  card: {
    ...SHEET_WINDOW,
    maxWidth: 340,
    backgroundColor: GLASS_BODY_BLURRED,
    overflow: 'hidden',
    padding: 16,
  },
  navRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  navTitle: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
  },
  weekdayRow: {
    flexDirection: 'row',
  },
  weekdayLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
    marginBottom: 4,
  },
  weekRow: {
    flexDirection: 'row',
  },
  dayCell: {
    flex: 1,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleSelected: {
    backgroundColor: ACCENT,
  },
  dayCircleToday: {
    borderWidth: 1.5,
    borderColor: ACCENT,
  },
  dayNum: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
  },
  // A day from the neighbouring month: still readable, plainly not this one.
  dayNumMuted: {
    color: GLASS_TEXT_FAINT,
  },
  dayNumSelected: {
    color: '#fff',
    fontWeight: '700',
    fontFamily: FONT_BOLD,
  },
});

// One row of the sort dropdown. Extracted only because the built-ins and
// the database's own fields render identically and there are two lists of
// them - not a reusable widget beyond this menu.
function SortOption({
  label,
  icon,
  active,
  dir,
  onPress,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  active: boolean;
  dir: 'asc' | 'desc';
  onPress: () => void;
}) {
  return (
    <Pressable style={styles.paramOption} onPress={onPress}>
      {!!icon && <Ionicons name={icon} size={14} color={active ? '#fff' : 'rgba(255,255,255,0.7)'} />}
      <Text style={[styles.paramOptionLabel, active && styles.paramOptionLabelActive]} numberOfLines={1}>
        {label}
      </Text>
      {active && <Ionicons name={dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={14} color="#fff" />}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
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
  },
  // Turned with the capsule.
  headerButtonsDivider: {
    width: 20,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  // Above the capsule strip (zIndex 20) and the dropdown overlay (30) -
  // the "..." menu is the topmost thing on this screen while it's open,
  // and at its old zIndex the capsules were drawn straight over it.
  menuSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    letterSpacing: 0.04,
    textTransform: 'uppercase',
    color: GLASS_TEXT_FAINT,
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
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
  },
  menuDivider: {
    height: 1,
    backgroundColor: GLASS_LINE,
    marginVertical: 4,
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
    paddingRight: RAIL_CLEARANCE,
    gap: 10,
    // Clears the floating "+" (bottom: 100, 56 tall) so the last row can be
    // scrolled out from under it.
    paddingBottom: 170,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingBottom: 6,
  },
  // The tabs row's own bottom padding would otherwise leave the capsule
  // sitting lower than the pills it stands next to.
  controlsCapsuleOffset: {
    marginBottom: 10,
  },
  // Pushes the control capsule to the right when there are no groups to
  // fill the row's left side.
  controlsSpacer: {
    flex: 1,
  },
  // The strip scrolls horizontally, same family as ProjectTabsRow's own
  // dark tabs - flexGrow/flexShrink: 0 keeps it from competing for height
  // with the row list below it (same fix, same reason, as that
  // component's own `scroll` style).
  // A 'section' field's heading, in the row form and on the record page -
  // the fields after it read as belonging to it.
  sectionHeading: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 18,
    marginBottom: 4,
  },
  pageSectionHeading: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: ACCENT,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 22,
    marginBottom: 2,
  },
  groupSection: {
    gap: 8,
    marginBottom: 18,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
  },
  groupHeaderLabel: {
    flex: 1,
    fontSize: 15,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: '#fff',
  },
  groupHeaderCount: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: 'rgba(255,255,255,0.6)',
  },
  // Sits apart from the groups above it: it counts the whole filtered
  // list, not any one group.
  groupTotal: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.25)',
  },
  groupTotalLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.75)',
  },
  groupTotalCount: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: '#fff',
  },
  // The record page: a plain light sheet, deliberately not the dark
  // gradient the database list sits on - it reads as a document about one
  // record rather than another view of the list.
  // The record's own window. Taller than the form that edits it (85% vs
  // 55%): this one is for reading, and a record with a dozen fields
  // should show as many of them as the screen allows.
  pageContainer: {
    ...SHEET_WINDOW,
    maxHeight: '85%',
    backgroundColor: GLASS_BODY_BLURRED,
    overflow: 'hidden',
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    // No status bar to clear any more - the window starts below it.
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: GLASS_LINE,
  },
  pageHeaderTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
  },
  pageEditButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: ACCENT,
    borderRadius: 999,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  pageEditLabel: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: '#fff',
  },
  pageBody: {
    padding: 16,
    paddingBottom: 48,
  },
  pageCover: {
    width: '100%',
    aspectRatio: 1.5,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 16,
  },
  pageCoverCarousel: {
    marginBottom: 16,
  },
  pageTitle: {
    fontSize: 24,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
    marginBottom: 16,
  },
  pageField: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: GLASS_LINE,
    gap: 4,
  },
  pageFieldLabel: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
  },
  pageFieldValue: {
    fontSize: 16,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
  },
  pageFieldEmpty: {
    fontSize: 16,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_FAINT,
  },
  pageRelationValue: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  pageTags: {
    flexDirection: 'row',
    flexWrap: 'wrap',
  },
  galleryThumbs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    flex: 1,
  },
  relationDoneButton: {
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    marginTop: 10,
  },
  relationDoneLabel: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: '#fff',
  },
  backlinkList: {
    gap: 6,
  },
  backlinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: GLASS_CARD,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  backlinkRowLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
  },
  backlinkAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  backlinkAddLabel: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: ACCENT,
  },
  paramsScroll: {
    flexGrow: 0,
    flexShrink: 0,
    // Above the list below, so an open dropdown covers the cards instead
    // of pushing them down the screen.
    zIndex: 20,
  },
  paramsStrip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingLeft: 20,
    paddingRight: RAIL_CLEARANCE,
    paddingBottom: 10,
  },
  // Holds a capsule and the list it opens. The list is positioned against
  // this, so it lands directly under its own capsule and inherits its
  // left edge whichever capsule was tapped.
  // Marks the filter capsule when something is actually filtered - the
  // count alone is easy to miss, and a filtered list looks identical to a
  // short one.
  paramChipActive: {
    borderColor: 'rgba(255,255,255,0.9)',
  },
  paramChip: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 0,
    gap: 5,
    backgroundColor: 'rgba(20,20,20,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 999,
    // Same metrics as a group tab (see ProjectTabsRow's own tab style) so
    // the two rows read as one family rather than two sizes of pill.
    paddingVertical: 7,
    paddingHorizontal: 13,
  },
  paramChipLabel: {
    maxWidth: 130,
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
  },
  // The open capsule: the same glass body as the pill, just taller and
  // squarer, drawn over the collapsed one it replaces.
  // Covers the screen, so every list drawn inside it is within its
  // ancestors' bounds and Android will hand a drag to its ScrollView.
  paramOverlay: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 30,
  },
  paramExpanded: {
    position: 'absolute',
    // top/left/minWidth come from the capsule's measured layout.
    backgroundColor: 'rgba(20,20,20,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 18,
    paddingBottom: 4,
    elevation: 12,
    zIndex: 50,
  },
  paramExpandedHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 13,
  },
  paramOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 13,
  },
  paramOptionLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.7)',
  },
  paramOptionCount: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.45)',
  },
  paramDivider: {
    height: 1,
    marginVertical: 4,
    marginHorizontal: 13,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  // A database with many fields, or a field with many distinct values,
  // would otherwise grow the dropdown past the bottom of the screen. The
  // maxHeight lives on this WRAPPING View, not on the ScrollView itself -
  // a ScrollView given only its own maxHeight, with no ancestor of fixed
  // size above it (this whole panel is position:'absolute', auto-height),
  // rendered at its full, unclipped content height on Android instead of
  // capping there: nothing was hidden, so nothing scrolled.
  paramScrollWrap: {
    maxHeight: 260,
    overflow: 'hidden',
  },
  paramOptionLabelActive: {
    color: '#fff',
    fontWeight: '700',
    fontFamily: FONT_BOLD,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 8,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // flex-start, not space-between: the tiles now carry exact widths that
    // already account for the gap, so spreading them would double it and
    // leave a short last row strung across the screen.
    justifyContent: 'flex-start',
    paddingLeft: CARD_GRID_PADDING,
    // Clear of the rail - the same number gridUsable above is worked out
    // against.
    paddingRight: RAIL_CLEARANCE,
    paddingVertical: 8,
    gap: CARD_GRID_GAP,
    paddingBottom: 170,
  },
  listWithBulkBar: {
    paddingBottom: 170,
  },
  rowActionButton: {
    padding: 6,
  },
  tableWrap: {
    flex: 1,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  // The header's frozen block is one row (handle + first column's title);
  // the body's is a COLUMN of rows. They were briefly the same style, which
  // laid every row out side by side instead of stacked.
  tableFrozenHeader: {
    flexDirection: 'row',
  },
  tableFrozenColumn: {
    overflow: 'hidden',
  },
  tableBody: {
    paddingBottom: 170,
  },
  tableBodyRow: {
    flexDirection: 'row',
  },
  tableHeaderCell: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 8,
  },
  tableHeaderLabel: {
    flex: 1,
    fontSize: 12,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: '#fff',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
    height: TABLE_ROW_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  // The narrow leading column: opens the row as a full card (and doubles as
  // the checkbox in select mode).
  tableRowHandle: {
    width: TABLE_HANDLE_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableCellTap: {
    justifyContent: 'center',
    paddingHorizontal: 8,
  },
  tableCell: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: '#fff',
  },
  tableCellEmpty: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.35)',
  },
  tableCellInput: {
    height: TABLE_ROW_HEIGHT - 1,
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 0,
  },
  backdrop: {
    backgroundColor: 'rgba(17,24,39,0.45)',
    ...SHEET_BACKDROP,
  },
  // For the form that lives in a GlassLayer: the layer draws the dim.
  layerBackdrop: {
    ...SHEET_BACKDROP,
  },
  sheet: {
    backgroundColor: GLASS_BODY_BLURRED,
    overflow: 'hidden',
    ...SHEET_WINDOW,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: '70%',
  },
  // The parameters window: the same box as the record form, so the two
  // read as one family of windows rather than two inventions.
  paramsSheet: {
    backgroundColor: GLASS_BODY_BLURRED,
    overflow: 'hidden',
    ...SHEET_WINDOW,
    paddingBottom: 10,
  },
  paramsTabs: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingTop: 12,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  paramsTab: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    paddingVertical: 7,
    paddingHorizontal: 6,
    borderRadius: 999,
  },
  // Lit, not filled - the same way the rail marks the mode in force.
  paramsTabActive: {
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  paramsTabLabel: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.55)',
  },
  paramsTabLabelActive: {
    color: '#fff',
    fontFamily: FONT_BOLD,
  },
  paramsClose: {
    width: 30,
    height: 30,
    alignItems: 'center',
    justifyContent: 'center',
  },
  paramsBody: {
    paddingTop: 6,
    paddingHorizontal: 7,
  },
  // Backing out of one field's values, inside the filter tab. In the
  // window's own header it would read as closing the window.
  paramsBack: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 9,
    paddingHorizontal: 13,
    marginBottom: 2,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  paramsBackLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_BOLD,
    color: '#fff',
  },
  editorSheet: {
    backgroundColor: GLASS_BODY_BLURRED,
    overflow: 'hidden',
    ...SHEET_WINDOW,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: '55%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: GLASS_LINE,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
    marginBottom: 8,
  },
  addFieldRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 8,
    paddingRight: 8,
  },
  addFieldLabel: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT_MUTED,
  },
  editorScroll: {
    // Shrinks to whatever the sheet's own (keyboard-aware) maxHeight
    // leaves after the title and buttons, rather than a fixed height that
    // can't adapt when the keyboard takes half the screen.
    flexShrink: 1,
  },
  editorField: {
    marginBottom: 14,
  },
  editorFieldLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    marginBottom: 6,
  },
  editorFieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT_MUTED,
  },
  optionPickerEmpty: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_FAINT,
    paddingVertical: 12,
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: GLASS_LINE,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
  },
  fieldPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: GLASS_LINE,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 42,
  },
  fieldPressableValue: {
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
  },
  fieldPressablePlaceholder: {
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_FAINT,
  },
  optionChipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    flex: 1,
  },
  optionChip: {
    borderRadius: 999,
    paddingVertical: 4,
    paddingHorizontal: 10,
  },
  optionChipLabel: {
    fontSize: 12,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
  },
  optionDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  optionPickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  optionPickerLabel: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
  },
  relationValueRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minWidth: 0,
  },
  tableCellRelation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  relationSearchInput: {
    borderWidth: 1,
    borderColor: GLASS_LINE,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
    marginBottom: 4,
  },
  relationPickerScroll: {
    maxHeight: 340,
  },
  relationPhotoGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingVertical: 4,
  },
  relationPhotoCell: {
    position: 'relative',
  },
  relationPhotoCheck: {
    position: 'absolute',
    top: 4,
    right: 4,
    backgroundColor: '#fff',
    borderRadius: 10,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 8,
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  cancelLabel: {
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
  },
  saveButton: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
    alignItems: 'center',
  },
  saveLabel: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: '#fff',
  },
  cardMenuBackdrop: {
    backgroundColor: 'rgba(17,24,39,0.45)',
    ...SHEET_BACKDROP,
  },
  cardMenuSheet: {
    backgroundColor: GLASS_BODY_BLURRED,
    overflow: 'hidden',
    ...SHEET_WINDOW,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
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
    color: GLASS_TEXT,
  },
});
