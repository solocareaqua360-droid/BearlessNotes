import { useEffect, useMemo, useState } from 'react';
import { Alert, Dimensions, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { Extrapolation, interpolate, useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated';
import { arrayRemove, arrayUnion, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Tag } from '../types';

const ACCENT = '#3B82F6';
const pinnedTagsDoc = doc(db, 'settings', 'pinnedTags');
const DRAWER_WIDTH = Math.round(Dimensions.get('window').width * (2 / 3));

export type DocumentTagFilter = { type: 'tag'; tag: Tag } | { type: 'untagged' };

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
  onToggleExpand,
  onOpenTag,
}: {
  node: TreeNode;
  depth: number;
  expanded: Set<string>;
  onToggleExpand: (path: string) => void;
  onOpenTag: (tag: Tag) => void;
}) {
  const hasChildren = node.children.size > 0;
  const isExpanded = expanded.has(node.fullPath);
  const children = Array.from(node.children.values()).sort((a, b) => a.name.localeCompare(b.name));

  return (
    <View>
      <Pressable
        style={[styles.treeRow, { paddingLeft: 4 + depth * 20 }]}
        onPress={() => (node.tag ? onOpenTag(node.tag) : onToggleExpand(node.fullPath))}
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
      </Pressable>
      {hasChildren &&
        isExpanded &&
        children.map((child) => (
          <TreeRow
            key={child.fullPath}
            node={child}
            depth={depth + 1}
            expanded={expanded}
            onToggleExpand={onToggleExpand}
            onOpenTag={onOpenTag}
          />
        ))}
    </View>
  );
}

type Props = {
  tags: Tag[];
  activeFilter: DocumentTagFilter | null;
  onSelectFilter: (filter: DocumentTagFilter) => void;
};

