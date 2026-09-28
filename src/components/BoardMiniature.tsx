import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import BoardMiniMap from './BoardMiniMap';
import { BoardCard, BoardColumn, BoardConnection, BoardShape } from '../types';

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

// The exact same off-screen-mount-then-capture shape `useFlattenPhoto`
// already uses for the sketch-on-photo flatten - proven on this app,
// no native module beyond what is already installed (`react-native-
// view-shot`, wired in since the sketch feature).
type CaptureRequest = {
  cards: BoardCard[];
  columns: BoardColumn[];
  connections: BoardConnection[];
  shapes: BoardShape[];
  resolve: (uri: string | null) => void;
};

export function useBoardPreviewCapture() {
  const [request, setRequest] = useState<CaptureRequest | null>(null);

  // Null when there is nothing worth a picture of (an empty board) or the
  // capture itself failed - callers treat that as "no preview yet", not
  // as an error; BoardMiniMap keeps drawing the live map meanwhile.
  //
  // Stable identity (useCallback, empty deps - `setRequest` itself never
  // changes): a caller that puts this in a useCallback's own deps must
  // not see it as "changed" on every render, or every effect built on
  // top of it would re-fire on every render too.
  const capture = useCallback(
    (
      cards: BoardCard[],
      columns: BoardColumn[],
      connections: BoardConnection[],
      shapes: BoardShape[]
    ): Promise<string | null> => {
      if (cards.length === 0 && columns.length === 0 && shapes.length === 0) return Promise.resolve(null);
      return new Promise((resolve) => setRequest({ cards, columns, connections, shapes, resolve }));
    },
    []
  );

  const node = request ? (
    <View style={{ position: 'absolute', top: -100000, left: -100000 }} pointerEvents="none">
      <CaptureStage
        {...request}
        onDone={(uri) => {
          request.resolve(uri);
          setRequest(null);
        }}
      />
    </View>
  ) : null;

  return { capture, node };
}

function CaptureStage({
  cards,
  columns,
  connections,
  shapes,
  onDone,
}: {
  cards: BoardCard[];
  columns: BoardColumn[];
  connections: BoardConnection[];
  shapes: BoardShape[];
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
        width={BOARD_PREVIEW_W}
        height={BOARD_PREVIEW_H}
        showText
        detailed
      />
    </View>
  );
}
