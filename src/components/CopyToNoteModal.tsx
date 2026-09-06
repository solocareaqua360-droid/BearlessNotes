import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
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

          <ScrollView style={styles.list}>
            {documents.map((d) => (
              <Pressable key={d.id} style={styles.row} onPress={() => onPickExisting(d.id)}>
                <View style={styles.docIcon}>
                  <Ionicons name="document-text-outline" size={16} color={ACCENT} />
                </View>
                <Text style={styles.rowText} numberOfLines={1}>
                  {d.title || 'Без назви'}
                </Text>
              </Pressable>
            ))}
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
