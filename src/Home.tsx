import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Alert,
  BackHandler,
  Keyboard,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Svg from 'react-native-svg';
import SketchEditor from './sketch/SketchEditor';
import SketchLayer from './sketch/SketchLayer';
import { Ionicons } from './sketch/icons/Ionicons';
import { useSoft, useTheme } from './sketch/theme';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from './sketch/fonts';
import type { SketchFile } from './sketch/format';
import SettingsSheet from './SettingsSheet';
import HoldTarget, { type Rect } from './HoldTarget';
import { ActionSheet, NameDialog, type SheetAction } from './Sheets';
import {
  deleteSketch,
  duplicateSketch,
  exportSketch,
  importSketch,
  listSketches,
  loadLibrary,
  newSketch,
  saveLibrary,
  saveSketch,
} from './store';
import {
  addFolder,
  allPaths,
  childFolders,
  cleanName,
  colorOf,
  compareTitles,
  deleteFolder,
  emptyLibrary,
  moveDrawings,
  join,
  moveFolder,
  nameOf,
  parentOf,
  renameFolder,
  showPath,
  within,
  type Library,
  type SortKey,
} from './library';

// THE DRAWINGS SCREEN, built on mindEva's «Зображення» desk (see the spec
// the user passed on, 2026-10-04): nested folders on top (explorer), the
// drawings below as a grid or a list, a bar with the path and «⋯», a dock
// with search and «+», a hold menu over the lifted card, drag onto a folder,
// a bin. Left out by the user's answers: projects, a drawing in several
// folders, vibration (needs a new APK).
const BIN_DAYS = 30;
const UNDO_MS = 4000;
const RED = '#E0524A';

