import { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import * as DocumentPicker from 'expo-document-picker';
import TextInput from './AppTextInput';
import { Ionicons } from './icons/Ionicons';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import GlassLayer from './GlassLayer';
import { BELOW, useBottomSheet } from './surfaces/bottomSheet';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { SHEET_FRAME, SHEET_WINDOW } from '../constants/glass';
import { notify } from './surfaces/Ask';
import { isTableFileName, parseTableFile, type ParsedSheet } from '../utils/importTable';
import {
  GEO_ROLE_CYCLE,
  GEO_ROLE_LABEL,
  guessGeoRoles,
  looksLikeHeader,
  readGeoRows,
  type GeoColumnRole,
  type GeoImportRow,
} from '../utils/geoImport';

// «ІМПОРТ ТОЧОК» from «⋯» on the geo map (2026-10-28) - the cars base's table import, made for points: a file, its
// columns guessed (name, coordinates or latitude + longitude, note) and reassignable by a tap, a preview of what each
// row became, a folder to put them in, and the import with its progress. Saving is the screen's (onImport).

// 1 точка, 2 точки, 5 точок.
function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

export type GeoImportProgress = { done: number; total: number; note?: string };

export default function GeoImportSheet({
  visible,
  onClose,
  onImport,
}: {
  visible: boolean;
  onClose: () => void;
  // Saves the rows into the folder (null: none), reporting its progress; resolves to what came of it.
  onImport: (
    rows: GeoImportRow[],
    folder: string | null,
    progress: (p: GeoImportProgress) => void
  ) => Promise<{ saved: number; waiting: number }>;
}) {
  const b = useBottomSheet(visible, onClose);
  const keyboardHeight = useKeyboardHeight();
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const [fileName, setFileName] = useState('');
  const [sheet, setSheet] = useState<ParsedSheet | null>(null);
  const [hasHeader, setHasHeader] = useState(true);
  const [roles, setRoles] = useState<GeoColumnRole[]>([]);
  const [folder, setFolder] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<GeoImportProgress | null>(null);

  useEffect(() => {
    if (!visible) return;
    setFileName('');
    setSheet(null);
    setRoles([]);
    setFolder('');
    setProgress(null);
  }, [visible]);

  async function pickFile() {
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true });
    if (result.canceled || !result.assets[0]) return;
    const { uri, name } = result.assets[0];
    if (!isTableFileName(name)) {
      notify('Не таблиця', 'Оберіть файл .xlsx, .xls або .csv.');
      return;
    }
    setBusy(true);
    try {
      const sheets = await parseTableFile(uri);
      const first = sheets.find((s) => s.grid.length > 0);
      if (!first) {
        notify('Порожній файл', 'У таблиці немає рядків.');
        return;
      }
      const header = looksLikeHeader(first.grid);
      setFileName(name);
      setSheet(first);
      setHasHeader(header);
      setRoles(guessGeoRoles(first.grid, header));
      setFolder(name.replace(/\.(xlsx|xls|csv)$/i, ''));
    } catch (e) {
      notify('Не вдалося прочитати файл', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const rows = useMemo(() => (sheet ? readGeoRows(sheet.grid, hasHeader, roles) : []), [sheet, hasHeader, roles]);
  const usable = rows.filter((r) => r.kind !== 'bad');
  const links = rows.filter((r) => r.kind === 'link').length;
  const bad = rows.length - usable.length;
  const width = roles.length;
  const header = sheet && hasHeader ? sheet.grid[0] : null;

  function cycle(i: number) {
    setRoles((prev) => {
      const next = [...prev];
      const role = GEO_ROLE_CYCLE[(GEO_ROLE_CYCLE.indexOf(prev[i]) + 1) % GEO_ROLE_CYCLE.length];
      // One column per role (except «Пропустити»): the column that had it lets it go.
      if (role !== 'skip') next.forEach((r, j) => j !== i && r === role && (next[j] = 'skip'));
      next[i] = role;
      return next;
    });
  }

  async function run() {
    setBusy(true);
    setProgress({ done: 0, total: usable.length });
    try {
      const result = await onImport(usable, folder.trim() || null, setProgress);
      notify(
        'Імпортовано',
        `${result.saved} ${plural(result.saved, 'точка', 'точки', 'точок')}` +
          (result.waiting ? `. ${result.waiting} отримають координати, щойно з'явиться інтернет` : '') +
          (bad ? `. Пропущено рядків: ${bad}` : '')
      );
      onClose();
    } catch (e) {
      notify('Імпорт зупинився', e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  }

  return (
    <GlassLayer visible={visible} onClose={busy ? () => {} : onClose} intensity={60} rise={b.on}>
      <View style={[styles.frame, b.frame]} pointerEvents="box-none">
        <Animated.View
          style={[styles.card, b.window, keyboardHeight > 0 && { marginBottom: keyboardHeight - (b.on ? BELOW : 0) }, b.padBottom(20)]}
        >
          {b.fill}
          {b.grab}
          {b.on && <View style={{ height: 12 }} />}
          <View style={styles.header}>
            <Text style={styles.title}>Імпорт точок</Text>
            {!busy && (
              <Pressable hitSlop={8} onPress={onClose}>
                <Ionicons name="close" size={22} color={theme.ink.muted} />
              </Pressable>
            )}
          </View>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: 12 }} keyboardShouldPersistTaps="handled">
            <Pressable style={styles.fileButton} onPress={pickFile} disabled={busy}>
              <Ionicons name={sheet ? 'document-text-outline' : 'cloud-upload-outline'} size={19} color={theme.ink.primary} />
              <Text style={styles.fileLabel} numberOfLines={1}>
                {sheet ? `${fileName} · ${rows.length} ${plural(rows.length, 'рядок', 'рядки', 'рядків')}` : 'Обрати файл .xlsx або .csv'}
              </Text>
            </Pressable>
            {!sheet && (
              <Text style={styles.hint}>
                Колонки: назва, координати (градуси, MGRS або посилання Google) чи окремо широта й довгота, примітка.
              </Text>
            )}
            {sheet && (
              <>
                <Text style={styles.section}>Колонки (торк змінює)</Text>
                <View style={styles.chips}>
                  {roles.map((role, i) => (
                    <Pressable key={i} onPress={() => cycle(i)} style={[styles.chip, role === 'skip' && styles.chipOff]}>
                      <Text style={[styles.chipLabel, role === 'skip' && styles.chipLabelOff]} numberOfLines={1}>
                        {(header?.[i] ? `${String(header[i]).slice(0, 14)} → ` : `${String.fromCharCode(65 + (i % 26))} → `) + GEO_ROLE_LABEL[role]}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <Pressable style={styles.switchRow} onPress={() => setHasHeader((v) => !v)}>
                  <View style={[styles.tick, hasHeader && { backgroundColor: theme.ink.primary }]}>
                    {hasHeader && <Ionicons name="checkmark" size={14} color={theme.raised} />}
                  </View>
                  <Text style={styles.switchLabel}>Перший рядок це заголовки</Text>
                </Pressable>
                <View style={styles.preview}>
                  {rows.slice(0, 6).map((r, i) => (
                    <View key={i} style={styles.previewRow}>
                      <Ionicons
                        name={r.kind === 'point' ? 'location-outline' : r.kind === 'link' ? 'link-outline' : 'alert-circle-outline'}
                        size={16}
                        color={r.kind === 'bad' ? theme.danger : theme.ink.muted}
                      />
                      <Text style={styles.previewTitle} numberOfLines={1}>
                        {r.title}
                      </Text>
                      <Text style={styles.previewValue} numberOfLines={1}>
                        {r.kind === 'point'
                          ? `${r.point.lat.toFixed(4)}, ${r.point.lng.toFixed(4)}`
                          : r.kind === 'link'
                            ? 'посилання Google'
                            : r.reason}
                      </Text>
                    </View>
                  ))}
                  {rows.length > 6 && <Text style={styles.more}>і ще {rows.length - 6}</Text>}
                </View>
                {(links > 0 || bad > 0) && (
                  <Text style={styles.hint}>
                    {links > 0 ? `${links} ${plural(links, 'посилання', 'посилання', 'посилань')} Google прочитаю через інтернет, це трохи довше. ` : ''}
                    {bad > 0 ? `${bad} ${plural(bad, 'рядок', 'рядки', 'рядків')} без координат буде пропущено.` : ''}
                  </Text>
                )}
                <Text style={styles.section}>Папка</Text>
                <TextInput
                  value={folder}
                  onChangeText={setFolder}
                  placeholder="Без папки"
                  placeholderTextColor={theme.ink.faint}
                  style={styles.input}
                  editable={!busy}
                />
              </>
            )}
          </ScrollView>
          {progress && (
            <View style={styles.progress}>
              <View style={styles.bar}>
                <View style={[styles.barFill, { width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }]} />
              </View>
              <Text style={styles.hint}>
                {progress.done} з {progress.total}
                {progress.note ? ` · ${progress.note}` : ''}
              </Text>
            </View>
          )}
          {sheet && (
            <Pressable style={[styles.go, (busy || usable.length === 0) && { opacity: 0.5 }]} disabled={busy || usable.length === 0} onPress={run}>
              {busy ? (
                <ActivityIndicator color={theme.raised} />
              ) : (
                <Text style={styles.goLabel}>
                  Імпортувати {usable.length} {plural(usable.length, 'точку', 'точки', 'точок')}
                </Text>
              )}
            </Pressable>
          )}
          {width === 0 && busy && <ActivityIndicator color={theme.ink.primary} />}
        </Animated.View>
      </View>
    </GlassLayer>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    frame: SHEET_FRAME,
    card: { ...SHEET_WINDOW, maxHeight: '86%', backgroundColor: t.raised, borderWidth: 1, borderColor: t.edge.hairline, padding: 20, gap: 12 },
    header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    title: { fontSize: 19, fontFamily: FONT_BOLD, color: t.ink.primary },
    fileButton: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, paddingHorizontal: 14, borderRadius: 16, backgroundColor: t.surface },
    fileLabel: { flex: 1, fontSize: 15, fontFamily: FONT_SEMIBOLD, color: t.ink.primary },
    hint: { fontSize: 13, fontFamily: FONT_REGULAR, color: t.ink.muted, lineHeight: 18 },
    section: { fontSize: 13, fontFamily: FONT_SEMIBOLD, color: t.ink.muted },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 12, backgroundColor: t.surface },
    chipOff: { opacity: 0.55 },
    chipLabel: { fontSize: 13, fontFamily: FONT_SEMIBOLD, color: t.ink.primary },
    chipLabelOff: { color: t.ink.muted },
    switchRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    tick: { width: 22, height: 22, borderRadius: 7, borderWidth: 2, borderColor: t.ink.primary, alignItems: 'center', justifyContent: 'center' },
    switchLabel: { fontSize: 14, fontFamily: FONT_REGULAR, color: t.ink.primary },
    preview: { borderRadius: 14, backgroundColor: t.surface, paddingVertical: 4 },
    previewRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, height: 34 },
    previewTitle: { flex: 1, fontSize: 14, fontFamily: FONT_SEMIBOLD, color: t.ink.primary },
    previewValue: { maxWidth: '50%', fontSize: 12, fontFamily: FONT_REGULAR, color: t.ink.muted, fontVariant: ['tabular-nums'] },
    more: { fontSize: 12, fontFamily: FONT_REGULAR, color: t.ink.muted, paddingHorizontal: 12, paddingVertical: 4 },
    input: { height: 46, borderRadius: 14, paddingHorizontal: 14, backgroundColor: t.surface, color: t.ink.primary, fontSize: 15, fontFamily: FONT_REGULAR },
    progress: { gap: 6 },
    bar: { height: 6, borderRadius: 3, backgroundColor: t.surface, overflow: 'hidden' },
    barFill: { height: '100%', backgroundColor: t.ink.primary },
    go: { height: 50, borderRadius: 25, backgroundColor: t.ink.primary, alignItems: 'center', justifyContent: 'center' },
    goLabel: { fontSize: 16, fontFamily: FONT_BOLD, color: t.raised },
  });
