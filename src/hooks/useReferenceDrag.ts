import { useCallback, useRef, useState } from 'react';
import { View } from 'react-native';
import { Gesture } from 'react-native-gesture-handler';
import { hapticDrop, hapticPickUp, hapticWarning } from '../utils/haptics';
import type { Block } from '../types';

// Dragging a record OUT of the reference panel and ONTO the canvas.
//
// Deliberately NOT useCardCarry. That one is built around named drop
// targets - folders, kanban columns - a card is carried BETWEEN, and
// around moving a record that already belongs somewhere. This is the
// other shape: the source is a list of things that stay where they are,
// the target is one big surface, and what lands on it is a COPY at the
// point it was let go. Everything hard-won today is reused as technique
// rather than as code: a bare Pan that owns the touch only after a long
// press (so the panel's own list goes on scrolling), a ghost pinned to
// the finger, and a drop read off the finger's own position.
const LONG_PRESS_MS = 550;
const GHOST_NUDGE_X = -18;
const GHOST_NUDGE_Y = -58;

export type ReferenceGhost = { label: string; x: number; y: number };

export function useReferenceDrag({
  onDrop,
}: {
  // Where it was let go, in SCREEN coordinates - the caller decides
  // whether that is over the canvas and what it means there. Answers
  // through `respond` rather than a return value: the canvas's own
  // hit-test (DocumentCanvasHandle.screenToSurface) is a measureInWindow
  // callback, not something that can answer synchronously.
  onDrop: (block: Block, screenX: number, screenY: number, respond: (accepted: boolean) => void) => void;
}) {
  const [ghost, setGhost] = useState<ReferenceGhost | null>(null);
  const ghostRef = useRef<ReferenceGhost | null>(null);
  const fingerRef = useRef({ x: 0, y: 0 });
  const carried = useRef<Block | null>(null);
  // Every row on screen: its node, and how to build the block it stands
  // for. Built on DROP, not on pickup - a row is a record, and the block
  // is what a copy of it becomes.
  const rows = useRef(new Map<string, { node: View; build: () => Block; label: string }>());

  function registerRow(id: string, build: () => Block, label: string) {
    return (node: View | null) => {
      if (node) rows.current.set(id, { node, build, label });
      else rows.current.delete(id);
    };
  }

  const pickUpAt = useCallback((x: number, y: number) => {
    const entries = Array.from(rows.current.values());
    let pending = entries.length;
    if (pending === 0) return;
    let found: { node: View; build: () => Block; label: string } | null = null;
    entries.forEach((entry) => {
      entry.node.measureInWindow((nx, ny, nw, nh) => {
        pending--;
        if (!found && x >= nx && x <= nx + nw && y >= ny && y <= ny + nh) found = entry;
        if (pending === 0 && found) {
          const hit = found;
          hapticPickUp();
          carried.current = hit.build();
          fingerRef.current = { x, y };
          const next = { label: hit.label, x: x + GHOST_NUDGE_X, y: y + GHOST_NUDGE_Y };
          ghostRef.current = next;
          setGhost(next);
        }
      });
    });
  }, []);

  const updateDrag = useCallback((x: number, y: number) => {
    if (!ghostRef.current) return;
    fingerRef.current = { x, y };
    const next = { ...ghostRef.current, x: x + GHOST_NUDGE_X, y: y + GHOST_NUDGE_Y };
    ghostRef.current = next;
    setGhost(next);
  }, []);

  const endDrag = useCallback(() => {
    const block = carried.current;
    const at = fingerRef.current;
    carried.current = null;
    ghostRef.current = null;
    setGhost(null);
    if (!block) return;
    onDrop(block, at.x, at.y, (accepted) => {
      if (accepted) hapticDrop();
      else hapticWarning();
    });
  }, [onDrop]);

  const cancelDrag = useCallback(() => {
    carried.current = null;
    ghostRef.current = null;
    setGhost(null);
  }, []);

  // One gesture for the whole panel list, not one per row - the same
  // reason the explorer's own carry had to move off its rows: a row can
  // scroll away mid-drag, and a gesture that belongs to it dies with it.
  const gesture = Gesture.Pan()
    .activateAfterLongPress(LONG_PRESS_MS)
    .runOnJS(true)
    .onStart((e) => pickUpAt(e.absoluteX, e.absoluteY))
    .onUpdate((e) => updateDrag(e.absoluteX, e.absoluteY))
    .onEnd((_e, success) => {
      if (success) endDrag();
    })
    .onFinalize(() => cancelDrag());

  return { ghost, gesture, registerRow, dragging: ghost !== null };
}
