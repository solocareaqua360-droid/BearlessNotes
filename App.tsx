import { useCallback, useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import Svg from 'react-native-svg';
import SketchEditor from './src/sketch/SketchEditor';
import SketchLayer from './src/sketch/SketchLayer';
import { Ionicons } from './src/sketch/icons/Ionicons';
import { useSoft, useTheme } from './src/sketch/theme';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from './src/sketch/fonts';
import type { SketchFile } from './src/sketch/format';
import SettingsSheet from './src/SettingsSheet';
import { formatStamp } from './src/updates';
import { ActionSheet, NameDialog, type SheetAction } from './src/Sheets';
import {
  deleteSketch, exportSketch, importSketch, listSketches, loadLibrary, newFolderId, newSketch, saveLibrary, saveSketch,
  type Folder, type Library, type SortKey,
} from './src/store';

// SKETCHEVA: mindEva's drawing editor as an app of its own, to grow it
// freely and bring back to mindEva what proves itself (see CLAUDE.md and
// docs/MINDEVA_COMPAT.md). One screen for now: the drawings, newest first;
// a tap opens one in the editor, a hold offers rename, move, export and
// delete. Flat folders on top (no nesting), drawings as a 3-column grid.
export default function App() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  if (!fontsLoaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Home />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Home() {
  const S = useSoft();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [sketches, setSketches] = useState<SketchFile[]>([]);
  const [lib, setLib] = useState<Library>({ folders: [], assign: {}, sort: 'updated' });
  const [folderId, setFolderId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<SketchFile | null>(null);
  const [settings, setSettings] = useState(false);
  const [sheet, setSheet] = useState<{ title?: string; actions: SheetAction[] } | null>(null);
  const [dialog, setDialog] = useState<{ title: string; initial: string; confirm: string; onSubmit: (name: string) => void } | null>(null);

  const reload = useCallback(() => {
    listSketches().then(setSketches).catch(() => setSketches([]));
  }, []);
  useEffect(reload, [reload]);
  useEffect(() => {
    loadLibrary().then(setLib);
  }, []);

  const change = (next: Library) => {
    setLib(next);
    saveLibrary(next).catch(() => {});
  };

  const folder = lib.folders.find((f) => f.id === folderId) ?? null;
  const searching = query.trim().length > 0;
  const q = query.trim().toLowerCase();

  const shown = useMemo(() => {
    const list = sketches.filter((f) => (searching ? f.title.toLowerCase().includes(q) : (lib.assign[f.id] ?? null) === folderId));
    const by: Record<SortKey, (a: SketchFile, b: SketchFile) => number> = {
      title: (a, b) => a.title.localeCompare(b.title),
      created: (a, b) => b.createdAt - a.createdAt,
      updated: (a, b) => b.updatedAt - a.updatedAt,
    };
    return list.sort(by[lib.sort]);
  }, [sketches, lib, folderId, searching, q]);

  const folders = useMemo(() => {
    if (folderId) return [];
    return lib.folders
      .filter((f) => !searching || f.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [lib.folders, folderId, searching, q]);

  const countIn = (id: string) => sketches.filter((f) => lib.assign[f.id] === id).length;

  const createFolder = () =>
    setDialog({
      title: 'Нова папка',
      initial: '',
      confirm: 'Створити',
      onSubmit: (name) => {
        change({ ...lib, folders: [...lib.folders, { id: newFolderId(), name }] });
        setDialog(null);
      },
    });

  const renameFolder = (f: Folder) =>
    setDialog({
      title: 'Назва папки',
      initial: f.name,
      confirm: 'Зберегти',
      onSubmit: (name) => {
        change({ ...lib, folders: lib.folders.map((x) => (x.id === f.id ? { ...x, name } : x)) });
        setDialog(null);
      },
    });

  const deleteFolder = (f: Folder) =>
    Alert.alert('Видалити папку?', `«${f.name}» зникне, а малюнки з неї повернуться на головний екран.`, [
      { text: 'Скасувати', style: 'cancel' },
      {
        text: 'Видалити',
        style: 'destructive',
        onPress: () => {
          const assign = { ...lib.assign };
          for (const k of Object.keys(assign)) if (assign[k] === f.id) delete assign[k];
          change({ ...lib, folders: lib.folders.filter((x) => x.id !== f.id), assign });
          if (folderId === f.id) setFolderId(null);
        },
      },
    ]);

  const moveTo = (file: SketchFile, id: string | null) => {
    const assign = { ...lib.assign };
    if (id) assign[file.id] = id;
    else delete assign[file.id];
    change({ ...lib, assign });
  };

  const renameSketch = (file: SketchFile) =>
    setDialog({
      title: 'Назва малюнка',
      initial: file.title,
      confirm: 'Зберегти',
      onSubmit: (name) => {
        // A rename is not an edit of the drawing: the date stays.
        saveSketch({ ...file, title: name }).then(reload);
        setDialog(null);
      },
    });

  const moveSheet = (file: SketchFile) =>
    setSheet({
      title: 'Перемістити в…',
      actions: [
        { label: 'Без папки', icon: 'albums', checked: !lib.assign[file.id], onPress: () => moveTo(file, null) },
        ...lib.folders.map((f) => ({ label: f.name, icon: 'folder', checked: lib.assign[file.id] === f.id, onPress: () => moveTo(file, f.id) })),
      ],
    });

  const holdSketch = (file: SketchFile) =>
    setSheet({
      title: file.title,
      actions: [
        { label: 'Перейменувати', icon: 'pencil', onPress: () => renameSketch(file) },
        { label: 'Перемістити в папку', icon: 'folder-open', onPress: () => setTimeout(() => moveSheet(file), 250) },
        { label: 'Експортувати', icon: 'share', onPress: () => exportSketch(file).catch((e) => Alert.alert('Не вийшло', String(e))) },
        {
          label: 'Видалити',
          icon: 'trash',
          destructive: true,
          onPress: () =>
            Alert.alert('Видалити малюнок?', `«${file.title}» зникне з цього телефона.`, [
              { text: 'Скасувати', style: 'cancel' },
              {
                text: 'Видалити',
                style: 'destructive',
                onPress: () => {
                  const assign = { ...lib.assign };
                  delete assign[file.id];
                  change({ ...lib, assign });
                  deleteSketch(file.id).then(reload);
                },
              },
            ]),
        },
      ],
    });

  const holdFolder = (f: Folder) =>
    setSheet({
      title: f.name,
      actions: [
        { label: 'Перейменувати', icon: 'pencil', onPress: () => renameFolder(f) },
        { label: 'Видалити', icon: 'trash', destructive: true, onPress: () => deleteFolder(f) },
      ],
    });

  const importOne = () =>
    importSketch()
      .then((file) => {
        if (!file) return;
        if (folderId) change({ ...lib, assign: { ...lib.assign, [file.id]: folderId } });
        reload();
      })
      .catch((e) => Alert.alert('Не вийшло імпортувати', e instanceof Error ? e.message : String(e)));

  const menu = () => {
    const sorts: [SortKey, string, string][] = [
      ['title', 'За алфавітом', 'text'],
      ['created', 'Дата створення', 'add-circle'],
      ['updated', 'Дата зміни', 'create'],
    ];
    const actions: SheetAction[] = [
      { label: 'Порядок', header: true },
      ...sorts.map(([key, label, icon]) => ({ label, icon, checked: lib.sort === key, onPress: () => change({ ...lib, sort: key }) })),
    ];
    if (!folder) actions.push({ label: 'Нова папка', icon: 'folder', onPress: createFolder });
    actions.push({ label: 'Імпортувати малюнок', icon: 'download', onPress: importOne });
    if (folder) {
      actions.push({ label: 'Перейменувати папку', icon: 'pencil', onPress: () => renameFolder(folder) });
      actions.push({ label: 'Видалити папку', icon: 'trash', destructive: true, onPress: () => deleteFolder(folder) });
    }
    setSheet({ actions });
  };

  const empty = shown.length === 0 && folders.length === 0;

  return (
    <View style={[styles.fill, { backgroundColor: S.bg }]}>
      <StatusBar style={S.dark ? 'light' : 'dark'} />

      <View style={[styles.header, { top: insets.top + 8, backgroundColor: S.chrome, boxShadow: S.shadow }]}>
        <Pressable
          onPress={() => setFolderId(null)}
          disabled={!folder}
          style={styles.headerBtn}
          accessibilityLabel="Назад"
        >
          {folder ? <Ionicons name="chevron-back" size={24} color={S.ink} /> : null}
        </Pressable>
        <Text style={[styles.headerTitle, { color: S.ink }]} numberOfLines={1}>
          {folder ? folder.name : 'Малюнки'}
        </Text>
        <Pressable onPress={menu} style={styles.headerBtn} accessibilityLabel="Меню">
          <Ionicons name="ellipsis-horizontal" size={22} color={S.accent} />
        </Pressable>
      </View>

      <ScrollView
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={{ paddingTop: insets.top + 80, paddingBottom: insets.bottom + 110, paddingHorizontal: 16 }}
      >
        {folders.length > 0 && (
          <View style={styles.folders}>
            {folders.map((f) => (
              <Pressable
                key={f.id}
                onPress={() => {
                  setQuery('');
                  setFolderId(f.id);
                }}
                onLongPress={() => holdFolder(f)}
                style={[styles.folder, { backgroundColor: S.card, boxShadow: S.shadow }]}
              >
                <View style={[styles.folderIcon, { backgroundColor: S.fill }]}>
                  <Ionicons name="folder" size={22} color={S.ink2} />
                </View>
                <View style={styles.folderText}>
                  <Text style={[styles.folderName, { color: S.ink }]} numberOfLines={1}>
                    {f.name}
                  </Text>
                  <Text style={[styles.folderCount, { color: S.ink3 }]}>{countIn(f.id)}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={S.ink3} />
              </Pressable>
            ))}
          </View>
        )}

        {empty && (
          <Text style={[styles.empty, { color: S.ink3 }]}>
            {searching ? 'Нічого не знайдено.' : folder ? 'У цій папці ще порожньо. Натисни «+».' : 'Ще немає малюнків. Натисни «+», щоб почати.'}
          </Text>
        )}

        <View style={styles.grid}>
          {shown.map((file) => (
            <Pressable
              key={file.id}
              onPress={() => setOpen(file)}
              onLongPress={() => holdSketch(file)}
              style={[styles.card, { backgroundColor: S.card, boxShadow: S.shadow }]}
            >
              <View style={[styles.preview, { backgroundColor: theme.paper.fill }]}>
                {file.width > 0 && (
                  <Svg width="100%" height="100%" viewBox={`0 0 ${file.width} ${file.height}`} preserveAspectRatio="xMidYMid meet">
                    <SketchLayer elements={file.elements} ink={theme.paper.ink} />
                  </Svg>
                )}
                <View style={[styles.stamp, { backgroundColor: theme.paper.fill }]}>
                  <Text style={[styles.stampText, { color: S.ink2 }]}>{formatStamp(file.updatedAt)}</Text>
                </View>
              </View>
              <Text style={[styles.cardTitle, { color: S.ink }]} numberOfLines={1}>
                {file.title}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.dock, { bottom: insets.bottom + 16 }]}>
        <View style={[styles.search, { backgroundColor: S.chrome, boxShadow: S.shadow }]}>
          <Ionicons name="search" size={20} color={S.ink3} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Пошук"
            placeholderTextColor={S.ink3}
            style={[styles.searchInput, { color: S.ink }]}
            returnKeyType="search"
          />
          <Pressable
            onPress={() => setOpen(newSketch())}
            style={[styles.plus, { backgroundColor: S.ink }]}
            accessibilityLabel="Новий малюнок"
          >
            <Ionicons name="add" size={26} color={S.chrome} />
          </Pressable>
        </View>
        <Pressable
          onPress={() => setSettings(true)}
          style={[styles.round, { backgroundColor: S.chrome, boxShadow: S.shadow }]}
          accessibilityLabel="Налаштування"
        >
          <Ionicons name="settings-outline" size={22} color={S.ink} />
        </Pressable>
      </View>

      <SettingsSheet visible={settings} onClose={() => setSettings(false)} />
      <ActionSheet title={sheet?.title} actions={sheet?.actions ?? null} onClose={() => setSheet(null)} />
      <NameDialog
        visible={dialog !== null}
        title={dialog?.title ?? ''}
        initial={dialog?.initial ?? ''}
        confirm={dialog?.confirm ?? ''}
        onSubmit={(name) => dialog?.onSubmit(name)}
        onClose={() => setDialog(null)}
      />

      <SketchEditor
        visible={open !== null}
        initialElements={open?.elements ?? []}
        onClose={() => setOpen(null)}
        onSave={(elements, width, height) => {
          if (!open) return;
          const file = { ...open, elements, width, height, updatedAt: Date.now() };
          // A drawing born inside a folder stays in it.
          if (open.createdAt === open.updatedAt && folderId && !lib.assign[open.id]) {
            change({ ...lib, assign: { ...lib.assign, [open.id]: folderId } });
          }
          setOpen(null);
          saveSketch(file).then(reload);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  header: { position: 'absolute', left: 16, right: 16, height: 56, borderRadius: 28, flexDirection: 'row', alignItems: 'center', zIndex: 2 },
  headerBtn: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { flex: 1, fontSize: 20, fontFamily: SOFT_SEMIBOLD, textAlign: 'center' },
  empty: { fontSize: 15, fontFamily: SOFT_MEDIUM, marginTop: 40, textAlign: 'center' },
  folders: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  folder: { width: '48.8%', height: 64, borderRadius: 20, flexDirection: 'row', alignItems: 'center', paddingLeft: 10, paddingRight: 10, gap: 10 },
  folderIcon: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  folderText: { flex: 1 },
  folderName: { fontSize: 15, fontFamily: SOFT_SEMIBOLD },
  folderCount: { fontSize: 13, fontFamily: SOFT_MEDIUM, marginTop: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  card: { width: '31.5%', borderRadius: 14, overflow: 'hidden' },
  preview: { aspectRatio: 0.75 },
  cardTitle: { fontSize: 12, fontFamily: SOFT_MEDIUM, paddingHorizontal: 8, paddingVertical: 7 },
  stamp: { position: 'absolute', right: 4, bottom: 4, borderRadius: 6, paddingHorizontal: 4, paddingVertical: 1 },
  stampText: { fontSize: 9, fontFamily: SOFT_MEDIUM },
  dock: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', gap: 10, alignItems: 'center' },
  search: { flex: 1, height: 56, borderRadius: 28, flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 6, gap: 10 },
  searchInput: { flex: 1, fontSize: 16, fontFamily: SOFT_MEDIUM, padding: 0 },
  plus: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  round: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
});
