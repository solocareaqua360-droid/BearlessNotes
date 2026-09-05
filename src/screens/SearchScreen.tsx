import { useEffect, useMemo, useState } from 'react';
import { Alert, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { arrayRemove, arrayUnion, doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { RootStackParamList } from '../navigation';
import { Tag } from '../types';
import { useTags } from '../hooks/useTags';

const ACCENT = '#3B82F6';
const pinnedTagsDoc = doc(db, 'settings', 'pinnedTags');

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
        style={[styles.treeRow, { paddingLeft: 12 + depth * 22 }]}
        onPress={() => (node.tag ? onOpenTag(node.tag) : onToggleExpand(node.fullPath))}
      >
        {hasChildren ? (
          <Pressable hitSlop={8} onPress={() => onToggleExpand(node.fullPath)}>
            <Ionicons name={isExpanded ? 'chevron-down' : 'chevron-forward'} size={14} color="#9CA3AF" />
          </Pressable>
        ) : (
          <View style={{ width: 14 }} />
        )}
        {node.tag ? (
          <View style={[styles.treeIcon, { backgroundColor: `${node.tag.color}1A` }]}>
            <Ionicons name={node.tag.icon as keyof typeof Ionicons.glyphMap} size={13} color={node.tag.color} />
          </View>
        ) : (
          <View style={styles.treeIcon}>
            <Ionicons name="folder-outline" size={13} color="#9CA3AF" />
          </View>
        )}
        <Text style={styles.treeLabel}>{node.name}</Text>
        {node.tag && (
          <Text style={styles.treeMeta}>{Object.keys(node.tag.usedIn).length}</Text>
        )}
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

// The "Пошук" tab: two ways to browse tags (see TagsTreeSearch.dc.html). The
// tree is auto-derived from every tag's "/" path, browse-only. The tile
// grid is a personal dashboard the user curates by hand (add/remove pins) -
// its selection lives in one small `settings/pinnedTags` doc since it's a
// standalone preference, not something any single tag or item owns.
export default function SearchScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { tags, isLoading } = useTags();
  const [mode, setMode] = useState<'tree' | 'tiles'>('tree');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pinnedIds, setPinnedIds] = useState<string[]>([]);
  const [pickerVisible, setPickerVisible] = useState(false);

  useEffect(() => {
    return onSnapshot(pinnedTagsDoc, (snapshot) => {
      setPinnedIds(snapshot.data()?.tagIds ?? []);
    });
  }, []);

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

  function openTag(tag: Tag) {
    navigation.navigate('TagItems', { tagId: tag.id });
  }

  async function pinTag(tag: Tag) {
    setPickerVisible(false);
    await setDoc(pinnedTagsDoc, { tagIds: arrayUnion(tag.id) }, { merge: true });
  }

  function confirmUnpin(tag: Tag) {
    Alert.alert(`Прибрати "${tag.path}" з плиток?`, undefined, [
      { text: 'Скасувати', style: 'cancel' },
      { text: 'Прибрати', style: 'destructive', onPress: () => setDoc(pinnedTagsDoc, { tagIds: arrayRemove(tag.id) }, { merge: true }) },
    ]);
  }

  return (
    <View style={styles.container}>
      <Text style={styles.header}>Пошук</Text>

      <View style={styles.segmented}>
        <Pressable
          style={[styles.segmentButton, mode === 'tree' && styles.segmentButtonActive]}
          onPress={() => setMode('tree')}
        >
          <Ionicons name="git-network-outline" size={14} color={mode === 'tree' ? '#fff' : '#6B7280'} />
          <Text style={[styles.segmentLabel, mode === 'tree' && styles.segmentLabelActive]}>Дерево</Text>
        </Pressable>
        <Pressable
          style={[styles.segmentButton, mode === 'tiles' && styles.segmentButtonActive]}
          onPress={() => setMode('tiles')}
        >
          <Ionicons name="grid-outline" size={14} color={mode === 'tiles' ? '#fff' : '#6B7280'} />
          <Text style={[styles.segmentLabel, mode === 'tiles' && styles.segmentLabelActive]}>Плитки</Text>
        </Pressable>
      </View>

      {!isLoading && tags.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="pricetag-outline" size={32} color={ACCENT} />
          </View>
          <Text style={styles.emptyLabel}>Ще немає тегів</Text>
          <Text style={styles.emptyHint}>Додайте перший тег через меню тегів на будь-якому елементі чи документі</Text>
        </View>
      ) : mode === 'tree' ? (
        <ScrollView contentContainerStyle={styles.list}>
          {topLevel.map((node) => (
            <TreeRow key={node.fullPath} node={node} depth={0} expanded={expanded} onToggleExpand={toggleExpand} onOpenTag={openTag} />
          ))}
        </ScrollView>
      ) : (
        <ScrollView contentContainerStyle={styles.tileGrid}>
          {pinnedTags.map((tag) => (
            <Pressable
              key={tag.id}
              style={styles.tile}
              onPress={() => openTag(tag)}
              onLongPress={() => confirmUnpin(tag)}
            >
              <View style={[styles.tileIcon, { backgroundColor: `${tag.color}1A` }]}>
                <Ionicons name={tag.icon as keyof typeof Ionicons.glyphMap} size={20} color={tag.color} />
              </View>
              <Text style={styles.tileLabel} numberOfLines={1}>
                {tag.path}
              </Text>
            </Pressable>
          ))}
          <Pressable style={[styles.tile, styles.newTile]} onPress={() => setPickerVisible(true)}>
            <View style={styles.newTileIcon}>
              <Ionicons name="add" size={20} color="#9CA3AF" />
            </View>
            <Text style={styles.newTileLabel}>Додати плитку</Text>
          </Pressable>
        </ScrollView>
      )}

      <Modal visible={pickerVisible} transparent animationType="fade" onRequestClose={() => setPickerVisible(false)}>
        <Pressable style={styles.backdrop} onPress={() => setPickerVisible(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.handle} />
            <Text style={styles.sheetTitle}>Додати плитку</Text>
            <ScrollView style={styles.sheetList}>
              {unpinnedTags.map((tag) => (
                <Pressable key={tag.id} style={styles.sheetRow} onPress={() => pinTag(tag)}>
                  <View style={[styles.treeIcon, { backgroundColor: `${tag.color}1A` }]}>
                    <Ionicons name={tag.icon as keyof typeof Ionicons.glyphMap} size={13} color={tag.color} />
                  </View>
                  <Text style={styles.treeLabel}>{tag.path}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    paddingHorizontal: 20,
    paddingTop: 56,
  },
  segmented: {
    flexDirection: 'row',
    gap: 8,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 8,
  },
  segmentButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  segmentButtonActive: {
    backgroundColor: ACCENT,
  },
  segmentLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  segmentLabelActive: {
    color: '#fff',
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
    color: '#111827',
    textAlign: 'center',
  },
  emptyHint: {
    marginTop: 6,
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  list: {
    paddingVertical: 8,
    paddingBottom: 24,
  },
  treeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
    paddingRight: 20,
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
  treeMeta: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 8,
    gap: 12,
  },
  tile: {
    width: '47%',
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  tileIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#111827',
  },
  newTile: {
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#D1D5DB',
  },
  newTileIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newTileLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#9CA3AF',
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: '70%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  sheetList: {
    maxHeight: 320,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 9,
  },
});
