import { useEffect, useRef, useState } from 'react';
import { Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
// Deliberately gesture-handler's ScrollView, not react-native's - see the
// same note in DocumentEditorScreen.tsx (this component moved out of that
// file on 2026-09-19): the grid needs to sit inside that file's own
// gesture arena.
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { Ionicons } from './icons/Ionicons';
import { Block, TableRow } from '../types';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { makeStyles } from './documentEditorStyles';
import { columnLetter, displayValueOf, parseFormattedText } from '../utils/documentBlocks';
import { ask } from './surfaces/Ask';
import { usePublishEditorAccessory } from './editorAccessory';
import FormattedText from './FormattedText';
import { takeTableTap } from '../utils/tableTap';

// A table in a note, in TWO faces.
//
// READING is the one that matters, because a table is read a hundred
// times for every time it is edited - and until 2026-09-22 there was no
// reading face at all: the lettered columns, the numbered gutter and a
// box drawn round every cell were on screen even when nobody was
// editing anything. With an 84pt cell clipped to a single line, a page
// of notes came out as "**Тону…", "не пра…", "Розпі…" - a grid of
// chips, not a table. Read, it is now what a table is on paper: a rule
// between rows, no box round anything, text that wraps, and an optional
// strong first row and first column.
//
// EDITING keeps the spreadsheet: letters, numbers, a selected cell and
// the formula bar. That chrome is what gives a cell an ADDRESS, and an
// address is what a formula needs - so it belongs exactly where
// formulas are typed and nowhere else.
//
// Widths are real points, not fractions of the screen, and the table
// scrolls sideways when they add up to more than there is. The user's
// own call: "чи зможемо ми бачити чи змінити ширину полів нехай навіть
// так щоб вони прокручувались за межі". A fraction cannot say that, and
// a phone is narrow enough that something has to give - it is better
// that it is the screen than the text.
//
// The formula bar stays the one place a cell's raw text is typed. Not
// laziness: this editor has hit real Android keyboard and focus bugs
// with many TextInputs jammed together (see the sketch editor's text
// tool), and one input also means the full width for a formula instead
// of an 84pt cell.
export default function TableBlockContent({
  block,
  canEdit,
  onUpdate,
}: {
  block: Block;
  canEdit: boolean;
  onUpdate: (patch: Partial<Block>) => void;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  // A cell is typed INTO where there is a cursor and a hardware
  // keyboard. On a phone the formula bar stays the way in - it is a
  // full width for a formula instead of a 110pt cell, and this editor
  // has a real history of Android focus trouble with many inputs side
  // by side. The bar stays on the desktop too, because a long formula
  // still reads better there; the cell is simply also editable.
  //
  // Worth recording WHY this is possible at all: the database's own
  // table has had a TextInput per cell for months, and its comment
  // holds the recipe - an UNCONTROLLED input (defaultValue, committed
  // when editing ends) keyed on the stored value, never a Pressable
  // swapped for an input on tap, because swapping remounts the cell
  // mid-layout and throws the horizontal scroll back to the first
  // column.
  // What the focused cell holds RIGHT NOW, before it is committed. The
  // table has to know the instant "=" is typed, and the stored value
  // does not learn that until editing ends.
  const [draftText, setDraftText] = useState<string | null>(null);
  const cellRefs = useRef(new Map<string, TextInput | null>());
  const rows = block.tableRows && block.tableRows.length > 0 ? block.tableRows : [{ cells: ['', ''] }];
  const columnCount = rows[0]?.cells.length ?? 0;
  const [selected, setSelected] = useState<{ r: number; c: number } | null>(null);
  // What the selection covers: the cell itself, or the whole row / column it stands in (picked from the cell's menu, the way Craft's «Виділити клітинки» does).
  // The menu then speaks of the row or the column, and the cells of it are tinted.
  const [span, setSpan] = useState<'cell' | 'row' | 'col'>('cell');
  // THE TWO TAPS (the user, 2026-10-22): the first tap on a cell only SELECTS it (frame + the three dots, no keyboard); the second tap on the
  // selected cell starts TYPING. From then on, while a cell holds the cursor, a tap on another cell moves the cursor there and the keyboard
  // stays up. `editing` is that second state; a transparent catcher over every cell that is not being typed in turns taps into the above.
  const [editing, setEditing] = useState(false);
  const focusedCellRef = useRef<string | null>(null);
  const formulaBarFocusRef = useRef(false);
  // A cell that shows a formula's RESULT is not a field, so selecting it has nothing to focus - and the focus Android then hands out goes to the
  // first field on the page (the folder box). This 1pt invisible field is where the focus rests instead.
  const sinkRef = useRef<TextInput>(null);
  // The sink brings the keyboard only when it is already up (another block was being written in): then the first tap must not take it down -
  // the editor leaves writing mode the moment it hides. With no keyboard, a first tap only selects, and nothing rises.
  const [keyboardUp, setKeyboardUp] = useState(Keyboard.isVisible());
  useEffect(() => {
    const a = Keyboard.addListener('keyboardDidShow', () => { keyboardUpRef.current = true; setKeyboardUp(true); });
    const b = Keyboard.addListener('keyboardDidHide', () => { keyboardUpRef.current = false; setKeyboardUp(false); });
    return () => {
      a.remove();
      b.remove();
    };
  }, []);
  const keyboardUpRef = useRef(Keyboard.isVisible());
  // Where a select-only tap rests the focus: with no keyboard, on the keyboard-less sink; with the keyboard up (another block was being written in)
  // on the cell itself, which keeps the keyboard and the writing mode - the sink let both go.
  const focusTarget = (r: number, c: number) => (keyboardUpRef.current ? cellRefs.current.get(`${r}:${c}`) ?? sinkRef.current : sinkRef.current)?.focus();
  // Reading: the short view («шапка й 3 рядки») can be opened for this visit without changing what was saved.
  const [openedShort, setOpenedShort] = useState(false);
  const lastRowAdd = useRef(0);
  // Whether the formula bar currently holds keyboard focus - reliable now
  // that the grid's ScrollView has keyboardShouldPersistTaps="always"
  // (tapping a cell no longer blurs the bar first), unlike when this only
  // gated on the cell's raw text: that trapped a user on a formula cell
  // forever, since every formula's text starts with "=" and there was no
  // way to tell "still composing" from "done, tap normally now".
  const [formulaFocused, setFormulaFocused] = useState(false);
  const formulaInputRef = useRef<TextInput>(null);
  // Where the boundary WILL land, not where it is.
  //
  // The column used to follow the finger, and a table that reflows on
  // every frame is a torn picture - which this project already learned
  // once, dragging blocks: nothing moves during the gesture, a drop
  // line shows where it will go, and the list reorders when the finger
  // lifts (see SortableBlockRow). Craft resizes a column exactly that
  // way, and the user pointed at both at once: "таблиця не змінюється
  // на льоту, вона зміниться тоді коли ти відпустиш палець".
  //
  // So this holds the guide's own offset in the grid, and the width it
  // stands for. The grid is not told anything until the end.
  const [guide, setGuide] = useState<{ c: number; x: number; width: number } | null>(null);
  const resizeStartRef = useRef(0);
  // onEnd runs with the closure of the render the gesture was BUILT in,
  // where `guide` is still null - so the last position is read from a
  // ref that every update writes.
  const guideRef = useRef<{ c: number; x: number; width: number } | null>(null);
  guideRef.current = guide;

  const headerRow = !!block.tableHeaderRow;
  const headerColumn = !!block.tableHeaderColumn;

  function widthOf(c: number): number {
    const stored = block.tableColumnWidths?.[c];
    return stored && stored > 0 ? stored : DEFAULT_COLUMN_WIDTH;
  }

  // The boundary's resting place: the row-number column, then every
  // column up to and including this one.
  function boundaryX(c: number): number {
    let x = GUTTER_WIDTH;
    for (let i = 0; i <= c; i += 1) x += widthOf(i);
    return x;
  }

  function commitWidth(c: number, width: number) {
    const widths = Array.from({ length: columnCount }, (_, i) => (i === c ? width : widthOf(i)));
    onUpdate({ tableColumnWidths: widths });
  }

  function selectCell(r: number, c: number) {
    setSelected({ r, c });
    setSpan('cell');
    formulaInputRef.current?.focus();
  }

  function setCell(r: number, c: number, value: string) {
    const next = rows.map((row) => ({ cells: [...row.cells] }));
    next[r].cells[c] = value;
    onUpdate({ tableRows: next });
  }

  // Excel-style tap-to-reference: while actively composing a formula
  // (formula bar focused and the selected cell's own text is already
  // "=..."), tapping another cell appends that cell's address instead of
  // jumping the selection there - so building "=SUM(A1:A3)" is type
  // "=SUM(", tap A1, type ":", tap A3, type ")" rather than typing every
  // cell address by hand. The formula bar's own checkmark/"Done" key ends
  // this mode so a finished formula can be left behind to select and edit
  // other cells normally.
  function handleCellPress(r: number, c: number) {
    if (!canEdit) return;
    if (formulaMode && selected) {
      setDraftText((draftText ?? selectedRaw) + columnLetter(c) + String(r + 1));
      formulaInputRef.current?.focus();
      return;
    }
    selectCell(r, c);
  }

  // The FUNCTIONS, not the operators.
  //
  // This row held "+ - * / ( ) :" first, on the argument that each of
  // them costs a keyboard-layer switch on a phone. The user's answer
  // retired that argument: every one of those symbols is already on the
  // keyboard, so the row was duplicating what was a tap away anyway -
  // "в мене все є на клавіатурі навіщо дублювати ці символи". What is
  // NOT on any keyboard is SUM, MIN, MAX, AVG, COUNT, and typing one of
  // those by hand is six letters and a bracket. Craft's own row holds
  // exactly these five.
  function insertFunction(name: string) {
    if (!selected) return;
    setDraftText(`${draftText ?? selectedRaw}${name}(`);
    formulaInputRef.current?.focus();
  }

  // Tab walks the row and wraps onto the next; the arrows walk the grid;
  // Enter drops a row, as it does in every spreadsheet anyone has used.
  function moveSelection(dr: number, dc: number) {
    if (!selected) return;
    let r = selected.r + dr;
    let c = selected.c + dc;
    if (c >= columnCount) {
      c = 0;
      r += 1;
    } else if (c < 0) {
      c = columnCount - 1;
      r -= 1;
    }
    if (r < 0) return;
    if (r >= rows.length) {
      // Enter / Tab past the last cell: the next row is made (a double Enter at the foot = a new row).
      if (dr === 0 && dc === 0) return;
      // One key can arrive twice (the key handler and the keyboard's own submit): one row, not two.
      if (Date.now() - lastRowAdd.current < 250) return;
      lastRowAdd.current = Date.now();
      addRow();
      setSelected({ r, c });
      setSpan('cell');
      setTimeout(() => cellRefs.current.get(`${r}:${c}`)?.focus(), 60);
      return;
    }
    setSelected({ r, c });
    setSpan('cell');
    cellRefs.current.get(`${r}:${c}`)?.focus();
  }

  function tapCell(r: number, c: number) {
    const already = selected?.r === r && selected?.c === c && span === 'cell';
    setSelected({ r, c });
    setSpan('cell');
    if (editing || already) {
      setEditing(true);
      setTimeout(() => cellRefs.current.get(`${r}:${c}`)?.focus(), 60);
    } else {
      // Selecting only. The cell's own field still takes the focus - with its caret hidden - because a tap on a non-field while another
      // block holds the keyboard otherwise lets Android hand the focus to the FIRST field on the page (the folder box under the title):
      // the «курсор зіскакує на поле папки» bug the user reported on 2026-10-22. (Dismissing the keyboard instead is no way out: the
      // editor leaves writing mode the moment it goes.)
      setTimeout(() => focusTarget(r, c), 30);
    }
  }

  // The tap on a cell is a gesture-handler Tap, not a Pressable: the grid scrolls sideways inside a gesture-handler ScrollView, and a
  // Pressable's press did not reach JS on the FIRST tap while another block held the keyboard - Android gave the caret to the folder field
  // instead (the user's «курсор зіскакує на поле папки», 2026-10-22).
  function cellTapGesture(r: number, c: number) {
    return Gesture.Tap()
      .runOnJS(true)
      .maxDistance(10)
      .onEnd((_e, success) => {
        if (success) tapCell(r, c);
      });
  }

  function handleCellKey(key: string, shift: boolean): boolean {
    if (key === 'Tab') {
      moveSelection(0, shift ? -1 : 1);
      return true;
    }
    if (key === 'Enter') {
      moveSelection(shift ? -1 : 1, 0);
      return true;
    }
    if (key === 'Backspace' && selected) {
      // Backspace in an EMPTY row removes the row (the user, 2026-10-22), and the caret goes to the row above.
      const here = rows[selected.r];
      if (here && rows.length > 1 && (draftText ?? here.cells[selected.c] ?? '') === '' && here.cells.every((cell) => (cell ?? '').trim() === '')) {
        const above = Math.max(0, selected.r - 1);
        const col = selected.c;
        removeRow(selected.r);
        setTimeout(() => cellRefs.current.get(`${above}:${col}`)?.focus(), 40);
        return true;
      }
    }
    if (key === 'ArrowDown') {
      moveSelection(1, 0);
      return true;
    }
    if (key === 'ArrowUp') {
      moveSelection(-1, 0);
      return true;
    }
    return false;
  }

  function confirmFormula() {
    if (selected && draftText !== null) setCell(selected.r, selected.c, draftText);
    setDraftText(null);
    // Let the cell go, too. Still selected, it stayed a field showing
    // its own formula, so a finished "=A1+B1" never turned into its
    // answer - exactly what the user saw.
    setSelected(null);
    formulaInputRef.current?.blur();
  }

  function addRow() {
    insertRow(rows.length);
  }

  // A row / column made AT a place (the menu's «Вставити»), not only at the end.
  function insertRow(at: number) {
    const next = rows.map((row) => ({ cells: [...row.cells] }));
    next.splice(at, 0, { cells: Array(columnCount).fill('') });
    onUpdate({ tableRows: next });
  }

  function insertColumn(at: number) {
    onUpdate({
      tableRows: rows.map((row) => {
        const cells = [...row.cells];
        cells.splice(at, 0, '');
        return { cells };
      }),
      ...(block.tableColumnWidths?.length
        ? { tableColumnWidths: (() => { const w = Array.from({ length: columnCount }, (_, i) => widthOf(i)); w.splice(at, 0, DEFAULT_COLUMN_WIDTH); return w; })() }
        : null),
    });
  }

  // Moving a column or a row one step: from the small menu behind a tap on its letter / number (no dragging on a phone).
  function moveColumn(c: number, d: -1 | 1) {
    const to = c + d;
    if (to < 0 || to >= columnCount) return;
    const swap = <T,>(a: T[]): T[] => {
      const out = [...a];
      [out[c], out[to]] = [out[to], out[c]];
      return out;
    };
    if (selected?.c === c) setSelected({ r: selected.r, c: to });
    onUpdate({
      tableRows: rows.map((row) => ({ cells: swap(row.cells) })),
      ...(block.tableColumnWidths?.length ? { tableColumnWidths: swap(Array.from({ length: columnCount }, (_, i) => widthOf(i))) } : null),
    });
  }

  function moveRow(r: number, d: -1 | 1) {
    const to = r + d;
    if (to < 0 || to >= rows.length) return;
    const next = rows.map((row) => ({ cells: [...row.cells] }));
    [next[r], next[to]] = [next[to], next[r]];
    if (selected?.r === r) setSelected({ r: to, c: selected.c });
    onUpdate({ tableRows: next });
  }

  // THE CELL'S MENU - behind the three dots of the selected cell (the user, 2026-10-22: «функціонал в основному через контекстне меню,
  // щоб не засмічувати навколо таблиці всякими додатковими знаками»). It speaks of what is selected: a cell, a row or a column.
  async function openCellMenu() {
    if (!selected) return;
    const { r, c } = selected;
    const lastRow = rows.length - 1;
    const lastCol = columnCount - 1;
    const rowActions = (): { id: string; label: string; icon?: any; tone?: 'danger' }[] => [
      { id: 'rowAbove', label: 'Вставити рядок вище', icon: 'add' },
      { id: 'rowBelow', label: 'Вставити рядок нижче', icon: 'add' },
      ...(r > 0 ? [{ id: 'up', label: 'Пересунути вгору', icon: 'chevron-up' }] : []),
      ...(r < lastRow ? [{ id: 'down', label: 'Пересунути вниз', icon: 'chevron-down' }] : []),
      { id: 'clearRow', label: 'Очистити рядок' },
      ...(rows.length > 1 ? [{ id: 'delRow', label: 'Видалити рядок', tone: 'danger' as const, icon: 'trash-outline' }] : []),
    ];
    const colActions = (): { id: string; label: string; icon?: any; tone?: 'danger' }[] => [
      { id: 'colLeft', label: 'Вставити колонку ліворуч', icon: 'add' },
      { id: 'colRight', label: 'Вставити колонку праворуч', icon: 'add' },
      ...(c > 0 ? [{ id: 'left', label: 'Пересунути ліворуч', icon: 'chevron-back' }] : []),
      ...(c < lastCol ? [{ id: 'right', label: 'Пересунути праворуч', icon: 'chevron-forward' }] : []),
      { id: 'clearCol', label: 'Очистити колонку' },
      ...(columnCount > 1 ? [{ id: 'delCol', label: 'Видалити колонку', tone: 'danger' as const, icon: 'trash-outline' }] : []),
    ];
    let chosen: string;
    if (span === 'row') chosen = await ask({ title: 'Рядок', actions: rowActions() });
    else if (span === 'col') chosen = await ask({ title: 'Колонка', actions: colActions() });
    else {
      chosen = await ask({
        title: 'Клітинка',
        actions: [
          { id: 'insert', label: 'Вставити…', icon: 'add' },
          { id: 'move', label: 'Пересунути…', icon: 'swap-vertical' },
          { id: 'selRow', label: 'Виділити рядок' },
          { id: 'selCol', label: 'Виділити колонку' },
          { id: 'head', label: 'Шапка й підсумки…' },
          { id: 'resetWidths', label: 'Скинути ширину колонок' },
          { id: 'clearCell', label: 'Очистити клітинку' },
          ...(rows.length > 1 ? [{ id: 'delRow', label: 'Видалити рядок', tone: 'danger' as const, icon: 'trash-outline' as const }] : []),
          ...(columnCount > 1 ? [{ id: 'delCol', label: 'Видалити колонку', tone: 'danger' as const, icon: 'trash-outline' as const }] : []),
        ],
      });
      if (chosen === 'insert') {
        chosen = await ask({
          title: 'Вставити',
          actions: [
            { id: 'rowAbove', label: 'Рядок вище' },
            { id: 'rowBelow', label: 'Рядок нижче' },
            { id: 'colLeft', label: 'Колонку ліворуч' },
            { id: 'colRight', label: 'Колонку праворуч' },
          ],
        });
      } else if (chosen === 'move') {
        chosen = await ask({
          title: 'Пересунути',
          actions: [
            ...(r > 0 ? [{ id: 'up', label: 'Рядок вгору', icon: 'chevron-up' as const }] : []),
            ...(r < lastRow ? [{ id: 'down', label: 'Рядок вниз', icon: 'chevron-down' as const }] : []),
            ...(c > 0 ? [{ id: 'left', label: 'Колонку ліворуч', icon: 'chevron-back' as const }] : []),
            ...(c < lastCol ? [{ id: 'right', label: 'Колонку праворуч', icon: 'chevron-forward' as const }] : []),
          ],
        });
      } else if (chosen === 'head') {
        chosen = await ask({
          title: 'Шапка й підсумки',
          actions: [
            { id: 'headerRow', label: headerRow ? 'Прибрати шапку-рядок' : 'Перший рядок — шапка' },
            { id: 'headerCol', label: headerColumn ? 'Прибрати шапку-колонку' : 'Перша колонка — шапка' },
            { id: 'sum', label: 'Рядок підсумків' },
          ],
        });
      }
    }
    if (chosen === 'selRow') setSpan('row');
    if (chosen === 'selCol') setSpan('col');
    if (chosen === 'rowAbove') insertRow(r);
    if (chosen === 'rowBelow') insertRow(r + 1);
    if (chosen === 'colLeft') insertColumn(c);
    if (chosen === 'colRight') insertColumn(c + 1);
    if (chosen === 'up') moveRow(r, -1);
    if (chosen === 'down') moveRow(r, 1);
    if (chosen === 'left') moveColumn(c, -1);
    if (chosen === 'right') moveColumn(c, 1);
    if (chosen === 'delRow') removeRow(r);
    if (chosen === 'delCol') removeColumn(c);
    if (chosen === 'clearCell') setCell(r, c, '');
    if (chosen === 'clearRow') onUpdate({ tableRows: rows.map((row, i) => (i === r ? { cells: row.cells.map(() => '') } : { cells: [...row.cells] })) });
    if (chosen === 'clearCol') onUpdate({ tableRows: rows.map((row) => ({ cells: row.cells.map((cell, i) => (i === c ? '' : cell)) })) });
    if (chosen === 'headerRow') onUpdate({ tableHeaderRow: !headerRow });
    if (chosen === 'headerCol') onUpdate({ tableHeaderColumn: !headerColumn });
    if (chosen === 'sum') addSumRow();
    if (chosen === 'resetWidths') onUpdate({ tableColumnWidths: [] });
  }

  function removeRow(r: number) {
    if (rows.length <= 1) return;
    if (selected?.r === r) setSelected(null);
    onUpdate({ tableRows: rows.filter((_, i) => i !== r) });
  }

  // A column could be added and never removed - the one operation this
  // grid was missing outright.
  function removeColumn(c: number) {
    if (columnCount <= 1) return;
    setSelected(null);
    onUpdate({
      tableRows: rows.map((row) => ({ cells: row.cells.filter((_, i) => i !== c) })),
      tableColumnWidths: (block.tableColumnWidths ?? []).filter((_, i) => i !== c),
    });
  }

  // Appends a real total row with an actual =SUM(...) formula per
  // column, rather than a separate virtual display-only row - it's just
  // another editable row, so it can be edited or deleted like any other.
  function addSumRow() {
    const lastRow = rows.length;
    const sumCells = Array.from({ length: columnCount }, (_, c) => {
      const letter = columnLetter(c);
      return `=SUM(${letter}1:${letter}${lastRow})`;
    });
    onUpdate({ tableRows: [...rows.map((row) => ({ cells: [...row.cells] })), { cells: sumCells }] });
  }

  const selectedRaw = selected ? rows[selected.r]?.cells[selected.c] ?? '' : '';
  // THE rule of this component, and the user's own words for it: "поки
  // ти не ввів равно, ти просто перемикаєшся між клітинками, все
  // логічно. Як тільки ти, як в Excel, ввів равно - все зрозуміло, що
  // формули".
  //
  // Until then a table is a table: you type into a cell, you move to
  // the next one, and there is no bar, no operators and no addresses on
  // screen. From "=" onwards the same grid means something else - a
  // tap on a cell is its ADDRESS rather than a place to go - and that
  // is the only state in which a formula field is worth the room it
  // takes.
  // A formula cell that is merely SELECTED (first tap) is just a selected cell showing its result; the formula opens with typing.
  const formulaMode = (editing || formulaFocused) && (draftText ?? selectedRaw).trim().startsWith('=');
  // Entering formula mode hands the keyboard to the bar. Without this
  // the cell keeps focus and has just become non-editable, so typing
  // goes nowhere - which is the worst of the three possible states.
  useEffect(() => {
    if (!formulaMode) return;
    // The bar is published, and the editor draws it a render later - so
    // the ref is not attached yet when this runs. One short wait.
    const timer = setTimeout(() => formulaInputRef.current?.focus(), 60);
    return () => clearTimeout(timer);
  }, [formulaMode]);

  // Above the keyboard, in the editor's own pinned bar - the place it
  // has already made safe. A formula field belongs under the thumb, not
  // over the table, and the editor's toolbar steps aside while one is
  // being written. See editorAccessory.
  usePublishEditorAccessory(
    canEdit && formulaMode ? (
      <View style={styles.tableAccessory}>

      <View style={styles.tableFormulaBar}>
        <View style={styles.tableFormulaRefBadge}>
          <Text style={styles.tableFormulaRefText}>
            {selected ? `${columnLetter(selected.c)}${selected.r + 1}` : '—'}
          </Text>
        </View>
        <TextInput
          ref={formulaInputRef}
          style={styles.tableFormulaInput}
          // The bar owns the text while the formula is being written -
          // the cell underneath shows the same string and is not
          // editable, so there is one place typing goes.
          value={draftText ?? selectedRaw}
          editable={canEdit}
          onChangeText={setDraftText}
          onFocus={() => {
            formulaBarFocusRef.current = true;
            setFormulaFocused(true);
          }}
          onBlur={() => {
            formulaBarFocusRef.current = false;
            setFormulaFocused(false);
          }}
          placeholder="=SUM(A1:A3)"
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={confirmFormula}
          blurOnSubmit
        />
        <Pressable hitSlop={8} onPress={confirmFormula} style={styles.tableFormulaDoneButton}>
          <Ionicons name="checkmark" size={18} color="#fff" />
        </Pressable>
      </View>

        <View style={styles.tableOperatorRow}>
          {FUNCTIONS.map((fn) => (
            <Pressable
              key={fn.label}
              style={styles.tableFunctionKey}
              onPress={() => insertFunction(fn.name)}
            >
              <Text style={styles.tableOperatorLabel}>{fn.label}</Text>
            </Pressable>
          ))}
        </View>
      </View>
    ) : null,
    // Everything the bar reads. Its handlers otherwise use setters and
    // refs, which do not change.
    [canEdit, formulaMode, draftText, selectedRaw, selected?.r, selected?.c]
  );

  // WAKING UP from a tap on the locked table (see utils/tableTap): select the cell that tap was for and take the focus ourselves. Mounted live
  // with a tap waiting = that tap; the column is read off the widths, the row off an even share of the height (rows are near enough alike).
  useEffect(() => {
    if (!canEdit) return;
    const tap = takeTableTap(block.id);
    if (!tap || !Number.isFinite(tap.x) || !Number.isFinite(tap.y) || !(tap.height > 0)) return;
    let c = 0;
    let x = tap.x;
    while (c < columnCount - 1 && x > widthOf(c)) {
      x -= widthOf(c);
      c += 1;
    }
    const r = Math.max(0, Math.min(rows.length - 1, Math.floor(tap.y / Math.max(1, tap.height / rows.length))));
    setSelected({ r, c });
    setSpan('cell');
    // More than once: the field that held the keyboard before is being locked in the same moments, and the focus Android hands out when it
    // goes can land after a single early attempt.
    const timers = [40, 160, 360].map((ms) =>
      setTimeout(() => {
        if (!focusedCellRef.current) focusTarget(r, c);
      }, ms)
    );
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canEdit]);

  // ---- READING ----------------------------------------------------
  if (!canEdit) {
    // THE SHORT VIEW (a choice in «···»): the header row and three rows below it - or the first three when there is no header - and
    // the rest only behind the chevron. Never while editing: what is being written in is always shown whole.
    const keep = headerRow ? 4 : 3;
    const short = !!block.tableShort && !openedShort && rows.length > keep;
    const shownRows = short ? rows.slice(0, keep) : rows;
    const hidden = rows.length - shownRows.length;
    // NOT styles.tableBlock: it carries flex: 1, and a flex: 1 child of a
    // parent measured by its own content collapses to nothing - which is
    // what a table became the moment editing ended, "просто тоненька
    // лінія, оце і є наша таблиця". The same trap is written up in
    // SortableBlockRow, about this same editor, in September. A
    // horizontal scroller takes its height from what is inside it.
    return (
      <View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingRight: SCROLL_PAST }}
      >
        <View style={styles.tableReadFrame}>
          {shownRows.map((row, r) => (
            <View
              key={r}
              style={[
                styles.tableGridRow,
                r === shownRows.length - 1 && styles.tableGridRowLast,
                headerRow && r === 0 && styles.tableGridHeaderRow,
              ]}
            >
              {row.cells.map((_, c) => (
                <View
                  key={c}
                  style={[
                    styles.tableGridCell,
                    c === row.cells.length - 1 && styles.tableGridCellLast,
                    headerColumn && c === 0 && styles.tableGridHeaderCell,
                    { width: widthOf(c) },
                  ]}
                >
                  <CellText
                    rows={rows}
                    r={r}
                    c={c}
                    strong={(headerRow && r === 0) || (headerColumn && c === 0)}
                    style={styles.tableCellText}
                    strongStyle={styles.tableReadStrong}
                    ink={theme.paper.ink}
                  />
                </View>
              ))}
            </View>
          ))}
        </View>
      </ScrollView>
      {hidden > 0 && (
        // The SIGN OF MORE under a short table: faint, a chevron and an ellipsis; a tap opens it for this visit.
        <Pressable onPress={() => setOpenedShort(true)} hitSlop={8} style={{ alignItems: 'center', paddingTop: 2 }} accessibilityLabel="Показати всю таблицю">
          <Ionicons name="chevron-down" size={16} color="#A8A59D" />
        </Pressable>
      )}
      </View>
    );
  }

  // ---- EDITING ----------------------------------------------------
  // The grid is just cells. No letters, no numbers: they only mean something inside a formula, so the lettered strip and the numbered
  // column are drawn from the moment "=" is typed, like Excel's, and nowhere else (the user, 2026-10-22; a letter INSIDE every cell
  // was tried the same day and refused: «жах»). The selected cell has a frame, three
  // dots in its right corner (its menu) and, on its right edge, the grip that sets the column's width.
  return (
    <View style={styles.tableBlock}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always" contentContainerStyle={{ paddingRight: SCROLL_PAST }}>
        <View style={styles.tableFrame}>
          {/* The guide. Inside the frame, so it scrolls with the grid and
              is clipped by it; drawn over everything, because it is
              standing on the boundary it is about to move. */}
          {!!guide && <View pointerEvents="none" style={[styles.tableGuide, { left: guide.x }]} />}
          {/* The letters and the numbers - only while a formula is being typed (the user, 2026-10-22: «показувалося тільки при введенні равно»). */}
          {formulaMode && (
            <View style={{ flexDirection: 'row', borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: theme.paper.edge }}>
              <View style={[styles.tableGutterCell, { paddingVertical: 4 }]} />
              {Array.from({ length: columnCount }, (_, c) => (
                <View key={c} style={[styles.tableColumnHeaderCell, { width: widthOf(c) }]}>
                  <Text style={styles.tableColumnHeaderText}>{columnLetter(c)}</Text>
                </View>
              ))}
            </View>
          )}
          {rows.map((row, r) => (
            <View
              key={r}
              style={[
                styles.tableGridRow,
                r === rows.length - 1 && styles.tableGridRowLast,
                headerRow && r === 0 && styles.tableGridHeaderRow,
              ]}
            >
              {formulaMode && (
                <View style={[styles.tableGridCell, styles.tableGutterCell]}>
                  <Text style={styles.tableGutterText}>{r + 1}</Text>
                </View>
              )}
              {row.cells.map((_, c) => {
                const isSelected = selected?.r === r && selected?.c === c;
                const inSpan = !!selected && ((span === 'row' && r === selected.r) || (span === 'col' && c === selected.c));
                // In formula mode every OTHER cell stops being a field
                // and becomes an address to tap. Only the cell the
                // formula lives in stays editable, and even it is typed
                // through the bar above - which is the whole difference
                // the user described: the same grid means "go here"
                // before "=" and "this one" after it.
                const asAddress = formulaMode && !isSelected;
                // A formula cell that is not the one being edited shows its
                // RESULT, the way every spreadsheet does - as a field it
                // showed "=A1+B1", which read as "formulas stopped
                // working". The formula itself is seen in the bar, once
                // the cell is chosen.
                const showsResult = !(isSelected && editing) && (row.cells[c] ?? '').trim().startsWith('=');
                const cellBox = [
                  styles.tableGridCell,
                  c === row.cells.length - 1 && styles.tableGridCellLast,
                  headerColumn && c === 0 && styles.tableGridHeaderCell,
                  { width: widthOf(c) },
                  inSpan && { backgroundColor: SPAN_TINT(theme.accent, theme.paper.selected) },
                  isSelected && !inSpan && { backgroundColor: theme.paper.selected },
                ];
                // The frame is DRAWN over the cell, not a border of it: a 2pt border made the selected cell's row taller than its neighbours.
                // A picked ROW / COLUMN: its cells carry an accent rule on the two long sides (the cell with the dots keeps its full frame).
                const spanRule = inSpan ? (
                  <View
                    pointerEvents="none"
                    style={{
                      position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
                      borderColor: theme.accent,
                      ...(span === 'row' ? { borderTopWidth: 2, borderBottomWidth: 2 } : { borderLeftWidth: 2, borderRightWidth: 2 }),
                    }}
                  />
                ) : null;
                const selFrame = isSelected ? (
                  <View pointerEvents="none" style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, borderWidth: 2, borderColor: theme.accent }} />
                ) : null;
                if (!asAddress && !showsResult) {
                  const raw = row.cells[c] ?? '';
                  return (
                    <View key={c} style={[cellBox, { paddingHorizontal: 0, paddingVertical: 0 }]}>
                      <TextInput
                        // Re-seeded when the STORED value changes (a
                        // formula recomputing, the other device writing) -
                        // never on every keystroke, which is the whole
                        // point of leaving it uncontrolled.
                        key={raw}
                        ref={(node) => {
                          cellRefs.current.set(`${r}:${c}`, node);
                        }}
                        caretHidden={!(editing && isSelected)}
                        style={[styles.tableCellInput, isSelected && !formulaMode && { paddingRight: 30 }]}
                        defaultValue={raw}
                        editable={!formulaMode}
                        onFocus={() => {
                          focusedCellRef.current = `${r}:${c}`;
                          setEditing(true);
                          setSelected({ r, c });
                          setSpan('cell');
                          setDraftText(raw);
                        }}
                        onBlur={() => {
                          focusedCellRef.current = null;
                          // Focus passing to another cell is not the end of typing: only when nobody holds it a moment later.
                          setTimeout(() => {
                            if (!focusedCellRef.current && !formulaBarFocusRef.current) setEditing(false);
                          }, 150);
                        }}
                        onChangeText={(value) => setDraftText(value)}
                        onEndEditing={(e) => {
                          setCell(r, c, e.nativeEvent.text);
                          setDraftText(null);
                        }}
                        onKeyPress={(e) => {
                          const native = e.nativeEvent as unknown as {
                            key: string;
                            shiftKey?: boolean;
                            preventDefault?: () => void;
                          };
                          if (handleCellKey(native.key, !!native.shiftKey)) {
                            // Tab would otherwise leave the table entirely,
                            // and Enter would put a newline in a cell.
                            native.preventDefault?.();
                          }
                        }}
                        // Enter on a phone keyboard: on to the cell below, and at the foot a new row - instead of closing the keyboard.
                        blurOnSubmit={false}
                        onSubmitEditing={() => moveSelection(1, 0)}
                        autoCapitalize="none"
                        autoCorrect={false}
                      />
                      {/* While typing there is NO catcher: a tap goes straight into the next field, the way the focus moves between fields everywhere - with a
                          catcher in between the focus was empty for a moment and the keyboard blinked away and back on every move. */}
                      {!formulaMode && !editing && (
                        <GestureDetector gesture={cellTapGesture(r, c)}>
                          <View collapsable={false} style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0 }} accessibilityLabel="Клітинка" />
                        </GestureDetector>
                      )}
                      {spanRule}
                      {selFrame}
                      {isSelected && !formulaMode && <CellDots onPress={openCellMenu} />}
                    </View>
                  );
                }
                return (
                  <Pressable key={c} focusable={false} style={cellBox} onPress={() => (formulaMode ? handleCellPress(r, c) : tapCell(r, c))}>
                    <CellText
                      rows={rows}
                      r={r}
                      c={c}
                      strong={(headerRow && r === 0) || (headerColumn && c === 0)}
                      style={styles.tableCellText}
                      strongStyle={styles.tableReadStrong}
                      ink={theme.paper.ink}
                    />
                    {spanRule}
                    {selFrame}
                    {isSelected && !formulaMode && <CellDots onPress={openCellMenu} />}
                  </Pressable>
                );
              })}
            </View>
          ))}
          {/* The column's width grip: on the right edge of the selected cell's column, the whole height of the table. */}
          {!!selected && !formulaMode && (
            <GestureDetector gesture={resizeGesture(selected.c)}>
              <View style={{ position: 'absolute', left: boundaryX(selected.c) - 10, top: 0, bottom: 0, width: 20, alignItems: 'center', justifyContent: 'center', zIndex: 3 }}>
                <View style={styles.tableResizeGrip} />
              </View>
            </GestureDetector>
          )}
        </View>
      </ScrollView>
      <TextInput
        ref={sinkRef}
        value=""
        onChangeText={() => {}}
        showSoftInputOnFocus={keyboardUp}
        onFocus={() => {
          focusedCellRef.current = 'sink';
        }}
        onBlur={() => {
          if (focusedCellRef.current === 'sink') focusedCellRef.current = null;
        }}
        caretHidden
        accessibilityElementsHidden
        importantForAccessibility="no"
        style={{ position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0 }}
      />
    </View>
  );

  // The width the finger STARTED from, captured when the drag starts and
  // not a moment later.
  //
  // It used to be read at render time - `const startWidth = widthOf(c)`
  // in the body of this function - and `widthOf` returns the width the
  // drag has already produced. So every frame rebuilt the gesture with
  // the NEW width as its origin and added the whole translation to it
  // again: the column grew by the distance dragged so far on every
  // single update, and a millimetre of movement threw it to the cap.
  // "Міліметр в сторону і таблиця розширилась в безкінечність."
  //
  // A ref, set in onStart, is the origin the whole drag is measured
  // from - which is what makes the column follow the finger one to one.
  function resizeGesture(c: number) {
    return Gesture.Pan()
      .runOnJS(true)
      .onStart(() => {
        resizeStartRef.current = widthOf(c);
        setGuide({ c, x: boundaryX(c), width: resizeStartRef.current });
      })
      .onUpdate((e) => {
        // Clamped as a WIDTH and then turned back into a position, so
        // the line stops exactly where the column would stop rather
        // than running on past it and lying about where it will land.
        const width = clampWidth(resizeStartRef.current + e.translationX);
        setGuide({ c, x: boundaryX(c) - resizeStartRef.current + width, width });
      })
      .onEnd(() => {
        const landed = guideRef.current;
        setGuide(null);
        if (landed) commitWidth(c, landed.width);
      });
  }
}

