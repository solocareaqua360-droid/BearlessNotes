import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
} from 'firebase/firestore';
import { db } from '../firebase';
import { DocumentItem } from '../types';
import { RootStackParamList } from '../navigation';
import { useTags, detachTagFromDeletedItem } from '../hooks/useTags';
import TagsDrawer, { DocumentTagFilter } from '../components/TagsDrawer';
import DocumentCard from '../components/DocumentCard';
import { extractPreview } from '../utils/documentPreview';

const ACCENT = '#3B82F6';
const documentsCollection = collection(db, 'documents');

export default function DocumentsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<DocumentTagFilter | null>(null);
  const { tags } = useTags();

  useEffect(() => {
    const documentsQuery = query(documentsCollection, orderBy('updatedAt', 'desc'));
    return onSnapshot(documentsQuery, (snapshot) => {
      setDocuments(
        snapshot.docs
          // Daily notes (CalendarScreen) live in this same collection but
          // belong to the calendar, not this list.
          .filter((docSnapshot) => !docSnapshot.data().calendarDate)
          .map((docSnapshot) => ({
            id: docSnapshot.id,
            title: docSnapshot.data().title,
            updatedAt: docSnapshot.data().updatedAt,
            tagIds: docSnapshot.data().tagIds ?? [],
            blocks: docSnapshot.data().blocks ?? [],
          }))
      );
      setIsLoading(false);
    });
  }, []);

  const displayedDocuments = documents.filter((item) => {
    if (!activeFilter) return true;
    const itemTagIds = item.tagIds ?? [];
    if (activeFilter.type === 'untagged') return itemTagIds.length === 0;
    return itemTagIds.includes(activeFilter.tag.id);
  });

  async function createDocument() {
    const newDoc = await addDoc(documentsCollection, {
      title: 'Без назви',
      updatedAt: Date.now(),
      blocks: [],
    });
    navigation.navigate('Editor', { documentId: newDoc.id });
  }

  function deleteDocument(id: string) {
    Alert.alert('Видалити документ?', undefined, [
      { text: 'Скасувати', style: 'cancel' },
      {
        text: 'Видалити',
        style: 'destructive',
        onPress: () => confirmDeleteDocument(id),
      },
    ]);
  }

  async function confirmDeleteDocument(id: string) {
    const snapshot = await getDoc(doc(db, 'documents', id));
    const docTagIds: string[] = snapshot.data()?.tagIds ?? [];
    deleteDoc(doc(db, 'documents', id));
    await Promise.all(
      docTagIds.map((tagId) => {
        const tag = tags.find((t) => t.id === tagId);
        return tag ? detachTagFromDeletedItem(tag, 'document', id) : Promise.resolve();
      })
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Документи</Text>
        <Pressable style={styles.searchButton} onPress={() => navigation.navigate('Search')}>
          <Ionicons name="search" size={17} color={ACCENT} />
        </Pressable>
      </View>

      {activeFilter && (
        <View style={styles.filterRow}>
          <View style={styles.filterChip}>
            {activeFilter.type === 'tag' ? (
              <>
                <Ionicons
                  name={activeFilter.tag.icon as keyof typeof Ionicons.glyphMap}
                  size={13}
                  color={activeFilter.tag.color}
                />
                <Text style={[styles.filterChipLabel, { color: activeFilter.tag.color }]}>{activeFilter.tag.path}</Text>
              </>
            ) : (
              <>
                <Ionicons name="pricetag-outline" size={13} color="#6B7280" />
                <Text style={styles.filterChipLabel}>Без тегів</Text>
              </>
            )}
            <Pressable hitSlop={8} onPress={() => setActiveFilter(null)}>
              <Ionicons name="close" size={14} color={activeFilter.type === 'tag' ? activeFilter.tag.color : '#6B7280'} />
            </Pressable>
          </View>
        </View>
      )}

      {isLoading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color={ACCENT} />
        </View>
      ) : displayedDocuments.length === 0 ? (
        <View style={styles.emptyState}>
          {documents.length === 0 ? (
            <>
              <Pressable style={styles.emptyIcon} onPress={createDocument}>
                <Ionicons name="document-text-outline" size={32} color={ACCENT} />
                <View style={styles.emptyBadge}>
                  <Ionicons name="add" size={14} color="#fff" />
                </View>
              </Pressable>
              <Text style={styles.emptyLabel}>Створити новий документ</Text>
            </>
          ) : (
            <Text style={styles.emptyLabel}>Немає документів із цим фільтром</Text>
          )}
        </View>
      ) : (
        <FlatList
          data={displayedDocuments}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => {
            const { imageUri, previewText } = extractPreview(item.blocks);
            return (
              <DocumentCard
                title={item.title}
                updatedAt={item.updatedAt}
                imageUri={imageUri}
                previewText={previewText}
                onPress={() => navigation.navigate('Editor', { documentId: item.id })}
                onDelete={() => deleteDocument(item.id)}
              />
            );
          }}
        />
      )}

      <Pressable style={styles.fab} onPress={createDocument}>
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>

      <TagsDrawer tags={tags} activeFilter={activeFilter} onSelectFilter={setActiveFilter} />
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
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 8,
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  searchButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  filterRow: {
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  filterChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    borderRadius: 16,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  filterChipLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: ACCENT,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyBadge: {
    position: 'absolute',
    right: -4,
    bottom: -4,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#fff',
  },
  emptyLabel: {
    marginTop: 16,
    fontSize: 15,
    color: '#6B7280',
  },
  list: {
    paddingVertical: 8,
    paddingBottom: 120,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 100,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowOffset: { width: 0, height: 2 },
    shadowRadius: 4,
  },
});
