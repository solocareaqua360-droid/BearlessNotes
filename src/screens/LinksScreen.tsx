import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { NativeStackScreenProps } from '@react-navigation/native-stack';
import { collection, deleteDoc, doc, getDoc, onSnapshot, orderBy, query, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Block } from '../types';
import { RootStackParamList } from '../navigation';

const ACCENT = '#3B82F6';
const DANGER = '#EF4444';
const linksCollection = collection(db, 'links');

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// One record per unique URL (see DocumentEditorScreen's linkDocId/
// syncLinksForDocument) - documentIds lists every document that currently
// has a card for this link, derived from the record's own `usedInDocuments`
// map rather than one record per insertion.
type LinkItem = {
  id: string;
  url: string;
  title?: string;
  imageUrl?: string;
  siteName?: string;
  documentIds: string[];
};

type LinkCategory = 'video' | 'geo' | 'other';

// Matches the exact siteName values fetchLinkPreview stamps on conversion
// (see DocumentEditorScreen) - the one `links` collection holds every kind
// of link, and this is what splits it back into three separate-looking
// databases without needing three separate collections.
function categoryOf(link: LinkItem): LinkCategory {
  const siteName = link.siteName ?? '';
  if (siteName.includes('YouTube') || siteName.includes('TikTok')) return 'video';
  if (siteName === 'Геоточка') return 'geo';
  return 'other';
}

const CATEGORY_INFO: Record<
  LinkCategory,
  { title: string; icon: keyof typeof Ionicons.glyphMap; color: string; emptyHint: string }
> = {
  video: {
    title: 'YouTube / TikTok',
    icon: 'videocam-outline',
    color: '#EF4444',
    emptyHint: "Вставте посилання на YouTube або TikTok окремим абзацом у документі - картка з'явиться тут сама",
  },
  geo: {
    title: 'Геоточки',
    icon: 'location-outline',
    color: '#16A34A',
    emptyHint: "Вставте посилання на місце з Google Maps окремим абзацом у документі - воно з'явиться тут само",
  },
  other: {
    title: 'Посилання',
    icon: 'link-outline',
    color: ACCENT,
    emptyHint: "Вставте посилання окремим абзацом у будь-якому документі - картка з'явиться тут сама",
  },
};

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

type Props = NativeStackScreenProps<RootStackParamList, 'Links'>;

