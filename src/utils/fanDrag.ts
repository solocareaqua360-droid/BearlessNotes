import { useMemo, useRef } from 'react';
import { Gesture } from 'react-native-gesture-handler';

// PRESS AND SLIDE on a «+» (the user, 2026-10-10): the finger that went down on
// the button opens the fan and keeps going; whatever button it lifts over is
// picked. The gesture lives on the «+», the fan listens here. A drag that
// starts before the fan has mounted is replayed to it when it registers.
export type FanDragListener = { move(x: number, y: number): void; end(x: number, y: number): void };

let active = false;
let point = { x: 0, y: 0 };
let listener: FanDragListener | null = null;

export function registerFanDrag(l: FanDragListener) {
  listener = l;
  if (active) l.move(point.x, point.y);
  return () => {
    if (listener === l) listener = null;
  };
}

// Plain functions, on purpose: a gesture callback is turned into a worklet, and a worklet
// copies the module variables it mentions - it would keep reading `listener` as null.
function dragStart(x: number, y: number) {
  active = true;
  point = { x, y };
}
function dragMove(x: number, y: number) {
  point = { x, y };
  listener?.move(x, y);
}
function dragEnd(x: number, y: number) {
  active = false;
  listener?.end(x, y);
}
function dragCancel() {
  active = false;
}

// The pan on a «+»: `open` is what a plain tap on it does (it opens the fan).
// Under 12 pt of travel nothing happens, so tap and hold (the chat) are untouched.
export function useFanDragGesture(open: () => void) {
  const openRef = useRef(open);
  openRef.current = open;
  return useMemo(
    () =>
      Gesture.Pan()
        .minDistance(12)
        .runOnJS(true)
        .onStart((e) => {
          dragStart(e.absoluteX, e.absoluteY);
          openRef.current();
        })
        .onUpdate((e) => dragMove(e.absoluteX, e.absoluteY))
        .onEnd((e) => dragEnd(e.absoluteX, e.absoluteY))
        .onFinalize((_e, success) => {
          if (!success) dragCancel();
        }),
    []
  );
}
