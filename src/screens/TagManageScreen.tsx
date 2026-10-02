import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import FoldersCanvas from '../components/FoldersCanvas';
import { useTheme, useStyles } from '../theme/ThemeProvider';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSoft, softCardFrame } from '../theme/soft';
import ScreenGround from '../components/ScreenGround';
import ContentColumn from '../components/ContentColumn';
import TopNavBar, { TOP_NAV_SPACE, useTopNavOn } from '../components/TopNavBar';
import { useDockClearance } from '../navigation/dockGeometry';
import type { Theme } from '../theme/tokens';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '../components/icons/Ionicons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useChromeStyle, useDockBeads, useDockLeave, useTopBack, useTopExtras, useTopSearch } from '../navigation/navDock';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Tag } from '../types';
import { RootStackParamList } from '../navigation';
import { itemsCollectionForKind, parseUsedInKey, useTags } from '../hooks/useTags';
import { useFolderBases } from '../hooks/useFolderBases';
import FolderTree, { type FolderRect } from '../components/FolderTree';
import HoldMenu, { type HoldAction } from '../components/HoldMenu';
import { doc, updateDoc } from '../firestore';
import { db } from '../firebase';
import TagEditSheet from '../components/TagEditSheet';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { TAG_KIND_LABELS as KIND_LABELS } from '../constants/tagKinds';
import { ask, confirm } from '../components/surfaces/Ask';

const DANGER = '#EF4444';


