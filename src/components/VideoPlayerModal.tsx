import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { getVideoEmbedInfo } from '../utils/videoEmbed';

type Props = {
  url: string | null;
  onClose: () => void;
};

// In-app YouTube/TikTok playback - a WebView loading the provider's own
// stripped-down embed player (see utils/videoEmbed.ts), same full-screen
// backdrop + close button shape as ZoomableImageViewer. `url` doubles as
// the visibility flag (null = closed) since there's never a reason to keep
// a previous video mounted once dismissed.
export default function VideoPlayerModal({ url, onClose }: Props) {
  const info = url ? getVideoEmbedInfo(url) : null;
  if (!url || !info) return null;

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.closeButton} hitSlop={12} onPress={onClose}>
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
        <View style={styles.playerWrap}>
          <WebView
            source={{ uri: info.embedUrl }}
            style={styles.webview}
            allowsFullscreenVideo
            mediaPlaybackRequiresUserAction={false}
            renderLoading={() => (
              <View style={styles.loading}>
                <ActivityIndicator color="#fff" />
              </View>
            )}
            startInLoadingState
          />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: '#000',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeButton: {
    position: 'absolute',
    top: 48,
    right: 20,
    zIndex: 1,
    padding: 8,
  },
  playerWrap: {
    width: '100%',
    aspectRatio: 9 / 16,
    maxHeight: '100%',
  },
  webview: {
    flex: 1,
    backgroundColor: '#000',
  },
  loading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#000',
  },
});