const MONTHS = ['січ.', 'лют.', 'берез.', 'квіт.', 'трав.', 'черв.', 'лип.', 'серп.', 'верес.', 'жовт.', 'листоп.', 'груд.'];
const p2 = (n: number) => String(n).padStart(2, '0');
// «4 жовт. 2026 р., 13:47» - when the drawing was last changed.
export function whenText(ms: number) {
  const d = new Date(ms);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()} р., ${p2(d.getHours())}:${p2(d.getMinutes())}`;
}

type Toast = { text: string; undo?: () => void };
type MenuItem = { label: string; icon?: string; checked?: boolean; destructive?: boolean; header?: boolean; divider?: boolean; onPress?: () => void };

export default function Home() {
  const S = useSoft();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { width: screenW, height: screenH } = useWindowDimensions();

  const [sketches, setSketches] = useState<SketchFile[]>([]);
  const [lib, setLib] = useState<Library>(emptyLibrary());
  const libRef = useRef(lib);
  libRef.current = lib;
  const [path, setPath] = useState<string | null>(null);
  const [inBin, setInBin] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<SketchFile | null>(null);
  const [settings, setSettings] = useState(false);
  const [sheet, setSheet] = useState<{ title?: string; actions: SheetAction[] } | null>(null);
  const [dialog, setDialog] = useState<{ title: string; initial: string; confirm: string; onSubmit: (name: string) => void } | null>(null);
  const [menu, setMenu] = useState<MenuItem[] | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const reload = useCallback(() => {
    listSketches().then(setSketches).catch(() => setSketches([]));
  }, []);
  useEffect(reload, [reload]);

  const change = useCallback((next: Library) => {
    libRef.current = next;
    setLib(next);
    saveLibrary(next).catch(() => {});
  }, []);

  // Loaded once; the bin empties what has lain there over 30 days.
  useEffect(() => {
    loadLibrary().then(async (loaded) => {
      const old = Object.entries(loaded.trash).filter(([, at]) => Date.now() - at > BIN_DAYS * 86400000).map(([id]) => id);
      if (old.length) {
        await Promise.all(old.map((id) => deleteSketch(id)));
        const trash = { ...loaded.trash };
        const assign = { ...loaded.assign };
        for (const id of old) {
          delete trash[id];
          delete assign[id];
        }
        loaded = { ...loaded, trash, assign };
        saveLibrary(loaded).catch(() => {});
        reload();
      }
      libRef.current = loaded;
      setLib(loaded);
    });
  }, [reload]);

  const say = (t: Toast) => {
    if (toastTimer.current) clearTimeout(toastTimer.current);
    setToast(t);
    toastTimer.current = setTimeout(() => setToast(null), UNDO_MS);
  };

  // ---- what is shown ----------------------------------------------------------------

  const q = query.trim().toLowerCase();
  const searching = searchOpen && q.length > 0;
  const live = useMemo(() => sketches.filter((f) => !(f.id in lib.trash)), [sketches, lib.trash]);
  const binned = useMemo(() => sketches.filter((f) => f.id in lib.trash), [sketches, lib.trash]);

  const sortFn = useMemo(() => {
    const { key, dir } = lib.sort;
    const sign = dir === 'asc' ? 1 : -1;
    const by: Record<SortKey, (a: SketchFile, b: SketchFile) => number> = {
      title: (a, b) => compareTitles(a.title, b.title),
      created: (a, b) => a.createdAt - b.createdAt,
      updated: (a, b) => a.updatedAt - b.updatedAt,
    };
    return (a: SketchFile, b: SketchFile) => sign * by[key](a, b);
  }, [lib.sort]);

  const shown = useMemo(() => {
    const list = inBin
      ? binned
      : searching
        ? live.filter((f) => f.title.toLowerCase().includes(q))
        : live.filter((f) => (lib.assign[f.id] ?? null) === path);
    return [...list].sort(sortFn);
  }, [inBin, binned, live, searching, q, lib.assign, path, sortFn]);

  const folders = useMemo(() => {
    if (inBin) return [];
    if (searching) return allPaths(lib).filter((p) => p.toLowerCase().includes(q));
    return childFolders(lib, path);
  }, [inBin, searching, lib, q, path]);

  const countIn = (p: string) => live.filter((f) => lib.assign[f.id] === p).length;
  const subCount = (p: string) => childFolders(lib, p).length;
  const binCount = binned.length;
  const showBinTile = !inBin && !searching && path === null && binCount > 0;

  // ---- going back ----------------------------------------------------------------

  const closeSearch = () => {
    Keyboard.dismiss();
    setSearchOpen(false);
    setQuery('');
  };
  const canGoBack = searchOpen || inBin || path !== null;
  const goBack = () => {
    if (searchOpen) closeSearch();
    else if (inBin) setInBin(false);
    else if (path !== null) setPath(parentOf(path));
  };
  const backRef = useRef(goBack);
  backRef.current = goBack;
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (open || settings || sheet || dialog || menu) return false;
      if (!(searchOpen || inBin || path !== null)) return false;
      backRef.current();
      return true;
    });
    return () => sub.remove();
  }, [open, settings, sheet, dialog, menu, searchOpen, inBin, path]);
  // An empty search closes when the keyboard goes away.
  useEffect(() => {
    const sub = Keyboard.addListener('keyboardDidHide', () => {
      if (!query.trim()) setSearchOpen(false);
    });
    return () => sub.remove();
  }, [query]);

  // ---- drawings: bin, move, rename, duplicate ---------------------------------------------

  const toBin = (ids: string[]) => {
    const now = Date.now();
    const trash = { ...libRef.current.trash };
    ids.forEach((id) => (trash[id] = now));
    change({ ...libRef.current, trash });
    say({
      text: ids.length > 1 ? `У кошику (${ids.length})` : 'У кошику',
      undo: () => restore(ids),
    });
  };
  const restore = (ids: string[]) => {
    const trash = { ...libRef.current.trash };
    ids.forEach((id) => delete trash[id]);
    change({ ...libRef.current, trash });
  };
  const purge = async (ids: string[]) => {
    await Promise.all(ids.map((id) => deleteSketch(id)));
    const trash = { ...libRef.current.trash };
    const assign = { ...libRef.current.assign };
    ids.forEach((id) => {
      delete trash[id];
      delete assign[id];
    });
    change({ ...libRef.current, trash, assign });
    reload();
  };
  // What the last deletion put in the bin: everything within 10 s of it.
  const lastDeleted = useMemo(() => {
    const times = Object.values(lib.trash);
    if (!times.length) return [];
    const last = Math.max(...times);
    return Object.entries(lib.trash).filter(([, at]) => last - at <= 10000).map(([id]) => id);
  }, [lib.trash]);

  const moveTo = (ids: string[], to: string | null, toastIt = true) => {
    const before = ids.map((id) => [id, libRef.current.assign[id] ?? null] as const);
    change(moveDrawings(libRef.current, ids, to));
    if (toastIt) {
      say({
        text: ids.length > 1 ? `Переміщено ${ids.length} в «${to ? nameOf(to) : 'Малюнки'}»` : `Переміщено в «${to ? nameOf(to) : 'Малюнки'}»`,
        undo: () => {
          let next = libRef.current;
          for (const [id, p] of before) next = moveDrawings(next, [id], p);
          change(next);
        },
      });
    }
  };

  const pickFolder = (title: string, onPick: (p: string | null) => void, except?: string) =>
    setSheet({
      title,
      actions: [
        { label: 'Без папки', icon: 'home', onPress: () => onPick(null) },
        ...allPaths(lib)
          .filter((p) => !except || !within(p, except))
          .map((p) => ({ label: p.split('/').join(' › '), icon: 'folder', onPress: () => onPick(p) })),
      ],
    });

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

  const duplicate = async (file: SketchFile) => {
    const copy = await duplicateSketch(file);
    const where = libRef.current.assign[file.id];
    if (where) change(moveDrawings(libRef.current, [copy.id], where));
    reload();
  };

  const sketchActions = (file: SketchFile): SheetAction[] =>
    inBin
      ? [
          { label: 'Відновити', icon: 'arrow-undo', onPress: () => restore([file.id]) },
          {
            label: 'Видалити назавжди',
            icon: 'trash',
            destructive: true,
            onPress: () =>
              Alert.alert('Видалити назавжди?', `«${file.title}» зникне з телефона без вороття.`, [
                { text: 'Скасувати', style: 'cancel' },
                { text: 'Видалити', style: 'destructive', onPress: () => purge([file.id]) },
              ]),
          },
        ]
      : [
          { label: 'Перемістити в папку', icon: 'folder', onPress: () => pickFolder(`Перемістити «${file.title}» в…`, (p) => moveTo([file.id], p)) },
          { label: 'Перейменувати', icon: 'pencil', onPress: () => renameSketch(file) },
          { label: 'Експортувати', icon: 'share', onPress: () => exportSketch(file).catch((e) => Alert.alert('Не вийшло', String(e))) },
          { label: 'Дублювати', icon: 'copy', onPress: () => duplicate(file) },
          { label: 'У кошик', icon: 'trash', destructive: true, onPress: () => toBin([file.id]) },
        ];

  // ---- folders ----------------------------------------------------------------------

  const newFolder = () =>
    setDialog({
      title: 'Нова папка',
      initial: '',
      confirm: 'Створити',
      onSubmit: (name) => {
        change(addFolder(libRef.current, path, name));
        setDialog(null);
      },
    });

  const folderActions = (p: string): SheetAction[] => [
    {
      label: 'Перейменувати',
      icon: 'pencil',
      onPress: () =>
        setDialog({
          title: 'Назва папки',
          initial: nameOf(p),
          confirm: 'Зберегти',
          onSubmit: (name) => {
            const next = renameFolder(libRef.current, p, name);
            change(next);
            const renamed = join(parentOf(p), cleanName(name));
            if (path && within(path, p) && cleanName(name)) setPath(renamed + path.slice(p.length));
            setDialog(null);
          },
        }),
    },
    {
      label: 'Перемістити в…',
      icon: 'folder',
      onPress: () =>
        setSheet({
          title: `Перемістити «${nameOf(p)}» в…`,
          actions: [
            { label: 'Всі (корінь)', icon: 'home', onPress: () => change(moveFolder(libRef.current, p, null)) },
            ...allPaths(lib)
              .filter((x) => !within(x, p))
              .map((x) => ({ label: x.split('/').join(' › '), icon: 'folder', onPress: () => change(moveFolder(libRef.current, p, x)) })),
          ],
        }),
    },
    {
      label: 'Видалити',
      icon: 'trash',
      destructive: true,
      onPress: () =>
        Alert.alert(`Видалити папку «${nameOf(p)}»?`, 'Те, що в ній, підніметься на рівень вище.', [
          { text: 'Скасувати', style: 'cancel' },
          {
            text: 'Видалити',
            style: 'destructive',
            onPress: () => {
              change(deleteFolder(libRef.current, p));
              if (path && within(path, p)) setPath(parentOf(p));
            },
          },
        ]),
    },
  ];

  const enterFolder = (p: string) => {
    if (searchOpen) closeSearch();
    setPath(p);
  };

  // ---- hold menu over the lifted card, and carrying to a folder ----------------------

  const rootRef = useRef<View>(null);
  const folderRefs = useRef<Record<string, View | null>>({});
  const folderRects = useRef<Record<string, Rect>>({});
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const [held, setHeld] = useState<{ rect: Rect; ghost: ReactNode; actions: SheetAction[]; dragFile: SketchFile | null; dragging: boolean } | null>(null);
  const [hover, setHover] = useState<{ path: string; rect: Rect } | null>(null);
  const hoverRef = useRef<string | null>(null);

  const hold = (windowRect: Rect, ghost: ReactNode, actions: SheetAction[], dragFile: SketchFile | null) => {
    rootRef.current?.measureInWindow((ox, oy) => {
      setHover(null);
      hoverRef.current = null;
      setHeld({ rect: { x: windowRect.x - ox, y: windowRect.y - oy, w: windowRect.w, h: windowRect.h }, ghost, actions, dragFile, dragging: false });
    });
  };
  const closeHold = () => {
    setHeld(null);
    setHover(null);
    hoverRef.current = null;
  };
  const dragStart = () => {
    setHeld((h) => (h ? { ...h, dragging: true } : h));
    rootRef.current?.measureInWindow((ox, oy) => {
      for (const p of folders) {
        folderRefs.current[p]?.measureInWindow((x, y, w, h) => {
          folderRects.current[p] = { x: x - ox, y: y - oy, w, h };
          folderRects.current[`w:${p}`] = { x, y, w, h };
        });
      }
    });
  };
  const dragMove = (ax: number, ay: number) => {
    let found: string | null = null;
    for (const p of folders) {
      const r = folderRects.current[`w:${p}`];
      if (r && ax >= r.x && ax <= r.x + r.w && ay >= r.y && ay <= r.y + r.h) found = p;
    }
    if (found === hoverRef.current) return;
    hoverRef.current = found;
    setHover(found ? { path: found, rect: folderRects.current[found] } : null);
  };
  const dragEnd = () => {
    const file = held?.dragFile;
    const to = hoverRef.current;
    if (file && to && (lib.assign[file.id] ?? null) !== to) moveTo([file.id], to);
    closeHold();
  };
  const ghostStyle = useAnimatedStyle(() => ({ transform: [{ translateX: tx.value }, { translateY: ty.value }, { scale: 1.03 }] }));

  // ---- the «⋯» menu -------------------------------------------------------------------

  const sortRow = (key: SortKey, label: string, icon: string): MenuItem => {
    const on = lib.sort.key === key;
    const arrow = on ? (lib.sort.dir === 'asc' ? ' ↑' : ' ↓') : '';
    return {
      label: label + arrow,
      icon,
      checked: on,
      onPress: () =>
        change({
          ...libRef.current,
          sort: on ? { key, dir: lib.sort.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'title' ? 'asc' : 'desc' },
        }),
    };
  };
  const importOne = () =>
    importSketch()
      .then((file) => {
        if (!file) return;
        if (path) change(moveDrawings(libRef.current, [file.id], path));
        reload();
      })
      .catch((e) => Alert.alert('Не вийшло імпортувати', e instanceof Error ? e.message : String(e)));

  const moreMenu = () => {
    const items: MenuItem[] = [];
    if (lastDeleted.length) items.push({ label: `Відновити останнє видалення (${lastDeleted.length})`, icon: 'arrow-undo', onPress: () => restore(lastDeleted) });
    if (binCount > lastDeleted.length) items.push({ label: `Відновити все з кошика (${binCount})`, icon: 'arrow-undo', onPress: () => restore(Object.keys(lib.trash)) });
    items.push({ label: 'Імпортувати малюнок', icon: 'download', onPress: importOne });
    items.push({ label: 'Налаштування', icon: 'settings', onPress: () => setSettings(true) });
    setMenu(items);
  };
  const mainMenu = () =>
    setMenu([
      { label: 'Змінити вигляд', icon: lib.view === 'grid' ? 'grid' : 'reorder-four', onPress: () => change({ ...libRef.current, view: lib.view === 'grid' ? 'list' : 'grid' }) },
      { label: 'Порядок', header: true },
      sortRow('title', 'За алфавітом', 'text'),
      sortRow('created', 'Дата створення', 'add-circle'),
      sortRow('updated', 'Дата зміни', 'create'),
      { label: '', divider: true },
      ...(!searchOpen && !inBin ? [{ label: 'Нова папка', icon: 'folder-open', onPress: newFolder } as MenuItem] : []),
      ...(!inBin && binCount > 0 ? [{ label: `Кошик (${binCount})`, icon: 'trash', onPress: () => setInBin(true) } as MenuItem] : []),
      { label: 'Ще…', icon: 'ellipsis-horizontal', onPress: () => setTimeout(moreMenu, 0) },
    ]);

  const clearBin = () =>
    Alert.alert(`Очистити кошик (${binCount})?`, 'Ці малюнки буде видалено назавжди.', [
      { text: 'Скасувати', style: 'cancel' },
      { text: 'Очистити', style: 'destructive', onPress: () => purge(Object.keys(lib.trash)) },
    ]);

  // ---- layout -------------------------------------------------------------------------

  const columnW = Math.min(screenW, 760);
  const cols = screenW >= 640 ? 3 : 2;
  const GAP = 12;
  const cardW = (columnW - 32 - GAP * (cols - 1)) / cols;
  const folderCols = screenW >= 640 ? 3 : 2;
  const folderW = (columnW - 32 - GAP * (folderCols - 1)) / folderCols;

  const preview = (file: SketchFile, w: number, h: number) =>
    file.width > 0 ? (
      <Svg width={w} height={h} viewBox={`0 0 ${file.width} ${file.height}`} preserveAspectRatio="xMidYMid meet">
        <SketchLayer elements={file.elements} ink={theme.paper.ink} />
      </Svg>
    ) : null;

  const folderChip = (file: SketchFile) => {
    const p = lib.assign[file.id];
    if (!p || !searching) return null;
    return (
      <View style={styles.chip}>
        <Ionicons name="folder" size={11} color={colorOf(lib, p)} />
        <Text style={styles.chipText} numberOfLines={1}>
          {nameOf(p)}
        </Text>
      </View>
    );
  };

  const gridCard = (file: SketchFile) => (
    <View style={[styles.card, { width: cardW, height: cardW, backgroundColor: theme.paper.fill, boxShadow: S.shadow }]}>
      {preview(file, cardW, cardW)}
      <View style={styles.strip}>
        <Text style={styles.stripTitle} numberOfLines={1}>
          {file.title || 'Без назви'}
        </Text>
        <Text style={styles.stripDate} numberOfLines={1}>
          {whenText(file.updatedAt)}
        </Text>
        {folderChip(file)}
      </View>
    </View>
  );

  const listRow = (file: SketchFile) => (
    <View style={[styles.row, { backgroundColor: S.card, boxShadow: S.shadow }]}>
      <View style={[styles.thumb, { backgroundColor: theme.paper.fill }]}>{preview(file, 104, 58.5)}</View>
      <View style={styles.rowText}>
        <Text style={[styles.rowTitle, { color: S.ink }]} numberOfLines={2}>
          {file.title || 'Без назви'}
        </Text>
        <Text style={[styles.rowDate, { color: S.ink3 }]} numberOfLines={1}>
          {whenText(file.updatedAt)}
        </Text>
        {lib.assign[file.id] && searching ? (
          <View style={[styles.chip, styles.chipOnCard, { backgroundColor: S.fill }]}>
            <Ionicons name="folder" size={11} color={colorOf(lib, lib.assign[file.id])} />
            <Text style={[styles.chipText, { color: S.ink2 }]} numberOfLines={1}>
              {nameOf(lib.assign[file.id])}
            </Text>
          </View>
        ) : null}
      </View>
      <Pressable hitSlop={8} onPress={() => setSheet({ title: file.title, actions: sketchActions(file) })} style={styles.rowMore} accessibilityLabel="Ще">
        <Ionicons name="ellipsis-horizontal" size={20} color={S.ink3} />
      </Pressable>
    </View>
  );

  const folderTile = (p: string, bin = false) => (
    <View style={[styles.folder, { backgroundColor: S.card, boxShadow: S.shadow }]}>
      <View style={[styles.folderIcon, { backgroundColor: S.fill }]}>
        <Ionicons name={bin ? 'trash' : 'folder'} size={20} color={bin ? S.ink2 : colorOf(lib, p)} />
      </View>
      <View style={styles.folderText}>
        <Text style={[styles.folderName, { color: S.ink }]} numberOfLines={1}>
          {bin ? 'Кошик' : searching ? showPath(p) : nameOf(p)}
        </Text>
        <View style={styles.counts}>
          <Ionicons name="brush" size={12} color={S.ink3} />
          <Text style={[styles.countText, { color: S.ink3 }]}>{bin ? binCount : countIn(p)}</Text>
          {!bin && (
            <>
              <Ionicons name="folder" size={12} color={S.ink3} />
              <Text style={[styles.countText, { color: S.ink3 }]}>{subCount(p)}</Text>
            </>
          )}
        </View>
      </View>
      <Ionicons name="chevron-forward" size={16} color={S.ink3} />
    </View>
  );

  // ---- the bar's title: the path ----------------------------------------------------

  const crumbs = () => {
    if (inBin) {
      return (
        <View style={styles.crumbs}>
          <Ionicons name="trash" size={18} color={S.ink2} />
          <Text style={[styles.crumbLast, { color: S.ink }]}>Кошик</Text>
        </View>
      );
    }
    if (path === null) {
      return (
        <View style={styles.crumbs}>
          <Ionicons name="brush" size={18} color={S.ink2} />
          <Text style={[styles.crumbLast, { color: S.ink }]}>Малюнки</Text>
        </View>
      );
    }
    const parts = path.split('/');
    return (
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.crumbsScroll}>
        <Pressable onPress={() => setPath(null)} hitSlop={8}>
          <Ionicons name="brush" size={18} color={S.ink3} />
        </Pressable>
        {parts.map((part, i) => {
          const to = parts.slice(0, i + 1).join('/');
          const last = i === parts.length - 1;
          return (
            <View key={to} style={styles.crumbItem}>
              <Ionicons name="chevron-forward" size={14} color={S.ink3} />
              <Pressable onPress={() => setPath(to)} disabled={last} hitSlop={6}>
                <Text style={[last ? styles.crumbLast : styles.crumb, { color: last ? S.ink : S.ink3 }]} numberOfLines={1}>
                  {part}
                </Text>
              </Pressable>
            </View>
          );
        })}
      </ScrollView>
    );
  };

  const menuW = Math.min(272, screenW - 32);
  // The hold menu stands under the card if it fits there, else above it.
  const heldMenuTop = (() => {
    if (!held) return 0;
    const h = held.actions.length * 48 + 16;
    const below = held.rect.y + held.rect.h + 10;
    return below + h < screenH - insets.bottom - 16 ? below : Math.max(insets.top + 8, held.rect.y - h - 10);
  })();

  const empty = shown.length === 0 && folders.length === 0 && !showBinTile;

  return (
    <View ref={rootRef} collapsable={false} style={[styles.fill, { backgroundColor: S.bg }]}>
      <StatusBar style={S.dark ? 'light' : 'dark'} />

      <ScrollView
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={() => {
          if (searchOpen && !query.trim()) closeSearch();
        }}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + 78, paddingBottom: insets.bottom + 120, width: columnW }]}
      >
        {inBin && (
          <View style={styles.binHead}>
            <Text style={[styles.binHint, { color: S.ink3 }]}>Затисни малюнок, щоб відновити або видалити назавжди. Через 30 днів кошик очищається сам.</Text>
            {binCount > 0 && (
              <Pressable onPress={clearBin} hitSlop={8}>
                <Text style={[styles.binClear, { color: RED }]}>Очистити</Text>
              </Pressable>
            )}
          </View>
        )}

        {(folders.length > 0 || showBinTile) && (
          <View style={styles.folders}>
            {folders.map((p) => (
              <View key={p} ref={(r) => { folderRefs.current[p] = r; }} collapsable={false} style={{ width: folderW, height: 64 }}>
                <HoldTarget
                  tx={tx}
                  ty={ty}
                  style={styles.fillBox}
                  onTap={() => enterFolder(p)}
                  onHold={(r) => hold(r, folderTile(p), folderActions(p), null)}
                >
                  {folderTile(p)}
                </HoldTarget>
              </View>
            ))}
            {showBinTile && (
              <Pressable onPress={() => setInBin(true)} style={{ width: folderW, height: 64 }}>
                {folderTile('', true)}
              </Pressable>
            )}
          </View>
        )}

        {empty && (
          <View style={styles.emptyBox}>
            <Text style={[styles.empty, { color: S.ink2 }]}>{searching ? 'Нічого не знайдено' : inBin ? 'Кошик порожній' : 'Ще немає малюнків'}</Text>
            {!searching && !inBin && <Text style={[styles.emptyHint, { color: S.ink3 }]}>Натисни «+», щоб почати малювати</Text>}
          </View>
        )}

        <View style={lib.view === 'grid' ? styles.grid : styles.list}>
          {shown.map((file) => (
            <HoldTarget
              key={file.id}
              draggable={!inBin && !searching}
              dimmed={held?.dragging === true && held.dragFile?.id === file.id}
              tx={tx}
              ty={ty}
              style={lib.view === 'grid' ? { width: cardW } : undefined}
              onTap={() => (inBin ? setSheet({ title: file.title, actions: sketchActions(file) }) : setOpen(file))}
              onHold={(r) => hold(r, lib.view === 'grid' ? gridCard(file) : listRow(file), sketchActions(file), inBin ? null : file)}
              onDragStart={dragStart}
              onDragMove={dragMove}
              onDragEnd={dragEnd}
            >
              {lib.view === 'grid' ? gridCard(file) : listRow(file)}
            </HoldTarget>
          ))}
        </View>
      </ScrollView>

      {/* the bar: back, the path, «⋯» */}
      <View style={[styles.bar, { top: insets.top + 8, backgroundColor: S.chrome, boxShadow: S.shadow }]}>
        <Pressable onPress={goBack} disabled={!canGoBack} style={styles.barBtn} accessibilityLabel="Назад">
          {canGoBack ? <Ionicons name="chevron-back" size={24} color={S.ink} /> : null}
        </Pressable>
        <View style={styles.barTitle}>{crumbs()}</View>
        <Pressable onPress={mainMenu} style={styles.barBtn} accessibilityLabel="Ще">
          <Ionicons name="ellipsis-horizontal" size={22} color={S.accent} />
        </Pressable>
      </View>

      {/* the dock: search, with «+» inside it */}
      {!inBin && (
        <View style={[styles.dock, { bottom: insets.bottom + 16 }]}>
          {searchOpen ? (
            <View style={[styles.search, { backgroundColor: S.chrome, boxShadow: S.shadow }]}>
              <Ionicons name="search" size={20} color={S.ink3} />
              <TextInput
                value={query}
                onChangeText={setQuery}
                autoFocus
                placeholder="Пошук малюнків за назвою"
                placeholderTextColor={S.ink3}
                style={[styles.searchInput, { color: S.ink }]}
                returnKeyType="search"
              />
              <Pressable onPress={closeSearch} hitSlop={10} style={styles.searchClose} accessibilityLabel="Закрити пошук">
                <Ionicons name="close" size={20} color={S.ink2} />
              </Pressable>
            </View>
          ) : (
            <Pressable onPress={() => setSearchOpen(true)} style={[styles.search, { backgroundColor: S.chrome, boxShadow: S.shadow }]}>
              <Ionicons name="search" size={20} color={S.ink3} />
              <Text style={[styles.searchLabel, { color: S.ink3 }]}>Пошук</Text>
              <Pressable onPress={() => setOpen(newSketch())} style={[styles.plus, { backgroundColor: S.ink }]} accessibilityLabel="Новий малюнок">
                <Ionicons name="add" size={26} color={S.chrome} />
              </Pressable>
            </Pressable>
          )}
        </View>
      )}

      {/* undo toast */}
      {toast && (
        <View style={[styles.toast, { bottom: insets.bottom + 88, backgroundColor: S.ink }]}>
          <Text style={[styles.toastText, { color: S.chrome }]} numberOfLines={1}>
            {toast.text}
          </Text>
          {toast.undo && (
            <Pressable
              onPress={() => {
                toast.undo?.();
                setToast(null);
              }}
              hitSlop={8}
            >
              <Text style={[styles.toastUndo, { color: S.accent }]}>Скасувати</Text>
            </Pressable>
          )}
        </View>
      )}

      {/* «⋯»: a menu hanging under the bar */}
      {menu && (
        <View style={styles.overlay}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setMenu(null)} />
          <View style={[styles.menu, { top: insets.top + 72, width: menuW, backgroundColor: S.chrome, boxShadow: S.popShadow }]}>
            {menu.map((m, i) =>
              m.divider ? (
                <View key={i} style={[styles.menuDivider, { backgroundColor: S.line }]} />
              ) : m.header ? (
                <Text key={i} style={[styles.menuHeader, { color: S.ink3 }]}>
                  {m.label}
                </Text>
              ) : (
                <Pressable
                  key={i}
                  onPress={() => {
                    setMenu(null);
                    m.onPress?.();
                  }}
                  style={styles.menuItem}
                >
                  {m.icon ? <Ionicons name={m.icon as never} size={20} color={m.destructive ? RED : S.ink2} /> : null}
                  <Text style={[styles.menuText, { color: m.destructive ? RED : S.ink }]} numberOfLines={1}>
                    {m.label}
                  </Text>
                  {m.checked ? <Ionicons name="checkmark" size={20} color={S.accent} /> : null}
                </Pressable>
              )
            )}
          </View>
        </View>
      )}

      {/* hold: the card lifted, its menu beside it */}
      {held && (
        <View style={styles.overlay} pointerEvents="box-none">
          <Pressable onPress={closeHold} style={[StyleSheet.absoluteFill, { backgroundColor: held.dragging ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.55)' }]} />
          {hover && (
            <View
              pointerEvents="none"
              style={{ position: 'absolute', left: hover.rect.x - 3, top: hover.rect.y - 3, width: hover.rect.w + 6, height: hover.rect.h + 6, borderRadius: 23, borderWidth: 2.5, borderColor: S.accent }}
            />
          )}
          <Animated.View pointerEvents="none" style={[{ position: 'absolute', left: held.rect.x, top: held.rect.y, width: held.rect.w, height: held.rect.h }, ghostStyle]}>
            {held.ghost}
          </Animated.View>
          {!held.dragging && (
            <View
              style={[
                styles.menu,
                {
                  width: menuW,
                  backgroundColor: S.chrome,
                  boxShadow: S.popShadow,
                  left: Math.max(16, Math.min(screenW - 16 - menuW, held.rect.x + held.rect.w - menuW)),
                  right: undefined,
                  top: heldMenuTop,
                },
              ]}
            >
              {held.actions.map((a, i) => (
                <Pressable
                  key={i}
                  onPress={() => {
                    closeHold();
                    a.onPress?.();
                  }}
                  style={styles.menuItem}
                >
                  <Ionicons name={a.icon as never} size={20} color={a.destructive ? RED : S.ink2} />
                  <Text style={[styles.menuText, { color: a.destructive ? RED : S.ink }]}>{a.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      )}

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
          if (open.createdAt === open.updatedAt && path && !libRef.current.assign[open.id]) {
            change(moveDrawings(libRef.current, [open.id], path));
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
  fillBox: { flex: 1 },
  content: { alignSelf: 'center', paddingHorizontal: 16 },
  bar: { position: 'absolute', left: 16, right: 16, height: 56, borderRadius: 28, flexDirection: 'row', alignItems: 'center', zIndex: 2 },
  barBtn: { width: 52, height: 56, alignItems: 'center', justifyContent: 'center' },
  barTitle: { flex: 1, alignItems: 'center', overflow: 'hidden' },
  crumbs: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  crumbsScroll: { alignItems: 'center', gap: 4, paddingHorizontal: 4 },
  crumbItem: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  crumb: { fontSize: 16, fontFamily: SOFT_MEDIUM, maxWidth: 140 },
  crumbLast: { fontSize: 18, fontFamily: SOFT_SEMIBOLD, maxWidth: 200 },
  folders: { flexDirection: 'row', flexWrap: 'wrap', gap: 12, marginBottom: 16 },
  folder: { flex: 1, borderRadius: 20, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, gap: 10 },
  folderIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  folderText: { flex: 1 },
  folderName: { fontSize: 15, fontFamily: SOFT_SEMIBOLD },
  counts: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 2 },
  countText: { fontSize: 12, fontFamily: SOFT_MEDIUM, marginRight: 6 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  list: { gap: 10 },
  card: { borderRadius: 20, overflow: 'hidden' },
  strip: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)', paddingHorizontal: 10, paddingVertical: 6 },
  stripTitle: { color: '#FFFFFF', fontSize: 13, fontFamily: SOFT_SEMIBOLD },
  stripDate: { color: 'rgba(255,255,255,0.88)', fontSize: 11, fontFamily: SOFT_MEDIUM, marginTop: 1 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3, alignSelf: 'flex-start' },
  chipOnCard: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10 },
  chipText: { color: 'rgba(255,255,255,0.88)', fontSize: 11, fontFamily: SOFT_MEDIUM, maxWidth: 140 },
  row: { borderRadius: 20, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  thumb: { width: 104, height: 58.5, borderRadius: 8, overflow: 'hidden' },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 15, fontFamily: SOFT_SEMIBOLD },
  rowDate: { fontSize: 12, fontFamily: SOFT_MEDIUM, marginTop: 2 },
  rowMore: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  emptyBox: { marginTop: 48, alignItems: 'center', gap: 6 },
  empty: { fontSize: 16, fontFamily: SOFT_SEMIBOLD },
  emptyHint: { fontSize: 14, fontFamily: SOFT_MEDIUM },
  binHead: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginBottom: 16 },
  binHint: { flex: 1, fontSize: 13, fontFamily: SOFT_MEDIUM, lineHeight: 18 },
  binClear: { fontSize: 15, fontFamily: SOFT_SEMIBOLD },
  dock: { position: 'absolute', left: 16, right: 16, flexDirection: 'row', alignItems: 'center' },
  search: { flex: 1, height: 56, borderRadius: 28, flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 5, gap: 10 },
  searchLabel: { flex: 1, fontSize: 16, fontFamily: SOFT_MEDIUM },
  searchInput: { flex: 1, fontSize: 16, fontFamily: SOFT_MEDIUM, padding: 0 },
  searchClose: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  plus: { width: 46, height: 46, borderRadius: 23, alignItems: 'center', justifyContent: 'center' },
  toast: { position: 'absolute', left: 24, right: 24, minHeight: 48, borderRadius: 24, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 18, gap: 12 },
  toastText: { flex: 1, fontSize: 15, fontFamily: SOFT_MEDIUM },
  toastUndo: { fontSize: 15, fontFamily: SOFT_SEMIBOLD },
  overlay: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, zIndex: 20, elevation: 20 },
  menu: { position: 'absolute', right: 16, borderRadius: 22, paddingVertical: 8 },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 14, height: 48, paddingHorizontal: 18 },
  menuText: { flex: 1, fontSize: 16, fontFamily: SOFT_MEDIUM },
  menuHeader: { fontSize: 13, fontFamily: SOFT_MEDIUM, paddingHorizontal: 18, paddingTop: 8, paddingBottom: 4 },
  menuDivider: { height: StyleSheet.hairlineWidth, marginVertical: 6, marginHorizontal: 14 },
});
