import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { useChromeScrollHandler } from '../navigation/chromeScroll';
import ScreenGround from '../components/ScreenGround';
import { APPS_TEMPLATE_NAME, APPS_TEMPLATE_RATES, appsTemplateFields } from '../utils/appsTemplate';
import { useTheme, useStyles } from '../theme/ThemeProvider';
import { type Theme } from '../theme/tokens';
import { useRecordColour } from '../theme/ThemeProvider';
import { BackHandler, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import ScreenBackdrop from '../components/ScreenBackdrop';
import { Ionicons } from '../components/icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { collection, doc, onSnapshot } from '../firestore';
import { addDoc, setDoc } from '../utils/owned';
import {
  GRID_TILES,
  Tile,
  WIDE_TILES,
  openDatabaseTile,
  tileColorsDoc, tileIconsDoc } from '../constants/databaseTiles';
import { useDatabaseTiles } from '../hooks/useDatabaseTiles';
import { PinnableItem, useDatabaseContents } from '../hooks/useDatabaseCounts';
import { deleteCustomDatabase } from '../utils/deleteCustomDatabase';
import { CustomDatabase } from '../types';
import { db } from '../firebase';
import { RootStackParamList } from '../navigation';
import { useDensity } from '../hooks/useDensity';
import { LayoutFrameContext } from '../hooks/useResponsiveLayout';
import { FONT_REGULAR, FONT_MEDIUM, SOFT_MEDIUM } from '../utils/fonts';
import { useSoft, type SoftTokens } from '../theme/soft';
import RenamePrompt from '../components/RenamePrompt';
import { ask, confirm, notify, type AskAction } from '../components/surfaces/Ask';
import { holdAsk } from '../components/surfaces/HoldAsk';
import HoldPressable from '../components/HoldPressable';
import ImportTableSheet from '../components/ImportTableSheet';
import ContentColumn from '../components/ContentColumn';
import { useFrameDimensions, useResponsiveLayout } from '../hooks/useResponsiveLayout';
import { DatabasesLayerContext } from '../navigation/sideDrawers';
import { threeDesksOnly, whenDeskIsThere } from '../navigation/deskRegistry';
import { BOARDS_DESK, PERMANENT_DESK, deskKeyForCustom } from '../navigation/desks';
import InlineDock from '../components/InlineDock';
import IconPickerSheet from '../components/IconPickerSheet';
import type { MenuEntry } from '../components/surfaces/Menu';
import TopNavBar, { TOP_NAV_H } from '../components/TopNavBar';
import EdgeFade from '../components/EdgeFade';
import { NavigationContext } from '@react-navigation/native';
import { GlassPortalHost } from '../components/GlassPortal';
import { GlassTargetProvider } from '../components/GlassTarget';
import PaneTargetScreen from '../components/PaneTargetScreen';
import { sameTarget, type PaneTarget } from '../navigation/paneTarget';
import { useDatabaseFlash } from '../navigation/databaseFlash';
import { withAlpha } from '../utils/color';
import { useWorkspace } from '../navigation/workspace';
import { navigateToTarget, windowUrlFor } from '../navigation/paneTargetInfo';
import { addTab } from '../navigation/desktopTabs';
import { rightClick } from '../utils/rightClick';
import { useFocusStore } from '../hooks/useFocusStore';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  NavDockProvider,
  useChromeStyle,
  useDockActions,
  useDockBeads,
  useNavDockActions,
  useNavDockBeads,
  useNavTopExtras,
  useNavTopSearch,
  useTopBack,
  useStableTopExtras,
  useTopExtras,
} from '../navigation/navDock';
import { PaneBarContext } from '../navigation/paneBar';
import { useGoToPreviousDesk } from '../navigation/deskOrder';
import { TOP_NAV_SPACE, useTopNavOn } from '../components/TopNavBar';
import { useDockClearance } from '../navigation/dockGeometry';
import { CHROME_TOP } from '../constants/rail';
import { listenError } from '../utils/listenError';
import { useRenderTimer } from '../utils/perfWatch';
import { FEATURES } from '../features';

// THE BASES ARE A LIST (2026-10-12). They were a board of tiles - sizes,
// folders, dividers, carried by the finger - and the user stopped using it:
// «плитки… заархівувати, зробити звичайний список, як на маку». The board's
// code is kept at scratchpad/archive/DatabasesScreen.tiles-2026-10-12.tsx.txt;
// its settings documents (databaseTileLayouts, …Sizes, …Order, …Folders,
// …Backgrounds) are left in Firestore untouched, read by nothing now.

const NEW_TILE_KEY = '__new__';
const PIN_TILE_KEY = '__pin__';
// A pinned group or smart folder is a row like any other, keyed by what
// it points at - so its place in the list is remembered by the same
// document as a database's.
const groupKey = (id: string) => `group:${id}`;
const tagKey = (id: string) => `tag:${id}`;
const IMPORT_TILE_KEY = '__import__';
const tilePinsDoc = doc(db, 'settings', 'databaseTilePins');
// THE LIST'S OWN ORDER (2026-10-12): the bases as one list, in the user's order, cut into sections where he put
// a bar. The start desk reads the same document for its blocks (StartScreen's useListBlocks).
const basesListDoc = doc(db, 'settings', 'basesList');

type BaseItem =
  | { key: string; kind: 'builtin'; tile: Tile }
  | { key: string; kind: 'custom'; database: CustomDatabase }
  // A group or a smart folder the user has pinned here.
  | { key: string; kind: 'pin'; pin: PinnableItem; pinKind: 'group' | 'tag' }
  | { key: string; kind: 'action' };

// The bases a wide screen can open beside the list rather than instead
// of it. The rest - the placeholders - are whole screens of their own,
// not a database, so they still navigate.
function paneTargetFor(tile: Tile): PaneTarget | null {
  if (tile.linkCategory) return { kind: 'links', category: tile.linkCategory };
  // Documents and boards open here too now - every database in the same
  // place, which is the user's rule. They are tab ROOTS, so unlike the
  // rest they carry their own two-pane logic; `inPane` is how they are
  // told not to split again inside a half-width pane.
  if (tile.opensDocumentsTab) return { kind: 'documents' };
  if (tile.opensBoardsTab) return { kind: 'boards' };
  if (
    tile.route === 'Photos' ||
    tile.route === 'Files' ||
    tile.route === 'Stickers' ||
    tile.route === 'Flashcards' ||
    tile.route === 'Tasks' ||
    tile.route === 'Tags' ||
    tile.route === 'Groups' ||
    tile.route === 'Diary'
  ) {
    return { kind: 'route', route: tile.route };
  }
  return null;
}

