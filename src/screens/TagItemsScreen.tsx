import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { addDoc, collection, doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { RootStackParamList } from '../navigation';
import { TaggableKind } from '../types';
import { useTags, ITEMS_COLLECTION_BY_KIND, parseUsedInKey } from '../hooks/useTags';

const documentsCollection = collection(db, 'documents');

const KIND_ICON: Record<TaggableKind, { icon: keyof typeof Ionicons.glyphMap; color: string }> = {
  file: { icon: 'document-outline', color: '#8B5CF6' },
  photo: { icon: 'image-outline', color: '#EC4899' },
  'link-video': { icon: 'videocam-outline', color: '#EF4444' },
  'link-geo': { icon: 'location-outline', color: '#16A34A' },
  'link-other': { icon: 'link-outline', color: '#3B82F6' },
  document: { icon: 'document-text-outline', color: '#3B82F6' },
};

type ResolvedItem = {
  key: string;
  kind: TaggableKind;
  itemId: string;
  title: string;
};

type Props = NativeStackScreenProps<RootStackParamList, 'TagItems'>;

// Bear-style "open a tag, see everything on it, create something new right
// there" - reached from Search's tree or tile view. The "+" only offers a
// new Document: files/photos/links have no standalone creation screen
// anywhere in the app (they're only ever created by attaching a block
// inside some document), so a document pre-tagged with this tag - opened
// straight into the editor - is the one kind this can honestly offer.
export default function TagItemsScreen({ route }: Props) {
  const { tagId } = route.params;
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { tags, attachTag } = useTags();
  const [items, setItems] = useState<ResolvedItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const tag = tags.find((t) => t.id === tagId);

  useEffect(() => {
    if (!tag) return;
    let cancelled = false;
    (async () => {
      setIsLoading(true);
      const resolved = await Promise.all(
        Object.keys(tag.usedIn).map(async (key): Promise<ResolvedItem | null> => {
          const { kind, itemId } = parseUsedInKey(key);
          const itemsCollection = ITEMS_COLLECTION_BY_KIND[kind];
          if (!itemsCollection) return null;
          const snapshot = await getDoc(doc(db, itemsCollection, itemId));
          const data = snapshot.data();
          if (!data) return null;
          const title = data.title || data.fileName || data.url || 'Без назви';
          return { key, kind, itemId, title };
        })
      );
      if (!cancelled) {
        setItems(resolved.filter((r): r is ResolvedItem => r !== null));
        setIsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // tag.usedIn is a plain object - re-run whenever the tag doc (and thus
    // the set of usages) changes, not on every unrelated tags-list update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag?.id, tag ? Object.keys(tag.usedIn).join(',') : '']);

  function openItem(item: ResolvedItem) {
    if (item.kind === 'document') {
      navigation.navigate('Editor', { documentId: item.itemId });
    } else if (item.kind === 'file') {
      navigation.navigate('Files');
    } else if (item.kind === 'photo') {
      navigation.navigate('Photos');
    } else {
      const category = item.kind === 'link-video' ? 'video' : item.kind === 'link-geo' ? 'geo' : 'other';
      navigation.navigate('Links', { category });
    }
  }

  async function createTaggedDocument() {
    if (!tag) return;
    const newDoc = await addDoc(documentsCollection, { title: 'Без назви', updatedAt: Date.now(), blocks: [] });
    await attachTag(tag, 'document', newDoc.id, 'documents');
    navigation.navigate('Editor', { documentId: newDoc.id });
  }

  if (!tag) {
    return (
      <View style={[styles.container, styles.emptyState]}>
        <Text style={styles.emptyLabel}>Цей тег більше не існує</Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={22} color="#111827" />
        </Pressable>
        <View style={[styles.headerIcon, { backgroundColor: `${tag.color}1F` }]}>
          <Ionicons name={tag.icon as keyof typeof Ionicons.glyphMap} size={17} color={tag.color} />
        </View>
        <Text style={styles.headerTitle}>{tag.path}</Text>
      </View>
      <Text style={styles.subtitle}>
        {items.length} {items.length === 1 ? 'елемент' : 'елементів'}
      </Text>

      {isLoading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color={tag.color} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>
          {items.map((item) => {
            const info = KIND_ICON[item.kind];
            return (
              <Pressable key={item.key} style={styles.row} onPress={() => openItem(item)}>
                <View style={[styles.rowIcon, { backgroundColor: `${info.color}1A` }]}>
                  <Ionicons name={info.icon} size={17} color={info.color} />
                </View>
                <Text style={styles.rowLabel} numberOfLines={1}>
                  {item.title}
                </Text>
              </Pressable>
            );
          })}

          <Pressable style={styles.createRow} onPress={createTaggedDocument}>
            <Ionicons name="add" size={18} color="#3B82F6" />
            <Text style={styles.createLabel}>Створити новий документ з тегом "{tag.path}"</Text>
          </Pressable>
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 56,
  },
  headerIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#111827',
    flexShrink: 1,
  },
  subtitle: {
    fontSize: 12,
    color: '#9CA3AF',
    paddingLeft: 68,
    paddingTop: 4,
    paddingBottom: 12,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyLabel: {
    fontSize: 15,
    color: '#6B7280',
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 24,
    gap: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 10,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLabel: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
  },
  createRow: {
    marginTop: 6,
    borderRadius: 14,
    borderWidth: 1.5,
    borderStyle: 'dashed',
    borderColor: '#D1D5DB',
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  createLabel: {
    fontSize: 14,
    color: '#3B82F6',
    fontWeight: '600',
  },
});
