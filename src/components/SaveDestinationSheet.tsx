import { useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, onSnapshot, orderBy, query } from '@react-native-firebase/firestore';
import { db } from '../firebase';

const ACCENT = '#3B82F6';
const documentsCollection = collection(db, 'documents');
const boardsCollection = collection(db, 'boards');

type PickableDocument = { id: string; title: string };
type PickableBoard = { id: string; title: string };

type Props = {
  visible: boolean;
  title: string;
  // The one caller-specific choice, shown first and highlighted - "У базу"
  // for Files/Photos/Links' own "+", "Зберегти в Посилання" / "Зберегти як
  // стікер" for ShareIntentHandler. Every other row (Сьогодні / notes /
  // boards) is the same for every caller, so it's the only thing that
  // varies between them.
  defaultLabel?: string;
  onPickDefault?: () => void;
  onPickToday: () => void;
  onPickNew: () => void;
  onPickExisting: (documentId: string) => void;
  onPickNewBoard: () => void;
  onPickExistingBoard: (boardId: string) => void;
  onClose: () => void;
};

// Where a newly created file/photo/link/geo point/video, or a shared
// link/text, should land: straight into its own database (the default,
// fast path everywhere this is offered from), today's daily note, a new or
// existing regular note, or a new or existing board. One shared sheet
// rather than a picker per screen, since the five non-default choices are
// identical everywhere.
export default function SaveDestinationSheet({
  visible,
  title,
  defaultLabel,
  onPickDefault,
  onPickToday,
  onPickNew,
  onPickExisting,
  onPickNewBoard,
  onPickExistingBoard,
  onClose,
}: Props) {
  const [documents, setDocuments] = useState<PickableDocument[]>([]);
  const [boards, setBoards] = useState<PickableBoard[]>([]);
  const [noteSearch, setNoteSearch] = useState('');
  const [boardSearch, setBoardSearch] = useState('');

  useEffect(() => {
    if (!visible) return;
    const documentsQuery = query(documentsCollection, orderBy('updatedAt', 'desc'));
    return onSnapshot(documentsQuery, (snapshot) => {
      setDocuments(
        snapshot.docs
          .filter((d) => !d.data().calendarDate)
          .map((d) => ({ id: d.id, title: d.data().title }))
      );
    });
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    const boardsQuery = query(boardsCollection, orderBy('updatedAt', 'desc'));
    return onSnapshot(boardsQuery, (snapshot) => {
      setBoards(snapshot.docs.map((d) => ({ id: d.id, title: d.data().title })));
    });
  }, [visible]);

  // Reset between openings - a search left over from one add shouldn't
  // still be filtering the list the next time this sheet opens.
  useEffect(() => {
    if (!visible) {
      setNoteSearch('');
      setBoardSearch('');
    }
  }, [visible]);

  const noteNeedle = noteSearch.trim().toLowerCase();
  const filteredDocuments = noteNeedle
    ? documents.filter((d) => (d.title || 'Без назви').toLowerCase().includes(noteNeedle))
    : documents;
  const boardNeedle = boardSearch.trim().toLowerCase();
  const filteredBoards = boardNeedle
    ? boards.filter((b) => (b.title || 'Без назви').toLowerCase().includes(boardNeedle))
    : boards;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>{title}</Text>

          <ScrollView keyboardShouldPersistTaps="handled">
            {defaultLabel && onPickDefault && (
              <Pressable style={styles.row} onPress={onPickDefault}>
                <View style={styles.actionIcon}>
                  <Ionicons name="flash-outline" size={16} color={ACCENT} />
                </View>
                <Text style={[styles.rowText, styles.rowTextAction]}>{defaultLabel}</Text>
              </Pressable>
            )}

            <Pressable style={styles.row} onPress={onPickToday}>
              <View style={styles.actionIcon}>
                <Ionicons name="today-outline" size={16} color={ACCENT} />
              </View>
              <Text style={[styles.rowText, styles.rowTextAction]}>Сьогодні</Text>
            </Pressable>

            <Pressable style={styles.row} onPress={onPickNew}>
              <View style={styles.actionIcon}>
                <Ionicons name="add" size={16} color={ACCENT} />
              </View>
              <Text style={[styles.rowText, styles.rowTextAction]}>Нова нотатка</Text>
            </Pressable>

            <Text style={styles.sectionLabel}>Існуюча нотатка</Text>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={14} color="#9CA3AF" />
              <TextInput
                value={noteSearch}
                onChangeText={setNoteSearch}
                placeholder="Пошук за назвою"
                placeholderTextColor="#9CA3AF"
                style={styles.searchInput}
              />
            </View>
            {filteredDocuments.length === 0 ? (
              <Text style={styles.emptyLabel}>Нічого не знайдено</Text>
            ) : (
              filteredDocuments.map((d) => (
                <Pressable key={d.id} style={styles.row} onPress={() => onPickExisting(d.id)}>
                  <View style={styles.docIcon}>
                    <Ionicons name="document-text-outline" size={16} color={ACCENT} />
                  </View>
                  <Text style={styles.rowText} numberOfLines={1}>
                    {d.title || 'Без назви'}
                  </Text>
                </Pressable>
              ))
            )}

            <Pressable style={styles.row} onPress={onPickNewBoard}>
              <View style={styles.actionIcon}>
                <Ionicons name="add" size={16} color={ACCENT} />
              </View>
              <Text style={[styles.rowText, styles.rowTextAction]}>Нова дошка</Text>
            </Pressable>

            <Text style={styles.sectionLabel}>Існуюча дошка</Text>
            <View style={styles.searchRow}>
              <Ionicons name="search" size={14} color="#9CA3AF" />
              <TextInput
                value={boardSearch}
                onChangeText={setBoardSearch}
                placeholder="Пошук за назвою"
                placeholderTextColor="#9CA3AF"
                style={styles.searchInput}
              />
            </View>
            {filteredBoards.length === 0 ? (
              <Text style={styles.emptyLabel}>Нічого не знайдено</Text>
            ) : (
              filteredBoards.map((b) => (
                <Pressable key={b.id} style={styles.row} onPress={() => onPickExistingBoard(b.id)}>
                  <View style={styles.docIcon}>
                    <Ionicons name="grid-outline" size={16} color={ACCENT} />
                  </View>
                  <Text style={styles.rowText} numberOfLines={1}>
                    {b.title || 'Без назви'}
                  </Text>
                </Pressable>
              ))
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
    maxHeight: '80%',
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
    marginBottom: 4,
  },
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingTop: 10,
    paddingBottom: 2,
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
    paddingVertical: 10,
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
  actionIcon: {
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
  rowTextAction: {
    color: ACCENT,
    fontWeight: '600',
  },
});
