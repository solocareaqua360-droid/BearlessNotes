import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
// Deliberately gesture-handler's ScrollView, not react-native's - see the
// same note in DocumentEditorScreen.tsx (this component moved out of that
// file on 2026-09-19): the grid needs to sit inside that file's own
// gesture arena.
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { Block, TableRow } from '../types';
import { useStyles } from '../theme/ThemeProvider';
import { makeStyles } from './documentEditorStyles';
import { columnLetter, displayValueOf } from '../utils/documentBlocks';

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

  const selectedRaw = selected ? rows[selected.r]?.cells[selected.c] ?? '' : '';

  // ---- READING ----------------------------------------------------
  if (!canEdit) {
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tableBlock}>
        <View>
          {rows.map((row, r) => (
            <View
              key={r}
              style={[styles.tableReadRow, headerRow && r === 0 && styles.tableReadHeaderRow]}
            >
              {row.cells.map((_, c) => (
                <View key={c} style={[styles.tableReadCell, { width: widthOf(c) }]}>
                  <Text
                    style={[
                      styles.tableCellText,
                      ((headerRow && r === 0) || (headerColumn && c === 0)) && styles.tableReadStrong,
                    ]}
                    numberOfLines={CELL_MAX_LINES}
                  >
                    {displayValueOf(rows, r, c)}
                  </Text>
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

      {!!selected && (
        <View style={styles.tableOperatorRow}>
          {OPERATORS.map((op) => (
            <Pressable key={op} style={styles.tableOperatorKey} onPress={() => appendToFormula(op)}>
              <Text style={styles.tableOperatorLabel}>{op}</Text>
            </Pressable>
          ))}
        </View>
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always">
        <View>
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
            <View key={r} style={styles.tableRow}>
              <View style={styles.tableGutterCell}>
                <Text style={styles.tableGutterText}>{r + 1}</Text>
              </View>
              {row.cells.map((_, c) => {
                const isSelected = selected?.r === r && selected?.c === c;
                return (
                  <Pressable
                    key={c}
                    style={[styles.tableCell, { width: widthOf(c) }, isSelected && styles.tableCellSelected]}
                    onPress={() => handleCellPress(r, c)}
                  >
                    <Text
                      style={[
                        styles.tableCellText,
                        ((headerRow && r === 0) || (headerColumn && c === 0)) && styles.tableReadStrong,
                      ]}
                      numberOfLines={CELL_MAX_LINES}
                    >
                      {displayValueOf(rows, r, c)}
                    </Text>
                  </Pressable>
                );
              })}
              {rows.length > 1 && (
                <Pressable hitSlop={8} onPress={() => removeRow(r)} style={styles.tableRowRemove}>
                  <Ionicons name="close" size={14} color="#9CA3AF" />
                </Pressable>
              )}
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
          {!!selected && columnCount > 1 && (
            <Pressable style={styles.tableControlBtn} onPress={() => removeColumn(selected.c)}>
              <Ionicons name="remove" size={14} color="#6B7280" />
              <Text style={styles.tableControlLabel}>Колонка {columnLetter(selected.c)}</Text>
            </Pressable>
          )}
          <Pressable style={styles.tableControlBtn} onPress={addSumRow}>
            <Ionicons name="calculator-outline" size={14} color="#6B7280" />
            <Text style={styles.tableControlLabel}>Підсумок</Text>
          </Pressable>
          {/* Two switches, not one convention: whether a table's first
              row names the others is a fact only its author knows. */}
          <Pressable
            style={[styles.tableControlBtn, headerRow && styles.tableControlBtnOn]}
            onPress={() => onUpdate({ tableHeaderRow: !headerRow })}
          >
            <Ionicons name="reorder-two-outline" size={14} color="#6B7280" />
            <Text style={styles.tableControlLabel}>Шапка</Text>
          </Pressable>
          <Pressable
            style={[styles.tableControlBtn, headerColumn && styles.tableControlBtnOn]}
            onPress={() => onUpdate({ tableHeaderColumn: !headerColumn })}
          >
            <Ionicons name="reorder-three-outline" size={14} color="#6B7280" />
            <Text style={styles.tableControlLabel}>Перша колонка</Text>
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
