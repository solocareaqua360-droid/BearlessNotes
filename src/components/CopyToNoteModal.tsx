import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
// gesture-handler's ScrollView, not the core RN one: on Android a drag that
// starts on a TextInput never reaches an RN ScrollView's scroll recognition,
// so a sheet with a search/name field only scrolled when a finger happened to
// land between rows. Same fix, same reason, as FieldsEditorSheet.
import { ScrollView } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import { collection, onSnapshot, orderBy, query } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import {
  GLASS_BACKDROP,
  GLASS_BODY_BLURRED,
  GLASS_LINE,
  GLASS_TEXT,
  GLASS_TEXT_FAINT,
} from '../constants/glass';
import GlassLayer from './GlassLayer';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

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
// SearchScreen use) plus a "new document" row at the top. The richer
// "where should this NEW thing land" choice (note/today/board) shared item
// creation uses is SaveDestinationSheet, a separate component - this one
// stays scoped to its own original job.
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
    <GlassLayer visible={visible} onClose={onClose}>
      {/* Backdrop as a SIBLING behind the sheet, not its parent - as a
          parent it took the RN touch responder for every drag that did
          not land on a deeper child, which is what kept the list from
          scrolling. A tap outside still closes it. */}
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.sheet}>
          <View style={styles.handle} />
          <Text style={styles.title}>Копіювати в нотатку</Text>

          <Pressable style={styles.row} onPress={onPickNew}>
            <View style={styles.newIcon}>
              <Ionicons name="add" size={16} color={ACCENT} />
            </View>
            <Text style={[styles.rowText, { color: ACCENT, fontFamily: FONT_SEMIBOLD }]}>Новий документ</Text>
          </Pressable>

          <View style={styles.searchRow}>
            <Ionicons name="search" size={14} color={GLASS_TEXT_FAINT} />
            <TextInput
              value={searchQuery}
              onChangeText={setSearchQuery}
              placeholder="Пошук за назвою"
              placeholderTextColor={GLASS_TEXT_FAINT}
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
        </View>
      </View>
    </GlassLayer>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: GLASS_BODY_BLURRED,
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
    backgroundColor: GLASS_LINE,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
    marginBottom: 8,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: GLASS_LINE,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginBottom: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
  },
  emptyLabel: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_FAINT,
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
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
  },
});
