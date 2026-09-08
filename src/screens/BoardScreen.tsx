import { useEffect, useRef, useState } from 'react';
import { Image, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { doc, getDoc, getDocFromCache, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { RootStackParamList } from '../navigation';
import { Block, BoardCard } from '../types';
import AddExistingItemModal from '../components/AddExistingItemModal';
import RenamePrompt from '../components/RenamePrompt';

const AUTOSAVE_DELAY_MS = 600;
const DEFAULT_CARD_WIDTH = 160;
const MIN_SCALE = 0.4;
const MAX_SCALE = 3;
// A large fixed virtual canvas rather than an unbounded one - card x/y are
// plain offsets from this world's own top-left, and the world container
// itself starts centered on screen (see canvasSurface/world styles), so
// WORLD_CENTER is where a freshly created card lands by default.
const WORLD_SIZE = 6000;
const WORLD_CENTER = WORLD_SIZE / 2;
const STICKY_COLORS = ['#FEF3C7', '#DBEAFE', '#DCFCE7', '#FCE7F3', '#EDE9FE', '#FFE4E6'];

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function newTextCard(index: number): BoardCard {
  const jitter = (index % 6) * 24;
  return {
    id: generateId(),
    text: '',
    type: 'paragraph',
    createdAt: Date.now(),
    x: WORLD_CENTER - DEFAULT_CARD_WIDTH / 2 + jitter,
    y: WORLD_CENTER - 60 + jitter,
    width: DEFAULT_CARD_WIDTH,
    color: STICKY_COLORS[index % STICKY_COLORS.length],
  };
}

function cardFromExistingBlock(block: Block, index: number): BoardCard {
  const jitter = (index % 6) * 24;
  return {
    ...block,
    x: WORLD_CENTER - DEFAULT_CARD_WIDTH / 2 + jitter,
    y: WORLD_CENTER - 60 + jitter,
    width: DEFAULT_CARD_WIDTH,
  };
}

function fileIconFor(name: string): 'document-text-outline' | 'document-outline' {
  return name.toLowerCase().endsWith('.pdf') ? 'document-text-outline' : 'document-outline';
}

type DraggableCardProps = {
  card: BoardCard;
  canvasScale: ReturnType<typeof useSharedValue<number>>;
  onDragEnd: (id: string, x: number, y: number) => void;
  onTap: (card: BoardCard) => void;
};

// One card's own drag - a Pan gesture animates it smoothly on the UI thread
// (dragX/dragY shared values, no per-frame React state) and only commits the
// final x/y into the parent's `cards` state once, on release, mirroring the
// "animate live, commit on end" shape DocumentEditorScreen's own block-drag
// already uses for reordering. `canvasScale` is read inside the worklet so a
// screen-space drag distance still feels 1:1 with the finger while the
// canvas itself is pinch-zoomed. A Tap is raced against the Pan so a quick
// tap (edit a sticky's text) and an actual drag never fight each other.
function DraggableCard({ card, canvasScale, onDragEnd, onTap }: DraggableCardProps) {
  const dragX = useSharedValue(0);
  const dragY = useSharedValue(0);

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      dragX.value = e.translationX / canvasScale.value;
      dragY.value = e.translationY / canvasScale.value;
    })
    .onEnd(() => {
      const finalX = card.x + dragX.value;
      const finalY = card.y + dragY.value;
      dragX.value = 0;
      dragY.value = 0;
      runOnJS(onDragEnd)(card.id, finalX, finalY);
    });

  const tapGesture = Gesture.Tap().onEnd(() => {
    runOnJS(onTap)(card);
  });

  const gesture = Gesture.Race(panGesture, tapGesture);

  const animatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: dragX.value }, { translateY: dragY.value }],
  }));

  const type = card.type ?? 'paragraph';

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[styles.card, { left: card.x, top: card.y, width: card.width }, animatedStyle]}
      >
        {type === 'paragraph' ? (
          <View style={[styles.stickyCard, { backgroundColor: card.color ?? STICKY_COLORS[0] }]}>
            <Text style={styles.stickyText} numberOfLines={6}>
              {card.text || 'Порожня картка'}
            </Text>
          </View>
        ) : type === 'image' ? (
          <View style={styles.refCard}>
            {card.imageUri ? (
              <Image source={{ uri: card.imageUri }} style={styles.refThumb} resizeMode="cover" />
            ) : (
              <View style={[styles.refThumb, styles.refThumbPlaceholder]}>
                <Ionicons name="image-outline" size={22} color="#9CA3AF" />
              </View>
            )}
            <Text style={styles.refLabel} numberOfLines={2}>
              {card.imageTitle || 'Без назви'}
            </Text>
          </View>
        ) : type === 'file' ? (
          <View style={styles.refCard}>
            <View style={[styles.refThumb, styles.refThumbPlaceholder]}>
              <Ionicons name={fileIconFor(card.fileName ?? '')} size={22} color="#6B7280" />
            </View>
            <Text style={styles.refLabel} numberOfLines={2}>
              {card.fileTitle || card.fileName || 'Файл'}
            </Text>
          </View>
        ) : type === 'link' ? (
          <View style={styles.refCard}>
            {card.linkImageUrl ? (
              <Image source={{ uri: card.linkImageUrl }} style={styles.refThumb} resizeMode="cover" />
            ) : (
              <View style={[styles.refThumb, styles.refThumbPlaceholder]}>
                <Ionicons name="link-outline" size={22} color="#9CA3AF" />
              </View>
            )}
            <Text style={styles.refLabel} numberOfLines={2}>
              {card.linkTitle || card.linkSiteName || 'Посилання'}
            </Text>
          </View>
        ) : null}
      </Animated.View>
    </GestureDetector>
  );
}

