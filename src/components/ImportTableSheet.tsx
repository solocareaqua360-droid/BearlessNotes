import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as DocumentPicker from 'expo-document-picker';
import { collection, onSnapshot, orderBy, query } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { FieldDef, FieldType } from '../types';
import {
  ColumnMapping,
  ParsedSheet,
  createDatabaseForImport,
  ensureLocalFile,
  guessFieldType,
  isTableFileName,
  optionsFromColumn,
  parseTableFile,
  runTableImport,
} from '../utils/importTable';
import { FIELD_TYPE_LABEL } from './FieldsEditorSheet';

const ACCENT = '#3B82F6';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// The field types a column can be imported as. 'relation' is offered
// separately (once per other database), and 'backlink' never - it holds
// nothing of its own, so there is nothing in a file to put in it.
const IMPORTABLE_TYPES: FieldType[] = ['text', 'number', 'date', 'select', 'multiSelect'];

type Props = {
  visible: boolean;
  // Set to import into an existing database (columns map onto its own
  // fields); absent creates a new database from the file.
  targetDatabase?: { id: string; name: string; fields: FieldDef[] } | null;
  // What a relation column can point at.
  otherDatabases: { id: string; name: string }[];
  onClose: () => void;
  onDone: (databaseId: string, rowCount: number) => void;
};

