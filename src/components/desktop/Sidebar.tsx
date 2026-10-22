import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import { navigationRef } from '../../navigationRef';
import { StackActions } from '@react-navigation/native';
import { useTags } from '../../hooks/useTags';
import { useAllFolderItems } from '../../hooks/useAllFolderItems';
import { useDatabaseTiles } from '../../hooks/useDatabaseTiles';
import { GRID_TILES, WIDE_TILES, type Tile } from '../../constants/databaseTiles';
import { useInnerBackNow } from '../../navigation/innerBack';
import { useMainPaneUp } from '../../navigation/mainPaneUp';
import { CONTROL, RADIUS, TYPE, useDeskColors } from '../../theme/desktopTheme';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../../utils/fonts';
import { useStyles, useTheme } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme/tokens';
import { explorerPlace, useExplorerPath } from '../../navigation/explorerPlace';
import { DESKTOP_TITLE_BAND, DESKTOP_RAIL_WIDTH } from '../../constants/desktop';
import { cardSwatch } from '../../constants/cardPalette';
import { UNFILED } from '../../screens/ExplorerScreen';
import { onDesktopCommand } from '../../utils/desktopCommands';
import { usePins, type Pin } from '../../navigation/pinned';
import { useDocumentIndex } from '../../hooks/useDocumentIndex';
import { rightClick } from '../../utils/rightClick';

// THE MAC'S ONE NAVIGATION (frame B, 2026-10-19, after the user's own look at Claude's window: «тут є відчуття
// зручності»). Everything the window can go to stands here, top to bottom in the order a hand reaches: search,
// «Новий», the sections (Старт = the explorer, Думки, Календар, Справи), the pinned, the folder tree with
// «Нерозкладене» first, the bases, the account at the foot. The tab row, the phone capsule and the side panels as
// navigation are gone with it. Nothing here covers the column to its right: a folder opens inside the tree.
//
// Its data is its own (tags, items, bases) - not published by whichever screen is in front, so the tree is there on
// every screen, not only while the explorer stands (the old rail's way).

const DRAG = { WebkitAppRegion: 'drag' } as never;

type Node = { path: string; name: string; children: Node[] };

