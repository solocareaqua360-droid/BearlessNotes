import { useEmbedUrl } from '../hooks/useEmbedUrl';
import { getVideoEmbedInfo } from '../utils/videoEmbed';

// The browser's side of InlineVideoPlayer: the same embed address, in an
// iframe - react-native-webview has no browser build, and used to answer
// here with its red "does not support this platform" in the card's place.
// It fills whatever box it is put in, exactly as the WebView does.
export default function InlineVideoPlayer({ url }: { url: string }) {
  const embedUrl = useEmbedUrl(url);
  // Not a video at all: nothing. A video whose address is still being
  // worked out: the black the frame will be.
  if (!embedUrl && !getVideoEmbedInfo(url)) return null;
  if (!embedUrl) return <div style={{ width: '100%', height: '100%', backgroundColor: '#000' }} />;
  return (
    <iframe
      src={embedUrl}
      title="Відео"
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      style={{ width: '100%', height: '100%', border: 0, backgroundColor: '#000' }}
    />
  );
}
