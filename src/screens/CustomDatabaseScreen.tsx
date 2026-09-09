import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
  writeBatch,
} from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { CustomDatabase, CustomDatabaseRow, FieldDef, Group } from '../types';
import { RootStackParamList } from '../navigation';
import RenamePrompt from '../components/RenamePrompt';
import FieldsEditorSheet from '../components/FieldsEditorSheet';
import UndoToast from '../components/UndoToast';
import TagChips from '../components/TagChips';
import TagPicker from '../components/TagPicker';
import BulkActionBar from '../components/BulkActionBar';
import GroupPickerSheet from '../components/GroupPickerSheet';
import ProjectTabsRow, { UNASSIGNED_ID } from '../components/ProjectTabsRow';
import { usePendingDelete } from '../hooks/usePendingDelete';
import { useMultiSelect } from '../hooks/useMultiSelect';
import { useSortPref } from '../hooks/useSortPref';
import { useTags, detachTagFromDeletedItem } from '../hooks/useTags';
import { sortItems } from '../utils/sortItems';
import { colorForDocument } from '../utils/documentColor';
import { MONTH_FULL, WEEKDAY_SHORT, dateKey, getMonthGrid, isSameDay, parseDateKey } from '../utils/dateLocale';
import SortMenuRows from '../components/SortMenuRows';