// A folder is any segment of any tag path - «розробка/концепти» makes «розробка» a folder even with no tag of that
// path (the explorer's own rule), so every segment on the way gets a node.
function buildTree(paths: string[]): Node[] {
  const roots: Node[] = [];
  const byPath = new Map<string, Node>();
  const ensure = (path: string): Node => {
    const had = byPath.get(path);
    if (had) return had;
    const parts = path.split('/');
    const node: Node = { path, name: parts[parts.length - 1], children: [] };
    byPath.set(path, node);
    (parts.length > 1 ? ensure(parts.slice(0, -1).join('/')).children : roots).push(node);
    return node;
  };
  for (const path of paths) ensure(path);
  const sort = (list: Node[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

// Where the navigator stands: the deepest route's name; the explorer's path comes from the explorer itself.
function useWhere(): { route: string; path: string } {
  const [route, setRoute] = useState('');
  useEffect(() => {
    const read = () => {
      if (!navigationRef.isReady()) return;
      // The deepest route: inside the Tabs container that is the tab's own name (Календар), not «Tabs».
      setRoute((navigationRef.getCurrentRoute()?.name as string) ?? '');
    };
    read();
    return navigationRef.addListener('state', read);
  }, []);
  const path = useExplorerPath();
  return { route, path };
}

function go(name: string, params?: Record<string, unknown>) {
  if (!navigationRef.isReady()) return;
  (navigationRef.navigate as (n: string, p?: unknown) => void)(name, params);
}

// A section from the sidebar stands ON the explorer, never on top of another section: back down to the home first,
// then to it - so «Назад» from any section lands on the explorer, and no section is ever left stacked under another.
function goSection(name: string, params?: Record<string, unknown>) {
  if (!navigationRef.isReady()) return;
  const state = navigationRef.getRootState();
  const routes = state?.routes ?? [];
  const at = routes.findIndex((r) => r.name === 'Explorer');
  const top = routes[routes.length - 1]?.name;
  if (at >= 0 && top !== 'Explorer' && routes.length - 1 > at) navigationRef.dispatch(StackActions.popTo('Explorer'));
  go(name, params);
}

// The explorer at a path: asked to stand there, then brought to the front.
function goFolder(path: string) {
  explorerPlace.request(path);
  if (!navigationRef.isReady() || navigationRef.getCurrentRoute()?.name === 'Explorer') return;
  // The explorer is the home under whatever was pushed over it: back down to it, never a second copy on top.
  const state = navigationRef.getRootState();
  const at = state?.routes?.findIndex((r) => r.name === 'Explorer') ?? -1;
  if (at >= 0) navigationRef.dispatch(StackActions.popTo('Explorer'));
  else go('Explorer');
}

export default function Sidebar({ footer }: { footer?: ReactNode }) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const D = useDeskColors();
  const where = useWhere();
  const { tags } = useTags();
  const items = useAllFolderItems(tags, { includeUnfiled: true });
  const { customDatabases, iconFor } = useDatabaseTiles();
  // «Закріплені»: what the user keeps at hand (navigation/pinned); a right click lets go of one.
  const { pins, toggle: togglePin } = usePins();
  const documentIndex = useDocumentIndex();
  const inner = useInnerBackNow();
  const paneUp = useMainPaneUp();
  // Inside a folder the explorer is one level down from its root: «Назад» climbs the path (the rule of 2026-10-19 -
  // a section has no «Назад»; what is opened inside one goes back one level). «Нерозкладене» sits right under the root.
  const onExplorerNow = where.route === 'Explorer';
  const folderUp =
    onExplorerNow && where.path
      ? () => explorerPlace.request(where.path === UNFILED ? '' : where.path.split('/').slice(0, -1).join('/'))
      : null;
  const back = inner ?? folderUp ?? paneUp;

  // The folders: the explorer's own rule - a base's collection (Tag.baseOnly) is out until placed in the explorer,
  // and once placed, everything under it is in too.
  const paths = useMemo(() => {
    const placed = tags.filter((t) => t.baseOnly && t.inExplorer).map((t) => t.path);
    const isPlaced = (path: string) => placed.some((p) => path === p || path.startsWith(`${p}/`));
    // A real folder named exactly like the built-in «Нерозкладене» is not a folder (see the explorer's own rule).
    return tags.filter((t) => (!t.baseOnly || isPlaced(t.path)) && t.path !== UNFILED).map((t) => t.path);
  }, [tags]);
  const roots = useMemo(() => buildTree(paths), [paths]);
  // What is in no folder - the count on «Нерозкладене» (the same rule as the explorer's: notes, boards, files;
  // photos and links in no folder live in their own bases).
  const unfiled = useMemo(
    () => items.filter((i) => i.kind !== 'row' && !(i.raw as { deletedAt?: unknown } | undefined)?.deletedAt && i.tagIds.every((id) => tags.find((t) => t.id === id)?.path === UNFILED) && i.kind !== 'photo' && i.kind !== 'link').length,
    [items, tags]
  );
  const countIn = (path: string) => items.filter((i) => i.tagIds.some((id) => tags.find((t) => t.id === id)?.path === path)).length;

  const [open, setOpen] = useState<Set<string>>(new Set());
  const toggle = (path: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  const [basesOpen, setBasesOpen] = useState(true);

  const onExplorer = where.route === 'Explorer';
  // THE KEYS (frame B, 2026-10-19): ⌘K = the search (the sidebar's own label), ⌘N = «Новий» - the shell's menu
  // sends 'new-note', which the old documents list answered; in frame B the explorer's quick-create is the one
  // way to make anything, so it answers here. ⌘K is not in the menu (⌘F is), so it is read off the keyboard.
  const newItem = () => {
    if (!onExplorer) goFolder(where.path);
    explorerPlace.requestCreate();
  };
  useEffect(() => {
    const stopNew = onDesktopCommand('new-note', newItem);
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      if (e.key.toLowerCase() === 'k') {
        e.preventDefault();
        go('Search');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      stopNew();
      window.removeEventListener('keydown', onKey);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onExplorer, where.path]);
  // A pin's face and its door: a note (title from the document index; gone from it = binned, not shown), one of the
  // user's bases, a folder of the explorer.
  function pinFace(p: Pin): { key: string; icon?: string; swatch?: string; label: string; on: boolean; open: () => void } | null {
    if (p.kind === 'note') {
      const d = documentIndex.get(p.id);
      if (!d || d.deletedAt) return null;
      return { key: `note:${p.id}`, icon: 'document-text-outline', label: d.title || 'Без назви', on: false, open: () => goSection('Editor', { documentId: p.id }) };
    }
    if (p.kind === 'custom') {
      const d = customDatabases.find((x) => x.id === p.id);
      if (!d) return null;
      return { key: `custom:${p.id}`, icon: (d.icon as string | undefined) ?? 'grid-outline', label: d.name, on: false, open: () => goSection('CustomDatabase', { databaseId: p.id }) };
    }
    const tag = tags.find((t) => t.path === p.path);
    if (!tag) return null;
    return { key: `folder:${p.path}`, swatch: cardSwatch(tag.color ?? 'mist', theme.scheme)?.bg ?? D.fill, label: p.path.split('/').pop() ?? p.path, on: onExplorer && where.path === p.path, open: () => goFolder(p.path) };
  }
  const sections: { key: string; label: string; icon: string; on: boolean; onPress: () => void; count?: number }[] = [
    { key: 'start', label: 'Старт', icon: 'home-outline', on: onExplorer && !where.path, onPress: () => goFolder('') },
    { key: 'thoughts', label: 'Думки', icon: 'cloud-outline', on: where.route === 'Thoughts', onPress: () => goSection('Thoughts') },
    { key: 'cal', label: 'Календар', icon: 'calendar-outline', on: where.route === 'Календар', onPress: () => goSection('Tabs', { screen: 'Календар' }) },
    { key: 'tasks', label: 'Справи', icon: 'checkbox-outline', on: where.route === 'Tasks', onPress: () => goSection('Tasks') },
  ];

  // The bases, in one list: the built-in ones that are a list of their own, then the user's own.
  const builtIn: Tile[] = [...WIDE_TILES, ...GRID_TILES].filter(
    (t) => !t.opensDocumentsTab && t.key !== 'tasks' && t.key !== 'tags' && t.key !== 'explorer' && t.key !== 'groups' && t.key !== 'chat'
  );
  const openTile = (t: Tile) => {
    if (t.opensBoardsTab) goSection('BoardsCopy');
    else if (t.linkCategory) goSection('Links', { category: t.linkCategory });
    else if (t.route) goSection(t.route);
  };

  function row(opts: { key: string; icon?: string; swatch?: string; label: string; on: boolean; onPress: () => void; count?: number; depth?: number; twist?: 'open' | 'closed' | null; onTwist?: () => void; tree?: boolean; unpin?: () => void }) {
    const { icon, swatch, label, on, onPress, count, depth = 0, twist = null, onTwist } = opts;
    return (
      <Pressable
        key={opts.key}
        onPress={onPress}
        {...(opts.unpin ? rightClick(opts.unpin) : {})}
        style={(state) => [
          styles.row,
          { paddingLeft: 10 + depth * 14 },
          on && { backgroundColor: D.fill },
          !on && (state as { hovered?: boolean }).hovered && { backgroundColor: D.fill },
        ]}
      >
        {twist !== null ? (
          <Pressable hitSlop={6} onPress={onTwist} style={styles.twist}>
            <Ionicons name={twist === 'open' ? 'chevron-down' : 'chevron-forward'} size={12} color={theme.ink.faint} />
          </Pressable>
        ) : opts.tree ? (
          // The place of a twist, kept: a folder with none must line up with its neighbours, or it reads as their parent.
          <View style={styles.twist} />
        ) : null}
        {swatch ? (
          <View style={[styles.swatch, { backgroundColor: swatch }]} />
        ) : (
          <Ionicons name={(icon ?? 'ellipse-outline') as never} size={16} color={on ? theme.ink.primary : theme.ink.muted} />
        )}
        <Text style={[styles.label, on && styles.labelOn]} numberOfLines={1}>
          {label}
        </Text>
        {count !== undefined && count > 0 && <Text style={styles.count}>{count}</Text>}
      </Pressable>
    );
  }

  function renderNode(node: Node, depth: number): ReactNode {
    const expanded = open.has(node.path);
    const tag = tags.filter((t) => t.path === node.path).find((t) => t.card) ?? tags.find((t) => t.path === node.path);
    const swatch = cardSwatch(tag?.card?.color, theme.scheme)?.bg ?? D.fill;
    return (
      <View key={node.path}>
        {row({
          key: node.path,
          swatch,
          label: node.name,
          on: onExplorer && where.path === node.path,
          onPress: () => goFolder(node.path),
          count: depth === 0 ? countIn(node.path) : undefined,
          depth,
          twist: node.children.length ? (expanded ? 'open' : 'closed') : null,
          onTwist: () => toggle(node.path),
          tree: true,
        })}
        {expanded && node.children.map((child) => renderNode(child, depth + 1))}
      </View>
    );
  }

  return (
    <View style={[styles.side, { backgroundColor: D.chrome }]}>
      {/* The traffic lights' band: empty, and it drags the window. */}
      <View style={[{ height: DESKTOP_TITLE_BAND - 10 }, DRAG]} />
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
        <Pressable style={[styles.search, { backgroundColor: D.card, borderColor: D.line }]} onPress={() => go('Search')}>
          <Ionicons name="search-outline" size={15} color={theme.ink.faint} />
          <Text style={styles.searchLabel}>Пошук</Text>
          <Text style={styles.kbd}>⌘K</Text>
        </Pressable>
        {/* The way back when a screen was pushed over everything - a note, a board, a record. */}
        {/* «Назад» only where there is a level to go down to: inside a folder (the explorer's own step), or on a screen
            opened from inside a section. The sections themselves stand level - no arrow between them. */}
        {back ? row({ key: 'back', icon: 'chevron-back', label: 'Назад', on: false, onPress: back }) : null}
        {row({
          key: 'new',
          icon: 'add',
          label: 'Новий',
          on: false,
          onPress: newItem,
        })}
        {sections.map((s) => row({ key: s.key, icon: s.icon, label: s.label, on: s.on, onPress: s.onPress, count: s.count }))}

        {pins.length > 0 && (
          <View style={styles.sec}>
            <Text style={styles.secLabel}>Закріплені</Text>
          </View>
        )}
        {pins.map((p) => {
          const face = pinFace(p);
          if (!face) return null;
          return row({ key: `pin:${face.key}`, icon: face.icon, swatch: face.swatch, label: face.label, on: face.on, onPress: face.open, unpin: () => togglePin(p) });
        })}

        <View style={styles.sec}>
          <Text style={styles.secLabel}>Провідник</Text>
        </View>
        {unfiled > 0 &&
          row({ key: 'unfiled', swatch: cardSwatch('mist', theme.scheme)?.bg ?? D.fill, label: 'Нерозкладене', on: onExplorer && where.path === UNFILED, onPress: () => goFolder(UNFILED), count: unfiled, tree: true })}
        {roots.map((n) => renderNode(n, 0))}

        <Pressable style={styles.sec} onPress={() => setBasesOpen((v) => !v)}>
          <Text style={styles.secLabel}>Бази</Text>
          <Ionicons name={basesOpen ? 'chevron-down' : 'chevron-forward'} size={12} color={theme.ink.faint} />
        </Pressable>
        {basesOpen && (
          <>
            {builtIn.map((t) => row({ key: t.key, icon: iconFor(t.key, t.icon), label: t.label, on: false, onPress: () => openTile(t) }))}
            {customDatabases
              .slice()
              .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
              .map((d) =>
                row({
                  key: `db:${d.id}`,
                  icon: (d.icon as string | undefined) ?? 'grid-outline',
                  label: d.name || 'Без назви',
                  on: false,
                  onPress: () => goSection('CustomDatabase', { databaseId: d.id }),
                })
              )}
            {row({ key: 'all-bases', icon: 'apps-outline', label: 'Усі бази…', on: where.route === 'Більше', onPress: () => goSection('Tabs', { screen: 'Більше' }) })}
          </>
        )}
      </ScrollView>
      {!!footer && <View style={[styles.footer, { borderTopColor: D.line }]}>{footer}</View>}
    </View>
  );
}

export const SIDEBAR_WIDTH = DESKTOP_RAIL_WIDTH;

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    side: {
      width: SIDEBAR_WIDTH,
      borderRightWidth: StyleSheet.hairlineWidth,
      borderRightColor: t.edge.hairline,
    },
    scroll: { flex: 1 },
    content: { paddingHorizontal: 10, paddingBottom: 12, gap: 1 },
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      height: CONTROL.button + 2,
      paddingHorizontal: 10,
      borderRadius: RADIUS.control,
      borderWidth: StyleSheet.hairlineWidth,
      marginBottom: 6,
    },
    searchLabel: { flex: 1, fontSize: TYPE.sm, fontFamily: FONT_REGULAR, color: t.ink.faint },
    kbd: { fontSize: TYPE.xs, fontFamily: FONT_REGULAR, color: t.ink.faint },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      height: CONTROL.nav,
      paddingRight: 8,
      borderRadius: RADIUS.control,
    },
    twist: { width: 14, alignItems: 'center' },
    swatch: { width: 11, height: 11, borderRadius: 3, borderWidth: StyleSheet.hairlineWidth, borderColor: 'rgba(0,0,0,0.12)' },
    label: { flex: 1, fontSize: TYPE.sm, fontFamily: FONT_REGULAR, color: t.ink.primary },
    labelOn: { fontFamily: FONT_SEMIBOLD },
    count: { fontSize: TYPE.xs, fontFamily: FONT_REGULAR, color: t.ink.faint, fontVariant: ['tabular-nums'] },
    sec: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 10, paddingTop: 14, paddingBottom: 3 },
    secLabel: { fontSize: TYPE.xs, fontFamily: FONT_SEMIBOLD, color: t.ink.faint },
    footer: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 6, paddingHorizontal: 4 },
  });
