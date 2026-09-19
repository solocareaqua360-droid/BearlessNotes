import { useRef, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
// Deliberately gesture-handler's ScrollView, not react-native's - see the
// same note in DocumentEditorScreen.tsx (this component moved out of that
// file on 2026-09-19): the grid needs to sit inside that file's own
// gesture arena.
import { ScrollView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { Block, TableRow } from '../types';
import { useStyles } from '../theme/ThemeProvider';
import { makeStyles } from './documentEditorStyles';
import { columnLetter, displayValueOf } from '../utils/documentBlocks';

// A simple editable grid - text-only cells (no rich-text markup inside a
// cell), rows all kept the same length as columns are added/removed. The
// sum row is computed here at render time from tableShowSum rather than
// stored, so it can never drift out of sync with edited cells - parses
// each cell as a number (comma or dot decimal), treating anything that
// doesn't parse as 0.
// Spreadsheet-style table: lettered column headers + numbered row gutter
// (so a cell has an address to reference), tap-to-select cells, and a
// formula bar above the grid for typing/editing a cell's raw text - a
// full-width input beats squeezing formula text into a ~80px cell, and
// keeps only one TextInput mounted instead of one per cell (this editor
// has hit real Android keyboard/focus bugs with many TextInputs jammed
// together before, see the sketch editor's text-tool history).
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

  return (
    <View style={styles.tableBlock}>
      {canEdit && (
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
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always">
        <View>
          <View style={styles.tableHeaderRow}>
            <View style={styles.tableGutterCell} />
            {Array.from({ length: columnCount }, (_, c) => (
              <View key={c} style={styles.tableColumnHeaderCell}>
                <Text style={styles.tableColumnHeaderText}>{columnLetter(c)}</Text>
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
                    style={[styles.tableCell, isSelected && styles.tableCellSelected]}
                    onPress={() => handleCellPress(r, c)}
                  >
                    <Text style={styles.tableCellText} numberOfLines={1}>
                      {displayValueOf(rows, r, c)}
                    </Text>
                  </Pressable>
                );
              })}
              {canEdit && rows.length > 1 && (
                <Pressable hitSlop={8} onPress={() => removeRow(r)} style={styles.tableRowRemove}>
                  <Ionicons name="close" size={14} color="#9CA3AF" />
                </Pressable>
              )}
            </View>
          ))}
        </View>
      </ScrollView>
      {canEdit && (
        <View style={styles.tableControls}>
          <Pressable style={styles.tableControlBtn} onPress={addRow}>
            <Ionicons name="add" size={14} color="#6B7280" />
            <Text style={styles.tableControlLabel}>Рядок</Text>
          </Pressable>
          <Pressable style={styles.tableControlBtn} onPress={addColumn}>
            <Ionicons name="add" size={14} color="#6B7280" />
            <Text style={styles.tableControlLabel}>Колонка</Text>
          </Pressable>
          <Pressable style={styles.tableControlBtn} onPress={addSumRow}>
            <Ionicons name="calculator-outline" size={14} color="#6B7280" />
            <Text style={styles.tableControlLabel}>Підсумок</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}