export default function LinksScreen({ route, navigation }: Props) {
  const { category } = route.params;
  const info = CATEGORY_INFO[category];
  const [links, setLinks] = useState<LinkItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [renamingLink, setRenamingLink] = useState<LinkItem | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [documentPicker, setDocumentPicker] = useState<{
    link: LinkItem;
    documents: { id: string; title: string }[];
  } | null>(null);

  useEffect(() => {
    const linksQuery = query(linksCollection, orderBy('updatedAt', 'desc'));
    return onSnapshot(linksQuery, (snapshot) => {
      setLinks(
        snapshot.docs.map((docSnapshot) => {
          const data = docSnapshot.data();
          return {
            id: docSnapshot.id,
            url: data.url,
            title: data.title,
            imageUrl: data.imageUrl,
            siteName: data.siteName,
            documentIds: Object.keys(data.usedInDocuments ?? {}),
          };
        })
      );
      setIsLoading(false);
    });
  }, []);

  const filteredLinks = links.filter((link) => categoryOf(link) === category);

  function openSortOrFilter() {
    navigation.navigate('Placeholder', { icon: 'options-outline', label: 'Скоро' });
  }

  function openLinkUrl(url: string) {
    Linking.openURL(url).catch(() => {});
  }

  // The document icon jumps straight to the one document a link is used in,
  // or - when it's inserted in several - shows a picker to choose which.
  async function openDocumentIcon(link: LinkItem) {
    if (link.documentIds.length === 0) return;
    if (link.documentIds.length === 1) {
      navigation.navigate('Editor', { documentId: link.documentIds[0] });
      return;
    }
    const documents = await Promise.all(
      link.documentIds.map(async (id) => {
        const snapshot = await getDoc(doc(db, 'documents', id));
        return { id, title: (snapshot.data()?.title as string) || 'Без назви' };
      })
    );
    setDocumentPicker({ link, documents });
  }

  function pickDocument(documentId: string) {
    setDocumentPicker(null);
    navigation.navigate('Editor', { documentId });
  }

  function openRename(link: LinkItem) {
    setRenamingLink(link);
    setRenameValue(link.title ?? '');
  }

  function cancelRename() {
    setRenamingLink(null);
    setRenameValue('');
  }

  // A rename is always available, not just at first creation - it updates
  // the shared record AND every card that already shows the old name
  // (matched by URL, since a document could hold more than one block for
  // the same link), the same two-way-sync pattern tasks already use for
  // project/today changes.
  async function confirmRename() {
    const link = renamingLink;
    const title = renameValue.trim();
    if (!link || !title) return;
    setRenamingLink(null);
    setRenameValue('');
    await updateDoc(doc(db, 'links', link.id), { title });
    await Promise.all(
      link.documentIds.map(async (docId) => {
        const documentRef = doc(db, 'documents', docId);
        const snapshot = await getDoc(documentRef);
        const data = snapshot.data();
        if (!data) return;
        const blocks: Block[] = data.blocks ?? [];
        let changed = false;
        const updatedBlocks = blocks.map((b) => {
          if ((b.type ?? 'paragraph') === 'link' && b.linkUrl === link.url) {
            changed = true;
            return { ...b, linkTitle: title };
          }
          return b;
        });
        if (changed) await updateDoc(documentRef, { blocks: updatedBlocks });
      })
    );
  }

  function confirmDeleteLink(link: LinkItem) {
    const count = link.documentIds.length;
    const message =
      count > 1
        ? `Картка також зникне з ${count} документів, де її вставлено.`
        : 'Картка також зникне з документа, де її вставлено.';
    Alert.alert('Видалити посилання?', message, [
      { text: 'Скасувати', style: 'cancel' },
      { text: 'Видалити', style: 'destructive', onPress: () => deleteLink(link) },
    ]);
  }

  async function deleteLink(link: LinkItem) {
    deleteDoc(doc(db, 'links', link.id));
    await Promise.all(
      link.documentIds.map(async (docId) => {
        const documentRef = doc(db, 'documents', docId);
        const snapshot = await getDoc(documentRef);
        const data = snapshot.data();
        if (!data) return;
        const blocks: Block[] = data.blocks ?? [];
        const remaining = blocks.filter((b) => !((b.type ?? 'paragraph') === 'link' && b.linkUrl === link.url));
        if (remaining.length !== blocks.length) {
          updateDoc(documentRef, {
            blocks: remaining.length > 0 ? remaining : [{ id: generateId(), text: '' }],
          });
        }
      })
    );
  }

  function renderLinkRow(item: LinkItem) {
    const itemInfo = CATEGORY_INFO[categoryOf(item)];
    const docCount = item.documentIds.length;
    return (
      <View key={item.id} style={styles.row}>
        <Pressable style={styles.rowTap} onPress={() => openLinkUrl(item.url)}>
          {item.imageUrl ? (
            <Image source={{ uri: item.imageUrl }} style={styles.thumb} resizeMode="cover" />
          ) : (
            <View style={[styles.thumbIcon, { backgroundColor: `${itemInfo.color}1A` }]}>
              <Ionicons name={itemInfo.icon} size={20} color={itemInfo.color} />
            </View>
          )}
          <View style={styles.rowBody}>
            <Text style={styles.rowTitle} numberOfLines={2}>
              {item.title || hostnameOf(item.url)}
            </Text>
            <Text style={styles.rowCaption} numberOfLines={1}>
              {item.siteName ?? hostnameOf(item.url)}
            </Text>
            <View style={styles.rowMeta}>
              <View style={styles.tagChip}>
                <Text style={styles.tagChipLabel}>Теги (скоро)</Text>
              </View>
            </View>
          </View>
        </Pressable>
        <View style={styles.rowActions}>
          <Pressable hitSlop={8} onPress={() => openRename(item)} style={styles.rowActionButton}>
            <Ionicons name="pencil-outline" size={16} color="#9CA3AF" />
          </Pressable>
          <Pressable hitSlop={8} onPress={() => openDocumentIcon(item)} style={styles.rowDocButtonWrap}>
            <View style={styles.rowDocButton}>
              <Ionicons name="document-text-outline" size={16} color={ACCENT} />
            </View>
            {docCount > 1 && (
              <View style={styles.rowDocBadge}>
                <Text style={styles.rowDocBadgeLabel}>{docCount}</Text>
              </View>
            )}
          </Pressable>
          <Pressable hitSlop={8} onPress={() => confirmDeleteLink(item)} style={styles.rowActionButton}>
            <Ionicons name="trash-outline" size={16} color={DANGER} />
          </Pressable>
        </View>
      </View>
    );
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
        <Text style={styles.header}>{info.title}</Text>
        <View style={styles.headerIcons}>
          <Pressable hitSlop={8} onPress={openSortOrFilter}>
            <Ionicons name="swap-vertical-outline" size={20} color="#6B7280" />
          </Pressable>
          <Pressable hitSlop={8} onPress={openSortOrFilter}>
            <Ionicons name="filter-outline" size={20} color="#6B7280" />
          </Pressable>
        </View>
      </View>

      {filteredLinks.length === 0 ? (
        <View style={styles.emptyState}>
          <View style={[styles.emptyIcon, { backgroundColor: `${info.color}1A` }]}>
            <Ionicons name={info.icon} size={32} color={info.color} />
          </View>
          <Text style={styles.emptyLabel}>Ще немає збережених посилань</Text>
          <Text style={styles.emptyHint}>{info.emptyHint}</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.list}>{filteredLinks.map(renderLinkRow)}</ScrollView>
      )}

      <Modal visible={renamingLink !== null} transparent animationType="fade" onRequestClose={cancelRename}>
        <View style={styles.renamePromptBackdrop}>
          <View style={styles.renamePromptCard}>
            <Text style={styles.renamePromptTitle}>Назва посилання</Text>
            <TextInput
              autoFocus
              value={renameValue}
              onChangeText={setRenameValue}
              placeholder="Назва"
              style={styles.renamePromptInput}
            />
            <View style={styles.renamePromptButtons}>
              <Pressable style={styles.renamePromptCancelButton} onPress={cancelRename}>
                <Text style={styles.renamePromptCancelLabel}>Скасувати</Text>
              </Pressable>
              <Pressable
                style={[styles.renamePromptSaveButton, !renameValue.trim() && styles.renamePromptSaveButtonDisabled]}
                disabled={!renameValue.trim()}
                onPress={confirmRename}
              >
                <Text style={styles.renamePromptSaveLabel}>Зберегти</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal
        visible={documentPicker !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setDocumentPicker(null)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setDocumentPicker(null)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Де вставлено це посилання</Text>
            {documentPicker?.documents.map((d) => (
              <Pressable key={d.id} style={styles.modalRow} onPress={() => pickDocument(d.id)}>
                <View style={styles.modalDocIcon}>
                  <Ionicons name="document-text-outline" size={16} color={ACCENT} />
                </View>
                <Text style={styles.modalRowText} numberOfLines={1}>
                  {d.title}
                </Text>
                <Ionicons name="chevron-forward" size={16} color="#D1D5DB" />
              </Pressable>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
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
    // 56, not 16 - this screen has no native header (headerShown: false on
    // the stack), so its own top padding is what clears the status bar,
    // matching TasksScreen/DocumentEditorScreen for the same reason.
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
    backgroundColor: '#EFF6FF',
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
  list: {
    paddingVertical: 8,
    paddingHorizontal: 20,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 10,
  },
  rowTap: {
    flex: 1,
    flexDirection: 'row',
    gap: 12,
  },
  thumb: {
    width: 56,
    height: 56,
    borderRadius: 10,
    backgroundColor: '#E5E7EB',
  },
  thumbIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    backgroundColor: 'rgba(59,130,246,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 4,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  rowCaption: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  rowMeta: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 2,
  },
  tagChip: {
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 2,
  },
  tagChipLabel: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  rowActions: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 2,
  },
  rowActionButton: {
    padding: 6,
  },
  rowDocButtonWrap: {
    position: 'relative',
  },
  rowDocButton: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowDocBadge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 3,
  },
  rowDocBadgeLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#fff',
  },
  renamePromptBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  renamePromptCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  renamePromptTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  renamePromptInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
  },
  renamePromptButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 4,
  },
  renamePromptCancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  renamePromptCancelLabel: {
    fontSize: 15,
    color: '#6B7280',
  },
  renamePromptSaveButton: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  renamePromptSaveButtonDisabled: {
    backgroundColor: '#BFDBFE',
  },
  renamePromptSaveLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 4,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  modalDocIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalRowText: {
    fontSize: 16,
    color: '#111827',
    flex: 1,
  },
});
