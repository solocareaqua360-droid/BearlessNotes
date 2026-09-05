import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import * as Sharing from 'expo-sharing';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Block, Tag } from '../types';
import { RootStackParamList } from '../navigation';
import ZoomableImageViewer, { ViewerAction } from '../components/ZoomableImageViewer';
import RenamePrompt from '../components/RenamePrompt';
import DocumentPickerModal, { PickableDocument } from '../components/DocumentPickerModal';
import UndoToast from '../components/UndoToast';
import TagChips from '../components/TagChips';
import TagPicker from '../components/TagPicker';
import { usePendingDelete } from '../hooks/usePendingDelete';
import { useTags, detachTagFromDeletedItem } from '../hooks/useTags';

const ACCENT = '#EC4899';
const DOWNLOAD_DIR_STORAGE_KEY = 'bearlessNotes.downloadDirUri';

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type PhotoItem = {
  id: string;
  imageUri: string;
  title?: string;
  documentIds: string[];
  tagIds: string[];
};

// Same "pick a folder once, remember it" download flow already built for
// image/file blocks in DocumentEditorScreen - duplicated here (rather than
// exported and shared) since it's a handful of lines and the two screens
// otherwise have nothing else in common worth coupling them for.
async function downloadPhoto(uri: string) {
  const stored = await AsyncStorage.getItem(DOWNLOAD_DIR_STORAGE_KEY);
  let dirUri = stored;
  if (!dirUri) {
    const permission = await LegacyFileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
    if (!permission.granted) return;
    dirUri = permission.directoryUri;
    await AsyncStorage.setItem(DOWNLOAD_DIR_STORAGE_KEY, dirUri);
  }
  const destUri = await LegacyFileSystem.StorageAccessFramework.createFileAsync(
    dirUri,
    `photo-${Date.now()}`,
    'image/jpeg'
  );
  const content = await LegacyFileSystem.readAsStringAsync(uri, { encoding: 'base64' });
  await LegacyFileSystem.writeAsStringAsync(destUri, content, { encoding: 'base64' });
}

function PhotoThumb({
  uri,
  docCount,
  tags,
  onTagPress,
}: {
  uri: string;
  docCount: number;
  tags: Tag[];
  onTagPress: () => void;
}) {
  return (
    <View style={styles.cellImageWrap}>
      <Image source={{ uri }} style={styles.cellImage} resizeMode="cover" />
      {docCount > 1 && (
        <View style={styles.cellBadge}>
          <Text style={styles.cellBadgeLabel}>{docCount}</Text>
        </View>
      )}
      <View style={styles.cellTagRow}>
        <TagChips tags={tags} onPress={onTagPress} />
      </View>
    </View>
  );
}