// One cell's text, drawn the way the rest of a note is drawn.
//
// It used to be the RAW string, so a cell holding "**Тонування**"
// showed the asterisks - a table was the one place in the app where
// this app's own inline markup was not rendered. parseFormattedText and
// FormattedText already exist for every other block; a table simply
// never asked them.
//
// A FORMULA is the exception: its raw text is "=SUM(A1:A3)" and what
// belongs on screen is the number that comes out of it. displayValueOf
// already decides that, and a computed number has no markup in it.
function CellText({
  rows,
  r,
  c,
  strong,
  style,
  strongStyle,
  ink,
}: {
  rows: TableRow[];
  r: number;
  c: number;
  strong: boolean;
  style: object;
  strongStyle: object;
  ink: string;
}) {
  const raw = rows[r]?.cells[c] ?? '';
  const isFormula = raw.trim().startsWith('=');
  return (
    <Text style={[style, strong && strongStyle]} numberOfLines={CELL_MAX_LINES}>
      {isFormula ? (
        displayValueOf(rows, r, c)
      ) : raw === '' ? (
        // An empty cell still holds the height of a line: without it a row of empty cells folded to its padding while formulas were typed.
        '\u200B'
      ) : (
        <FormattedText segments={parseFormattedText(raw)} defaultColor={ink} />
      )}
    </Text>
  );
}