const ACCENT = '#3B82F6';
const DANGER = '#EF4444';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type ViewMode = 'list' | 'table';
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
  const { databaseId } = route.params as { databaseId: string };
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
  const [renamingDatabase, setRenamingDatabase] = useState(false);
  const [editingFields, setEditingFields] = useState(false);
  const [deletingDatabase, setDeletingDatabase] = useState(false);
  const [rowEditor, setRowEditor] = useState<RowEditorState | null>(null);
  const [draftValues, setDraftValues] = useState<Record<string, string | number | string[]>>({});
  const [draftTagIds, setDraftTagIds] = useState<string[]>([]);
  const [tagPickerVisible, setTagPickerVisible] = useState(false);
  const [datePickerFieldId, setDatePickerFieldId] = useState<string | null>(null);
  const [selectPickerFieldId, setSelectPickerFieldId] = useState<string | null>(null);
  const [rowMenuId, setRowMenuId] = useState<string | null>(null);
  const [bulkGroupPickerVisible, setBulkGroupPickerVisible] = useState(false);
  const [bulkTagPickerVisible, setBulkTagPickerVisible] = useState(false);
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
          .map((d) => ({ id: d.id, ...(d.data() as { name: string; color: string; kind: string }) }))
          .filter((g) => g.kind === customRowKind)
      );
    });
  }, [customRowKind]);

  useEffect(() => {
    return onSnapshot(prefsDoc, (snapshot) => {
      setViewMode((snapshot.data()?.viewMode as ViewMode | undefined) ?? 'list');
    });
  }, [prefsKey]);

  if (!database) {
    return (
      <View style={[styles.container, styles.emptyState]}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  const titleField = database.fields[0];
  const titleOf = (row: CustomDatabaseRow) => String(row.values[titleField?.id] ?? '').trim() || 'Без назви';

  const pendingFilteredRows = filterPending(rows);
  const groupFilteredRows =
    groupFilter === null
      ? pendingFilteredRows
      : groupFilter === UNASSIGNED_ID
        ? pendingFilteredRows.filter((r) => !r.groupId)
        : pendingFilteredRows.filter((r) => r.groupId === groupFilter);
  const displayedRows = sortItems(
    groupFilteredRows,
    sortPref,
    titleOf,
    (r) => r.createdAt,
    (r) => r.updatedAt
  );
  const selectedRows = rows.filter((r) => selectedIds.has(r.id));
  const rowMenuRow = rowMenuId ? rows.find((r) => r.id === rowMenuId) ?? null : null;

  async function changeViewMode(mode: ViewMode) {
    setMenuOpen(false);
    await setDoc(prefsDoc, { viewMode: mode }, { merge: true });
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
    setRowEditor(null);
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

  function displayValue(field: FieldDef, value: string | number | string[] | undefined): string {
    if (value === undefined || value === null || value === '') return '';
    if (field.type === 'date' && typeof value === 'string') {
      // value is already a dateKey ("YYYY-MM-DD") string - just reformat it
      // for display, no need to round-trip through a Date.
      return value.split('-').reverse().join('.');
    }
    if ((field.type === 'select' || field.type === 'multiSelect') && field.options) {
      const ids = Array.isArray(value) ? value : [value as string];
      return ids
        .map((id) => field.options?.find((o) => o.id === id)?.label)
        .filter(Boolean)
        .join(', ');
    }
    return String(value);
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

  function renderRowCard(item: CustomDatabaseRow) {
    const { background, text, textMuted } = colorForDocument(item.id);
    const subtitleFields = database!.fields.slice(1, 3).filter((f) => displayValue(f, item.values[f.id]));
    return (
      <View key={item.id} style={[styles.row, { backgroundColor: background }]}>
        <Pressable style={styles.rowTap} onPress={() => (isSelectMode ? toggleSelected(item.id) : openEditRow(item))}>
          <View style={styles.rowBody}>
            <Text style={[styles.rowTitle, { color: text }]} numberOfLines={2}>
              {titleOf(item)}
            </Text>
            {subtitleFields.length > 0 && (
              <Text style={[styles.rowSubtitle, { color: textMuted }]} numberOfLines={1}>
                {subtitleFields.map((f) => displayValue(f, item.values[f.id])).join(' · ')}
              </Text>
            )}
            <View style={styles.rowMeta}>
              <TagChips tags={tags.filter((t) => (item.tagIds ?? []).includes(t.id))} onPress={() => openEditRow(item)} glass />
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
          <Pressable hitSlop={8} onPress={() => setRowMenuId(item.id)} style={styles.rowActionButton}>
            <Ionicons name="ellipsis-horizontal" size={16} color={textMuted} />
          </Pressable>
        )}
      </View>
    );
  }

  function renderTable() {
    const columnWidth = 150;
    return (
      <ScrollView horizontal contentContainerStyle={isSelectMode ? styles.listWithBulkBar : undefined}>
        <View>
          <View style={styles.tableHeaderRow}>
            {database!.fields.map((field) => (
              <Text key={field.id} style={[styles.tableHeaderCell, { width: columnWidth }]} numberOfLines={1}>
                {field.name}
              </Text>
            ))}
          </View>
          <ScrollView>
            {displayedRows.map((row) => (
              <Pressable
                key={row.id}
                style={styles.tableRow}
                onPress={() => (isSelectMode ? toggleSelected(row.id) : openEditRow(row))}
                onLongPress={() => setRowMenuId(row.id)}
              >
                {database!.fields.map((field) => (
                  <Text key={field.id} style={[styles.tableCell, { width: columnWidth }]} numberOfLines={1}>
                    {displayValue(field, row.values[field.id]) || '—'}
                  </Text>
                ))}
              </Pressable>
            ))}
          </ScrollView>
        </View>
      </ScrollView>
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
        <View style={styles.headerButtons}>
          <Pressable hitSlop={6} onPress={() => setMenuOpen((v) => !v)}>
            <Ionicons name="ellipsis-horizontal" size={17} color="#fff" />
          </Pressable>
          <View style={styles.headerButtonsDivider} />
          <Pressable hitSlop={6} onPress={toggleSelectMode}>
            <Ionicons name={isSelectMode ? 'close' : 'checkmark-circle-outline'} size={17} color="#fff" />
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
          <Pressable style={styles.menuRow} onPress={() => changeViewMode('table')}>
            <Ionicons name="grid-outline" size={17} color="#111827" />
            <Text style={styles.menuRowLabel}>Таблиця</Text>
            {viewMode === 'table' && <Ionicons name="checkmark" size={18} color={ACCENT} />}
          </Pressable>
          <SortMenuRows sortPref={sortPref} onSelectField={selectSortField} accentColor={ACCENT} />
          <View style={styles.menuDivider} />
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

      {groups.length > 0 && (
        <ProjectTabsRow items={groups} selected={groupFilter} onSelect={setGroupFilter} unassignedLabel="Без групи" dark />
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
          <Text style={styles.emptyLabel}>Ще немає записів</Text>
          <Text style={styles.emptyHint}>Натисніть "+", щоб додати перший запис</Text>
        </View>
      ) : viewMode === 'table' ? (
        renderTable()
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

      <FieldsEditorSheet visible={editingFields} fields={database.fields} onSave={saveFields} onClose={() => setEditingFields(false)} />

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
        <Pressable style={styles.backdrop} onPress={cancelRowEditor}>
          <Pressable style={[styles.editorSheet, { marginBottom: keyboardHeight }]} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.title}>{rowEditor?.mode === 'new' ? 'Новий запис' : 'Редагувати запис'}</Text>
            <ScrollView style={styles.editorScroll}>
              {database.fields.map((field) => (
                <View key={field.id} style={styles.editorField}>
                  <Text style={styles.editorFieldLabel}>{field.name}</Text>
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
            </ScrollView>
            <View style={styles.buttons}>
              <Pressable style={styles.cancelButton} onPress={cancelRowEditor}>
                <Text style={styles.cancelLabel}>Скасувати</Text>
              </Pressable>
              <Pressable style={styles.saveButton} onPress={saveRow}>
                <Text style={styles.saveLabel}>Зберегти</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
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
        <Modal visible transparent animationType="fade" onRequestClose={() => setSelectPickerFieldId(null)}>
          <Pressable style={styles.backdrop} onPress={() => setSelectPickerFieldId(null)}>
            <Pressable style={styles.sheet} onPress={() => {}}>
              <View style={styles.handle} />
              <Text style={styles.title}>{selectPickerField.name}</Text>
              {(selectPickerField.options ?? []).map((option) => {
                const current = draftValues[selectPickerField.id];
                const isMulti = selectPickerField.type === 'multiSelect';
                const currentIds = isMulti ? (Array.isArray(current) ? current : []) : current ? [current as string] : [];
                const selected = currentIds.includes(option.id);
                return (
                  <Pressable
                    key={option.id}
                    style={styles.optionPickerRow}
                    onPress={() => {
                      if (isMulti) {
                        setDraftValue(
                          selectPickerField.id,
                          selected ? currentIds.filter((id) => id !== option.id) : [...currentIds, option.id]
                        );
                      } else {
                        setDraftValue(selectPickerField.id, option.id);
                        setSelectPickerFieldId(null);
                      }
                    }}
                  >
                    <View style={[styles.optionDot, { backgroundColor: option.color }]} />
                    <Text style={styles.optionPickerLabel}>{option.label}</Text>
                    {selected && <Ionicons name="checkmark" size={18} color={ACCENT} />}
                  </Pressable>
                );
              })}
              {selectPickerField.type === 'multiSelect' && (
                <Pressable style={styles.saveButton} onPress={() => setSelectPickerFieldId(null)}>
                  <Text style={styles.saveLabel}>Готово</Text>
                </Pressable>
              )}
            </Pressable>
          </Pressable>
        </Modal>
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
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 4,
    justifyContent: 'center',
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  rowSubtitle: {
    fontSize: 12,
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  rowActionButton: {
    padding: 6,
  },
  tableHeaderRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  tableHeaderCell: {
    fontSize: 12,
    fontWeight: '700',
    color: '#fff',
    paddingHorizontal: 8,
  },
  tableRow: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  tableCell: {
    fontSize: 13,
    color: '#fff',
    paddingHorizontal: 8,
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
    maxHeight: 440,
  },
  editorField: {
    marginBottom: 14,
  },
  editorFieldLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
    marginBottom: 6,
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
