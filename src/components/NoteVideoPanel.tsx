import { useRef, useState } from 'react';
import { PanResponder, Pressable, Text, View } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import InlineVideoPlayer, { type VideoSeek } from './InlineVideoPlayer';

// THE NOTE'S OWN PLAYER (DocumentEditorScreen's noteVideo), pinned to the
// top right of the page - and RESIZABLE the way YouTube's mini player is
// (the user's, 2026-10-02: "треба зменшити щоб на нотатку не залазило").
// The grip is the free corner, bottom left: dragging it out grows the
// player, dragging it in shrinks it, always 16:9. Its own component so a
// drag re-renders this panel, not the whole editor.
//
// The width is kept for the session: the next video opens the size the
// last one was left at.
const MIN_WIDTH = 160;
let lastWidth: number | null = null;

type Styles = Record<'noteVideoPanel' | 'noteVideoFrame' | 'noteVideoActions' | 'noteVideoButton' | 'noteVideoLabel', object>;

export default function NoteVideoPanel({
  url,
  start,
  seek,
  top,
  maxWidth,
  background,
  ink,
  styles,
  onFullscreen,
  onClose,
}: {
  url: string;
  start: number;
  seek: VideoSeek;
  top: number;
  maxWidth: number;
  background: string;
  ink: string;
  styles: Styles;
  onFullscreen: () => void;
  onClose: () => void;
}) {
  const clamp = (w: number) => Math.max(MIN_WIDTH, Math.min(maxWidth, w));
  const [width, setWidth] = useState(() => clamp(lastWidth ?? Math.min(maxWidth, 420)));
  const widthRef = useRef(width);
  widthRef.current = width;
  const clampRef = useRef(clamp);
  clampRef.current = clamp;
  const startWidth = useRef(width);

  const grip = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        startWidth.current = widthRef.current;
      },
      // Anchored on the right: the corner going left (or down - the
      // height follows the width) makes it bigger.
      onPanResponderMove: (_, g) => {
        const grow = Math.abs(g.dx) >= Math.abs(g.dy * (16 / 9)) ? -g.dx : g.dy * (16 / 9);
        const next = clampRef.current(startWidth.current + grow);
        lastWidth = next;
        setWidth(next);
      },
    })
  ).current;

  // Too narrow for words: the buttons keep their icons only.
  const compact = width < 300;
  return (
    <View style={[styles.noteVideoPanel, { top, width, backgroundColor: background }]}>
      <View style={styles.noteVideoFrame}>
        <InlineVideoPlayer key={url} url={url} start={start} seek={seek} />
      </View>
      <View style={styles.noteVideoActions}>
        <View
          {...grip.panHandlers}
          hitSlop={10}
          style={{ width: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, cursor: 'nwse-resize' } as object}
          accessibilityLabel="Змінити розмір"
        >
          <Ionicons name="resize" size={18} color={ink} />
        </View>
        <Pressable style={styles.noteVideoButton} onPress={onFullscreen}>
          <Ionicons name="expand-outline" size={16} color={ink} />
          {!compact && <Text style={[styles.noteVideoLabel, { color: ink }]}>На весь екран</Text>}
        </Pressable>
        <Pressable style={styles.noteVideoButton} onPress={onClose}>
          <Ionicons name="close" size={16} color={ink} />
          {!compact && <Text style={[styles.noteVideoLabel, { color: ink }]}>Закрити</Text>}
        </Pressable>
      </View>
    </View>
  );
}
