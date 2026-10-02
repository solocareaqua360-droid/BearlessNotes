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
import { useChromeStyle, useDockBeads, useDockLeave, useTopBack, useTopSearch } from '../navigation/navDock';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Tag } from '../types';
import { RootStackParamList } from '../navigation';
import { useTags } from '../hooks/useTags';
import TagEditSheet from '../components/TagEditSheet';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { TAG_KIND_LABELS as KIND_LABELS } from '../constants/tagKinds';
import { confirm } from '../components/surfaces/Ask';

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
  const { tags, isLoading, updateTag, deleteTagCompletely } = useTags();
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

  function confirmDelete(tag: Tag) {
    const count = Object.keys(tag.usedIn).length;
    confirm({
      title: `Видалити папку "${tag.path}"?`,
      message: `Її буде знято з ${count} ${count === 1 ? 'елемента' : 'елементів'}.`,
      confirmLabel: 'Видалити',
    }).then((yes) => {
      if (!yes) return;
      deleteTagCompletely(tag);
    });
  }

  return (
    <View style={styles.container}>
      <ScreenGround color={S.bg} />
      {isFocused && topNavOn && <TopNavBar title={{ icon: 'folder-outline', label: 'Папки' }} />}
      {view === 'canvas' ? (
        <FoldersCanvas topPad={insets.top + (topNavOn ? TOP_NAV_SPACE : 12)} linksOpen={linksOpen} />
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
          <ScrollView contentContainerStyle={[styles.list, { paddingBottom: dockClear + 24 }]}>
            {rows.map(({ tag, depth, name, hasChildren }) => (
              <View
                key={tag.id}
                style={[styles.row, softCardFrame(S), { backgroundColor: S.card, marginLeft: depth * 18 }]}
              >
                {/* The twist that folds a branch. A leaf keeps the space,
                    so every row's icon starts on the same line. */}
                <Pressable
                  hitSlop={6}
                  style={styles.twist}
                  disabled={!hasChildren}
                  onPress={() => toggleFold(tag.path)}
                >
                  {hasChildren && (
                    <Ionicons
                      name={folded.has(tag.path) ? 'chevron-forward' : 'chevron-down'}
                      size={14}
                      color={S.ink3}
                    />
                  )}
                </Pressable>
                <Pressable
                  style={styles.rowTap}
                  onPress={() => navigation.navigate('TagItems', { tagId: tag.id })}
                >
                  <View style={[styles.rowIcon, { backgroundColor: S.fill }]}>
                    <Ionicons name={tag.icon as keyof typeof Ionicons.glyphMap} size={20} color={tag.color} />
                  </View>
                  <View style={styles.rowBody}>
                    {/* The tag's OWN name, not its whole path - the path is
                        what the indent says. */}
                    <Text style={[styles.rowLabel, { color: S.ink }]} numberOfLines={1}>
                      {name}
                    </Text>
                    <Text style={[styles.rowMeta, { color: S.ink2 }]} numberOfLines={1}>
                      {Object.keys(tag.usedIn).length} {Object.keys(tag.usedIn).length === 1 ? 'елемент' : 'елементів'} ·{' '}
                      {tag.types.map((t) => KIND_LABELS[t] ?? 'База').join(', ')}
                    </Text>
                  </View>
                </Pressable>
                <Pressable hitSlop={8} style={styles.rowAction} onPress={() => setEditingTag(tag)}>
                  <Ionicons name="pencil-outline" size={18} color={S.ink2} />
                </Pressable>
                <Pressable hitSlop={8} style={styles.rowAction} onPress={() => confirmDelete(tag)}>
                  <Ionicons name="trash-outline" size={18} color={DANGER} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
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
      </ContentColumn>
      )}
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
  container: {
    flex: 1,
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
