import { useState } from 'react';
import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Sharing from 'expo-sharing';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation';
import { HistoryItem, HistoryItemKind } from '../hooks/useDayHistory';
import { getVideoEmbedInfo } from '../utils/videoEmbed';
import { colorForDocument } from '../utils/documentColor';
import ZoomableImageViewer from './ZoomableImageViewer';
import VideoPlayerModal from './VideoPlayerModal';

const ICON_BY_KIND: Record<HistoryItemKind, keyof typeof Ionicons.glyphMap> = {
  file: 'document-outline',
  photo: 'image-outline',
  'link-video': 'videocam-outline',
  'link-geo': 'location-outline',
  'link-other': 'link-outline',
  document: 'document-text-outline',
  board: 'grid-outline',
  task: 'checkbox-outline',
  sticker: 'reader-outline',
  customRow: 'server-outline',
  customView: 'bookmark-outline',
};

// Kinds whose tap target (see openNaturally below) already lands on their
// home database screen - a second "show in database" icon there would just
// repeat the same action twice. Only where the two genuinely differ (a task
// opens the DOCUMENT it lives in; its "database" is the separate Tasks
// board view) does the icon earn its place.
const SHOW_IN_DATABASE_KINDS: HistoryItemKind[] = ['task'];

// Everything added on one calendar day, oldest first - see useDayHistory
// for where the list itself comes from (nothing written for this feature,
// only createdAt fields every kind already carries). Lives under the day's
// own note in CalendarScreen, collapsed behind a capsule header.
export default function DayHistoryList({ items }: { items: HistoryItem[] }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [expanded, setExpanded] = useState(false);
  const [viewerImageUri, setViewerImageUri] = useState<string | null>(null);
  const [playingVideoUrl, setPlayingVideoUrl] = useState<string | null>(null);

  if (items.length === 0) return null;

  function showInDatabase(item: HistoryItem) {
    if (item.kind === 'task') navigation.navigate('Tasks');
  }

  async function openNaturally(item: HistoryItem) {
    switch (item.kind) {
      case 'file': {
        const fileUri = item.data?.fileUri as string | undefined;
        if (!fileUri) return;
        const available = await Sharing.isAvailableAsync();
        if (!available) return;
        await Sharing.shareAsync(fileUri, {
          mimeType: item.data?.mimeType as string | undefined,
          dialogTitle: item.title,
        });
        return;
      }
      case 'photo': {
        const imageUri = item.data?.imageUri as string | undefined;
        if (imageUri) setViewerImageUri(imageUri);
        return;
      }
      case 'link-video': {
        const url = item.data?.url as string | undefined;
        if (url && getVideoEmbedInfo(url)) {
          setPlayingVideoUrl(url);
          return;
        }
        if (url) Linking.openURL(url).catch(() => {});
        return;
      }
      case 'link-geo':
      case 'link-other': {
        const url = item.data?.url as string | undefined;
        if (url) Linking.openURL(url).catch(() => {});
        return;
      }
      case 'document':
        if (item.documentId) navigation.navigate('Editor', { documentId: item.documentId });
        return;
      case 'task':
        if (item.documentId) navigation.navigate('Editor', { documentId: item.documentId });
        return;
      case 'board':
        navigation.navigate('Tabs', { screen: 'Дошки', params: { screen: 'Board', params: { boardId: item.id } } });
        return;
      case 'sticker':
        navigation.navigate('Stickers');
        return;
      case 'customRow':
        if (item.databaseId) navigation.navigate('CustomDatabase', { databaseId: item.databaseId, openRowId: item.id });
        return;
      case 'customView':
        if (item.databaseId) navigation.navigate('CustomDatabase', { databaseId: item.databaseId, openViewId: item.id });
        return;
    }
  }

  return (
    <View style={styles.wrap}>
      <Pressable style={styles.header} onPress={() => setExpanded((v) => !v)}>
        <Ionicons name="time-outline" size={14} color="rgba(255,255,255,0.75)" />
        <Text style={styles.headerLabel}>Історія ({items.length})</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color="rgba(255,255,255,0.6)" />
      </Pressable>

      {expanded && (
        // A fixed max height with its own scroll - this list can end up
        // being the main thing on screen (the note collapsed specifically
        // to make room for it), so it must never depend on how much space
        // whatever surrounds it happens to leave.
        <ScrollView style={styles.list} nestedScrollEnabled contentContainerStyle={styles.listContent}>
          {items.map((item) => {
            // Same deterministic per-id palette every card in the app uses
            // (CustomRowCard, DocumentCard) - a database's own row keeps
            // its colour here too, since it's still the same id.
            const { background, text, textMuted } = colorForDocument(item.id);
            return (
              <View key={`${item.kind}-${item.id}`} style={[styles.card, { backgroundColor: background }]}>
                <Pressable
                  style={styles.cardTap}
                  onPress={() => openNaturally(item).catch((e) => Alert.alert('Не вдалося відкрити', String(e)))}
                >
                  <Ionicons name={ICON_BY_KIND[item.kind]} size={16} color={textMuted} />
                  <Text style={[styles.cardTitle, { color: text }]} numberOfLines={2}>
                    {item.title}
                  </Text>
                </Pressable>
                {SHOW_IN_DATABASE_KINDS.includes(item.kind) && (
                  <Pressable hitSlop={8} style={styles.dbButton} onPress={() => showInDatabase(item)}>
                    <Ionicons name="server-outline" size={15} color={textMuted} />
                  </Pressable>
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      {viewerImageUri && <ZoomableImageViewer uri={viewerImageUri} onClose={() => setViewerImageUri(null)} />}
      {playingVideoUrl && <VideoPlayerModal url={playingVideoUrl} onClose={() => setPlayingVideoUrl(null)} />}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    marginHorizontal: 16,
    marginBottom: 8,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(20,20,20,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    alignSelf: 'flex-start',
  },
  headerLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
  },
  list: {
    maxHeight: 320,
  },
  listContent: {
    gap: 8,
    paddingTop: 8,
    paddingBottom: 2,
  },
  // Same card shape as CustomRowCard's own `row` style - border, shadow and
  // radius, just without that component's cover-image slot, which no
  // history kind here has a use for.
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: 14,
    padding: 10,
    borderWidth: 1,
    borderColor: 'rgba(176,176,176,0.5)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  cardTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  dbButton: {
    padding: 4,
  },
});