// Edit/delete-only, per the design decision this app settled on: a tag can
// only be CREATED alongside a first assignment (see TagPicker), so there's
// no "+" here - this screen just lists every tag that already exists.
// Sorted flat by path (the hook already orders by it) rather than grouped
// into a visual tree - the tree view belongs to Search's browsing mode, not
// duplicated here.
export default function TagManageScreen({ inPane }: { inPane?: boolean } = {}) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { tags, isLoading, updateTag, deleteTagCompletely, renameTag } = useTags();
  const bases = useFolderBases();
  const railSide = inPane ? ('left' as const) : ('right' as const);
  const isFocused = useIsFocused();
  useDockLeave('folder-outline', () => navigation.goBack(), isFocused);
  // THE SOFT CHROME (2026-10-02: the folders "не переживали змін вже
  // давно" - an old dark list under an empty dock plaque). The bar with
  // the way back and the name, the dock's left bead searching the
  // folders, the soft ground under all of it - as every other screen.
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const topNavOn = useTopNavOn();
  const dockClear = useDockClearance();
  useChromeStyle('soft', isFocused);
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const closeSearch = () => {
    setQuery('');
    setSearching(false);
  };
  useTopBack(searching ? closeSearch : () => navigation.goBack(), isFocused);
  useTopSearch(
    searching ? { placeholder: 'Пошук папок', initialQuery: query, onChangeQuery: setQuery, onClose: closeSearch } : null,
    isFocused
  );
  // THE TABLE OR THE LIST (the folders rework, step 1): the folders as
  // one canvas of everything in them, from every database - the way in by
  // default - or the tree as a list, for renaming and deleting. The
  // dock's right bead switches; the choice is remembered.
  const [view, setView] = useState<'canvas' | 'list'>('canvas');
  useEffect(() => {
    AsyncStorage.getItem('foldersView')
      .then((stored) => {
        if (stored === 'list' || stored === 'canvas') setView(stored);
      })
      .catch(() => {});
  }, []);
  const switchView = () => {
    const next = view === 'canvas' ? 'list' : 'canvas';
    setView(next);
    setLinksOpen(false);
    closeSearch();
    AsyncStorage.setItem('foldersView', next).catch(() => {});
  };
  // On the canvas the left bead is the databases' own: their circles rise
  // out of it with the lines to their folders (FolderBaseLinks).
  const [linksOpen, setLinksOpen] = useState(false);
  // The bar's "⋯": put every folder back in its column.
  const [resetFolders, setResetFolders] = useState(0);
  useTopExtras(
    view === 'canvas'
      ? [{ label: 'Упорядкувати папки', icon: 'reorder-four-outline', onPress: () => setResetFolders((n) => n + 1) }]
      : null,
    null,
    isFocused
  );
  useDockBeads(
    isFocused && view === 'list'
      ? { icon: searching ? 'close-outline' : 'search-outline', active: searching, onPress: () => (searching ? closeSearch() : setSearching(true)) }
      : isFocused
        ? // Not `active`: an active left bead is the soft dock's open search
          // field - it read «Закрити пошук» (2026-10-02).
          { icon: linksOpen ? 'close' : 'git-network-outline', onPress: () => setLinksOpen((v) => !v) }
        : null,
    isFocused ? { icon: view === 'canvas' ? 'reorder-four-outline' : 'easel-outline', onPress: switchView } : null
  );
  // A tag's path IS the tree - "робота/оренда" is the folder "робота"
  // holding "оренда" - and this screen drew them as a flat list of full
  // paths, which threw the whole structure away. Rows are laid out in
  // path order with their depth, so the tree reads as a tree; a branch
  // can be folded shut, and a fold hides everything under it.
  const [folded, setFolded] = useState<Set<string>>(new Set());
  const sorted = [...tags].sort((a, b) => a.path.localeCompare(b.path));
  const rows = sorted
    .map((tag) => {
      const parts = tag.path.split('/');
      return { tag, depth: parts.length - 1, name: parts[parts.length - 1] };
    })
    // A tag whose own path has no children is a leaf; anything that is a
    // prefix of another path can be folded.
    .map((row) => ({
      ...row,
      hasChildren: sorted.some((other) => other.path.startsWith(`${row.tag.path}/`)),
    }))
    .filter((row) => {
      // Searching: every folder whose name matches, wherever it is in
      // the tree, folds or not.
      if (query.trim()) return row.name.toLowerCase().includes(query.trim().toLowerCase());
      for (const shut of folded) {
        if (row.tag.path.startsWith(`${shut}/`)) return false;
      }
      return true;
    });

  function toggleFold(path: string) {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }
  const [editingTag, setEditingTag] = useState<Tag | null>(null);

  // DELETING A FOLDER (the user's, 2026-10-02): it asks first; with
  // something inside, it asks what becomes of that - deleted too (into
  // each database's bin, where it has one), or out to the top level - or
  // nothing at all. The folders inside it move up a level, as the
  // explorer's own delete does.
  const BIN_COLLECTIONS = ['documents', 'photos', 'files', 'links'];
  async function removeFolder(tag: Tag) {
    const parent = tag.path.includes('/') ? tag.path.slice(0, tag.path.lastIndexOf('/')) : '';
    const below = tags.filter((t) => t.path.startsWith(`${tag.path}/`));
    await Promise.all(
      below.map((t) => {
        const rest = t.path.slice(tag.path.length + 1);
        return renameTag(t, parent ? `${parent}/${rest}` : rest);
      })
    );
    await deleteTagCompletely(tag);
  }
  async function deleteFolder(tag: Tag) {
    const inside = Object.keys(tag.usedIn);
    const name = tag.path.split('/').pop();
    if (inside.length === 0) {
      const yes = await confirm({ title: `Видалити папку «${name}»?`, confirmLabel: 'Видалити' });
      if (yes) await removeFolder(tag);
      return;
    }
    const choice = await ask({
      title: `Видалити папку «${name}»?`,
      message: `У ній ${inside.length} ${inside.length === 1 ? 'елемент' : 'елементів'}.`,
      actions: [
        { id: 'root', label: 'Папку - вміст у корінь', icon: 'arrow-undo-outline' },
        { id: 'trash', label: 'Папку разом із вмістом', icon: 'trash-outline', tone: 'danger' },
      ],
    });
    if (choice === 'trash') {
      const now = Date.now();
      await Promise.all(
        inside.map((key) => {
          const { kind, itemId } = parseUsedInKey(key);
          const collection = itemsCollectionForKind(kind);
          return collection && BIN_COLLECTIONS.includes(collection)
            ? updateDoc(doc(db, collection, itemId), { deletedAt: now }).catch(() => {})
            : Promise.resolve();
        })
      );
      await removeFolder(tag);
    } else if (choice === 'root') {
      await removeFolder(tag);
    }
  }

  // A FOLDER HELD - in the list or on the canvas, the same menu (HoldMenu).
  const [menuFor, setMenuFor] = useState<{ tagId: string; rect: FolderRect } | null>(null);
  const [focusFolder, setFocusFolder] = useState<{ path: string; n: number } | null>(null);
  const menuTag = menuFor ? tags.find((t) => t.id === menuFor.tagId) ?? null : null;
  const menuActions: HoldAction[] = menuTag
    ? [
        { key: 'edit', label: 'Редагувати', icon: 'pencil-outline', onPress: () => setEditingTag(menuTag) },
        {
          key: 'canvas',
          label: 'Показати на полотні',
          icon: 'easel-outline',
          onPress: () => {
            if (view !== 'canvas') {
              setView('canvas');
              AsyncStorage.setItem('foldersView', 'canvas').catch(() => {});
            }
            setFocusFolder((f) => ({ path: menuTag.path, n: (f?.n ?? 0) + 1 }));
          },
        },
        {
          key: 'bases',
          label: 'Додати в інші бази',
          icon: 'git-network-outline',
          page: {
            title: 'Бази',
            options: bases.map((b) => {
              const count = Object.keys(menuTag.usedIn).filter((k) => k.startsWith(`${b.kind}:`)).length;
              return {
                key: b.kind,
                label: b.label,
                icon: b.icon,
                color: b.color,
                on: menuTag.types.includes(b.kind),
                // Something of that base is inside: it stays on (see the lines).
                locked: count > 0 ? String(count) : undefined,
              };
            }),
            onToggle: (kind: string) => {
              const types = menuTag.types.includes(kind) ? menuTag.types.filter((k) => k !== kind) : [...menuTag.types, kind];
              updateTag(menuTag, { path: menuTag.path, icon: menuTag.icon, color: menuTag.color, types }).catch(() => {});
            },
          },
        },
        { key: 'delete', label: 'Видалити', icon: 'trash-outline', tone: 'danger', onPress: () => deleteFolder(menuTag) },
      ]
    : [];
  const openFolderMenu = (tag: Tag, rect: FolderRect) => setMenuFor({ tagId: tag.id, rect });

  return (
    <View style={styles.container}>
      <ScreenGround color={S.bg} />
      {isFocused && topNavOn && <TopNavBar title={{ icon: 'folder-outline', label: 'Папки' }} />}
      {view === 'canvas' ? (
        <FoldersCanvas
          topPad={insets.top + (topNavOn ? TOP_NAV_SPACE : 12)}
          linksOpen={linksOpen}
          resetFolders={resetFolders}
          focusFolder={focusFolder}
          onFolderMenu={(path, rect) => {
            const tag = tags.find((t) => t.path === path);
            if (tag) openFolderMenu(tag, rect);
          }}
        />
      ) : (
      <ContentColumn>
      <View style={{ height: insets.top + (topNavOn ? TOP_NAV_SPACE : 12) }} />
      <Text style={[styles.subtitle, { color: S.ink3 }]}>
        Нова папка з'являється разом із першим елементом у ній.
      </Text>

        {!isLoading && tags.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="folder-outline" size={32} color="#3B82F6" />
            </View>
            <Text style={styles.emptyLabel}>Ще немає папок</Text>
            <Text style={styles.emptyHint}>Додайте першу папку через меню папок на будь-якому елементі</Text>
          </View>
        ) : (
          <ScrollView>
            <FolderTree
              tags={tags}
              bases={bases}
              query={query}
              bottomPad={dockClear + 24}
              onOpen={(tag) => navigation.navigate('TagItems', { tagId: tag.id })}
              onHold={(tag, rect) => openFolderMenu(tag, rect)}
            />
          </ScrollView>
        )}

      </ContentColumn>
      )}
        <TagEditSheet
          visible={editingTag !== null}
          tag={editingTag}
          onCancel={() => setEditingTag(null)}
          onSave={(path, icon, color, types) => {
            if (editingTag) updateTag(editingTag, { path, icon, color, types });
            setEditingTag(null);
          }}
        />
      <HoldMenu
        anchor={menuFor?.rect ?? null}
        card={
          menuTag ? (
            <View style={[styles.menuCard, { backgroundColor: S.card }]}>
              <View style={[styles.rowIcon, { backgroundColor: S.fill }]}>
                <Ionicons name={menuTag.icon as never} size={20} color={menuTag.color} />
              </View>
              <Text style={[styles.rowLabel, { color: S.ink }]} numberOfLines={1}>
                {menuTag.path.split('/').pop()}
              </Text>
            </View>
          ) : null
        }
        actions={menuActions}
        onClose={() => setMenuFor(null)}
      />
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
  container: {
    flex: 1,
  },
  // The folder lifted over the blur while its menu is open.
  menuCard: {
    minHeight: 48,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
  },
  // The twist that folds a branch; a leaf keeps the space so every
  // row's icon starts on the same line.
  twist: {
    width: 18,
    alignItems: 'center',
  },
  subtitle: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    paddingHorizontal: 24,
    paddingTop: 8,
    paddingBottom: 14,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: t.selected,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyLabel: {
    marginTop: 16,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
    textAlign: 'center',
  },
  emptyHint: {
    marginTop: 6,
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
    textAlign: 'center',
  },
  list: {
    paddingHorizontal: 20,
    gap: 10,
  },
  // A card, like every other row in the app. Bare text over the drifting
  // backdrop could not be read - the rows were written for white.
  // A card as a folder is one in the documents' own list: white, round,
  // lifted by its shadow alone (softCardFrame).
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 14,
    paddingHorizontal: 14,
  },
  rowTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowIcon: {
    width: 44,
    height: 44,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontSize: 17,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  rowMeta: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    marginTop: 2,
  },
  rowAction: {
    padding: 8,
  },
  });
