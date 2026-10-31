import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import Sheet from './surfaces/Sheet';
import InlineVideoPlayer from './InlineVideoPlayer';
import { Ionicons } from './icons/Ionicons';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';
import type { FolderItem } from '../hooks/useAllFolderItems';

// THE PLAYLIST'S OWN WINDOW (the user, 2026-10-11): the videos of a playlist as small cards in a list. A tap
// on one makes it BIG - the same card, in the same place, now a player - and it plays; a tap beside it (or
// on its own title) makes it small again; the next tap on another video makes that one big. One at a time.
export type PlaylistVideo = { id: string; title: string; url: string; thumb?: string; site?: string };

export function videoOf(item: FolderItem): PlaylistVideo {
  const raw = (item.raw ?? {}) as Record<string, unknown>;
  return {
    id: item.id,
    title: item.title,
    url: String(raw.url ?? ''),
    thumb: typeof raw.imageUrl === 'string' ? raw.imageUrl : undefined,
    site: typeof raw.siteName === 'string' ? raw.siteName : undefined,
  };
}

export default function PlaylistWindow({
  visible,
  title,
  videos,
  onClose,
}: {
  visible: boolean;
  title: string;
  videos: PlaylistVideo[];
  onClose: () => void;
}) {
  const S = useSoft();
  // The list shows at most THREE AND A HALF rows (the half says it scrolls, inside the window) - the user's rule.
  const ROW_H = 70;
  const listMax = Math.round(ROW_H * 3.5 + 10 * 3);
  // Like a YouTube playlist (the user's reference, 2026-10-11): ONE big card of the current video stays at the top
  // and never resizes; a tap on a row of the list makes that video the current one and plays it there.
  const [current, setCurrent] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!visible) {
      setCurrent(null);
      setPlaying(false);
    }
  }, [visible]);
  const big = videos.find((v) => v.id === current) ?? videos[0];
  const header = (
    <View style={{ gap: 8, paddingBottom: 10 }}>
      <View style={styles.titleRow}>
        <View style={{ flex: 1 }}>
          <Text style={[styles.winTitle, { color: S.ink }]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={[styles.site, { color: S.ink3 }]}>{`Плейліст · ${videos.length} відео`}</Text>
        </View>
        <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Закрити" style={[styles.closeBtn, { backgroundColor: S.fill }]}>
          <Ionicons name={'close-outline' as never} size={22} color={S.ink} />
        </Pressable>
      </View>
      {big ? (
        <>
      <View style={[styles.player, { borderRadius: 16 }]}>
        {playing ? (
          <InlineVideoPlayer url={big.url} />
        ) : (
          <Pressable onPress={() => setPlaying(true)} style={StyleSheet.absoluteFill}>
            {big.thumb ? <Image source={{ uri: big.thumb }} style={StyleSheet.absoluteFill} resizeMode="cover" /> : <View style={[StyleSheet.absoluteFill, { backgroundColor: S.fill }]} />}
            <View style={[StyleSheet.absoluteFill, { alignItems: 'center', justifyContent: 'center' }]}>
              <View style={styles.playDisc}>
                <Ionicons name={'play-outline' as never} size={26} color="#fff" />
              </View>
            </View>
          </Pressable>
        )}
      </View>
      <View style={{ height: 62 }}>
        <Text style={[styles.bigTitle, { color: S.ink }]} numberOfLines={2}>
          {big.title}
        </Text>
        <Text style={[styles.site, { color: S.ink3 }]} numberOfLines={1}>
          {big.site ?? ''}
        </Text>
      </View>
        </>
      ) : null}
    </View>
  );
  return (
    <Sheet visible={visible} onClose={onClose} handle={false} header={header} scroll maxHeight={listMax}>
      <View style={{ gap: 10, paddingBottom: 8 }}>
        {videos.map((v) => {
          const on = big?.id === v.id;
          return (
            <Pressable
              key={v.id}
              onPress={() => {
                // Only switches the BIG card's preview; playing starts from the big card itself.
                setCurrent(v.id);
                setPlaying(false);
              }}
              style={[styles.row, { backgroundColor: on ? S.fill : S.card, boxShadow: S.shadow }]}
            >
              {v.thumb ? (
                <Image source={{ uri: v.thumb }} style={styles.thumb} resizeMode="cover" />
              ) : (
                <View style={[styles.thumb, styles.noThumb, { backgroundColor: S.fill }]}>
                  <Ionicons name={'play-outline' as never} size={20} color={S.ink3} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={[styles.title, { color: S.ink }]} numberOfLines={2}>
                  {v.title}
                </Text>
                {!!v.site && <Text style={[styles.site, { color: S.ink3 }]}>{v.site}</Text>}
              </View>
            </Pressable>
          );
        })}
        {videos.length === 0 && <Text style={[styles.site, { color: S.ink3 }]}>У плейлисті ще немає відео.</Text>}
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  winTitle: { fontSize: 17, fontFamily: SOFT_SEMIBOLD },
  closeBtn: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, padding: 8, borderRadius: 16 },
  thumb: { width: 96, height: 54, borderRadius: 10 },
  noThumb: { alignItems: 'center', justifyContent: 'center' },
  player: { width: '100%', aspectRatio: 16 / 9, backgroundColor: '#000', overflow: 'hidden' },
  playDisc: { width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  bigTitle: { fontSize: 16, fontFamily: SOFT_SEMIBOLD },
  title: { fontSize: 14, fontFamily: SOFT_SEMIBOLD },
  site: { fontSize: 12, fontFamily: SOFT_MEDIUM },
});
