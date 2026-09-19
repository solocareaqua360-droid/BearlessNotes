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
//
// WHERE THE GESTURE LIVES, and why it moved. The first version put the
// long-press-then-drag on each ROW. That works right up until the row
// stops existing mid-carry: stepping into another folder takes it out of
// the list, and a virtualized list (Photos, Documents) unmounts it the
// moment it scrolls off screen. An unmounted gesture never reports a
// release - the ghost stuck, and the overlay went on swallowing every
// touch on the screen, which read as the app freezing. It lives on the
// LIST now, which nothing unmounts, and the rows only register their own
// nodes, exactly as the folders do. Which card was picked up is then a
// question of what was under the finger, answered the same way a drop
// is: by measuring.
// Where the ghost sits relative to the fingertip. Just above and a
// little left of it: the point a drop is read from is the FINGER, so the
// ghost has to say where that is - and a ghost drawn under the fingertip
// is a ghost hidden by the hand holding it.
const GHOST_NUDGE_X = -18;
const GHOST_NUDGE_Y = -58;

export type CarryGhost<T> = {
  // Everything being carried. One card usually; the whole tick-box
  // selection when the card picked up is part of one - the same rule the
  // note editor's own block drag uses (see dragGroupFor there).
  items: T[];
  // Where the ghost is, in screen coordinates - pinned to the finger (see
  // GHOST_NUDGE_*), because the finger is what a drop is read from and
  // the ghost is what says so.
  x: number;
  y: number;
};

