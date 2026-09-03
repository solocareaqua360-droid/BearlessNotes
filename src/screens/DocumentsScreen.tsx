import { useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DocumentItem } from '../types';

const ACCENT = '#3B82F6';
const DANGER = '#EF4444';

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleString('uk-UA', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export default function DocumentsScreen() {
  const [documents, setDocuments] = useState<DocumentItem[]>([]);

  function createDocument() {
    const now = Date.now();
    setDocuments((prev) => [
      { id: String(now), title: 'Без назви', updatedAt: now },
      ...prev,
    ]);
  }

  function deleteDocument(id: string) {
    Alert.alert('Видалити документ?', undefined, [
      { text: 'Скасувати', style: 'cancel' },
      {
        text: 'Видалити',
        style: 'destructive',
        onPress: () => setDocuments((prev) => prev.filter((doc) => doc.id !== id)),
      },
    ]);
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
          <View style={styles.row}>
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
          </View>
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
