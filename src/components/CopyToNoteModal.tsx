import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, onSnapshot, orderBy, query } from '@react-native-firebase/firestore';
import { db } from '../firebase';

const ACCENT = '#3B82F6';
const documentsCollection = collection(db, 'documents');

type PickableDocument = { id: string; title: string };

type Props = {
  visible: boolean;
  onPickExisting: (documentId: string) => void;
  onPickNew: () => void;
  onClose: () => void;
};

// Bulk "copy to note" destination picker (see BulkActionBar) - lists every
// regular document (daily notes excluded, same filter DocumentsScreen and
// SearchScreen use) plus a "new document" row at the top.
export default function CopyToNoteModal({ visible, onPickExisting, onPickNew, onClose }: Props) {
  const [documents, setDocuments] = useState<PickableDocument[]>([]);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!visible) return;
    const documentsQuery = query(documentsCollection, orderBy('updatedAt', 'desc'));
    return onSnapshot(documentsQuery, (snapshot) => {
      setDocuments(
        snapshot.docs
          .filter((docSnapshot) => !docSnapshot.data().calendarDate)
          .map((docSnapshot) => ({ id: docSnapshot.id, title: docSnapshot.data().title }))
      );
    });
  }, [visible]);

  // Reset between openings - a search left over from copying into one note
  // shouldn't still be filtering the list the next time this sheet opens
  // for something else entirely.
  useEffect(() => {
    if (!visible) setSearchQuery('');
  }, [visible]);

  const needle = searchQuery.trim().toLowerCase();
  const filteredDocuments = needle
    ? documents.filter((d) => (d.title || 'Без назви').toLowerCase().includes(needle))
    : documents;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>Копіювати в нотатку</Text>

          <Pressable style={styles.row} onPress={onPickNew}>
            <View style={styles.newIcon}>
              <Ionicons name="add" size={16} color={ACCENT} />
            </View>
            <Text style={[styles.rowText, { color: ACCENT, fontWeight: '600' }]}>Новий документ</Text>
          </Pressable>

          <View style={styles.searchRow}>
            <Ionicons name="search" size={14} color="#9CA3AF" />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Пошук за назвою"
              placeholderTextColor="#9CA3AF"
              style={styles.searchInput}
            />
          </View>

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {filteredDocuments.map((d) => (
              <Pressable key={d.id} style={styles.row} onPress={() => onPickExisting(d.id)}>
                <View style={styles.docIcon}>
                  <Ionicons name="document-text-outline" size={16} color={ACCENT} />
                </View>
                <Text style={styles.rowText} numberOfLines={1}>
                  {d.title || 'Без назви'}
                </Text>
              </Pressable>
            ))}
            {filteredDocuments.length === 0 && (
              <Text style={styles.emptyLabel}>Нічого не знайдено</Text>
            )}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
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
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
  },
  emptyLabel: {
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
    paddingVertical: 16,
  },
  list: {
    maxHeight: 320,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  docIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  newIcon: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
  },
});
