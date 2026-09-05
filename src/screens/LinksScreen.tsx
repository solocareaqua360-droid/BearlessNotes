import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Block } from '../types';
import { RootStackParamList } from '../navigation';

const ACCENT = '#3B82F6';
const DANGER = '#EF4444';
const linksCollection = collection(db, 'links');

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type LinkItem = {
  id: string;
  url: string;
  title?: string;
  imageUrl?: string;
  siteName?: string;
  documentId: string;
};

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

export default function LinksScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const linksQuery = query(linksCollection, orderBy('updatedAt', 'desc'));
    return onSnapshot(linksQuery, (snapshot) => {
      setLinks(
        snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          url: docSnapshot.data().url,
          title: docSnapshot.data().title,
          imageUrl: docSnapshot.data().imageUrl,
          siteName: docSnapshot.data().siteName,
          documentId: docSnapshot.data().documentId,
        }))
      );
      setIsLoading(false);
    });
  }, []);

  function openSortOrFilter() {
    navigation.navigate('Placeholder', { icon: 'options-outline', label: 'Скоро' });
  }

  // A link isn't a separate record referenced from multiple documents yet
  // (see the "next steps" note in DocumentEditorScreen's syncLinksForDocument -
  // duplicate detection/merge is a later step) - it IS the card, in exactly
  // the one document it was inserted into, same as how a "справа" task
  // mirrors its one checkbox block.
  function confirmDeleteLink(link: LinkItem) {
    Alert.alert('Видалити посилання?', 'Картка також зникне з документа, де її вставлено.', [
      { text: 'Скасувати', style: 'cancel' },
      { text: 'Видалити', style: 'destructive', onPress: () => deleteLink(link) },
    ]);
  }

  async function deleteLink(link: LinkItem) {
    deleteDoc(doc(db, 'links', link.id));
    const documentRef = doc(db, 'documents', link.documentId);
    const snapshot = await getDoc(documentRef);
    const data = snapshot.data();
    if (!data) return;
    const blocks: Block[] = data.blocks ?? [];
    const remaining = blocks.filter((b) => b.id !== link.id);
    updateDoc(documentRef, {
      blocks: remaining.length > 0 ? remaining : [{ id: generateId(), text: '' }],
    });
  }

  function renderLinkRow(item: LinkItem) {
    const isGeo = item.siteName === 'Геоточка';
    return (
      <View key={item.id} style={styles.row}>
        <Pressable
          style={styles.rowTap}
          onPress={() => navigation.navigate('Editor', { documentId: item.documentId })}
        >
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={[styles.thumbIcon, isGeo && styles.thumbIconGeo]}>
              <Ionicons name={isGeo ? 'location-outline' : 'link-outline'} size={20} color={isGeo ? '#16A34A' : ACCENT} />
            </View>
          )}
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle} numberOfLines={2}>
              {item.title || hostnameOf(item.url)}
            </Text>
            <Text style={styles.rowCaption} numberOfLines={1}>
              {item.siteName ?? hostnameOf(item.url)}
            </Text>
            <View style={styles.rowMeta}>
              <View style={styles.tagChip}>
                <Text style={styles.tagChipLabel}>Теги (скоро)</Text>
              </View>
              <Text style={styles.docCount}>1 документ</Text>
            </View>
          </View>
        </Pressable>
        <Pressable hitSlop={8} onPress={() => confirmDeleteLink(item)} style={styles.rowDelete}>
          <Ionicons name="trash-outline" size={18} color={DANGER} />
        </Pressable>
      </View>
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.container, styles.emptyState]}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Посилання</Text>
        <View style={styles.headerIcons}>
          <Pressable hitSlop={8} onPress={openSortOrFilter}>
            <Ionicons name="swap-vertical-outline" size={20} color="#6B7280" />
          </Pressable>
          <Pressable hitSlop={8} onPress={openSortOrFilter}>
            <Ionicons name="filter-outline" size={20} color="#6B7280" />
          </Pressable>
        </View>
      </View>

      {links.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="link-outline" size={32} color={ACCENT} />
          </View>
          <Text style={styles.emptyLabel}>Ще немає збережених посилань</Text>
          <Text style={styles.emptyHint}>
            Вставте посилання окремим абзацом у будь-якому документі - картка з'явиться тут сама
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>{links.map(renderLinkRow)}</ScrollView>
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
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    // 56, not 16 - this screen has no native header (headerShown: false on
    // the stack), so its own top padding is what clears the status bar,
    // matching TasksScreen/DocumentEditorScreen for the same reason.
    paddingTop: 56,
    paddingBottom: 8,
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  headerIcons: {
    flexDirection: 'row',
    gap: 16,
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
    paddingHorizontal: 20,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 10,
  },
  rowTap: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: '#E5E7EB',
  },
  thumbIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(59,130,246,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  thumbIconGeo: {
    backgroundColor: 'rgba(22,163,74,0.12)',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  rowCaption: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  tagChip: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  tagChipLabel: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  docCount: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  rowDelete: {
    padding: 4,
  },
});
