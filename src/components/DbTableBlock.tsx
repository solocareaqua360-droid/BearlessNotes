import { useEffect, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import TextInput from './AppTextInput';
import { ScrollView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import { StackActions } from '@react-navigation/native';
import { Ionicons } from './icons/Ionicons';
import GlassLayer from './GlassLayer';
import RenamePrompt from './RenamePrompt';
import { BELOW, useBottomSheet } from './surfaces/bottomSheet';
import { ask, notify } from './surfaces/Ask';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { makeStyles as makeEditorStyles } from './documentEditorStyles';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { SHEET_FRAME } from '../constants/glass';
import { doc, updateDoc } from '../firestore';
import { db } from '../firebase';
import { setDoc } from '../utils/owned';
import { navigationRef } from '../navigationRef';
import type { Block, CustomDatabase, CustomDatabaseRow, DbAddButtonSettings, DbTableSettings, FieldDef } from '../types';
import DbAddWindow, { type AddPicked, type AddPicture } from './DbAddWindow';
import DbAddSettings from './DbAddSettings';
import { addLabel, newRowValues, recordsWord, shownByCondition, titleFieldOf } from '../utils/dbAddButton';
import { writePhotoRecord } from '../utils/photoLibrary';
import { useDbTableData } from '../hooks/useDbTableData';
import { displayFieldValue, rowTitleOf, visibleFieldsOf } from '../utils/customRowDisplay';
import {
  BUILT_IN_SORT_LABELS,
  activeFilterFor,
  applyRowFilters,
  clearFilterFor,
  facetLabel,
  facetsOf,
  filterableFieldsOf,
  groupRows,
  groupableFieldsOf,
  setPresenceOp,
  sortableFieldsOf,
  toggleFacet,
  type RowFilter,
} from '../utils/customRowQuery';
import { DB_TABLE_DEFAULT_ROWS, dbTableColumns, dbTableCounts, dbTableRows } from '../utils/dbTable';
import { generateId } from '../utils/documentBlocks';
import DbRecordCard from './DbRecordCard';
import { prepareFlip, endFlip, type FlipFrom } from '../utils/flipOpen';
import { HIGHLIGHT_COLORS } from './EditorToolbar';
import { useWindowDimensions } from 'react-native';
import type { GestureResponderEvent } from 'react-native';

// THE TABLE OF A DATABASE'S RECORDS (the 'dbTable' block; the user, 2026-10-25): drawn as the note's own table and
// nothing more - no base name over it, no counter (a heading is the note's own text). The one thing that tells it
// apart is the thin strip under it: «Ще N» unfolds the rest right here, «⋯» in its corner holds every setting.
// Every setting is the BLOCK's (Block.dbTable); the records are live.

const FIRST_W = 160;
const NUM_W = 40;
const OP_LABEL = { sum: 'Сума', avg: 'Середнє', min: 'Мінімум', max: 'Максимум', count: 'Кількість', none: 'Нічого' } as const;
const COL_W = 140;

export default function DbTableBlock({
  block,
  disabled,
  onUpdate,
  onOpenRow,
}: {
  block: Block;
  disabled?: boolean;
  onUpdate: (patch: Partial<Block>) => void;
  onOpenRow: (databaseId: string, rowId: string) => void;
}) {
  const theme = useTheme();
  const styles = useStyles(makeEditorStyles);
  const databaseId = block.dbTableDatabaseId;
  const s: DbTableSettings = block.dbTable ?? {};
  const { database, loaded, rows: raw, context, views } = useDbTableData(databaseId);
  const [expanded, setExpanded] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [recordsOpen, setRecordsOpen] = useState(false);
  const [naming, setNaming] = useState(false);
  // THE ADD BUTTON (utils/dbAddButton): its window, its settings, and the prompt for its caption.
  const [addOpen, setAddOpen] = useState(false);
  const [addSettingsOpen, setAddSettingsOpen] = useState(false);
  const [labelOpen, setLabelOpen] = useState(false);
  const S = useSoft();
  const [widthsOpen, setWidthsOpen] = useState(false);
  // The record a row turned over into, over the note (DbRecordCard).
  const [card, setCard] = useState<{ id: string; flip: FlipFrom | null } | null>(null);
  const { width: winW } = useWindowDimensions();

  const save = (patch: DbTableSettings) => onUpdate({ dbTable: clean({ ...s, ...patch }) });
  const rows = dbTableRows(raw, s, database, context);
  const columns = dbTableColumns(database, s);
  const limit = s.rows ?? DB_TABLE_DEFAULT_ROWS;
  const folded = limit > 0 && !expanded && rows.length > limit;
  const shown = folded ? rows.slice(0, limit) : rows;
  // Grouped: the groups of the rows shown (the fold above counts rows, the groups split what it lets through).
  const groupField = s.groupField ? database?.fields.find((f) => f.id === s.groupField) ?? null : null;
  const groups = groupField ? groupRows(shown, groupField, context) : null;
  const foldedGroups = new Set(s.foldedGroups ?? []);
  const toggleGroup = (key: string) => {
    const next = new Set(foldedGroups);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    save({ foldedGroups: next.size ? [...next] : undefined });
  };
  const ink = theme.paper.ink;
  const quiet = theme.paper.inkMuted;

  if (loaded && !database) {
    return (
      <View style={[styles.tableFrame, local.missing]}>
        <Ionicons name="alert-circle-outline" size={18} color={theme.paper.inkFaint} />
        <Text style={[local.cellText, { color: quiet }]}>Базу видалено</Text>
      </View>
    );
  }

  const valueOf = (field: FieldDef, index: number, row: (typeof rows)[number]) =>
    index === 0 && field.id === database?.fields[0]?.id ? rowTitleOf(database, row) : displayFieldValue(field, row.values[field.id], context);

  async function holdRow(rowId: string) {
    const choice = await ask({
      title: rowTitleOf(database, raw.find((r) => r.id === rowId)),
      actions: [
        { id: 'open', label: 'Відкрити', icon: 'open-outline' },
        { id: 'out', label: 'Прибрати з таблиці', hint: 'У базі запис лишається', icon: 'eye-off-outline' },
      ],
    });
    if (choice === 'open') openCard(rowId);
    else if (choice === 'out')
      save({ removed: [...new Set([...(s.removed ?? []), rowId])], added: (s.added ?? []).filter((id) => id !== rowId) });
  }

  async function openMenu() {
    if (!database || !databaseId) return;
    const counts = dbTableCounts(raw, s, database);
    const sortName =
      BUILT_IN_SORT_LABELS[s.sortField ?? 'title'] ?? database.fields.find((f) => f.id === s.sortField)?.name ?? 'Назва';
    const conditionName =
      s.source === 'manual' ? 'Тільки додані вручну' : (s.filters ?? []).length === 0 ? 'Усі записи' : `Умов: ${(s.filters ?? []).length}`;
    const choice = await ask({
      title: 'Таблиця',
      message: `Рядки: за умовою ${counts.condition} · додано ${counts.added} · прибрано ${counts.removed}`,
      actions: [
        { id: 'columns', label: 'Стовпці', hint: `${columns.length} · показати, сховати, переставити`, icon: 'grid-outline' },
        { id: 'condition', label: 'Умова', hint: conditionName, icon: 'funnel-outline' },
        { id: 'group', label: 'Групування', hint: groupField?.name ?? 'Без групування', icon: 'layers-outline' },
        { id: 'sort', label: 'Порядок', hint: `${sortName} ${s.sortDir === 'desc' ? '↓' : '↑'}`, icon: 'swap-vertical-outline' },
        { id: 'rows', label: 'Видно рядків', hint: limit === 0 ? 'Усі' : String(limit), icon: 'reorder-four-outline' },
        { id: 'look', label: 'Вигляд', hint: [s.totals && 'підсумки', s.headerColor && 'шапка', s.rowNumbers && 'нумерація', s.wrap && 'перенос'].filter(Boolean).join(', ') || 'Підсумки, шапка, нумерація, перенос', icon: 'color-palette-outline' },
        { id: 'widths', label: 'Ширина стовпців', icon: 'resize-outline' },
        { id: 'addbtn', label: 'Кнопка додавання', hint: s.addButton?.on ? addLabel(s, database) : 'Вимкнена', icon: 'add-circle-outline' },
        { id: 'add', label: 'Вибрати записи', hint: `${rows.length} із ${raw.length} · галочками`, icon: 'checkbox-outline' },
        { id: 'new', label: 'Новий запис', icon: 'add-circle-outline' },
        ...(counts.removed > 0 ? [{ id: 'back', label: `Повернути прибрані (${counts.removed})`, icon: 'eye-outline' as const }] : []),
        { id: 'base', label: 'Відкрити в базі', hint: database.name, icon: 'open-outline' },
      ],
    });
    if (choice === 'columns') setColumnsOpen(true);
    else if (choice === 'condition') pickCondition();
    else if (choice === 'group') pickGroup();
    else if (choice === 'sort') pickSort();
    else if (choice === 'rows') {
      const n = await ask({
        title: 'Видно рядків',
        message: 'Скільки рядків видно, поки таблиця згорнута. Решта - під «Ще».',
        actions: [3, 5, 10, 0].map((v) => ({ id: String(v), label: v === 0 ? 'Усі' : String(v), icon: v === limit ? ('checkmark' as const) : undefined })),
      });
      if (n !== 'cancel') save({ rows: Number(n) });
    }
    else if (choice === 'look') pickLook();
    else if (choice === 'widths') setWidthsOpen(true);
    else if (choice === 'addbtn') setAddSettingsOpen(true);
    else if (choice === 'add') setRecordsOpen(true);
    else if (choice === 'new') setNaming(true);
    else if (choice === 'back') save({ removed: [] });
    else if (choice === 'base' && navigationRef.isReady())
      navigationRef.dispatch(StackActions.push('CustomDatabase', { databaseId, onlyRowIds: rows.map((r) => r.id) }));
  }

  // The four look switches, one question: a tap flips one and the question comes back, so several can be set in a row.
  async function pickLook() {
    let cur = s;
    for (;;) {
      const mark = (on: boolean | undefined) => (on ? ('checkmark-circle' as const) : ('ellipse-outline' as const));
      const choice = await ask({
        title: 'Вигляд таблиці',
        actions: [
          { id: 'totals', label: 'Підсумки…', hint: cur.totals ? 'Показуються · які стовпці рахувати' : 'Не показуються', icon: mark(cur.totals) },
          { id: 'header', label: 'Шапка кольором', hint: cur.headerColor ? 'Змінити колір' : undefined, icon: mark(!!cur.headerColor) },
          { id: 'numbers', label: 'Нумерація рядків', icon: mark(cur.rowNumbers) },
          { id: 'wrap', label: 'Переносити текст', hint: cur.wrap ? 'Увесь текст, рядок росте' : 'Зараз - в один рядок, зайве за «…»', icon: mark(cur.wrap) },
        ],
        cancelLabel: 'Готово',
      });
      if (choice === 'cancel') return;
      let patch: DbTableSettings = {};
      if (choice === 'totals') {
        cur = await pickTotals(cur);
        continue;
      }
      else if (choice === 'numbers') patch = { rowNumbers: !cur.rowNumbers };
      else if (choice === 'wrap') patch = { wrap: !cur.wrap };
      else if (choice === 'header') {
        const names = ['Пісок', 'Шавлія', 'Глина'];
        const c = await ask({
          title: 'Шапка кольором',
          actions: [{ id: 'none', label: 'Без кольору' }, ...HIGHLIGHT_COLORS.map((hex, i) => ({ id: hex, label: names[i] ?? hex, icon: 'ellipse' as const }))],
        });
        if (c === 'cancel') continue;
        patch = { headerColor: c === 'none' ? undefined : c };
      }
      cur = clean({ ...cur, ...patch });
      onUpdate({ dbTable: cur });
    }
  }

  // «ПІДСУМКИ»: whether the row shows at all, and for each column what it counts - a column set to «Нічого» shows nothing.
  async function pickTotals(start: DbTableSettings = s): Promise<DbTableSettings> {
    let cur = start;
    for (;;) {
      const ops = cur.totalOps ?? {};
      const choice = await ask({
        title: 'Підсумки',
        message: 'Рахується вся таблиця, а не тільки видимі рядки.',
        actions: [
          { id: 'show', label: 'Показувати рядок підсумків', icon: cur.totals ? ('checkmark-circle' as const) : ('ellipse-outline' as const) },
          ...columns.map((f) => ({
            id: `c:${f.id}`,
            label: f.name,
            hint: OP_LABEL[ops[f.id] ?? 'none'],
            icon: (isNumber(f) ? 'calculator-outline' : 'text-outline') as never,
          })),
        ],
        cancelLabel: 'Готово',
      });
      if (choice === 'cancel') return cur;
      if (choice === 'show') cur = clean({ ...cur, totals: !cur.totals });
      else {
        const f = columns.find((x) => x.id === choice.slice(2));
        if (!f) continue;
        const list = (isNumber(f) ? ['none', 'sum', 'avg', 'min', 'max', 'count'] : ['none', 'count']) as (keyof typeof OP_LABEL)[];
        const op = await ask({
          title: `Підсумок · ${f.name}`,
          actions: list.map((o) => ({ id: o, label: OP_LABEL[o], icon: o === (ops[f.id] ?? 'none') ? ('checkmark' as const) : undefined })),
        });
        if (op === 'cancel') continue;
        // Choosing what a column counts turns the row on - that is what it is for.
        cur = clean({ ...cur, totals: op === 'none' ? cur.totals : true, totalOps: { ...ops, [f.id]: op as keyof typeof OP_LABEL } });
      }
      onUpdate({ dbTable: cur });
    }
  }

  async function pickCondition() {
    const choice = await ask({
      title: 'Які записи',
      message: 'Умову з вигляду бази скопійовано в цю таблицю: змінити її тут - вигляд не зміниться.',
      actions: [
        { id: 'all', label: 'Усі записи', icon: 'albums-outline' },
        { id: 'manual', label: 'Тільки додані вручну', icon: 'hand-left-outline' },
        { id: 'filter', label: 'Налаштувати фільтр…', hint: (s.filters ?? []).length ? `Умов: ${(s.filters ?? []).length}` : 'Поле і значення', icon: 'options-outline' },
        ...views.map((v) => ({ id: `v:${v.id}`, label: `Як у вигляді «${v.name}»`, icon: 'bookmark-outline' as const })),
      ],
    });
    if (choice === 'filter') await editFilters();
    else if (choice === 'all') save({ source: 'filter', filters: [] });
    else if (choice === 'manual') {
      save({ source: 'manual', filters: [] });
      setRecordsOpen(true);
    }
    else if (choice.startsWith('v:')) {
      const v = views.find((x) => x.id === choice.slice(2));
      if (v) save({ source: 'filter', filters: v.filters, ...(v.sortField ? { sortField: v.sortField, sortDir: v.sortDir ?? 'asc' } : {}) });
    }
  }

  // THE FILTER SET HERE (2026-11-02, the user: «я вставив базу розробка… хочу показувати тільки баги»): no view in the base
  // needed. A field, then its values - the ones the records really hold, as in the base's own filter - ticked on and off;
  // «Готово» steps back. Every tick is saved at once, so the table behind already shows it.
  async function editFilters() {
    if (!database) return;
    let filters: RowFilter[] = s.source === 'filter' ? [...(s.filters ?? [])] : [];
    const put = (next: RowFilter[]) => {
      filters = next;
      save({ source: 'filter', filters: next });
    };
    const fields = filterableFieldsOf(database);
    const said = (f: FieldDef) => {
      const active = activeFilterFor(filters, f.id);
      if (!active) return undefined;
      if (active.op === 'filled') return 'заповнене';
      if (active.op === 'empty') return 'порожнє';
      return (active.values ?? []).map((key) => facetLabel(f, key, context)).join(', ');
    };
    for (;;) {
      const fieldChoice = await ask({
        title: 'Фільтр',
        message: filters.length ? 'Показуються записи, що підходять під усі умови.' : 'Виберіть поле, за яким відбирати записи.',
        actions: [
          ...fields.map((f) => ({ id: f.id, label: f.name, hint: said(f), icon: activeFilterFor(filters, f.id) ? ('funnel' as const) : ('funnel-outline' as const) })),
          ...(filters.length ? [{ id: 'clear', label: 'Скинути всі умови', icon: 'close-circle-outline' as const }] : []),
          { id: 'done', label: 'Готово', icon: 'checkmark' as const },
        ],
      });
      if (fieldChoice === 'clear') {
        put([]);
        continue;
      }
      const field = fields.find((f) => f.id === fieldChoice);
      if (!field) return;
      for (;;) {
        const active = activeFilterFor(filters, field.id);
        const facets = facetsOf(field, applyRowFilters(raw, clearFilterFor(filters, field.id), database), context);
        const valueChoice = await ask({
          title: field.name,
          message: 'Позначте, які значення показувати.',
          actions: [
            ...facets.map((f) => ({
              id: `k:${f.key}`,
              label: f.label,
              hint: String(f.count),
              icon: active?.op === 'any' && (active.values ?? []).includes(f.key) ? ('checkmark-circle' as const) : ('ellipse-outline' as const),
            })),
            { id: 'filled', label: 'Заповнене', icon: active?.op === 'filled' ? ('checkmark-circle' as const) : ('ellipse-outline' as const) },
            { id: 'empty', label: 'Порожнє', icon: active?.op === 'empty' ? ('checkmark-circle' as const) : ('ellipse-outline' as const) },
            ...(active ? [{ id: 'clear', label: 'Без умови для цього поля', icon: 'close-circle-outline' as const }] : []),
            { id: 'done', label: 'Готово', icon: 'checkmark' as const },
          ],
        });
        if (valueChoice.startsWith('k:')) put(toggleFacet(filters, field.id, valueChoice.slice(2)));
        else if (valueChoice === 'filled' || valueChoice === 'empty') put(setPresenceOp(filters, field.id, valueChoice));
        else if (valueChoice === 'clear') put(clearFilterFor(filters, field.id));
        else break;
      }
    }
  }

  async function pickGroup() {
    if (!database) return;
    const choice = await ask({
      title: 'Групувати за',
      actions: [
        { id: 'none', label: 'Без групування', icon: !s.groupField ? ('checkmark' as const) : undefined },
        ...groupableFieldsOf(database).map((f) => ({ id: f.id, label: f.name, icon: f.id === s.groupField ? ('checkmark' as const) : undefined })),
      ],
    });
    if (choice === 'none') save({ groupField: undefined, foldedGroups: undefined });
    else if (choice !== 'cancel' && choice !== s.groupField) save({ groupField: choice, foldedGroups: undefined });
  }

  // The button's own settings, saved into the block (nothing undefined or empty is kept: Firestore refuses undefined).
  function saveAdd(patch: Partial<DbAddButtonSettings>) {
    const next: Record<string, unknown> = { ...(s.addButton ?? {}), ...patch };
    Object.keys(next).forEach((k) => {
      const v = next[k];
      if (v === undefined || (Array.isArray(v) && v.length === 0) || (!!v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v as object).length === 0)) delete next[k];
    });
    save({ addButton: Object.keys(next).length ? (next as DbAddButtonSettings) : undefined });
  }

  // «+ Значення»: which field, then which of its values a new record gets.
  async function addDefaultValue() {
    if (!database) return;
    const fields = database.fields.filter((f) => f.type === 'select' && (f.options ?? []).length > 0);
    if (fields.length === 0) {
      notify('Нема з чого вибрати', 'У базі немає поля з вибором («Тип», «Статус»...).');
      return;
    }
    const fieldId = await ask({ title: 'Для якого поля?', actions: fields.map((f) => ({ id: f.id, label: f.name })) });
    const field = fields.find((f) => f.id === fieldId);
    if (!field) return;
    const optionId = await ask({ title: field.name, actions: (field.options ?? []).map((o) => ({ id: o.id, label: o.label })) });
    const option = field.options?.find((o) => o.id === optionId);
    if (!option) return;
    saveAdd({ defaults: { ...(s.addButton?.defaults ?? {}), [field.id]: option.id }, noAuto: (s.addButton?.noAuto ?? []).filter((x) => x !== field.id) });
  }

  // The field the typed line goes to: a text one.
  async function pickTitleField() {
    if (!database) return;
    const fields = database.fields.filter((f) => f.type === 'text');
    const current = titleFieldOf(s.addButton, database)?.id;
    const choice = await ask({
      title: 'Рядок тексту йде в поле',
      actions: fields.map((f) => ({ id: f.id, label: f.name, icon: f.id === current ? ('checkmark' as const) : undefined })),
    });
    if (fields.some((f) => f.id === choice)) saveAdd({ titleField: choice });
  }

  // «Додати» in the window: the pictures become Photos records only now, then the record; it joins the table's «added by hand»
  // list only when the table's own condition would not show it (else a record later marked done would stay in the table for good).
  async function addFromWindow(typed: string, picked: AddPicked, pictures: Record<string, AddPicture[]>) {
    if (!database || !databaseId) return;
    const values = newRowValues(s, database, typed, picked);
    if (Object.keys(values).length === 0) return;
    const id = generateId();
    const now = Date.now();
    try {
      for (const list of Object.values(pictures)) for (const p of list) await writePhotoRecord(p.imageUri, { id: p.id });
      await setDoc(doc(db, 'customDatabaseRows', id), { databaseId, values, tagIds: [], createdAt: now, updatedAt: now });
      const row = { id, databaseId, values, tagIds: [], createdAt: now, updatedAt: now } as CustomDatabaseRow;
      if (!shownByCondition(s, database, row)) save({ added: [...new Set([...(s.added ?? []), id])] });
      setAddOpen(false);
    } catch (e) {
      notify('Не збереглося', (e as Error).message);
    }
  }

  async function pickSort() {
    if (!database) return;
    const current = s.sortField ?? 'title';
    const options = [
      { id: 'title', label: database.fields[0]?.name || 'Назва' },
      ...sortableFieldsOf(database).map((f) => ({ id: f.id, label: f.name })),
      { id: 'createdAt', label: BUILT_IN_SORT_LABELS.createdAt },
      { id: 'updatedAt', label: BUILT_IN_SORT_LABELS.updatedAt },
    ];
    const choice = await ask({
      title: 'Порядок',
      message: 'Ще раз той самий - у зворотний бік.',
      actions: options.map((o) => ({ id: o.id, label: o.id === current ? `${o.label} ${s.sortDir === 'desc' ? '↓' : '↑'}` : o.label, icon: o.id === current ? ('checkmark' as const) : undefined })),
    });
    if (choice === 'cancel') return;
    if (choice === current) save({ sortDir: s.sortDir === 'desc' ? 'asc' : 'desc' });
    else save({ sortField: choice, sortDir: 'asc' });
  }

  // One tick of «Вибрати записи»: on = the record shows in the table, off = it does not, whatever brought it there (the
  // condition or a hand-add) - so a ticked row that the condition shows is only «taken out», never lost from the base.
  function setShown(rowId: string, on: boolean) {
    const row = raw.find((r) => r.id === rowId);
    if (!row || !database) return;
    const byCondition = shownByCondition(s, database, row);
    const added = new Set(s.added ?? []);
    const removed = new Set(s.removed ?? []);
    if (on) {
      removed.delete(rowId);
      if (!byCondition) added.add(rowId);
    } else {
      added.delete(rowId);
      if (byCondition) removed.add(rowId);
    }
    save({ added: [...added], removed: [...removed] });
  }

  async function createRecord(name: string) {
    setNaming(false);
    const title = name.trim();
    const fieldId = database?.fields[0]?.id;
    if (!title || !fieldId || !databaseId) return;
    const id = generateId();
    const now = Date.now();
    try {
      await setDoc(doc(db, 'customDatabaseRows', id), { databaseId, values: { [fieldId]: title }, tagIds: [], createdAt: now, updatedAt: now });
      save({ added: [...new Set([...(s.added ?? []), id])] });
    } catch (e) {
      notify('Не збереглося', (e as Error).message);
    }
  }

  async function openCard(rowId: string, e?: GestureResponderEvent) {
    const flip = await prepareFlip(`dbt:${rowId}`, e);
    setCard({ id: rowId, flip });
  }
  const closeCard = () => {
    setCard(null);
    endFlip();
  };

  const widthOf = (i: number) => s.widths?.[columns[i]?.id] ?? (i === 0 ? FIRST_W : COL_W);
  // «Підігнати під текст»: each column as wide as its longest text (an estimate - 8.3 points a letter), between 72 and
  // half the screen.
  function fitWidths() {
    const next: Record<string, number> = {};
    columns.forEach((f, i) => {
      const longest = Math.max(f.name.length, ...rows.map((r) => valueOf(f, i, r).length));
      next[f.id] = Math.round(Math.max(72, Math.min(winW * 0.5, longest * 8.3 + 26)));
    });
    save({ widths: next });
  }
  // THE TOTALS ROW: over every row the table holds (not only the ones showing).
  const isNumber = (f: FieldDef) => f.type === 'number';
  // Nothing is counted until chosen (the user, 2026-10-25: a year summed into 114602 means nothing).
  const opOf = (f: FieldDef) => s.totalOps?.[f.id] ?? 'none';
  function totalOf(f: FieldDef): string {
    const op = opOf(f);
    if (op === 'none') return '';
    if (op === 'count') return String(rows.filter((r) => r.values[f.id] !== undefined && r.values[f.id] !== '').length);
    const nums = rows.map((r) => Number(r.values[f.id])).filter((n) => Number.isFinite(n));
    if (nums.length === 0) return '';
    const v =
      op === 'sum' ? nums.reduce((a, b) => a + b, 0) : op === 'avg' ? nums.reduce((a, b) => a + b, 0) / nums.length : op === 'min' ? Math.min(...nums) : Math.max(...nums);
    return Number.isInteger(v) ? String(v) : v.toFixed(2);
  }
  async function pickOp(f: FieldDef) {
    const ops = (isNumber(f) ? ['none', 'sum', 'avg', 'min', 'max', 'count'] : ['none', 'count']) as (keyof typeof OP_LABEL)[];
    const choice = await ask({
      title: `Підсумок · ${f.name}`,
      actions: ops.map((o) => ({ id: o, label: OP_LABEL[o], icon: o === opOf(f) ? ('checkmark' as const) : undefined })),
    });
    if (choice !== 'cancel') save({ totalOps: { ...(s.totalOps ?? {}), [f.id]: choice as keyof typeof OP_LABEL } });
  }
  const headFill = s.headerColor ? { backgroundColor: s.headerColor } : null;
  const tableW = (s.rowNumbers ? NUM_W : 0) + columns.reduce((sum, _f, i) => sum + widthOf(i), 0);
  // One record's row (in a group or not); `last` = the table's last one, with no line under it.
  const rowView = (row: (typeof rows)[number], r: number, last: boolean) => (
    <Pressable
      key={row.id}
      onPress={(e: GestureResponderEvent) => openCard(row.id, e)}
      onLongPress={() => holdRow(row.id)}
      style={({ pressed }) => [styles.tableGridRow, last && !s.totals && styles.tableGridRowLast, pressed && { backgroundColor: theme.paper.tint }]}
    >
      {s.rowNumbers && (
        <View style={[styles.tableGridCell, { width: NUM_W }]}>
          <Text style={[local.cellText, { color: quiet }]}>{r + 1}</Text>
        </View>
      )}
      {columns.map((f, i) => (
        <View key={f.id} style={[styles.tableGridCell, i === columns.length - 1 && styles.tableGridCellLast, { width: widthOf(i) }]}>
          <Text style={[local.cellText, { color: ink }]} numberOfLines={lines}>
            {valueOf(f, i, row)}
          </Text>
        </View>
      ))}
    </Pressable>
  );
  const lines = s.wrap ? undefined : 1;
  return (
    <View pointerEvents={disabled ? 'none' : 'auto'}>
      <View style={styles.tableFrame}>
        {/* THE ADD BUTTON, in the table's own top strip (2026-11-03): its caption, and how many records the table holds. */}
        {!!s.addButton?.on && !!database && (
          <View style={[local.addStrip, { borderBottomColor: theme.paper.edge }]}>
            <Pressable hitSlop={4} onPress={() => setAddOpen(true)} style={local.addBtn} accessibilityLabel={addLabel(s, database)}>
              <Ionicons name="add" size={22} color={S.accent} />
              <Text style={[local.addText, { color: ink }]} numberOfLines={1}>
                {addLabel(s, database)}
              </Text>
            </Pressable>
            <Text style={[local.footText, { color: quiet }]}>{`${rows.length} ${recordsWord(rows.length)}`}</Text>
          </View>
        )}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} nestedScrollEnabled>
          <View>
            <View style={[styles.tableGridRow, headFill]}>
              {s.rowNumbers && <View style={[styles.tableGridCell, { width: NUM_W }]} />}
              {columns.map((f, i) => (
                <View key={f.id} style={[styles.tableGridCell, i === columns.length - 1 && styles.tableGridCellLast, { width: widthOf(i) }]}>
                  <Text style={[local.headText, { color: s.headerColor ? ink : quiet }]} numberOfLines={lines}>
                    {f.name}
                  </Text>
                </View>
              ))}
            </View>
            {groups
              ? groups.map((g, gi) => {
                  const shut = foldedGroups.has(g.key);
                  const dot = groupField?.options?.find((o) => o.id === g.key)?.color;
                  const lastGroup = gi === groups.length - 1;
                  return (
                    <View key={g.key || '∅'}>
                      {/* The group's heading: one quiet line across the table - its value (with the option's own colour),
                          how many, and the fold. No cell walls: it belongs to the rows under it, not to a column. */}
                      <Pressable
                        onPress={() => toggleGroup(g.key)}
                        style={[styles.tableGridRow, local.groupHead, { backgroundColor: theme.paper.tint, width: tableW }, shut && lastGroup && !s.totals && styles.tableGridRowLast]}
                      >
                        <Ionicons name={shut ? 'chevron-forward' : 'chevron-down'} size={14} color={quiet} />
                        {!!dot && <View style={[local.groupDot, { backgroundColor: dot }]} />}
                        <Text style={[local.groupLabel, { color: ink }]} numberOfLines={1}>
                          {g.label}
                        </Text>
                        <Text style={[local.groupCount, { color: quiet }]}>{g.rows.length}</Text>
                      </Pressable>
                      {!shut && g.rows.map((row, r) => rowView(row, r, lastGroup && r === g.rows.length - 1))}
                    </View>
                  );
                })
              : shown.map((row, r) => rowView(row, r, r === shown.length - 1))}
            {shown.length === 0 && (
              <View style={[styles.tableGridRow, styles.tableGridRowLast]}>
                <View style={[styles.tableGridCell, styles.tableGridCellLast, { width: columns.reduce((sum, _f, i) => sum + widthOf(i), 0) }]}>
                  <Text style={[local.cellText, { color: quiet }]}>{loaded ? 'Немає записів' : '…'}</Text>
                </View>
              </View>
            )}
            {s.totals && shown.length > 0 && (
              <View style={[styles.tableGridRow, styles.tableGridRowLast]}>
                {s.rowNumbers && <View style={[styles.tableGridCell, { width: NUM_W }]} />}
                {columns.map((f, i) => {
                  const t = totalOf(f);
                  return (
                    <Pressable key={f.id} onPress={() => pickOp(f)} style={[styles.tableGridCell, i === columns.length - 1 && styles.tableGridCellLast, { width: widthOf(i) }]}>
                      <Text style={[local.totalText, { color: t ? ink : theme.paper.inkFaint }]} numberOfLines={1}>
                        {t ? (opOf(f) === 'sum' ? t : `${OP_LABEL[opOf(f)].toLowerCase()}: ${t}`) : i === 0 ? 'Підсумок' : ''}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
        {/* THE STRIP: «Ще N» / «Згорнути» and the «⋯» - nothing else marks this table as a base's. */}
        <View style={[local.foot, { borderTopColor: theme.paper.edge }]}>
          {rows.length > (limit || Infinity) ? (
            <Pressable hitSlop={6} onPress={() => setExpanded((v) => !v)} style={local.more}>
              <Text style={[local.footText, { color: quiet }]}>{folded ? `Ще ${rows.length - limit}` : 'Згорнути'}</Text>
            </Pressable>
          ) : (
            <View style={local.more} />
          )}
          <Pressable hitSlop={8} onPress={openMenu} accessibilityLabel="Параметри таблиці" style={local.dots}>
            <Ionicons name="ellipsis-horizontal" size={18} color={quiet} />
          </Pressable>
        </View>
      </View>
      {database && (
        <ColumnsSheet
          visible={columnsOpen}
          fields={visibleFieldsOf(database)}
          chosen={columns.map((f) => f.id)}
          onChange={(ids) => save({ columns: ids })}
          onClose={() => setColumnsOpen(false)}
        />
      )}
      {database && (
        <RecordsSheet
          visible={recordsOpen}
          database={database}
          rows={raw}
          shown={new Set(rows.map((r) => r.id))}
          manual={s.source === 'manual'}
          onToggle={setShown}
          onShowAll={() => save({ source: 'filter', filters: [], added: [], removed: [] })}
          onNone={() => save({ source: 'manual', filters: [], added: [], removed: [] })}
          onClose={() => setRecordsOpen(false)}
        />
      )}
      <DbRecordCard
        database={database}
        row={card ? raw.find((r) => r.id === card.id) ?? null : null}
        context={context}
        flipFrom={card?.flip ?? null}
        onClose={closeCard}
        onOpenInBase={(rowId) => {
          closeCard();
          if (databaseId) onOpenRow(databaseId, rowId);
        }}
        onWrite={(rowId, fieldId, value) => updateDoc(doc(db, 'customDatabaseRows', rowId), { [`values.${fieldId}`]: value, updatedAt: Date.now() })}
      />
      <WidthsSheet
        visible={widthsOpen}
        columns={columns.map((f, i) => ({ id: f.id, name: f.name, width: widthOf(i) }))}
        onChange={(id, w) => save({ widths: { ...(s.widths ?? {}), [id]: w } })}
        onFit={fitWidths}
        onReset={() => save({ widths: undefined })}
        onClose={() => setWidthsOpen(false)}
      />
      {database && (
        <>
          <DbAddWindow visible={addOpen} database={database} settings={s} onClose={() => setAddOpen(false)} onSubmit={addFromWindow} />
          <DbAddSettings
            visible={addSettingsOpen}
            database={database}
            settings={s}
            onChange={saveAdd}
            onClose={() => setAddSettingsOpen(false)}
            onLabel={() => setLabelOpen(true)}
            onAddDefault={addDefaultValue}
            onTitleField={pickTitleField}
          />
          <RenamePrompt
            visible={labelOpen}
            title="Підпис кнопки"
            initialValue={s.addButton?.label ?? ''}
            placeholder={addLabel({ ...s, addButton: { ...(s.addButton ?? {}), label: undefined } }, database)}
            allowEmpty
            onCancel={() => setLabelOpen(false)}
            onSave={(v) => {
              setLabelOpen(false);
              saveAdd({ label: v.trim() || undefined });
            }}
          />
        </>
      )}
      <RenamePrompt visible={naming} title={`Новий запис · ${database?.name ?? ''}`} initialValue="" placeholder="Назва" onCancel={() => setNaming(false)} onSave={createRecord} />
    </View>
  );
}

// Firestore takes no undefined, and an empty list says nothing a missing one does not.
function clean(s: DbTableSettings): DbTableSettings {
  const out: Record<string, unknown> = {};
  Object.entries(s).forEach(([k, v]) => {
    if (v === undefined) return;
    if (Array.isArray(v) && v.length === 0 && k !== 'filters') return;
    out[k] = v;
  });
  return out as DbTableSettings;
}

// «СТОВПЦІ»: every field of the base, a tick to show it, two arrows to move it - the order here is the table's.
function ColumnsSheet({
  visible,
  fields,
  chosen,
  onChange,
  onClose,
}: {
  visible: boolean;
  fields: FieldDef[];
  chosen: string[];
  onChange: (ids: string[]) => void;
  onClose: () => void;
}) {
  const S = useSoft();
  const b = useBottomSheet(visible, onClose);
  const on = new Set(chosen);
  // Shown ones first, in their order, then the rest in the base's order.
  const ordered = [...chosen.map((id) => fields.find((f) => f.id === id)).filter((f): f is FieldDef => !!f), ...fields.filter((f) => !on.has(f.id))];
  const move = (id: string, delta: number) => {
    const i = chosen.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= chosen.length) return;
    const next = [...chosen];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };
  const toggle = (id: string) => {
    if (on.has(id)) {
      if (chosen.length > 1) onChange(chosen.filter((x) => x !== id));
    } else onChange([...chosen, id]);
  };
  return (
    <GlassLayer visible={visible} onClose={onClose} intensity={60} rise={b.on}>
      <View style={[SHEET_FRAME, b.frame]} pointerEvents="box-none">
        <Animated.View style={[local.sheet, { backgroundColor: S.card }, b.window, b.padBottom(14)]}>
          {b.fill}
          {b.grab}
          {b.on && <View style={{ height: 12 }} />}
          <Text style={[local.sheetTitle, { color: S.ink }]}>Стовпці</Text>
          <Text style={[local.sheetHint, { color: S.ink3 }]}>Позначені - у таблиці, стрілками - їхній порядок.</Text>
          <ScrollView style={{ flexGrow: 0 }}>
            {ordered.map((f) => {
              const shownHere = on.has(f.id);
              const at = chosen.indexOf(f.id);
              return (
                <View key={f.id} style={local.fieldRow}>
                  <Pressable hitSlop={6} onPress={() => toggle(f.id)} style={[local.check, { borderColor: S.ink3, backgroundColor: shownHere ? S.ink : 'transparent' }]}>
                    {shownHere && <Ionicons name="checkmark" size={15} color={S.card} />}
                  </Pressable>
                  <Text style={[local.fieldName, { color: shownHere ? S.ink : S.ink3 }]} numberOfLines={1}>
                    {f.name}
                  </Text>
                  {shownHere && (
                    <>
                      <Pressable hitSlop={6} disabled={at <= 0} onPress={() => move(f.id, -1)} style={[local.arrow, at <= 0 && { opacity: 0.3 }]} accessibilityLabel="Лівіше">
                        <Ionicons name="arrow-up" size={18} color={S.ink2} />
                      </Pressable>
                      <Pressable hitSlop={6} disabled={at >= chosen.length - 1} onPress={() => move(f.id, 1)} style={[local.arrow, at >= chosen.length - 1 && { opacity: 0.3 }]} accessibilityLabel="Правіше">
                        <Ionicons name="arrow-down" size={18} color={S.ink2} />
                      </Pressable>
                    </>
                  )}
                </View>
              );
            })}
          </ScrollView>
        </Animated.View>
      </View>
    </GlassLayer>
  );
}

// «ВИБРАТИ ЗАПИСИ»: every record of the base with a tick - ticked ones are in the table. Opens again at any time; each tick is
// saved at once, so the table behind already shows it.
function RecordsSheet({
  visible,
  database,
  rows,
  shown,
  manual,
  onToggle,
  onShowAll,
  onNone,
  onClose,
}: {
  visible: boolean;
  database: CustomDatabase;
  rows: CustomDatabaseRow[];
  shown: Set<string>;
  manual: boolean;
  onToggle: (rowId: string, on: boolean) => void;
  onShowAll: () => void;
  onNone: () => void;
  onClose: () => void;
}) {
  const S = useSoft();
  const b = useBottomSheet(visible, onClose);
  const [query, setQuery] = useState('');
  // Typing lifts the sheet over the keyboard, so its height must be what is LEFT above it - else the list rides under the keys.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const { height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const room = Math.max(240, winH - keyboardHeight - insets.top - 12);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  const ordered = [...rows].sort((a, c) => rowTitleOf(database, a).localeCompare(rowTitleOf(database, c)));
  const q = query.trim().toLowerCase();
  const list = q ? ordered.filter((r) => rowTitleOf(database, r).toLowerCase().includes(q)) : ordered;
  return (
    <GlassLayer visible={visible} onClose={onClose} intensity={60} rise={b.on}>
      <View style={[SHEET_FRAME, b.frame]} pointerEvents="box-none">
        <Animated.View style={[local.sheet, { backgroundColor: S.card }, b.window, { marginBottom: keyboardHeight - (b.on ? BELOW : 0), maxHeight: room }, b.padBottom(14)]}>
          {b.fill}
          {b.grab}
          {b.on && <View style={{ height: 12 }} />}
          <Text style={[local.sheetTitle, { color: S.ink }]}>Записи таблиці</Text>
          <Text style={[local.sheetHint, { color: S.ink3 }]}>
            {`Позначено ${shown.size} із ${rows.length}. Поставте або зніміть галочку - таблиця змінюється одразу, і так можна в будь-який момент.`}
          </Text>
          {rows.length > 8 && (
            <TextInput
              value={query}
              onChangeText={setQuery}
              placeholder="Пошук"
              placeholderTextColor={S.ink3}
              style={[local.search, { color: S.ink, backgroundColor: S.fill }]}
            />
          )}
          <View style={local.bulk}>
            <Pressable hitSlop={6} onPress={onShowAll}>
              <Text style={[local.bulkText, { color: S.accent }]}>Усі записи</Text>
            </Pressable>
            <Pressable hitSlop={6} onPress={onNone}>
              <Text style={[local.bulkText, { color: S.accent }]}>Зняти всі</Text>
            </Pressable>
          </View>
          <ScrollView style={{ flexGrow: 0 }}>
            {list.length === 0 && <Text style={[local.sheetHint, { color: S.ink3 }]}>{rows.length === 0 ? 'У базі ще немає записів.' : 'Нічого не знайдено.'}</Text>}
            {list.map((r) => {
              const on = shown.has(r.id);
              return (
                <Pressable key={r.id} onPress={() => onToggle(r.id, !on)} style={local.fieldRow}>
                  <View style={[local.check, { borderColor: S.ink3, backgroundColor: on ? S.ink : 'transparent' }]}>
                    {on && <Ionicons name="checkmark" size={15} color={S.card} />}
                  </View>
                  <Text style={[local.fieldName, { color: on ? S.ink : S.ink2 }]} numberOfLines={1}>
                    {rowTitleOf(database, r) || 'Без назви'}
                  </Text>
                </Pressable>
              );
            })}
          </ScrollView>
        </Animated.View>
      </View>
    </GlassLayer>
  );
}

// «ШИРИНА СТОВПЦІВ»: each column narrower or wider by a step, or all fitted to their text at once.
function WidthsSheet({
  visible,
  columns,
  onChange,
  onFit,
  onReset,
  onClose,
}: {
  visible: boolean;
  columns: { id: string; name: string; width: number }[];
  onChange: (id: string, width: number) => void;
  onFit: () => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const S = useSoft();
  const b = useBottomSheet(visible, onClose);
  const STEP = 20;
  return (
    <GlassLayer visible={visible} onClose={onClose} intensity={60} rise={b.on}>
      <View style={[SHEET_FRAME, b.frame]} pointerEvents="box-none">
        <Animated.View style={[local.sheet, { backgroundColor: S.card }, b.window, b.padBottom(14)]}>
          {b.fill}
          {b.grab}
          {b.on && <View style={{ height: 12 }} />}
          <Text style={[local.sheetTitle, { color: S.ink }]}>Ширина стовпців</Text>
          <View style={local.fitRow}>
            <Pressable onPress={onFit} style={[local.fitBtn, { backgroundColor: S.ink }]}>
              <Text style={[local.fitText, { color: S.card }]}>Підігнати під текст</Text>
            </Pressable>
            <Pressable onPress={onReset} style={[local.fitBtn, { backgroundColor: S.fill }]}>
              <Text style={[local.fitText, { color: S.ink }]}>Як було</Text>
            </Pressable>
          </View>
          <ScrollView style={{ flexGrow: 0 }}>
            {columns.map((c) => (
              <View key={c.id} style={local.fieldRow}>
                <Text style={[local.fieldName, { color: S.ink }]} numberOfLines={1}>
                  {c.name}
                </Text>
                <Pressable hitSlop={6} onPress={() => onChange(c.id, Math.max(60, c.width - STEP))} style={[local.arrow, { backgroundColor: S.fill, borderRadius: 18 }]} accessibilityLabel="Вужче">
                  <Ionicons name="remove" size={18} color={S.ink2} />
                </Pressable>
                <Text style={[local.widthText, { color: S.ink2 }]}>{c.width}</Text>
                <Pressable hitSlop={6} onPress={() => onChange(c.id, Math.min(600, c.width + STEP))} style={[local.arrow, { backgroundColor: S.fill, borderRadius: 18 }]} accessibilityLabel="Ширше">
                  <Ionicons name="add" size={18} color={S.ink2} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        </Animated.View>
      </View>
    </GlassLayer>
  );
}

const local = StyleSheet.create({
  fitRow: { flexDirection: 'row', gap: 8, marginVertical: 10 },
  fitBtn: { flex: 1, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  fitText: { fontSize: 14.5, fontFamily: SOFT_MEDIUM },
  addStrip: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48, paddingLeft: 6, paddingRight: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, minHeight: 44, paddingHorizontal: 8, maxWidth: '70%' },
  addText: { fontSize: 15, fontFamily: SOFT_SEMIBOLD },
  widthText: { width: 40, textAlign: 'center', fontSize: 14, fontFamily: SOFT_REGULAR },
  headText: { fontSize: 13.5, fontFamily: SOFT_MEDIUM },
  cellText: { fontSize: 14.5, fontFamily: SOFT_REGULAR },
  groupHead: { alignItems: 'center', gap: 8, paddingHorizontal: 10, paddingVertical: 7 },
  groupDot: { width: 9, height: 9, borderRadius: 4.5 },
  groupLabel: { fontSize: 13.5, fontFamily: SOFT_SEMIBOLD, flexShrink: 1 },
  groupCount: { fontSize: 13, fontFamily: SOFT_MEDIUM, fontVariant: ['tabular-nums'] },
  totalText: { fontSize: 14, fontFamily: SOFT_SEMIBOLD },
  missing: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 12 },
  foot: { height: 34, flexDirection: 'row', alignItems: 'center', borderTopWidth: StyleSheet.hairlineWidth, paddingLeft: 12, paddingRight: 4 },
  more: { flex: 1, height: 34, justifyContent: 'center' },
  footText: { fontSize: 13, fontFamily: SOFT_REGULAR },
  dots: { width: 34, height: 30, alignItems: 'center', justifyContent: 'center' },
  sheet: { width: '100%', maxWidth: 440, maxHeight: '86%', borderRadius: 26, paddingTop: 18, paddingHorizontal: 18 },
  sheetTitle: { fontSize: 20, fontFamily: SOFT_SEMIBOLD, paddingHorizontal: 4 },
  sheetHint: { fontSize: 13.5, fontFamily: SOFT_REGULAR, paddingHorizontal: 4, marginTop: 4, marginBottom: 8 },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 50, paddingHorizontal: 4 },
  check: { width: 24, height: 24, borderRadius: 7, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  fieldName: { flex: 1, fontSize: 15.5, fontFamily: SOFT_MEDIUM },
  search: { height: 40, borderRadius: 12, paddingHorizontal: 12, fontSize: 15, fontFamily: SOFT_REGULAR, marginBottom: 6 },
  bulk: { flexDirection: 'row', gap: 18, paddingHorizontal: 4, paddingBottom: 6 },
  bulkText: { fontSize: 14, fontFamily: SOFT_SEMIBOLD },
  arrow: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
});
