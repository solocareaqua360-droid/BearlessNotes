import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getVideoEmbedInfo } from '../utils/videoEmbed';
import { GLASS_BACKDROP, GLASS_TEXT } from '../constants/glass';

// The browser plays video better than the phone does, and with less: the
// native screen needs a WebView (a native module with no web build at
// all), where here the same embed is an iframe the page already knows how
// to show.
export default function VideoPlayerModal({ url, onClose }: { url: string | null; onClose: () => void }) {
  const embed = url ? getVideoEmbedInfo(url)?.embedUrl : null;
  if (!url || !embed) return null;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={StyleSheet.absoluteFill} onPress={onClose} />
        <View style={styles.frame}>
          {/* Plain DOM inside React Native Web, which is what this
              renderer is for. */}
          <iframe
            src={embed}
            style={{ width: '100%', height: '100%', border: 0, borderRadius: 16 }}
            allow="autoplay; encrypted-media; picture-in-picture"
            allowFullScreen
          />
        </View>
        <Pressable style={styles.close} onPress={onClose} hitSlop={10}>
          <Ionicons name="close-outline" size={28} color={GLASS_TEXT} />
        </Pressable>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: GLASS_BACKDROP,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  frame: {
    width: '100%',
    maxWidth: 960,
    aspectRatio: 16 / 9,
    borderRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#000',
  },
  close: {
    position: 'absolute',
    top: 24,
    right: 24,
  },
});
