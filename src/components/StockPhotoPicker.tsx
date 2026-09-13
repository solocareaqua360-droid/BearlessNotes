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
import RenamePrompt from './RenamePrompt';
import { getPexelsKey, setPexelsKey, subscribeToPexelsKey } from '../utils/pexelsKey';
import { StockPhoto, StockPhotosNotConfigured, searchStockPhotos } from '../utils/stockPhotos';
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
  const [hasKey, setHasKey] = useState<boolean | null>(null);
  const [enteringKey, setEnteringKey] = useState(false);
  const [query, setQuery] = useState('');
  const [photos, setPhotos] = useState<StockPhoto[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [downloadingId, setDownloadingId] = useState<number | null>(null);
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
    searchStockPhotos(text)
      .then((result) => {
        if (id !== requestId.current) return;
        setPhotos(result);
      })
      .catch((e) => {
        if (id !== requestId.current) return;
        setPhotos([]);
        setError(e instanceof StockPhotosNotConfigured ? null : (e as Error).message);
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }

  // Fetched once as soon as there is a key - Pexels' own curated feed, a
  // reasonable start before anyone has typed a word.
  useEffect(() => {
    if (visible && hasKey) runSearch(query);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, hasKey]);

  useEffect(() => {
    if (!visible || !hasKey) return;
    const timer = setTimeout(() => runSearch(query), 400);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  async function pick(photo: StockPhoto) {
    setDownloadingId(photo.id);
    try {
      const dir = `${LegacyFileSystem.cacheDirectory}stockphotos/`;
      await LegacyFileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
      const target = `${dir}pexels-${photo.id}.jpg`;
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

        {hasKey && (
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
        )}

        {hasKey === null && (
          <ActivityIndicator color={GLASS_TEXT} style={styles.loading} />
        )}

        {hasKey === false && (
          <View style={styles.emptyState}>
            <Ionicons name="key-outline" size={30} color={GLASS_TEXT_FAINT} />
            <Text style={styles.emptyTitle}>Потрібен безкоштовний ключ Pexels</Text>
            <Text style={styles.emptyBody}>
              Зареєструйся на pexels.com/api (хвилина, безкоштовно, без підтвердження) і встав ключ тут.
            </Text>
            <Pressable style={styles.emptyButton} onPress={() => setEnteringKey(true)}>
              <Text style={styles.emptyButtonLabel}>Встав ключ</Text>
            </Pressable>
          </View>
        )}

        {hasKey && !!error && (
          <View style={styles.emptyState}>
            <Ionicons name="cloud-offline-outline" size={30} color={GLASS_TEXT_FAINT} />
            <Text style={styles.emptyBody}>{error}</Text>
          </View>
        )}

        {hasKey && !error && (
          <FlatList
            data={photos}
            key="grid2"
            numColumns={2}
            keyExtractor={(item) => String(item.id)}
            contentContainerStyle={styles.grid}
            columnWrapperStyle={styles.gridRow}
            ListEmptyComponent={
              loading ? (
                <ActivityIndicator color={GLASS_TEXT} style={styles.loading} />
              ) : (
                <Text style={styles.emptyBody}>Нічого не знайшлося</Text>
              )
            }
            renderItem={({ item }) => (
              <Pressable
                style={styles.cell}
                disabled={downloadingId !== null}
                onPress={() => pick(item)}
              >
                <Image source={{ uri: item.thumbUrl }} style={styles.cellImage} resizeMode="cover" />
                {downloadingId === item.id && (
                  <View style={styles.cellOverlay}>
                    <ActivityIndicator color="#fff" />
                  </View>
                )}
                <Text style={styles.cellCredit} numberOfLines={1}>
                  {item.photographer}
                </Text>
              </Pressable>
            )}
          />
        )}
      </View>

      <RenamePrompt
        visible={enteringKey}
        title="Ключ Pexels"
        initialValue=""
        placeholder="Встав ключ із pexels.com/api"
        onCancel={() => setEnteringKey(false)}
        onSave={(value) => {
          setEnteringKey(false);
          if (value.trim()) setPexelsKey(value.trim());
        }}
      />
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
  emptyTitle: {
    fontSize: 16,
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
    textAlign: 'center',
  },
  emptyBody: {
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
    textAlign: 'center',
    lineHeight: 20,
  },
  emptyButton: {
    marginTop: 4,
    backgroundColor: '#F5C77E',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 22,
  },
  emptyButtonLabel: {
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
    color: '#171310',
  },
});
