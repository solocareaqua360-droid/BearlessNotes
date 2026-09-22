import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
// Deliberately gesture-handler's ScrollView, not react-native's - see the
// same note in DocumentEditorScreen.tsx (this component moved out of that
// file on 2026-09-19): the grid needs to sit inside that file's own
// gesture arena.
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { Block, TableRow } from '../types';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import { useDensity } from '../hooks/useDensity';
import { makeStyles } from './documentEditorStyles';
import { columnLetter, displayValueOf, parseFormattedText } from '../utils/documentBlocks';
import { ask } from './surfaces/Ask';
import FormattedText from './FormattedText';

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
  const pointer = useDensity() === 'pointer';
  const cellRefs = useRef(new Map<string, TextInput | null>());
  const rows = block.tableRows && block.tableRows.length > 0 ? block.tableRows : [{ cells: ['', ''] }];
  const columnCount = rows[0]?.cells.length ?? 0;
  const [selected, setSelected] = useState<{ r: number; c: number } | null>(null);
  // Whether the formula bar currently holds keyboard focus - reliable now
  // that the grid's ScrollView has keyboardShouldPersistTaps="always"
  // (tapping a cell no longer blurs the bar first), unlike when this only
  // gated on the cell's raw text: that trapped a user on a formula cell
  // forever, since every formula's text starts with "=" and there was no
  // way to tell "still composing" from "done, tap normally now".
  const [formulaFocused, setFormulaFocused] = useState(false);
  const formulaInputRef = useRef<TextInput>(null);
  // The width being dragged right now. Local, so the column follows the
  // finger at once; the block is written only when the finger lifts,
  // because every write here is a document save.
  const [draft, setDraft] = useState<{ c: number; width: number } | null>(null);

  const headerRow = !!block.tableHeaderRow;
  const headerColumn = !!block.tableHeaderColumn;

  function widthOf(c: number): number {
    if (draft && draft.c === c) return draft.width;
    const stored = block.tableColumnWidths?.[c];
    return stored && stored > 0 ? stored : DEFAULT_COLUMN_WIDTH;
  }

  function commitWidth(c: number, width: number) {
    const widths = Array.from({ length: columnCount }, (_, i) => (i === c ? width : widthOf(i)));
    onUpdate({ tableColumnWidths: widths });
  }

  function selectCell(r: number, c: number) {
    setSelected({ r, c });
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
    if (selected && formulaFocused) {
      const currentRaw = rows[selected.r]?.cells[selected.c] ?? '';
      if (currentRaw.trim().startsWith('=')) {
        setCell(selected.r, selected.c, currentRaw + columnLetter(c) + String(r + 1));
        formulaInputRef.current?.focus();
        return;
      }
    }
    selectCell(r, c);
  }

  // Straight into the formula, at the caret's own place - on a phone
  // every one of these means switching the keyboard to its symbol layer,
  // and ":" for a range is needed in almost every formula there is.
  // Craft puts the same row in the same place, for the same reason.
  function appendToFormula(token: string) {
    if (!selected) return;
    const current = rows[selected.r]?.cells[selected.c] ?? '';
    // A cell holding a plain "5" becomes "=5+" rather than "5+", which
    // is nothing at all: pressing an operator says "this is a formula".
    const base = current.trim().startsWith('=') ? current : current.trim() ? `=${current}` : '=';
    setCell(selected.r, selected.c, base + token);
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
    if (r < 0 || r >= rows.length) return;
    setSelected({ r, c });
    cellRefs.current.get(`${r}:${c}`)?.focus();
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
    formulaInputRef.current?.blur();
  }

  function addRow() {
    onUpdate({
      tableRows: [...rows.map((row) => ({ cells: [...row.cells] })), { cells: Array(columnCount).fill('') }],
    });
  }

  function addColumn() {
    onUpdate({ tableRows: rows.map((row) => ({ cells: [...row.cells, ''] })) });
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

  async function openTableMenu() {
    const here = selected;
    const chosen = await ask({
      title: 'Таблиця',
      message: here ? `Виділено ${columnLetter(here.c)}${here.r + 1}` : undefined,
      actions: [
        ...(here && rows.length > 1
          ? [{ id: 'delRow', label: `Видалити рядок ${here.r + 1}`, tone: 'danger' as const }]
          : []),
        ...(here && columnCount > 1
          ? [{ id: 'delCol', label: `Видалити колонку ${columnLetter(here.c)}`, tone: 'danger' as const }]
          : []),
        { id: 'sum', label: 'Рядок підсумків' },
        { id: 'headerRow', label: headerRow ? 'Прибрати шапку-рядок' : 'Перший рядок — шапка' },
        { id: 'headerCol', label: headerColumn ? 'Прибрати шапку-колонку' : 'Перша колонка — шапка' },
        { id: 'resetWidths', label: 'Скинути ширину колонок' },
      ],
    });
    if (chosen === 'delRow' && here) removeRow(here.r);
    if (chosen === 'delCol' && here) removeColumn(here.c);
    if (chosen === 'sum') addSumRow();
    if (chosen === 'headerRow') onUpdate({ tableHeaderRow: !headerRow });
    if (chosen === 'headerCol') onUpdate({ tableHeaderColumn: !headerColumn });
    if (chosen === 'resetWidths') onUpdate({ tableColumnWidths: [] });
  }

  const selectedRaw = selected ? rows[selected.r]?.cells[selected.c] ?? '' : '';
  const composingFormula = selectedRaw.trim().startsWith('=');

  // ---- READING ----------------------------------------------------
  if (!canEdit) {
    // NOT styles.tableBlock: it carries flex: 1, and a flex: 1 child of a
    // parent measured by its own content collapses to nothing - which is
    // what a table became the moment editing ended, "просто тоненька
    // лінія, оце і є наша таблиця". The same trap is written up in
    // SortableBlockRow, about this same editor, in September. A
    // horizontal scroller takes its height from what is inside it.
    return (
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tableReadFrame}
      >
        <View>
          {rows.map((row, r) => (
            <View
              key={r}
              style={[
                styles.tableGridRow,
                r === rows.length - 1 && styles.tableGridRowLast,
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
    );
  }

  // ---- EDITING ----------------------------------------------------
  return (
    <View style={styles.tableBlock}>
      <View style={styles.tableFormulaBar}>
        <View style={styles.tableFormulaRefBadge}>
          <Text style={styles.tableFormulaRefText}>
            {selected ? `${columnLetter(selected.c)}${selected.r + 1}` : '—'}
          </Text>
        </View>
        <TextInput
          ref={formulaInputRef}
          style={styles.tableFormulaInput}
          value={selectedRaw}
          editable={canEdit}
          onChangeText={(value) => selected && setCell(selected.r, selected.c, value)}
          onFocus={() => setFormulaFocused(true)}
          onBlur={() => setFormulaFocused(false)}
          placeholder={selected ? 'Значення або =SUM(A1:A3)' : 'Виберіть клітинку'}
          placeholderTextColor="#9CA3AF"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="done"
          onSubmitEditing={confirmFormula}
          blurOnSubmit
        />
        {formulaFocused && (
          <Pressable hitSlop={8} onPress={confirmFormula} style={styles.tableFormulaDoneButton}>
            <Ionicons name="checkmark" size={18} color="#fff" />
          </Pressable>
        )}
      </View>

      {/* Only while a formula is actually being written. Standing there
          for every selected cell, it was seven more symbols around a
          two-by-two table for no reason - "оце от навколо купа
          символів". A cell whose text starts with "=" is the only place
          an operator means anything. */}
      {composingFormula && (
        <View style={styles.tableOperatorRow}>
          {OPERATORS.map((op) => (
            <Pressable key={op} style={styles.tableOperatorKey} onPress={() => appendToFormula(op)}>
              <Text style={styles.tableOperatorLabel}>{op}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always">
        <View style={styles.tableFrame}>
          <View style={styles.tableHeaderRow}>
            <View style={styles.tableGutterCell} />
            {Array.from({ length: columnCount }, (_, c) => (
              <View key={c} style={[styles.tableColumnHeaderCell, { width: widthOf(c) }]}>
                <Text style={styles.tableColumnHeaderText}>{columnLetter(c)}</Text>
                {/* The boundary itself is the handle, which is where a
                    hand already reaches for it. */}
                <GestureDetector gesture={resizeGesture(c)}>
                  <View style={styles.tableResizeHandle} hitSlop={8}>
                    <View style={styles.tableResizeGrip} />
                  </View>
                </GestureDetector>
              </View>
            ))}
          </View>
          {rows.map((row, r) => (
            <View
              key={r}
              style={[
                styles.tableGridRow,
                r === rows.length - 1 && styles.tableGridRowLast,
                headerRow && r === 0 && styles.tableGridHeaderRow,
              ]}
            >
              <View style={[styles.tableGutterCell, styles.tableGridCell]}>
                <Text style={styles.tableGutterText}>{r + 1}</Text>
              </View>
              {row.cells.map((_, c) => {
                const isSelected = selected?.r === r && selected?.c === c;
                if (pointer) {
                  const raw = row.cells[c] ?? '';
                  return (
                    <TextInput
                      // Re-seeded when the STORED value changes (a
                      // formula recomputing, the other device writing) -
                      // never on every keystroke, which is the whole
                      // point of leaving it uncontrolled.
                      key={`${c}:${raw}`}
                      ref={(node) => {
                        cellRefs.current.set(`${r}:${c}`, node);
                      }}
                      style={[
                        styles.tableGridCell,
                        styles.tableCellInput,
                        c === row.cells.length - 1 && styles.tableGridCellLast,
                        headerColumn && c === 0 && styles.tableGridHeaderCell,
                        { width: widthOf(c) },
                        isSelected && styles.tableCellSelected,
                      ]}
                      defaultValue={raw}
                      onFocus={() => setSelected({ r, c })}
                      onEndEditing={(e) => setCell(r, c, e.nativeEvent.text)}
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
                      autoCapitalize="none"
                      autoCorrect={false}
                    />
                  );
                }
                return (
                  <Pressable
                    key={c}
                    style={[
                      styles.tableGridCell,
                      c === row.cells.length - 1 && styles.tableGridCellLast,
                      headerColumn && c === 0 && styles.tableGridHeaderCell,
                      { width: widthOf(c) },
                      isSelected && styles.tableCellSelected,
                    ]}
                    onPress={() => handleCellPress(r, c)}
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
                  </Pressable>
                );
              })}
            </View>
          ))}
        </View>
      </ScrollView>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always">
        <View style={styles.tableControls}>
          <Pressable style={styles.tableControlBtn} onPress={addRow}>
            <Ionicons name="add" size={14} color="#6B7280" />
            <Text style={styles.tableControlLabel}>Рядок</Text>
          </Pressable>
          <Pressable style={styles.tableControlBtn} onPress={addColumn}>
            <Ionicons name="add" size={14} color="#6B7280" />
            <Text style={styles.tableControlLabel}>Колонка</Text>
          </Pressable>
          {/* Everything else is behind one button. Six controls under a
              two-by-two table is more chrome than table; adding a row
              and a column are the two anyone does often, and the rest
              are worth a tap. This also gives row DELETION a home: it
              used to be an × on every single row, which is where a lot
              of the clutter came from. */}
          <Pressable style={styles.tableControlBtn} onPress={openTableMenu}>
            <Ionicons name="ellipsis-horizontal" size={14} color="#6B7280" />
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );

  // Declared last, and a function so it closes over the current widths
  // rather than a stale copy: a drag that starts from the width the
  // column had two renders ago jumps before it moves.
  function resizeGesture(c: number) {
    const startWidth = widthOf(c);
    return Gesture.Pan()
      .runOnJS(true)
      .onStart(() => setDraft({ c, width: startWidth }))
      .onUpdate((e) => {
        setDraft({ c, width: clampWidth(startWidth + e.translationX) });
      })
      .onEnd((e) => {
        const width = clampWidth(startWidth + e.translationX);
        setDraft(null);
        commitWidth(c, width);
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
      ) : (
        <FormattedText segments={parseFormattedText(raw)} defaultColor={ink} />
      )}
    </Text>
  );
}

// Wide enough for a short word plus its padding, narrow enough that
// three fit on a phone.
const DEFAULT_COLUMN_WIDTH = 110;
const MIN_COLUMN_WIDTH = 56;
// Past this a column is a paragraph, and a paragraph belongs in a
// paragraph.
const MAX_COLUMN_WIDTH = 420;
// A cell may wrap, but it is still a cell. Four lines is a sentence.
const CELL_MAX_LINES = 4;
// A plain hyphen, not a typographic minus: this text is PARSED.
const OPERATORS = ['+', '-', '*', '/', '(', ')', ':'];

function clampWidth(width: number): number {
  return Math.round(Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, width)));
}
