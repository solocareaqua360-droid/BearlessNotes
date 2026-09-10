import { useEffect, useState } from 'react';
import { Image, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { collection, onSnapshot, orderBy, query } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { Block, CustomDatabase, CustomDatabaseRow, CustomDatabaseView, SketchElement } from '../types';
import {
  blockFromCustomRow,
  blockFromCustomView,
  blockFromFile,
  blockFromLink,
  blockFromPhoto,
  blockFromSticker,
} from '../utils/copyToNote';
import { rowTitleOf } from '../utils/customRowDisplay';

const ACCENT = '#3B82F6';
const STICKER_YELLOW = '#FBE97A';
const filesCollection = collection(db, 'files');
const photosCollection = collection(db, 'photos');
const linksCollection = collection(db, 'links');
const documentsCollection = collection(db, 'documents');
const stickersCollection = collection(db, 'stickers');
const customDatabasesCollection = collection(db, 'customDatabases');
const customRowsCollection = collection(db, 'customDatabaseRows');
const customViewsCollection = collection(db, 'customDatabaseViews');

// Links split into video/geo/other exactly like LinksScreen's own tabs
// (see LinksScreen.tsx's categoryOf) - they're one Firestore collection but
// three different-feeling databases in the rest of the app, so lumping them
// into one "Посилання" tab here would be the one place in the app where
// that split doesn't hold. 'document' only ever shows up when the caller
// opts in via `includeDocuments` (see Props) - DocumentEditorScreen's own
// use of this modal never does, since a document can't nest as a block
// inside another document.
type Tab = 'file' | 'photo' | 'video' | 'geo' | 'other' | 'document' | 'sticker' | 'customDb';

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
type DocumentRow = { id: string; title: string };
type StickerRow = {
  id: string;
  type: 'paragraph' | 'image' | 'sketch';
  text?: string;
  imageUri?: string;
  driveFileId?: string;
  driveBytes?: number;
  sketchElements?: SketchElement[];
  sketchWidth?: number;
  sketchHeight?: number;
  createdAt?: number;
  trashed?: boolean;
};

function labelForSticker(s: StickerRow): string {
  if (s.type === 'paragraph') return s.text || 'Порожній стікер';
  if (s.type === 'image') return 'Фото-стікер';
  return 'Малюнок-стікер';
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

// Identical to LinksScreen.tsx's own categoryOf - kept as its own copy
// rather than shared, same as that file's fileIconFor/fileIconColorFor
// duplicates elsewhere, since the two call sites have nothing else in
// common.
function categoryOf(link: LinkRow): 'video' | 'geo' | 'other' {
  const siteName = link.siteName ?? '';
  if (siteName.includes('YouTube') || siteName.includes('TikTok')) return 'video';
  if (siteName === 'Геоточка') return 'geo';
  return 'other';
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
  // Adds a "Документи" tab (regular documents, daily notes excluded - same
  // filter DocumentsScreen/SearchScreen/CopyToNoteModal use) and routes a
  // pick through `onPickDocument` instead of `onPick`, since a document
  // reference isn't a `Block` - only BoardScreen sets this.
  includeDocuments?: boolean;
  onPickDocument?: (item: DocumentRow) => void;
  // Adds a "Бази" tab (rows of the user's own databases, as 'dbRow'
  // blocks). Opt-in because the board can't render that block type yet -
  // only DocumentEditorScreen sets it.
  includeCustomDatabases?: boolean;
};

// The reverse direction of CopyToNoteModal (Files/Photos/Links → a note) -
// this is "a note → an existing Files/Photos/Links item", triggered from
// the "/" menu. Picking a row inserts a block referencing that SAME
// underlying record (blockFromFile/blockFromPhoto/blockFromLink, the exact
// helpers CopyToNoteModal already uses) rather than creating a duplicate.
export default function AddExistingItemModal({
  visible,
  onPick,
  onClose,
  excludeIds,
  includeDocuments,
  onPickDocument,
  includeCustomDatabases,
}: Props) {
  const [tab, setTab] = useState<Tab>('file');
  const [searchQuery, setSearchQuery] = useState('');
  const [files, setFiles] = useState<FileRow[]>([]);
  const [photos, setPhotos] = useState<PhotoRow[]>([]);
  const [links, setLinks] = useState<LinkRow[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);
  const [stickers, setStickers] = useState<StickerRow[]>([]);
  // The "Бази" tab is two levels deep: pick a database, then one of its
  // rows. One tab rather than a tab per database, since there's no upper
  // bound on how many the user creates.
  const [customDatabases, setCustomDatabases] = useState<CustomDatabase[]>([]);
  const [customRows, setCustomRows] = useState<CustomDatabaseRow[]>([]);
  const [customViews, setCustomViews] = useState<CustomDatabaseView[]>([]);
  const [openDatabaseId, setOpenDatabaseId] = useState<string | null>(null);

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
    if (!visible) return;
    // Trashed is filtered client-side (same "avoid a composite index"
    // convention used everywhere else in this app) rather than a
    // `where('trashed','==',false)` query.
    return onSnapshot(query(stickersCollection, orderBy('updatedAt', 'desc')), (snapshot) => {
      setStickers(
        snapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<StickerRow, 'id'>) }))
          .filter((s) => !s.trashed)
      );
    });
  }, [visible]);

  useEffect(() => {
    if (!visible || !includeCustomDatabases) return;
    return onSnapshot(query(customDatabasesCollection, orderBy('name')), (snapshot) => {
      setCustomDatabases(
        snapshot.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CustomDatabase, 'id'>) }))
      );
    });
  }, [visible, includeCustomDatabases]);

  useEffect(() => {
    if (!visible || !openDatabaseId) return;
    // Filtered client-side by databaseId, same "avoid a composite index"
    // convention CustomDatabaseScreen's own rows query follows.
    return onSnapshot(query(customRowsCollection, orderBy('updatedAt', 'desc')), (snapshot) => {
      setCustomRows(
        snapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<CustomDatabaseRow, 'id'>) }))
          .filter((r) => r.databaseId === openDatabaseId)
      );
    });
  }, [visible, openDatabaseId]);

  useEffect(() => {
    if (!visible || !openDatabaseId) return;
    return onSnapshot(customViewsCollection, (snapshot) => {
      setCustomViews(
        snapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<CustomDatabaseView, 'id'>) }))
          .filter((v) => v.databaseId === openDatabaseId)
      );
    });
  }, [visible, openDatabaseId]);

  useEffect(() => {
    if (!visible || !includeDocuments) return;
    return onSnapshot(query(documentsCollection, orderBy('updatedAt', 'desc')), (snapshot) => {
      setDocuments(
        snapshot.docs
          .filter((d) => !d.data().calendarDate)
          .map((d) => ({ id: d.id, title: (d.data().title as string) || 'Без назви' }))
      );
    });
  }, [visible, includeDocuments]);

  useEffect(() => {
    if (!visible) {
      setSearchQuery('');
      setTab('file');
      setOpenDatabaseId(null);
    }
  }, [visible]);

  const needle = searchQuery.trim().toLowerCase();
  const filteredFiles = files.filter(
    (f) => !excludeIds?.has(f.id) && (f.title || f.fileName).toLowerCase().includes(needle)
  );
  const filteredPhotos = photos.filter(
    (p) => !excludeIds?.has(p.id) && (p.title || 'Без назви').toLowerCase().includes(needle)
  );
  const searchedLinks = links.filter((l) => (l.title || hostnameOf(l.url)).toLowerCase().includes(needle));
  const filteredVideoLinks = searchedLinks.filter((l) => categoryOf(l) === 'video');
  const filteredGeoLinks = searchedLinks.filter((l) => categoryOf(l) === 'geo');
  const filteredOtherLinks = searchedLinks.filter((l) => categoryOf(l) === 'other');
  const filteredDocuments = documents.filter((d) => d.title.toLowerCase().includes(needle));
  // Same id-collision guard as files/photos - a sticker reuses its own
  // record's id (see blockFromSticker), so re-picking one already present
  // in this document would put two blocks on the same id.
  const filteredStickers = stickers.filter(
    (s) => !excludeIds?.has(s.id) && labelForSticker(s).toLowerCase().includes(needle)
  );
  const openDatabase = customDatabases.find((d) => d.id === openDatabaseId) ?? null;
  const filteredDatabases = customDatabases.filter((d) => (d.name || 'База').toLowerCase().includes(needle));
  // Same id-collision guard as files/photos/stickers - a row block reuses
  // the row's own id (blockFromCustomRow).
  const filteredCustomRows = customRows.filter(
    (r) => !excludeIds?.has(r.id) && rowTitleOf(openDatabase, r).toLowerCase().includes(needle)
  );
  // Same id-collision guard - a view block reuses the view's own id
  // (blockFromCustomView).
  const filteredCustomViews = customViews.filter(
    (v) => !excludeIds?.has(v.id) && (v.name || 'Вигляд').toLowerCase().includes(needle)
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>Додати з бази даних</Text>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={styles.tabRow}
            contentContainerStyle={styles.tabRowContent}
          >
            <Pressable style={[styles.tab, tab === 'file' && styles.tabActive]} onPress={() => setTab('file')}>
              <Text style={[styles.tabLabel, tab === 'file' && styles.tabLabelActive]}>Файли</Text>
            </Pressable>
            <Pressable style={[styles.tab, tab === 'photo' && styles.tabActive]} onPress={() => setTab('photo')}>
              <Text style={[styles.tabLabel, tab === 'photo' && styles.tabLabelActive]}>Зображення</Text>
            </Pressable>
            <Pressable style={[styles.tab, tab === 'video' && styles.tabActive]} onPress={() => setTab('video')}>
              <Text style={[styles.tabLabel, tab === 'video' && styles.tabLabelActive]}>YouTube / TikTok</Text>
            </Pressable>
            <Pressable style={[styles.tab, tab === 'geo' && styles.tabActive]} onPress={() => setTab('geo')}>
              <Text style={[styles.tabLabel, tab === 'geo' && styles.tabLabelActive]}>Геоточки</Text>
            </Pressable>
            <Pressable style={[styles.tab, tab === 'other' && styles.tabActive]} onPress={() => setTab('other')}>
              <Text style={[styles.tabLabel, tab === 'other' && styles.tabLabelActive]}>Посилання</Text>
            </Pressable>
            <Pressable style={[styles.tab, tab === 'sticker' && styles.tabActive]} onPress={() => setTab('sticker')}>
              <Text style={[styles.tabLabel, tab === 'sticker' && styles.tabLabelActive]}>Стікери</Text>
            </Pressable>
            {includeCustomDatabases && (
              <Pressable style={[styles.tab, tab === 'customDb' && styles.tabActive]} onPress={() => setTab('customDb')}>
                <Text style={[styles.tabLabel, tab === 'customDb' && styles.tabLabelActive]}>Бази</Text>
              </Pressable>
            )}
            {includeDocuments && (
              <Pressable style={[styles.tab, tab === 'document' && styles.tabActive]} onPress={() => setTab('document')}>
                <Text style={[styles.tabLabel, tab === 'document' && styles.tabLabelActive]}>Документи</Text>
              </Pressable>
            )}
          </ScrollView>

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

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {tab === 'file' &&
              (filteredFiles.length === 0 ? (
                <Text style={styles.emptyLabel}>Нічого не знайдено</Text>
              ) : (
                filteredFiles.map((f) => (
                  <Pressable key={f.id} style={styles.row} onPress={() => onPick(blockFromFile(f))}>
                    <View style={styles.docIcon}>
                      <Ionicons name="document-outline" size={18} color={ACCENT} />
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
                    <Image source={{ uri: p.imageUri }} style={styles.thumb} resizeMode="cover" />
                    <Text style={styles.rowText} numberOfLines={1}>
                      {p.title || 'Без назви'}
                    </Text>
                  </Pressable>
                ))
              ))}

            {tab === 'video' &&
              (filteredVideoLinks.length === 0 ? (
                <Text style={styles.emptyLabel}>Нічого не знайдено</Text>
              ) : (
                filteredVideoLinks.map((l) => (
                  <Pressable key={l.id} style={styles.row} onPress={() => onPick(blockFromLink(l))}>
                    {l.imageUrl ? (
                      <Image source={{ uri: l.imageUrl }} style={styles.thumb} resizeMode="cover" />
                    ) : (
                      <View style={styles.docIcon}>
                        <Ionicons name="videocam-outline" size={18} color={ACCENT} />
                      </View>
                    )}
                    <Text style={styles.rowText} numberOfLines={1}>
                      {l.title || hostnameOf(l.url)}
                    </Text>
                  </Pressable>
                ))
              ))}

            {tab === 'geo' &&
              (filteredGeoLinks.length === 0 ? (
                <Text style={styles.emptyLabel}>Нічого не знайдено</Text>
              ) : (
                filteredGeoLinks.map((l) => (
                  <Pressable key={l.id} style={styles.row} onPress={() => onPick(blockFromLink(l))}>
                    <View style={styles.docIcon}>
                      <Ionicons name="location-outline" size={18} color={ACCENT} />
                    </View>
                    <Text style={styles.rowText} numberOfLines={1}>
                      {l.title || hostnameOf(l.url)}
                    </Text>
                  </Pressable>
                ))
              ))}

            {tab === 'other' &&
              (filteredOtherLinks.length === 0 ? (
                <Text style={styles.emptyLabel}>Нічого не знайдено</Text>
              ) : (
                filteredOtherLinks.map((l) => (
                  <Pressable key={l.id} style={styles.row} onPress={() => onPick(blockFromLink(l))}>
                    {l.imageUrl ? (
                      <Image source={{ uri: l.imageUrl }} style={styles.thumb} resizeMode="cover" />
                    ) : (
                      <View style={styles.docIcon}>
                        <Ionicons name="link-outline" size={18} color={ACCENT} />
                      </View>
                    )}
                    <Text style={styles.rowText} numberOfLines={1}>
                      {l.title || hostnameOf(l.url)}
                    </Text>
                  </Pressable>
                ))
              ))}

            {tab === 'sticker' &&
              (filteredStickers.length === 0 ? (
                <Text style={styles.emptyLabel}>Нічого не знайдено</Text>
              ) : (
                filteredStickers.map((s) => (
                  <Pressable key={s.id} style={styles.row} onPress={() => onPick(blockFromSticker(s))}>
                    {s.type === 'image' && s.imageUri ? (
                      <Image source={{ uri: s.imageUri }} style={[styles.thumb, { backgroundColor: STICKER_YELLOW }]} resizeMode="cover" />
                    ) : (
                      <View style={[styles.docIcon, { backgroundColor: STICKER_YELLOW }]}>
                        <Ionicons
                          name={s.type === 'sketch' ? 'brush-outline' : 'reader-outline'}
                          size={18}
                          color="#8a7a1f"
                        />
                      </View>
                    )}
                    <Text style={styles.rowText} numberOfLines={1}>
                      {labelForSticker(s)}
                    </Text>
                  </Pressable>
                ))
              ))}

            {tab === 'document' &&
              (filteredDocuments.length === 0 ? (
                <Text style={styles.emptyLabel}>Нічого не знайдено</Text>
              ) : (
                filteredDocuments.map((d) => (
                  <Pressable key={d.id} style={styles.row} onPress={() => onPickDocument?.(d)}>
                    <View style={styles.docIcon}>
                      <Ionicons name="document-text-outline" size={18} color={ACCENT} />
                    </View>
                    <Text style={styles.rowText} numberOfLines={1}>
                      {d.title}
                    </Text>
                  </Pressable>
                ))
              ))}

            {/* Two levels: the databases themselves, then the rows of
                whichever one was opened. The back row is what returns to
                the list rather than a second "Бази" tap. */}
            {tab === 'customDb' && !openDatabase &&
              (filteredDatabases.length === 0 ? (
                <Text style={styles.emptyLabel}>Ще немає власних баз</Text>
              ) : (
                filteredDatabases.map((d) => (
                  <Pressable key={d.id} style={styles.row} onPress={() => setOpenDatabaseId(d.id)}>
                    <View style={styles.docIcon}>
                      <Ionicons
                        name={(d.icon as keyof typeof Ionicons.glyphMap) || 'grid-outline'}
                        size={18}
                        color={ACCENT}
                      />
                    </View>
                    <Text style={styles.rowText} numberOfLines={1}>
                      {d.name || 'База'}
                    </Text>
                    <Ionicons name="chevron-forward" size={16} color="#9CA3AF" />
                  </Pressable>
                ))
              ))}

            {tab === 'customDb' && openDatabase && (
              <>
                <Pressable style={styles.row} onPress={() => setOpenDatabaseId(null)}>
                  <Ionicons name="chevron-back" size={16} color="#6B7280" />
                  <Text style={[styles.rowText, styles.backRowText]} numberOfLines={1}>
                    {openDatabase.name || 'База'}
                  </Text>
                </Pressable>
                {/* Saved views first, under their own label - a live,
                    filtered slice of the database is a coarser, more
                    useful thing to embed than one row, so it leads. */}
                {filteredCustomViews.length > 0 && (
                  <>
                    <Text style={styles.sectionLabel}>Вигляди</Text>
                    {filteredCustomViews.map((v) => (
                      <Pressable
                        key={v.id}
                        style={styles.row}
                        onPress={() =>
                          onPick(
                            blockFromCustomView({
                              id: v.id,
                              databaseId: openDatabase.id,
                              name: v.name || 'Вигляд',
                              createdAt: v.createdAt,
                            })
                          )
                        }
                      >
                        <View style={styles.docIcon}>
                          <Ionicons name="bookmark-outline" size={18} color={ACCENT} />
                        </View>
                        <Text style={styles.rowText} numberOfLines={1}>
                          {v.name || 'Вигляд'}
                        </Text>
                      </Pressable>
                    ))}
                    <Text style={styles.sectionLabel}>Записи</Text>
                  </>
                )}
                {filteredCustomRows.length === 0 ? (
                  <Text style={styles.emptyLabel}>Нічого не знайдено</Text>
                ) : (
                  filteredCustomRows.map((r) => (
                    <Pressable
                      key={r.id}
                      style={styles.row}
                      onPress={() =>
                        onPick(
                          blockFromCustomRow({
                            id: r.id,
                            databaseId: openDatabase.id,
                            title: rowTitleOf(openDatabase, r),
                            createdAt: r.createdAt,
                          })
                        )
                      }
                    >
                      <View style={styles.docIcon}>
                        <Ionicons name="grid-outline" size={18} color={ACCENT} />
                      </View>
                      <Text style={styles.rowText} numberOfLines={1}>
                        {rowTitleOf(openDatabase, r)}
                      </Text>
                    </Pressable>
                  ))
                )}
              </>
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
  // Horizontally scrollable now that links split into three tabs of their
  // own (video/geo/other) alongside Files/Photos - five tabs no longer fit
  // a fixed-width flex row.
  tabRow: {
    marginBottom: 10,
  },
  tabRowContent: {
    flexDirection: 'row',
    gap: 8,
  },
  tab: {
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 14,
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
  sectionLabel: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    paddingTop: 10,
    paddingBottom: 2,
    paddingHorizontal: 2,
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
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Real preview - photos, YouTube/TikTok thumbnails, and any "other" link
  // with an Open Graph image all share this, same size as docIcon so a row
  // doesn't jump around switching between an icon and an image.
  thumb: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#F3F4F6',
  },
  backRowText: {
    color: '#6B7280',
    fontWeight: '600',
  },
  rowText: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
  },
});
