import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import { Block } from '../types';
import { blockFromFile, blockFromLink, blockFromPhoto } from '../utils/copyToNote';

const ACCENT = '#3B82F6';
const filesCollection = collection(db, 'files');
const photosCollection = collection(db, 'photos');
const linksCollection = collection(db, 'links');

type Tab = 'file' | 'photo' | 'link';

type FileRow = {
  id: string;
  fileUri: string;
  fileName: string;
  mimeType?: string;
  title?: string;
  createdAt?: number;
  driveFileId?: string;
  driveBytes?: number;
};
type PhotoRow = {
  id: string;
  imageUri: string;
  imageFit?: 'contain' | 'cover';
  title?: string;
  createdAt?: number;
  driveFileId?: string;
  driveBytes?: number;
};
type LinkRow = { id: string; url: string; title?: string; imageUrl?: string; siteName?: string };

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

type Props = {
  visible: boolean;
  onPick: (block: Block) => void;
  onClose: () => void;
  // File/photo blocks reuse the record's OWN id (see blockFromFile/
  // blockFromPhoto) - picking one already present in this document would
  // put two blocks on the same id in the same list, a real React key
  // collision, not just a harmless duplicate. Links always get a fresh id
  // (blockFromLink), so they're never excluded here - re-adding one is just
  // a redundant card, not a collision.
  excludeIds?: Set<string>;
};

// The reverse direction of CopyToNoteModal (Files/Photos/Links → a note) -
// this is "a note → an existing Files/Photos/Links item", triggered from
// the "/" menu. Picking a row inserts a block referencing that SAME
// underlying record (blockFromFile/blockFromPhoto/blockFromLink, the exact
// helpers CopyToNoteModal already uses) rather than creating a duplicate.
export default function AddExistingItemModal({ visible, onPick, onClose, excludeIds }: Props) {
  const [tab, setTab] = useState<Tab>('file');
  const [searchQuery, setSearchQuery] = useState('');
  const [files, setFiles] = useState<FileRow[]>([]);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);

  useEffect(() => {
    if (!visible) return;
    return onSnapshot(query(filesCollection, orderBy('updatedAt', 'desc')), (snapshot) => {
      setFiles(snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<FileRow, 'id'>) })));
    });
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    return onSnapshot(query(photosCollection, orderBy('updatedAt', 'desc')), (snapshot) => {
      setPhotos(snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PhotoRow, 'id'>) })));
    });
  }, [visible]);

  useEffect(() => {
    if (!visible) return;
    return onSnapshot(query(linksCollection, orderBy('updatedAt', 'desc')), (snapshot) => {
      setLinks(snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<LinkRow, 'id'>) })));
    });
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      setSearchQuery('');
      setTab('file');
    }
  }, [visible]);

  const needle = searchQuery.trim().toLowerCase();
  const filteredFiles = files.filter(
    (f) => !excludeIds?.has(f.id) && (f.title || f.fileName).toLowerCase().includes(needle)
  );
  const filteredPhotos = photos.filter(
    (p) => !excludeIds?.has(p.id) && (p.title || 'Без назви').toLowerCase().includes(needle)
  );
  const filteredLinks = links.filter((l) => (l.title || hostnameOf(l.url)).toLowerCase().includes(needle));

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>Додати з бази даних</Text>

          <View style={styles.tabRow}>
            <Pressable style={[styles.tab, tab === 'file' && styles.tabActive]} onPress={() => setTab('file')}>
              <Text style={[styles.tabLabel, tab === 'file' && styles.tabLabelActive]}>Файли</Text>
            </Pressable>
            <Pressable style={[styles.tab, tab === 'photo' && styles.tabActive]} onPress={() => setTab('photo')}>
              <Text style={[styles.tabLabel, tab === 'photo' && styles.tabLabelActive]}>Фото</Text>
            </Pressable>
            <Pressable style={[styles.tab, tab === 'link' && styles.tabActive]} onPress={() => setTab('link')}>
              <Text style={[styles.tabLabel, tab === 'link' && styles.tabLabelActive]}>Посилання</Text>
            </Pressable>
          </View>

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

          <ScrollView style={styles.list}>
            {tab === 'file' &&
              (filteredFiles.length === 0 ? (
                <Text style={styles.emptyLabel}>Нічого не знайдено</Text>
              ) : (
                filteredFiles.map((f) => (
                  <Pressable key={f.id} style={styles.row} onPress={() => onPick(blockFromFile(f))}>
                    <View style={styles.docIcon}>
                      <Ionicons name="document-outline" size={16} color={ACCENT} />
                    </View>
                    <Text style={styles.rowText} numberOfLines={1}>
                      {f.title || f.fileName}
                    </Text>
                  </Pressable>
                ))
              ))}

            {tab === 'photo' &&
              (filteredPhotos.length === 0 ? (
                <Text style={styles.emptyLabel}>Нічого не знайдено</Text>
              ) : (
                filteredPhotos.map((p) => (
                  <Pressable key={p.id} style={styles.row} onPress={() => onPick(blockFromPhoto(p))}>
                    <Image source={{ uri: p.imageUri }} style={styles.photoThumb} resizeMode="cover" />
                    <Text style={styles.rowText} numberOfLines={1}>
                      {p.title || 'Без назви'}
                    </Text>
                  </Pressable>
                ))
              ))}

            {tab === 'link' &&
              (filteredLinks.length === 0 ? (
                <Text style={styles.emptyLabel}>Нічого не знайдено</Text>
              ) : (
                filteredLinks.map((l) => (
                  <Pressable key={l.id} style={styles.row} onPress={() => onPick(blockFromLink(l))}>
                    <View style={styles.docIcon}>
                      <Ionicons name="link-outline" size={16} color={ACCENT} />
                    </View>
                    <Text style={styles.rowText} numberOfLines={1}>
                      {l.title || hostnameOf(l.url)}
                    </Text>
                  </Pressable>
                ))
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
    maxHeight: '75%',
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
    marginBottom: 10,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  tab: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
  },
  tabActive: {
    backgroundColor: ACCENT,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#6B7280',
  },
  tabLabelActive: {
    color: '#fff',
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
  photoThumb: {
    width: 28,
    height: 28,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  rowText: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
  },
});
