import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import GlassLayer from './GlassLayer';
import { getPexelsKey, subscribeToPexelsKey } from '../utils/pexelsKey';
import { StockPhoto, StockSource, searchStockPhotos } from '../utils/stockPhotos';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import {
  GLASS_BODY_BLURRED,
  GLASS_CARD,
  GLASS_EDGE,
  GLASS_INPUT,
  GLASS_LINE,
  GLASS_TEXT,
  GLASS_TEXT_FAINT,
  GLASS_TEXT_MUTED,
} from '../constants/glass';

// A free picture library beside the gallery button, the way Notion reaches
// into Unsplash for a page cover - Pexels here (see utils/stockPhotos),
// because it needs no attribution and a free key takes a minute to get.
//
// What comes back is still just a picture: it goes through the exact same
// crop-then-duotone pipeline as anything pulled from the gallery, so a
// stock photo never looks more "official" than a screenshot someone
// picked themselves - both end up in the tile's own colour.

export default function StockPhotoPicker({
  visible,
  onClose,
  onPicked,
}: {
  visible: boolean;
  onClose: () => void;
  // A local file, handed back exactly like a gallery pick would be.
  onPicked: (uri: string) => void;
}) {
  // Which library is being searched. Openverse needs no key at all, so
  // the sheet opens working; Pexels appears as a second chip only for
  // someone who has actually got a key.
  const [source, setSource] = useState<StockSource>('open');
  const [hasKey, setHasKey] = useState(false);
  const [query, setQuery] = useState('');
  const [photos, setPhotos] = useState<StockPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  // Openverse makes its own thumbnails and sometimes fails to (424).
  // The picture itself is always there, so that is what it falls back
  // to rather than leaving an empty square.
  const [brokenThumbs, setBrokenThumbs] = useState<Record<string, true>>({});
  const requestId = useRef(0);

  useEffect(() => {
    const check = () => getPexelsKey().then((key) => setHasKey(!!key));
    check();
    return subscribeToPexelsKey(check);
  }, []);

  function runSearch(text: string) {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);
    searchStockPhotos(text, source)
      .then((result) => {
        if (id !== requestId.current) return;
        setPhotos(result);
      })
      .catch((e) => {
        if (id !== requestId.current) return;
        setPhotos([]);
        setError((e as Error).message);
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }

  // Fetched once as soon as there is a key - Pexels' own curated feed, a
  // reasonable start before anyone has typed a word.
  useEffect(() => {
    if (visible) runSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, source]);

  useEffect(() => {
    if (!visible) return;
    const timer = setTimeout(() => runSearch(query), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function pick(photo: StockPhoto) {
    setDownloadingId(photo.id);
    try {
      const dir = `${LegacyFileSystem.cacheDirectory}stockphotos/`;
      await LegacyFileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      const target = `${dir}${photo.id}.jpg`;
      await LegacyFileSystem.downloadAsync(photo.fullUrl, target);
      onPicked(target);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDownloadingId(null);
    }
  }

  return (
    <GlassLayer visible={visible} onClose={onClose} intensity={60}>
      <View style={styles.sheet}>
        <View style={styles.header}>
          <Text style={styles.title}>Пошук зображень</Text>
          <Pressable hitSlop={10} onPress={onClose}>
            <Ionicons name="close-outline" size={24} color={GLASS_TEXT} />
          </Pressable>
        </View>

        <View style={styles.searchRow}>
          <Ionicons name="search-outline" size={17} color={GLASS_TEXT_FAINT} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Наприклад: гори, кава, місто…"
            placeholderTextColor={GLASS_TEXT_FAINT}
            style={styles.searchInput}
            returnKeyType="search"
          />
        </View>

        {/* Only worth showing once there are two libraries to choose
            between - otherwise it is a switch with one position. */}
        {hasKey && (
          <View style={styles.sources}>
            {(['open', 'pexels'] as StockSource[]).map((option) => (
              <Pressable
                key={option}
                style={[styles.sourceChip, source === option && styles.sourceChipOn]}
                onPress={() => setSource(option)}
              >
                <Text style={[styles.sourceLabel, source === option && styles.sourceLabelOn]}>
                  {option === 'open' ? 'Відкриті' : 'Pexels'}
                </Text>
              </Pressable>
            ))}
          </View>
        )}

        {!!error && (
          <View style={styles.emptyState}>
            <Ionicons name="cloud-offline-outline" size={30} color={GLASS_TEXT_FAINT} />
            <Text style={styles.emptyBody}>{error}</Text>
          </View>
        )}

        {!error && (
          <FlatList
            data={photos}
            key="grid2"
            numColumns={2}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.grid}
            columnWrapperStyle={styles.gridRow}
            ListEmptyComponent={
              loading ? (
                <ActivityIndicator color={GLASS_TEXT} style={styles.loading} />
              ) : (
                <Text style={styles.emptyBody}>
                  Нічого не знайшлося. Бібліотека шукає англійською - спробуй інше слово.
                </Text>
              )
            }
            renderItem={({ item }) => (
              <Pressable
                style={styles.cell}
                disabled={downloadingId !== null}
                onPress={() => pick(item)}
              >
                <Image
                  source={{ uri: brokenThumbs[item.id] ? item.fullUrl : item.thumbUrl }}
                  style={styles.cellImage}
                  resizeMode="cover"
                  onError={() => setBrokenThumbs((prev) => ({ ...prev, [item.id]: true }))}
                />
                {downloadingId === item.id && (
                  <View style={styles.cellOverlay}>
                    <ActivityIndicator color="#fff" />
                  </View>
                )}
                <Text style={styles.cellCredit} numberOfLines={1}>
                  {item.credit}
                </Text>
              </Pressable>
            )}
          />
        )}
      </View>

    </GlassLayer>
  );
}

const styles = StyleSheet.create({
  sheet: {
    height: '82%',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    backgroundColor: GLASS_BODY_BLURRED,
    borderWidth: 1,
    borderColor: GLASS_EDGE,
    borderBottomWidth: 0,
    paddingTop: 16,
    paddingHorizontal: 16,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 12,
  },
  title: {
    fontSize: 19,
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: GLASS_INPUT,
    borderWidth: 1,
    borderColor: GLASS_LINE,
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
  },
  sources: {
    flexDirection: 'row',
    gap: 8,
    paddingBottom: 12,
  },
  sourceChip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: GLASS_LINE,
    paddingVertical: 6,
    paddingHorizontal: 14,
  },
  sourceChipOn: {
    backgroundColor: '#F5C77E',
    borderColor: '#F5C77E',
  },
  sourceLabel: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT_MUTED,
  },
  sourceLabelOn: {
    color: '#171310',
  },
  grid: {
    paddingBottom: 24,
    gap: 10,
  },
  gridRow: {
    gap: 10,
  },
  cell: {
    flex: 1,
    aspectRatio: 1,
    borderRadius: 14,
    overflow: 'hidden',
    backgroundColor: GLASS_CARD,
  },
  cellImage: {
    width: '100%',
    height: '100%',
  },
  cellOverlay: {
    position: 'absolute', left: 0, right: 0, top: 0, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  cellCredit: {
    position: 'absolute',
    left: 6,
    right: 6,
    bottom: 6,
    fontSize: 11,
    fontFamily: FONT_SEMIBOLD,
    color: '#fff',
    textShadowColor: 'rgba(0,0,0,0.6)',
    textShadowRadius: 3,
  },
  loading: {
    marginTop: 40,
  },
  emptyState: {
    alignItems: 'center',
    gap: 10,
    paddingTop: 40,
    paddingHorizontal: 12,
  },
  emptyBody: {
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
    textAlign: 'center',
    lineHeight: 20,
  },
});
