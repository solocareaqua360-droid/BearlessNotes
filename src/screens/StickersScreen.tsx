import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { collection, doc, getDoc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { RootStackParamList } from '../navigation';
import { SketchElement } from '../types';
import StickerComposer from '../components/StickerComposer';
import DocumentPickerModal, { PickableDocument } from '../components/DocumentPickerModal';
import ZoomableImageViewer from '../components/ZoomableImageViewer';
import SketchEditor from '../components/SketchEditor';

const STICKER_YELLOW = '#FBE97A';
const STICKER_DARK = '#4a3f05';
const stickersCollection = collection(db, 'stickers');
const FREE_STICKER_LIMIT = 10;

type StickerItem = {
  id: string;
  type: 'paragraph' | 'image' | 'sketch';
  text?: string;
  imageUri?: string;
  driveFileId?: string;
  driveBytes?: number;
  sketchElements?: SketchElement[];
  sketchWidth?: number;
  sketchHeight?: number;
  usedInDocuments: Record<string, true>;
  trashed?: boolean;
  createdAt?: number;
  updatedAt: number;
};

export default function StickersScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [stickers, setStickers] = useState<StickerItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [composerVisible, setComposerVisible] = useState(false);
  const [editingTextSticker, setEditingTextSticker] = useState<{ id: string; text: string } | null>(null);
  const [viewerImageUri, setViewerImageUri] = useState<string | null>(null);
  const [sketchEditing, setSketchEditing] = useState<StickerItem | null>(null);
  const [documentPicker, setDocumentPicker] = useState<{ documents: PickableDocument[] } | null>(null);

  useEffect(() => {
    const stickersQuery = query(stickersCollection, orderBy('updatedAt', 'desc'));
    return onSnapshot(stickersQuery, (snapshot) => {
      setStickers(
        snapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<StickerItem, 'id'>) }))
          .filter((s) => !s.trashed)
      );
      setIsLoading(false);
    });
  }, []);

  const freeCount = stickers.filter((s) => Object.keys(s.usedInDocuments ?? {}).length === 0).length;

  function openCreate() {
    if (freeCount >= FREE_STICKER_LIMIT) {
      Alert.alert(
        'Забагато вільних стікерів',
        `Спершу розмісти якийсь із наявних ${FREE_STICKER_LIMIT} стікерів у документі чи календарі, щоб звільнити місце.`
      );
      return;
    }
    setEditingTextSticker(null);
    setComposerVisible(true);
  }

  function trashSticker(sticker: StickerItem) {
    updateDoc(doc(db, 'stickers', sticker.id), { trashed: true });
  }

  async function openSticker(sticker: StickerItem) {
    if (sticker.type === 'paragraph') {
      setEditingTextSticker({ id: sticker.id, text: sticker.text ?? '' });
      setComposerVisible(true);
    } else if (sticker.type === 'image' && sticker.imageUri) {
      setViewerImageUri(sticker.imageUri);
    } else if (sticker.type === 'sketch') {
      setSketchEditing(sticker);
    }
  }

  async function openUsage(sticker: StickerItem) {
    const ids = Object.keys(sticker.usedInDocuments ?? {});
    if (ids.length === 0) return;
    if (ids.length === 1) {
      navigation.navigate('Editor', { documentId: ids[0] });
      return;
    }
    const documents = await Promise.all(
      ids.map(async (id) => {
        const snapshot = await getDoc(doc(db, 'documents', id));
        return { id, title: (snapshot.data()?.title as string) || 'Без назви' };
      })
    );
    setDocumentPicker({ documents });
  }

  function saveSketchEdit(elements: SketchElement[], width: number, height: number) {
    if (!sketchEditing) return;
    updateDoc(doc(db, 'stickers', sketchEditing.id), {
      sketchElements: elements,
      sketchWidth: width,
      sketchHeight: height,
      updatedAt: Date.now(),
    });
    setSketchEditing(null);
  }

  function renderSticker(item: StickerItem) {
    const usageCount = Object.keys(item.usedInDocuments ?? {}).length;
    return (
      <View key={item.id} style={styles.card}>
        <Pressable style={styles.cardTap} onPress={() => openSticker(item)}>
          {item.type === 'image' && item.imageUri ? (
            <Image source={{ uri: item.imageUri }} style={styles.cardImage} resizeMode="cover" />
          ) : item.type === 'sketch' ? (
            <View style={styles.cardIconWrap}>
              <Ionicons name="brush-outline" size={34} color={STICKER_DARK} />
            </View>
          ) : (
            <Text style={styles.cardText} numberOfLines={6}>
              {item.text || 'Порожній стікер'}
            </Text>
          )}
        </Pressable>
        <View style={styles.cardFooter}>
          {usageCount === 0 ? (
            <Text style={styles.cardStatus}>вільний</Text>
          ) : (
            <Pressable style={styles.cardStatusRow} onPress={() => openUsage(item)}>
              <Ionicons name="document-text-outline" size={12} color={STICKER_DARK} />
              <Text style={styles.cardStatus}>{usageCount > 1 ? `у ${usageCount} документах` : 'у документі'}</Text>
            </Pressable>
          )}
          <Pressable hitSlop={8} onPress={() => trashSticker(item)}>
            <Ionicons name="trash-outline" size={15} color={STICKER_DARK} />
          </Pressable>
        </View>
      </View>
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
          <LinearGradient id="stickersBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.03" stopColor="#705648" />
            <Stop offset="0.52" stopColor="#69736E" />
            <Stop offset="1" stopColor="#000000" />
          </LinearGradient>
        </Defs>
        <Rect width={windowWidth + 2} height={windowHeight + 2} fill="url(#stickersBg)" />
      </Svg>

      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.header}>Стікери</Text>
        </View>
      </View>

      {isLoading ? (
        <View style={styles.emptyState}>
          <ActivityIndicator color="#fff" />
        </View>
      ) : stickers.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="reader-outline" size={32} color={STICKER_DARK} />
          </View>
          <Text style={styles.emptyLabel}>Ще немає стікерів</Text>
          <Text style={styles.emptyHint}>Короткий текст, одне фото або малюнок - як паперовий стікер</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.grid}>{stickers.map(renderSticker)}</ScrollView>
      )}

      <Pressable style={styles.fab} onPress={openCreate}>
        <Ionicons name="add" size={26} color={STICKER_DARK} />
      </Pressable>

      <StickerComposer
        visible={composerVisible}
        editingTextSticker={editingTextSticker}
        onClose={() => {
          setComposerVisible(false);
          setEditingTextSticker(null);
        }}
      />

      {viewerImageUri && (
        <GestureHandlerRootView style={StyleSheet.absoluteFill}>
          <ZoomableImageViewer uri={viewerImageUri} onClose={() => setViewerImageUri(null)} />
        </GestureHandlerRootView>
      )}

      <SketchEditor
        visible={sketchEditing !== null}
        initialElements={sketchEditing?.sketchElements ?? []}
        onSave={saveSketchEdit}
        onClose={() => setSketchEditing(null)}
      />

      <DocumentPickerModal
        visible={documentPicker !== null}
        documents={documentPicker?.documents ?? []}
        onPick={(documentId) => {
          setDocumentPicker(null);
          navigation.navigate('Editor', { documentId });
        }}
        onClose={() => setDocumentPicker(null)}
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
  },
  header: {
    fontSize: 46,
    fontWeight: '700',
    color: '#fff',
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
    backgroundColor: STICKER_YELLOW,
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
  grid: {
    paddingHorizontal: 20,
    paddingBottom: 100,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
  },
  card: {
    width: '47%',
    borderRadius: 10,
    backgroundColor: STICKER_YELLOW,
    padding: 10,
    gap: 8,
    shadowColor: '#000',
    shadowOpacity: 0.2,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  cardTap: {
    height: 130,
    justifyContent: 'center',
  },
  cardImage: {
    width: '100%',
    height: '100%',
    borderRadius: 6,
  },
  cardIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    height: '100%',
  },
  cardText: {
    fontSize: 13,
    lineHeight: 18,
    color: STICKER_DARK,
    fontWeight: '500',
  },
  cardFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  cardStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  cardStatus: {
    fontSize: 10,
    color: STICKER_DARK,
    opacity: 0.75,
  },
  fab: {
    position: 'absolute',
    right: 20,
    bottom: 32,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: STICKER_YELLOW,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
    elevation: 6,
  },
});
