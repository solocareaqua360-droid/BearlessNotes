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
import MediaRowCard from './MediaRowCard';
import ZoomableImageViewer from './ZoomableImageViewer';
import VideoPlayerModal from './VideoPlayerModal';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

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

const LINK_COLOR_BY_KIND: Record<'link-video' | 'link-geo' | 'link-other', string> = {
  'link-video': '#EF4444',
  'link-geo': '#16A34A',
  'link-other': '#3B82F6',
};

// Same tinting-by-extension FilesScreen's own row card uses - duplicated
// rather than shared, same as every other small per-screen copy of this in
// the app (see FilesScreen's own comment on it).
function fileIconFor(name: string): 'document-text-outline' | 'document-outline' {
  return name.toLowerCase().endsWith('.pdf') ? 'document-text-outline' : 'document-outline';
}
function fileIconColorFor(name: string): string {
  const ext = name.toLowerCase().split('.').pop();
  if (ext === 'pdf') return '#DC2626';
  if (ext === 'doc' || ext === 'docx') return '#2563EB';
  if (ext === 'xls' || ext === 'xlsx') return '#16A34A';
  return '#6B7280';
}

// The date is already the whole point of being on this screen - what's
// worth showing on a history card here is WHEN that day it happened.
function formatTime(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

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
// `fill` is the three-column layout: the list has a column of its own, so
// there's nothing to collapse behind a pill and no reason to cap its
// height - it simply takes the column and scrolls inside it. An empty day
// then says so, instead of leaving a blank third of the screen.
export default function DayHistoryList({ items, fill }: { items: HistoryItem[]; fill?: boolean }) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [expanded, setExpanded] = useState(false);
  const [viewerImageUri, setViewerImageUri] = useState<string | null>(null);
  const [playingVideoUrl, setPlayingVideoUrl] = useState<string | null>(null);

  if (items.length === 0 && !fill) return null;

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

  // The full Files/Links database row (thumbnail-or-icon, title, caption) -
  // photos never had a card shape of their own before this (Photos is a
  // grid-only screen), so MediaRowCard is what gives them one, same as
  // file/link.
  function renderMediaCard(item: HistoryItem) {
    const time = formatTime(item.createdAt);
    if (item.kind === 'photo') {
      return (
        <MediaRowCard
          id={item.id}
          title={item.title}
          caption={time}
          thumbUri={item.data?.imageUri as string | undefined}
          onPress={() => openNaturally(item).catch((e) => Alert.alert('Не вдалося відкрити', String(e)))}
        />
      );
    }
    if (item.kind === 'file') {
      const fileName = (item.data?.fileName as string) ?? item.title;
      return (
        <MediaRowCard
          id={item.id}
          title={item.title}
          caption={time}
          iconName={fileIconFor(fileName)}
          iconColor={fileIconColorFor(fileName)}
          onPress={() => openNaturally(item).catch((e) => Alert.alert('Не вдалося відкрити', String(e)))}
        />
      );
    }
    // link-*
    return (
      <MediaRowCard
        id={item.id}
        title={item.title}
        caption={time}
        thumbUri={item.data?.imageUrl as string | undefined}
        iconName={ICON_BY_KIND[item.kind]}
        iconColor={LINK_COLOR_BY_KIND[item.kind as 'link-video' | 'link-geo' | 'link-other']}
        onPress={() => openNaturally(item).catch((e) => Alert.alert('Не вдалося відкрити', String(e)))}
      />
    );
  }

  // Every other kind has no thumbnail worth showing (a document/board/task/
  // sticker/database row or view is just a name) - a plain icon card, same
  // family as CustomRowCard's own row, with the same time caption.
  function renderPlainCard(item: HistoryItem) {
    const { background, text, textMuted } = colorForDocument(item.id);
    return (
      <View style={[styles.card, { backgroundColor: background }]}>
        <Pressable
          style={styles.cardTap}
          onPress={() => openNaturally(item).catch((e) => Alert.alert('Не вдалося відкрити', String(e)))}
        >
          <Ionicons name={ICON_BY_KIND[item.kind]} size={16} color={textMuted} />
          <View style={styles.cardBody}>
            <Text style={[styles.cardTitle, { color: text }]} numberOfLines={2}>
              {item.title}
            </Text>
            <Text style={[styles.cardCaption, { color: textMuted }]}>{formatTime(item.createdAt)}</Text>
          </View>
        </Pressable>
        {SHOW_IN_DATABASE_KINDS.includes(item.kind) && (
          <Pressable hitSlop={8} style={styles.dbButton} onPress={() => showInDatabase(item)}>
            <Ionicons name="server-outline" size={15} color={textMuted} />
          </Pressable>
        )}
      </View>
    );
  }

  if (fill) {
    return (
      <View style={styles.column}>
        <View style={styles.columnHeader}>
          <Ionicons name="time-outline" size={14} color="rgba(255,255,255,0.75)" />
          <Text style={styles.headerLabel}>Історія ({items.length})</Text>
        </View>
        {items.length === 0 ? (
          <Text style={styles.emptyLabel}>Цього дня нічого не додано</Text>
        ) : (
          <ScrollView style={styles.columnList} contentContainerStyle={styles.listContent}>
            {items.map((item) => (
              <View key={`${item.kind}-${item.id}`}>
                {item.kind === 'photo' || item.kind === 'file' || item.kind.startsWith('link-')
                  ? renderMediaCard(item)
                  : renderPlainCard(item)}
              </View>
            ))}
          </ScrollView>
        )}
        {viewerImageUri && <ZoomableImageViewer uri={viewerImageUri} onClose={() => setViewerImageUri(null)} />}
        {playingVideoUrl && <VideoPlayerModal url={playingVideoUrl} onClose={() => setPlayingVideoUrl(null)} />}
      </View>
    );
  }

  return (
    // A Fragment, not a wrapping View: the caller (CalendarScreen) places
    // the header pill in a flex-wrap row alongside its own month capsule,
    // and relies on the expanded body's own width:'100%' to force it onto
    // its own line below both rather than squeezing in beside them.
    <>
      <Pressable style={styles.header} onPress={() => setExpanded((v) => !v)}>
        <Ionicons name="time-outline" size={14} color="rgba(255,255,255,0.75)" />
        <Text style={styles.headerLabel}>Історія ({items.length})</Text>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color="rgba(255,255,255,0.6)" />
      </Pressable>

      {expanded && (
        <View style={styles.bodyRow}>
          {/* A fixed max height with its own scroll - this list can end up
              being the main thing on screen (the note collapsed
              specifically to make room for it), so it must never depend
              on how much space whatever surrounds it happens to leave. */}
          <ScrollView style={styles.list} nestedScrollEnabled contentContainerStyle={styles.listContent}>
            {items.map((item) => (
              <View key={`${item.kind}-${item.id}`}>
                {item.kind === 'photo' || item.kind === 'file' || item.kind.startsWith('link-')
                  ? renderMediaCard(item)
                  : renderPlainCard(item)}
              </View>
            ))}
          </ScrollView>
        </View>
      )}

      {viewerImageUri && <ZoomableImageViewer uri={viewerImageUri} onClose={() => setViewerImageUri(null)} />}
      {playingVideoUrl && <VideoPlayerModal url={playingVideoUrl} onClose={() => setPlayingVideoUrl(null)} />}
    </>
  );
}

const styles = StyleSheet.create({
  // Forces the expanded list onto its own line below the header row (see
  // the Fragment comment above) in the parent's flex-wrap container,
  // instead of squeezing in beside the header/month-capsule pills.
  bodyRow: {
    width: '100%',
    marginTop: 8,
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
    fontFamily: FONT_SEMIBOLD,
    color: 'rgba(255,255,255,0.85)',
  },
  list: {
    maxHeight: 360,
  },
  column: {
    flex: 1,
  },
  columnHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingBottom: 2,
  },
  columnList: {
    flex: 1,
  },
  emptyLabel: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.5)',
    paddingTop: 10,
  },
  listContent: {
    gap: 8,
    paddingTop: 8,
    paddingBottom: 2,
  },
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
  cardBody: {
    flex: 1,
    gap: 2,
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
  },
  cardCaption: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
  },
  dbButton: {
    padding: 4,
  },
});
