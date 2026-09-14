import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  updateDoc,
} from '../firestore';
import { addDoc, ownedQuery, setDoc } from '../utils/owned';
import { db } from '../firebase';
import { BoardsStackParamList } from '../navigation';
import { BoardItem } from '../types';
import { colorForDocument } from '../utils/documentColor';
import BoardMiniMap from '../components/BoardMiniMap';
import RenamePrompt from '../components/RenamePrompt';
import ContentColumn, { MAX_CONTENT_WIDTH } from '../components/ContentColumn';
import { GLASS_BODY, GLASS_TEXT } from '../constants/glass';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { BlurView } from 'expo-blur';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassPortal } from '../components/GlassPortal';
import { useBlurTarget } from '../components/GlassTarget';
import { GLASS_ISLAND } from '../constants/glass';
import { CAPSULE_DROP, CHROME_TOP, RAIL_RIGHT } from '../constants/rail';
import { ask, confirm } from '../components/surfaces/Ask';

const ACCENT = '#8B5CF6';
// Where the content starts now that the screen has no header: the same
// line the capsule hangs from, so the first board sits level with it.
const RAIL_TOP_PAD = 96;
const boardsCollection = collection(db, 'boards');

// List of "Дошка" boards - Stage 1 of the board feature (see DEVELOPMENT_PLAN.md).
// Deliberately minimal next to Files/Links/Photos: no tags, groups, sort
// menu or bulk-select yet - a handful of boards doesn't need them, and
// nothing in the brief for this stage asks for them.
export default function BoardsListScreen() {
  const railBlurTarget = useBlurTarget();
  const railFocused = useIsFocused();
  const railInsets = useSafeAreaInsets();
  const navigation = useNavigation<NativeStackNavigationProp<BoardsStackParamList>>();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [boards, setBoards] = useState<BoardItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  // Rows or tiles. The mini-map in a row is 48px - enough to tell two
  // boards apart, not enough to see what's on one - so the tile view
  // exists to give it room.
  const [viewMode, setViewMode] = useState<'list' | 'cards'>('list');
  useEffect(() => {
    return onSnapshot(doc(db, 'settings', 'boardsPrefs'), (snapshot) => {
      const mode = snapshot.data()?.viewMode;
      if (mode === 'list' || mode === 'cards') setViewMode(mode);
    });
  }, []);
  async function changeViewMode(mode: 'list' | 'cards') {
    setViewMode(mode);
    await setDoc(doc(db, 'settings', 'boardsPrefs'), { viewMode: mode }, { merge: true });
  }
  const [renamingBoard, setRenamingBoard] = useState<BoardItem | null>(null);

  useEffect(() => {
    return onSnapshot(ownedQuery('boards'), (snapshot) => {
      setBoards(
        snapshot.docs
          .map((docSnapshot) => {
            const data = docSnapshot.data();
            return {
              id: docSnapshot.id,
              title: data.title ?? 'Без назви',
              cards: data.cards ?? [],
              columns: data.columns ?? [],
              createdAt: data.createdAt ?? 0,
              updatedAt: data.updatedAt ?? 0,
            };
          })
          .sort((a, b) => b.updatedAt - a.updatedAt)
      );
      setIsLoading(false);
    });
  }, []);


  // Same rule as a database's card grid: a tile stays near 300dp and the
  // grid takes as many columns as fit - two on a phone, more on a wide
  // screen. The content column caps the width it divides.
  const gridWidth = Math.min(windowWidth, MAX_CONTENT_WIDTH) - 40;
  const tileColumns = Math.max(2, Math.min(4, Math.floor(gridWidth / 300)));
  const tileWidth = Math.floor((gridWidth - 12 * (tileColumns - 1)) / tileColumns);

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

  // What to do with one board, asked by its own name - the sheet this
  // replaces was a white slab against the bottom edge, in nothing like
  // the app's own colours.
  function askBoardActions(board: BoardItem) {
    ask({
      title: board.title || 'Без назви',
      actions: [
        { id: 'rename', label: 'Перейменувати', icon: 'pencil-outline' },
        { id: 'delete', label: 'Видалити', icon: 'trash-outline', tone: 'danger' },
      ],
    }).then((answer) => {
      if (answer === 'rename') setRenamingBoard(board);
      if (answer === 'delete') confirmDeleteBoard(board);
    });
  }

  function confirmDeleteBoard(board: BoardItem) {
    confirm({
      title: 'Видалити дошку?',
      message: board.title || 'Без назви',
      confirmLabel: 'Видалити',
    }).then((yes) => {
      if (!yes) return;
      deleteDoc(doc(db, 'boards', board.id));
    });
  }

  function renderBoardRow(item: BoardItem) {
    const { background, text, textMuted } = colorForDocument(item.id);
    return (
      <Pressable
        key={item.id}
        style={[styles.row, { backgroundColor: background }]}
        onPress={() => openBoard(item)}
        onLongPress={() => askBoardActions(item)}
      >
        {/* The board's own layout in miniature, drawn from its cards -
            always current, because it is the cards. Falls back to the
            plain icon while there is nothing on the canvas to draw. */}
        <View style={styles.rowIcon}>
          {item.cards.length > 0 || (item.columns?.length ?? 0) > 0 ? (
            <BoardMiniMap cards={item.cards} columns={item.columns} width={48} height={48} />
          ) : (
            <Ionicons name="apps-outline" size={20} color={text} />
          )}
        </View>
        <View style={styles.rowBody}>
          <Text style={[styles.rowTitle, { color: text }]} numberOfLines={2}>
            {item.title || 'Без назви'}
          </Text>
          <Text style={[styles.rowMeta, { color: textMuted }]}>
            {item.cards.length} {item.cards.length === 1 ? 'картка' : 'карток'}
          </Text>
        </View>
        <Pressable hitSlop={8} onPress={() => askBoardActions(item)} style={styles.rowActionButton}>
          <Ionicons name="ellipsis-horizontal" size={16} color={textMuted} />
        </Pressable>
      </Pressable>
    );
  }

  // A board as a tile: its own miniature at a size where the cards are
  // cards, with the name under it.
  function renderBoardTile(item: BoardItem, tileWidth: number) {
    const { background, text, textMuted } = colorForDocument(item.id);
    const mapHeight = Math.round(tileWidth * 0.72);
    return (
      <Pressable
        key={item.id}
        style={[styles.tile, { width: tileWidth, backgroundColor: background }]}
        onPress={() => openBoard(item)}
        onLongPress={() => askBoardActions(item)}
      >
        <View style={[styles.tileMap, { height: mapHeight }]}>
          {item.cards.length > 0 || (item.columns?.length ?? 0) > 0 ? (
            <BoardMiniMap cards={item.cards} columns={item.columns} width={tileWidth} height={mapHeight} showText />
          ) : (
            <View style={styles.tileEmpty}>
              <Ionicons name="apps-outline" size={24} color={textMuted} />
            </View>
          )}
        </View>
        <View style={styles.tileBody}>
          <Text style={[styles.rowTitle, { color: text }]} numberOfLines={1}>
            {item.title || 'Без назви'}
          </Text>
          <Text style={[styles.rowMeta, { color: textMuted }]}>
            {item.cards.length} {item.cards.length === 1 ? 'картка' : 'карток'}
          </Text>
        </View>
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
      <ContentColumn>
      {/* The rail, as on every other screen: right edge, same width, same
          glass, hanging from the same line. Through the portal, which is
          where a blur is safe. The section's own title is gone with the
          header that carried it. */}
      {railFocused && (
        <GlassPortal>
          <View
            style={[styles.railWrap, { top: railInsets.top + CHROME_TOP + CAPSULE_DROP }]}
            pointerEvents="box-none"
          >
            <View style={styles.headerButtons}>
              <BlurView
                intensity={60}
                tint="dark"
                blurMethod="dimezisBlurView"
                blurTarget={railBlurTarget ?? undefined}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              <Pressable
                hitSlop={8}
                onPress={() => changeViewMode(viewMode === 'list' ? 'cards' : 'list')}
              >
                <Ionicons
                  name={viewMode === 'cards' ? 'reorder-four-outline' : 'grid-outline'}
                  size={24}
                  color="#fff"
                />
              </Pressable>
              <View style={styles.headerButtonsDivider} />
              <Pressable hitSlop={8} onPress={createBoard}>
                <Ionicons name="add-outline" size={24} color="#fff" />
              </Pressable>
            </View>
          </View>
        </GlassPortal>
      )}

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
          <ScrollView contentContainerStyle={viewMode === 'cards' ? styles.tileGrid : styles.list}>
            {viewMode === 'cards'
              ? boards.map((board) => renderBoardTile(board, tileWidth))
              : boards.map(renderBoardRow)}
          </ScrollView>
        )}


        <RenamePrompt
          visible={renamingBoard !== null}
          title="Назва дошки"
          initialValue={renamingBoard?.title ?? ''}
          onCancel={() => setRenamingBoard(null)}
          onSave={(title) => {
            if (renamingBoard) renameBoard(renamingBoard, title);
          }}
        />
      </ContentColumn>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  railWrap: {
    position: 'absolute',
    right: RAIL_RIGHT,
    alignItems: 'center',
  },
  // Stood on its end, like every other screen's.
  headerButtons: {
    alignItems: 'center',
    gap: 18,
    paddingVertical: 18,
    paddingHorizontal: 19,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: GLASS_ISLAND,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  // Turned with the capsule.
  headerButtonsDivider: {
    width: 20,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  emptyState: {
    flex: 1,
    paddingTop: RAIL_TOP_PAD,
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
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
  },
  emptyHint: {
    marginTop: 6,
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.55)',
    textAlign: 'center',
  },
  tileGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    paddingTop: RAIL_TOP_PAD,
    paddingHorizontal: 20,
    paddingBottom: 140,
  },
  tile: {
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(176,176,176,0.5)',
  },
  tileMap: {
    width: '100%',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  tileEmpty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBody: {
    paddingHorizontal: 10,
    paddingVertical: 8,
    gap: 2,
  },
  list: {
    paddingTop: RAIL_TOP_PAD,
    paddingHorizontal: 20,
    gap: 10,
    // Clears FloatingIslandTabBar the same way DocumentsScreen's list does -
    // without it the last board sits permanently under the island.
    paddingBottom: 120,
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
    width: 52,
    height: 52,
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
    fontFamily: FONT_SEMIBOLD,
  },
  rowMeta: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
  },
  rowActionButton: {
    padding: 6,
  },
});
