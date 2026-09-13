import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import Svg, { Defs, LinearGradient, Stop, Rect, Path, Text as SvgText } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { collection, doc, getDoc, onSnapshot, orderBy, query, updateDoc } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { RootStackParamList } from '../navigation';
import { SketchElement } from '../types';
import StickerComposer from '../components/StickerComposer';
import DocumentPickerModal, { PickableDocument } from '../components/DocumentPickerModal';
import ZoomableImageViewer from '../components/ZoomableImageViewer';
import SketchEditor from '../components/SketchEditor';
import DatabaseChrome, { menuStyles } from '../components/DatabaseChrome';
import { useDatabaseList } from '../hooks/useDatabaseList';
import { FONT_BOLD, FONT_MEDIUM, FONT_REGULAR } from '../utils/fonts';
import { notify } from '../components/surfaces/Ask';

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
  const [stickers, setStickers] = useState<StickerItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewingTrash, setViewingTrash] = useState(false);
  const [composerVisible, setComposerVisible] = useState(false);
  const [editingTextSticker, setEditingTextSticker] = useState<{ id: string; text: string } | null>(null);
  const [viewerImageUri, setViewerImageUri] = useState<string | null>(null);
  const [sketchEditing, setSketchEditing] = useState<StickerItem | null>(null);
  const [documentPicker, setDocumentPicker] = useState<{ documents: PickableDocument[] } | null>(null);

  useEffect(() => {
    // Kept unfiltered here (unlike the free-strip query on DocumentsScreen)
    // so the trash toggle below can switch views without a second
    // subscription - trashed is never actually deleted, just hidden.
    const stickersQuery = query(stickersCollection, orderBy('updatedAt', 'desc'));
    return onSnapshot(stickersQuery, (snapshot) => {
      setStickers(snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StickerItem, 'id'>) })));
      setIsLoading(false);
    });
  }, []);

  const activeStickers = stickers.filter((s) => !s.trashed);
  const trashedStickers = stickers.filter((s) => s.trashed);
  const freeCount = activeStickers.filter((s) => Object.keys(s.usedInDocuments ?? {}).length === 0).length;

  // The shared machine, for the part of it a sticker actually has: the
  // search and the sort. Stickers carry no tags and no groups - they are
  // scraps of paper, not filed records - so the drawer and the bulk
  // actions are left out rather than shown empty.
  const list = useDatabaseList<StickerItem>({
    prefsKey: 'stickersPrefs',
    groupKind: 'sticker',
    tagKind: 'sticker',
    items: viewingTrash ? trashedStickers : activeStickers,
    tagIdsOf: () => [],
    groupIdOf: () => undefined,
    titleOf: (s) => s.text || 'Стікер',
    createdAtOf: (s) => s.createdAt,
    updatedAtOf: (s) => s.updatedAt,
    searchTextOf: (s) => s.text ?? '',
  });
  const { displayed: visibleStickers, needle } = list;

  function openCreate() {
    if (freeCount >= FREE_STICKER_LIMIT) {
      notify('Забагато вільних стікерів', `Спершу розмісти якийсь із наявних ${FREE_STICKER_LIMIT} стікерів у документі чи календарі, щоб звільнити місце.`);
      return;
    }
    setEditingTextSticker(null);
    setComposerVisible(true);
  }

  function trashSticker(sticker: StickerItem) {
    updateDoc(doc(db, 'stickers', sticker.id), { trashed: true });
  }

  function restoreSticker(sticker: StickerItem) {
    updateDoc(doc(db, 'stickers', sticker.id), { trashed: false });
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
          ) : item.type === 'sketch' && (item.sketchElements?.length ?? 0) > 0 ? (
            <Svg width="100%" height="100%" viewBox={`0 0 ${item.sketchWidth || 1} ${item.sketchHeight || 1}`}>
              {(item.sketchElements ?? []).map((el, i) =>
                el.kind === 'text' ? (
                  <SvgText key={i} x={el.x} y={el.y} fill={el.color} fontSize={el.fontSize}>
                    {el.text}
                  </SvgText>
                ) : (
                  <Path
                    key={i}
                    d={el.d}
                    stroke={el.color}
                    strokeWidth={el.width}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )
              )}
            </Svg>
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
          {item.trashed ? (
            <Pressable style={styles.cardStatusRow} onPress={() => restoreSticker(item)}>
              <Ionicons name="arrow-undo-outline" size={13} color={STICKER_DARK} />
              <Text style={styles.cardStatus}>Відновити</Text>
            </Pressable>
          ) : usageCount === 0 ? (
            <Text style={styles.cardStatus}>вільний</Text>
          ) : (
            <Pressable style={styles.cardStatusRow} onPress={() => openUsage(item)}>
              <Ionicons name="document-text-outline" size={12} color={STICKER_DARK} />
              <Text style={styles.cardStatus}>{usageCount > 1 ? `у ${usageCount} документах` : 'у документі'}</Text>
            </Pressable>
          )}
          {!item.trashed && (
            <Pressable hitSlop={8} onPress={() => trashSticker(item)}>
              <Ionicons name="trash-outline" size={15} color={STICKER_DARK} />
            </Pressable>
          )}
        </View>
      </View>
    );
  }

  return (
    <DatabaseChrome
      list={list}
      accent={STICKER_YELLOW}
      accentGlass="rgba(251,233,122,0.55)"
      onBack={() => navigation.goBack()}
      searchPlaceholder="Пошук по тексту стікера"
      hideDrawer
      // Nothing to add while looking at what was thrown away.
      onAdd={viewingTrash ? undefined : openCreate}
      menuRows={(close) => (
        <Pressable
          style={menuStyles.menuRow}
          onPress={() => {
            close();
            setViewingTrash((v) => !v);
          }}
        >
          <Ionicons name={viewingTrash ? 'reader-outline' : 'trash-outline'} size={17} color="#111827" />
          <Text style={menuStyles.menuRowLabel}>{viewingTrash ? 'Стікери' : 'Смітник'}</Text>
        </Pressable>
      )}
      overlay={
        <>
          <StickerComposer
            visible={composerVisible}
            editingTextSticker={editingTextSticker}
            onClose={() => {
              setComposerVisible(false);
              setEditingTextSticker(null);
            }}
          />

          {viewerImageUri && (
            // See DocumentsScreen's own copy of this fix - Modal, not a
            // plain absolute overlay, or the real status bar shows through
            // as a solid black strip above the viewer.
            <Modal visible transparent animationType="fade" onRequestClose={() => setViewerImageUri(null)}>
              <GestureHandlerRootView style={{ flex: 1 }}>
                <ZoomableImageViewer uri={viewerImageUri} onClose={() => setViewerImageUri(null)} />
              </GestureHandlerRootView>
            </Modal>
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
        </>
      }
    >
      {(listTopPad, listProps) =>
        isLoading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : visibleStickers.length === 0 ? (
          <View style={styles.emptyState}>
            <View style={styles.emptyIcon}>
              <Ionicons name={viewingTrash ? 'trash-outline' : 'reader-outline'} size={32} color={STICKER_DARK} />
            </View>
            <Text style={styles.emptyLabel}>
              {needle ? 'Нічого не знайдено' : viewingTrash ? 'Смітник порожній' : 'Ще немає стікерів'}
            </Text>
            {!viewingTrash && !needle && (
              <Text style={styles.emptyHint}>Короткий текст, одне фото або малюнок - як паперовий стікер</Text>
            )}
          </View>
        ) : (
          <ScrollView {...listProps} contentContainerStyle={[styles.grid, { paddingTop: listTopPad }]}>
            {visibleStickers.map(renderSticker)}
          </ScrollView>
        )
      }
    </DatabaseChrome>
  );
}

const styles = StyleSheet.create({
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
    fontFamily: FONT_MEDIUM,
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
    fontFamily: FONT_REGULAR,
    color: STICKER_DARK,
    opacity: 0.75,
  },
});
