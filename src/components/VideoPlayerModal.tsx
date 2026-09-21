import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import InlineVideoPlayer from './InlineVideoPlayer';
import { getVideoEmbedInfo } from '../utils/videoEmbed';

type Props = {
  url: string | null;
  onClose: () => void;
};

// The full-screen way to watch - a black backdrop with a close button
// around the shared player (see InlineVideoPlayer, which holds the
// WebView configuration both this and a card's own inline player need).
// `url` doubles as the visibility flag (null = closed) since there's
// never a reason to keep a previous video mounted once dismissed.
//
// Playing in the CARD is the default now; this is what "розгорнути"
// opens from there, and what a screen with no room for an inline player
// still uses.
export default function VideoPlayerModal({ url, onClose }: Props) {
  if (!url || !getVideoEmbedInfo(url)) return null;

  return (
    <Modal visible transparent={false} animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Pressable style={styles.closeButton} hitSlop={12} onPress={onClose}>
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
        <View style={styles.playerWrap}>
          <InlineVideoPlayer url={url} />
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
});
