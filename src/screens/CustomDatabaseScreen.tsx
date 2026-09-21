import { useEffect, useRef, useState } from 'react';
import { useRecordColour, useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { withAlpha } from '../utils/color';
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
  GLASS_DANGER,
  GLASS_LINE,
  GLASS_TEXT,
  GLASS_TEXT_FAINT,
  GLASS_TEXT_MUTED,
  SHEET_BACKDROP,
  SHEET_WINDOW,
} from '../constants/glass';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { TAG_COLORS, TAG_ICONS } from '../constants/tags';
import { LINK_CATEGORY_INFO, LinkCategory, categoryFromSiteName } from '../utils/linkCategory';
import { refreshLinkPreviewIfExpired } from '../utils/linkPreviewRefresh';
import GlassLayer from '../components/GlassLayer';
import { db } from '../firebase';
import { deleteCustomDatabase } from '../utils/deleteCustomDatabase';
import {
  CustomDatabase,
  CustomDatabaseRow,
  CustomDatabaseView,
  DateRangeValue,
  FieldDef,
  FieldOption,
  FieldType,
  Group,
  RelationTarget,
  ScheduleCellStatus,
} from '../types';
import { groupAppliesTo } from '../utils/groups';
import { hapticSelectItem, hapticSnapTick, hapticSuccess, hapticToggle } from '../utils/haptics';
import CustomRowCard, { CustomRowGridCard, RelationThumb } from '../components/CustomRowCard';
import {
  buildRowDisplay,
  coverFieldOf,
  dateRangeOf,
  displayFieldValue,
  formatDateRange,
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
} from '../utils/customRowQuery';
import { MONTH_FULL, WEEKDAY_SHORT, addDays, dateKey, getMonthGrid, isSameDay, parseDateKey } from '../utils/dateLocale';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { BlurView } from 'expo-blur';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useDockActions, useDockBeads, useDockLeave, useDockShowContext } from '../navigation/navDock';
import { GLASS_ISLAND } from '../constants/glass';
import { CHROME_TOP } from '../constants/rail';
import { useDockClearance } from '../navigation/dockGeometry';
import Menu from '../components/surfaces/Menu';

// The foot the lists keep clear for the dock - DatabaseChrome's reckoning.
// The same half-strength tint the documents screen's add button takes.
const DANGER = '#EF4444';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

const VIEW_LABELS: Record<ViewMode, string> = {
  list: 'Список',
  cards: 'Галерея',
  table: 'Таблиця',
  schedule: 'Графік',
};
const VIEW_ICONS: Record<ViewMode, keyof typeof Ionicons.glyphMap> = {
  list: 'reorder-four-outline',
  cards: 'albums-outline',
  table: 'grid-outline',
  schedule: 'calendar-outline',
};
// A day column's own width, and how tall one row of the grid stands -
// the same two numbers decide the row-header column's height per record
// (see renderSchedule) and each event card's span (a future step).
const SCHEDULE_DAY_WIDTH = 64;
const SCHEDULE_ROW_HEIGHT = 56;
// How many days renderSchedule shows at once - a plain scrolling window
// rather than a real calendar month, since the grid's own columns are
// dates, not weeks; "сьогодні" always starts the window on first open.
const SCHEDULE_WINDOW_DAYS = 60;
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