export default function DatabasesScreen() {
  // Temporary diagnosis - see utils/perfWatch.
  useRenderTimer('Бази');
  const theme = useTheme();
  const accent = theme.sections.databases;
  const baseStyles = useStyles(makeStyles);
  const recordColour = useRecordColour();
  // In the layer right of the last desk (see CalendarDrawer's
  // DatabasesLayer): its own bar and dock are drawn inside it, and nothing
  // is published for the window's, which fade out as it comes in.
  const databasesLayer = useContext(DatabasesLayerContext);
  const layerShut = !!databasesLayer && !databasesLayer.open;
  // A DRAWER at the side of a wide screen (see databasesDrawerWidth): a
  // database tapped in it opens inside it, as on the laptop.
  const inDrawer = !!databasesLayer?.narrow;
  // «БАЗИ» IN THE SOFT STYLE (theme/soft) - the user's pick after the
  // calendar. On a phone, as a screen and as the layer right of the desks
  // (where it is usually met): the layer draws its own bar and dock, so it
  // tells them directly, like the calendar's; the window's chrome is asked
  // only when this is a screen of its own - the layer is always mounted.
  const softDatabases = true;
  // In a side panel of the laptop the rows are sized for a mouse, not a
  // finger.
  const panelFrame = useContext(LayoutFrameContext);
  const panelDensity = useDensity();
  const inPanel = !!panelFrame && panelDensity === 'pointer';
  const flashTarget = useDatabaseFlash();
  const softTokensAll = useSoft();
  useChromeStyle('soft', softDatabases && !databasesLayer);
  const S = softDatabases ? softTokensAll : null;
  const styles = S ? softenDatabases(baseStyles, S) : baseStyles;
  // Read through a store, as the one yes/no it is: useIsFocused redrew this
  // screen on every focus and blur even while its layer was shut and the
  // answer stayed "no" - every note opened and closed (2026-10-06).
  const focusStore = useFocusStore();
  const databasesFocused = useSyncExternalStore(focusStore.subscribe, () => !layerShut && focusStore.get(), () => false);
  const databasesInsets = useSafeAreaInsets();
  const dockClear = useDockClearance();
  const chromeScroll = useChromeScrollHandler();
  // "Більше" - a tab's own root: its way back steps to the desk before
  // it and stands at the top-left of the desks bar (TopNavBar); search
  // across everything is on the left bead again, settings on the right.
  const toPreviousDesk = useGoToPreviousDesk('Більше');
  useTopBack(toPreviousDesk, !databasesLayer);
  const navSpace = useTopNavOn() ? TOP_NAV_SPACE : 0;
  const searchBead = { icon: 'search-outline', onPress: () => navigation.navigate('Search') };
  // The right bead makes something, as on every screen: here, a new
  // database. Settings moved into the dock's middle (below).
  const newDatabaseBead = { icon: 'grid-outline', badge: 'add-circle-outline', onPress: () => startNewDatabase() };
  useDockBeads(
    databasesFocused && !databasesLayer ? searchBead : null,
    databasesFocused && !databasesLayer ? newDatabaseBead : null
  );
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // The frame's width - the window's, or the layer's inside one.
  const { width: windowWidth } = useFrameDimensions();
  const responsive = useResponsiveLayout();
  // Two panes only LYING DOWN. Standing up, half the inner screen is a
  // phone's width and a database in it is a database squeezed - the user's
  // rule: full width standing up, two windows lying down.
  const isTwoPane = responsive.isTwoPane && responsive.width >= responsive.height;
  // What the left pane is showing, on a wide screen: a database opened
  // from a row. On a phone the same tap navigates, as it always did.
  const [openInPane, setOpenInPane] = useState<PaneTarget | null>(null);
  // The opened database's name on the drawer's bar, and the row it came
  // from - for "На весь екран", which opens it the ordinary way.
  const [drawerPaneTitle, setDrawerPaneTitle] = useState<{ icon: string; label: string } | null>(null);
  const drawerPaneItem = useRef<BaseItem | null>(null);
  // Back, with a database open in the drawer, is back to the list - the
  // drawer itself shuts only after (registered later, so asked first).
  const drawerPaneOpen = !!databasesLayer?.narrow && !!databasesLayer.open && !!openInPane;
  useEffect(() => {
    if (!drawerPaneOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      setOpenInPane(null);
      return true;
    });
    return () => sub.remove();
  }, [drawerPaneOpen]);
  const { colorFor, iconFor, customDatabases } = useDatabaseTiles();
  // What is inside each database, for the rows to show - see
  // useDatabaseContents.
  const { counts, pinnableGroups, pinnableTags } = useDatabaseContents(databasesFocused);
  // Arranging the list: arrows move a base, a tap puts a section's edge
  // under it (see ArrangeRow).
  const [editing, setEditing] = useState(false);
  const [listOrder, setListOrder] = useState<{ order: string[]; breaks: string[] }>({ order: [], breaks: [] });
  useEffect(
    () =>
      onSnapshot(
        basesListDoc,
        (snap) => {
          const d = snap.data();
          setListOrder({ order: (d?.order as string[] | undefined) ?? [], breaks: (d?.breaks as string[] | undefined) ?? [] });
        },
        listenError('DatabasesScreen:basesList')
      ),
    []
  );
  // Which groups and smart folders are pinned here, and the sheet that
  // chooses them.
  const [pinnedKeys, setPinnedKeys] = useState<string[]>([]);
  const [pinSheetVisible, setPinSheetVisible] = useState(false);
  // The database whose icon is being chosen, and the one whose colour is.
  const [iconPickerFor, setIconPickerFor] = useState<string | null>(null);
  const [colorPickerFor, setColorPickerFor] = useState<string | null>(null);
  // A built-in database's own icon (null: not a built-in one), and the
  // icon any database wears now.
  const builtinIcon = (key: string) => [...WIDE_TILES, ...GRID_TILES].find((t) => t.key === key)?.icon ?? null;
  const currentIcon = (key: string): string | undefined =>
    customDatabases.find((d) => d.id === key)?.icon ?? (builtinIcon(key) ? iconFor(key, builtinIcon(key) as string) : undefined);

  useEffect(() => {
    return onSnapshot(tilePinsDoc, (snapshot) => {
      const stored = snapshot.data()?.keys;
      setPinnedKeys(Array.isArray(stored) ? (stored as string[]) : []);
    }, listenError('DatabasesScreen:DatabasesScreen'));
  }, []);

  const [creatingDatabase, setCreatingDatabase] = useState(false);
  // WHAT THIS SCREEN DOES is in the bar's "⋯" (the same arrangement as
  // the documents list and the boards): arranging the list, importing a
  // table, pinning, and the settings. A new database is the dock's "+",
  // so it is not said twice. The dock keeps just search and "+".
  // A laptop's side panel does not arrange (its rows stay put - see
  // `arranging`), so it is not offered there.
  const databasesMenu: MenuEntry[] = [
    ...(inPanel
      ? []
      : [{ label: 'Упорядкувати', icon: 'move-outline', checked: editing, onPress: () => setEditing((v) => !v) } as MenuEntry]),
    { label: 'Імпорт таблиці', icon: 'download-outline', onPress: () => setImporting(true) },
    { label: 'Закріпити', icon: 'bookmark-outline', onPress: () => setPinSheetVisible(true) },
    { kind: 'rule' },
    { label: 'Налаштування', icon: 'settings-outline', onPress: () => navigation.navigate('Settings') },
  ];
  useTopExtras(databasesMenu, null, databasesFocused && !databasesLayer);
  // For the bar drawn inside the layer: one object while it says the same
  // (built inline it was new on every render and the bar redrew with them).
  const layerExtras = useStableTopExtras(databasesMenu, null, null);
  const layerClose = databasesLayer?.close;
  const layerBack = useMemo(() => (layerClose ? { onPress: layerClose, dimmed: false } : null), [layerClose]);
  // With a pointer there is no bar at the top to hang that list from, so
  // the dock's middle keeps these as it had them.
  const pointerLayout = !useTopNavOn();
  useDockActions(
    databasesFocused && pointerLayout
      ? [
          ...(inPanel
            ? []
            : [{ key: 'arrange', icon: 'move-outline', label: 'Упорядкувати', active: editing, onPress: () => setEditing((v) => !v) }]),
          { key: 'import', icon: 'download-outline', label: 'Імпорт', onPress: () => setImporting(true) },
          { key: 'settings', icon: 'settings-outline', label: 'Налаштування', onPress: () => navigation.navigate('Settings') },
        ]
      : null
  );
  const [importing, setImporting] = useState(false);

  async function createDatabase(name: string) {
    setCreatingDatabase(false);
    const template = newDatabaseTemplate;
    setNewDatabaseTemplate(null);
    const now = Date.now();
    const ref = await addDoc(collection(db, 'customDatabases'), {
      name,
      ...(template === 'apps'
        ? { fields: appsTemplateFields(now), ...APPS_TEMPLATE_RATES }
        : { fields: [{ id: `${now}-title`, name: 'Назва', type: 'text' }] }),
      createdAt: now,
      updatedAt: now,
    });
    navigation.navigate('CustomDatabase', { databaseId: ref.id });
  }
  // «Нова база»: an empty one, or one made from a template - «Додатки та
  // сервіси» (the user's, 2026-10-02), its fields ready and given roles.
  const [newDatabaseTemplate, setNewDatabaseTemplate] = useState<'apps' | null>(null);
  async function startNewDatabase() {
    const answer = await ask({
      title: 'Нова база',
      actions: [
        { id: 'empty', label: 'Порожня база', icon: 'grid-outline' },
        { id: 'apps', label: APPS_TEMPLATE_NAME, hint: 'Лого, вартість, галерея, уроки', icon: 'apps-outline' },
      ],
    });
    if (answer !== 'empty' && answer !== 'apps') return;
    setNewDatabaseTemplate(answer === 'apps' ? 'apps' : null);
    setCreatingDatabase(true);
  }

  function pickColor(key: string, color: string) {
    // A database the user made carries its own colour, on its own record -
    // it is that database's colour everywhere in the app, not just this
    // row's. The built-in ones have no record of their own, so theirs
    // lives in the shared tile-colours document.
    const own = customDatabases.find((database) => database.id === key);
    if (own) setDoc(doc(db, 'customDatabases', key), { color }, { merge: true });
    else setDoc(tileColorsDoc, { [key]: color }, { merge: true });
    setColorPickerFor(null);
  }

  function togglePin(key: string) {
    const next = pinnedKeys.includes(key)
      ? pinnedKeys.filter((k) => k !== key)
      : [...pinnedKeys, key];
    setDoc(tilePinsDoc, { keys: next }, { merge: true });
  }

  function confirmDeleteDatabase(database: CustomDatabase) {
    confirm({
      title: `Видалити «${database.name}»?`,
      message: 'База, всі її записи та збережені вигляди зникнуть. Це не можна відмінити.',
      confirmLabel: 'Видалити',
    }).then((yes) => {
      if (!yes) return;
      deleteCustomDatabase(database.id).catch((error) =>
        notify('Не вдалося видалити', (error as Error).message)
      );
    });
  }

  // On the bases DESK (features.basesDesk) everything opened from here is marked, so its bar can say «Бази › …»
  // (see TopNavBar's fromBases). A desk switch (`Tabs`) is not a base opened, and stays as it is.
  const openNav = useMemo(() => {
    if (!FEATURES.basesDesk || databasesLayer || inPanel) return navigation;
    const proxy = Object.create(navigation);
    proxy.navigate = (name: string, params?: Record<string, unknown>) =>
      (navigation as unknown as { navigate: (n: string, p?: object) => void }).navigate(
        name,
        name === 'Tabs' ? params : { ...(params ?? {}), fromBases: true }
      );
    return proxy;
  }, [navigation, databasesLayer, inPanel]);

  function openTile(tile: Tile) {
    // Documents and boards are doors like every other base, not shortcuts
    // to their tab: a copy opens on top and back returns here. (Lying down
    // on the inner screen they open in the pane instead - see openItem.)
    if (tile.opensDocumentsTab) {
      openNav.navigate('DocumentsCopy');
      return;
    }
    if (tile.opensBoardsTab) {
      openNav.navigate('BoardsCopy');
      return;
    }
    openDatabaseTile(openNav, tile);
  }

  // The real navigation with one thing changed: going back closes the
  // pane. Built with Object.create so every method the navigator put on
  // the original is still reachable through the prototype - spreading it
  // would copy the own properties and quietly drop the rest.
  const paneNavigation = useMemo(() => {
    const proxy = Object.create(navigation);
    proxy.goBack = () => setOpenInPane(null);
    return proxy;
  }, [navigation]);

  const pinnedItems: BaseItem[] = pinnedKeys
    .map((key): BaseItem | null => {
      if (key.startsWith('group:')) {
        const pin = pinnableGroups.find((g) => groupKey(g.id) === key);
        return pin ? { key, kind: 'pin', pin, pinKind: 'group' } : null;
      }
      const pin = pinnableTags.find((t) => tagKey(t.id) === key);
      return pin ? { key, kind: 'pin', pin, pinKind: 'tag' } : null;
    })
    .filter((item): item is BaseItem => !!item);

  // Built in first, then the databases the user made, then the pinned
  // ones, then the three rows that make more - the order a list the user
  // has not arranged yet stands in.
  const items: BaseItem[] = [
    // The icon the user chose for it, where they did.
    ...WIDE_TILES.map((tile) => ({ key: tile.key, kind: 'builtin' as const, tile: { ...tile, icon: iconFor(tile.key, tile.icon) as Tile['icon'] } })),
    // A database put away for now (features.ts) has no row.
    ...GRID_TILES.filter((tile) => (FEATURES.stickers || tile.key !== 'stickers') && (FEATURES.projectsScreen || tile.key !== 'groups')).map((tile) => ({ key: tile.key, kind: 'builtin' as const, tile: { ...tile, icon: iconFor(tile.key, tile.icon) as Tile['icon'] } })),
    ...customDatabases.map((database) => ({ key: database.id, kind: 'custom' as const, database })),
    ...pinnedItems,
    { key: NEW_TILE_KEY, kind: 'action' as const },
    { key: IMPORT_TILE_KEY, kind: 'action' as const },
    { key: PIN_TILE_KEY, kind: 'action' as const },
  ];

  // The pane target an item stands for, where it has one: a database of your
  // own, or a built-in one that opens in a pane.
  const targetOf = (item: BaseItem): PaneTarget | null =>
    item.kind === 'custom'
      ? { kind: 'custom', databaseId: item.database.id }
      : item.kind === 'builtin'
        ? paneTargetFor(item.tile)
        : null;

  // The right button on a row: the same thing the row is, opened
  // somewhere else - in a panel of its own, or in a window of its own.
  const workspace = useWorkspace();
  const openElsewhere = async (item: BaseItem) => {
    const target = targetOf(item);
    if (!target || !workspace) return;
    const answer = await ask({
      title: rowOf(item).label,
      actions: [
        { id: 'tab', label: 'Відкрити в новій вкладці', icon: 'browsers-outline' },
        { id: 'panel', label: 'Відкрити в новій панелі', icon: 'albums-outline' },
        { id: 'window', label: 'Відкрити в новому вікні', icon: 'copy-outline' },
      ],
    });
    // In the main pane: going there makes it a tab of its own (DesktopTabs).
    if (answer === 'tab') {
      // Sections are tabs only when asked for; the rest become one by going.
      if (target.kind === 'route' && target.route === 'Tasks') addTab('section', 'Tasks');
      else if (target.kind === 'boards') addTab('section', 'Дошки');
      navigateToTarget(target);
    }
    else if (answer === 'panel') workspace.openAnother({ kind: 'target', target });
    else if (answer === 'window') window.open(windowUrlFor(target), '_blank');
  };

  const openItem = (item: BaseItem, full = false) => {
    // On a wide screen a database opens BESIDE the list,
    // in the left pane, rather than replacing it.
    const pane =
      item.kind === 'builtin'
        ? paneTargetFor(item.tile)
        : item.kind === 'custom'
          ? ({ kind: 'custom', databaseId: item.database.id } as const)
          : null;
    if (isTwoPane && pane) {
      setOpenInPane(pane);
      return;
    }
    // In the drawer, inside it - the documents and the boards are desks,
    // and go there as before.
    if (inDrawer && pane && pane.kind !== 'documents' && pane.kind !== 'boards' && !full) {
      const row = rowOf(item);
      setDrawerPaneTitle({ icon: row.icon, label: row.label });
      drawerPaneItem.current = item;
      setOpenInPane(pane);
      return;
    }
    if (item.kind === 'builtin') openTile(item.tile);
    else if (item.kind === 'custom')
      openNav.navigate('CustomDatabase', { databaseId: item.database.id });
    else if (item.kind === 'pin') {
      // A group opens the documents with that group
      // chosen - and everything else in it follows under
      // the rule there (see GroupSections). A smart folder
      // opens its own list, which is already cross-database.
      if (item.pinKind === 'group') {
        // The documents are a desk under this layer: the
        // layer has to get out of the way to show them.
        databasesLayer?.close();
        whenDeskIsThere(
          'Документи',
          () =>
            navigation.navigate('Tabs', {
              screen: 'Документи',
              params: { groupId: item.pin.id },
            }),
          () => openNav.navigate('DocumentsCopy', { groupId: item.pin.id })
        );
      } else navigation.navigate('TagItems', { tagId: item.pin.id });
    } else if (item.key === NEW_TILE_KEY) startNewDatabase();
    else if (item.key === PIN_TILE_KEY) setPinSheetVisible(true);
    else setImporting(true);
  };

  // One row's name, icon, colour and count - the same for every kind of
  // item, so the list draws them all alike.
  const rowOf = (item: BaseItem) => {
    const label =
      item.kind === 'builtin'
        ? item.tile.label
        : item.kind === 'custom'
          ? item.database.name || 'Без назви'
          : item.kind === 'pin'
            ? item.pin.name
            : item.key === NEW_TILE_KEY
              ? 'Нова база'
              : item.key === PIN_TILE_KEY
                ? 'Закріпити'
                : 'Імпорт таблиці';
    const icon =
      item.kind === 'builtin'
        ? item.tile.icon
        : item.kind === 'custom'
          ? item.database.icon ?? 'grid-outline'
          : item.kind === 'pin'
            ? item.pin.icon
            : item.key === NEW_TILE_KEY
              ? 'add'
              : item.key === PIN_TILE_KEY
                ? 'bookmark-outline'
                : 'download-outline';
    const color =
      item.kind === 'custom'
        ? item.database.color ?? recordColour(item.database.id).background
        : item.kind === 'pin'
          ? item.pin.color
          : colorFor(item.key);
    return { label, icon: icon as string, color, count: item.kind === 'pin' ? item.pin.count : counts[item.key] };
  };

  // A HOLD ON A ROW: what the tile's own menu used to be the only door to -
  // a base's icon and colour, taking a pinned project or smart folder off
  // again, deleting a base of one's own. Asked the way every hold asks in
  // the app (holdAsk); the rows that make things have nothing to ask. A
  // pin's colour is its project's or folder's own, so it is not offered.
  // The desk a base can stand as (the multitasking windows): the documents and the boards have theirs, the bases
  // with a screen of their own too (navigation/tabScreens), a base of one's own by its id.
  const deskKeyOf = (item: BaseItem): string | null => {
    if (item.kind === 'custom') return deskKeyForCustom(item.database.id);
    if (item.kind !== 'builtin') return null;
    const k = item.tile.key;
    if (k === 'documents') return PERMANENT_DESK;
    if (k === 'board') return BOARDS_DESK;
    return ['tasks', 'photos', 'files', 'stickers', 'flashcards', 'diary', 'geo', 'links', 'video'].includes(k) ? `db:${k}` : null;
  };
  async function openRowMenu(item: BaseItem) {
    if (item.kind === 'action') return;
    const actions: AskAction[] = [];
    // THE NEW WINDOW, first (the user, 2026-10-13: the multitasking circle had nothing to switch to and nothing to
    // drag): a hold on a base opens it as a window of its own, beside the three desks.
    const deskKey = !inPanel && !inDrawer && !threeDesksOnly ? deskKeyOf(item) : null;
    if (deskKey) actions.push({ id: 'window', label: 'Відкрити в новому вікні', icon: 'copy-outline' });
    if (item.kind === 'builtin' || item.kind === 'custom') {
      actions.push(
        { id: 'icon', label: 'Іконка', icon: (currentIcon(item.key) ?? 'grid-outline') as AskAction['icon'] },
        { id: 'colour', label: 'Колір', icon: 'color-palette-outline' }
      );
    }
    if (item.kind === 'pin') actions.push({ id: 'unpin', label: 'Відкріпити', icon: 'remove-circle-outline' });
    if (item.kind === 'custom') actions.push({ id: 'delete', label: 'Видалити базу', icon: 'trash-outline', tone: 'danger' });
    const choice = await holdAsk({ title: rowOf(item).label, actions });
    if (choice === 'window' && deskKey) whenDeskIsThere(deskKey, () => navigation.navigate('Tabs', { screen: deskKey as never }));
    else if (choice === 'icon') setIconPickerFor(item.key);
    else if (choice === 'colour') setColorPickerFor(item.key);
    else if (choice === 'unpin') togglePin(item.key);
    else if (choice === 'delete' && item.kind === 'custom') confirmDeleteDatabase(item.database);
  }

  // THE LIST: every base, one row each - on the phone (screen, layer and
  // drawer) with rows sized for a finger, clear of the bar and the dock;
  // in a laptop's side panel, rows sized for a mouse.
  const listView = (
    <ScrollView
      onScroll={inPanel ? undefined : chromeScroll}
      scrollEventThrottle={64}
      contentContainerStyle={
        inPanel
          ? { paddingVertical: 8, paddingHorizontal: 8 }
          : {
              paddingTop: databasesInsets.top + CHROME_TOP + 8 + navSpace,
              // Arranging, «Готово» floats over the foot of the list: room for it, so the last base can come up.
              paddingBottom: dockClear + databasesInsets.bottom + 24 + (editing ? 64 : 0),
              paddingHorizontal: 12,
            }
      }
    >
      {(() => {
        // ONE LIST, in the user's order (listOrder), cut into sections where a bar was put (the user, 2026-10-12:
        // «прибрати папки, зробити все єдиним списком… ставив розділюючі полоси там, де мені треба»). A base the
        // stored order does not know yet (just made) joins at the end; the commands (Нова база, Імпорт…) always
        // stand last.
        const bases = items.filter((item) => item.kind !== 'action');
        const commands = items.filter((item) => item.kind === 'action');
        const byKey = new Map(bases.map((item) => [item.key, item]));
        const stored = listOrder.order.filter((key) => byKey.has(key));
        const ordered = [...stored, ...bases.map((item) => item.key).filter((key) => !stored.includes(key))].map(
          (key) => byKey.get(key)!
        );
        const breaks = new Set(listOrder.breaks);
        const save = (order: string[], nextBreaks: Set<string>) => {
          const next = { order, breaks: Array.from(nextBreaks).filter((key) => order.includes(key)) };
          setListOrder(next);
          setDoc(basesListDoc, next, { merge: true });
        };
        const keys = ordered.map((item) => item.key);
        const move = (index: number, delta: number) => {
          const to = index + delta;
          if (to < 0 || to >= keys.length) return;
          const order = [...keys];
          [order[index], order[to]] = [order[to], order[index]];
          save(order, breaks);
        };
        const toggleBreak = (key: string) => {
          const nextBreaks = new Set(breaks);
          if (nextBreaks.has(key)) nextBreaks.delete(key);
          else nextBreaks.add(key);
          save(keys, nextBreaks);
        };
        const arranging = editing && !inPanel;
        const out: ReactNode[] = [];
        const cardsOn = FEATURES.basesCards && !inPanel && !!S && !arranging;
        let group: ReactNode[] = [];
        if (arranging) {
          out.push(
            <Text key="hint" style={[panelListStyles.hint, { color: S?.ink3 ?? theme.ink.muted }]}>
              Торкніться бази - під нею стане межа розділу (ще раз - зникне). Стрілки переставляють.
            </Text>
          );
        }
        ordered.forEach((item, index) => {
          const row = rowOf(item);
          const colour = softTokensAll ? softIconColour(row.color || '', softTokensAll) : row.color;
          if (arranging) {
            out.push(
              <ArrangeRow
                key={item.key}
                label={row.label}
                icon={row.icon}
                color={colour}
                onToggleBreak={() => toggleBreak(item.key)}
                onUp={index > 0 ? () => move(index, -1) : undefined}
                onDown={index < ordered.length - 1 ? () => move(index, 1) : undefined}
              />
            );
            if (breaks.has(item.key) && index < ordered.length - 1) {
              out.push(<View key={`b-${item.key}`} style={[panelListStyles.breakBar, { borderColor: S?.accent ?? theme.accent }]} />);
            }
            return;
          }
          const rowEl = (
            <PanelListRow
              key={item.key}
              label={row.label}
              icon={row.icon}
              color={colour}
              count={row.count}
              touch={!inPanel}
              card={cardsOn}
              onPress={() => openItem(item)}
              onLongPress={() => openRowMenu(item)}
              onContext={targetOf(item) ? () => openElsewhere(item) : undefined}
              lit={!!flashTarget && !!targetOf(item) && sameTarget(targetOf(item) as PaneTarget, flashTarget)}
            />
          );
          const sectionEnds = (breaks.has(item.key) && index < ordered.length - 1) || index === ordered.length - 1;
          if (cardsOn) {
            // A section is ONE white card: its rows with a hairline between them.
            if (group.length > 0) group.push(<View key={`l-${item.key}`} style={[panelListStyles.cardLine, { backgroundColor: S?.line }]} />);
            group.push(rowEl);
            if (sectionEnds) {
              out.push(
                <View key={`card-${item.key}`} style={[panelListStyles.cardBox, { backgroundColor: S?.card, boxShadow: S?.shadow }]}>
                  {group}
                </View>
              );
              group = [];
              if (index < ordered.length - 1) out.push(<View key={`s-${item.key}`} style={{ height: 14 }} />);
            }
            return;
          }
          out.push(rowEl);
          if (breaks.has(item.key) && index < ordered.length - 1) {
            out.push(<View key={`s-${item.key}`} style={{ height: inPanel ? 10 : 18 }} />);
          }
        });
        if (!arranging && commands.length > 0) {
          out.push(<View key="commands-gap" style={{ height: inPanel ? 10 : 18 }} />);
          commands.forEach((item) => {
            const row = rowOf(item);
            out.push(
              <PanelListRow
                key={item.key}
                label={row.label}
                icon={row.icon}
                color={row.color}
                dashed
                touch={!inPanel}
                onPress={() => openItem(item)}
              />
            );
          });
        }
        return out;
      })()}
    </ScrollView>
  );

  return (
    <View style={styles.container}>
      {/* The theme's own ground - the drifting gradient in colour, the
          bleached clouds in white, plain black in black. */}
      {/* Over the desk the blurred desk IS the ground - see SideLayer. */}
      {S ? (
        // The soft ground - over the blurred desk too, in the layer.
        <ScreenGround color={S.bg} />
      ) : (
        !databasesLayer && <ScreenBackdrop id="databasesBg" />
      )}
      {/* On a wide screen, lying down, a database opens BESIDE the list -
          the list keeps the right side, against the rail that belongs to
          it (the same reasoning as the documents list), and the database
          takes the left. Outside ContentColumn on purpose: that column
          caps content at a readable 760, which is right for one list and
          wrong for two panes, which should have the whole unfolded screen.
          With nothing open there is just the list, in its column. */}
      {isTwoPane && openInPane ? (
        <View style={styles.paneRow}>
          <View style={styles.listPane}>{listView}</View>
          <View style={styles.databasePane}>
            {/* Its own portal host and blur target, which is the whole
                trick: a screen's rail, its tabs and its sheets all draw
                through the NEAREST host, so inside this one they stay in
                this pane instead of spreading across the window. And its
                own navigation, whose goBack closes the pane rather than
                walking off the list. */}
            <GlassPortalHost>
              <GlassTargetProvider>
                <NavigationContext.Provider value={paneNavigation}>
                  <PaneTargetScreen target={openInPane} />
                </NavigationContext.Provider>
              </GlassTargetProvider>
            </GlassPortalHost>
          </View>
        </View>
      ) : (
        <ContentColumn>
          {/* No title: the capsule says where this is. The rows run all
              the way up and scroll off the top edge, the way the cards do
              everywhere else. */}
          {listView}
          {/* What runs off the top and the bottom melts into the ground
              under the bar and the dock (the user's, 2026-10-02). */}
          {!inPanel && panelDensity !== 'pointer' && S && !(inDrawer && openInPane) && (
            <>
              <EdgeFade edge="top" color={S.bg} height={databasesInsets.top + CHROME_TOP + TOP_NAV_H} />
              <EdgeFade edge="bottom" color={S.bg} height={Math.round((dockClear + databasesInsets.bottom) * 0.85)} />
            </>
          )}
        </ContentColumn>
      )}

      {/* The way out of arranging - and the only thing on screen that
          says the list is in it. */}
      {editing && (
        <View
          style={[
            styles.editBar,
            // Clear of the island lying across the foot of the screen -
            // its own height plus the gap it keeps from the edge.
            { bottom: databasesInsets.bottom + dockClear },
          ]}
        >
          <Pressable style={styles.doneButton} onPress={() => setEditing(false)}>
            <Ionicons name="checkmark" size={18} color="#171310" />
            <Text style={styles.doneLabel}>Готово</Text>
          </Pressable>
        </View>
      )}

      <ImportTableSheet
        visible={importing}
        otherDatabases={customDatabases.map((d) => ({ id: d.id, name: d.name }))}
        onClose={() => setImporting(false)}
        onDone={(databaseId, rowCount) => {
          setImporting(false);
          notify('Імпортовано', `Додано записів: ${rowCount}`);
          navigation.navigate('CustomDatabase', { databaseId });
        }}
      />

      <RenamePrompt
        key={newDatabaseTemplate ?? 'empty'}
        visible={creatingDatabase}
        title={newDatabaseTemplate === 'apps' ? `Нова база · ${APPS_TEMPLATE_NAME}` : 'Нова база'}
        initialValue={newDatabaseTemplate === 'apps' ? APPS_TEMPLATE_NAME : ''}
        placeholder="Назва бази"
        onCancel={() => {
          setCreatingDatabase(false);
          setNewDatabaseTemplate(null);
        }}
        onSave={createDatabase}
      />

      {/* A base's colour, chosen from a row's hold menu: the same palette
          the tile's menu offered, written where it always was (pickColor). */}
      <Modal visible={colorPickerFor !== null} transparent animationType="fade" onRequestClose={() => setColorPickerFor(null)}>
        <Pressable style={styles.colorMenuBackdrop} onPress={() => setColorPickerFor(null)}>
          <Pressable style={styles.colorMenuCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.colorMenuTitle}>Колір бази</Text>
            <View style={styles.colorMenuRow}>
              {theme.cards.map((color) => (
                <Pressable key={color} onPress={() => colorPickerFor && pickColor(colorPickerFor, color)}>
                  <View style={[styles.colorSwatch, { backgroundColor: color }]} />
                </Pressable>
              ))}
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* What else can go in the list: the groups (a theme of the
          period) and the smart folders (a saved filter). Both already
          know their own colour and how many they hold. */}
      <Modal
        visible={pinSheetVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setPinSheetVisible(false)}
      >
        <Pressable style={styles.colorMenuBackdrop} onPress={() => setPinSheetVisible(false)}>
          <Pressable style={styles.pinCard} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.colorMenuTitle}>Закріпити в базах</Text>
            <ScrollView style={styles.pinList}>
              <Text style={styles.pinSection}>Проекти</Text>
              {pinnableGroups.length === 0 && <Text style={styles.pinEmpty}>Проектів поки немає</Text>}
              {pinnableGroups.map((group) => {
                const key = groupKey(group.id);
                const on = pinnedKeys.includes(key);
                return (
                  <Pressable key={key} style={styles.sheetRow} onPress={() => togglePin(key)}>
                    <Ionicons name="albums-outline" size={17} color={group.color} />
                    <Text style={styles.sheetRowLabel} numberOfLines={1}>
                      {group.name}
                    </Text>
                    <Text style={styles.pinCount}>{group.count}</Text>
                    {on && <Ionicons name="checkmark" size={18} color={accent} />}
                  </Pressable>
                );
              })}

              <Text style={styles.pinSection}>Смартпапки</Text>
              {pinnableTags.length === 0 && <Text style={styles.pinEmpty}>Смартпапок поки немає</Text>}
              {pinnableTags.map((tag) => {
                const key = tagKey(tag.id);
                const on = pinnedKeys.includes(key);
                return (
                  <Pressable key={key} style={styles.sheetRow} onPress={() => togglePin(key)}>
                    <Ionicons
                      name={tag.icon as keyof typeof Ionicons.glyphMap}
                      size={17}
                      color={tag.color}
                    />
                    <Text style={styles.sheetRowLabel} numberOfLines={1}>
                      {tag.name}
                    </Text>
                    <Text style={styles.pinCount}>{tag.count}</Text>
                    {on && <Ionicons name="checkmark" size={18} color={accent} />}
                  </Pressable>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      <IconPickerSheet
        visible={iconPickerFor !== null}
        title="Іконка бази"
        selected={iconPickerFor ? currentIcon(iconPickerFor) : undefined}
        onPick={(icon) => {
          if (iconPickerFor && customDatabases.some((d) => d.id === iconPickerFor)) {
            setDoc(doc(db, 'customDatabases', iconPickerFor), { icon }, { merge: true });
          } else if (iconPickerFor && builtinIcon(iconPickerFor)) {
            setDoc(tileIconsDoc, { [iconPickerFor]: icon }, { merge: true });
          }
          setIconPickerFor(null);
        }}
        onClose={() => setIconPickerFor(null)}
      />

      {/* In the layer: its own bar and dock, inside it and moving with it. */}
      {databasesLayer && !(inDrawer && openInPane) && (
        <>
          <TopNavBar
            inline={{ width: windowWidth }}
            softInline={!!S}
            title={{ icon: 'apps-outline', label: 'Бази' }}
            backOverride={layerBack}
            extrasOverride={layerExtras}
          />
          <InlineDock
            width={windowWidth}
            beads={{ left: searchBead, right: newDatabaseBead }}
            actions={null}
            soft={S}
            back={databasesLayer.close}
          />
        </>
      )}
      {/* A database opened in the drawer: over the list, with its own bar
          and dock (its own NavDockProvider - what it publishes lands here,
          not on the window's chrome, which the drawer covers). */}
      {inDrawer && openInPane && (
        <View style={StyleSheet.absoluteFill}>
          <ScreenGround color={S ? S.bg : theme.surface} />
          <NavDockProvider>
            <GlassPortalHost>
              <GlassTargetProvider>
                <NavigationContext.Provider value={paneNavigation}>
                  <PaneBarContext.Provider value>
                    <View style={StyleSheet.absoluteFill}>
                      <PaneTargetScreen key={JSON.stringify(openInPane)} target={openInPane} />
                    </View>
                  </PaneBarContext.Provider>
                  <DrawerPaneChrome
                    width={windowWidth}
                    soft={S}
                    title={drawerPaneTitle ?? { icon: 'apps-outline', label: 'Бази' }}
                    onBack={() => setOpenInPane(null)}
                    onExpand={() => {
                      const item = drawerPaneItem.current;
                      setOpenInPane(null);
                      if (item) openItem(item, true);
                    }}
                  />
                </NavigationContext.Provider>
              </GlassTargetProvider>
            </GlassPortalHost>
          </NavDockProvider>
        </View>
      )}
    </View>
  );
}

// One row of the list: an icon in the base's colour, the full name, the
// count at the right. 30 tall in a laptop's panel - a mouse does not need
// more - and lit under the cursor; 50 on a phone. Held, it asks what to do
// with that base (openRowMenu) - lifted over the blur like every hold menu,
// which is why it is a HoldPressable.
function PanelListRow({
  label,
  icon,
  color,
  count,
  dashed,
  touch,
  onPress,
  onLongPress,
  onContext,
  lit,
  card,
}: {
  label: string;
  icon: string;
  color: string;
  count?: number;
  dashed?: boolean;
  // Inside a white card (features.basesCards): the icon in a grey chip, a roomier row, no rounded highlight of its own.
  card?: boolean;
  // On the phone: a row sized for a finger.
  touch?: boolean;
  onPress: () => void;
  onLongPress?: () => void;
  onContext?: () => void;
  // The database just left in the main pane - see databaseFlash.
  lit?: boolean;
}) {
  const S = useSoft();
  return (
    <HoldPressable
      onPress={onPress}
      onLongPress={onLongPress}
      {...rightClick(onContext)}
      style={(state) => [
        panelListStyles.row,
        touch && panelListStyles.rowTouch,
        card && panelListStyles.rowCard,
        ((state as { hovered?: boolean }).hovered || (touch && state.pressed)) && { backgroundColor: S.fill },
        lit && { backgroundColor: withAlpha(color || S.ink, 0.2) },
      ]}
    >
      {card ? (
        <View style={[panelListStyles.chip, { backgroundColor: S.fill }]}>
          <Ionicons name={icon as never} size={20} color={color} />
        </View>
      ) : (
        <Ionicons name={icon as never} size={touch ? 20 : 16} color={dashed ? S.ink3 : color} />
      )}
      <Text style={[panelListStyles.label, touch && panelListStyles.labelTouch, { color: dashed ? S.ink2 : S.ink }]} numberOfLines={1}>
        {label}
      </Text>
      {count !== undefined && count > 0 && (
        <Text style={[panelListStyles.count, touch && panelListStyles.countTouch, { color: S.ink3 }]}>{count}</Text>
      )}
    </HoldPressable>
  );
}

// A base while the list is being arranged: a tap puts (or takes away) a section's edge under it, the arrows
// move it one place. Nothing is dragged - the user's word on dragging here: «стрибають».
function ArrangeRow({
  label,
  icon,
  color,
  onToggleBreak,
  onUp,
  onDown,
}: {
  label: string;
  icon: string;
  color: string;
  onToggleBreak: () => void;
  onUp?: () => void;
  onDown?: () => void;
}) {
  const S = useSoft();
  return (
    <View style={[panelListStyles.row, panelListStyles.rowTouch]}>
      <Pressable style={panelListStyles.arrangeMain} onPress={onToggleBreak}>
        <Ionicons name={icon as never} size={20} color={color} />
        <Text style={[panelListStyles.label, panelListStyles.labelTouch, { color: S.ink }]} numberOfLines={1}>
          {label}
        </Text>
      </Pressable>
      <Pressable hitSlop={6} style={panelListStyles.arrow} disabled={!onUp} onPress={onUp} accessibilityLabel="Вище">
        <Ionicons name="chevron-up" size={22} color={onUp ? S.ink : S.ink3} style={!onUp && { opacity: 0.3 }} />
      </Pressable>
      <Pressable hitSlop={6} style={panelListStyles.arrow} disabled={!onDown} onPress={onDown} accessibilityLabel="Нижче">
        <Ionicons name="chevron-down" size={22} color={onDown ? S.ink : S.ink3} style={!onDown && { opacity: 0.3 }} />
      </Pressable>
    </View>
  );
}

// The bar and the dock of a database opened in the phone's drawer: what
// the database publishes (its "⋯", its beads and actions), read from the
// drawer's own NavDockProvider, plus the way back to the list and "На
// весь екран".
function DrawerPaneChrome({
  width,
  soft,
  title,
  onBack,
  onExpand,
}: {
  width: number;
  soft: SoftTokens | null;
  title: { icon: string; label: string };
  onBack: () => void;
  onExpand: () => void;
}) {
  const extras = useNavTopExtras();
  const search = useNavTopSearch();
  const beads = useNavDockBeads();
  const actions = useNavDockActions();
  return (
    <>
      <TopNavBar
        inline={{ width }}
        softInline={!!soft}
        title={{ icon: title.icon as never, label: title.label }}
        backOverride={{ onPress: onBack, dimmed: false }}
        searchOverride={search}
        extrasOverride={{
          menu: extras?.menu ?? null,
          select: extras?.select ?? null,
          tools: [
            ...(extras?.tools ?? []),
            { key: 'expand', icon: 'expand-outline', label: 'На весь екран', onPress: onExpand },
          ],
        }}
      />
      <InlineDock width={width} beads={beads} actions={actions} soft={soft} back={onBack} />
    </>
  );
}

const panelListStyles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 30,
    paddingHorizontal: 10,
    borderRadius: 8,
    // The light going out is a fade, not a blink.
    transitionProperty: 'background-color',
    transitionDuration: '600ms',
  } as never,
  label: { flex: 1, fontSize: 13.5, fontFamily: SOFT_MEDIUM },
  count: { fontSize: 12, fontFamily: SOFT_MEDIUM },
  rowTouch: { height: 50, gap: 14, paddingHorizontal: 14, borderRadius: 14 },
  labelTouch: { fontSize: 16 },
  rowCard: { height: 58, borderRadius: 0, gap: 14, paddingHorizontal: 16 },
  chip: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  cardBox: { borderRadius: 24, overflow: 'hidden', marginHorizontal: 4 },
  cardLine: { height: StyleSheet.hairlineWidth, marginLeft: 66 },
  countTouch: { fontSize: 14 },
  hint: { fontSize: 13, fontFamily: SOFT_MEDIUM, paddingHorizontal: 14, paddingBottom: 10, lineHeight: 18 },
  arrangeMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 14, alignSelf: 'stretch' },
  arrow: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  // The section's edge while arranging - seen only then; after «Готово» it is just the gap between sections.
  breakBar: { marginHorizontal: 14, marginVertical: 6, borderTopWidth: 2, borderStyle: 'dashed' },
});

