import { useEffect, useMemo, useState } from 'react';
import { Alert, Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { arrayRemove, arrayUnion, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Tag } from '../types';

const ACCENT = '#3B82F6';
const pinnedTagsDoc = doc(db, 'settings', 'pinnedTags');
const DRAWER_WIDTH = Math.round(Dimensions.get('window').width * (2 / 3));
// Matches FloatingIslandTabBar's own height (8px padding + 48px buttons) -
// the open button is a standalone circle the same size as the island.
const OPEN_BUTTON_SIZE = 64;

// 'multi' shows anything with at least one of the selected tags (OR);
// 'isolating' shows only items carrying every selected tag (AND).
export type TagFilterMode = 'multi' | 'isolating';

export type TagFilter = { type: 'tags'; tagIds: string[]; mode: TagFilterMode } | { type: 'untagged' };

// Single source of truth for what a tag filter actually matches, shared by
// every screen that filters its own list against a TagsDrawer selection.
export function matchesTagFilter(itemTagIds: string[], filter: TagFilter | null): boolean {
  if (!filter) return true;
  if (filter.type === 'untagged') return itemTagIds.length === 0;
  return filter.mode === 'isolating'
    ? filter.tagIds.every((id) => itemTagIds.includes(id))
    : filter.tagIds.some((id) => itemTagIds.includes(id));
}

// Used by each per-tag chip's own "x" - drops just that one tag out of the
// filter instead of clearing the whole selection.
export function removeTagFromFilter(filter: TagFilter, tagId: string): TagFilter | null {
  if (filter.type !== 'tags') return null;
  const remaining = filter.tagIds.filter((id) => id !== tagId);
  return remaining.length === 0 ? null : { type: 'tags', tagIds: remaining, mode: filter.mode };
}

type TreeNode = {
  name: string;
  fullPath: string;
  tag?: Tag;
  children: Map<string, TreeNode>;
};

function buildTree(tags: Tag[]): TreeNode {
  const root: TreeNode = { name: '', fullPath: '', children: new Map() };
  for (const tag of tags) {
    const parts = tag.path.split('/').filter((p) => p.trim() !== '');
    let node = root;
    let acc = '';
    parts.forEach((part, i) => {
      acc = acc ? `${acc}/${part}` : part;
      let child = node.children.get(part);
      if (!child) {
        child = { name: part, fullPath: acc, children: new Map() };
        node.children.set(part, child);
      }
      node = child;
      if (i === parts.length - 1) node.tag = tag;
    });
  }
  return root;
}

function TreeRow({
  node,
  depth,
  expanded,
  selectedIds,
  onToggleExpand,
  onToggleTag,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  selectedIds: Set<string>;
  onToggleExpand: (path: string) => void;
  onToggleTag: (tag: Tag) => void;
}) {
  const hasChildren = node.children.size > 0;
  const isExpanded = expanded.has(node.fullPath);
  const isSelected = !!node.tag && selectedIds.has(node.tag.id);
  const children = Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <View>
      <Pressable
        style={[styles.treeRow, isSelected && styles.treeRowActive, { paddingLeft: 4 + depth * 20 }]}
        onPress={() => (node.tag ? onToggleTag(node.tag) : onToggleExpand(node.fullPath))}
      >
        {hasChildren ? (
          <Pressable hitSlop={8} onPress={() => onToggleExpand(node.fullPath)}>
            <Ionicons name={isExpanded ? 'chevron-down' : 'chevron-forward'} size={13} color="#9CA3AF" />
          </Pressable>
        ) : (
          <View style={{ width: 13 }} />
        )}
        {node.tag ? (
          <View style={[styles.treeIcon, { backgroundColor: `${node.tag.color}1A` }]}>
            <Ionicons name={node.tag.icon as keyof typeof Ionicons.glyphMap} size={12} color={node.tag.color} />
          </View>
        ) : (
          <View style={styles.treeIcon}>
            <Ionicons name="folder-outline" size={12} color="#9CA3AF" />
          </View>
        )}
        <Text style={styles.treeLabel} numberOfLines={1}>
          {node.name}
        </Text>
        {isSelected && <Ionicons name="checkmark" size={16} color={ACCENT} />}
      </Pressable>
      {hasChildren &&
        isExpanded &&
        children.map((child) => (
          <TreeRow
            key={child.fullPath}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            selectedIds={selectedIds}
            onToggleExpand={onToggleExpand}
            onToggleTag={onToggleTag}
          />
        ))}
    </View>
  );
}

