import { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { deviceCopyOf, ensureLocalFile } from '../../utils/googleDrive';
import { localPathFor } from '../../utils/localPath';
import { useSoft } from '../../theme/soft';
import { SOFT_MEDIUM } from '../../utils/fonts';
import type { ThoughtVideo } from '../../hooks/useThoughts';

// A THOUGHT'S VIDEO, played in its card (2026-11-16, the inbox). The file is this phone's own copy; on the other device
// (or after a reinstall) it is fetched from Drive first, the way every attachment is (ensureLocalFile). Never starts by
// itself - the card is for looking, the play button is the user's.
export default function ThoughtVideoPlayer({ video }: { video: ThoughtVideo }) {
  const S = useSoft();
  const [src, setSrc] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    let alive = true;
    setSrc(null);
    setMissing(false);
    (async () => {
      const here = await ensureLocalFile(video.uri, video.driveFileId).catch(() => false);
      const path = here ? localPathFor(video.uri, video.driveFileId) ?? video.uri : video.driveFileId ? await deviceCopyOf(video.uri, video.driveFileId).catch(() => null) : null;
      if (!alive) return;
      if (path) setSrc(path);
      else setMissing(true);
    })();
    return () => {
      alive = false;
    };
  }, [video.uri, video.driveFileId]);
  const player = useVideoPlayer(src, (p) => {
    p.loop = false;
  });
  if (missing) {
    return (
      <View style={[styles.box, { backgroundColor: S.fill }]}>
        <Text style={[styles.note, { color: S.ink3 }]}>Відео ще не на цьому пристрої</Text>
      </View>
    );
  }
  return (
    <View style={[styles.box, { backgroundColor: '#111' }]}>
      {src ? (
        <VideoView player={player} style={StyleSheet.absoluteFill} contentFit="contain" nativeControls fullscreenOptions={{ enable: true }} />
      ) : (
        <ActivityIndicator color="#fff" />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: '100%', aspectRatio: 16 / 10, borderRadius: 18, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: 14, fontFamily: SOFT_MEDIUM },
});
