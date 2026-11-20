import { useRef, useState } from 'react';
import { Modal, PixelRatio, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import InlineVideoPlayer from './InlineVideoPlayer';
import { getVideoEmbedInfo } from '../utils/videoEmbed';
import { grabScreenFrame, startScreenCapture, supportsScreenCapture } from '../utils/mindevaNative';
import { hapticSuccess } from '../utils/haptics';

export type VideoFrameShot = { uri: string; width: number; height: number };

type Props = {
  url: string | null;
  onClose: () => void;
  // Given, the player has a «Кадр» button: a frame of the video as it is
  // on the screen, at the screen's own resolution (the video fills the
  // width here - in a card it is a small window and the frame as small),
  // with the moment it shows in seconds (YouTube only; 0 otherwise).
  onFrame?: (shot: VideoFrameShot, seconds: number) => void;
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
export default function VideoPlayerModal({ url, onClose, onFrame }: Props) {
  const { width: winW, height: winH } = useWindowDimensions();
  const info = url ? getVideoEmbedInfo(url) : null;
  const time = useRef(0);
  const topLeft = useRef<View>(null);
  const bottomRight = useRef<View>(null);
  const [framing, setFraming] = useState(false);
  const [taken, setTaken] = useState(0);
  if (!url || !info) return null;

  // The player's box, fitted to the screen in the shape of its video: a
  // YouTube video is wide, a TikTok one tall. The frame is cut to exactly
  // this box, so no black bars come with it.
  const wide = info.provider === 'youtube';
  const ratio = wide ? 16 / 9 : 9 / 16;
  const boxW = Math.min(winW, winH * ratio);
  const boxH = boxW / ratio;

  const corner = (node: View | null) =>
    new Promise<{ x: number; y: number } | null>((resolve) => {
      if (!node) return resolve(null);
      node.measureInWindow((x, y) => resolve({ x, y }));
    });

  async function takeFrame() {
    if (!onFrame || framing) return;
    if (!(await startScreenCapture())) return;
    // The button off the picture, and a moment for the screen to show it
    // so (and for the system's dialog to be gone).
    setFraming(true);
    await new Promise((r) => setTimeout(r, 450));
    const [tl, br] = await Promise.all([corner(topLeft.current), corner(bottomRight.current)]);
    const scale = PixelRatio.get();
    let shot: VideoFrameShot | null = null;
    if (tl && br) {
      for (let attempt = 0; attempt < 8 && !shot; attempt++) {
        shot = await grabScreenFrame({ x: tl.x * scale, y: tl.y * scale, w: (br.x - tl.x) * scale, h: (br.y - tl.y) * scale });
        if (!shot) await new Promise((r) => setTimeout(r, 250));
      }
    }
    setFraming(false);
    if (shot) {
      hapticSuccess();
      setTaken((n) => n + 1);
      onFrame(shot, time.current);
    }
  }

  return (
    <Modal
      visible
      transparent={false}
      animationType="fade"
      onRequestClose={onClose}
      // The window IS the screen, so the player's place in it is its place
      // on the display - what a frame is cut by.
      statusBarTranslucent
      navigationBarTranslucent
    >
      <View style={styles.backdrop}>
        <Pressable style={styles.closeButton} hitSlop={12} onPress={onClose}>
          <Ionicons name="close" size={28} color="#fff" />
        </Pressable>
        <View style={{ width: boxW, height: boxH }}>
          <InlineVideoPlayer
            url={url}
            onTime={(t) => {
              time.current = t;
            }}
          />
          <View ref={topLeft} collapsable={false} pointerEvents="none" style={styles.dotTL} />
          <View ref={bottomRight} collapsable={false} pointerEvents="none" style={styles.dotBR} />
        </View>
        {supportsScreenCapture && onFrame && !framing && (
          <Pressable style={styles.frameButton} onPress={takeFrame} accessibilityLabel="Кадр">
            <Ionicons name="camera-outline" size={26} color="#fff" />
            {taken > 0 && (
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{taken}</Text>
              </View>
            )}
          </Pressable>
        )}
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
  dotTL: { position: 'absolute', left: 0, top: 0, width: 1, height: 1 },
  dotBR: { position: 'absolute', right: 0, bottom: 0, width: 1, height: 1 },
  // Under the player, centred - out of the frame it takes.
  frameButton: {
    position: 'absolute',
    bottom: 56,
    alignSelf: 'center',
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 22,
    height: 22,
    borderRadius: 11,
    paddingHorizontal: 5,
    backgroundColor: '#EC4899',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