export default function PhotosScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [photos, setPhotos] = useState<PhotoItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [viewerPhotoId, setViewerPhotoId] = useState<string | null>(null);
  const [renamingPhoto, setRenamingPhoto] = useState<PhotoItem | null>(null);
  const [documentPicker, setDocumentPicker] = useState<{ photo: PhotoItem; documents: PickableDocument[] } | null>(
    null
  );
  const [tagPickerForId, setTagPickerForId] = useState<string | null>(null);
  const { filterPending, requestDelete, undo, toast } = usePendingDelete<PhotoItem>();
  const { tags, attachTag, detachTag, createAndAttachTag, renameTag } = useTags();

  useEffect(() => {
    const photosQuery = query(collection(db, 'photos'), orderBy('updatedAt', 'desc'));
    return onSnapshot(photosQuery, (snapshot) => {
      setPhotos(
        snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          return {
            id: docSnapshot.id,
            imageUri: data.imageUri,
            title: data.title,
            documentIds: Object.keys(data.usedInDocuments ?? {}),
            tagIds: data.tagIds ?? [],
          };
        })
      );
      setIsLoading(false);
    });
  }, []);

  const displayedPhotos = filterPending(photos);
  const viewerPhoto = viewerPhotoId ? photos.find((p) => p.id === viewerPhotoId) ?? null : null;
  const tagPickerPhoto = tagPickerForId ? photos.find((p) => p.id === tagPickerForId) ?? null : null;

  function openSortOrFilter() {
    navigation.navigate('Placeholder', { icon: 'options-outline', label: 'Скоро' });
  }

  async function openDocumentIcon(photo: PhotoItem) {
    if (photo.documentIds.length === 0) return;
    if (photo.documentIds.length === 1) {
      setViewerPhotoId(null);
      navigation.navigate('Editor', { documentId: photo.documentIds[0] });
      return;
    }
    const documents = await Promise.all(
      photo.documentIds.map(async (id) => {
        const snapshot = await getDoc(doc(db, 'documents', id));
        return { id, title: (snapshot.data()?.title as string) || 'Без назви' };
      })
    );
    setViewerPhotoId(null);
    setDocumentPicker({ photo, documents });
  }

  function pickDocument(documentId: string) {
    setDocumentPicker(null);
    navigation.navigate('Editor', { documentId });
  }

  async function shareImage(uri: string) {
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) return;
      await Sharing.shareAsync(uri);
    } catch {
      // No sharing app available or the user backed out - nothing to do.
    }
  }

  // Rename is always available, and propagates into every document block
  // that shows this photo - same two-way-sync pattern as links.
  async function renamePhoto(photo: PhotoItem, title: string) {
    setRenamingPhoto(null);
    await updateDoc(doc(db, 'photos', photo.id), { title });
    await Promise.all(
      photo.documentIds.map(async (docId) => {
        const documentRef = doc(db, 'documents', docId);
        const snapshot = await getDoc(documentRef);
        const data = snapshot.data();
        if (!data) return;
        const blocks: Block[] = data.blocks ?? [];
        let changed = false;
        const updatedBlocks = blocks.map((b) => {
          if (b.id === photo.id && (b.type ?? 'paragraph') === 'image') {
            changed = true;
            return { ...b, imageTitle: title };
          }
          return b;
        });
        if (changed) await updateDoc(documentRef, { blocks: updatedBlocks });
      })
    );
  }

  function confirmDeletePhoto(photo: PhotoItem) {
    setViewerPhotoId(null);
    requestDelete(photo, 'Фото видалено', () => deletePhoto(photo));
  }

  async function deletePhoto(photo: PhotoItem) {
    deleteDoc(doc(db, 'photos', photo.id));
    await Promise.all(
      photo.tagIds.map((tagId) => {
        const tag = tags.find((t) => t.id === tagId);
        return tag ? detachTagFromDeletedItem(tag, 'photo', photo.id) : Promise.resolve();
      })
    );
    await Promise.all(
      photo.documentIds.map(async (docId) => {
        const documentRef = doc(db, 'documents', docId);
        const snapshot = await getDoc(documentRef);
        const data = snapshot.data();
        if (!data) return;
        const blocks: Block[] = data.blocks ?? [];
        const remaining = blocks.filter((b) => b.id !== photo.id);
        if (remaining.length !== blocks.length) {
          updateDoc(documentRef, {
            blocks: remaining.length > 0 ? remaining : [{ id: generateId(), text: '' }],
          });
        }
      })
    );
  }

  function viewerActionsFor(photo: PhotoItem): ViewerAction[] {
    return [
      { key: 'rename', icon: 'pencil-outline', label: 'Назва', onPress: () => setRenamingPhoto(photo) },
      {
        key: 'tags',
        icon: 'pricetag-outline',
        label: 'Теги',
        onPress: () => {
          setViewerPhotoId(null);
          setTagPickerForId(photo.id);
        },
      },
      {
        key: 'document',
        icon: 'document-text-outline',
        label: 'Документ',
        badge: photo.documentIds.length,
        onPress: () => openDocumentIcon(photo),
      },
      { key: 'share', icon: 'share-social-outline', label: 'Поділитись', onPress: () => shareImage(photo.imageUri) },
      {
        key: 'download',
        icon: 'download-outline',
        label: 'Завантажити',
        onPress: () => downloadPhoto(photo.imageUri),
      },
      {
        key: 'delete',
        icon: 'trash-outline',
        label: 'Видалити',
        color: '#F87171',
        onPress: () => confirmDeletePhoto(photo),
      },
    ];
  }

  if (isLoading) {
    return (
      <View style={[styles.container, styles.emptyState]}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Фото</Text>
        <View style={styles.headerIcons}>
          <Pressable hitSlop={8} onPress={openSortOrFilter}>
            <Ionicons name="swap-vertical-outline" size={20} color="#6B7280" />
          </Pressable>
          <Pressable hitSlop={8} onPress={openSortOrFilter}>
            <Ionicons name="filter-outline" size={20} color="#6B7280" />
          </Pressable>
        </View>
      </View>

      {displayedPhotos.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="image-outline" size={32} color={ACCENT} />
          </View>
          <Text style={styles.emptyLabel}>Ще немає фото</Text>
          <Text style={styles.emptyHint}>
            Додайте зображення як блок у будь-якому документі - воно з'явиться тут само
          </Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.grid}>
          {displayedPhotos.map((photo) => (
            <Pressable key={photo.id} style={styles.cell} onPress={() => setViewerPhotoId(photo.id)}>
              <PhotoThumb
                uri={photo.imageUri}
                docCount={photo.documentIds.length}
                tags={tags.filter((t) => photo.tagIds.includes(t.id))}
                onTagPress={() => setTagPickerForId(photo.id)}
              />
            </Pressable>
          ))}
        </ScrollView>
      )}

      {viewerPhoto && (
        <Modal visible transparent animationType="fade" onRequestClose={() => setViewerPhotoId(null)}>
          <GestureHandlerRootView style={{ flex: 1 }}>
            <ZoomableImageViewer
              uri={viewerPhoto.imageUri}
              onClose={() => setViewerPhotoId(null)}
              actions={viewerActionsFor(viewerPhoto)}
            />
          </GestureHandlerRootView>
        </Modal>
      )}

      <RenamePrompt
        visible={renamingPhoto !== null}
        title="Назва фото"
        initialValue={renamingPhoto?.title ?? ''}
        onCancel={() => setRenamingPhoto(null)}
        onSave={(title) => {
          if (renamingPhoto) renamePhoto(renamingPhoto, title);
        }}
      />

      <DocumentPickerModal
        visible={documentPicker !== null}
        subtitle={documentPicker?.photo.title}
        documents={documentPicker?.documents ?? []}
        onPick={pickDocument}
        onClose={() => setDocumentPicker(null)}
      />

      <TagPicker
        visible={tagPickerPhoto !== null}
        kind="photo"
        tags={tags}
        selectedTagIds={tagPickerPhoto?.tagIds ?? []}
        onAttach={(tag) => tagPickerPhoto && attachTag(tag, 'photo', tagPickerPhoto.id, 'photos')}
        onDetach={(tag) => tagPickerPhoto && detachTag(tag, 'photo', tagPickerPhoto.id, 'photos')}
        onCreateAndAttach={(path, icon, color) =>
          tagPickerPhoto && createAndAttachTag(path, icon, color, 'photo', tagPickerPhoto.id, 'photos')
        }
        onRenameTag={renameTag}
        onClose={() => setTagPickerForId(null)}
      />

      {toast && <UndoToast message={toast.message} onUndo={() => undo(toast.id)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 8,
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  headerIcons: {
    flexDirection: 'row',
    gap: 16,
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
    backgroundColor: '#FCE7F3',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyLabel: {
    marginTop: 16,
    fontSize: 15,
    color: '#111827',
    textAlign: 'center',
  },
  emptyHint: {
    marginTop: 6,
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    gap: 12,
  },
  cell: {
    width: '47%',
    aspectRatio: 1,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: '#F3F4F6',
  },
  cellImageWrap: {
    flex: 1,
  },
  cellImage: {
    width: '100%',
    height: '100%',
  },
  cellBadge: {
    position: 'absolute',
    top: 8,
    right: 8,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  cellBadgeLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  cellTagRow: {
    position: 'absolute',
    left: 8,
    right: 8,
    bottom: 8,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
});