// Import a .xlsx/.xls/.csv into a database: pick the file, say which of its
// columns becomes which database column, import. Typing every row by hand
// is the thing this exists to avoid, so the mapping step is deliberately
// the only step that asks anything.
export default function ImportTableSheet({ visible, targetDatabase, otherDatabases, onClose, onDone }: Props) {
  const [sheets, setSheets] = useState<ParsedSheet[] | null>(null);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [hasHeaderRow, setHasHeaderRow] = useState(true);
  const [mappings, setMappings] = useState<ColumnMapping[]>([]);
  const [openMenuColumn, setOpenMenuColumn] = useState<number | null>(null);
  const [databaseName, setDatabaseName] = useState('');
  // Which column becomes the row's name. fields[0] is the title everywhere
  // in the app, so this one is simply placed first when the fields are
  // built - the file's own column order is kept for all the others.
  const [titleColumn, setTitleColumn] = useState(0);
  const [busy, setBusy] = useState(false);
  // Spreadsheets already sitting in the Files database - a file shared into
  // the app earlier is the common case, and making the user go find it
  // again through the system picker would be silly.
  const [storedFiles, setStoredFiles] = useState<
    { id: string; fileUri: string; fileName: string; title?: string; driveFileId?: string }[]
  >([]);

  useEffect(() => {
    if (!visible) return;
    return onSnapshot(query(collection(db, 'files'), orderBy('updatedAt', 'desc')), (snapshot) => {
      setStoredFiles(
        snapshot.docs
          .map((d) => {
            const data = d.data();
            return {
              id: d.id,
              fileUri: data.fileUri as string,
              fileName: (data.fileName as string) ?? '',
              title: data.title as string | undefined,
              driveFileId: data.driveFileId as string | undefined,
            };
          })
          .filter((f) => isTableFileName(f.fileName) || isTableFileName(f.title ?? ''))
      );
    });
  }, [visible]);

  const sheet = sheets?.[sheetIndex] ?? null;
  const grid = sheet?.grid ?? [];
  const headerRow = hasHeaderRow ? (grid[0] ?? []) : [];
  const dataRows = hasHeaderRow ? grid.slice(1) : grid;
  const columnCount = grid.reduce((max, row) => Math.max(max, row.length), 0);

  function reset() {
    setSheets(null);
    setSheetIndex(0);
    setHasHeaderRow(true);
    setMappings([]);
    setOpenMenuColumn(null);
    setDatabaseName('');
    setTitleColumn(0);
    setBusy(false);
  }

  function columnLabel(index: number): string {
    const header = (headerRow[index] ?? '').toString().trim();
    return header || `Колонка ${index + 1}`;
  }

  function columnValues(index: number, rows: string[][]): string[] {
    return rows.map((r) => (r[index] ?? '').toString());
  }

  // A first pass over the file: every column mapped to a new field of its
  // guessed type, which is right often enough that most imports are just
  // "pick file, import".
  function buildDefaultMappings(parsed: ParsedSheet, withHeader: boolean): ColumnMapping[] {
    const rows = withHeader ? parsed.grid.slice(1) : parsed.grid;
    const count = parsed.grid.reduce((max, r) => Math.max(max, r.length), 0);
    const header = withHeader ? (parsed.grid[0] ?? []) : [];
    return Array.from({ length: count }, (_, index): ColumnMapping => {
      const name = (header[index] ?? '').toString().trim() || `Колонка ${index + 1}`;
      if (targetDatabase) {
        // Into an existing database: match by name where possible, skip
        // whatever doesn't line up rather than guessing.
        const match = targetDatabase.fields.find((f) => f.name.trim().toLowerCase() === name.toLowerCase());
        return match ? { kind: 'existingField', fieldId: match.id } : { kind: 'skip' };
      }
      return {
        kind: 'newField',
        fieldId: generateId(),
        name,
        type: index === titleColumn ? 'text' : guessFieldType(columnValues(index, rows)),
      };
    });
  }

  async function loadFile(uri: string, displayName: string) {
    setBusy(true);
    try {
      const parsed = await parseTableFile(uri);
      const nonEmpty = parsed.filter((s) => s.grid.length > 0);
      if (nonEmpty.length === 0) {
        Alert.alert('Порожній файл', 'У цьому файлі не знайшлося жодного рядка.');
        return;
      }
      setSheets(nonEmpty);
      setSheetIndex(0);
      setMappings(buildDefaultMappings(nonEmpty[0], true));
      setDatabaseName(displayName.replace(/\.[^.]+$/, ''));
    } catch (e) {
      console.warn('[ImportTableSheet] parse failed', e);
      Alert.alert('Не вдалося прочитати файл', 'Підтримуються .xlsx, .xls і .csv.');
    } finally {
      setBusy(false);
    }
  }

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    await loadFile(result.assets[0].uri, result.assets[0].name);
  }

  // The bytes may not be on this device (a file restored from a backup, or
  // shared from another one) - pulled back from its Drive copy first, the
  // same way a thumbnail would be.
  async function useStoredFile(file: { fileUri: string; fileName: string; title?: string; driveFileId?: string }) {
    setBusy(true);
    const available = await ensureLocalFile(file.fileUri, file.driveFileId).catch(() => false);
    setBusy(false);
    if (!available) {
      Alert.alert('Файл недоступний', 'Його немає на цьому пристрої і не вдалося відновити з резервної копії.');
      return;
    }
    await loadFile(file.fileUri, file.title || file.fileName);
  }

  function selectSheet(index: number) {
    if (!sheets) return;
    setSheetIndex(index);
    setMappings(buildDefaultMappings(sheets[index], hasHeaderRow));
  }

  function toggleHeaderRow() {
    if (!sheets) return;
    const next = !hasHeaderRow;
    setHasHeaderRow(next);
    setMappings(buildDefaultMappings(sheets[sheetIndex], next));
  }

  // The name column can't be skipped or be anything but text, so choosing
  // one repairs its mapping if it was set to something else.
  function chooseTitleColumn(index: number) {
    setTitleColumn(index);
    setMappings((prev) =>
      prev.map((m, i) => {
        if (i !== index) return m;
        if (m.kind === 'newField') return { ...m, type: 'text', relationDatabaseId: undefined };
        return { kind: 'newField', fieldId: generateId(), name: columnLabel(index), type: 'text' };
      })
    );
    setOpenMenuColumn(null);
  }

  // Reuses the id this column was already going to become, so switching a
  // column's type doesn't quietly make it a different field.
  function fieldIdFor(index: number): string {
    const current = mappings[index];
    return current && current.kind !== 'skip' ? current.fieldId : generateId();
  }

  function setMapping(index: number, mapping: ColumnMapping) {
    setMappings((prev) => prev.map((m, i) => (i === index ? mapping : m)));
    setOpenMenuColumn(null);
  }

  function mappingLabel(mapping: ColumnMapping): string {
    if (mapping.kind === 'skip') return 'Пропустити';
    if (mapping.kind === 'existingField') {
      return targetDatabase?.fields.find((f) => f.id === mapping.fieldId)?.name ?? 'Поле';
    }
    if (mapping.relationDatabaseId) {
      return `Зв'язок: ${otherDatabases.find((d) => d.id === mapping.relationDatabaseId)?.name ?? 'база'}`;
    }
    return FIELD_TYPE_LABEL[mapping.type];
  }

  async function runImport() {
    if (!sheet) return;
    setBusy(true);
    try {
      let databaseId = targetDatabase?.id ?? '';
      let fields: FieldDef[] = targetDatabase?.fields ?? [];

      if (!targetDatabase) {
        // Build the new database's fields from the columns mapped to one,
        // in file order.
        // The chosen name column goes first (fields[0] is the title
        // everywhere in the app); everything else keeps the file's order.
        const order = [titleColumn, ...mappings.map((_, i) => i).filter((i) => i !== titleColumn)];
        fields = order
          .map((index) => {
            const mapping = mappings[index];
            if (!mapping || mapping.kind !== 'newField') return null;
            const field: FieldDef = {
              id: mapping.fieldId,
              name: mapping.name.trim() || `Колонка ${index + 1}`,
              type: mapping.relationDatabaseId ? 'relation' : mapping.type,
            };
            if (mapping.relationDatabaseId) {
              field.relationTarget = { kind: 'customDb', databaseId: mapping.relationDatabaseId };
            } else if (mapping.type === 'select' || mapping.type === 'multiSelect') {
              field.options = optionsFromColumn(columnValues(index, dataRows), mapping.type === 'multiSelect');
            }
            return field;
          })
          .filter((f): f is FieldDef => f !== null);
        if (fields.length === 0) {
          Alert.alert('Нічого імпортувати', 'Хоча б одна колонка має стати полем бази.');
          return;
        }
        databaseId = await createDatabaseForImport(databaseName.trim(), fields);
      }

      const written = await runTableImport({ databaseId, fields, columns: mappings, dataRows });
      onDone(databaseId, written);
      reset();
    } catch (e) {
      console.warn('[ImportTableSheet] import failed', e);
      Alert.alert('Не вдалося імпортувати', 'Спробуйте ще раз.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => {
        reset();
        onClose();
      }}
    >
      <Pressable
        style={styles.backdrop}
        onPress={() => {
          reset();
          onClose();
        }}
      >
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>
            {targetDatabase ? `Імпорт у "${targetDatabase.name}"` : 'Імпорт таблиці'}
          </Text>

          {!sheet ? (
            <View style={styles.pickArea}>
              <Text style={styles.hint}>Оберіть файл .xlsx, .xls або .csv.</Text>
              <Pressable style={styles.primaryButton} onPress={() => pickFile()} disabled={busy}>
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonLabel}>Обрати файл на пристрої</Text>
                )}
              </Pressable>

              {storedFiles.length > 0 && (
                <>
                  <Text style={styles.sectionLabel}>З бази файлів</Text>
                  <ScrollView style={styles.storedList} keyboardShouldPersistTaps="handled">
                    {storedFiles.map((f) => (
                      <Pressable
                        key={f.id}
                        style={styles.storedRow}
                        disabled={busy}
                        onPress={() => useStoredFile(f)}
                      >
                        <Ionicons name="document-outline" size={18} color={ACCENT} />
                        <Text style={styles.storedLabel} numberOfLines={1}>
                          {f.title || f.fileName}
                        </Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                </>
              )}
            </View>
          ) : (
            <ScrollView style={styles.body} keyboardShouldPersistTaps="handled">
              {sheets && sheets.length > 1 && (
                <>
                  <Text style={styles.sectionLabel}>Аркуш</Text>
                  <View style={styles.sheetRow}>
                    {sheets.map((s, i) => (
                      <Pressable
                        key={s.name}
                        style={[styles.chip, i === sheetIndex && styles.chipActive]}
                        onPress={() => selectSheet(i)}
                      >
                        <Text style={[styles.chipLabel, i === sheetIndex && styles.chipLabelActive]}>{s.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                </>
              )}

              <Pressable style={styles.switchRow} onPress={toggleHeaderRow}>
                <Ionicons
                  name={hasHeaderRow ? 'checkbox' : 'square-outline'}
                  size={18}
                  color={hasHeaderRow ? ACCENT : '#9CA3AF'}
                />
                <Text style={styles.switchLabel}>Перший рядок це заголовки</Text>
              </Pressable>

              {!targetDatabase && (
                <>
                  <Text style={styles.sectionLabel}>Назва бази</Text>
                  <TextInput
                    style={styles.input}
                    value={databaseName}
                    onChangeText={setDatabaseName}
                    placeholder="Назва бази"
                  />
                </>
              )}

              <Text style={styles.sectionLabel}>Колонки ({dataRows.length} рядків)</Text>
              {Array.from({ length: columnCount }, (_, index) => {
                const mapping = mappings[index] ?? { kind: 'skip' as const };
                const sample = dataRows.find((r) => (r[index] ?? '').toString().trim() !== '');
                return (
                  <View key={index} style={styles.columnCard}>
                    <View style={styles.columnHead}>
                      <View style={styles.columnHeadText}>
                        <Text style={styles.columnName} numberOfLines={1}>
                          {columnLabel(index)}
                        </Text>
                        <Text style={styles.columnSample} numberOfLines={1}>
                          {sample ? String(sample[index]) : 'порожня'}
                        </Text>
                      </View>
                      {!targetDatabase &&
                        (index === titleColumn ? (
                          <Text style={styles.titleBadge}>Назва</Text>
                        ) : (
                          <Pressable hitSlop={6} onPress={() => chooseTitleColumn(index)}>
                            <Text style={styles.titleBadgePick}>Зробити назвою</Text>
                          </Pressable>
                        ))}
                    </View>

                    <Pressable
                      style={styles.mappingRow}
                      onPress={() => setOpenMenuColumn(openMenuColumn === index ? null : index)}
                    >
                      <Text
                        style={[
                          styles.mappingLabel,
                          mapping.kind === 'skip' && styles.mappingLabelSkip,
                        ]}
                        numberOfLines={1}
                      >
                        {mappingLabel(mapping)}
                      </Text>
                      <Ionicons
                        name={openMenuColumn === index ? 'chevron-up' : 'chevron-down'}
                        size={16}
                        color="#9CA3AF"
                      />
                    </Pressable>

                    {openMenuColumn === index && (
                      <View style={styles.menu}>
                        <Pressable style={styles.menuRow} onPress={() => setMapping(index, { kind: 'skip' })}>
                          <Text style={styles.menuRowLabel}>Пропустити</Text>
                        </Pressable>

                        {targetDatabase
                          ? targetDatabase.fields
                              .filter((f) => f.type !== 'backlink')
                              .map((f) => (
                                <Pressable
                                  key={f.id}
                                  style={styles.menuRow}
                                  onPress={() => setMapping(index, { kind: 'existingField', fieldId: f.id })}
                                >
                                  <Text style={styles.menuRowLabel}>{f.name}</Text>
                                  <Text style={styles.menuRowType}>{FIELD_TYPE_LABEL[f.type]}</Text>
                                </Pressable>
                              ))
                          : (index === titleColumn ? (['text'] as FieldType[]) : IMPORTABLE_TYPES).map((type) => (
                              <Pressable
                                key={type}
                                style={styles.menuRow}
                                onPress={() =>
                                  setMapping(index, {
                                    kind: 'newField',
                                    fieldId: fieldIdFor(index),
                                    name: columnLabel(index),
                                    type,
                                  })
                                }
                              >
                                <Text style={styles.menuRowLabel}>Нове поле</Text>
                                <Text style={styles.menuRowType}>{FIELD_TYPE_LABEL[type]}</Text>
                              </Pressable>
                            ))}

                        {/* A relation column matches its text against the
                            target database's own names, creating whatever
                            is missing - which is what links two imported
                            files together without a second pass by hand. */}
                        {!targetDatabase &&
                          index !== titleColumn &&
                          otherDatabases.map((odb) => (
                            <Pressable
                              key={odb.id}
                              style={styles.menuRow}
                              onPress={() =>
                                setMapping(index, {
                                  kind: 'newField',
                                  fieldId: fieldIdFor(index),
                                  name: columnLabel(index),
                                  type: 'relation',
                                  relationDatabaseId: odb.id,
                                })
                              }
                            >
                              <Text style={styles.menuRowLabel}>Зв'язок за назвою</Text>
                              <Text style={styles.menuRowType}>{odb.name}</Text>
                            </Pressable>
                          ))}
                      </View>
                    )}
                  </View>
                );
              })}

              <Pressable style={styles.primaryButton} onPress={() => runImport()} disabled={busy}>
                {busy ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.primaryButtonLabel}>Імпортувати {dataRows.length}</Text>
                )}
              </Pressable>
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  body: {
    marginTop: 4,
  },
  pickArea: {
    gap: 16,
    paddingVertical: 20,
  },
  hint: {
    fontSize: 14,
    color: '#6B7280',
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: 14,
    marginBottom: 6,
  },
  sheetRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  chipActive: {
    backgroundColor: '#EFF6FF',
    borderColor: ACCENT,
  },
  chipLabel: {
    fontSize: 13,
    color: '#374151',
  },
  chipLabelActive: {
    color: ACCENT,
    fontWeight: '600',
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 12,
  },
  switchLabel: {
    fontSize: 15,
    color: '#111827',
  },
  input: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
  },
  columnCard: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 12,
    padding: 10,
    marginBottom: 8,
  },
  columnHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  columnHeadText: {
    flex: 1,
    minWidth: 0,
  },
  columnName: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  columnSample: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  titleBadge: {
    fontSize: 11,
    fontWeight: '700',
    color: ACCENT,
  },
  titleBadgePick: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  mappingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  mappingLabel: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
  },
  mappingLabelSkip: {
    color: '#9CA3AF',
  },
  menu: {
    marginTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
  },
  menuRowLabel: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
  },
  menuRowType: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  storedList: {
    maxHeight: 260,
  },
  storedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  storedLabel: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
  },
  primaryButton: {
    backgroundColor: ACCENT,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 16,
  },
  primaryButtonLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
  },
});
