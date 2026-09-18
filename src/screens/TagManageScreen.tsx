import { useState } from 'react';
import { useTheme, useStyles } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useDockLeave } from '../navigation/navDock';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Tag } from '../types';
import { RootStackParamList } from '../navigation';
import { useTags } from '../hooks/useTags';
import TagEditSheet from '../components/TagEditSheet';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import PlainScreenShell, { shellClear } from '../components/PlainScreenShell';
import { confirm } from '../components/surfaces/Ask';

const DANGER = '#EF4444';

const KIND_LABELS: Record<string, string> = {
  board: 'Дошки',
  file: 'Файли',
  photo: 'Фото',
  'link-video': 'Відео',
  'link-geo': 'Геоточки',
  'link-other': 'Посилання',
  document: 'Документи',
};

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
  useDockLeave('pricetag-outline', () => navigation.goBack(), isFocused);
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
      title: `Видалити тег "${tag.path}"?`,
      message: `Він буде знятий з ${count} ${count === 1 ? 'елемента' : 'елементів'}.`,
      confirmLabel: 'Видалити',
    }).then((yes) => {
      if (!yes) return;
      deleteTagCompletely(tag);
    });
  }

  return (
    <PlainScreenShell id="tagsBg">
      <Text style={[styles.subtitle, shellClear(railSide, 4)]}>
        Керування вже існуючими тегами. Створити новий тег можна лише разом із присвоєнням елементу.
      </Text>

        {!isLoading && tags.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name="pricetag-outline" size={32} color="#3B82F6" />
            </View>
            <Text style={styles.emptyLabel}>Ще немає тегів</Text>
            <Text style={styles.emptyHint}>Додайте перший тег через меню тегів на будь-якому елементі</Text>
          </View>
        ) : (
          <ScrollView contentContainerStyle={[styles.list, shellClear(railSide, 4)]}>
            {rows.map(({ tag, depth, name, hasChildren }) => (
              <View key={tag.id} style={[styles.row, { marginLeft: depth * 18 }]}>
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
                      color={theme.ink.muted}
                    />
                  )}
                </Pressable>
                <Pressable
                  style={styles.rowTap}
                  onPress={() => navigation.navigate('TagItems', { tagId: tag.id })}
                >
                  <View style={[styles.rowIcon, { backgroundColor: `${tag.color}22` }]}>
                    <Ionicons name={tag.icon as keyof typeof Ionicons.glyphMap} size={16} color={tag.color} />
                  </View>
                  <View style={styles.rowBody}>
                    {/* The tag's OWN name, not its whole path - the path is
                        what the indent says. */}
                    <Text style={styles.rowLabel} numberOfLines={1}>
                      {name}
                    </Text>
                    <Text style={styles.rowMeta} numberOfLines={1}>
                      {Object.keys(tag.usedIn).length} {Object.keys(tag.usedIn).length === 1 ? 'елемент' : 'елементів'} ·{' '}
                      {tag.types.map((t) => KIND_LABELS[t] ?? t).join(', ')}
                    </Text>
                  </View>
                </Pressable>
                <Pressable hitSlop={8} style={styles.rowAction} onPress={() => setEditingTag(tag)}>
                  <Ionicons name="pencil-outline" size={15} color={theme.ink.muted} />
                </Pressable>
                <Pressable hitSlop={8} style={styles.rowAction} onPress={() => confirmDelete(tag)}>
                  <Ionicons name="trash-outline" size={15} color={DANGER} />
                </Pressable>
              </View>
            ))}
          </ScrollView>
        )}

        <TagEditSheet
          visible={editingTag !== null}
          tag={editingTag}
          onCancel={() => setEditingTag(null)}
          onSave={(path, icon, color) => {
            if (editingTag) updateTag(editingTag, { path, icon, color });
            setEditingTag(null);
          }}
        />
    </PlainScreenShell>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
  // The twist that folds a branch; a leaf keeps the space so every
  // row's icon starts on the same line.
  twist: {
    width: 18,
    alignItems: 'center',
  },
  subtitle: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: t.ink.faint,
    paddingTop: 4,
    paddingBottom: 12,
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
    backgroundColor: '#EFF6FF',
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
    paddingBottom: 120,
    gap: 8,
  },
  // A card, like every other row in the app. Bare text over the drifting
  // backdrop could not be read - the rows were written for white.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 10,
    paddingHorizontal: 12,
    backgroundColor: 'rgba(20,20,20,0.35)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  rowTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowLabel: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  rowMeta: {
    fontSize: 11,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
    marginTop: 1,
  },
  rowAction: {
    padding: 6,
  },
  });