type ViewMode = 'list' | 'table' | 'cards' | 'schedule';
// The three tabs of the parameters window. They were three buttons on the
// rail and three anchored lists; the user's own call was that they are one
// window with three tabs, "як менше основного екрану по центру" - the
// sheet shape this app already uses everywhere else.
type ParamsTab = 'sort' | 'filter' | 'group' | 'representation';
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
  const theme = useTheme();
  const accent = theme.sections.custom;
  const accentGlass = withAlpha(accent, 0.55);
  const styles = useStyles(makeStyles);
  const recordColour = useRecordColour();
  const isFocused = useIsFocused();
  const insets = useSafeAreaInsets();
  const dockClear = useDockClearance();
  const showContext = useDockShowContext();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // The way out of this database lives in the dock now, under the thumb,
  // the same as every other database (see DatabaseChrome).
  useDockLeave('grid-outline', () => navigation.goBack());
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
  // Which capsule is selected at the top of the screen - null means
  // "Поточні зміни" (the working area: sort/filter/group/representation/
  // hidden fields persist for it same as before, just now explicitly
  // named rather than inferred by matching state against every saved
  // view). A real id means a SAVED view is active - its own stored
  // params drive the display (seeded by the effect below), and further
  // edits through Подача stay purely local until either this changes
  // again or the screen unmounts, never written back to the view or to
  // this prefs doc. Kept in the same prefs doc the rest of the view
  // state already lives in.
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [scheduleSetupVisible, setScheduleSetupVisible] = useState(false);
  // Non-null while editing an EXISTING schedule's own configuration
  // (relation field / date field / manual statuses) rather than creating
  // a new one - "не розумію де ручні статуси... як їх налаштовувати" was
  // exactly this: there was a way to SET them once, at creation, and no
  // way back in afterwards.
  const [scheduleEditView, setScheduleEditView] = useState<CustomDatabaseView | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  // 'params' is the one window that carries sorting, filtering and
  // grouping on three tabs - they were three separate anchored lists, and
  // they are one family: all three change the same list. 'view' and
  // 'views' stay small anchored lists, because they are one short choice
  // each, not a panel.
  const [openParam, setOpenParam] = useState<'params' | null>(null);
  // Which of the three tabs opens first: the one used last in THIS
  // database, so the common case stays one tap plus no thinking. Kept in
  // the same per-database prefs document the sort and the filters are.
  const [paramsTab, setParamsTab] = useState<ParamsTab>('sort');
  const [sortPref, setSortPref] = useState<RowSort>(DEFAULT_ROW_SORT);
  const [filters, setFilters] = useState<RowFilter[]>([]);
  // Which field the list is broken into groups by, if any - each group
  // headed by its own value and count.
  const [groupFieldId, setGroupFieldId] = useState<string | null>(null);
  // Which group headers are collapsed, by the group's own key - session-
  // only (not persisted), same as every other purely-visual fold in this
  // app. Shared by every representation (list/table/gallery), since a
  // group is the same set of rows however the cards themselves are drawn.
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  // This screen's own current property visibility - a field's database-
  // wide `hidden` flag (FieldDef.hidden) always wins, this only ever
  // hides MORE on top of that, per whichever capsule is active (see
  // activeViewId's own comment).
  const [hiddenFieldIds, setHiddenFieldIds] = useState<string[]>([]);
  // Which field's values the filter dropdown is currently showing. null is
  // its top level, the list of fields.
  const [filterFieldId, setFilterFieldId] = useState<string | null>(null);
  const [savedViews, setSavedViews] = useState<CustomDatabaseView[]>([]);
  // Every manual schedule status this account owns, across every schedule
  // view - see ScheduleCellStatus's own comment. Small enough (one row per
  // filled cell of one view) that filtering client-side by the active
  // view's id, same tradeoff every other subscription here already makes,
  // is simpler than a query per view.
  const [scheduleCellStatuses, setScheduleCellStatuses] = useState<ScheduleCellStatus[]>([]);
  // Non-null while the date-range step of assigning/editing a manual
  // status period is open (see openScheduleStatusPicker's own comment) -
  // `existingId` marks editing an already-placed one, absent means this
  // will create a new ScheduleCellStatus once a range is picked.
  const [scheduleStatusTarget, setScheduleStatusTarget] = useState<{
    viewId: string;
    rowId: string;
    statusId: string;
    existingId?: string;
    initialValue: string | DateRangeValue;
  } | null>(null);
  // { mode: 'new' } asks for a name for the current state; { mode: 'rename' }
  // carries the view being renamed.
  const [viewPrompt, setViewPrompt] = useState<{ mode: 'new' } | { mode: 'rename'; view: CustomDatabaseView } | null>(
    null
  );
  // Non-null while "редагувати" (from Налаштування виглядів) has THIS
  // view's own capsule active and Подача open - every edit then writes
  // straight back to the view's own doc instead of staying local or going
  // to the prefs doc (see changeViewMode's own comment). Cleared whenever
  // Подача closes (closeParamList) or a different capsule is picked.
  const [editingViewId, setEditingViewId] = useState<string | null>(null);
  // "Налаштування виглядів" - every saved view with edit/delete/rename/
  // project icons, reached from Параметри.
  const [viewsManagerVisible, setViewsManagerVisible] = useState(false);
  // The quick show/hide-properties list, reached from Параметри - same
  // hiddenFieldIds this screen already carries, just a faster way in than
  // opening a saved view's own full editor first.
  const [quickHiddenSheetVisible, setQuickHiddenSheetVisible] = useState(false);
  // Which view's icon picker is open, while editing that view (see
  // editingViewId) - icon choice is part of "редагування", not its own
  // row button.
  const [iconPickerVisible, setIconPickerVisible] = useState(false);
  // Which view the project picker (GroupPickerSheet) is currently open
  // for, from its own row in Налаштування виглядів.
  const [viewGroupPickerFor, setViewGroupPickerFor] = useState<CustomDatabaseView | null>(null);
  const [iconQuery, setIconQuery] = useState('');
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
  const [draftValues, setDraftValues] = useState<Record<string, string | number | string[] | DateRangeValue>>({});
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
  // Same mirroring for the schedule grid's own date header vs. its
  // horizontally-scrolling body - see renderSchedule.
  const scheduleHeaderScrollRef = useRef<ScrollView>(null);
  const scheduleBodyScrollRef = useRef<ScrollView>(null);
  // Which date the schedule's own visible window starts at - "today" the
  // first time it's opened this session, deliberately not persisted (a
  // schedule always opens on today, the same way a calendar does).
  const [scheduleWindowStart] = useState(() => dateKey(new Date()));
  // This Android build doesn't resize the window under the keyboard - it
  // arrives as an inset over the content, not a shrink - so a bottom sheet
  // needs to track its height itself and push up by that much, same as
  // GroupPickerSheet's own "Новий проект" input.
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
    return onSnapshot(ownedQuery('scheduleCellStatuses'), (snapshot) => {
      setScheduleCellStatuses(snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ScheduleCellStatus, 'id'>) })));
    },
    (error) => setReadError(error.message));
  }, []);

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

  // The prefs doc IS "Поточні зміни" - its own persisted snapshot of
  // sort/filter/group/representation/hidden fields, same fields it has
  // always stored, plus which capsule (activeViewId) is selected. Only
  // actually applied to the live display state below when that capsule is
  // "Поточні зміни" itself (null) - a real saved view's own doc drives the
  // display instead, via the seeding effect right after this one.
  useEffect(() => {
    return onSnapshot(prefsDoc, (snapshot) => {
      const data = snapshot.data();
      const nextActiveViewId = (data?.activeViewId as string | undefined) ?? null;
      setActiveViewId(nextActiveViewId);
      if (nextActiveViewId === null) {
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
        setHiddenFieldIds((data?.hiddenFieldIds as string[] | undefined) ?? []);
      }
      const tab = data?.paramsTab as ParamsTab | undefined;
      setParamsTab(tab === 'filter' || tab === 'group' || tab === 'representation' ? tab : 'sort');
      setReadError(null);
    },
    (error) => setReadError(error.message));
  }, [prefsKey]);

  // Seeds the live display from a SAVED view's own doc, once per capsule
  // switch - guarded by the ref rather than re-seeding on every savedViews
  // refresh, which would otherwise silently discard an in-progress,
  // never-persisted tweak (see activeViewId's own comment) the moment an
  // unrelated write anywhere touched this database's views. Retries on its
  // own once savedViews actually contains the view, so switching to one
  // right after creating it still works before its snapshot round-trips.
  const seededViewIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (activeViewId === null) {
      seededViewIdRef.current = null;
      return;
    }
    if (seededViewIdRef.current === activeViewId) return;
    const view = savedViews.find((v) => v.id === activeViewId);
    if (!view) return;
    seededViewIdRef.current = activeViewId;
    setViewMode(view.viewMode);
    setSortPref({ field: view.sortField, dir: view.sortDir });
    setFilters(view.filters ?? []);
    setGroupFieldId(view.groupFieldId ?? null);
    setHiddenFieldIds(view.hiddenFieldIds ?? []);
  }, [activeViewId, savedViews]);

  // A direct id lookup now, not a match against sort/filter state - every
  // capsule (including a schedule one) is explicitly selected via
  // activeViewId, not inferred, so two views that happen to share
  // leftover sort/filter values can no longer be confused for each other.
  const activeView = activeViewId ? (savedViews.find((v) => v.id === activeViewId) ?? null) : null;
  // What the one parameters button has to say without words: how many of
  // the three are doing something. A sort is always in force, so it only
  // counts when it is not the default one this database opens with.
  const activeParamCount =
    filters.length +
    (groupFieldId ? 1 : 0) +
    (sortPref.field === DEFAULT_ROW_SORT.field && sortPref.dir === DEFAULT_ROW_SORT.dir ? 0 : 1);

  // What a schedule view can be built from: a relation field that points
  // at another database of records (a driver, a vehicle - the schedule's
  // own rows), and a date field to span the columns with. Multi-target
  // relations are left out - a schedule row is one record, and a field
  // holding several would have no single row to pivot into.
  const scheduleRelationFields = database?.fields.filter(
    (f) => f.type === 'relation' && f.relationTarget?.kind === 'customDb' && !f.multiple
  ) ?? [];
  const scheduleDateFields = database?.fields.filter((f) => f.type === 'date') ?? [];
  // Every field an event card COULD also show (a driver, a route) - the
  // sheet itself excludes whichever relation/date field is picked as the
  // row grouping and the card's own span, since those are redundant here.
  const scheduleCardFieldCandidates = (database?.fields ?? []).filter((f) => !f.hidden && f.type !== 'section');

  // Everything this screen offered on the rail goes to the DOCK, as on
  // every database. Search on the left, a record on the right; and the
  // same four actions the shared chrome carries - the shape of the list,
  // its parameters, choosing, and the rare housekeeping. The saved views
  // are a fourth tab of the parameters window rather than a fifth
  // button: a view IS a saved set of those parameters.
  useDockBeads(
    isFocused && !isSelectMode
      ? {
          icon: isSearching ? 'close-outline' : 'search-outline',
          active: isSearching,
          onPress: () => {
            // Closing the search clears it too - leaving a filter
            // applied behind a hidden input is how a database looks
            // half-empty for no visible reason.
            setIsSearching((prev) => {
              if (prev) setSearchQuery('');
              return !prev;
            });
          },
        }
      : null,
    isFocused && !isSelectMode
      ? { icon: 'albums-outline', badge: 'add-circle-outline', onPress: openNewRow }
      : null
  );
  useDockActions(
    isFocused
      ? isSelectMode
        ? [
            {
              key: 'cancel',
              icon: 'close-outline',
              label: 'Вийти',
              onPress: () => {
                showContext();
                toggleSelectMode();
              },
            },
            ...(selectedIds.size > 0
              ? [
                  { key: 'tag', icon: 'pricetag-outline' as const, label: 'Теги', onPress: () => setBulkTagPickerVisible(true) },
                  { key: 'group', icon: 'folder-outline' as const, label: 'Проект', onPress: () => setBulkGroupPickerVisible(true) },
                  { key: 'delete', icon: 'trash-outline' as const, label: 'Видалити', onPress: confirmDeleteSelected },
                ]
              : []),
          ]
        : [
            // "Вигляд" retired - a view is a whole parameter bundle now,
            // not a shape, and switching between saved ones moved to the
            // capsule row above the list (see the viewCapsuleRow render).
            // What used to be that button's own slot is this one: save
            // whatever's currently in force (sort/filter/group/
            // representation/hidden fields, from ANY capsule, tweaked or
            // not) as a brand new view. A schedule's own creation flow is
            // its own dedicated setup sheet, not this generic snapshot.
            {
              key: 'save',
              icon: 'bookmark-outline',
              label: 'Зберегти',
              onPress: confirmSaveNewView,
            },
            // Ordering, narrowing, grouping and representation (list/
            // table/gallery/graphic) - "Подача" (as in HOW the list is
            // served up), same funnel icon the filter tab already used
            // inside it.
            {
              key: 'params',
              icon: 'funnel-outline',
              label: 'Подача',
              active: openParam === 'params' || activeParamCount > 0,
              onPress: () => openParamList('params'),
            },
            { key: 'select', icon: 'checkmark-circle-outline', label: 'Вибір', onPress: () => toggleSelectMode() },
            // The rare, per-database housekeeping (rename, fields, hide/
            // show properties, saved views, import, delete) - "Параметри"
            // freed up from the button that used to be "Вигляд", gear
            // icon since this is genuinely database settings now.
            { key: 'menu', icon: 'settings-outline', label: 'Параметри', active: menuOpen, onPress: () => setMenuOpen((v) => !v) },
          ]
      : null
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
  const gridUsable = windowWidth - CARD_GRID_PADDING * 2;
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

  // buildRowDisplay only knows a field's own database-wide `hidden` flag -
  // this capsule's own extra hiddenFieldIds (see CustomDatabaseView.
  // hiddenFieldIds' own comment) is layered on top here, in list/card
  // rendering's one shared entry point, rather than inside that shared
  // util every OTHER screen embedding a row also calls.
  function rowDisplayFor(row: CustomDatabaseRow) {
    const display = buildRowDisplay(database, row, displayContext);
    if (hiddenFieldIds.length === 0) return display;
    return { ...display, chips: display.chips.filter((c) => !hiddenFieldIds.includes(c.field.id)) };
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

  function toggleGroupCollapsed(key: string) {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  const selectedRows = rows.filter((r) => selectedIds.has(r.id));
  const rowMenuRow = rowMenuId ? rows.find((r) => r.id === rowMenuId) ?? null : null;
  const rowPageRow = rowPageId ? rows.find((r) => r.id === rowPageId) ?? null : null;

  // Where a parameter change actually lands, in order: mid-"редагувати"
  // (editingViewId) writes straight back to that view's own doc; plain
  // "Поточні зміни" (activeViewId null) writes to the prefs doc, same as
  // always; anything else (casually tweaking an active saved view without
  // having opened its editor) is purely local and goes nowhere, exactly
  // as long as that tweak stays on screen (see activeViewId's own
  // comment for why).
  function persistParam(patch: Record<string, unknown>) {
    if (editingViewId) {
      updateDoc(doc(db, 'customDatabaseViews', editingViewId), { ...patch, updatedAt: Date.now() });
    } else if (activeViewId === null) {
      setDoc(prefsDoc, patch, { merge: true });
    }
  }

  function changeViewMode(mode: ViewMode) {
    setViewMode(mode);
    persistParam({ viewMode: mode });
  }

  // Tapping the field already sorted by flips its direction; tapping a
  // different one switches to it with that field's own sensible default
  // direction - the behaviour useSortPref gave the other screens.
  function selectSortField(field: string) {
    const dir = sortPref.field === field ? (sortPref.dir === 'asc' ? 'desc' : 'asc') : defaultDirFor(field, database);
    setSortPref({ field, dir });
    persistParam({ sortField: field, sortDir: dir });
  }

  function applyFilters(next: RowFilter[]) {
    setFilters(next);
    persistParam(editingViewId ? { filters: next } : { rowFilters: next });
  }

  function selectGroupField(fieldId: string | null) {
    setGroupFieldId(fieldId);
    persistParam({ groupFieldId: fieldId ?? deleteField() });
    // Deliberately does NOT close: grouping is one tab of a window whose
    // other tabs stay open after a choice, and closing on this one alone
    // would read as the window falling over.
  }

  function toggleHiddenField(fieldId: string) {
    const next = hiddenFieldIds.includes(fieldId)
      ? hiddenFieldIds.filter((id) => id !== fieldId)
      : [...hiddenFieldIds, fieldId];
    setHiddenFieldIds(next);
    persistParam({ hiddenFieldIds: next });
  }

  // Switches which capsule is active - a real view's own doc seeds the
  // display (see the effect right after the prefs one), "Поточні зміни"
  // (null) reverts to whatever the prefs doc itself last had stored.
  function selectCapsule(viewId: string | null) {
    closeParamList();
    setDoc(prefsDoc, { activeViewId: viewId ?? deleteField() }, { merge: true });
  }

  function applySavedView(view: CustomDatabaseView) {
    selectCapsule(view.id);
  }

  // Always creates a NEW view from whatever is currently on screen -
  // never overwrites the view being looked at, even if its own tweaked
  // state is what's showing (see activeViewId's own comment on why a
  // tweak never quietly becomes the view's new saved state). Lands on the
  // freshly created view right after, so "Зберегти" reads as "and now
  // I'm looking at it."
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
      ...(groupFieldId ? { groupFieldId } : {}),
      ...(hiddenFieldIds.length > 0 ? { hiddenFieldIds } : {}),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    selectCapsule(id);
  }

  // "Зберегти" on the dock - a schedule's own creation flow needs no extra
  // confirmation (its setup sheet already asks for everything up front),
  // but the generic snapshot-as-new-view does, since the dock button sits
  // one accidental tap away from silently multiplying views.
  function confirmSaveNewView() {
    if (viewMode === 'schedule') {
      setScheduleSetupVisible(true);
      return;
    }
    confirm({
      title: 'Зберегти новий вигляд?',
      message: 'Поточні сортування, фільтр, групування, представлення й приховані поля збережуться як окремий вигляд.',
      confirmLabel: 'Зберегти',
      tone: 'primary',
    }).then((yes) => {
      if (yes) setViewPrompt({ mode: 'new' });
    });
  }

  // Keeps a status's own id (and colour) when its label survives an edit
  // unchanged, so cells already tagged with it don't silently go blank -
  // only a genuinely NEW name gets a fresh id, and a removed one is just
  // dropped (any cell still pointing at it renders as empty, which is the
  // same as never having matched anything).
  function mergeManualStatuses(existing: FieldOption[], names: string[]): FieldOption[] {
    return names.map((label, i) => {
      const prior = existing.find((o) => o.label === label);
      return prior ?? { id: generateId(), label, color: TAG_COLORS[(existing.length + i) % TAG_COLORS.length] };
    });
  }

  // 'schedule' is never reached through changeViewMode/saveCurrentAsView -
  // it has real configuration (which relation field supplies the rows,
  // which date field spans the columns) that "the screen's current state"
  // has no place to keep, so it only ever comes from this dedicated flow
  // (see ScheduleViewSetupSheet) rather than from "save what's on screen
  // right now" the other three view modes use.
  async function createScheduleView(
    relationFieldId: string,
    dateFieldId: string,
    name: string,
    statusNames: string[],
    cardFieldIds: string[]
  ) {
    const relationField = database?.fields.find((f) => f.id === relationFieldId);
    if (!relationField || relationField.relationTarget?.kind !== 'customDb') return;
    setScheduleSetupVisible(false);
    const id = generateId();
    const manualStatuses = mergeManualStatuses([], statusNames);
    await setDoc(doc(db, 'customDatabaseViews', id), {
      databaseId,
      name: name.trim() || 'Графік',
      viewMode: 'schedule',
      sortField: sortPref.field,
      sortDir: sortPref.dir,
      filters: [],
      scheduleConfig: {
        rowDatabaseId: relationField.relationTarget.databaseId,
        rowRelationFieldId: relationFieldId,
        dateFieldId,
        ...(manualStatuses.length > 0 ? { manualStatuses } : {}),
        ...(cardFieldIds.length > 0 ? { cardFieldIds } : {}),
      },
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
    selectCapsule(id);
  }

  // The way back in to a schedule's own configuration - see
  // scheduleEditView's own comment on why this exists at all.
  async function updateScheduleView(
    view: CustomDatabaseView,
    relationFieldId: string,
    dateFieldId: string,
    name: string,
    statusNames: string[],
    cardFieldIds: string[]
  ) {
    const relationField = database?.fields.find((f) => f.id === relationFieldId);
    if (!relationField || relationField.relationTarget?.kind !== 'customDb') return;
    setScheduleEditView(null);
    const manualStatuses = mergeManualStatuses(view.scheduleConfig?.manualStatuses ?? [], statusNames);
    await updateDoc(doc(db, 'customDatabaseViews', view.id), {
      name: name.trim() || view.name,
      scheduleConfig: {
        rowDatabaseId: relationField.relationTarget.databaseId,
        rowRelationFieldId: relationFieldId,
        dateFieldId,
        ...(manualStatuses.length > 0 ? { manualStatuses } : {}),
        ...(cardFieldIds.length > 0 ? { cardFieldIds } : {}),
      },
      updatedAt: Date.now(),
    });
  }

  // Reached from the main "Вигляд" picker, right beside Список/Картки/
  // Таблиця - the user's own point: a 4th way to look at the database
  // belongs where the other three live, not buried inside a "Вигляди"
  // tab of a whole separate params window. Picks the first saved
  // schedule if one already exists; otherwise opens the same setup sheet
  // "Створити графік" (still in the "Вигляди" tab too, for whenever a
  // SECOND schedule is wanted later) opens.
  function selectScheduleView() {
    closeParamList();
    const existing = savedViews.find((v) => v.viewMode === 'schedule');
    if (existing) {
      applySavedView(existing);
      return;
    }
    if (scheduleRelationFields.length === 0 || scheduleDateFields.length === 0) {
      notify('Потрібні поля', 'Щоб створити графік, додайте поле-звʼязок на іншу базу і поле дати.');
      return;
    }
    setScheduleSetupVisible(true);
  }

  // Tapping an empty (no event) day cell - "черговий" on a day with no
  // waybill of its own. Nothing to pick when this schedule has no
  // manualStatuses configured, so the cell simply does nothing rather
  // than opening a picker with zero rows in it.
  // A manual status is a PERIOD now - "ремонт" (repair) with a planned end
  // date, extendable, not something clicked onto one day at a time (that
  // was the whole complaint: a multi-week repair needing dozens of taps).
  // Tapping a day already inside one skips straight to editing ITS range
  // - the way back in to extend it past a planned end that's since passed
  // - rather than asking which status again. A brand new one still asks
  // which status first, since the day tapped doesn't say that on its own.
  function openScheduleStatusPicker(
    viewId: string,
    config: NonNullable<CustomDatabaseView['scheduleConfig']>,
    row: CustomDatabaseRow,
    dateKeyStr: string,
    existing: ScheduleCellStatus | undefined
  ) {
    if (existing) {
      setScheduleStatusTarget({
        viewId,
        rowId: row.id,
        statusId: existing.statusId,
        existingId: existing.id,
        initialValue: existing.endDate ? { start: existing.startDate, end: existing.endDate } : existing.startDate,
      });
      return;
    }
    const options = config.manualStatuses ?? [];
    if (options.length === 0) return;
    const rowDatabase = relatedDatabases[config.rowDatabaseId] ?? null;
    ask({
      title: rowTitleOf(rowDatabase, row),
      actions: options.map((o) => ({ id: o.id, label: o.label })),
    }).then((answer) => {
      if (answer === 'cancel') return;
      setScheduleStatusTarget({ viewId, rowId: row.id, statusId: answer, initialValue: dateKeyStr });
    });
  }

  async function saveScheduleStatusRange(range: DateRangeValue) {
    const target = scheduleStatusTarget;
    setScheduleStatusTarget(null);
    if (!target) return;
    if (target.existingId) {
      await updateDoc(doc(db, 'scheduleCellStatuses', target.existingId), {
        startDate: range.start,
        endDate: range.end && range.end !== range.start ? range.end : deleteField(),
        updatedAt: Date.now(),
      });
      return;
    }
    await setDoc(doc(db, 'scheduleCellStatuses', generateId()), {
      viewId: target.viewId,
      rowId: target.rowId,
      statusId: target.statusId,
      startDate: range.start,
      ...(range.end && range.end !== range.start ? { endDate: range.end } : {}),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  }

  function clearScheduleStatusRange() {
    const target = scheduleStatusTarget;
    setScheduleStatusTarget(null);
    if (target?.existingId) deleteDoc(doc(db, 'scheduleCellStatuses', target.existingId));
  }

  async function renameSavedView(view: CustomDatabaseView, name: string) {
    setViewPrompt(null);
    await updateDoc(doc(db, 'customDatabaseViews', view.id), { name: name.trim() || view.name, updatedAt: Date.now() });
  }

  // The "редагувати" icon on a row in Налаштування виглядів - a schedule
  // has its own dedicated setup sheet (relation/date fields, manual
  // statuses) that sort/filter/group/representation mean nothing to, so
  // it gets that instead of the generic edit-in-Подача flow every other
  // representation shares.
  function startEditView(view: CustomDatabaseView) {
    setViewsManagerVisible(false);
    if (view.viewMode === 'schedule') {
      setScheduleEditView(view);
      return;
    }
    selectCapsule(view.id);
    setEditingViewId(view.id);
    openParamList('params');
  }

  function confirmDeleteView(view: CustomDatabaseView) {
    confirm({
      title: 'Видалити вигляд?',
      message: `«${view.name}» більше не буде доступний.`,
      confirmLabel: 'Видалити',
    }).then((yes) => {
      if (!yes) return;
      if (activeViewId === view.id) selectCapsule(null);
      deleteDoc(doc(db, 'customDatabaseViews', view.id));
    });
  }

  function assignViewGroup(groupId: string | null) {
    const view = viewGroupPickerFor;
    setViewGroupPickerFor(null);
    if (!view) return;
    updateDoc(doc(db, 'customDatabaseViews', view.id), { groupId: groupId ?? deleteField(), updatedAt: Date.now() });
  }

  // Icon choice is part of "редагування" itself (see startEditView), not
  // its own row button - only reachable while a view is being edited.
  function setViewIcon(icon: string) {
    setIconPickerVisible(false);
    if (!editingViewId) return;
    updateDoc(doc(db, 'customDatabaseViews', editingViewId), { icon, updatedAt: Date.now() });
  }

  function openParamsTab(tab: ParamsTab) {
    setParamsTab(tab);
    setDoc(prefsDoc, { paramsTab: tab }, { merge: true });
    setOpenParam('params');
  }

  function openParamList(key: 'params') {
    setFilterFieldId(null);
    setOpenParam((prev) => (prev === key ? null : key));
  }

  function closeParamList() {
    setOpenParam(null);
    setFilterFieldId(null);
    // Ends any in-progress "редагувати" session (see startEditView) - the
    // window it was happening in just closed.
    setEditingViewId(null);
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

  function setDraftValue(fieldId: string, value: string | number | string[] | DateRangeValue) {
    setDraftValues((prev) => ({ ...prev, [fieldId]: value }));
  }

  // Writes a single cell straight to its row, by nested field path, so
  // editing one value never rewrites the rest of the row's `values` map.
  async function writeRowValue(rowId: string, fieldId: string, value: string | number | string[] | DateRangeValue) {
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

  function displayValue(field: FieldDef, value: string | number | string[] | DateRangeValue | undefined): string {
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
            <Ionicons name="add" size={16} color={accent} />
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
    const { text, textMuted } = recordColour(item.id);
    return (
      <CustomRowCard
        key={item.id}
        rowId={item.id}
        display={rowDisplayFor(item)}
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
    // Database-wide hidden (visibleFieldsOf) AND this capsule's own extra
    // hidden fields (hiddenFieldIds) - see CustomDatabaseView.hiddenFieldIds'
    // own comment on why a view can hide MORE on top of the field's own flag.
    const restFields = visibleFieldsOf(database).filter(
      (f) => f.id !== firstField?.id && !hiddenFieldIds.includes(f.id)
    );
    const titleWidth = titleColumnWidth(displayedRows.map(titleOf), windowWidth);
    // One flat sequence, group headers and rows alike, rendered in lockstep
    // into BOTH the frozen column and the scrolling one below - same
    // technique renderSchedule already uses for its own two parallel
    // lists, which is what keeps a group header lined up across both
    // halves of a frozen-column table without a second scroll to sync.
    type TableItem =
      | { kind: 'group'; key: string; label: string; count: number; collapsed: boolean }
      | { kind: 'row'; row: CustomDatabaseRow };
    const tableItems: TableItem[] = groupField
      ? rowGroups.flatMap((group) => {
          const key = group.key || '__empty__';
          const collapsed = collapsedGroups.has(key);
          const header: TableItem = { kind: 'group', key, label: group.label, count: group.rows.length, collapsed };
          return collapsed ? [header] : [header, ...group.rows.map((row) => ({ kind: 'row' as const, row }))];
        })
      : displayedRows.map((row) => ({ kind: 'row' as const, row }));
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
              {tableItems.map((item) =>
                item.kind === 'group' ? (
                  <Pressable
                    key={item.key}
                    style={styles.tableGroupHeader}
                    onPress={() => toggleGroupCollapsed(item.key)}
                  >
                    <Ionicons
                      name={item.collapsed ? 'chevron-forward' : 'chevron-down'}
                      size={13}
                      color="rgba(255,255,255,0.6)"
                    />
                    <Text style={styles.groupHeaderLabel} numberOfLines={1}>
                      {item.label}
                    </Text>
                    <Text style={styles.groupHeaderCount}>{item.count}</Text>
                  </Pressable>
                ) : (
                  <View key={item.row.id} style={styles.tableRow}>
                    {/* Tapping a cell edits that one cell; this button is the
                        way to open the whole row as a card, per the user's own
                        "a cell for one value, the card when I want them all". */}
                    <Pressable
                      style={styles.tableRowHandle}
                      onPress={() => (isSelectMode ? toggleSelected(item.row.id) : setRowPageId(item.row.id))}
                      onLongPress={() => setRowMenuId(item.row.id)}
                    >
                      <Ionicons
                        name={
                          isSelectMode
                            ? selectedIds.has(item.row.id)
                              ? 'checkmark-circle'
                              : 'ellipse-outline'
                            : 'open-outline'
                        }
                        size={16}
                        color="rgba(255,255,255,0.75)"
                      />
                    </Pressable>
                    {renderTableCell(item.row, firstField, titleWidth)}
                  </View>
                )
              )}
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
                {tableItems.map((item) =>
                  item.kind === 'group' ? (
                    // Blank on this side - the frozen column already
                    // carries the group's own label, and this only has to
                    // match its height to stay lined up with it.
                    <View key={item.key} style={styles.tableGroupHeaderSpacer} />
                  ) : (
                    <View key={item.row.id} style={styles.tableRow}>
                      {restFields.map((field) => renderTableCell(item.row, field))}
                    </View>
                  )
                )}
              </View>
            </ScrollView>
          </View>
        </ScrollView>
      </View>
    );
  }

  function renderCards() {
    const cardsGrid = (rows: CustomDatabaseRow[]) => (
      <View style={[styles.cardGrid, { paddingHorizontal: CARD_GRID_PADDING }]}>
        {rows.map((row) => (
          <CustomRowGridCard
            key={row.id}
            rowId={row.id}
            width={gridTileWidth}
            display={rowDisplayFor(row)}
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
      </View>
    );

    if (!groupField) {
      return (
        <ScrollView contentContainerStyle={{ paddingBottom: dockClear + insets.bottom }}>
          {cardsGrid(displayedRows)}
        </ScrollView>
      );
    }

    // Same grouping as the list and the table - each group its own tile
    // grid, collapsible the same way.
    return (
      <ScrollView contentContainerStyle={[styles.list, { paddingHorizontal: 0, paddingBottom: dockClear + insets.bottom }]}>
        {rowGroups.map((group) => {
          const key = group.key || '__empty__';
          const collapsed = collapsedGroups.has(key);
          return (
            <View key={key} style={styles.groupSection}>
              <Pressable
                style={[styles.groupHeader, { paddingHorizontal: CARD_GRID_PADDING }]}
                onPress={() => toggleGroupCollapsed(key)}
              >
                <Ionicons
                  name={collapsed ? 'chevron-forward' : 'chevron-down'}
                  size={14}
                  color="rgba(255,255,255,0.6)"
                />
                <Text style={styles.groupHeaderLabel} numberOfLines={1}>
                  {group.label}
                </Text>
                <Text style={styles.groupHeaderCount}>{group.rows.length}</Text>
              </Pressable>
              {!collapsed && cardsGrid(group.rows)}
            </View>
          );
        })}
        <View style={[styles.groupTotal, { paddingHorizontal: CARD_GRID_PADDING }]}>
          <Text style={styles.groupTotalLabel}>Усього</Text>
          <Text style={styles.groupTotalCount}>{displayedRows.length}</Text>
        </View>
      </ScrollView>
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

  // Step 1 of the schedule view: the grid itself (sticky row-header
  // column vs. a horizontally-scrolling stretch of date columns, cribbed
  // from renderTable's own frozen-column/scroll-sync technique above) -
  // no event cards yet (see BoardScreen's own connection-pull comment on
  // why a feature like this ships in verifiable slices rather than all
  // at once). Rows come from the OTHER database scheduleConfig points at
  // (relatedRows), never from this database's own `rows`/`displayedRows` -
  // a schedule with zero waybills yet should still show every driver's
  // own empty row, not the generic "Ще немає записів" state.
  function renderSchedule(viewId: string, config: NonNullable<CustomDatabaseView['scheduleConfig']>) {
    const rowDatabase = relatedDatabases[config.rowDatabaseId] ?? null;
    const rowRecords = relatedRows[config.rowDatabaseId] ?? [];
    const windowStartDate = parseDateKey(scheduleWindowStart);
    const days = Array.from({ length: SCHEDULE_WINDOW_DAYS }, (_, i) => addDays(windowStartDate, i));
    const todayKey = dateKey(new Date());
    const rowHeaderWidth = titleColumnWidth(rowRecords.map((r) => rowTitleOf(rowDatabase, r)), windowWidth);
    // Whole days between two dateKeys - the grid's own columns are exactly
    // one day wide, so this is directly a column-index offset from the
    // window's own first day.
    const dayOffset = (key: string) =>
      Math.round((parseDateKey(key).getTime() - windowStartDate.getTime()) / 86400000);
    // How far into its own 24h a time-of-day sits, as a fraction - "одне
    // поле - 24 години, щоб пропорційно від вибраних годин заповнювалося":
    // an event ending at 09:00 fills 9/24 of its own last day's column,
    // not the whole thing.
    const timeFraction = (time: string | undefined) => {
      if (!time) return null;
      const [h, m] = time.split(':').map(Number);
      return (h * 60 + m) / (24 * 60);
    };
    // Extra fields (a driver, a route) configured to also show on every
    // event card - relation/date fields already used as the row axis or
    // the card's own span are excluded at config time (see
    // scheduleConfig.cardFieldIds), so nothing here repeats those.
    const cardFields = (config.cardFieldIds ?? [])
      .map((id) => database?.fields.find((f) => f.id === id))
      .filter((f): f is FieldDef => f !== undefined);
    // The event's own exact date/time is always shown too, on top of
    // whatever fields are configured - the row needs room for all of it,
    // though the default (no configured fields) case still fits the base
    // row height unchanged.
    const rowHeight = Math.max(SCHEDULE_ROW_HEIGHT, 20 + 16 + (cardFields.length + 1) * 13);

    if (!rowDatabase) {
      return (
        <View style={styles.emptyState}>
          <Ionicons name="alert-circle-outline" size={32} color={accent} />
          <Text style={styles.emptyLabel}>Базу для рядків не знайдено</Text>
          <Text style={styles.emptyHint}>Можливо, її було видалено після створення цього графіка.</Text>
        </View>
      );
    }

    return (
      <View style={styles.tableWrap}>
        <View style={styles.tableHeaderRow}>
          <View style={[styles.tableFrozenHeader, { width: rowHeaderWidth }]} />
          <ScrollView
            horizontal
            ref={scheduleHeaderScrollRef}
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
          >
            {days.map((d) => {
              const key = dateKey(d);
              const isToday = key === todayKey;
              return (
                <View
                  key={key}
                  style={[
                    styles.scheduleDateHeaderCell,
                    isToday && styles.scheduleDateHeaderCellToday,
                    { width: SCHEDULE_DAY_WIDTH },
                  ]}
                >
                  <Text style={styles.scheduleDateHeaderWeekday}>{WEEKDAY_SHORT[(d.getDay() + 6) % 7]}</Text>
                  <Text style={styles.scheduleDateHeaderNum}>{d.getDate()}</Text>
                </View>
              );
            })}
          </ScrollView>
        </View>

        <ScrollView contentContainerStyle={styles.tableBody}>
          <View style={styles.tableBodyRow}>
            <View style={[styles.tableFrozenColumn, { width: rowHeaderWidth }]}>
              {rowRecords.map((row) => (
                <Pressable
                  key={row.id}
                  style={[styles.scheduleRowHeaderCell, { width: rowHeaderWidth, height: rowHeight }]}
                  onPress={() => navigation.navigate('CustomDatabase', { databaseId: config.rowDatabaseId, openRowId: row.id })}
                >
                  <Text style={styles.scheduleRowHeaderLabel} numberOfLines={1}>
                    {rowTitleOf(rowDatabase, row)}
                  </Text>
                </Pressable>
              ))}
              {rowRecords.length === 0 && (
                <View style={styles.scheduleRowHeaderCell}>
                  <Text style={styles.emptyHint}>Немає записів</Text>
                </View>
              )}
            </View>

            <ScrollView
              horizontal
              ref={scheduleBodyScrollRef}
              scrollEventThrottle={16}
              onScroll={(e) =>
                scheduleHeaderScrollRef.current?.scrollTo({ x: e.nativeEvent.contentOffset.x, animated: false })
              }
            >
              <View>
                {rowRecords.map((row) => {
                  // Every row of THIS database (Дорожній лист) whose own
                  // relation field points at this record - never
                  // `displayedRows`, which carries whatever sort/filter
                  // was last set for list/table/cards and has nothing to
                  // do with a schedule (see scheduleConfig's own comment).
                  const events = rows.filter((r) => r.values[config.rowRelationFieldId] === row.id);
                  // Every day index an event already covers on this row -
                  // a manual status only ever applies to a day with
                  // nothing of its own to say already (see BoardLayer's
                  // own hide-vs-lock comment for the same "two things that
                  // could both apply, so decide which wins" shape).
                  const coveredDays = new Set<number>();
                  events.forEach((eventRow) => {
                    const range = dateRangeOf(eventRow.values[config.dateFieldId]);
                    if (!range) return;
                    const s = Math.max(0, dayOffset(range.start));
                    const e = Math.min(SCHEDULE_WINDOW_DAYS - 1, dayOffset(range.end ?? range.start));
                    for (let i = s; i <= e; i++) coveredDays.add(i);
                  });
                  // Every manual status PERIOD on this row - see
                  // ScheduleCellStatus's own comment on why this is a
                  // range now, not one cell per day. statusDays marks
                  // every day one spans, same "no plain tap here, a bar
                  // drawn on top handles it" treatment coveredDays above
                  // already gives an event. `startDate` guards against a
                  // doc from before this change (the old, now-gone
                  // `dateKey` shape) - silently skipped rather than
                  // crashing the whole grid on an undefined date, same as
                  // if it had just been deleted.
                  const statusesForRow = scheduleCellStatuses.filter(
                    (s) => s.viewId === viewId && s.rowId === row.id && !!s.startDate
                  );
                  const statusDays = new Set<number>();
                  statusesForRow.forEach((status) => {
                    const s = Math.max(0, dayOffset(status.startDate));
                    const e = Math.min(SCHEDULE_WINDOW_DAYS - 1, dayOffset(status.endDate ?? status.startDate));
                    for (let i = s; i <= e; i++) statusDays.add(i);
                  });
                  return (
                    <View key={row.id} style={[styles.scheduleRowTrack, { height: rowHeight }]}>
                      {days.map((d, i) => {
                        const key = dateKey(d);
                        if (coveredDays.has(i) || statusDays.has(i)) {
                          return (
                            <View
                              key={key}
                              style={[
                                styles.scheduleDayCell,
                                key === todayKey && styles.scheduleDayCellToday,
                                { width: SCHEDULE_DAY_WIDTH, height: rowHeight },
                              ]}
                            />
                          );
                        }
                        return (
                          <Pressable
                            key={key}
                            style={[
                              styles.scheduleDayCell,
                              key === todayKey && styles.scheduleDayCellToday,
                              { width: SCHEDULE_DAY_WIDTH, height: rowHeight },
                            ]}
                            onPress={() => openScheduleStatusPicker(viewId, config, row, key, undefined)}
                          />
                        );
                      })}
                      {statusesForRow.map((status) => {
                        const statusOption = (config.manualStatuses ?? []).find((o) => o.id === status.statusId);
                        if (!statusOption) return null;
                        const rawStartIdx = dayOffset(status.startDate);
                        const rawEndIdx = dayOffset(status.endDate ?? status.startDate);
                        const startIdx = Math.max(0, rawStartIdx);
                        const endIdx = Math.min(SCHEDULE_WINDOW_DAYS - 1, rawEndIdx);
                        if (endIdx < startIdx) return null;
                        const left = startIdx * SCHEDULE_DAY_WIDTH;
                        const width = (endIdx - startIdx + 1) * SCHEDULE_DAY_WIDTH - 4;
                        return (
                          <Pressable
                            key={status.id}
                            style={[styles.scheduleStatusBar, { left, width, backgroundColor: statusOption.color }]}
                            onPress={() => openScheduleStatusPicker(viewId, config, row, status.startDate, status)}
                          >
                            <Text style={styles.scheduleStatusBarLabel} numberOfLines={1}>
                              {statusOption.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                      {events.map((eventRow) => {
                        const range = dateRangeOf(eventRow.values[config.dateFieldId]);
                        if (!range) return null;
                        const rawStartIdx = dayOffset(range.start);
                        const rawEndIdx = dayOffset(range.end ?? range.start);
                        const startIdx = Math.max(0, rawStartIdx);
                        const endIdx = Math.min(SCHEDULE_WINDOW_DAYS - 1, rawEndIdx);
                        // Entirely before or after the visible window -
                        // "цей тиждень ‹ ›" navigation is a later step, so
                        // for now it's simply not drawn rather than shown
                        // in the wrong place.
                        if (endIdx < startIdx) return null;
                        // The time fraction only ever applies to the
                        // event's OWN real start/end day - a day clipped
                        // by the visible window has nothing of its own to
                        // be a fraction of, so it just fills in full.
                        const startFrac = rawStartIdx === startIdx ? (timeFraction(range.startTime) ?? 0) : 0;
                        const endFrac = rawEndIdx === endIdx ? (timeFraction(range.endTime) ?? 1) : 1;
                        const left = startIdx * SCHEDULE_DAY_WIDTH + startFrac * SCHEDULE_DAY_WIDTH;
                        const right = (endIdx + 1) * SCHEDULE_DAY_WIDTH - (1 - endFrac) * SCHEDULE_DAY_WIDTH;
                        // A minimum width so a short same-day hop (a quick
                        // errand, say) never shrinks to an untappable sliver.
                        const width = Math.max(right - left - 4, 16);
                        return (
                          <Pressable
                            key={eventRow.id}
                            style={[styles.scheduleEventCard, { left, width }]}
                            onPress={() => setRowPageId(eventRow.id)}
                          >
                            <Text style={styles.scheduleEventCardLabel} numberOfLines={1}>
                              {rowTitleOf(database, eventRow)}
                            </Text>
                            {cardFields.map((field) => {
                              const shown = displayFieldValue(field, eventRow.values[field.id], displayContext);
                              return shown ? (
                                <Text key={field.id} style={styles.scheduleEventCardMeta} numberOfLines={1}>
                                  {shown}
                                </Text>
                              ) : null;
                            })}
                            <Text style={styles.scheduleEventCardMeta} numberOfLines={1}>
                              {formatDateRange(range)}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  );
                })}
              </View>
            </ScrollView>
          </View>
        </ScrollView>
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
      <View style={{ height: insets.top + CHROME_TOP + 8 }} />

      {/* Which vigляд is on screen - "Поточні зміни" (the working area,
          always first, per its own comment on activeViewId) plus every
          saved one, Notion-style tabs replacing the old shape popover.
          Switching a capsule is the only thing this row does; managing
          the views themselves (rename/delete/edit/project) lives in
          Параметри → Налаштування виглядів now. */}
      <View style={styles.controlsRow}>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.viewCapsuleRow}
        >
          <Pressable
            style={[styles.viewCapsule, activeViewId === null && styles.viewCapsuleActive]}
            onPress={() => selectCapsule(null)}
          >
            <Ionicons
              name="ellipse-outline"
              size={12}
              color={activeViewId === null ? '#0B1220' : 'rgba(255,255,255,0.75)'}
            />
            <Text style={[styles.viewCapsuleLabel, activeViewId === null && styles.viewCapsuleLabelActive]}>
              Поточні зміни
            </Text>
          </Pressable>
          {savedViews.map((view) => {
            const active = activeViewId === view.id;
            return (
              <Pressable
                key={view.id}
                style={[styles.viewCapsule, active && styles.viewCapsuleActive]}
                onPress={() => selectCapsule(view.id)}
              >
                <Ionicons
                  name={(view.icon as keyof typeof Ionicons.glyphMap | undefined) ?? VIEW_ICONS[view.viewMode]}
                  size={12}
                  color={active ? '#0B1220' : 'rgba(255,255,255,0.75)'}
                />
                <Text style={[styles.viewCapsuleLabel, active && styles.viewCapsuleLabelActive]} numberOfLines={1}>
                  {view.name}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>

      {/* The tabs have this row to themselves now that the capsule stands
          on the rail. */}
      <View style={styles.controlsRow}>
        {groups.length > 0 ? (
          <ProjectTabsRow
            items={groups}
            selected={groupFilter}
            onSelect={setGroupFilter}
            unassignedLabel="Без проекту"
            dark
            endPadding={20}
          />
        ) : (
          <View style={styles.controlsSpacer} />
        )}
      </View>

      <Menu
        visible={menuOpen}
        onClose={() => setMenuOpen(false)}
        // Above the dock, where the button that opens it lives.
        style={{ position: 'absolute', right: 16, bottom: dockClear + insets.bottom }}
        entries={[
          // What the list shows and how it is ordered live on the dock,
          // not here: they're changed constantly while working, and a
          // menu can't show which one is active without being opened.
          // What's left is the rare, per-database housekeeping. Choosing
          // is on the dock too now - "дві кнопки одна функція це невірно".
          { label: 'Перейменувати базу', icon: 'pencil-outline', onPress: () => setRenamingDatabase(true) },
          { label: 'Поля', icon: 'options-outline', onPress: () => setEditingFields(true) },
          // A faster way in than opening a saved view's own editor first
          // just to hide a field before saving a new one - the same
          // hiddenFieldIds every capsule already carries (see
          // toggleHiddenField's own comment).
          { label: 'Показати, приховати властивості', icon: 'eye-off-outline', onPress: () => setQuickHiddenSheetVisible(true) },
          { label: 'Налаштування виглядів', icon: 'bookmark-outline', onPress: () => setViewsManagerVisible(true) },
          { label: 'Імпортувати таблицю', icon: 'download-outline', onPress: () => setImporting(true) },
          { label: 'Видалити базу', icon: 'trash-outline', tone: 'danger', onPress: askToDeleteDatabase },
        ]}
      />

      {/* Sorting, filtering, grouping and representation, in one window
          with four tabs. They started as three buttons on the rail and
          three lists hanging off it; the user's own reading was that they
          are one family - all four change how the same list is served up
          - and that the shape for that is the window this app already
          uses, a smaller screen in the middle of the screen. Representation
          (list/table/gallery/graphic) joined the other three later, once a
          "вигляд" stopped meaning "a shape" and started meaning "a whole
          bundle of parameters" - the shape is just one more of them now.

          The window remembers its tab per database, so the common case is
          one tap and no thinking. Filtering keeps its two levels inside
          its own tab: fields, then that field's values, with the back
          step in the tab's own header rather than the window's. */}
      <GlassLayer visible={openParam === 'params'} onClose={closeParamList}>
        <View style={styles.layerBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={closeParamList} />
          <View style={[styles.paramsSheet, { maxHeight: Math.min(windowHeight * 0.6, 520) }]}>
            {/* Only while "редагувати" (startEditView) brought us here -
                a reminder that changes on every tab below now write
                straight back into this saved view (see persistParam's own
                comment), plus its icon, which is part of "редагування"
                itself rather than its own row button. */}
            {editingViewId && (
              <View style={styles.editingViewBanner}>
                <Pressable
                  style={styles.editingViewIconBtn}
                  onPress={() => {
                    setIconQuery('');
                    setIconPickerVisible(true);
                  }}
                >
                  <Ionicons
                    name={(activeView?.icon as keyof typeof Ionicons.glyphMap | undefined) ?? VIEW_ICONS[viewMode]}
                    size={16}
                    color="#fff"
                  />
                  <Ionicons name="pencil-outline" size={10} color="rgba(255,255,255,0.6)" />
                </Pressable>
                <Text style={styles.editingViewBannerLabel} numberOfLines={1}>
                  Редагування: {activeView?.name ?? ''}
                </Text>
              </View>
            )}
            <View style={styles.paramsTabs}>
              {(
                [
                  { key: 'sort' as const, icon: 'swap-vertical-outline' as const, label: 'Сортування' },
                  { key: 'filter' as const, icon: 'funnel-outline' as const, label: 'Фільтр' },
                  { key: 'group' as const, icon: 'layers-outline' as const, label: 'Групування' },
                  { key: 'representation' as const, icon: 'grid-outline' as const, label: 'Представлення' },
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

              {paramsTab === 'representation' && (
                <>
                  {(['list', 'table', 'cards'] as ViewMode[]).map((mode) => (
                    <Pressable key={mode} style={styles.paramOption} onPress={() => changeViewMode(mode)}>
                      <Ionicons
                        name={VIEW_ICONS[mode]}
                        size={14}
                        color={viewMode === mode ? '#fff' : 'rgba(255,255,255,0.7)'}
                      />
                      <Text style={[styles.paramOptionLabel, viewMode === mode && styles.paramOptionLabelActive]}>
                        {VIEW_LABELS[mode]}
                      </Text>
                      {viewMode === mode && <Ionicons name="checkmark" size={14} color="#fff" />}
                    </Pressable>
                  ))}
                  {/* Graphic needs its own relation/date fields first, so
                      picking it here applies the first existing one or
                      opens its own dedicated setup sheet instead of just
                      flipping a mode flag - see selectScheduleView's own
                      comment. A long press on an existing one is the
                      direct way back into its own config. */}
                  <Pressable
                    style={styles.paramOption}
                    onPress={selectScheduleView}
                    onLongPress={() => {
                      const existing = savedViews.find((v) => v.viewMode === 'schedule');
                      if (existing) startEditView(existing);
                    }}
                  >
                    <Ionicons
                      name={VIEW_ICONS.schedule}
                      size={14}
                      color={viewMode === 'schedule' ? '#fff' : 'rgba(255,255,255,0.7)'}
                    />
                    <Text style={[styles.paramOptionLabel, viewMode === 'schedule' && styles.paramOptionLabelActive]}>
                      {VIEW_LABELS.schedule}
                    </Text>
                    {viewMode === 'schedule' && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </Pressable>
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

      {viewMode === 'schedule' && activeView?.scheduleConfig ? (
        // Its own branch, ahead of the loading/empty gates below: a
        // schedule's rows come from ANOTHER database (relatedRows), so
        // zero rows in THIS one (no waybills yet) must still show every
        // driver's own empty row, not the generic "Ще немає записів".
        renderSchedule(activeView.id, activeView.scheduleConfig)
      ) : isLoading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : displayedRows.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name={readError ? 'lock-closed-outline' : 'grid-outline'} size={32} color={accent} />
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
        renderCards()
      ) : groupField ? (
        // Grouped by one field: a header per value with its own count, and
        // the total under the last group - the "how many working, how many
        // in for repair, how many altogether" read. Collapsible, same as
        // the table and gallery's own grouped rendering.
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: dockClear + insets.bottom }]}>
          {rowGroups.map((group) => {
            const key = group.key || '__empty__';
            const collapsed = collapsedGroups.has(key);
            return (
              <View key={key} style={styles.groupSection}>
                <Pressable style={styles.groupHeader} onPress={() => toggleGroupCollapsed(key)}>
                  <Ionicons
                    name={collapsed ? 'chevron-forward' : 'chevron-down'}
                    size={14}
                    color="rgba(255,255,255,0.6)"
                  />
                  <Text style={styles.groupHeaderLabel} numberOfLines={1}>
                    {group.label}
                  </Text>
                  <Text style={styles.groupHeaderCount}>{group.rows.length}</Text>
                </Pressable>
                {!collapsed && group.rows.map(renderRowCard)}
              </View>
            );
          })}
          <View style={styles.groupTotal}>
            <Text style={styles.groupTotalLabel}>Усього</Text>
            <Text style={styles.groupTotalCount}>{displayedRows.length}</Text>
          </View>
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: dockClear + insets.bottom }]}>
          {displayedRows.map(renderRowCard)}
        </ScrollView>
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

      <ScheduleViewSetupSheet
        visible={scheduleSetupVisible || scheduleEditView !== null}
        editingView={scheduleEditView}
        relationFields={scheduleRelationFields}
        dateFields={scheduleDateFields}
        cardFieldCandidates={scheduleCardFieldCandidates}
        onCancel={() => {
          setScheduleSetupVisible(false);
          setScheduleEditView(null);
        }}
        onSubmit={(relationFieldId, dateFieldId, name, statusNames, cardFieldIds) =>
          scheduleEditView
            ? updateScheduleView(scheduleEditView, relationFieldId, dateFieldId, name, statusNames, cardFieldIds)
            : createScheduleView(relationFieldId, dateFieldId, name, statusNames, cardFieldIds)
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

      {/* A faster way to hide/show a property than opening a saved view's
          own editor first - operates on whatever capsule is active (see
          toggleHiddenField's own comment on where that lands). */}
      <GlassLayer visible={quickHiddenSheetVisible} onClose={() => setQuickHiddenSheetVisible(false)}>
        <View style={styles.layerBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setQuickHiddenSheetVisible(false)} />
          <View style={[styles.paramsSheet, { maxHeight: Math.min(windowHeight * 0.6, 520) }]}>
            <View style={styles.paramsTabs}>
              <Text style={styles.paramsSheetTitle}>Показати, приховати властивості</Text>
              <Pressable hitSlop={8} style={styles.paramsClose} onPress={() => setQuickHiddenSheetVisible(false)}>
                <Ionicons name="close" size={18} color="rgba(255,255,255,0.7)" />
              </Pressable>
            </View>
            <ScrollView style={styles.paramsBody}>
              {(database.fields ?? [])
                .filter((f) => f.type !== 'section')
                .map((field) => {
                  const hidden = hiddenFieldIds.includes(field.id);
                  return (
                    <Pressable key={field.id} style={styles.paramOption} onPress={() => toggleHiddenField(field.id)}>
                      <Ionicons
                        name={hidden ? 'eye-off-outline' : 'eye-outline'}
                        size={16}
                        color={hidden ? 'rgba(255,255,255,0.4)' : '#fff'}
                      />
                      <Text
                        style={[styles.paramOptionLabel, hidden && { color: 'rgba(255,255,255,0.4)' }]}
                        numberOfLines={1}
                      >
                        {field.name}
                      </Text>
                    </Pressable>
                  );
                })}
            </ScrollView>
          </View>
        </View>
      </GlassLayer>

      {/* Every saved view, with its own edit/delete/rename/project icons -
          "Поточні зміни" isn't listed, since it's not a named, manageable
          thing the way a saved view is. */}
      <GlassLayer visible={viewsManagerVisible} onClose={() => setViewsManagerVisible(false)}>
        <View style={styles.layerBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setViewsManagerVisible(false)} />
          <View style={[styles.paramsSheet, { maxHeight: Math.min(windowHeight * 0.6, 520) }]}>
            <View style={styles.paramsTabs}>
              <Text style={styles.paramsSheetTitle}>Налаштування виглядів</Text>
              <Pressable hitSlop={8} style={styles.paramsClose} onPress={() => setViewsManagerVisible(false)}>
                <Ionicons name="close" size={18} color="rgba(255,255,255,0.7)" />
              </Pressable>
            </View>
            <ScrollView style={styles.paramsBody}>
              {savedViews.length === 0 && <Text style={styles.emptyHint}>Ще немає збережених виглядів.</Text>}
              {savedViews.map((view) => (
                <View key={view.id} style={styles.viewManagerRow}>
                  <Ionicons
                    name={(view.icon as keyof typeof Ionicons.glyphMap | undefined) ?? VIEW_ICONS[view.viewMode]}
                    size={16}
                    color="rgba(255,255,255,0.7)"
                  />
                  <Text style={styles.viewManagerRowLabel} numberOfLines={1}>
                    {view.name}
                  </Text>
                  <Pressable hitSlop={8} onPress={() => startEditView(view)}>
                    <Ionicons name="options-outline" size={16} color="rgba(255,255,255,0.7)" />
                  </Pressable>
                  <Pressable hitSlop={8} onPress={() => setViewPrompt({ mode: 'rename', view })}>
                    <Ionicons name="pencil-outline" size={16} color="rgba(255,255,255,0.7)" />
                  </Pressable>
                  <Pressable hitSlop={8} onPress={() => setViewGroupPickerFor(view)}>
                    <Ionicons name="folder-outline" size={16} color="rgba(255,255,255,0.7)" />
                  </Pressable>
                  <Pressable hitSlop={8} onPress={() => confirmDeleteView(view)}>
                    <Ionicons name="trash-outline" size={16} color={DANGER} />
                  </Pressable>
                </View>
              ))}
            </ScrollView>
          </View>
        </View>
      </GlassLayer>

      {/* Icon choice, part of "редагування" (see the banner inside Подача
          above) - a curated set, same one tags already use. */}
      <GlassLayer visible={iconPickerVisible} onClose={() => setIconPickerVisible(false)}>
        <View style={styles.layerBackdrop}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setIconPickerVisible(false)} />
          <View style={[styles.paramsSheet, { maxHeight: Math.min(windowHeight * 0.6, 520) }]}>
            <View style={styles.paramsTabs}>
              <Text style={styles.paramsSheetTitle}>Іконка вигляду</Text>
              <Pressable hitSlop={8} style={styles.paramsClose} onPress={() => setIconPickerVisible(false)}>
                <Ionicons name="close" size={18} color="rgba(255,255,255,0.7)" />
              </Pressable>
            </View>
            <View style={styles.iconSearchRow}>
              <Ionicons name="search" size={14} color="rgba(255,255,255,0.5)" />
              <TextInput
                value={iconQuery}
                onChangeText={setIconQuery}
                placeholder="пошук іконки"
                placeholderTextColor="rgba(255,255,255,0.4)"
                style={styles.iconSearchInput}
              />
            </View>
            <ScrollView style={styles.paramsBody}>
              <View style={styles.iconGrid}>
                {TAG_ICONS.filter((name) => name.includes(iconQuery.trim().toLowerCase())).map((name) => (
                  <Pressable
                    key={name}
                    style={[styles.iconCell, activeView?.icon === name && styles.iconCellSelected]}
                    onPress={() => setViewIcon(name)}
                  >
                    <Ionicons
                      name={name as keyof typeof Ionicons.glyphMap}
                      size={18}
                      color={activeView?.icon === name ? '#0B1220' : 'rgba(255,255,255,0.8)'}
                    />
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          </View>
        </View>
      </GlassLayer>

      <GroupPickerSheet
        visible={viewGroupPickerFor !== null}
        kind={customRowKind}
        groups={groups}
        onPick={assignViewGroup}
        onClose={() => setViewGroupPickerFor(null)}
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
          value={dateRangeOf(draftValues[datePickerField.id]) ?? undefined}
          onPick={(picked) => {
            setDraftValue(datePickerField.id, picked);
            setDatePickerFieldId(null);
          }}
          onClear={() => {
            setDraftValue(datePickerField.id, '');
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
          value={dateRangeOf(rows.find((r) => r.id === cellPicker.rowId)?.values[cellPicker.field.id]) ?? undefined}
          onPick={(picked) => {
            writeRowValue(cellPicker.rowId, cellPicker.field.id, picked);
            setCellPicker(null);
          }}
          onClear={() => {
            writeRowValue(cellPicker.rowId, cellPicker.field.id, '');
            setCellPicker(null);
          }}
          onClose={() => setCellPicker(null)}
        />
      )}

      {/* The date-range step of assigning/editing a manual status period -
          see openScheduleStatusPicker's own comment. */}
      {scheduleStatusTarget && (
        <MiniDatePicker
          value={scheduleStatusTarget.initialValue}
          onPick={saveScheduleStatusRange}
          onClear={clearScheduleStatusRange}
          onClose={() => setScheduleStatusTarget(null)}
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
              <Text style={styles.cardMenuRowLabel}>Проект</Text>
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
  value: string | number | string[] | DateRangeValue | undefined;
  onChange: (value: string | string[]) => void;
  // Adds a variant to the FIELD itself and resolves with its id. The list
  // is the field's, not this row's, so a variant typed here is there for
  // every record from now on - which is the whole point of a list field.
  onCreateOption: (label: string) => Promise<string>;
  onClose: () => void;
}) {
  const accent = useTheme().sections.custom;
  const styles = useStyles(makeStyles);
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
                <Ionicons name="add-circle-outline" size={18} color={accent} />
                <Text style={[styles.optionPickerLabel, { color: accent }]} numberOfLines={1}>
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
                  {selected && <Ionicons name="checkmark" size={18} color={accent} />}
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
  value: string | number | string[] | DateRangeValue | undefined;
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
  const accent = useTheme().sections.custom;
  const styles = useStyles(makeStyles);
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
                  {selectedIds.includes(link.id) && <Ionicons name="checkmark" size={18} color={accent} />}
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
                  {selectedIds.includes(file.id) && <Ionicons name="checkmark" size={18} color={accent} />}
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
                        <Ionicons name="checkmark-circle" size={18} color={accent} />
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
                <Ionicons name="add-circle-outline" size={18} color={accent} />
                <Text style={[styles.optionPickerLabel, { color: accent }]} numberOfLines={1}>
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
                  {selectedIds.includes(r.id) && <Ionicons name="checkmark" size={18} color={accent} />}
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

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

// Standard Ukrainian noun pluralisation for "день" - 1 день, 2-4 дні
// (except the 12-14 exception every ten shares), everything else днів.
function dayWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'день';
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дні';
  return 'днів';
}

// A minimal month-grid date picker built on this app's own dateLocale
// utilities (no native/date-picker dependency) - close kin to
// TasksScreen's ReminderSheet (same stepper pattern for the time-of-day
// controls), but without that one's own notification-kind choice, which
// this field type has no use for.
//
// Range mode - "у Notion дата розтягується початок-кінець, і це в одній
// клітинці", the user's own reference: a "Кінцева дата" switch turns a
// single-day pick into a two-tap one (start, then a later day for the
// end), and tapping an EARLIER day than the current start restarts the
// range from there rather than erroring.
//
// Time - "потрібно вибирати і час... у який час автомобіль вийде, у
// який час автомобіль повернеться": a separate "Час" switch, independent
// of the range one, since a same-day trip still has a departure AND a
// return time - both steppers show together the moment it's on, whether
// or not there's a separate end date.
//
// No tap confirms anything any more, in ANY mode, plain single-day
// included: a mis-tap used to commit the whole pick immediately with no
// way back short of reopening the picker ("натиснув неправильно... треба
// кнопка «Ок» і кнопка закрити картку"). Every tap and every stepper
// press only adjusts the PENDING value; the actions row at the foot is
// the only thing that ever calls back - "Ок" (onPick), "Скасувати"
// (onClose, discards whatever was pending), and "Очистити" (onClear,
// shown only when the field already had a value, wipes it to empty).
function MiniDatePicker({
  value,
  onPick,
  onClear,
  onClose,
}: {
  value?: string | DateRangeValue;
  onPick: (value: DateRangeValue) => void;
  onClear: () => void;
  onClose: () => void;
}) {
  const accent = useTheme().sections.custom;
  const miniStyles = useStyles(makeMiniStyles);
  const initialRange = dateRangeOf(value);
  const initial = initialRange ? parseDateKey(initialRange.start) : new Date();
  const [visibleMonth, setVisibleMonth] = useState({ year: initial.getFullYear(), month: initial.getMonth() });
  const [rangeMode, setRangeMode] = useState(!!initialRange?.end);
  const [pendingStart, setPendingStart] = useState<string | undefined>(initialRange?.start);
  const [pendingEnd, setPendingEnd] = useState<string | undefined>(initialRange?.end);
  // "у який час автомобіль вийде, у який час автомобіль повернеться" -
  // start/end time are independent of whether there's a separate END
  // DATE: a same-day trip still has a departure and a return time, so
  // both steppers show together the moment this is on, range or not.
  const [timeEnabled, setTimeEnabled] = useState(!!(initialRange?.startTime || initialRange?.endTime));
  const [startHour, setStartHour] = useState(() => (initialRange?.startTime ? Number(initialRange.startTime.split(':')[0]) : 9));
  const [startMinute, setStartMinute] = useState(() => (initialRange?.startTime ? Number(initialRange.startTime.split(':')[1]) : 0));
  const [endHour, setEndHour] = useState(() => (initialRange?.endTime ? Number(initialRange.endTime.split(':')[0]) : 18));
  const [endMinute, setEndMinute] = useState(() => (initialRange?.endTime ? Number(initialRange.endTime.split(':')[1]) : 0));
  const grid = getMonthGrid(visibleMonth.year, visibleMonth.month);
  const today = new Date();
  const hasExistingValue = !!initialRange;

  function changeMonth(delta: number) {
    setVisibleMonth((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  function stepStartHour(delta: number) {
    hapticSnapTick();
    setStartHour((h) => (h + delta + 24) % 24);
  }
  function stepStartMinute(delta: number) {
    hapticSnapTick();
    setStartMinute((m) => (m + delta + 60) % 60);
  }
  function stepEndHour(delta: number) {
    hapticSnapTick();
    setEndHour((h) => (h + delta + 24) % 24);
  }
  function stepEndMinute(delta: number) {
    hapticSnapTick();
    setEndMinute((m) => (m + delta + 60) % 60);
  }

  // No tap confirms on its own any more, in ANY mode - a mis-tap used to
  // commit the whole pick immediately, "натиснув неправильно" with no way
  // back short of reopening the picker. Every tap here only adjusts the
  // pending selection; the "Ок" button in the actions row below is the
  // only thing that actually calls onPick, "Скасувати" the only thing
  // that calls onClose, "Очистити" the only thing that calls onClear.
  function handleDayPress(key: string) {
    hapticSelectItem();
    if (!rangeMode) {
      setPendingStart(key);
      return;
    }
    if (!pendingStart || key < pendingStart) {
      setPendingStart(key);
      setPendingEnd(undefined);
      return;
    }
    setPendingEnd(key === pendingStart ? undefined : key);
  }

  function confirm() {
    if (!pendingStart) return;
    hapticSuccess();
    const picked: DateRangeValue = { start: pendingStart };
    if (pendingEnd) picked.end = pendingEnd;
    if (timeEnabled) {
      picked.startTime = `${pad2(startHour)}:${pad2(startMinute)}`;
      picked.endTime = `${pad2(endHour)}:${pad2(endMinute)}`;
    }
    onPick(picked);
  }

  // "скільки днів займе цей діапазон... час має значення при
  // підрахунку" - real elapsed time, not a calendar-day subtraction: a
  // trip from 22:00 to 02:00 the next day is a few hours, not "2 days",
  // and one from 08:00 to 18:00 the day after is over a day even though
  // the calendar dates are only one apart.
  const duration = (() => {
    if (!pendingStart) return null;
    const start = parseDateKey(pendingStart);
    if (timeEnabled) start.setHours(startHour, startMinute, 0, 0);
    const end = parseDateKey(pendingEnd ?? pendingStart);
    if (timeEnabled) end.setHours(endHour, endMinute, 0, 0);
    const ms = end.getTime() - start.getTime();
    if (ms <= 0) return null;
    const totalHours = Math.round(ms / 60000) / 60;
    const days = Math.floor(totalHours / 24);
    const hours = Math.round(totalHours - days * 24);
    if (days === 0) return `${hours} год`;
    if (hours === 0) return `${days} ${dayWord(days)}`;
    return `${days} ${dayWord(days)} ${hours} год`;
  })();

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
          <Pressable
            style={miniStyles.rangeToggleRow}
            onPress={() => {
              const next = !rangeMode;
              hapticToggle(next);
              setRangeMode(next);
              setPendingEnd(undefined);
            }}
          >
            <Ionicons
              name={rangeMode ? 'checkbox' : 'square-outline'}
              size={18}
              color={rangeMode ? GLASS_TEXT : GLASS_TEXT_FAINT}
            />
            <Text style={miniStyles.rangeToggleLabel}>Кінцева дата</Text>
          </Pressable>
          <Pressable
            style={miniStyles.rangeToggleRow}
            onPress={() => {
              const next = !timeEnabled;
              hapticToggle(next);
              setTimeEnabled(next);
            }}
          >
            <Ionicons
              name={timeEnabled ? 'checkbox' : 'square-outline'}
              size={18}
              color={timeEnabled ? GLASS_TEXT : GLASS_TEXT_FAINT}
            />
            <Text style={miniStyles.rangeToggleLabel}>Час</Text>
          </Pressable>
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
                const isSelected = key === pendingStart || key === pendingEnd;
                const isInRange =
                  rangeMode && !!pendingStart && !!pendingEnd && key > pendingStart && key < pendingEnd;
                return (
                  <Pressable key={key} style={miniStyles.dayCell} onPress={() => handleDayPress(key)}>
                    <View style={[miniStyles.dayCellInner, isInRange && miniStyles.dayCellInRange]}>
                      <View
                        style={[
                          miniStyles.dayCircle,
                          isSelected && miniStyles.dayCircleSelected,
                          isToday && !isSelected && miniStyles.dayCircleToday,
                        ]}
                      >
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
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ))}
          {timeEnabled && (
            <View style={miniStyles.timeStepperBlock}>
              <View style={miniStyles.timeStepperRow}>
                <Text style={miniStyles.timeStepperLabel}>Виїзд</Text>
                <View style={miniStyles.stepper}>
                  <Pressable hitSlop={6} style={miniStyles.stepperBtn} onPress={() => stepStartHour(-1)}>
                    <Ionicons name="remove" size={22} color={accent} />
                  </Pressable>
                  <Text style={miniStyles.stepperValue}>{pad2(startHour)}</Text>
                  <Pressable hitSlop={6} style={miniStyles.stepperBtn} onPress={() => stepStartHour(1)}>
                    <Ionicons name="add" size={22} color={accent} />
                  </Pressable>
                </View>
                <Text style={miniStyles.stepperColon}>:</Text>
                <View style={miniStyles.stepper}>
                  <Pressable hitSlop={6} style={miniStyles.stepperBtn} onPress={() => stepStartMinute(-5)}>
                    <Ionicons name="remove" size={22} color={accent} />
                  </Pressable>
                  <Text style={miniStyles.stepperValue}>{pad2(startMinute)}</Text>
                  <Pressable hitSlop={6} style={miniStyles.stepperBtn} onPress={() => stepStartMinute(5)}>
                    <Ionicons name="add" size={22} color={accent} />
                  </Pressable>
                </View>
              </View>
              <View style={miniStyles.timeStepperRow}>
                <Text style={miniStyles.timeStepperLabel}>Повернення</Text>
                <View style={miniStyles.stepper}>
                  <Pressable hitSlop={6} style={miniStyles.stepperBtn} onPress={() => stepEndHour(-1)}>
                    <Ionicons name="remove" size={22} color={accent} />
                  </Pressable>
                  <Text style={miniStyles.stepperValue}>{pad2(endHour)}</Text>
                  <Pressable hitSlop={6} style={miniStyles.stepperBtn} onPress={() => stepEndHour(1)}>
                    <Ionicons name="add" size={22} color={accent} />
                  </Pressable>
                </View>
                <Text style={miniStyles.stepperColon}>:</Text>
                <View style={miniStyles.stepper}>
                  <Pressable hitSlop={6} style={miniStyles.stepperBtn} onPress={() => stepEndMinute(-5)}>
                    <Ionicons name="remove" size={22} color={accent} />
                  </Pressable>
                  <Text style={miniStyles.stepperValue}>{pad2(endMinute)}</Text>
                  <Pressable hitSlop={6} style={miniStyles.stepperBtn} onPress={() => stepEndMinute(5)}>
                    <Ionicons name="add" size={22} color={accent} />
                  </Pressable>
                </View>
              </View>
            </View>
          )}
          {duration && <Text style={miniStyles.durationLabel}>Триває: {duration}</Text>}
          <View style={miniStyles.actionsRow}>
            {hasExistingValue && (
              <Pressable style={miniStyles.clearBtn} onPress={onClear}>
                <Text style={miniStyles.clearBtnLabel}>Очистити</Text>
              </Pressable>
            )}
            <Pressable style={miniStyles.cancelBtn} onPress={onClose}>
              <Text style={miniStyles.cancelBtnLabel}>Скасувати</Text>
            </Pressable>
            <Pressable
              style={[miniStyles.confirmButton, !pendingStart && miniStyles.confirmButtonDisabled]}
              disabled={!pendingStart}
              onPress={confirm}
            >
              <Text style={miniStyles.confirmButtonLabel}>Ок</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </GlassLayer>
  );
}

const makeMiniStyles = (t: Theme) => StyleSheet.create({
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
    // Widened for the time steppers added later - two of them side by
    // side (start/end, each its own hour+minute pair) no longer fit at
    // the calendar's own original 340, and were clipping their last
    // button off the edge.
    maxWidth: 430,
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
  rangeToggleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 6,
    marginBottom: 6,
  },
  rangeToggleLabel: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
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
  // Fills the whole cell (not just the day's own circle), so the range
  // tint between a picked start and end reads as one continuous band
  // rather than a gap between separate circles.
  dayCellInner: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCellInRange: {
    backgroundColor: `${t.sections.custom}26`,
  },
  dayCircle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircleSelected: {
    backgroundColor: t.sections.custom,
  },
  dayCircleToday: {
    borderWidth: 1.5,
    borderColor: t.sections.custom,
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
  timeStepperBlock: {
    marginTop: 8,
    gap: 4,
  },
  timeStepperRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 4,
  },
  timeStepperLabel: {
    width: 92,
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
  },
  // Buttons sit to the LEFT and RIGHT of the number, not stacked above/
  // below it - a thumb tapping either one never covers the digits it's
  // supposed to be changing (same layout ReminderSheet's own stepper uses).
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  // "вибір годин більш крупними елементами" - the user's own ask, applied
  // to both the hour and the minute stepper for a consistent row rather
  // than one obviously bigger than the other.
  stepperBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: GLASS_CARD,
  },
  stepperValue: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
    fontVariant: ['tabular-nums'],
    width: 30,
    textAlign: 'center',
  },
  stepperColon: {
    fontSize: 18,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
  },
  durationLabel: {
    marginTop: 10,
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
    textAlign: 'center',
  },
  actionsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 12,
  },
  clearBtn: {
    paddingHorizontal: 4,
    justifyContent: 'center',
  },
  clearBtnLabel: {
    fontSize: 14,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_DANGER,
  },
  cancelBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 11,
    borderRadius: 14,
    backgroundColor: GLASS_CARD,
  },
  cancelBtnLabel: {
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT,
  },
  confirmButton: {
    flex: 1,
    borderRadius: 14,
    paddingVertical: 11,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.sections.custom,
  },
  confirmButtonDisabled: {
    opacity: 0.4,
  },
  confirmButtonLabel: {
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
    color: '#fff',
  },
  scheduleTitle: {
    fontSize: 17,
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
    marginBottom: 14,
  },
  scheduleSectionLabel: {
    fontSize: 12,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT_FAINT,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginBottom: 6,
    marginTop: 12,
  },
  scheduleOptionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: 12,
    marginBottom: 4,
  },
  scheduleOptionRowActive: {
    backgroundColor: GLASS_CARD,
  },
  scheduleOptionLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
  },
  scheduleNameInput: {
    marginTop: 12,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
    backgroundColor: GLASS_CARD,
  },
});

// Configures a brand-new 'schedule' view - see createScheduleView's own
// comment for why this can't just be "save what's on screen right now"
// the way the other three view modes work. Picks the one relation field
// that supplies the schedule's rows and the one date field that spans
// its columns, both from THIS database's own fields (never the target
// database's) - both lists are pre-filtered by the caller to only the
// eligible ones, so an empty state here never has to be drawn.
function ScheduleViewSetupSheet({
  visible,
  editingView,
  relationFields,
  dateFields,
  cardFieldCandidates,
  onCancel,
  onSubmit,
}: {
  visible: boolean;
  editingView: CustomDatabaseView | null;
  relationFields: FieldDef[];
  dateFields: FieldDef[];
  cardFieldCandidates: FieldDef[];
  onCancel: () => void;
  onSubmit: (
    relationFieldId: string,
    dateFieldId: string,
    name: string,
    statusNames: string[],
    cardFieldIds: string[]
  ) => void;
}) {
  const miniStyles = useStyles(makeMiniStyles);
  const [relationFieldId, setRelationFieldId] = useState<string | null>(null);
  const [dateFieldId, setDateFieldId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [statusesText, setStatusesText] = useState('');
  const [cardFieldIds, setCardFieldIds] = useState<string[]>([]);
  const wasVisibleRef = useRef(false);

  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      const config = editingView?.scheduleConfig;
      setRelationFieldId(config?.rowRelationFieldId ?? relationFields[0]?.id ?? null);
      setDateFieldId(config?.dateFieldId ?? dateFields[0]?.id ?? null);
      setName(editingView?.name ?? '');
      setStatusesText(config?.manualStatuses?.map((s) => s.label).join(', ') ?? '');
      setCardFieldIds(config?.cardFieldIds ?? []);
    }
    wasVisibleRef.current = visible;
  }, [visible, editingView, relationFields, dateFields]);

  function toggleCardField(fieldId: string) {
    setCardFieldIds((prev) => (prev.includes(fieldId) ? prev.filter((id) => id !== fieldId) : [...prev, fieldId]));
  }

  // A card field that got picked as the row grouping or the date span in
  // this same sheet is dropped from its own list rather than left
  // checkable - it would just repeat what the row header/card span
  // already show.
  const availableCardFields = cardFieldCandidates.filter((f) => f.id !== relationFieldId && f.id !== dateFieldId);

  if (!visible) return null;

  return (
    <GlassLayer visible={visible} onClose={onCancel}>
      <Pressable style={miniStyles.backdrop} onPress={onCancel}>
        <Pressable style={miniStyles.card} onPress={() => {}}>
          <Text style={miniStyles.scheduleTitle}>{editingView ? 'Редагувати графік' : 'Новий графік'}</Text>
          <Text style={miniStyles.scheduleSectionLabel}>Рядки за полем</Text>
          {relationFields.map((field) => (
            <Pressable
              key={field.id}
              style={[miniStyles.scheduleOptionRow, field.id === relationFieldId && miniStyles.scheduleOptionRowActive]}
              onPress={() => setRelationFieldId(field.id)}
            >
              <Ionicons
                name={field.id === relationFieldId ? 'radio-button-on' : 'radio-button-off'}
                size={18}
                color={field.id === relationFieldId ? GLASS_TEXT : GLASS_TEXT_FAINT}
              />
              <Text style={miniStyles.scheduleOptionLabel} numberOfLines={1}>
                {field.name}
              </Text>
            </Pressable>
          ))}
          <Text style={miniStyles.scheduleSectionLabel}>Дата</Text>
          {dateFields.map((field) => (
            <Pressable
              key={field.id}
              style={[miniStyles.scheduleOptionRow, field.id === dateFieldId && miniStyles.scheduleOptionRowActive]}
              onPress={() => setDateFieldId(field.id)}
            >
              <Ionicons
                name={field.id === dateFieldId ? 'radio-button-on' : 'radio-button-off'}
                size={18}
                color={field.id === dateFieldId ? GLASS_TEXT : GLASS_TEXT_FAINT}
              />
              <Text style={miniStyles.scheduleOptionLabel} numberOfLines={1}>
                {field.name}
              </Text>
            </Pressable>
          ))}
          <TextInput
            style={miniStyles.scheduleNameInput}
            value={name}
            onChangeText={setName}
            placeholder="Назва графіка"
            placeholderTextColor={GLASS_TEXT_FAINT}
          />
          <Text style={miniStyles.scheduleSectionLabel}>Ручні статуси (необовʼязково)</Text>
          <TextInput
            style={miniStyles.scheduleNameInput}
            value={statusesText}
            onChangeText={setStatusesText}
            placeholder="Наприклад: Черговий, Днювальний"
            placeholderTextColor={GLASS_TEXT_FAINT}
          />
          {availableCardFields.length > 0 && (
            <>
              <Text style={miniStyles.scheduleSectionLabel}>Поля картки (необовʼязково)</Text>
              {availableCardFields.map((field) => {
                const checked = cardFieldIds.includes(field.id);
                return (
                  <Pressable
                    key={field.id}
                    style={[miniStyles.scheduleOptionRow, checked && miniStyles.scheduleOptionRowActive]}
                    onPress={() => toggleCardField(field.id)}
                  >
                    <Ionicons
                      name={checked ? 'checkbox' : 'square-outline'}
                      size={18}
                      color={checked ? GLASS_TEXT : GLASS_TEXT_FAINT}
                    />
                    <Text style={miniStyles.scheduleOptionLabel} numberOfLines={1}>
                      {field.name}
                    </Text>
                  </Pressable>
                );
              })}
            </>
          )}
          <View style={miniStyles.actionsRow}>
            <Pressable style={miniStyles.cancelBtn} onPress={onCancel}>
              <Text style={miniStyles.cancelBtnLabel}>Скасувати</Text>
            </Pressable>
            <Pressable
              style={[miniStyles.confirmButton, (!relationFieldId || !dateFieldId) && miniStyles.confirmButtonDisabled]}
              disabled={!relationFieldId || !dateFieldId}
              onPress={() =>
                relationFieldId &&
                dateFieldId &&
                onSubmit(
                  relationFieldId,
                  dateFieldId,
                  name,
                  statusesText
                    .split(',')
                    .map((s) => s.trim())
                    .filter((s) => s !== ''),
                  cardFieldIds.filter((id) => id !== relationFieldId && id !== dateFieldId)
                )
              }
            >
              <Text style={miniStyles.confirmButtonLabel}>{editingView ? 'Зберегти' : 'Створити'}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </GlassLayer>
  );
}

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
  const styles = useStyles(makeStyles);
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

const makeStyles = (t: Theme) => StyleSheet.create({
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
    backgroundColor: withAlpha(t.sections.custom, 0.55),
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: t.sections.custom,
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
  },
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
    paddingHorizontal: 20,
    gap: 10,
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
  viewCapsuleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingRight: 20,
  },
  viewCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.2)',
  },
  viewCapsuleActive: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  viewCapsuleLabel: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: 'rgba(255,255,255,0.85)',
    maxWidth: 130,
  },
  viewCapsuleLabelActive: {
    color: '#0B1220',
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
    color: t.sections.custom,
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
    backgroundColor: t.sections.custom,
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
    backgroundColor: t.sections.custom,
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
    color: t.sections.custom,
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
    backgroundColor: t.scrim,
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
    justifyContent: 'space-between',
    paddingVertical: 7,
    paddingHorizontal: 13,
  },
  // The tappable icon+label+chevron part of the head - a sibling of the
  // pencil button below rather than the whole head, so the pencil gets
  // its own touch target instead of also closing the popover.
  paramExpandedHeadMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    flex: 1,
  },
  paramExpandedEditBtn: {
    paddingLeft: 8,
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
    // The same padding either side that gridUsable above is worked out
    // against - the dock stands under the grid now, not beside it.
    paddingHorizontal: CARD_GRID_PADDING,
    paddingVertical: 8,
    gap: CARD_GRID_GAP,
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
  // A group header row inside the table - same fixed height on both the
  // frozen and the scrolling side (tableGroupHeaderSpacer) is what keeps
  // the two lined up without a second scroll position to sync.
  tableGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: TABLE_ROW_HEIGHT,
    paddingHorizontal: 8,
  },
  tableGroupHeaderSpacer: {
    height: TABLE_ROW_HEIGHT,
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
  // The schedule grid's own row-header cell - reuses tableWrap/
  // tableHeaderRow/tableFrozenHeader/tableFrozenColumn/tableBody/
  // tableBodyRow wholesale (plain layout containers, nothing table-
  // specific about them) and only needs its own cell styling.
  scheduleRowHeaderCell: {
    height: SCHEDULE_ROW_HEIGHT,
    justifyContent: 'center',
    paddingHorizontal: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  scheduleRowHeaderLabel: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: '#fff',
  },
  scheduleDateHeaderCell: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  scheduleDateHeaderCellToday: {
    backgroundColor: 'rgba(255,255,255,0.15)',
    borderRadius: 10,
  },
  scheduleDateHeaderWeekday: {
    fontSize: 10,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.6)',
  },
  scheduleDateHeaderNum: {
    fontSize: 14,
    fontFamily: FONT_SEMIBOLD,
    color: '#fff',
  },
  scheduleDayCell: {
    height: SCHEDULE_ROW_HEIGHT,
    borderRightWidth: 1,
    borderBottomWidth: 1,
    borderColor: 'rgba(255,255,255,0.12)',
  },
  scheduleDayCellToday: {
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  // One row's whole strip of day cells, PLUS whatever event cards land on
  // it - the day cells lay out as an ordinary flex row (their width is
  // literally the column grid), and the events float on top of that same
  // row by absolute position instead of trying to sit inside one cell.
  scheduleRowTrack: {
    flexDirection: 'row',
    position: 'relative',
    height: SCHEDULE_ROW_HEIGHT,
  },
  scheduleEventCard: {
    position: 'absolute',
    top: 6,
    bottom: 6,
    left: 0,
    borderRadius: 8,
    paddingHorizontal: 8,
    justifyContent: 'center',
    backgroundColor: 'rgba(96,165,250,0.85)',
  },
  scheduleEventCardLabel: {
    fontSize: 12,
    fontFamily: FONT_SEMIBOLD,
    color: '#0B1220',
  },
  // A configured extra field (driver, route) or the event's own exact
  // date/time - smaller and softer than the title line above it.
  scheduleEventCardMeta: {
    fontSize: 10,
    fontFamily: FONT_REGULAR,
    color: 'rgba(11,18,32,0.75)',
  },
  // A manual status PERIOD - "ремонт" - spans its own days the same way
  // an event card does now, not one pill per day (see ScheduleCellStatus's
  // own comment on why).
  scheduleStatusBar: {
    position: 'absolute',
    top: 6,
    bottom: 6,
    left: 0,
    borderRadius: 8,
    paddingHorizontal: 8,
    justifyContent: 'center',
  },
  scheduleStatusBarLabel: {
    fontSize: 11,
    fontFamily: FONT_SEMIBOLD,
    color: '#0B1220',
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
    backgroundColor: t.scrim,
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
  // The title row for the three plain sheets that reuse paramsTabs as a
  // header instead of an actual tab strip (quick hide, views manager,
  // icon picker).
  paramsSheetTitle: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
    color: '#fff',
    paddingLeft: 4,
  },
  paramsBody: {
    paddingTop: 6,
    paddingHorizontal: 7,
  },
  // While "редагувати" (startEditView) is active - see editingViewId.
  editingViewBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 13,
    paddingTop: 12,
    paddingBottom: 4,
  },
  editingViewIconBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  editingViewBannerLabel: {
    flex: 1,
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: 'rgba(255,255,255,0.85)',
  },
  viewManagerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 7,
  },
  viewManagerRowLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: '#fff',
  },
  iconSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 13,
    marginTop: 8,
    marginBottom: 4,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  iconSearchInput: {
    flex: 1,
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: '#fff',
  },
  iconGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 6,
    paddingBottom: 10,
  },
  iconCell: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCellSelected: {
    backgroundColor: '#fff',
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
    backgroundColor: t.sections.custom,
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
    backgroundColor: t.scrim,
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
