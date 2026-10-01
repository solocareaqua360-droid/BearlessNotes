import { useRef, useState } from 'react';
import { Animated, PanResponder, Pressable, Text, View } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import InlineVideoPlayer, { type VideoSeek } from './InlineVideoPlayer';

// THE NOTE'S OWN PLAYER (DocumentEditorScreen's noteVideo), pinned in a
// corner of the page - RESIZABLE and MOVABLE the way YouTube's mini
// player is (the user's, 2026-10-02: "треба зменшити щоб на нотатку не
// залазило", then "перетягнути в інший кут"):
// - the resize grip grows the player away from the corner it is pinned
//   to, always 16:9;
// - the move grip carries it anywhere, and let go it settles into the
//   nearest of the four corners.
// Its own component so a drag re-renders this panel, not the whole
// editor. Size and corner are kept for the session: the next video opens
// where and how big the last one was left.
const MIN_WIDTH = 160;
const SIDE = 12;
type Corner = { right: boolean; bottom: boolean };
let lastWidth: number | null = null;
let lastCorner: Corner = { right: true, bottom: false };

type Styles = Record<'noteVideoPanel' | 'noteVideoFrame' | 'noteVideoActions' | 'noteVideoButton' | 'noteVideoLabel', object>;

export default function NoteVideoPanel({
  url,
  start,
  seek,
  top,
  bottom,
  windowWidth,
  windowHeight,
  background,
  ink,
  styles,
  onFullscreen,
  onClose,
}: {
  url: string;
  start: number;
  seek: VideoSeek;
  // How far from the top and bottom edges the corners sit (the top bar,
  // the dock or the keyboard).
  top: number;
  bottom: number;
  windowWidth: number;
  windowHeight: number;
  background: string;
  ink: string;
  styles: Styles;
  onFullscreen: () => void;
  onClose: () => void;
}) {
  const maxWidth = windowWidth - SIDE * 2;
  const clamp = (w: number) => Math.max(MIN_WIDTH, Math.min(maxWidth, w));
  const [width, setWidth] = useState(() => clamp(lastWidth ?? Math.min(maxWidth, 420)));
  const [corner, setCorner] = useState<Corner>(lastCorner);
  const offset = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const height = useRef(0);

  // What the responders read - they are made once, the props change.
  const live = useRef({ width, corner, clamp, top, bottom, windowWidth, windowHeight });
  live.current = { width, corner, clamp, top, bottom, windowWidth, windowHeight };
  const startWidth = useRef(width);

  // Where the panel's top-left stands when pinned to a corner.
  const originOf = (c: Corner, w: number) => {
    const l = live.current;
    return {
      x: c.right ? l.windowWidth - SIDE - w : SIDE,
      y: c.bottom ? l.windowHeight - l.bottom - height.current : l.top,
    };
  };

  const resize = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderGrant: () => {
        startWidth.current = live.current.width;
      },
      // Away from the pinned corner is bigger; the height follows the
      // width, so a vertical drag counts 16/9 over.
      onPanResponderMove: (_, g) => {
        const { corner: c, clamp: fit } = live.current;
        const along = c.right ? -g.dx : g.dx;
        const down = (c.bottom ? -g.dy : g.dy) * (16 / 9);
        const next = fit(startWidth.current + (Math.abs(along) >= Math.abs(down) ? along : down));
        lastWidth = next;
        setWidth(next);
      },
    })
  ).current;

  const move = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderTerminationRequest: () => false,
      onPanResponderMove: (_, g) => offset.setValue({ x: g.dx, y: g.dy }),
      onPanResponderRelease: (_, g) => {
        const { corner: c, width: w, windowWidth: ww, windowHeight: wh } = live.current;
        const from = originOf(c, w);
        const cx = from.x + g.dx + w / 2;
        const cy = from.y + g.dy + height.current / 2;
        const next: Corner = { right: cx > ww / 2, bottom: cy > wh / 2 };
        const to = originOf(next, w);
        // Re-pinned where it was let go, then it glides into the corner.
        offset.setValue({ x: from.x + g.dx - to.x, y: from.y + g.dy - to.y });
        lastCorner = next;
        setCorner(next);
        Animated.spring(offset, { toValue: { x: 0, y: 0 }, useNativeDriver: false, bounciness: 4 }).start();
      },
      onPanResponderTerminate: () => {
        Animated.spring(offset, { toValue: { x: 0, y: 0 }, useNativeDriver: false }).start();
      },
    })
  ).current;

  // Too narrow for words: the buttons keep their icons only.
  const compact = width < 340;
  const grip = (handlers: object, icon: 'resize' | 'move', label: string, cursor: string) => (
    <View
      {...handlers}
      hitSlop={10}
      accessibilityLabel={label}
      style={{ width: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 12, cursor } as object}
    >
      <Ionicons name={icon} size={18} color={ink} />
    </View>
  );
  const resizeGrip = grip(resize.panHandlers, 'resize', 'Змінити розмір', corner.right === corner.bottom ? 'nwse-resize' : 'nesw-resize');
  const moveGrip = grip(move.panHandlers, 'move', 'Перемістити', 'grab');

  return (
    <Animated.View
      onLayout={(e) => {
        height.current = e.nativeEvent.layout.height;
      }}
      style={[
        styles.noteVideoPanel,
        {
          width,
          backgroundColor: background,
          ...(corner.right ? { right: SIDE } : { left: SIDE }),
          ...(corner.bottom ? { bottom } : { top }),
          transform: offset.getTranslateTransform(),
        },
      ]}
    >
      <View style={styles.noteVideoFrame}>
        <InlineVideoPlayer key={url} url={url} start={start} seek={seek} />
      </View>
      <View style={styles.noteVideoActions}>
        {/* The resize grip on the free side - away from the pinned edge. */}
        {corner.right && resizeGrip}
        {moveGrip}
        <Pressable style={styles.noteVideoButton} onPress={onFullscreen}>
          <Ionicons name="expand-outline" size={16} color={ink} />
          {!compact && <Text style={[styles.noteVideoLabel, { color: ink }]}>На весь екран</Text>}
        </Pressable>
        <Pressable style={styles.noteVideoButton} onPress={onClose}>
          <Ionicons name="close" size={16} color={ink} />
          {!compact && <Text style={[styles.noteVideoLabel, { color: ink }]}>Закрити</Text>}
        </Pressable>
        {!corner.right && resizeGrip}
      </View>
    </Animated.View>
  );
}
