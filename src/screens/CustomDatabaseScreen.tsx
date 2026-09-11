import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  BackHandler,
  Image,
  Keyboard,
  Modal,
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
import { GestureHandlerRootView, ScrollView as GestureScrollView } from 'react-native-gesture-handler';
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
  setDoc,
  updateDoc,
  writeBatch,
} from '@react-native-firebase/firestore';
import {
  GLASS_BODY,
  GLASS_LINE,
  GLASS_TEXT,
  GLASS_TEXT_FAINT,
  GLASS_TEXT_MUTED,
} from '../constants/glass';
import { db } from '../firebase';
import { CustomDatabase, CustomDatabaseRow, CustomDatabaseView, FieldDef, Group } from '../types';
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
import FieldsEditorSheet, { FIELD_TYPE_ICON } from '../components/FieldsEditorSheet';
import ImportTableSheet from '../components/ImportTableSheet';
import PhotoCarousel from '../components/PhotoCarousel';
import UndoToast from '../components/UndoToast';
import TagChips from '../components/TagChips';
import TagPicker from '../components/TagPicker';
import BulkActionBar from '../components/BulkActionBar';
import GroupPickerSheet from '../components/GroupPickerSheet';
import DocumentPickerModal, { PickableDocument } from '../components/DocumentPickerModal';
import TabsTunnel from '../components/TabsTunnel';
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
import { useRail } from '../hooks/useRail';

