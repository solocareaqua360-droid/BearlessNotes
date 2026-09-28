import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import BoardMiniMap from './BoardMiniMap';
import { BoardCard, BoardColumn, BoardConnection, BoardContainer, BoardShape } from '../types';

// THE ONE-TIME SCREENSHOT (step 2 of "повноцінне прев'ю на дошках" -
// BoardMiniMap already covers the cheap, live, always-fresh side of that;
// this is the other side, a real picture, paid for once instead of on
// every render of the boards list.
//
// Captured at the same size every time, regardless of the board's actual
// bounds - a fixed frame BoardMiniMap already knows how to fit any board
// into (the same fit-to-box maths the live map uses). Sized to the widest
// place the boards list ever shows this picture (the tile view's own
// map, ~300x216 at the grid's largest column count) at roughly 2x, so it
// stays sharp there and is comfortably oversized for the 52x52 row icon,
// which just crops into it (AttachmentImage's own `cover`, same as any
// other cached photo).
export const BOARD_PREVIEW_W = 640;
export const BOARD_PREVIEW_H = 460;

// MOUNTED ONCE AT THE APP ROOT (`BoardPreviewCaptureHost` in App.tsx),
// the same "module-level listener, opened from anywhere" shape as
// AskHost and CaptureWindow's own `openCapture`.
//
// The first version of this held its off-screen stage INSIDE BoardScreen
// itself, captured on that screen's own leave-effect - which is the
// worst possible place for it: `useFocusEffect`'s cleanup fires on this
// screen BLURRING, which is already mid-teardown by the time navigation
// finishes, so the mount -> layout -> wait -> captureRef chain
// (a few hundred ms) could lose that race and simply never complete.
// Confirmed on-device: what got saved was "картки... зафіксуватися не в
// тому положенні, в якому я їх залишив" - not the leave-moment's real
// state, but whatever the LAST capture that happened to survive caught,
// which could be an earlier, half-finished arrangement.
//
// Living here instead - a component that never unmounts while the app
// is open - the capture always runs to completion regardless of which
// screen asked for it or what it does next.
type CaptureRequest = {
  cards: BoardCard[];
  columns: BoardColumn[];
  connections: BoardConnection[];
  shapes: BoardShape[];
  containers: BoardContainer[];
  resolve: (uri: string | null) => void;
};

let requestCapture: ((req: CaptureRequest) => void) | null = null;

// Null when there is nothing worth a picture of (an empty board), the
// host isn't mounted yet (should not happen - it lives at the app root),
// or the capture itself failed - callers treat all three as "no preview
// yet", not as an error; BoardMiniMap keeps drawing the live map
// meanwhile.
export function captureBoardPreview(
  cards: BoardCard[],
  columns: BoardColumn[],
  connections: BoardConnection[],
  shapes: BoardShape[],
  containers: BoardContainer[]
): Promise<string | null> {
  if (cards.length === 0 && columns.length === 0 && shapes.length === 0) return Promise.resolve(null);
  if (!requestCapture) {
    console.warn('[board preview] capture host not mounted');
    return Promise.resolve(null);
  }
  return new Promise((resolve) => requestCapture!({ cards, columns, connections, shapes, containers, resolve }));
}

export default function BoardPreviewCaptureHost() {
  const [request, setRequest] = useState<CaptureRequest | null>(null);

  useEffect(() => {
    requestCapture = (req) => setRequest(req);
    return () => {
      requestCapture = null;
    };
  }, []);

  if (!request) return null;
  return (
    <View style={{ position: 'absolute', top: -100000, left: -100000 }} pointerEvents="none">
      <CaptureStage
        {...request}
        onDone={(uri) => {
          request.resolve(uri);
          setRequest(null);
        }}
      />
    </View>
  );
}

function CaptureStage({
  cards,
  columns,
  connections,
  shapes,
  containers,
  onDone,
}: {
  cards: BoardCard[];
  columns: BoardColumn[];
  connections: BoardConnection[];
  shapes: BoardShape[];
  containers: BoardContainer[];
  onDone: (uri: string | null) => void;
}) {
  const stageRef = useRef<View>(null);
  return (
    <View
      ref={stageRef}
      collapsable={false}
      style={{ width: BOARD_PREVIEW_W, height: BOARD_PREVIEW_H, backgroundColor: '#F4F4F3' }}
      // A longer tick than the photo-flatten's 80ms: this frame holds
      // several images at once (every document/link/photo card with a
      // cached picture), each its own async decode, not one already-
      // local file.
      onLayout={() => {
        setTimeout(async () => {
          try {
            const shot = await captureRef(stageRef, { format: 'jpg', quality: 0.75, result: 'tmpfile' });
            onDone(shot);
          } catch (e) {
            console.warn('[board preview] captureRef failed', e);
            onDone(null);
          }
        }, 180);
      }}
    >
      <BoardMiniMap
        cards={cards}
        columns={columns}
        connections={connections}
        shapes={shapes}
        containers={containers}
        width={BOARD_PREVIEW_W}
        height={BOARD_PREVIEW_H}
        showText
        detailed
      />
    </View>
  );
}