// Three dots, one above the other, in the selected cell's right corner: the cell's menu. Drawn, not an icon - there is no vertical ellipsis in
// the icon set, and three small discs are all it is.
function CellDots({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      focusable={false}
      onPress={onPress}
      hitSlop={6}
      accessibilityLabel="Меню клітинки"
      style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 30, alignItems: 'center', justifyContent: 'center', gap: 2.5 }}
    >
      {[0, 1, 2].map((i) => (
        <View key={i} style={{ width: 3, height: 3, borderRadius: 1.5, backgroundColor: '#9C988F' }} />
      ))}
    </Pressable>
  );
}

// Wide enough for a short word plus its padding, narrow enough that
// three fit on a phone.
// The tint of a picked row / column: the accent at about a quarter, stronger than the single cell's wash so that it can be SEEN.
const SPAN_TINT = (accent: string, fallback: string) => (/^#[0-9a-fA-F]{6}$/.test(accent) ? `${accent}40` : fallback);
const DEFAULT_COLUMN_WIDTH = 110;
// No row-number column any more (the numbers live inside the cells while a formula is typed); kept as 0 so the guide's maths stays one line.
const GUTTER_WIDTH = 0;
// The table scrolls this far PAST its last column, so the last column's edge is not pinned to the screen's (its width stays adjustable).
const SCROLL_PAST = 64;
const MIN_COLUMN_WIDTH = 56;
// Past this a column is a paragraph, and a paragraph belongs in a
// paragraph.
const MAX_COLUMN_WIDTH = 420;
// A cell may wrap, but it is still a cell. Four lines is a sentence.
const CELL_MAX_LINES = 4;
// ONE, and the user was explicit about why: "ніяких мін максів я
// виводити не буду. Максимум, що мені знадобиться від таблиці, це
// підбити суму... Для цього є Excel."
//
// The engine still knows MIN, MAX, AVERAGE and COUNT - a formula typed
// by hand or synced from elsewhere keeps working - but a key each is
// four keys for something this app is not for. Everything else anyone
// here needs is + - * / and brackets, and those are on the keyboard.
const FUNCTIONS = [{ label: 'SUM', name: 'SUM' }];

function clampWidth(width: number): number {
  return Math.round(Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, width)));
}