// A base's own colour as its icon on the soft ground: as it is, unless it
// would all but vanish there - too pale on the light one, too dark on the
// black one - where the quiet ink stands in.
function softIconColour(colour: string, S: SoftTokens): string {
  const hex = /^#([0-9a-f]{6})$/i.exec(colour.trim());
  if (!hex) return S.ink;
  const n = parseInt(hex[1], 16);
  const channel = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const lum = 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
  if (!S.dark && lum > 0.62) return S.ink2;
  if (S.dark && lum < 0.06) return S.ink2;
  return colour;
}

// THE SOFT STYLE: what changes, key by key (the same overlay as the
// calendar's) - the «Готово» capsule takes the soft chrome and Inter.
type DatabasesStyles = ReturnType<typeof makeStyles>;
const softDatabasesCache = new WeakMap<object, Map<SoftTokens, DatabasesStyles>>();
function softenDatabases(base: DatabasesStyles, S: SoftTokens): DatabasesStyles {
  let byTokens = softDatabasesCache.get(base);
  if (!byTokens) softDatabasesCache.set(base, (byTokens = new Map()));
  const hit = byTokens.get(S);
  if (hit) return hit;
  const over = StyleSheet.create({
    doneButton: { backgroundColor: S.chrome, boxShadow: S.popShadow },
    doneLabel: { fontFamily: SOFT_MEDIUM, color: S.ink },
  }) as Record<string, object>;
  const merged = { ...base } as Record<string, unknown>;
  for (const key of Object.keys(over)) merged[key] = [merged[key], over[key]];
  const result = merged as DatabasesStyles;
  byTokens.set(S, result);
  return result;
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
  container: {
    flex: 1,
  },
  pinCard: {
    backgroundColor: t.surface,
    borderRadius: 18,
    padding: 16,
    width: '100%',
    maxWidth: 420,
    maxHeight: '70%',
  },
  pinList: {
    marginTop: 8,
  },
  pinSection: {
    fontSize: 11,
    fontFamily: FONT_MEDIUM,
    color: 'rgba(255,255,255,0.5)',
    textTransform: 'uppercase',
    letterSpacing: 0.06,
    marginTop: 12,
    marginBottom: 2,
  },
  pinEmpty: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.4)',
    paddingVertical: 8,
  },
  pinCount: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.5)',
  },
  editBar: {
    position: 'absolute',
    alignSelf: 'center',
    flexDirection: 'row',
    gap: 10,
  },
  doneButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 18,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  doneLabel: {
    fontSize: 14,
    fontFamily: FONT_MEDIUM,
    color: '#171310',
  },
  // Two halves of one screen, not a window over it. Reversed so the
  // list keeps the right side, against the rail that belongs to it -
  // the same arrangement the documents list uses.
  paneRow: {
    flex: 1,
    flexDirection: 'row-reverse',
  },
  listPane: {
    flex: 1,
  },
  // A whole database takes the pane entire - no padding, and no
  // centring: a screen given "justifyContent: center" is not stretched
  // at all, it is sized by its own content and stood in the middle,
  // which is what left the cards a narrow tall strip pressed against
  // one side. It measures the pane it is given, so the pane has to be
  // the pane.
  databasePane: {
    flex: 1,
    borderRightWidth: 1,
    borderRightColor: t.edge.hairline,
  },
  colorMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.4)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
  },
  colorMenuCard: {
    backgroundColor: t.surface,
    borderRadius: 16,
    padding: 20,
    width: '100%',
    maxWidth: 320,
  },
  colorMenuTitle: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
    marginBottom: 14,
  },
  colorMenuRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  sheetRowLabel: {
    fontSize: 14,
    fontFamily: FONT_MEDIUM,
    color: t.ink.primary,
  },
  colorSwatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
  },
  });
