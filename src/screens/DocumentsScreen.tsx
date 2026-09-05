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

const ACCENT = '#3B82F6';
const DANGER = '#EF4444';
const documentsCollection = collection(db, 'documents');

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('uk-UA', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function DocumentsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const { tags } = useTags();

  useEffect(() => {
    const documentsQuery = query(documentsCollection, orderBy('updatedAt', 'desc'));
    return onSnapshot(documentsQuery, (snapshot) => {
      setDocuments(
        snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          title: docSnapshot.data().title,
          updatedAt: docSnapshot.data().updatedAt,
        }))
      );
      setIsLoading(false);
    });
  }, []);

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

  if (isLoading) {
    return (
      <View style={[styles.container, styles.emptyState]}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  if (documents.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <Pressable style={styles.emptyIcon} onPress={createDocument}>
            <Ionicons name="document-text-outline" size={32} color={ACCENT} />
            <View style={styles.emptyBadge}>
              <Ionicons name="add" size={14} color="#fff" />
            </View>
          </Pressable>
          <Text style={styles.emptyLabel}>Створити новий документ</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={documents}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={styles.row}
            onPress={() => navigation.navigate('Editor', { documentId: item.id })}
          >
            <View style={styles.rowIcon}>
              <Ionicons name="document-text-outline" size={18} color={ACCENT} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>{item.title}</Text>
              <Text style={styles.rowDate}>{formatDate(item.updatedAt)}</Text>
            </View>
            <Pressable
              hitSlop={8}
              onPress={() => deleteDocument(item.id)}
              style={styles.rowDelete}
            >
              <Ionicons name="trash-outline" size={20} color={DANGER} />
            </Pressable>
          </Pressable>
        )}
      />
      <Pressable style={styles.fab} onPress={createDocument}>
        <Ionicons name="add" size={28} color="#fff" />
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
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
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowText: {
    flex: 1,
  },
  rowTitle: {
    fontSize: 16,
    color: '#111827',
  },
  rowDate: {
    fontSize: 13,
    color: '#9CA3AF',
    marginTop: 2,
  },
  rowDelete: {
    padding: 4,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 20,
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
