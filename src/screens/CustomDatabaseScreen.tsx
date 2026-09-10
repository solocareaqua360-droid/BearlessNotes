import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import { db } from '../firebase';
import { CustomDatabase, CustomDatabaseRow, FieldDef, Group } from '../types';
import { groupAppliesTo } from '../utils/groups';
import { hapticSuccess } from '../utils/haptics';
import CustomRowCard, { CustomRowGridCard, RelationThumb } from '../components/CustomRowCard';
import {
  buildRowDisplay,
  coverFieldOf,
  displayFieldValue,
  resolveRelationValue,
  rowTitleOf,
  visibleFieldsOf,
  RowDisplayContext,
} from '../utils/customRowDisplay';
import { RootStackParamList } from '../navigation';
import RenamePrompt from '../components/RenamePrompt';
import FieldsEditorSheet, { FIELD_TYPE_ICON } from '../components/FieldsEditorSheet';
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
import { useSortPref } from '../hooks/useSortPref';
import { useTags, detachTagFromDeletedItem } from '../hooks/useTags';
import { SortField, sortItems } from '../utils/sortItems';
import { colorForDocument } from '../utils/documentColor';
import { MONTH_FULL, WEEKDAY_SHORT, dateKey, getMonthGrid, isSameDay, parseDateKey } from '../utils/dateLocale';

const ACCENT = '#3B82F6';
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
const SORT_LABELS: Record<SortField, string> = {
  title: 'Назва',
  createdAt: 'Створено',
  updatedAt: 'Змінено',
};

const TABLE_COLUMN_WIDTH = 150;
const TABLE_HANDLE_WIDTH = 34;
// Every cell is exactly this tall so the frozen column and the scrolling
// columns line up row for row - they're two separate stacks, nothing else
// keeps them in step.
const TABLE_ROW_HEIGHT = 46;