// A left-edge drag handle (shaped like half the bottom island - see
// FloatingIslandTabBar) that pulls out a Bear-style tag sidebar, 2/3 of the
// screen wide, over a dimmed rest of the screen. Picking a tag or "Без
// тегів" sets the Documents screen's filter and closes the drawer; clearing
// the filter happens from the active-filter chip DocumentsScreen shows, not
// from here.
export default function TagsDrawer({ tags, activeFilter, onSelectFilter }: Props) {
  const [isOpen, setIsOpen] = useState(false);
  const [mode, setMode] = useState<'tree' | 'tiles'>('tree');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);
  const translateX = useSharedValue(-DRAWER_WIDTH);

  useEffect(() => {
    return onSnapshot(pinnedTagsDoc, (snapshot) => {
      setPinnedIds(snapshot.data()?.tagIds ?? []);
    });
  }, []);

  useEffect(() => {
    translateX.value = withSpring(isOpen ? 0 : -DRAWER_WIDTH, { damping: 22, stiffness: 210 });
  }, [isOpen, translateX]);

  const tree = useMemo(() => buildTree(tags), [tags]);
  const topLevel = useMemo(
    () => Array.from(tree.children.values()).sort((a, b) => a.name.localeCompare(b.name)),
    [tree]
  );
  const pinnedTags = tags.filter((t) => pinnedIds.includes(t.id));
  const unpinnedTags = tags.filter((t) => !pinnedIds.includes(t.id));

  function toggleExpand(path: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function pickTag(tag: Tag) {
    onSelectFilter({ type: 'tag', tag });
    setIsOpen(false);
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

  // Job is plain JS state (isOpen) + a shared value it feeds into
  // useAnimatedStyle - no per-frame worklet logic to protect, so this runs
  // on the JS thread directly (same call as DocumentEditorScreen's own drag
  // gesture).
  const pan = Gesture.Pan()
    .runOnJS(true)
    .onUpdate((e) => {
      const base = isOpen ? 0 : -DRAWER_WIDTH;
      translateX.value = Math.min(0, Math.max(-DRAWER_WIDTH, base + e.translationX));
    })
    .onEnd((e) => {
      const openAmount = translateX.value + DRAWER_WIDTH;
      setIsOpen(openAmount > DRAWER_WIDTH * 0.35 || e.velocityX > 400);
    });

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateX: translateX.value }] }));
  const backdropStyle = useAnimatedStyle(() => ({
    opacity: interpolate(translateX.value, [-DRAWER_WIDTH, 0], [0, 1], Extrapolation.CLAMP),
  }));

  return (
    <>
      <Animated.View style={[styles.backdrop, backdropStyle]} pointerEvents={isOpen ? 'auto' : 'none'}>
        <Pressable style={StyleSheet.absoluteFill} onPress={() => setIsOpen(false)} />
      </Animated.View>

      <Animated.View style={[styles.panel, { width: DRAWER_WIDTH }, panelStyle]}>
        <Text style={styles.title}>Теги</Text>

        <View style={styles.segmented}>
          <Pressable style={[styles.segmentButton, mode === 'tree' && styles.segmentButtonActive]} onPress={() => setMode('tree')}>
            <Text style={[styles.segmentLabel, mode === 'tree' && styles.segmentLabelActive]}>Дерево</Text>
          </Pressable>
          <Pressable style={[styles.segmentButton, mode === 'tiles' && styles.segmentButtonActive]} onPress={() => setMode('tiles')}>
            <Text style={[styles.segmentLabel, mode === 'tiles' && styles.segmentLabelActive]}>Плитки</Text>
          </Pressable>
        </View>

        <Pressable
          style={[styles.untaggedRow, activeFilter?.type === 'untagged' && styles.untaggedRowActive]}
          onPress={() => {
            onSelectFilter({ type: 'untagged' });
            setIsOpen(false);
          }}
        >
          <View style={styles.treeIcon}>
            <Ionicons name="pricetag-outline" size={12} color="#9CA3AF" />
          </View>
          <Text style={styles.untaggedLabel}>Без тегів</Text>
        </Pressable>
        <View style={styles.divider} />

        {mode === 'tree' ? (
          <ScrollView style={styles.scroll}>
            {topLevel.map((node) => (
              <TreeRow key={node.fullPath} node={node} depth={0} expanded={expanded} onToggleExpand={toggleExpand} onOpenTag={pickTag} />
            ))}
          </ScrollView>
        ) : (
          <ScrollView contentContainerStyle={styles.tileGrid}>
            {pinnedTags.map((tag) => (
              <Pressable key={tag.id} style={styles.tile} onPress={() => pickTag(tag)} onLongPress={() => confirmUnpin(tag)}>
                <View style={[styles.tileIcon, { backgroundColor: `${tag.color}1A` }]}>
                  <Ionicons name={tag.icon as keyof typeof Ionicons.glyphMap} size={16} color={tag.color} />
                </View>
                <Text style={styles.tileLabel} numberOfLines={1}>
                  {tag.path}
                </Text>
              </Pressable>
            ))}
            <Pressable style={[styles.tile, styles.newTile]} onPress={() => setPickerVisible(true)}>
              <View style={styles.newTileIcon}>
                <Ionicons name="add" size={16} color="#9CA3AF" />
              </View>
              <Text style={styles.newTileLabel}>Додати</Text>
            </Pressable>
          </ScrollView>
        )}
      </Animated.View>

      <GestureDetector gesture={pan}>
        <View style={styles.tab}>
          <Ionicons name="pricetag-outline" size={15} color="#fff" />
        </View>
      </GestureDetector>

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
    width: '47%',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    padding: 10,
    gap: 6,
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
  tab: {
    position: 'absolute',
    left: 0,
    bottom: 24,
    width: 34,
    height: 64,
    backgroundColor: ACCENT,
    borderTopRightRadius: 32,
    borderBottomRightRadius: 32,
    alignItems: 'flex-start',
    justifyContent: 'center',
    paddingLeft: 7,
    shadowColor: ACCENT,
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 2, height: 0 },
    elevation: 5,
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