type Props = {
  tags: Tag[];
  activeFilter: TagFilter | null;
  onSelectFilter: (filter: TagFilter | null) => void;
  // Files/Photos/Links show the same round button in the same corner, but
  // it has to get out of the way while their own bulk-select bar is on
  // screen (same bottom-left corner, would otherwise overlap it).
  hideOpenButton?: boolean;
  // Files/Photos/Links: skip the tree and the pin-a-tile picker entirely -
  // `tags` is already the exact (small) set the screen wants offered, so
  // it's shown as one flat tile grid with nothing else to browse.
  simple?: boolean;
};

// A standalone round button at the bottom-left (same size as the floating
// island, styled to match it) opens a Bear-style tag sidebar, 2/3 of the
// screen wide, over a dimmed rest of the screen. Tapping a tag (or "Без
// тегів") toggles it into the calling screen's filter without closing the
// drawer, so more than one can be picked; closing happens by tapping the
// dimmed backdrop. The Мульти/Ізолюючий switch decides how multiple picked
// tags combine: Мульти = at least one matches (OR), Ізолюючий = every
// picked tag must be present (AND). Shared as-is across Documents/
// Calendar/Files/Photos/Links - it only ever browses and toggles from
// whatever `tags` list it's given.
export default function TagsDrawer({ tags, activeFilter, onSelectFilter, hideOpenButton, simple }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  // The backdrop+panel live inside a real Modal (a separate Android window,
  // always painted above the whole activity - including the floating
  // island, which sits in an entirely different branch of the component
  // tree from this drawer and so could never be out-stacked by elevation/
  // zIndex alone, no matter how high). Kept mounted a beat after isOpen
  // flips false so the closing animation below gets to finish before the
  // Modal actually unmounts, instead of yanking the drawer away instantly.
  const [isRendered, setIsRendered] = useState(false);
  const [viewMode, setViewMode] = useState<'tree' | 'tiles'>('tree');
  const [filterMode, setFilterMode] = useState<TagFilterMode>('multi');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);
  // How far open the panel is, 0 (closed) .. DRAWER_WIDTH (fully open).
  // Kept separate from the backdrop's own dim-in below - the panel itself
  // snaps out quickly (a spring here read as "wobbling like a boat", so a
  // plain eased slide replaces it), while the dimming behind it fades in
  // more gradually, like the background slowly dropping out of focus.
  // (A real blur was tried here too - expo-blur's Android blur view - but
  // the native module bundled in Expo Go didn't match the JS package's
  // version and crashed the app outright, so this stays a plain dim.)
  const openAmount = useSharedValue(0);
  const dimAmount = useSharedValue(0);

  useEffect(() => {
    return onSnapshot(pinnedTagsDoc, (snapshot) => {
      setPinnedIds(snapshot.data()?.tagIds ?? []);
    });
  }, []);

  useEffect(() => {
    if (isOpen) setIsRendered(true);
    openAmount.value = withTiming(isOpen ? DRAWER_WIDTH : 0, {
      duration: 260,
      easing: Easing.out(Easing.cubic),
    });
    dimAmount.value = withTiming(isOpen ? 1 : 0, {
      duration: isOpen ? 520 : 260,
      easing: Easing.out(Easing.quad),
    });
    if (!isOpen) {
      const timeout = setTimeout(() => setIsRendered(false), 260);
      return () => clearTimeout(timeout);
    }
  }, [isOpen, openAmount, dimAmount]);

  const tree = useMemo(() => buildTree(tags), [tags]);
  const topLevel = useMemo(
    () => Array.from(tree.children.values()).sort((a, b) => a.name.localeCompare(b.name)),
    [tree]
  );
  const pinnedTags = tags.filter((t) => pinnedIds.includes(t.id));
  const unpinnedTags = tags.filter((t) => !pinnedIds.includes(t.id));
  const selectedTagIds = activeFilter?.type === 'tags' ? new Set(activeFilter.tagIds) : new Set<string>();

  function toggleExpand(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function toggleTag(tag: Tag) {
    const next = new Set(selectedTagIds);
    if (next.has(tag.id)) next.delete(tag.id);
    else next.add(tag.id);
    onSelectFilter(next.size === 0 ? null : { type: 'tags', tagIds: Array.from(next), mode: filterMode });
  }

  function toggleUntagged() {
    onSelectFilter(activeFilter?.type === 'untagged' ? null : { type: 'untagged' });
  }

  function selectFilterMode(next: TagFilterMode) {
    setFilterMode(next);
    if (activeFilter?.type === 'tags') {
      onSelectFilter({ type: 'tags', tagIds: activeFilter.tagIds, mode: next });
    }
  }

  async function pinTag(tag: Tag) {
    setPickerVisible(false);
    await setDoc(pinnedTagsDoc, { tagIds: arrayUnion(tag.id) }, { merge: true });
  }

  function confirmUnpin(tag: Tag) {
    Alert.alert(`Прибрати "${tag.path}" з плиток?`, undefined, [
      { text: 'Скасувати', style: 'cancel' },
      {
        text: 'Прибрати',
        style: 'destructive',
        onPress: () => setDoc(pinnedTagsDoc, { tagIds: arrayRemove(tag.id) }, { merge: true }),
      },
    ]);
  }

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: openAmount.value - DRAWER_WIDTH }] }));
  const backdropStyle = useAnimatedStyle(() => ({ opacity: dimAmount.value }));

  function renderTile(tag: Tag, onLongPress?: () => void) {
    const isSelected = selectedTagIds.has(tag.id);
    return (
      <Pressable
        key={tag.id}
        style={[styles.tile, isSelected && styles.tileActive]}
        onPress={() => toggleTag(tag)}
        onLongPress={onLongPress}
      >
        <View style={[styles.tileIcon, { backgroundColor: `${tag.color}1A` }]}>
          <Ionicons name={tag.icon as keyof typeof Ionicons.glyphMap} size={16} color={tag.color} />
        </View>
        <Text style={styles.tileLabel} numberOfLines={1}>
          {tag.path}
        </Text>
        {isSelected && <Ionicons name="checkmark-circle" size={14} color={ACCENT} style={styles.tileCheck} />}
      </Pressable>
    );
  }

  return (
    <>
      <Modal
        visible={isRendered}
        transparent
        animationType="none"
        statusBarTranslucent
        onRequestClose={() => setIsOpen(false)}
      >
        <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents={isOpen ? 'auto' : 'none'}>
          <Pressable style={StyleSheet.absoluteFill} onPress={() => setIsOpen(false)} />
        </Animated.View>

        <Animated.View style={[styles.panel, { width: DRAWER_WIDTH }, panelStyle]}>
        <Text style={styles.title}>Теги</Text>

        {!simple && (
          <View style={styles.segmented}>
            <Pressable
              style={[styles.segmentButton, viewMode === 'tree' && styles.segmentButtonActive]}
              onPress={() => setViewMode('tree')}
            >
              <Text style={[styles.segmentLabel, viewMode === 'tree' && styles.segmentLabelActive]}>Дерево</Text>
            </Pressable>
            <Pressable
              style={[styles.segmentButton, viewMode === 'tiles' && styles.segmentButtonActive]}
              onPress={() => setViewMode('tiles')}
            >
              <Text style={[styles.segmentLabel, viewMode === 'tiles' && styles.segmentLabelActive]}>Плитки</Text>
            </Pressable>
          </View>
        )}

        <View style={styles.segmented}>
          <Pressable
            style={[styles.segmentButton, filterMode === 'multi' && styles.segmentButtonActive]}
            onPress={() => selectFilterMode('multi')}
          >
            <Text style={[styles.segmentLabel, filterMode === 'multi' && styles.segmentLabelActive]}>Мульти</Text>
          </Pressable>
          <Pressable
            style={[styles.segmentButton, filterMode === 'isolating' && styles.segmentButtonActive]}
            onPress={() => selectFilterMode('isolating')}
          >
            <Text style={[styles.segmentLabel, filterMode === 'isolating' && styles.segmentLabelActive]}>
              Ізолюючий
            </Text>
          </Pressable>
        </View>

        <Pressable
          style={[styles.untaggedRow, activeFilter?.type === 'untagged' && styles.untaggedRowActive]}
          onPress={toggleUntagged}
        >
          <View style={styles.treeIcon}>
            <Ionicons name="pricetag-outline" size={12} color="#9CA3AF" />
          </View>
          <Text style={styles.untaggedLabel}>Без тегів</Text>
        </Pressable>
        <View style={styles.divider} />

        {simple ? (
          <ScrollView contentContainerStyle={styles.tileGrid}>
            {tags.map((tag) => renderTile(tag))}
          </ScrollView>
        ) : viewMode === 'tree' ? (
          <ScrollView style={styles.scroll}>
            {topLevel.map((node) => (
              <TreeRow
                key={node.fullPath}
                node={node}
                depth={0}
                expanded={expanded}
                selectedIds={selectedTagIds}
                onToggleExpand={toggleExpand}
                onToggleTag={toggleTag}
              />
            ))}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.tileGrid}>
            {pinnedTags.map((tag) => renderTile(tag, () => confirmUnpin(tag)))}
            <Pressable style={[styles.tile, styles.newTile]} onPress={() => setPickerVisible(true)}>
              <View style={styles.newTileIcon}>
                <Ionicons name="add" size={16} color="#9CA3AF" />
              </View>
              <Text style={styles.newTileLabel}>Додати</Text>
            </Pressable>
          </ScrollView>
        )}
        </Animated.View>
      </Modal>

      {!isOpen && !hideOpenButton && (
        <Pressable style={styles.openButton} onPress={() => setIsOpen(true)}>
          <Text style={styles.openButtonHash}>#</Text>
        </Pressable>
      )}

      <Modal visible={pickerVisible} transparent animationType="fade" onRequestClose={() => setPickerVisible(false)}>
        <Pressable style={styles.pickerBackdrop} onPress={() => setPickerVisible(false)}>
          <Pressable style={styles.pickerSheet} onPress={() => {}}>
            <View style={styles.pickerHandle} />
            <Text style={styles.title}>Додати плитку</Text>
            <ScrollView style={styles.pickerList}>
              {unpinnedTags.map((tag) => (
                <Pressable key={tag.id} style={styles.pickerRow} onPress={() => pinTag(tag)}>
                  <View style={[styles.treeIcon, { backgroundColor: `${tag.color}1A` }]}>
                    <Ionicons name={tag.icon as keyof typeof Ionicons.glyphMap} size={12} color={tag.color} />
                  </View>
                  <Text style={styles.treeLabel}>{tag.path}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(17,24,39,0.35)',
  },
  panel: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: '#fff',
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 20,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 4, height: 0 },
    elevation: 8,
  },
  title: {
    fontSize: 19,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 12,
  },
  segmented: {
    flexDirection: 'row',
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    padding: 3,
    marginBottom: 12,
  },
  segmentButton: {
    flex: 1,
    paddingVertical: 7,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
  },
  segmentButtonActive: {
    backgroundColor: ACCENT,
  },
  segmentLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
  },
  segmentLabelActive: {
    color: '#fff',
  },
  untaggedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingHorizontal: 4,
    borderRadius: 8,
  },
  untaggedRowActive: {
    backgroundColor: '#EFF6FF',
  },
  untaggedLabel: {
    fontSize: 14,
    color: '#6B7280',
  },
  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 6,
  },
  scroll: {
    flex: 1,
  },
  treeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingRight: 4,
  },
  treeRowActive: {
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
  },
  treeIcon: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  treeLabel: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  tile: {
    position: 'relative',
    width: '47%',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 10,
    gap: 6,
  },
  tileActive: {
    backgroundColor: '#EFF6FF',
    borderWidth: 1.5,
    borderColor: ACCENT,
  },
  tileCheck: {
    position: 'absolute',
    top: 8,
    right: 8,
  },
  tileIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#111827',
  },
  newTile: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#D1D5DB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newTileIcon: {
    width: 30,
    height: 30,
    borderRadius: 9,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newTileLabel: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  openButton: {
    position: 'absolute',
    // Same size and bottom offset as the island, standing on its own to
    // its left (see the videobookmark reference) - a plain tap, no more
    // drag: dragging from the screen's edge was exactly where Android's
    // own edge-back gesture kept stealing the touch stream mid-swipe.
    left: 20,
    bottom: 24,
    width: OPEN_BUTTON_SIZE,
    height: OPEN_BUTTON_SIZE,
    borderRadius: OPEN_BUTTON_SIZE / 2,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  openButtonHash: {
    fontSize: 26,
    fontWeight: '700',
    color: ACCENT,
  },
  pickerBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  pickerSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: '70%',
  },
  pickerHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  pickerList: {
    maxHeight: 320,
  },
  pickerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
  },
});