export function useCardCarry<T extends { id: string }>({
  moveItem,
  scrollBy,
  onMoved,
  onPickUp,
  currentPath,
}: {
  moveItem: (item: T, destination: string | null) => Promise<void>;
  // Where the explorer is standing RIGHT NOW - which is where a card
  // dropped on nothing in particular lands. A file manager works that
  // way: you walk to the folder you want and let go, and dropping
  // straight onto a folder row is the shortcut, not the only way.
  currentPath: string;
  // One call per second-finger drag tick: how far the finger moved on
  // each axis since the last one (negative = up/left). A vertical list
  // only ever cares about dy; a board that also scrolls sideways (the
  // kanban one) reads dx too. A normal drag-down scroll gesture reveals
  // content ABOVE, so a caller using dy moves its list's offset by -dy.
  scrollBy: (dx: number, dy: number) => void;
  // Fires right after a real move (never for a cancelled or same-folder
  // drop) - `origin` is what the caller's own undo toast needs to put
  // the item back exactly where it was.
  onMoved?: (items: T[], destination: string | null, origin: string) => void;
  // Fires the instant a carry begins, with what was picked up. Exists for
  // a caller whose own "drop on nothing" fallback (currentPath) has no
  // single fixed answer - the kanban board, where it has to be THIS
  // card's own column, not some notion of "the folder you're standing
  // in" that a board of status columns does not have.
  onPickUp?: (items: T[]) => void;
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
  // Read at drop time, not captured when the carry began - the second
  // finger may have walked several folders since.
  const pathRef = useRef(currentPath);
  pathRef.current = currentPath;
  // The ghost used to be positioned by the offset of the finger WITHIN
  // the card it was lifted from, so that it kept the grip it was picked
  // up by. That works only while the thing being carried is the card
  // itself - and it is not: it is a small pill. Applying a grip measured
  // on a tall grid card (a hundred points down its face, easily) to a
  // pill forty points tall threw the pill that far from the finger, and
  // the bigger the card the worse it got. Since the drop is read off the
  // FINGER, the pill has to be drawn at the finger too, or the screen
  // says one thing and the drop does another - which is exactly how it
  // read: "якщо знати приблизну відстань зміщення, то ти можеш попасти".
  // Where the finger actually is. A drop asks what is under THE FINGER,
  // not under the middle of what it is holding: a list row is low enough
  // that its centre is near the finger either way, but a grid card is
  // tall, and picking one up by its top put the centre a hundred points
  // below - past the folder being aimed at, every time.
  const fingerRef = useRef({ x: 0, y: 0 });
  // Every folder row currently on screen, by path - registered by
  // ExplorerHead (or a screen's own folder rows) as they mount, cleared
  // as they unmount. A `measure`-able node, not a rect: rects go stale
  // the moment the list scrolls, nodes don't.
  const folderNodes = useRef(new Map<string, View>());
  // Step-only targets - see registerStepTarget.
  const stepNodes = useRef(new Map<string, View>());
  // Every card row on screen: its node, what it would carry, and what its
  // own short hold opens.
  const cardNodes = useRef(new Map<string, { node: View; group: () => T[]; onMenu: () => void }>());
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

  // A place you can STEP into with the second finger, but not DROP onto.
  //
  // The dock's crumbs are these. Walking the dock while holding a card is
  // exactly right; letting go over the dock is not, and the user said why
  // - the card in your hand is big, and over a strip of small crumbs you
  // cannot be sure which one you are about to hit. So the dock takes you
  // places and the folder you arrive in takes the card.
  //
  // Kept in a register of its own rather than a flag, because the two
  // registers are allowed to hold the SAME PATH at once: the dock's
  // crumb for a parent folder and a folder row for the same parent are
  // two different nodes, and one map keeps one node per path - which is
  // precisely how the step-up arrow silently killed the dock's parent
  // crumb, each of them registering the same path and the last one
  // winning.
  function registerStepTarget(path: string) {
    return (node: View | null) => {
      if (node) stepNodes.current.set(path, node);
      else stepNodes.current.delete(path);
    };
  }

  // Registered by every card row as it mounts, cleared as it unmounts -
  // the descriptor is re-set on every render, so what a row would carry
  // and what its menu does are never a render behind.
  function registerCard(id: string, group: () => T[], onMenu: () => void) {
    return (node: View | null) => {
      if (node) cardNodes.current.set(id, { node, group, onMenu });
      else cardNodes.current.delete(id);
    };
  }

  // What the finger is actually on - measured, because a row's place on
  // screen moves with every scroll. Answers with the nearest match rather
  // than the first: rows do not overlap, so the first hit IS the answer.
  function cardAt(x: number, y: number, then: (hit: { node: View; group: () => T[]; onMenu: () => void }) => void) {
    const entries = Array.from(cardNodes.current.values());
    let pending = entries.length;
    let found: { node: View; group: () => T[]; onMenu: () => void } | null = null;
    if (pending === 0) return;
    entries.forEach((entry) => {
      entry.node.measureInWindow((nx, ny, nw, nh) => {
        pending--;
        if (!found && x >= nx && x <= nx + nw && y >= ny && y <= ny + nh) found = entry;
        if (pending === 0 && found) then(found);
      });
    });
  }

  // The long press landed: pick up whatever was under it.
  const pickUpAt = useCallback((x: number, y: number) => {
    cardAt(x, y, (hit) => {
      hit.node.measureInWindow((nx, ny) => {
        beginCarry(hit.group(), pathRef.current, hit.node, x - nx, y - ny);
      });
    });
  }, []);

  // The long press did NOT land - a shorter hold, which is the menu.
  const menuAt = useCallback((x: number, y: number) => {
    cardAt(x, y, (hit) => hit.onMenu());
  }, []);

  const beginCarry = useCallback((items: T[], path: string, node: View, touchX: number, touchY: number) => {
    if (items.length === 0) return;
    node.measureInWindow((x, y) => {
      hapticPickUp();
      const finger = { x: x + touchX, y: y + touchY };
      fingerRef.current = finger;
      originRef.current = path;
      aliveAt.current = Date.now();
      const next = { items, x: finger.x + GHOST_NUDGE_X, y: finger.y + GHOST_NUDGE_Y };
      ghostRef.current = next;
      setGhost(next);
      onPickUp?.(items);
    });
  }, [onPickUp]);

  const updateCarry = useCallback((absoluteX: number, absoluteY: number) => {
    const current = ghostRef.current;
    if (!current) return;
    aliveAt.current = Date.now();
    fingerRef.current = { x: absoluteX, y: absoluteY };
    const next = { ...current, x: absoluteX + GHOST_NUDGE_X, y: absoluteY + GHOST_NUDGE_Y };
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
    // Both registers: stepping is what the dock's crumbs are FOR, and a
    // folder row can be stepped into as well as dropped on.
    [folderNodes.current, stepNodes.current].forEach((register) => {
      register.forEach((node, path) => {
        node.measureInWindow((nx, ny, nw, nh) => {
          if (x >= nx && x <= nx + nw && y >= ny && y <= ny + nh) onHit(path);
        });
      });
    });
  }, []);

  const endCarry = useCallback(() => {
    const current = ghostRef.current;
    if (!current) return;
    const { items } = current;
    const { x: cx, y: cy } = fingerRef.current;
    let matched: string | null | undefined;
    const nodes = Array.from(folderNodes.current.entries());
    if (nodes.length === 0) {
      ghostRef.current = null;
      setGhost(null);
      settle(items, undefined);
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
          settle(items, matched);
        }
      });
    });
  }, [moveItem, onMoved]);

  // Where the card actually landed: the folder row or crumb it was let go
  // over, and otherwise the folder being SHOWN - walking there with the
  // second finger and letting go is the whole point of being able to walk
  // at all.
  function settle(items: T[], matched: string | null | undefined) {
    const target = matched === undefined ? pathRef.current : matched;
    const origin = originRef.current;
    if (target === origin) {
      hapticWarning();
      return;
    }
    hapticDrop();
    // A folder path of '' - the root crumb's own key, and the root itself
    // - means "no folder at all", which moveItem spells null.
    const destination = target === '' ? null : target;
    // One after another rather than all at once: each move writes the
    // same tag documents, and the explorer's own moveItem creates a
    // folder's tag on demand - several of those racing would make the
    // same folder twice.
    items
      .reduce<Promise<unknown>>((run, one) => run.then(() => moveItem(one, destination)), Promise.resolve())
      .then(() => onMoved?.(items, destination, origin));
  }

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
    registerStepTarget,
    registerCard,
    pickUpAt,
    menuAt,
    hitTargetAt,
    beginCarry,
    updateCarry,
    endCarry,
    cancelCarry,
    scrollBy: (dx: number, dy: number) => {
      aliveAt.current = Date.now();
      scrollBy(dx, dy);
    },
  };
}

export type CardCarry<T extends { id: string }> = ReturnType<typeof useCardCarry<T>>;
