import { useEffect, useRef } from 'react';
import { useEmbedUrl } from '../hooks/useEmbedUrl';
import { getVideoEmbedInfo, youtubeCommand, youtubeEmbedAt } from '../utils/videoEmbed';

export type VideoSeek = { t: number; n: number };

// The browser's side of InlineVideoPlayer: the same embed address, in an
// iframe - react-native-webview has no browser build, and used to answer
// here with its red "does not support this platform" in the card's place.
// It fills whatever box it is put in, exactly as the WebView does.
export default function InlineVideoPlayer({ url, start, seek }: { url: string; start?: number; seek?: VideoSeek }) {
  const resolvedUrl = useEmbedUrl(url);
  const youtube = getVideoEmbedInfo(url)?.provider === 'youtube';
  // Timecodes - see the native player and youtubeEmbedAt.
  const startRef = useRef(start);
  const embedUrl = resolvedUrl && youtube ? youtubeEmbedAt(resolvedUrl, startRef.current) : resolvedUrl;
  const frameRef = useRef<HTMLIFrameElement>(null);
  const firstSeek = useRef(seek?.n);
  useEffect(() => {
    if (!seek || seek.n === firstSeek.current) return;
    const target = frameRef.current?.contentWindow;
    target?.postMessage(youtubeCommand('seekTo', [seek.t, true]), '*');
    target?.postMessage(youtubeCommand('playVideo'), '*');
  }, [seek]);
  // Not a video at all: nothing. A video whose address is still being
  // worked out: the black the frame will be.
  if (!embedUrl && !getVideoEmbedInfo(url)) return null;
  if (!embedUrl) return <div style={{ width: '100%', height: '100%', backgroundColor: '#000' }} />;
  return (
    <iframe
      ref={frameRef}
      src={embedUrl}
      title="Відео"
      allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
      style={{ width: '100%', height: '100%', border: 0, backgroundColor: '#000' }}
    />
  );
}
