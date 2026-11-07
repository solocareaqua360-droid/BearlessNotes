import { useMemo, useRef } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';

export type ScreenFrame = { x0: number; y0: number; x1: number; y1: number };

type Corner = 'tl' | 'tr' | 'bl' | 'br';

const MIN_SIZE = 60;
const HANDLE_SIZE = 30;
const MASK_COLOR = 'rgba(0,0,0,0.45)';

// A rectangle the user drags and resizes over the map, fixed in SCREEN
// space rather than tied to any map coordinate - the same idea as a
// photo crop tool's viewfinder: the map underneath can still be panned
// and zoomed (everywhere OUTSIDE the frame passes touches straight
// through - `pointerEvents="box-none"` plus "none" on the four mask
// panels), while the frame itself stays put until dragged. Purely
// controlled: GeoAreaPicker owns the numbers and only turns the frame's
// screen corners into real coordinates once, when the user confirms.
export default function GeoAreaFrame({
  frame,
  bounds,
  onChange,
}: {
  frame: ScreenFrame;
  bounds: { width: number; height: number };
  onChange: (frame: ScreenFrame) => void;
}) {
  const theme = useTheme();
  // A PanResponder keeps its own per-gesture state (where the touch
  // started) inside the object PanResponder.create() returns. Building a
  // FRESH one on every render - as this used to, since `frame` changes on
  // every drag event - swapped that object out mid-gesture and lost
  // exactly that state, which read as the frame jittering in place
  // instead of following the finger. The five responders below are now
  // created once (useMemo, empty deps) and read the latest frame/bounds
  // through refs instead of through their own closure.
  const frameRef = useRef(frame);
  frameRef.current = frame;
  const boundsRef = useRef(bounds);
  boundsRef.current = bounds;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const startRef = useRef<ScreenFrame | null>(null);

  function clamp(next: ScreenFrame): ScreenFrame {
    const b = boundsRef.current;
    const x0 = Math.max(0, Math.min(next.x0, next.x1 - MIN_SIZE));
    const y0 = Math.max(0, Math.min(next.y0, next.y1 - MIN_SIZE));
    const x1 = Math.min(b.width, Math.max(next.x1, next.x0 + MIN_SIZE));
    const y1 = Math.min(b.height, Math.max(next.y1, next.y0 + MIN_SIZE));
    return { x0, y0, x1, y1 };
  }

  const cornerResponders = useMemo(() => {
    const make = (corner: Corner) =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          startRef.current = frameRef.current;
        },
        onPanResponderMove: (_e, gesture) => {
          const start = startRef.current;
          if (!start) return;
          const next = { ...start };
          if (corner === 'tl' || corner === 'bl') next.x0 = start.x0 + gesture.dx;
          if (corner === 'tr' || corner === 'br') next.x1 = start.x1 + gesture.dx;
          if (corner === 'tl' || corner === 'tr') next.y0 = start.y0 + gesture.dy;
          if (corner === 'bl' || corner === 'br') next.y1 = start.y1 + gesture.dy;
          onChangeRef.current(clamp(next));
        },
      });
    return { tl: make('tl'), tr: make('tr'), bl: make('bl'), br: make('br') };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const moveResponder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onPanResponderGrant: () => {
          startRef.current = frameRef.current;
        },
        onPanResponderMove: (_e, gesture) => {
          const start = startRef.current;
          if (!start) return;
          const b = boundsRef.current;
          const w = start.x1 - start.x0;
          const h = start.y1 - start.y0;
          const x0 = Math.max(0, Math.min(start.x0 + gesture.dx, b.width - w));
          const y0 = Math.max(0, Math.min(start.y0 + gesture.dy, b.height - h));
          onChangeRef.current({ x0, y0, x1: x0 + w, y1: y0 + h });
        },
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const { tl, tr, bl, br } = cornerResponders;

  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <View pointerEvents="none" style={[styles.mask, { left: 0, top: 0, right: 0, height: frame.y0 }]} />
      <View pointerEvents="none" style={[styles.mask, { left: 0, top: frame.y1, right: 0, bottom: 0 }]} />
      <View
        pointerEvents="none"
        style={[styles.mask, { left: 0, top: frame.y0, width: frame.x0, height: frame.y1 - frame.y0 }]}
      />
      <View
        pointerEvents="none"
        style={[
          styles.mask,
          { left: frame.x1, top: frame.y0, right: 0, height: frame.y1 - frame.y0 },
        ]}
      />
      <View
        {...moveResponder.panHandlers}
        style={[
          styles.body,
          {
            left: frame.x0,
            top: frame.y0,
            width: frame.x1 - frame.x0,
            height: frame.y1 - frame.y0,
            borderColor: theme.accent,
          },
        ]}
      />
      {(
        [
          ['tl', tl, frame.x0, frame.y0],
          ['tr', tr, frame.x1, frame.y0],
          ['bl', bl, frame.x0, frame.y1],
          ['br', br, frame.x1, frame.y1],
        ] as const
      ).map(([key, responder, x, y]) => (
        <View
          key={key}
          {...responder.panHandlers}
          style={[
            styles.handle,
            { left: x - HANDLE_SIZE / 2, top: y - HANDLE_SIZE / 2, backgroundColor: theme.accent },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  mask: {
    position: 'absolute',
    backgroundColor: MASK_COLOR,
  },
  body: {
    position: 'absolute',
    borderWidth: 2,
    borderStyle: 'dashed',
  },
  handle: {
    position: 'absolute',
    width: HANDLE_SIZE,
    height: HANDLE_SIZE,
    borderRadius: HANDLE_SIZE / 2,
    borderWidth: 2,
    borderColor: '#fff',
  },
});
