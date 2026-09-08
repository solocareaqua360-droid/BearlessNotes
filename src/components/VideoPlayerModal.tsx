import { ActivityIndicator, Modal, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { getVideoEmbedInfo } from '../utils/videoEmbed';

type Props = {
  url: string | null;
  onClose: () => void;
};

// Navigating a WebView straight to youtube.com/embed/<id> reliably fails
// on-device with YouTube's own "Помилка 153" (player configuration error) -
// the IFrame player checks the page's origin/referrer, and a bare top-level
// WebView navigation supplies none. Wrapping the same embed URL in a tiny
// local HTML page (an actual <iframe>, not a direct navigation) gives it a
// real page context to check against and is the standard fix for this
// exact React Native + YouTube WebView failure.
function htmlForYouTube(embedUrl: string): string {
  return `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" /><style>html,body{margin:0;padding:0;background:#000;height:100%;}iframe{position:fixed;top:0;left:0;width:100%;height:100%;border:0;}</style></head><body><iframe src="${embedUrl}" allow="autoplay; encrypted-media; fullscreen" allowfullscreen></iframe></body></html>`;
}

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
            source={
              info.provider === 'youtube'
                ? // `baseUrl` is the other half of the Error 153 fix: it makes
                  // the WebView report a real https origin for this local
                  // HTML page instead of `about:blank`, which is what the
                  // IFrame player's origin check was actually rejecting -
                  // wrapping the embed in an <iframe> alone wasn't enough.
                  { html: htmlForYouTube(info.embedUrl), baseUrl: 'https://www.youtube-nocookie.com' }
                : { uri: info.embedUrl }
            }
            style={styles.webview}
            originWhitelist={['*']}
            javaScriptEnabled
            domStorageEnabled
            // TikTok's embed page tries to deep-link into the native TikTok
            // app via an `intent://`/`snssdk...://` URL on Android - a bare
            // WebView can't resolve that scheme at all and throws
            // net::ERR_UNKNOWN_URL_SCHEME (Error Code -10), which looked
            // like the whole player crashing. Blocking navigation to
            // anything that isn't plain http(s) keeps the WebView on the
            // embed page instead of trying (and failing) to hand off to an
            // app - exactly what "play it in this app" is supposed to mean.
            onShouldStartLoadWithRequest={(request) => /^https?:\/\//i.test(request.url)}
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
