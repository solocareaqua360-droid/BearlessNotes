import { useCallback, useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { hapticDrop, hapticPickUp, hapticWarning } from '../utils/haptics';

// Dragging a card into a folder - the explorer's own two-hold-length rule
// (the user's, 2026-09-15): a SHORT hold still opens the item's usual menu
// (unchanged - see the screen's own onLongPress), a LONGER one lifts the
// card and lets it be dragged. Wanted "ideal", also the user's own: Craft/
// iOS-style - one finger carries the card, a SECOND finger scrolls the list
// (and, in a later pass, can tap a folder row to step into it) - so the
// card never has to leave the screen to reach a folder below the fold.
//
// Every earlier note on this feature (see project_explorer_mode memory)
// flagged the real risk: a second finger is easy to lose on Android if the
// list's own scroll gesture and the carry gesture have to negotiate for
// the SAME touch. This sidesteps that negotiation instead of trying to win
// it: the LONG-hold-then-drag is `Gesture.Pan().activateAfterLongPress(...)`
// - already proven in this exact app for the note editor's own block
// reorder (DocumentEditorScreen) - so it owns finger 1 from the moment it
// activates and never has to renegotiate with the ScrollView beneath it.
// The second finger is never asked to share that touch stream: it is
// caught by a SEPARATE gesture on a full-screen overlay that exists only
// once carrying has begun, so any touch landing after that moment is a
// fresh touch-down this overlay is first in line for, not a hand-off.
//
// Folder rects are measured ON DEMAND (at the moment a second finger
// lands, and at the moment the first one lifts) rather than tracked on
// every frame - a rendered folder row's on-screen position keeps changing
// as the list scrolls, and re-measuring continuously is both unnecessary
// (we only ever act at these two moments) and the more fragile thing to
// get right without a device to feel it on.
export type CarryGhost<T> = {
  item: T;
  // Where the card started, in screen coordinates - the ghost's very
  // first frame, so it visibly lifts FROM the card rather than popping
  // in somewhere else.
  x: number;
  y: number;
  width: number;
  height: number;
};

export function useCardCarry<T extends { id: string }>({
  moveItem,
  scrollBy,
  onMoved,
}: {
  moveItem: (item: T, destination: string | null) => Promise<void>;
  // One call per second-finger drag tick, dy = how far DOWN that finger
  // moved since the last tick (negative = moved up). A normal drag-down
  // scroll gesture reveals content ABOVE, so the caller wants to move its
  // list's offset by -dy.
  scrollBy: (dy: number) => void;
  // Fires right after a real move (never for a cancelled or same-folder
  // drop) - `origin` is what the caller's own undo toast needs to put
  // the item back exactly where it was.
  onMoved?: (item: T, destination: string | null, origin: string) => void;
}) {
  const [ghost, setGhost] = useState<CarryGhost<T> | null>(null);
  // Mirrors `ghost` for code that runs inside a gesture callback (already
  // on the JS thread here - see the drag gesture's own comment - but
  // still reading state set a render ago, not this one).
  const ghostRef = useRef<CarryGhost<T> | null>(null);
  // Where the item came from, captured the moment the carry starts - the
  // explorer path it was showing under, which is exactly what "undo"
  // needs to put it back.
  const originRef = useRef<string>('');
  // Where in the card the finger first touched it, so the ghost tracks
  // the finger exactly rather than re-centering under it.
  const grabRef = useRef({ x: 0, y: 0 });
  // Every folder row currently on screen, by path - registered by
  // ExplorerHead (or a screen's own folder rows) as they mount, cleared
  // as they unmount. A `measure`-able node, not a rect: rects go stale
  // the moment the list scrolls, nodes don't.
  const folderNodes = useRef(new Map<string, View>());
  // Last sign of life from the carry - a move, a scroll, a step into a
  // folder. The watchdog below is a last resort, not a mechanism: a carry
  // whose own gesture died with its row (see CarryableRow's `orphan`)
  // would otherwise leave the overlay up forever, and an overlay that is
  // up is an overlay that takes every touch on the screen.
  const aliveAt = useRef(0);

  function registerFolder(path: string) {
    return (node: View | null) => {
      if (node) folderNodes.current.set(path, node);
      else folderNodes.current.delete(path);
    };
  }

  const beginCarry = useCallback((item: T, path: string, node: View, touchX: number, touchY: number) => {
    node.measureInWindow((x, y, width, height) => {
      hapticPickUp();
      grabRef.current = { x: touchX, y: touchY };
      originRef.current = path;
      aliveAt.current = Date.now();
      const next = { item, x, y, width, height };
      ghostRef.current = next;
      setGhost(next);
    });
  }, []);

  const updateCarry = useCallback((absoluteX: number, absoluteY: number) => {
    const current = ghostRef.current;
    if (!current) return;
    aliveAt.current = Date.now();
    const next = { ...current, x: absoluteX - grabRef.current.x, y: absoluteY - grabRef.current.y };
    ghostRef.current = next;
    setGhost(next);
  }, []);

  // Which registered target, if any, lies under a point - measured on
  // demand, for the same reason the drop does (a row's place on screen
  // changes with every scroll, a node's identity does not). Used by the
  // second finger's own tap, so a folder can be stepped into without
  // letting go of the card.
  const hitTargetAt = useCallback((x: number, y: number, onHit: (path: string) => void) => {
    aliveAt.current = Date.now();
    folderNodes.current.forEach((node, path) => {
      node.measureInWindow((nx, ny, nw, nh) => {
        if (x >= nx && x <= nx + nw && y >= ny && y <= ny + nh) onHit(path);
      });
    });
  }, []);

  const endCarry = useCallback(() => {
    const current = ghostRef.current;
    if (!current) return;
    const { item, x, y, width, height } = current;
    const cx = x + width / 2;
    const cy = y + height / 2;
    let matched: string | null | undefined;
    const nodes = Array.from(folderNodes.current.entries());
    if (nodes.length === 0) {
      hapticWarning();
      ghostRef.current = null;
      setGhost(null);
      return;
    }
    let pending = nodes.length;
    let dropped = false;
    nodes.forEach(([path, node]) => {
      node.measureInWindow((nx, ny, nw, nh) => {
        pending--;
        if (!dropped && cx >= nx && cx <= nx + nw && cy >= ny && cy <= ny + nh) {
          dropped = true;
          matched = path;
        }
        if (pending === 0) {
          ghostRef.current = null;
          setGhost(null);
          if (matched !== undefined && matched !== originRef.current) {
            hapticDrop();
            const origin = originRef.current;
            // The root crumb registers itself under '' - as a folder path
            // that means "no folder at all", which moveItem spells null.
            const destination = matched === '' ? null : matched;
            moveItem(item, destination).then(() => onMoved?.(item, destination, origin));
          } else {
            hapticWarning();
          }
        }
      });
    });
  }, [moveItem, onMoved]);

  const cancelCarry = useCallback(() => {
    ghostRef.current = null;
    setGhost(null);
  }, []);

  // A carry with nothing happening in it for this long is a carry whose
  // finger is no longer there to end it.
  useEffect(() => {
    if (!ghost) return;
    const id = setInterval(() => {
      if (Date.now() - aliveAt.current > 8000) cancelCarry();
    }, 2000);
    return () => clearInterval(id);
  }, [ghost, cancelCarry]);

  return {
    ghost,
    registerFolder,
    hitTargetAt,
    beginCarry,
    updateCarry,
    endCarry,
    cancelCarry,
    scrollBy: (dy: number) => {
      aliveAt.current = Date.now();
      scrollBy(dy);
    },
  };
}

export type CardCarry<T extends { id: string }> = ReturnType<typeof useCardCarry<T>>;