type Props = NativeStackScreenProps<RootStackParamList, 'Board'>;

// Stage 1 of the "Дошка" feature (see DEVELOPMENT_PLAN.md / PROJECT_BRIEF.md):
// a pannable/zoomable canvas of cards. A card is deliberately just a `Block`
// plus x/y/width (see BoardCard in types.ts) - a card referencing an
// existing file/photo/link comes straight out of AddExistingItemModal
// unmodified, exactly like inserting one into a document does.
export default function BoardScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { params } = useRoute<Props['route']>();
  const { boardId } = params;

  const [title, setTitle] = useState('');
  const [cards, setCards] = useState<BoardCard[]>([]);
  const [isLoaded, setIsLoaded] = useState(false);
  const [addSheetVisible, setAddSheetVisible] = useState(false);
  const [existingItemPickerVisible, setExistingItemPickerVisible] = useState(false);
  const [editingCard, setEditingCard] = useState<BoardCard | null>(null);
  const [editingText, setEditingText] = useState('');
  const [renamingTitle, setRenamingTitle] = useState(false);

  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(0);
  const translateY = useSharedValue(0);
  const savedTranslateX = useSharedValue(0);
  const savedTranslateY = useSharedValue(0);

  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    (async () => {
      const docRef = doc(db, 'boards', boardId);
      let snapshot;
      try {
        snapshot = await getDocFromCache(docRef);
        if (!snapshot.exists()) throw new Error('not cached');
      } catch {
        snapshot = await getDoc(docRef);
      }
      const data = snapshot.data();
      setTitle(data?.title ?? 'Без назви');
      setCards(data?.cards ?? []);
      setIsLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [boardId]);

  useEffect(() => {
    if (!isLoaded) return;
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      setDoc(doc(db, 'boards', boardId), { title, cards, updatedAt: Date.now() }, { merge: true });
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, cards, isLoaded]);

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const panGesture = Gesture.Pan()
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  // Simultaneous here only combines the canvas's OWN pinch+pan with each
  // other. A card's Pan (see DraggableCard) sits on its own nested
  // GestureDetector and is never composed with this one - relying on
  // gesture-handler's default parent/child exclusivity (a touch starting on
  // a card activates the card's Pan first) to keep dragging a card from
  // also panning the canvas underneath it. This is the one part of Stage 1
  // with no proven on-device precedent yet - confirm it feels right before
  // building Stage 2 on top of it.
  const canvasGesture = Gesture.Simultaneous(pinchGesture, panGesture);

  const worldAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }, { translateY: translateY.value }, { scale: scale.value }],
  }));

  function addTextCard() {
    setAddSheetVisible(false);
    const card = newTextCard(cards.length);
    setCards((prev) => [...prev, card]);
    setEditingCard(card);
    setEditingText('');
  }

  function openExistingItemPicker() {
    setAddSheetVisible(false);
    setExistingItemPickerVisible(true);
  }

  function addExistingCard(block: Block) {
    setExistingItemPickerVisible(false);
    setCards((prev) => [...prev, cardFromExistingBlock(block, prev.length)]);
  }

  function handleCardTap(card: BoardCard) {
    if ((card.type ?? 'paragraph') !== 'paragraph') return;
    setEditingCard(card);
    setEditingText(card.text);
  }

  function commitCardDrag(id: string, x: number, y: number) {
    setCards((prev) => prev.map((c) => (c.id === id ? { ...c, x, y } : c)));
  }

  function saveEditingText() {
    if (editingCard) {
      setCards((prev) => prev.map((c) => (c.id === editingCard.id ? { ...c, text: editingText } : c)));
    }
    setEditingCard(null);
  }

  function setEditingCardColor(color: string) {
    if (!editingCard) return;
    setEditingCard({ ...editingCard, color });
    setCards((prev) => prev.map((c) => (c.id === editingCard.id ? { ...c, color } : c)));
  }

  const existingItemExcludeIds = new Set(
    cards
      .filter((c) => ((c.type ?? 'paragraph') === 'file' && c.fileUri) || ((c.type ?? 'paragraph') === 'image' && c.imageUri))
      .map((c) => c.id)
  );

  return (
    <View style={styles.container}>
      <GestureDetector gesture={canvasGesture}>
        <View style={[StyleSheet.absoluteFill, styles.canvasSurface]}>
          <Animated.View style={[styles.world, worldAnimatedStyle]}>
            {cards.map((card) => (
              <DraggableCard
                key={card.id}
                card={card}
                canvasScale={scale}
                onDragEnd={commitCardDrag}
                onTap={handleCardTap}
              />
            ))}
          </Animated.View>
        </View>
      </GestureDetector>

      <View style={styles.headerRow} pointerEvents="box-none">
        <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
          <Ionicons name="chevron-back" size={24} color="#111827" />
        </Pressable>
        <Pressable style={styles.titleTap} onPress={() => setRenamingTitle(true)}>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {title || 'Без назви'}
          </Text>
        </Pressable>
        <View style={{ width: 24 }} />
      </View>

      <Pressable style={styles.fab} onPress={() => setAddSheetVisible(true)}>
        <Ionicons name="add" size={26} color="#fff" />
      </Pressable>

      <Modal visible={addSheetVisible} transparent animationType="fade" onRequestClose={() => setAddSheetVisible(false)}>
        <Pressable style={styles.sheetBackdrop} onPress={() => setAddSheetVisible(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <View style={styles.sheetHandle} />
            <Pressable style={styles.sheetRow} onPress={addTextCard}>
              <Ionicons name="text-outline" size={18} color="#111827" />
              <Text style={styles.sheetRowLabel}>Текст</Text>
            </Pressable>
            <Pressable style={styles.sheetRow} onPress={openExistingItemPicker}>
              <Ionicons name="search-outline" size={18} color="#111827" />
              <Text style={styles.sheetRowLabel}>З бази даних</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <AddExistingItemModal
        visible={existingItemPickerVisible}
        onPick={addExistingCard}
        onClose={() => setExistingItemPickerVisible(false)}
        excludeIds={existingItemExcludeIds}
      />

      <RenamePrompt
        visible={renamingTitle}
        title="Назва дошки"
        initialValue={title}
        onCancel={() => setRenamingTitle(false)}
        onSave={(value) => {
          setRenamingTitle(false);
          setTitle(value);
        }}
      />

      {/* A plain overlay View sibling of the gesture-driven canvas, not a
          Modal and not a child of the canvas - same reasoning as
          SketchEditor's own text-entry overlay: a Modal here would fight a
          nested Modal (AddExistingItemModal) for focus, and a child of the
          canvas would fight its Pan/Pinch gesture for touch focus. */}
      {editingCard && (
        <View style={styles.textEditBackdrop}>
          <View style={styles.textEditCard}>
            <TextInput
              autoFocus
              multiline
              value={editingText}
              onChangeText={setEditingText}
              placeholder="Текст…"
              style={styles.textEditInput}
            />
            <View style={styles.textEditColors}>
              {STICKY_COLORS.map((color) => (
                <Pressable
                  key={color}
                  onPress={() => setEditingCardColor(color)}
                  style={[
                    styles.textEditColorSwatch,
                    { backgroundColor: color },
                    editingCard.color === color && styles.textEditColorSwatchActive,
                  ]}
                />
              ))}
            </View>
            <View style={styles.textEditButtons}>
              <Pressable style={styles.textEditCancel} onPress={() => setEditingCard(null)}>
                <Text style={styles.textEditCancelLabel}>Скасувати</Text>
              </Pressable>
              <Pressable style={styles.textEditSave} onPress={saveEditingText}>
                <Text style={styles.textEditSaveLabel}>Зберегти</Text>
              </Pressable>
            </View>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F3F4F6',
  },
  canvasSurface: {
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  world: {
    width: WORLD_SIZE,
    height: WORLD_SIZE,
  },
  card: {
    position: 'absolute',
  },
  stickyCard: {
    borderRadius: 8,
    padding: 12,
    minHeight: 90,
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  stickyText: {
    fontSize: 14,
    color: '#111827',
  },
  refCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 8,
    gap: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOpacity: 0.15,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  refThumb: {
    width: '100%',
    height: 90,
    borderRadius: 6,
  },
  refThumbPlaceholder: {
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  refLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#111827',
  },
  headerRow: {
    position: 'absolute',
    top: 56,
    left: 20,
    right: 20,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  titleTap: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.85)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  headerTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 32,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#8B5CF6',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#8B5CF6',
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 6,
  },
  sheetBackdrop: {
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
  },
  sheetHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  sheetRowLabel: {
    fontSize: 15,
    color: '#111827',
  },
  textEditBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(17,24,39,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  textEditCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 16,
    gap: 12,
  },
  textEditInput: {
    minHeight: 100,
    fontSize: 15,
    color: '#111827',
    textAlignVertical: 'top',
  },
  textEditColors: {
    flexDirection: 'row',
    gap: 8,
  },
  textEditColorSwatch: {
    width: 26,
    height: 26,
    borderRadius: 13,
  },
  textEditColorSwatchActive: {
    borderWidth: 2,
    borderColor: '#111827',
  },
  textEditButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
  },
  textEditCancel: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  textEditCancelLabel: {
    fontSize: 15,
    color: '#6B7280',
  },
  textEditSave: {
    backgroundColor: '#8B5CF6',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  textEditSaveLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
});