type ViewMode = 'list' | 'table' | 'cards';
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
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute();
  const { databaseId, openRowId } = route.params as { databaseId: string; openRowId?: string };
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
  const [openParam, setOpenParam] = useState<'view' | 'sort' | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [renamingDatabase, setRenamingDatabase] = useState(false);
  const [editingFields, setEditingFields] = useState(false);
  const [deletingDatabase, setDeletingDatabase] = useState(false);
  const [rowEditor, setRowEditor] = useState<RowEditorState | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string | number | string[]>>({});
  const [draftTagIds, setDraftTagIds] = useState<string[]>([]);
  const [tagPickerVisible, setTagPickerVisible] = useState(false);
  const [datePickerFieldId, setDatePickerFieldId] = useState<string | null>(null);
  const [selectPickerFieldId, setSelectPickerFieldId] = useState<string | null>(null);
  const [relationPickerFieldId, setRelationPickerFieldId] = useState<string | null>(null);
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

  const { sortPref, selectSortField } = useSortPref(prefsKey);
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
    new Set(
      (database?.fields ?? [])
        .filter((f) => f.type === 'relation' && f.relationTarget?.kind === 'customDb')
        .map((f) => (f.relationTarget as { kind: 'customDb'; databaseId: string }).databaseId)
    )
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

  // Arrived from a 'dbRow' block in a document (see openCustomRowBlock):
  // open that row's editor as soon as the rows are in. The ref makes it a
  // one-shot - closing the editor mustn't reopen it on the next render.
  const openedRowFromParamRef = useRef(false);
  useEffect(() => {
    if (!openRowId || openedRowFromParamRef.current) return;
    const row = rows.find((r) => r.id === openRowId);
    if (!row) return;
    openedRowFromParamRef.current = true;
    openEditRow(row);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openRowId, rows]);

  useEffect(() => {
    return onSnapshot(prefsDoc, (snapshot) => {
      setViewMode((snapshot.data()?.viewMode as ViewMode | undefined) ?? 'list');
      setParamsCollapsed(!!snapshot.data()?.paramsCollapsed);
    });
  }, [prefsKey]);

  if (!database) {
    return (
      <View style={[styles.container, styles.emptyState]}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

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
  const displayedRows = sortItems(
    searchedRows,
    sortPref,
    titleOf,
    (r) => r.createdAt,
    (r) => r.updatedAt
  );
  const selectedRows = rows.filter((r) => selectedIds.has(r.id));
  const rowMenuRow = rowMenuId ? rows.find((r) => r.id === rowMenuId) ?? null : null;

  async function changeViewMode(mode: ViewMode) {
    await setDoc(prefsDoc, { viewMode: mode }, { merge: true });
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
    batch.delete(doc(db, 'customDatabases', databaseId));
    await batch.commit();
    navigation.goBack();
  }

  // The draft row is written to Firestore immediately (empty values), not
  // deferred to "Зберегти" - creating a brand-new tag from inside this form
  // needs a real document to attach its usedIn entry to (createAndAttachTag
  // calls update() on it, which fails outright on a doc that doesn't exist
  // yet). cancelRowEditor cleans this up again if the user backs out.
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

  function renderFieldInput(field: FieldDef) {
    const value = draftValues[field.id];
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
          <Ionicons name="calendar-outline" size={16} color="#9CA3AF" />
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
          <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
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
        <Ionicons name="chevron-down" size={16} color="#9CA3AF" />
      </Pressable>
    );
  }

  const datePickerField = database.fields.find((f) => f.id === datePickerFieldId) ?? null;
  const selectPickerField = database.fields.find((f) => f.id === selectPickerFieldId) ?? null;
  const relationPickerField = database.fields.find((f) => f.id === relationPickerFieldId) ?? null;

  function renderRowCard(item: CustomDatabaseRow) {
    const { text, textMuted } = colorForDocument(item.id);
    return (
      <CustomRowCard
        key={item.id}
        rowId={item.id}
        display={buildRowDisplay(database, item, displayContext)}
        tags={tags.filter((t) => (item.tagIds ?? []).includes(t.id))}
        documentCount={documentIdsOf(item).length}
        onPress={() => (isSelectMode ? toggleSelected(item.id) : openEditRow(item))}
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
    return (
      <View style={styles.tableWrap}>
        <View style={styles.tableHeaderRow}>
          <View style={[styles.tableFrozenHeader, { width: TABLE_HANDLE_WIDTH + TABLE_COLUMN_WIDTH }]}>
            <View style={styles.tableRowHandle} />
            <View style={[styles.tableHeaderCell, { width: TABLE_COLUMN_WIDTH }]}>
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
            <View style={[styles.tableFrozenColumn, { width: TABLE_HANDLE_WIDTH + TABLE_COLUMN_WIDTH }]}>
              {displayedRows.map((row) => (
                <View key={row.id} style={styles.tableRow}>
                  {/* Tapping a cell edits that one cell; this button is the
                      way to open the whole row as a card, per the user's own
                      "a cell for one value, the card when I want them all". */}
                  <Pressable
                    style={styles.tableRowHandle}
                    onPress={() => (isSelectMode ? toggleSelected(row.id) : openEditRow(row))}
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
                  {renderTableCell(row, firstField)}
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

  function renderTableCell(row: CustomDatabaseRow, field: FieldDef) {
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
          style={[styles.tableCellInput, { width: TABLE_COLUMN_WIDTH }]}
          defaultValue={asText}
          placeholder="—"
          placeholderTextColor="rgba(255,255,255,0.3)"
          keyboardType={field.type === 'number' ? 'numeric' : 'default'}
          returnKeyType="done"
          onEndEditing={(e) => commitCellText(row, field, e.nativeEvent.text)}
        />
      );
    }
    if (field.type === 'relation') {
      const resolved = typeof raw === 'string' ? resolveRelation(field, raw) : null;
      return (
        <Pressable
          key={field.id}
          style={[styles.tableCellTap, styles.tableCellRelation, { width: TABLE_COLUMN_WIDTH }]}
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
        style={[styles.tableCellTap, { width: TABLE_COLUMN_WIDTH }]}
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
        <View style={styles.controlsTabs}>
          {/* A capsule squeezed to a line at the point where the scrolling
              tabs run out of room - the "tunnel" they slide into rather
              than being cut off mid-word. It's one oval drawn as two
              halves on either side of the tabs: the near half sits UNDER
              them (a tab covers its edge as it arrives), the far half sits
              OVER them (its edge covers the tab as it leaves) - which is
              what makes it read as a tunnel rather than a pill next to
              the row. Purely visual - neither half catches touches. */}
          {groups.length > 0 && (
            <View style={styles.tabsTunnelNear} pointerEvents="none">
              <View style={[styles.tabsTunnelOval, styles.tabsTunnelOvalNear]} />
            </View>
          )}
          {groups.length > 0 && (
            <ProjectTabsRow
              items={groups}
              selected={groupFilter}
              onSelect={setGroupFilter}
              unassignedLabel="Без групи"
              dark
            />
          )}
          {groups.length > 0 && (
            <View style={styles.tabsTunnelFar} pointerEvents="none">
              <View style={[styles.tabsTunnelOval, styles.tabsTunnelOvalFar]} />
            </View>
          )}
        </View>
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
            <Ionicons name="pencil-outline" size={17} color="#111827" />
            <Text style={styles.menuRowLabel}>Перейменувати базу</Text>
          </Pressable>
          <Pressable
            style={styles.menuRow}
            onPress={() => {
              setMenuOpen(false);
              setEditingFields(true);
            }}
          >
            <Ionicons name="options-outline" size={17} color="#111827" />
            <Text style={styles.menuRowLabel}>Поля</Text>
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

      {/* Closes an open list on a tap anywhere else. It sits BEFORE the
          strip so the strip (and the list itself) still draw above it. */}
      {openParam !== null && <Pressable style={styles.menuBackdrop} onPress={() => setOpenParam(null)} />}

      {!paramsCollapsed && (
        <View style={styles.paramsStrip}>
          <View style={styles.paramGroup}>
            {/* The collapsed pill stays in the layout to hold the row's
                shape; the open state is drawn over it, anchored to the
                same corner, so the capsule reads as stretching downward
                instead of a separate panel appearing under it - and the
                cards below never move. */}
            <View style={styles.paramChip}>
              <Ionicons name={VIEW_ICONS[viewMode]} size={13} color="rgba(255,255,255,0.85)" />
              <Text style={styles.paramChipLabel} numberOfLines={1}>
                {VIEW_LABELS[viewMode]}
              </Text>
              <Ionicons name="chevron-down" size={12} color="rgba(255,255,255,0.6)" />
            </View>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setOpenParam((prev) => (prev === 'view' ? null : 'view'))}
            />
            {openParam === 'view' && (
              <View style={styles.paramExpanded}>
                <Pressable style={styles.paramExpandedHead} onPress={() => setOpenParam(null)}>
                  <Ionicons name={VIEW_ICONS[viewMode]} size={13} color="#fff" />
                  <Text style={styles.paramChipLabel} numberOfLines={1}>
                    {VIEW_LABELS[viewMode]}
                  </Text>
                  <Ionicons name="chevron-up" size={12} color="rgba(255,255,255,0.6)" />
                </Pressable>
                {(['list', 'cards', 'table'] as ViewMode[]).map((mode) => (
                  <Pressable
                    key={mode}
                    style={styles.paramOption}
                    onPress={() => {
                      changeViewMode(mode);
                      setOpenParam(null);
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
              </View>
            )}
          </View>

          <View style={styles.paramGroup}>
            <View style={styles.paramChip}>
              <Ionicons name="swap-vertical-outline" size={13} color="rgba(255,255,255,0.85)" />
              <Text style={styles.paramChipLabel} numberOfLines={1}>
                {SORT_LABELS[sortPref.field]} {sortPref.dir === 'asc' ? '↑' : '↓'}
              </Text>
              <Ionicons name="chevron-down" size={12} color="rgba(255,255,255,0.6)" />
            </View>
            <Pressable
              style={StyleSheet.absoluteFill}
              onPress={() => setOpenParam((prev) => (prev === 'sort' ? null : 'sort'))}
            />
            {openParam === 'sort' && (
              <View style={styles.paramExpanded}>
                <Pressable style={styles.paramExpandedHead} onPress={() => setOpenParam(null)}>
                  <Ionicons name="swap-vertical-outline" size={13} color="#fff" />
                  <Text style={styles.paramChipLabel} numberOfLines={1}>
                    {SORT_LABELS[sortPref.field]} {sortPref.dir === 'asc' ? '↑' : '↓'}
                  </Text>
                  <Ionicons name="chevron-up" size={12} color="rgba(255,255,255,0.6)" />
                </Pressable>
                {(['title', 'createdAt', 'updatedAt'] as SortField[]).map((field) => {
                  const active = sortPref.field === field;
                  return (
                    <Pressable
                      key={field}
                      style={styles.paramOption}
                      // Tapping the chosen field flips its direction rather
                      // than closing on a no-op, as the sort menu this
                      // replaced already did.
                      onPress={() => {
                        selectSortField(field);
                        if (!active) setOpenParam(null);
                      }}
                    >
                      <Text style={[styles.paramOptionLabel, active && styles.paramOptionLabelActive]}>
                        {SORT_LABELS[field]}
                      </Text>
                      {active && (
                        <Ionicons name={sortPref.dir === 'asc' ? 'arrow-up' : 'arrow-down'} size={14} color="#fff" />
                      )}
                    </Pressable>
                  );
                })}
              </View>
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
              display={buildRowDisplay(database, row, displayContext)}
              documentCount={documentIdsOf(row).length}
              onPress={() => (isSelectMode ? toggleSelected(row.id) : openEditRow(row))}
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
      ) : (
        <ScrollView contentContainerStyle={[styles.list, isSelectMode && styles.listWithBulkBar]}>
          {displayedRows.map(renderRowCard)}
        </ScrollView>
      )}

      {!isSelectMode && (
        <Pressable style={styles.fab} onPress={openNewRow}>
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

      <FieldsEditorSheet
        visible={editingFields}
        fields={database.fields}
        otherDatabases={otherDatabases}
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
              {database.fields.map((field) => (
                <View key={field.id} style={styles.editorField}>
                  <View style={styles.editorFieldLabelRow}>
                    <Ionicons name={FIELD_TYPE_ICON[field.type]} size={12} color="#6B7280" />
                    <Text style={styles.editorFieldLabel}>{field.name}</Text>
                  </View>
                  {renderFieldInput(field)}
                </View>
              ))}
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
          onChange={(value) => setDraftValue(relationPickerField.id, value)}
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
          onChange={(value) => writeRowValue(cellPicker.rowId, cellPicker.field.id, value)}
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
              <Ionicons name="pencil-outline" size={18} color="#111827" />
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
  onChange,
  onClose,
}: {
  field: FieldDef;
  value: string | number | string[] | undefined;
  photos: { id: string; imageUri: string; title?: string; driveFileId?: string }[];
  relatedDatabase: CustomDatabase | null;
  relatedRows: CustomDatabaseRow[];
  onChange: (value: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState('');
  const currentId = typeof value === 'string' ? value : undefined;
  const isPhotos = (field.relationTarget?.kind ?? 'photos') === 'photos';
  const needle = search.trim().toLowerCase();

  const clearRow = currentId ? (
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
          <Pressable style={styles.sheet} onPress={() => {}}>
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
                  <Pressable
                    key={photo.id}
                    style={styles.relationPhotoCell}
                    onPress={() => {
                      onChange(photo.id);
                      onClose();
                    }}
                  >
                    <RelationThumb uri={photo.imageUri} driveFileId={photo.driveFileId} size={72} radius={10} />
                    {photo.id === currentId && (
                      <View style={styles.relationPhotoCheck}>
                        <Ionicons name="checkmark-circle" size={18} color={ACCENT} />
                      </View>
                    )}
                  </Pressable>
                ))}
                {filtered.length === 0 && <Text style={styles.optionPickerEmpty}>Немає фото.</Text>}
              </View>
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    );
  }

  const titleFieldId = relatedDatabase?.fields[0]?.id;
  const rowsFiltered = needle
    ? relatedRows.filter((r) => String(r.values[titleFieldId ?? ''] ?? '').toLowerCase().includes(needle))
    : relatedRows;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
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
            {rowsFiltered.map((r) => {
              const title = String(r.values[titleFieldId ?? ''] ?? '').trim() || 'Без назви';
              return (
                <Pressable
                  key={r.id}
                  style={styles.optionPickerRow}
                  onPress={() => {
                    onChange(r.id);
                    onClose();
                  }}
                >
                  <Text style={styles.optionPickerLabel}>{title}</Text>
                  {r.id === currentId && <Ionicons name="checkmark" size={18} color={ACCENT} />}
                </Pressable>
              );
            })}
            {rowsFiltered.length === 0 && <Text style={styles.optionPickerEmpty}>Нічого не знайдено.</Text>}
          </ScrollView>
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

// The tunnel oval the group tabs slide into (see tabsTunnelNear/Far).
const TUNNEL_WIDTH = 10;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
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
    width: 220,
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
  menuDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
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
  // The tabs take whatever the toggle leaves, and scroll within it -
  // minWidth: 0 is what lets a flex child actually shrink below its
  // content instead of pushing the toggle off the row.
  controlsTabs: {
    flex: 1,
    minWidth: 0,
  },
  // The two clipping windows the tunnel oval is drawn through - each
  // shows exactly one half of it, so the halves never overlap (two layers
  // of the same glass would paint a visibly darker seam down the middle).
  // Both hang 2px PAST the tabs ScrollView's right edge, which is what
  // clips the tabs: a tab therefore runs out of view under the far half,
  // 2px inside the oval's far border, never against its near one.
  // Overhang a tab by 4px at each end so the oval reads as the thing the
  // tabs disappear into, not as another pill. (The row carries 10px of
  // padding under its pills, hence the asymmetric top/bottom.)
  tabsTunnelNear: {
    position: 'absolute',
    right: TUNNEL_WIDTH / 2 - 2,
    top: -4,
    bottom: 6,
    width: TUNNEL_WIDTH / 2,
    overflow: 'hidden',
  },
  tabsTunnelFar: {
    position: 'absolute',
    right: -2,
    top: -4,
    bottom: 6,
    width: TUNNEL_WIDTH / 2,
    overflow: 'hidden',
  },
  // The oval itself, at full width inside each half-width window - the
  // window's overflow clip is what leaves only one half of it visible.
  // Same glass as every other capsule here, deliberately: an opaque one
  // did hide the tab, but at the near edge, which read as the tab simply
  // ending early.
  tabsTunnelOval: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: TUNNEL_WIDTH,
    borderRadius: 999,
    backgroundColor: 'rgba(20,20,20,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  tabsTunnelOvalNear: { left: 0 },
  tabsTunnelOvalFar: { right: 0 },
  paramsStrip: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 10,
    // Above the list below, so an open dropdown covers the cards instead
    // of pushing them down the screen.
    zIndex: 20,
  },
  // Holds a capsule and the list it opens. The list is positioned against
  // this, so it lands directly under its own capsule and inherits its
  // left edge whichever capsule was tapped.
  paramGroup: {
    alignItems: 'flex-start',
    zIndex: 20,
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
    fontSize: 13,
    color: 'rgba(255,255,255,0.85)',
    fontWeight: '600',
  },
  // The open capsule: the same glass body as the pill, just taller and
  // squarer, drawn over the collapsed one it replaces.
  paramExpanded: {
    position: 'absolute',
    top: 0,
    left: 0,
    // At least as wide as the pill it grows out of, and no wider unless a
    // label needs it - a fixed width made it noticeably broader than the
    // capsule it's supposed to be a continuation of.
    minWidth: '100%',
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
    color: '#111827',
  },
  cardGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 12,
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
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: '70%',
  },
  editorSheet: {
    backgroundColor: '#fff',
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
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
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
    color: '#6B7280',
  },
  optionPickerEmpty: {
    fontSize: 13,
    color: '#9CA3AF',
    paddingVertical: 12,
  },
  fieldInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
  },
  fieldPressable: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    minHeight: 42,
  },
  fieldPressableValue: {
    fontSize: 15,
    color: '#111827',
  },
  fieldPressablePlaceholder: {
    fontSize: 15,
    color: '#9CA3AF',
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
    color: '#111827',
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
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    fontSize: 14,
    color: '#111827',
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
    color: '#6B7280',
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
    backgroundColor: '#fff',
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
    color: '#111827',
  },
});