const ACCENT = '#A05C7B';
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
export default function CustomDatabaseScreen({}: Props) {
  const rail = useRail();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const { databaseId, openRowId, openViewId } = route.params as {
    databaseId: string;
    openRowId?: string;
    openViewId?: string;
  };
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();

  const customRowKind = `customRow:${databaseId}`;
  const prefsKey = `customDb_${databaseId}`;
  const prefsDoc = doc(db, 'settings', prefsKey);

  const [database, setDatabase] = useState<CustomDatabase | null>(null);
  const [rows, setRows] = useState<CustomDatabaseRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupFilter, setGroupFilter] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('list');
  const [menuOpen, setMenuOpen] = useState(false);
  const [paramsCollapsed, setParamsCollapsed] = useState(false);
  const [openParam, setOpenParam] = useState<'view' | 'sort' | 'filter' | 'views' | 'group' | null>(null);
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
  const [deletingDatabase, setDeletingDatabase] = useState(false);
  const [rowEditor, setRowEditor] = useState<RowEditorState | null>(null);
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
    });
  }, [databaseId]);

  useEffect(() => {
    return onSnapshot(collection(db, 'customDatabaseViews'), (snapshot) => {
      setSavedViews(
        snapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<CustomDatabaseView, 'id'>) }))
          .filter((v) => v.databaseId === databaseId)
          .sort((a, b) => a.name.localeCompare(b.name, 'uk', { sensitivity: 'base', numeric: true }))
      );
    });
  }, [databaseId]);

  useEffect(() => {
    // Filtered client-side by databaseId, same "avoid a composite index"
    // tradeoff every other database screen in this app already makes.
    const rowsQuery = query(collection(db, 'customDatabaseRows'), orderBy('updatedAt', 'desc'));
    return onSnapshot(rowsQuery, (snapshot) => {
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
      );
      setIsLoading(false);
    });
  }, [databaseId]);

  useEffect(() => {
    return onSnapshot(collection(db, 'groups'), (snapshot) => {
      setGroups(
        snapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Group, 'id'>) }))
          .filter((g) => groupAppliesTo(g, customRowKind))
      );
    });
  }, [customRowKind]);

  // See photosList's own comment above - unconditional, same as groups/tags.
  useEffect(() => {
    return onSnapshot(collection(db, 'photos'), (snapshot) => {
      setPhotosList(
        snapshot.docs.map((d) => {
          const data = d.data();
          return { id: d.id, imageUri: data.imageUri, title: data.title, driveFileId: data.driveFileId };
        })
      );
    });
  }, []);

  useEffect(() => {
    return onSnapshot(collection(db, 'customDatabases'), (snapshot) => {
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
    return onSnapshot(collection(db, 'customDatabaseRows'), (snapshot) => {
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
      setParamsCollapsed(!!data?.paramsCollapsed);
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
    });
  }, [prefsKey]);

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
  const gridColumns = Math.max(2, Math.min(4, Math.floor(windowWidth / 300)));
  const gridTileWidth = Math.floor(
    (windowWidth - CARD_GRID_PADDING * 2 - CARD_GRID_GAP * (gridColumns - 1)) / gridColumns
  );

  const titleOf = (row: CustomDatabaseRow) => rowTitleOf(database, row);
  const coverField = coverFieldOf(database);
  // The three live caches a row's values resolve against - shared with the
  // same row rendered inside a document (see useCustomRowData), so the
  // resolution rules live in one place instead of once per screen.
  const displayContext: RowDisplayContext = { photos: photosList, relatedDatabases, relatedRows };

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
  const openChipLayout = openParam ? chipLayouts[openParam] ?? null : null;
  // A chip's onLayout position is relative to the scrolling strip's
  // content, not the screen - undo the current scroll offset to place the
  // overlay under where the chip actually sits right now.
  const openChipScreenX = openChipLayout ? stripXRef.current + openChipLayout.x - scrollXRef.current : 0;
  const activeView = savedViews.find((v) => viewMatchesState(v, viewMode, sortPref, filters)) ?? null;
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
    closeParamList();
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
    Alert.alert(view.name, undefined, [
      { text: 'Перейменувати', onPress: () => setViewPrompt({ mode: 'rename', view }) },
      {
        text: 'Видалити',
        style: 'destructive',
        onPress: () => deleteDoc(doc(db, 'customDatabaseViews', view.id)),
      },
      { text: 'Скасувати', style: 'cancel' },
    ]);
  }

  function openParamList(key: 'view' | 'sort' | 'filter' | 'views' | 'group') {
    setFilterFieldId(null);
    setOpenParam((prev) => (prev === key ? null : key));
  }

  function closeParamList() {
    setOpenParam(null);
    setFilterFieldId(null);
  }

  function toggleParamsCollapsed() {
    setDoc(prefsDoc, { paramsCollapsed: !paramsCollapsed }, { merge: true });
  }

  async function renameDatabase(name: string) {
    setRenamingDatabase(false);
    await updateDoc(doc(db, 'customDatabases', databaseId), { name, updatedAt: Date.now() });
  }

  async function saveFields(fields: FieldDef[]) {
    setEditingFields(false);
    await updateDoc(doc(db, 'customDatabases', databaseId), { fields, updatedAt: Date.now() });
  }

  async function deleteDatabaseConfirmed() {
    setDeletingDatabase(false);
    const batch = writeBatch(db);
    rows.forEach((r) => batch.delete(doc(db, 'customDatabaseRows', r.id)));
    // A saved view describes THIS database and nothing else, so it goes
    // with it - otherwise it lingers as a name pointing at nothing.
    savedViews.forEach((v) => batch.delete(doc(db, 'customDatabaseViews', v.id)));
    batch.delete(doc(db, 'customDatabases', databaseId));
    await batch.commit();
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

      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.header} numberOfLines={1}>
            {database.name}
          </Text>
        </View>
      </View>

      {/* Groups and the whole control capsule share one row - the title
          keeps the line above to itself. The capsule's fourth button, the
          gear, is what shows the view/sort capsules below. */}
      <View style={styles.controlsRow}>
        {groups.length > 0 ? (
          <TabsTunnel>
            <ProjectTabsRow
              items={groups}
              selected={groupFilter}
              onSelect={setGroupFilter}
              unassignedLabel="Без групи"
              dark
            />
          </TabsTunnel>
        ) : (
          <View style={styles.controlsSpacer} />
        )}
        <View style={[styles.headerButtons, groups.length > 0 && styles.controlsCapsuleOffset]}>
          <Pressable hitSlop={6} onPress={() => setMenuOpen((v) => !v)}>
            <Ionicons name="ellipsis-horizontal" size={17} color="#fff" />
          </Pressable>
          <View style={styles.headerButtonsDivider} />
          <Pressable
            hitSlop={6}
            onPress={() => {
              // Closing the search clears it too - leaving a filter
              // applied behind a hidden input is how a database looks
              // half-empty for no visible reason.
              setIsSearching((prev) => {
                if (prev) setSearchQuery('');
                return !prev;
              });
            }}
          >
            <Ionicons name={isSearching ? 'close' : 'search'} size={17} color="#fff" />
          </Pressable>
          <View style={styles.headerButtonsDivider} />
          <Pressable hitSlop={6} onPress={toggleSelectMode}>
            <Ionicons name={isSelectMode ? 'close' : 'checkmark-circle-outline'} size={17} color="#fff" />
          </Pressable>
          <View style={styles.headerButtonsDivider} />
          <Pressable hitSlop={6} onPress={toggleParamsCollapsed}>
            <Ionicons name={paramsCollapsed ? 'settings-outline' : 'settings'} size={17} color="#fff" />
          </Pressable>
        </View>
      </View>

      {menuOpen && <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)} />}
      {menuOpen && (
        <View style={styles.menuPanel}>
          {/* View and sort live in the capsule strip below the header, not
              here: they're changed constantly while working, and a menu
              can't show which one is active without being opened. What's
              left is the rare, per-database housekeeping. */}
          <Pressable
            style={styles.menuRow}
            onPress={() => {
              setMenuOpen(false);
              setRenamingDatabase(true);
            }}
          >
            <Ionicons name="pencil-outline" size={17} color={GLASS_TEXT} />
            <Text style={styles.menuRowLabel}>Перейменувати базу</Text>
          </Pressable>
          <Pressable
            style={styles.menuRow}
            onPress={() => {
              setMenuOpen(false);
              setEditingFields(true);
            }}
          >
            <Ionicons name="options-outline" size={17} color={GLASS_TEXT} />
            <Text style={styles.menuRowLabel}>Поля</Text>
          </Pressable>
          <Pressable
            style={styles.menuRow}
            onPress={() => {
              setMenuOpen(false);
              setImporting(true);
            }}
          >
            <Ionicons name="download-outline" size={17} color={GLASS_TEXT} />
            <Text style={styles.menuRowLabel}>Імпортувати таблицю</Text>
          </Pressable>
          <Pressable
            style={styles.menuRow}
            onPress={() => {
              setMenuOpen(false);
              setDeletingDatabase(true);
            }}
          >
            <Ionicons name="trash-outline" size={17} color={DANGER} />
            <Text style={[styles.menuRowLabel, { color: DANGER }]}>Видалити базу</Text>
          </Pressable>
        </View>
      )}

      {!paramsCollapsed && (
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
          contentContainerStyle={styles.paramsStrip}
          onLayout={(e) => {
            setStripY(e.nativeEvent.layout.y);
            stripXRef.current = e.nativeEvent.layout.x;
          }}
        >
          {/* Named slices of this database come first: they set every other
              capsule at once, so they read as the coarse choice the rest
              refine. */}
          <Pressable
            style={[styles.paramChip, !!activeView && styles.paramChipActive]}
            onLayout={(e) => rememberChip('views', e.nativeEvent.layout)}
            onPress={() => openParamList('views')}
          >
            <Ionicons name="bookmark-outline" size={13} color="rgba(255,255,255,0.85)" />
            <Text style={styles.paramChipLabel} numberOfLines={1}>
              {activeView ? activeView.name : 'Вигляди'}
            </Text>
            <Ionicons name="chevron-down" size={12} color="rgba(255,255,255,0.6)" />
          </Pressable>

          <Pressable
            style={styles.paramChip}
            onLayout={(e) => rememberChip('view', e.nativeEvent.layout)}
            onPress={() => openParamList('view')}
          >
            <Ionicons name={VIEW_ICONS[viewMode]} size={13} color="rgba(255,255,255,0.85)" />
            <Text style={styles.paramChipLabel} numberOfLines={1}>
              {VIEW_LABELS[viewMode]}
            </Text>
            <Ionicons name="chevron-down" size={12} color="rgba(255,255,255,0.6)" />
          </Pressable>

          <Pressable
            style={styles.paramChip}
            onLayout={(e) => rememberChip('sort', e.nativeEvent.layout)}
            onPress={() => openParamList('sort')}
          >
            <Ionicons name="swap-vertical-outline" size={13} color="rgba(255,255,255,0.85)" />
            <Text style={styles.paramChipLabel} numberOfLines={1}>
              {sortLabelFor(sortPref, database)} {sortPref.dir === 'asc' ? '↑' : '↓'}
            </Text>
            <Ionicons name="chevron-down" size={12} color="rgba(255,255,255,0.6)" />
          </Pressable>

          {filterFields.length > 0 && (
            <Pressable
              style={[styles.paramChip, filters.length > 0 && styles.paramChipActive]}
              onLayout={(e) => rememberChip('filter', e.nativeEvent.layout)}
              onPress={() => openParamList('filter')}
            >
              <Ionicons name="funnel-outline" size={13} color="rgba(255,255,255,0.85)" />
              <Text style={styles.paramChipLabel} numberOfLines={1}>
                {filters.length > 0 ? `Фільтр · ${filters.length}` : 'Фільтр'}
              </Text>
              <Ionicons name="chevron-down" size={12} color="rgba(255,255,255,0.6)" />
            </Pressable>
          )}

          {groupFields.length > 0 && (
            <Pressable
              style={[styles.paramChip, !!groupField && styles.paramChipActive]}
              onLayout={(e) => rememberChip('group', e.nativeEvent.layout)}
              onPress={() => openParamList('group')}
            >
              <Ionicons name="layers-outline" size={13} color="rgba(255,255,255,0.85)" />
              <Text style={styles.paramChipLabel} numberOfLines={1}>
                {groupField ? groupField.name : 'Групувати'}
              </Text>
              <Ionicons name="chevron-down" size={12} color="rgba(255,255,255,0.6)" />
            </Pressable>
          )}
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
      {openParam !== null && openChipLayout && (
        <View style={styles.paramOverlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeParamList} />
          <View
            style={[
              styles.paramExpanded,
              { top: stripY + openChipLayout.y, minWidth: openChipLayout.width },
              // The filter is the last capsule in the row, so its list is
              // anchored to its RIGHT edge - growing rightward would run
              // off the screen.
              openParam === 'filter'
                ? { right: Math.max(8, windowWidth - openChipScreenX - openChipLayout.width) }
                : { left: openChipScreenX },
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

            {openParam === 'sort' && (
              <>
                <Pressable style={styles.paramExpandedHead} onPress={closeParamList}>
                  <Ionicons name="swap-vertical-outline" size={13} color="#fff" />
                  <Text style={styles.paramChipLabel} numberOfLines={1}>
                    {sortLabelFor(sortPref, database)} {sortPref.dir === 'asc' ? '↑' : '↓'}
                  </Text>
                  <Ionicons name="chevron-up" size={12} color="rgba(255,255,255,0.6)" />
                </Pressable>
                <View style={styles.paramScrollWrap}>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                    {BUILT_IN_SORT_FIELDS.map((field) => (
                      <SortOption
                        key={field}
                        label={BUILT_IN_SORT_LABELS[field]}
                        active={sortPref.field === field}
                        dir={sortPref.dir}
                        onPress={() => {
                          selectSortField(field);
                          if (sortPref.field !== field) closeParamList();
                        }}
                      />
                    ))}
                    {/* The database's own fields continue the same list
                        under a divider - sorting by "Дата зйомки" is the
                        same kind of choice as sorting by "Змінено", just
                        not one every database has. */}
                    {sortFields.length > 0 && <View style={styles.paramDivider} />}
                    {sortFields.map((field) => (
                      <SortOption
                        key={field.id}
                        label={field.name}
                        icon={FIELD_TYPE_ICON[field.type]}
                        active={sortPref.field === field.id}
                        dir={sortPref.dir}
                        onPress={() => {
                          selectSortField(field.id);
                          if (sortPref.field !== field.id) closeParamList();
                        }}
                      />
                    ))}
                  </ScrollView>
                </View>
              </>
            )}

            {openParam === 'group' && (
              <>
                <Pressable style={styles.paramExpandedHead} onPress={closeParamList}>
                  <Ionicons name="layers-outline" size={13} color="#fff" />
                  <Text style={styles.paramChipLabel} numberOfLines={1}>
                    {groupField ? groupField.name : 'Групувати'}
                  </Text>
                  <Ionicons name="chevron-up" size={12} color="rgba(255,255,255,0.6)" />
                </Pressable>
                <View style={styles.paramScrollWrap}>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                    <Pressable style={styles.paramOption} onPress={() => selectGroupField(null)}>
                      <Text style={[styles.paramOptionLabel, !groupField && styles.paramOptionLabelActive]}>
                        Без групування
                      </Text>
                      {!groupField && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </Pressable>
                    {groupFields.map((field) => (
                      <Pressable
                        key={field.id}
                        style={styles.paramOption}
                        onPress={() => selectGroupField(field.id)}
                      >
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
                  </ScrollView>
                </View>
              </>
            )}

            {openParam === 'filter' && (
              <>
                <Pressable
                  style={styles.paramExpandedHead}
                  onPress={() => {
                    // Backing out of a field's values returns to the field
                    // list rather than closing the whole capsule.
                    if (openFilterField) setFilterFieldId(null);
                    else closeParamList();
                  }}
                >
                  <Ionicons name={openFilterField ? 'chevron-back' : 'funnel-outline'} size={13} color="#fff" />
                  <Text style={styles.paramChipLabel} numberOfLines={1}>
                    {openFilterField ? openFilterField.name : 'Фільтр'}
                  </Text>
                  <Ionicons name="chevron-up" size={12} color="rgba(255,255,255,0.6)" />
                </Pressable>
                <View style={styles.paramScrollWrap}>
                  <ScrollView keyboardShouldPersistTaps="handled" nestedScrollEnabled>
                    {!openFilterField &&
                      filterFields.map((field) => {
                        const active = activeFilterFor(filters, field.id);
                        return (
                          <Pressable
                            key={field.id}
                            style={styles.paramOption}
                            onPress={() => setFilterFieldId(field.id)}
                          >
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
                              <Text
                                style={[styles.paramOptionLabel, on && styles.paramOptionLabelActive]}
                                numberOfLines={1}
                              >
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
                  </ScrollView>
                </View>
              </>
            )}
          </View>
        </View>
      )}

      {isSearching && (
        <View style={styles.searchRow}>
          <Ionicons name="search" size={14} color="#9CA3AF" />
          <TextInput
            autoFocus
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Пошук у базі"
            placeholderTextColor="#9CA3AF"
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
            <Ionicons name="grid-outline" size={32} color={ACCENT} />
          </View>
          <Text style={styles.emptyLabel}>{needle ? 'Нічого не знайдено' : 'Ще немає записів'}</Text>
          <Text style={styles.emptyHint}>
            {needle ? 'Спробуйте інше слово' : 'Натисніть "+", щоб додати перший запис'}
          </Text>
        </View>
      ) : viewMode === 'table' ? (
        renderTable()
      ) : viewMode === 'cards' ? (
        <ScrollView contentContainerStyle={[styles.cardGrid, isSelectMode && styles.listWithBulkBar]}>
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
        <ScrollView contentContainerStyle={[styles.list, isSelectMode && styles.listWithBulkBar]}>
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
        <ScrollView contentContainerStyle={[styles.list, isSelectMode && styles.listWithBulkBar]}>
          {displayedRows.map(renderRowCard)}
        </ScrollView>
      )}

      {!isSelectMode && (
        <Pressable style={[styles.fab, { bottom: rail.addBottom }]} onPress={openNewRow}>
          <Ionicons name="add" size={28} color="#fff" />
        </Pressable>
      )}

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
          Alert.alert('Імпортовано', `Додано записів: ${rowCount}`);
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

      <Modal visible={deletingDatabase} transparent animationType="fade" onRequestClose={() => setDeletingDatabase(false)}>
        <View style={styles.glassConfirmBackdrop}>
          <View style={styles.glassConfirmCard}>
            <Text style={styles.glassConfirmTitle}>Видалити базу "{database.name}"?</Text>
            <Text style={styles.glassConfirmBody}>Усі записи ({rows.length}) буде видалено назавжди.</Text>
            <View style={styles.glassConfirmButtons}>
              <Pressable style={styles.glassConfirmButton} onPress={() => setDeletingDatabase(false)}>
                <Text style={styles.glassConfirmButtonLabel}>Скасувати</Text>
              </Pressable>
              <Pressable style={[styles.glassConfirmButton, styles.glassConfirmButtonDanger]} onPress={deleteDatabaseConfirmed}>
                <Text style={styles.glassConfirmButtonLabel}>Видалити</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      {/* The record as a page: a structured reference to read, with editing
          a deliberate step away rather than the only mode.
          Deliberately NOT a Modal. The form opens on top of this, and the
          form's own pickers on top of THAT - as three Modals that is three
          native windows on Android, and the topmost one renders but never
          receives touches. As a plain overlay inside this screen, the page
          costs no window at all and the form/picker pair goes back to the
          two-window arrangement that has always worked. */}
      {rowPageRow !== null && (
          <View style={styles.pageContainer}>
            <View style={styles.pageHeader}>
              <Pressable hitSlop={10} onPress={() => setRowPageId(null)}>
                <Ionicons name="chevron-back" size={24} color="#111827" />
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
      )}

      <Modal visible={rowEditor !== null} transparent animationType="fade" onRequestClose={cancelRowEditor}>
        {/* RN's Modal renders into its own native window on Android, outside
            the app-level GestureHandlerRootView in App.tsx - the
            GestureScrollView below needs its own root re-declared inside it
            or it silently doesn't scroll at all. */}
        <GestureHandlerRootView style={{ flex: 1 }}>
        {/* The dimmed backdrop is a SIBLING behind the sheet, not its
            parent. As a parent (a Pressable wrapping everything, only there
            to stop a tap from closing the sheet) it took the RN touch
            responder for every drag that didn't land on a deeper child -
            which is exactly what kept the field list from scrolling. With
            it behind instead, nothing above the list claims touches, and a
            tap outside the sheet still closes it. */}
        <View style={styles.backdrop}>
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
                marginBottom: keyboardHeight,
                maxHeight: Math.min(windowHeight * 0.85, windowHeight - keyboardHeight - 48),
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
        </GestureHandlerRootView>
      </Modal>

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
          field={cellPicker.field}
          value={rows.find((r) => r.id === cellPicker.rowId)?.values[cellPicker.field.id]}
          onChange={(value) => writeRowValue(cellPicker.rowId, cellPicker.field.id, value)}
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

      <Modal visible={rowMenuRow !== null} transparent animationType="fade" onRequestClose={() => setRowMenuId(null)}>
        <Pressable style={styles.cardMenuBackdrop} onPress={() => setRowMenuId(null)}>
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
                <Ionicons name="document-text-outline" size={18} color="#111827" />
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
              <Ionicons name="folder-outline" size={18} color="#111827" />
              <Text style={styles.cardMenuRowLabel}>Групування</Text>
            </Pressable>
            <Pressable
              style={styles.cardMenuRow}
              onPress={() => {
                if (rowMenuRow) {
                  Alert.alert('Видалити запис?', undefined, [
                    { text: 'Скасувати', style: 'cancel' },
                    { text: 'Видалити', style: 'destructive', onPress: () => deleteRow(rowMenuRow) },
                  ]);
                }
                setRowMenuId(null);
              }}
            >
              <Ionicons name="trash-outline" size={18} color={DANGER} />
              <Text style={[styles.cardMenuRowLabel, { color: DANGER }]}>Видалити</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

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
  onClose,
}: {
  field: FieldDef;
  value: string | number | string[] | undefined;
  onChange: (value: string | string[]) => void;
  onClose: () => void;
}) {
  const isMulti = field.type === 'multiSelect';
  const currentIds = isMulti
    ? Array.isArray(value)
      ? value
      : []
    : value
      ? [value as string]
      : [];

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>{field.name}</Text>
          {(field.options ?? []).length === 0 && (
            <Text style={styles.optionPickerEmpty}>
              У цього поля ще немає варіантів - додайте їх у "..." → "Поля".
            </Text>
          )}
          {(field.options ?? []).map((option) => {
            const selected = currentIds.includes(option.id);
            return (
              <Pressable
                key={option.id}
                style={styles.optionPickerRow}
                onPress={() => {
                  if (isMulti) {
                    onChange(selected ? currentIds.filter((id) => id !== option.id) : [...currentIds, option.id]);
                  } else {
                    // Tapping the already-chosen option clears it, so a
                    // single-select field can be emptied without a separate
                    // "none" row.
                    onChange(selected ? '' : option.id);
                    onClose();
                  }
                }}
              >
                <View style={[styles.optionDot, { backgroundColor: option.color }]} />
                <Text style={styles.optionPickerLabel}>{option.label}</Text>
                {selected && <Ionicons name="checkmark" size={18} color={ACCENT} />}
              </Pressable>
            );
          })}
          {isMulti && (
            <Pressable style={styles.saveButton} onPress={onClose}>
              <Text style={styles.saveLabel}>Готово</Text>
            </Pressable>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// One picker serving a 'relation' field's value, wherever it's edited from
// (the row form's draft, or a tapped table cell - same split OptionPickerSheet
// already makes). Target "Фото" shows a searchable thumbnail grid; target
// another custom database shows a searchable list of its rows by title
// (its own fields[0], same convention as this screen's own titleOf).
function RelationPickerSheet({
  field,
  value,
  photos,
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

  if (isPhotos) {
    const filtered = needle ? photos.filter((p) => (p.title ?? '').toLowerCase().includes(needle)) : photos;
    return (
      <Modal visible transparent animationType="fade" onRequestClose={onClose}>
        <Pressable style={styles.backdrop} onPress={onClose}>
          <Pressable style={[styles.sheet, { marginBottom: keyboardHeight }]} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.title}>{field.name}</Text>
            <TextInput
              style={styles.relationSearchInput}
              value={search}
              onChangeText={setSearch}
              placeholder="Пошук фото"
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
      </Modal>
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
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { marginBottom: keyboardHeight }]} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>{field.name}</Text>
          <TextInput
            style={styles.relationSearchInput}
            value={search}
            onChangeText={setSearch}
            placeholder={relatedDatabase ? `Пошук у "${relatedDatabase.name}"` : 'Пошук'}
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
    </Modal>
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
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={miniStyles.backdrop} onPress={onClose}>
        <Pressable style={miniStyles.card} onPress={() => {}}>
          <View style={miniStyles.navRow}>
            <Pressable hitSlop={10} onPress={() => changeMonth(-1)}>
              <Ionicons name="chevron-back" size={18} color="#111827" />
            </Pressable>
            <Text style={miniStyles.navTitle}>
              {MONTH_FULL[visibleMonth.month]} {visibleMonth.year}
            </Text>
            <Pressable hitSlop={10} onPress={() => changeMonth(1)}>
              <Ionicons name="chevron-forward" size={18} color="#111827" />
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
    </Modal>
  );
}

const miniStyles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: '#fff',
    borderRadius: 16,
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
    color: '#111827',
  },
  weekdayRow: {
    flexDirection: 'row',
  },
  weekdayLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 11,
    color: '#9CA3AF',
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
    color: '#111827',
  },
  dayNumMuted: {
    color: '#D1D5DB',
  },
  dayNumSelected: {
    color: '#fff',
    fontWeight: '700',
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
    gap: 10,
    paddingHorizontal: 20,
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
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
    flexShrink: 1,
  },
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    // A group tab's own vertical metrics instead of a fixed height, so the
    // capsule and the tabs beside it come out exactly the same height.
    paddingVertical: 7,
    borderRadius: 999,
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
  // Above the capsule strip (zIndex 20) and the dropdown overlay (30) -
  // the "..." menu is the topmost thing on this screen while it's open,
  // and at its old zIndex the capsules were drawn straight over it.
  menuBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 60,
  },
  menuPanel: {
    position: 'absolute',
    top: 96,
    right: 20,
    width: 220,
    backgroundColor: GLASS_BODY,
    borderRadius: 14,
    padding: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    zIndex: 61,
  },
  menuSectionLabel: {
    fontSize: 11,
    fontWeight: '700',
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
    // Clears the floating "+" (bottom: 100, 56 tall) so the last row can be
    // scrolled out from under it.
    paddingBottom: 170,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 20,
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
    color: '#6B7280',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 18,
    marginBottom: 4,
  },
  pageSectionHeading: {
    fontSize: 13,
    fontWeight: '700',
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
    color: '#fff',
  },
  groupHeaderCount: {
    fontSize: 13,
    fontWeight: '700',
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
    color: 'rgba(255,255,255,0.75)',
  },
  groupTotalCount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#fff',
  },
  // The record page: a plain light sheet, deliberately not the dark
  // gradient the database list sits on - it reads as a document about one
  // record rather than another view of the list.
  pageContainer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#fff',
    // Above everything this screen draws: the capsule strip (20), an open
    // param dropdown (30) and the "..." menu (60/61).
    zIndex: 100,
  },
  pageHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingTop: 56,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
  },
  pageHeaderTitle: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
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
    color: '#111827',
    marginBottom: 16,
  },
  pageField: {
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 4,
  },
  pageFieldLabel: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  pageFieldValue: {
    fontSize: 16,
    color: '#111827',
  },
  pageFieldEmpty: {
    fontSize: 16,
    color: '#D1D5DB',
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
    color: '#fff',
  },
  backlinkList: {
    gap: 6,
  },
  backlinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.05)',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  backlinkRowLabel: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
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
    paddingHorizontal: 20,
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
    color: 'rgba(255,255,255,0.7)',
  },
  paramOptionCount: {
    fontSize: 12,
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
    color: GLASS_TEXT,
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    // flex-start, not space-between: the tiles now carry exact widths that
    // already account for the gap, so spreading them would double it and
    // leave a short last row strung across the screen.
    justifyContent: 'flex-start',
    paddingHorizontal: CARD_GRID_PADDING,
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
    color: '#fff',
  },
  tableCellEmpty: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.35)',
  },
  tableCellInput: {
    height: TABLE_ROW_HEIGHT - 1,
    fontSize: 13,
    color: '#fff',
    paddingHorizontal: 8,
    paddingVertical: 0,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: GLASS_BODY,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: '70%',
  },
  editorSheet: {
    backgroundColor: GLASS_BODY,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: '85%',
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
    color: GLASS_TEXT,
    marginBottom: 8,
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
    color: GLASS_TEXT_MUTED,
  },
  optionPickerEmpty: {
    fontSize: 13,
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
    color: GLASS_TEXT,
  },
  fieldPressablePlaceholder: {
    fontSize: 15,
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
    color: '#fff',
  },
  glassConfirmBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  glassConfirmCard: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: 'rgba(30,30,34,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 16,
    padding: 20,
  },
  glassConfirmTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  glassConfirmBody: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    marginBottom: 16,
  },
  glassConfirmButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  glassConfirmButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
  },
  glassConfirmButtonDanger: {
    backgroundColor: DANGER,
  },
  glassConfirmButtonLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  cardMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  cardMenuSheet: {
    backgroundColor: GLASS_BODY,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
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
    color: GLASS_TEXT,
  },
});
