import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
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
import TagsDrawer, { TagFilter, matchesTagFilter, removeTagFromFilter } from '../components/TagsDrawer';
import DocumentCard from '../components/DocumentCard';
import { extractPreview } from '../utils/documentPreview';
import { FONT_REGULAR, FONT_BOLD, FONT_SEMIBOLD } from '../utils/fonts';

// Палітра №3 (Теплий Теракотовий) - the create/edit action color across
// this redesign; replaces the old blue ACCENT wherever this screen used it.
const ACCENT = '#BE7657';
const documentsCollection = collection(db, 'documents');

export default function DocumentsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // react-native-svg's own "100%" width/height on the root <Svg> doesn't
  // reliably re-measure when the window itself resizes at runtime (seen on
  // a Fold: the gradient stayed sized to the folded width after unfolding)
  // - useWindowDimensions re-renders on that resize, so passing explicit
  // pixel width/height keeps the gradient's canvas in sync with it.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState<TagFilter | null>(null);
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

  const displayedDocuments = documents.filter((item) => matchesTagFilter(item.tagIds ?? [], activeFilter));
  // Only offer tags actually assigned to at least one document - not the
  // whole app-wide tag list - same "used tags" pruning Files/Photos/Links
  // already apply to their own drawers.
  const usedTagIds = new Set(documents.flatMap((d) => d.tagIds ?? []));
  const drawerTags = tags.filter((t) => usedTagIds.has(t.id));

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
      {/* Page background: a fixed gradient (react-native-svg, already a
          native dep for sketches - no new build needed) rather than
          expo-linear-gradient, which would be a brand-new native module
          and mean another EAS dev-client build. */}
      <Svg width={windowWidth} height={windowHeight} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          {/* Dialed in via the gradient editor artifact - dark warm brown
              at the top, gray-green through the middle, fading to black
              over the bottom half. */}
          <LinearGradient id="documentsBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.03" stopColor="#705648" />
            <Stop offset="0.52" stopColor="#69736E" />
            <Stop offset="1" stopColor="#000000" />
          </LinearGradient>
        </Defs>
        <Rect width={windowWidth} height={windowHeight} fill="url(#documentsBg)" />
      </Svg>

      <View style={styles.headerRow}>
        <Text style={styles.header}>Документи</Text>
        <View style={styles.headerButtons}>
          <Pressable hitSlop={6} onPress={() => navigation.navigate('Search')}>
            <Ionicons name="search" size={17} color="#fff" />
          </Pressable>
          <View style={styles.headerButtonsDivider} />
          <Pressable
            hitSlop={6}
            onPress={() => navigation.navigate('Placeholder', { icon: 'ellipsis-horizontal-outline', label: 'Скоро' })}
          >
            <Ionicons name="ellipsis-horizontal" size={17} color="#fff" />
          </Pressable>
        </View>
      </View>

      {activeFilter && (
        <View style={styles.filterRow}>
          {activeFilter.type === 'untagged' ? (
            <View style={[styles.filterChip, { borderColor: '#6B7280' }]}>
              <Ionicons name="pricetag-outline" size={13} color="#6B7280" />
              <Text style={[styles.filterChipLabel, { color: '#6B7280' }]}>Без тегів</Text>
              <Pressable hitSlop={8} onPress={() => setActiveFilter(null)}>
                <Ionicons name="close" size={14} color="#6B7280" />
              </Pressable>
            </View>
          ) : (
            activeFilter.tagIds.map((tagId) => {
              const tag = tags.find((t) => t.id === tagId);
              if (!tag) return null;
              return (
                <View key={tagId} style={[styles.filterChip, { borderColor: tag.color }]}>
                  <Ionicons name={tag.icon as keyof typeof Ionicons.glyphMap} size={13} color={tag.color} />
                  <Text style={[styles.filterChipLabel, { color: tag.color }]}>{tag.path}</Text>
                  <Pressable hitSlop={8} onPress={() => setActiveFilter(removeTagFromFilter(activeFilter, tagId))}>
                    <Ionicons name="close" size={14} color={tag.color} />
                  </Pressable>
                </View>
              );
            })
          )}
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
                id={item.id}
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

      <TagsDrawer tags={drawerTags} activeFilter={activeFilter} onSelectFilter={setActiveFilter} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    // Was 56 - pushed down to roughly the level a note's own title sits at
    // in the editor (that title starts under its own back/undo/redo
    // header row, ~90px down).
    paddingTop: 90,
    paddingBottom: 8,
  },
  header: {
    // At least 2x the previous 22.
    fontSize: 46,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    // The new gradient is dark top-to-bottom (no light edge left), so the
    // title needs to sit on it in white now.
    color: '#fff',
  },
  // Search + "..." (stub) merged into one elongated glass capsule instead
  // of two separate circles.
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 38,
    borderRadius: 19,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(20,20,20,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  headerButtonsDivider: {
    width: 1,
    height: 16,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  filterRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    paddingHorizontal: 20,
    paddingBottom: 8,
  },
  // White capsule, border in the tag's own (muted) color, text the same
  // color - borderColor/color are set per-chip inline (tag.color), this
  // just carries the shared shape.
  filterChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#fff',
    borderWidth: 1.5,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  filterChipLabel: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
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
    backgroundColor: 'rgba(190,118,87,0.14)',
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
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.85)',
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
    borderRadius: 18,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    // Colored shadow (matches the button's own hue) instead of a plain
    // black one.
    shadowColor: ACCENT,
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
  },
});
