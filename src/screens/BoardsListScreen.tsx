import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { addDoc, collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { RootStackParamList } from '../navigation';
import { BoardItem } from '../types';
import { colorForDocument } from '../utils/documentColor';
import RenamePrompt from '../components/RenamePrompt';

const ACCENT = '#8B5CF6';
const boardsCollection = collection(db, 'boards');

// List of "Дошка" boards - Stage 1 of the board feature (see DEVELOPMENT_PLAN.md).
// Deliberately minimal next to Files/Links/Photos: no tags, groups, sort
// menu or bulk-select yet - a handful of boards doesn't need them, and
// nothing in the brief for this stage asks for them.
export default function BoardsListScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [boards, setBoards] = useState<BoardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [cardMenuBoardId, setCardMenuBoardId] = useState<string | null>(null);
  const [renamingBoard, setRenamingBoard] = useState<BoardItem | null>(null);

  useEffect(() => {
    const boardsQuery = query(boardsCollection, orderBy('updatedAt', 'desc'));
    return onSnapshot(boardsQuery, (snapshot) => {
      setBoards(
        snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          return {
            id: docSnapshot.id,
            title: data.title ?? 'Без назви',
            cards: data.cards ?? [],
            createdAt: data.createdAt ?? 0,
            updatedAt: data.updatedAt ?? 0,
          };
        })
      );
      setIsLoading(false);
    });
  }, []);

  const cardMenuBoard = cardMenuBoardId ? boards.find((b) => b.id === cardMenuBoardId) ?? null : null;

  async function createBoard() {
    const now = Date.now();
    const ref = await addDoc(boardsCollection, { title: 'Без назви', cards: [], createdAt: now, updatedAt: now });
    navigation.navigate('Board', { boardId: ref.id });
  }

  function openBoard(board: BoardItem) {
    navigation.navigate('Board', { boardId: board.id });
  }

  async function renameBoard(board: BoardItem, title: string) {
    setRenamingBoard(null);
    await updateDoc(doc(db, 'boards', board.id), { title });
  }

  function confirmDeleteBoard(board: BoardItem) {
    setCardMenuBoardId(null);
    Alert.alert('Видалити дошку?', board.title || 'Без назви', [
      { text: 'Скасувати', style: 'cancel' },
      { text: 'Видалити', style: 'destructive', onPress: () => deleteDoc(doc(db, 'boards', board.id)) },
    ]);
  }

  function renderBoardRow(item: BoardItem) {
    const { background, text, textMuted } = colorForDocument(item.id);
    return (
      <Pressable key={item.id} style={[styles.row, { backgroundColor: background }]} onPress={() => openBoard(item)}>
        <View style={styles.rowIcon}>
          <Ionicons name="apps-outline" size={20} color={text} />
        </View>
        <View style={styles.rowBody}>
          <Text style={[styles.rowTitle, { color: text }]} numberOfLines={2}>
            {item.title || 'Без назви'}
          </Text>
          <Text style={[styles.rowMeta, { color: textMuted }]}>
            {item.cards.length} {item.cards.length === 1 ? 'картка' : 'карток'}
          </Text>
        </View>
        <Pressable hitSlop={8} onPress={() => setCardMenuBoardId(item.id)} style={styles.rowActionButton}>
          <Ionicons name="ellipsis-horizontal" size={16} color={textMuted} />
        </Pressable>
      </Pressable>
    );
  }

  return (
    <View style={styles.container}>
      <Svg
        width={windowWidth + 2}
        height={windowHeight + 2}
        style={[StyleSheet.absoluteFill, { top: -1, left: -1 }]}
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="boardsBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.03" stopColor="#705648" />
            <Stop offset="0.52" stopColor="#69736E" />
            <Stop offset="1" stopColor="#000000" />
          </LinearGradient>
        </Defs>
        <Rect width={windowWidth + 2} height={windowHeight + 2} fill="url(#boardsBg)" />
      </Svg>

      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.header}>Дошка</Text>
        </View>
        <Pressable hitSlop={8} style={styles.addButton} onPress={createBoard}>
          <Ionicons name="add" size={20} color="#fff" />
        </Pressable>
      </View>

      {isLoading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : boards.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="apps-outline" size={32} color={ACCENT} />
          </View>
          <Text style={styles.emptyLabel}>Ще немає дощок</Text>
          <Text style={styles.emptyHint}>Дошка - вільний канвас для карток, які потім можна зібрати в документ</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>{boards.map(renderBoardRow)}</ScrollView>
      )}

      <Modal
        visible={cardMenuBoard !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setCardMenuBoardId(null)}
      >
        <Pressable style={styles.cardMenuBackdrop} onPress={() => setCardMenuBoardId(null)}>
          <Pressable style={styles.cardMenuSheet} onPress={() => {}}>
            <View style={styles.cardMenuHandle} />
            <Pressable
              style={styles.cardMenuRow}
              onPress={() => {
                if (cardMenuBoard) setRenamingBoard(cardMenuBoard);
                setCardMenuBoardId(null);
              }}
            >
              <Ionicons name="pencil-outline" size={18} color="#111827" />
              <Text style={styles.cardMenuRowLabel}>Перейменувати</Text>
            </Pressable>
            <Pressable
              style={styles.cardMenuRow}
              onPress={() => cardMenuBoard && confirmDeleteBoard(cardMenuBoard)}
            >
              <Ionicons name="trash-outline" size={18} color="#EF4444" />
              <Text style={[styles.cardMenuRowLabel, { color: '#EF4444' }]}>Видалити</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <RenamePrompt
        visible={renamingBoard !== null}
        title="Назва дошки"
        initialValue={renamingBoard?.title ?? ''}
        onCancel={() => setRenamingBoard(null)}
        onSave={(title) => {
          if (renamingBoard) renameBoard(renamingBoard, title);
        }}
      />
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
    paddingTop: 90,
    paddingBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flexShrink: 1,
  },
  header: {
    fontSize: 46,
    fontWeight: '700',
    color: '#fff',
  },
  addButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,20,20,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
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
    backgroundColor: '#EDE9FE',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyLabel: {
    marginTop: 16,
    fontSize: 15,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
  },
  emptyHint: {
    marginTop: 6,
    fontSize: 13,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
  },
  list: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: 'rgba(176,176,176,0.5)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  rowIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
  },
  rowMeta: {
    fontSize: 12,
  },
  rowActionButton: {
    padding: 6,
  },
  cardMenuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  cardMenuSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  cardMenuHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  cardMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  cardMenuRowLabel: {
    fontSize: 15,
    color: '#111827',
  },
});
