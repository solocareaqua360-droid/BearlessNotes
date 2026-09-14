import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  BackHandler,
  Keyboard,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  makeMutable,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { SharedValue } from 'react-native-reanimated';
import AttachmentImage from './AttachmentImage';
import { autoGrowInput } from '../utils/autoGrowInput';
import { caretIndexFromDom } from '../utils/caretAtPoint';
import { CaretLine, displayIndexForTouch } from '../utils/caretFromTextLayout';
import { canPlaceCaretByTouch, measureNode } from '../utils/measureNode';
import { useCanvasWheel } from '../hooks/useCanvasWheel';
import { setSelection } from '../utils/setSelection';
import Svg, { Path } from 'react-native-svg';
import { Block, CanvasLink } from '../types';
import { orderByCanvasLinks, sequenceLinkIds } from '../utils/canvasOrder';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

// The canvas is part of the note, and the note is paper - white, with
// dark text. The glass palette belongs to the windows that float OVER a
// screen; a card lying ON the page is not one of those, and translucent
// dark cards on white paper read as smudges. So these are the page's own
// colours, the same ones the blocks have when they are read down the
// page instead of across it.
const PAPER_CARD = '#FFFFFF';
const PAPER_EDGE = '#E5E7EB';
const PAPER_EDGE_EDITING = '#8AB4FF';
const PAPER_TEXT = '#111827';
const PAPER_TEXT_MUTED = '#6B7280';
const PAPER_TEXT_FAINT = '#9CA3AF';
// The board's own violet, for the same thing: an arrow between two
// cards, and the card an arrow is about to be drawn from.
const LINK_COLOR = '#8B5CF6';
// An arrow that merely points, as against one that sets the page order
// (see sequenceLinkIds): the same shape in a quieter colour, so a glance
// says which arrows the page will follow.
const LINK_COLOR_AUX = '#B8B4C9';
const LINK_PADDING = 24;
// Where the handle sits in from the card's right edge - the draft line
// starts from it, not from the corner.
const HANDLE_INSET = 11;
// The removal cross that a hold puts on an arrow's midpoint.
const LINK_DOT = 22;

// «Полотно» - the same document, laid out freely instead of down a page.
//
// The idea is AFFiNE's: a note is a sequence when you are writing it and a
// surface when you are thinking about it, and the two should be the same
// document rather than two places to keep things in step. So this draws the
// blocks the editor already has, at positions kept on the blocks
// themselves, and writing stays in the page - a tap on a card goes back
// there with that block open.
//
// Deliberately NOT built on BoardScreen's canvas yet. That one carries
// columns, connections, a marquee, group drags and a minimap, all tied to
// board cards; the shared piece worth extracting is the pan/zoom surface
// underneath, and this is the second user that will say what its shape
// has to be. Same numbers as the board on purpose (0.4-3x, 12pt before a
// pan counts), so the two feel like one gesture language.
const MIN_SCALE = 0.4;
const MAX_SCALE = 3;
const CARD_WIDTH = 240;
const LANE_GAP = 20;
// Where a card being typed into is put: near the top, clear of the
// keyboard whatever its height, and clear of the rail on the right.
const EDIT_TOP = 88;
const EDIT_LEFT = 16;

// The blocks whose content IS their text, and which can therefore be
// typed into on the canvas. Everything else (a picture, a file, an
// embedded database) is opened on the page, where its own controls are.
const TEXT_TYPES = ['paragraph', 'bulleted', 'numbered', 'checkbox'];

// Typing in a card works on both. What differs is what has to be done
// about the TAP, and only a browser needs any of it: there a gesture
// over the whole surface also sees the clicks meant for the text, and a
// drag across text is how a word gets selected. On a phone the field
// takes its own touches and neither problem exists - so neither fix is
// applied there, because both of them cost something (a canvas that does
// not pan, a view under the cards) and a phone gains nothing in return.
const NEEDS_TAP_GUARDS = Platform.OS === 'web';

// What a drag across empty canvas does. In a browser it draws a box and
// chooses the cards inside it - the trackpad moves the view there, so
// the drag is free for what only a drag can do. On a phone the same drag
// is the ONLY way to move the view, so it keeps that job and choosing
// several cards will need a tool of its own, as it does on the board.
const DRAG_SELECTS = Platform.OS === 'web';

export type CanvasPlacement = { id: string; x: number; y: number };

// The board's arrow maths, carried over rather than shared yet - see the
// note at the top about extracting the surface. A link leaves the side of
// a card that faces the other card, at half its measured height, and
// bends out sideways so it arrives horizontally however far apart the
// two are vertically.
function linkEndpoints(
  from: { x: number; y: number; height: number },
  to: { x: number; y: number; height: number }
) {
  const fromIsLeft = from.x + CARD_WIDTH / 2 <= to.x + CARD_WIDTH / 2;
  return {
    x1: fromIsLeft ? from.x + CARD_WIDTH : from.x,
    y1: from.y + from.height / 2,
    x2: fromIsLeft ? to.x : to.x + CARD_WIDTH,
    y2: to.y + to.height / 2,
  };
}

function curvePath(x1: number, y1: number, x2: number, y2: number): string {
  const bend = Math.max(30, Math.abs(x2 - x1) / 2);
  const direction = x2 >= x1 ? 1 : -1;
  return `M ${x1} ${y1} C ${x1 + bend * direction} ${y1} ${x2 - bend * direction} ${y2} ${x2} ${y2}`;
}

// The head at the TO end. An arrow has a direction now - it is what says
// which end of a chain the page starts reading from - so the direction
// has to be visible. The curve always arrives horizontally (its last
// control point is level with its end), so the head is a horizontal
// triangle pointing the way the curve was going.
const ARROW_HEAD = 8;
function arrowHeadPath(x2: number, y2: number, x1: number): string {
  const direction = x2 >= x1 ? 1 : -1;
  const back = x2 - ARROW_HEAD * direction;
  return `M ${x2} ${y2} L ${back} ${y2 - ARROW_HEAD / 2} L ${back} ${y2 + ARROW_HEAD / 2} Z`;
}

// Where every block sits: its own position once it has been moved, and
// otherwise a place in a plain column, in the document's own order. The
// fallback is computed, never written - a document nobody has arranged
// looks arranged anyway, and still carries nothing extra.
//
// `heights` are the cards' MEASURED heights, reported by each card as it
// lays itself out. Guessing them from the text length put every card in
// the column a little too close to the one above, and the long ones
// overlapped outright - a card's real height depends on the font, the
// width and where the words happen to break, which only layout knows.
// The guess stays as the value for a card that has not reported yet, for
// the single frame before it does.
export function layOutBlocks(
  blocks: Block[],
  heights: Record<string, number> = {}
): CanvasPlacement[] {
  let nextY = 0;
  return blocks.map((block) => {
    if (block.canvas) return { id: block.id, x: block.canvas.x, y: block.canvas.y };
    const y = nextY;
    nextY += (heights[block.id] ?? approximateHeight(block)) + LANE_GAP;
    return { id: block.id, x: 0, y };
  });
}

function approximateHeight(block: Block): number {
  const type = block.type ?? 'paragraph';
  if (type === 'image' || type === 'sketch') return 180;
  if (type === 'file' || type === 'link' || type === 'dbRow' || type === 'dbView') return 96;
  // Text: a card shows ALL of it, so this only has to be close - it is
  // replaced by the measured height on the next frame. Roughly 28
  // characters to a line at this width, 19pt a line, plus the padding.
  return 32 + Math.max(1, Math.ceil((block.text?.length ?? 0) / 28)) * 19;
}

// What the screen around the canvas can ask of it. One method, and it
// exists because the way OUT of typing has to be reachable from the rail
// as well: the back arrow there used to leave the whole document while
// the caret was still blinking in a card.
export type DocumentCanvasHandle = { stopEditing: () => void };

function DocumentCanvasInner({
  blocks,
  onMoveBlock,
  onChangeText,
  onOpenBlock,
  onEditingChange,
  links,
  onToggleLink,
  onAdd,
}: {
  blocks: Block[];
  // Called once, when a card is let go - not on every frame of the drag.
  onMoveBlock: (id: string, x: number, y: number) => void;
  // The editor's own handler, untouched: one place decides what typing
  // into a block means (list continuation, undo snapshots, mirrors), and
  // the canvas is just another keyboard pointed at it.
  onChangeText: (id: string, text: string) => void;
  onOpenBlock: (id: string) => void;
  // So the screen can offer its own way out while a card is being typed
  // into - see DocumentCanvasHandle.
  onEditingChange?: (editing: boolean) => void;
  // The arrows, and the one gesture that makes and unmakes them.
  links: Record<string, CanvasLink>;
  onToggleLink: (from: string, to: string) => void;
  // The "+" - asked with where the middle of the view is in surface
  // coordinates, so whatever gets added lands where the eye already is
  // rather than at the bottom of a column somewhere off-screen.
  onAdd: (at: { x: number; y: number }) => void;
}, ref: React.Ref<DocumentCanvasHandle>) {
  const { width } = useWindowDimensions();
  // The trackpad, on a laptop: two fingers move the canvas, a pinch zooms
  // it around the pointer, shift+scroll goes sideways. The board's own
  // hook, unchanged - a hand that has learnt the board already knows this
  // canvas, and without it a trackpad pinch zooms the whole PAGE instead.
  // A no-op on the phone, where two fingers already say it.
  const canvasRef = useRef<View | null>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const scale = useSharedValue(1);
  const savedScale = useSharedValue(1);
  const translateX = useSharedValue(width > CARD_WIDTH * 2 ? 40 : 16);
  const translateY = useSharedValue(120);
  const savedTranslateX = useSharedValue(translateX.value);
  const savedTranslateY = useSharedValue(translateY.value);

  const [cardHeights, setCardHeights] = useState<Record<string, number>>({});
  const placements = useMemo(() => layOutBlocks(blocks, cardHeights), [blocks, cardHeights]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const sequenceIds = useMemo(() => sequenceLinkIds(links), [links]);
  // The number each chained card will have on the page - the order the
  // arrows ask for, shown on the cards themselves so nobody has to work
  // it out. Only cards an order-setting arrow touches get one: the rest
  // keep the order they had, which the arrows say nothing about.
  const ordinals = useMemo(() => {
    const chained = new Set<string>();
    for (const [id, link] of Object.entries(links)) {
      if (!sequenceIds.has(id)) continue;
      chained.add(link.from);
      chained.add(link.to);
    }
    const result = new Map<string, number>();
    if (chained.size === 0) return result;
    orderByCanvasLinks(blocks, links).forEach((block, index) => {
      if (chained.has(block.id)) result.set(block.id, index + 1);
    });
    return result;
  }, [blocks, links, sequenceIds]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  // The card a hold has made the start of an arrow. The next tap on
  // another card finishes it; a tap beside the cards, or on the same
  // card, lets it go.
  const [linkSourceId, setLinkSourceId] = useState<string | null>(null);

  // Every card's position as a shared value, kept HERE rather than inside
  // the card, so an arrow can read both of its ends on the UI thread and
  // follow a card while it is being dragged. The board keeps its
  // positions the same way and for the same reason. Made once per block
  // and reused for its life; a block gone from the document is dropped
  // from here on the next render.
  const positions = useRef(new Map<string, { x: SharedValue<number>; y: SharedValue<number> }>()).current;
  function positionOf(id: string, placement: CanvasPlacement) {
    let position = positions.get(id);
    if (!position) {
      position = { x: makeMutable(placement.x), y: makeMutable(placement.y) };
      positions.set(id, position);
    }
    return position;
  }
  const liveIds = new Set(blocks.map((b) => b.id));
  for (const id of Array.from(positions.keys())) {
    if (!liveIds.has(id)) positions.delete(id);
  }
  // The card under the finger, while there is one. Its arrows - and, in a
  // group drag, every chosen card's - are drawn live off the shared
  // positions instead of the resting curve.
  const [draggingId, setDraggingId] = useState<string | null>(null);
  // The arrow whose midpoint dot has been tapped once: it shows a cross,
  // and the next tap on it takes the arrow away. The hidden way (the same
  // pair asked for again) still works, but nobody finds a hidden way.
  const [armedLinkId, setArmedLinkId] = useState<string | null>(null);

  // The line a handle-drag trails behind the finger (the second way of
  // making an arrow, beside the hold): from the card's edge to wherever
  // the finger is, in surface coordinates.
  const draftVisible = useSharedValue(false);
  const draftStartX = useSharedValue(0);
  const draftStartY = useSharedValue(0);
  const draftEndX = useSharedValue(0);
  const draftEndY = useSharedValue(0);

  function heightOf(index: number) {
    return cardHeights[blocks[index].id] ?? approximateHeight(blocks[index]);
  }

  // Last match wins: a card later in the document paints on top of an
  // earlier one, so where they overlap the visible one is the one meant.
  function cardAt(x: number, y: number): string | null {
    let found: string | null = null;
    blocks.forEach((block, index) => {
      const place = placements[index];
      if (x >= place.x && x <= place.x + CARD_WIDTH && y >= place.y && y <= place.y + heightOf(index)) {
        found = block.id;
      }
    });
    return found;
  }

  function beginHandleDrag(id: string) {
    const index = blocks.findIndex((b) => b.id === id);
    if (index === -1) return;
    const position = positions.get(id);
    const x = (position?.x.value ?? placements[index].x) + CARD_WIDTH - HANDLE_INSET;
    const y = (position?.y.value ?? placements[index].y) + heightOf(index) / 2;
    draftStartX.value = x;
    draftStartY.value = y;
    draftEndX.value = x;
    draftEndY.value = y;
    draftVisible.value = true;
  }

  function endHandleDrag(id: string, x: number, y: number) {
    draftVisible.value = false;
    const target = cardAt(x, y);
    if (target && target !== id) onToggleLink(id, target);
  }
  // Written by whichever selected card is under the finger, read by every
  // other selected card - which is what makes a whole selection visibly
  // move together. The board does it the same way.
  const groupOffsetX = useSharedValue(0);
  const groupOffsetY = useSharedValue(0);
  // Which character the click that started the editing landed on. The
  // field does not exist yet at that moment - the card is showing plain
  // text - so the answer is taken from the text that IS there and handed
  // to the field when it mounts.
  const [editingCaret, setEditingCaret] = useState<number | null>(null);

  // Rounded to the point: a height that wobbles by a fraction between
  // frames would re-lay the whole column out for nothing.
  function reportHeight(id: string, height: number) {
    const rounded = Math.round(height);
    setCardHeights((prev) => (prev[id] === rounded ? prev : { ...prev, [id]: rounded }));
  }

  function stopEditing() {
    setEditingId(null);
    setEditingCaret(null);
    setLinkSourceId(null);
    Keyboard.dismiss();
  }

  function disarmLink() {
    setArmedLinkId(null);
  }

  function handleLinkTap(id: string) {
    if (linkSourceId !== null && linkSourceId !== id) onToggleLink(linkSourceId, id);
    setLinkSourceId(null);
  }

  useImperativeHandle(ref, () => ({ stopEditing }));

  useEffect(() => {
    onEditingChange?.(editingId !== null);
  }, [editingId, onEditingChange]);

  // Back ends the typing before it ends anything else. Without this the
  // system's own back gesture walked out of the document with the caret
  // still in a card, which is not what "back" meant at that moment.
  useEffect(() => {
    if (editingId === null) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      stopEditing();
      return true;
    });
    return () => sub.remove();
  }, [editingId]);

  // A card about to be typed into is brought to a known place rather than
  // left wherever the canvas happened to be - the keyboard takes the lower
  // half of the screen, and a card that was already down there would be
  // typed into blind. Deterministic on purpose: the same corner every
  // time, so the eye knows where to go back to.
  function revealForEditing(x: number, y: number) {
    const target = scale.value;
    translateX.value = withTiming(EDIT_LEFT - x * target, { duration: 180 });
    translateY.value = withTiming(EDIT_TOP - y * target, { duration: 180 });
    savedTranslateX.value = EDIT_LEFT - x * target;
    savedTranslateY.value = EDIT_TOP - y * target;
  }

  // The selection box, in SURFACE coordinates - the same space the cards
  // are positioned in, so it moves and scales with them rather than
  // floating over the screen.
  const marqueeVisible = useSharedValue(false);
  const marqueeStartX = useSharedValue(0);
  const marqueeStartY = useSharedValue(0);
  const marqueeEndX = useSharedValue(0);
  const marqueeEndY = useSharedValue(0);

  // Screen -> surface. The surface is the size of the viewport, scaled
  // about its own centre and then translated, so a point on screen is
  //   centre + (point - centre) * scale + translate.
  function toSurface(screenX: number, screenY: number) {
    'worklet';
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;
    return {
      x: cx + (screenX - cx - translateX.value) / scale.value,
      y: cy + (screenY - cy - translateY.value) / scale.value,
    };
  }

  function selectWithin(x1: number, y1: number, x2: number, y2: number) {
    const left = Math.min(x1, x2);
    const right = Math.max(x1, x2);
    const top = Math.min(y1, y2);
    const bottom = Math.max(y1, y2);
    // A box drawn by accident (a click that moved two points) should not
    // wipe the selection out - but a real one that caught nothing should.
    if (right - left < 4 && bottom - top < 4) return;
    const caught = blocks.filter((block, index) => {
      const place = placements[index];
      const height = cardHeights[block.id] ?? approximateHeight(block);
      return (
        place.x < right && place.x + CARD_WIDTH > left && place.y < bottom && place.y + height > top
      );
    });
    setSelectedIds(new Set(caught.map((b) => b.id)));
  }

  const pinchGesture = Gesture.Pinch()
    .onUpdate((e) => {
      scale.value = Math.min(MAX_SCALE, Math.max(MIN_SCALE, savedScale.value * e.scale));
    })
    .onEnd(() => {
      savedScale.value = scale.value;
    });

  const panGesture = Gesture.Pan()
    // In a browser, not while something is being typed into: dragging
    // across text is how a word gets selected there, and a surface that
    // also takes that drag slides the whole canvas out from under the
    // cursor instead. The card is parked in a known place while it is
    // edited anyway. A phone keeps its pan - a finger dragging the canvas
    // never begins inside the field.
    // Where a drag draws a selection box, it is not also the way to move
    // the view - the trackpad is.
    .enabled(!DRAG_SELECTS && (editingId === null || !NEEDS_TAP_GUARDS))
    // The board's own number: a hold and a drag start the same way, and a
    // surface that takes the very first pixel moves before the press can
    // count as anything else.
    .minDistance(12)
    .onUpdate((e) => {
      translateX.value = savedTranslateX.value + e.translationX;
      translateY.value = savedTranslateY.value + e.translationY;
    })
    .onEnd(() => {
      savedTranslateX.value = translateX.value;
      savedTranslateY.value = translateY.value;
    });

  // The drag across empty canvas: a selection box in a browser, moving
  // the view everywhere else.
  const marqueeGesture = Gesture.Pan()
    .enabled(DRAG_SELECTS && editingId === null)
    .minDistance(4)
    .onStart((e) => {
      const start = toSurface(e.x, e.y);
      marqueeStartX.value = start.x;
      marqueeStartY.value = start.y;
      marqueeEndX.value = start.x;
      marqueeEndY.value = start.y;
      marqueeVisible.value = true;
    })
    .onUpdate((e) => {
      const now = toSurface(e.x, e.y);
      marqueeEndX.value = now.x;
      marqueeEndY.value = now.y;
    })
    .onEnd(() => {
      marqueeVisible.value = false;
      runOnJS(selectWithin)(
        marqueeStartX.value,
        marqueeStartY.value,
        marqueeEndX.value,
        marqueeEndY.value
      );
    });

  // A tap on bare canvas puts the selection down, the way clicking beside
  // a thing does everywhere else.
  // Hold a line and a cross appears on it - the same hold that starts an
  // arrow from a card, pointed at the arrow itself. The hold is on the
  // surface, not on each arrow: an arrow's Svg is a box far larger than
  // the curve, and a hold in the empty corner of that box must not count.
  // So the press is tested against the curve, sampled along its length.
  function armLinkNear(x: number, y: number) {
    const threshold = 18 / scale.value;
    let best: { id: string; distance: number } | null = null;
    for (const [id, link] of Object.entries(links)) {
      const fromIndex = blocks.findIndex((b) => b.id === link.from);
      const toIndex = blocks.findIndex((b) => b.id === link.to);
      if (fromIndex === -1 || toIndex === -1) continue;
      const { x1, y1, x2, y2 } = linkEndpoints(
        { ...placements[fromIndex], height: heightOf(fromIndex) },
        { ...placements[toIndex], height: heightOf(toIndex) }
      );
      // The same curve curvePath draws: control points pushed straight
      // out sideways from each end.
      const bend = Math.max(30, Math.abs(x2 - x1) / 2);
      const direction = x2 >= x1 ? 1 : -1;
      const cx1 = x1 + bend * direction;
      const cx2 = x2 - bend * direction;
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const u = 1 - t;
        const px = u * u * u * x1 + 3 * u * u * t * cx1 + 3 * u * t * t * cx2 + t * t * t * x2;
        const py = u * u * u * y1 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y2;
        const distance = Math.hypot(px - x, py - y);
        if (distance <= threshold && (!best || distance < best.distance)) best = { id, distance };
      }
    }
    setArmedLinkId(best ? best.id : null);
  }

  const holdLineGesture = Gesture.LongPress()
    .enabled(editingId === null)
    .minDuration(450)
    .onStart((e) => {
      const at = toSurface(e.x, e.y);
      runOnJS(armLinkNear)(at.x, at.y);
    });

  const clearSelectionGesture = Gesture.Tap()
    .enabled(DRAG_SELECTS)
    .onEnd(() => {
      runOnJS(setSelectedIds)(new Set());
    });

  const canvasGesture = Gesture.Simultaneous(
    Gesture.Race(marqueeGesture, clearSelectionGesture, panGesture, holdLineGesture),
    pinchGesture
  );

  const marqueeStyle = useAnimatedStyle(() => ({
    opacity: marqueeVisible.value ? 1 : 0,
    left: Math.min(marqueeStartX.value, marqueeEndX.value),
    top: Math.min(marqueeStartY.value, marqueeEndY.value),
    width: Math.abs(marqueeEndX.value - marqueeStartX.value),
    height: Math.abs(marqueeEndY.value - marqueeStartY.value),
  }));

  useCanvasWheel(canvasRef, {
    scale,
    savedScale,
    translateX,
    translateY,
    savedTranslateX,
    savedTranslateY,
    viewport,
    minScale: MIN_SCALE,
    maxScale: MAX_SCALE,
  });

  const surfaceStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: translateX.value },
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  return (
    <View
      style={styles.viewport}
      onLayout={(e) => {
        const { width: w, height: h } = e.nativeEvent.layout;
        setViewport((prev) => (prev.width === w && prev.height === h ? prev : { width: w, height: h }));
      }}
    >
      <GestureDetector gesture={canvasGesture}>
        <Animated.View style={styles.fill}>
          {/* The wheel listener goes on a plain View INSIDE the gesture
              detector, which is where the board has it. Outside it, the
              events the trackpad sends never reached this - so the canvas
              could only be moved by pressing and dragging it, and that
              drag is wanted for choosing cards, not for moving the view. */}
          <View ref={canvasRef} style={StyleSheet.absoluteFill} collapsable={false}>
          <Animated.View style={[styles.surface, surfaceStyle]}>
            {/* A tap on bare canvas puts the text down, the way clicking
                beside a thing ends editing everywhere else. It is a view
                BEHIND the cards rather than a gesture on the whole
                surface: a gesture up there sees every tap, including the
                ones meant for the text - so in a browser each attempt to
                move the caret ended the editing instead, and the caret
                never left the start. Behind the cards, a tap on a card
                simply never reaches it. */}
            {(editingId !== null || linkSourceId !== null || armedLinkId !== null) && (
              // A tap beside the cards puts the text down. In a browser
              // this has to be a view BEHIND the cards rather than a
              // gesture over the surface, because a gesture up there also
              // sees the clicks meant for the text; on a phone the field
              // keeps its own touches, so either works and this is the
              // one that already exists.
              <Pressable
                style={styles.stopEditingCatcher}
                onPress={() => {
                  stopEditing();
                  disarmLink();
                }}
              />
            )}
            {/* Behind the cards. Drawn from the positions the cards were
                let go at, so an arrow catches up with a card when the
                drag ends rather than following the finger - the board
                trails a live line for that, and this will too once the
                surface is shared; for now the arrow is right whenever
                nothing is moving. */}
            {Object.entries(links).map(([id, link]) => {
              const colour = sequenceIds.has(id) ? LINK_COLOR : LINK_COLOR_AUX;
              const fromIndex = blocks.findIndex((b) => b.id === link.from);
              const toIndex = blocks.findIndex((b) => b.id === link.to);
              // Either end deleted on the page: the arrow simply is not
              // drawn. Nothing to clean up - it is pruned with the block.
              if (fromIndex === -1 || toIndex === -1) return null;
              const from = placements[fromIndex];
              const to = placements[toIndex];
              // While either end is moving, the arrow is a straight line
              // read live off the cards' shared positions - the resting
              // curve below is computed from React state, which does not
              // change until the drop. A group drag moves every chosen
              // card, so every arrow touching one of them goes live too.
              const groupMoving = draggingId !== null && selectedIds.has(draggingId);
              const isMoving = (blockId: string) =>
                draggingId !== null && (blockId === draggingId || (groupMoving && selectedIds.has(blockId)));
              if (isMoving(link.from) || isMoving(link.to)) {
                const endpoint = (blockId: string, place: CanvasPlacement, index: number) => ({
                  ...positionOf(blockId, place),
                  offsetX: groupMoving && selectedIds.has(blockId) ? groupOffsetX : null,
                  offsetY: groupMoving && selectedIds.has(blockId) ? groupOffsetY : null,
                  height: heightOf(index),
                });
                return (
                  <LiveLine
                    key={id}
                    colour={colour}
                    from={endpoint(link.from, from, fromIndex)}
                    to={endpoint(link.to, to, toIndex)}
                  />
                );
              }
              const { x1, y1, x2, y2 } = linkEndpoints(
                { ...from, height: cardHeights[link.from] ?? approximateHeight(blocks[fromIndex]) },
                { ...to, height: cardHeights[link.to] ?? approximateHeight(blocks[toIndex]) }
              );
              const left = Math.min(x1, x2) - LINK_PADDING;
              const top = Math.min(y1, y2) - LINK_PADDING;
              const w = Math.abs(x2 - x1) + LINK_PADDING * 2;
              const h = Math.abs(y2 - y1) + LINK_PADDING * 2;
              return (
                <View key={id} style={StyleSheet.absoluteFill} pointerEvents="box-none">
                  <Svg style={[styles.link, { left, top }]} width={w} height={h} pointerEvents="none">
                    <Path
                      d={curvePath(x1 - left, y1 - top, x2 - left, y2 - top)}
                      stroke={colour}
                      strokeWidth={2}
                      fill="none"
                    />
                    <Path d={arrowHeadPath(x2 - left, y2 - top, x1 - left)} fill={colour} />
                  </Svg>
                  {/* The way to take an arrow away: hold the line (see
                      armLinkNear) and a cross appears on its midpoint -
                      the S-curve passes through the midpoint of its two
                      ends. Tap the cross to remove the arrow; tap beside
                      the cards to put the cross away. Nothing sits on an
                      arrow until it is asked for. */}
                  {armedLinkId === id && (
                    <Pressable
                      hitSlop={10}
                      style={[
                        styles.linkCross,
                        { left: (x1 + x2) / 2 - LINK_DOT / 2, top: (y1 + y2) / 2 - LINK_DOT / 2 },
                      ]}
                      onPress={() => {
                        setArmedLinkId(null);
                        onToggleLink(link.from, link.to);
                      }}
                    >
                      <Ionicons name="close" size={14} color={PAPER_CARD} />
                    </Pressable>
                  )}
                </View>
              );
            })}
            <DraftLine
              startX={draftStartX}
              startY={draftStartY}
              endX={draftEndX}
              endY={draftEndY}
              visible={draftVisible}
            />
            <Animated.View style={[styles.marquee, marqueeStyle]} pointerEvents="none" />
            {blocks.map((block, index) => (
              <CanvasCard
                key={block.id}
                block={block}
                placement={placements[index]}
                position={positionOf(block.id, placements[index])}
                dragging={draggingId === block.id}
                onDragStart={setDraggingId}
                onDragEnd={() => setDraggingId(null)}
                draftEndX={draftEndX}
                draftEndY={draftEndY}
                onHandleStart={beginHandleDrag}
                onHandleEnd={endHandleDrag}
                canvasScale={scale}
                canvasPanGesture={panGesture}
                canvasMarqueeGesture={marqueeGesture}
                canvasTapGesture={clearSelectionGesture}
                canvasHoldGesture={holdLineGesture}
                editing={editingId === block.id}
                caretIndex={editingId === block.id ? editingCaret : null}
                onDone={stopEditing}
                ordinal={ordinals.get(block.id) ?? null}
                linkSource={linkSourceId === block.id}
                linking={linkSourceId !== null}
                onHold={setLinkSourceId}
                onLinkTap={handleLinkTap}
                selected={selectedIds.has(block.id)}
                groupOffsetX={groupOffsetX}
                groupOffsetY={groupOffsetY}
                onGroupMove={(dx, dy) => {
                  // Every selected card keeps its own position; the drag
                  // only says how far they all went.
                  selectedIds.forEach((id) => {
                    const index = blocks.findIndex((b) => b.id === id);
                    if (index === -1) return;
                    onMoveBlock(id, placements[index].x + dx, placements[index].y + dy);
                  });
                }}
                onHeight={reportHeight}
                onMove={onMoveBlock}
                onChangeText={onChangeText}
                onEdit={(id, x, y, caretIndex) => {
                  setEditingId(id);
                  setEditingCaret(caretIndex);
                  revealForEditing(x, y);
                }}
                onOpen={onOpenBlock}
              />
            ))}
          </Animated.View>
          </View>
        </Animated.View>
      </GestureDetector>
      {/* The page has "Додати блок" at its foot and the "/" menu; the
          canvas had no way to add anything, which meant no photo, no
          file, no database record without leaving it. One button, icon
          only, where the databases keep theirs. */}
      <Pressable
        style={styles.addButton}
        onPress={() => {
          const centre = toSurface(viewport.width / 2, viewport.height / 2);
          // A little up and left of the exact middle, so the new card's
          // top-left corner - not its centre - is where the eye is.
          onAdd({ x: centre.x - CARD_WIDTH / 2, y: centre.y - 40 });
        }}
      >
        <Ionicons name="add" size={28} color={PAPER_CARD} />
      </Pressable>
      {blocks.length === 0 && (
        <View style={styles.emptyState} pointerEvents="none">
          <Ionicons name="shapes-outline" size={30} color={PAPER_TEXT_FAINT} />
          <Text style={styles.emptyLabel}>Порожня нотатка - напишіть щось на сторінці</Text>
        </View>
      )}
    </View>
  );
}

// One end of a live arrow: the card's shared position plus whichever
// shared drag offset applies to it right now.
type LiveEnd = {
  x: SharedValue<number>;
  y: SharedValue<number>;
  offsetX: SharedValue<number> | null;
  offsetY: SharedValue<number> | null;
  height: number;
};

// The arrow while either card is moving. A straight rotated View rather
// than the Svg curve, as on the board: a curve's canvas would have to be
// resized every frame to keep up, and one big enough for any drag runs
// into Android's view-size limits. A line needs only a transform, and
// the curve comes back the moment the card is dropped.
function LiveLine({ from, to, colour }: { from: LiveEnd; to: LiveEnd; colour: string }) {
  const style = useAnimatedStyle(() => {
    const fromX = from.x.value + (from.offsetX?.value ?? 0);
    const fromY = from.y.value + (from.offsetY?.value ?? 0);
    const toX = to.x.value + (to.offsetX?.value ?? 0);
    const toY = to.y.value + (to.offsetY?.value ?? 0);
    // The same "leave from the side that faces the other card" rule the
    // resting curve uses, so the line does not jump sides on release.
    const fromIsLeft = fromX + CARD_WIDTH / 2 <= toX + CARD_WIDTH / 2;
    const x1 = fromIsLeft ? fromX + CARD_WIDTH : fromX;
    const y1 = fromY + from.height / 2;
    const x2 = fromIsLeft ? toX : toX + CARD_WIDTH;
    const y2 = toY + to.height / 2;
    const dx = x2 - x1;
    const dy = y2 - y1;
    const length = Math.sqrt(dx * dx + dy * dy);
    return {
      width: length,
      transform: [
        { translateX: (x1 + x2) / 2 - length / 2 },
        { translateY: (y1 + y2) / 2 - 1 },
        { rotateZ: `${Math.atan2(dy, dx)}rad` },
      ],
    };
  });
  return <Animated.View style={[styles.liveLine, { backgroundColor: colour }, style]} pointerEvents="none" />;
}

// The line a handle-drag trails behind the finger. Same rotated View,
// positioned by its midpoint and turned about its own centre.
function DraftLine({
  startX,
  startY,
  endX,
  endY,
  visible,
}: {
  startX: SharedValue<number>;
  startY: SharedValue<number>;
  endX: SharedValue<number>;
  endY: SharedValue<number>;
  visible: SharedValue<boolean>;
}) {
  const style = useAnimatedStyle(() => {
    const dx = endX.value - startX.value;
    const dy = endY.value - startY.value;
    const length = Math.sqrt(dx * dx + dy * dy);
    return {
      opacity: visible.value ? 1 : 0,
      width: length,
      transform: [
        { translateX: (startX.value + endX.value) / 2 - length / 2 },
        { translateY: (startY.value + endY.value) / 2 - 1 },
        { rotateZ: `${Math.atan2(dy, dx)}rad` },
      ],
    };
  });
  return <Animated.View style={[styles.liveLine, style]} pointerEvents="none" />;
}

function CanvasCard({
  block,
  placement,
  position,
  dragging,
  onDragStart,
  onDragEnd,
  draftEndX,
  draftEndY,
  onHandleStart,
  onHandleEnd,
  canvasScale,
  canvasPanGesture,
  canvasMarqueeGesture,
  canvasTapGesture,
  canvasHoldGesture,
  editing,
  ordinal,
  linkSource,
  linking,
  onHold,
  onLinkTap,
  selected,
  groupOffsetX,
  groupOffsetY,
  onGroupMove,
  caretIndex,
  onDone,
  onHeight,
  onMove,
  onChangeText,
  onEdit,
  onOpen,
}: {
  block: Block;
  placement: CanvasPlacement;
  // The card's shared position, owned by the canvas - see positionOf.
  position: { x: SharedValue<number>; y: SharedValue<number> };
  dragging: boolean;
  onDragStart: (id: string) => void;
  onDragEnd: () => void;
  // The far end of the handle's draft line, written by the handle drag.
  draftEndX: SharedValue<number>;
  draftEndY: SharedValue<number>;
  onHandleStart: (id: string) => void;
  onHandleEnd: (id: string, x: number, y: number) => void;
  canvasScale: ReturnType<typeof useSharedValue<number>>;
  canvasPanGesture: ReturnType<typeof Gesture.Pan>;
  canvasMarqueeGesture: ReturnType<typeof Gesture.Pan>;
  canvasTapGesture: ReturnType<typeof Gesture.Tap>;
  canvasHoldGesture: ReturnType<typeof Gesture.LongPress>;
  editing: boolean;
  // Its number on the page, once the arrows are honoured - null for a
  // card no order-setting arrow touches.
  ordinal: number | null;
  // This card is where an arrow is about to start from.
  linkSource: boolean;
  // SOME card is: a tap on this one then finishes the arrow instead of
  // doing what a tap normally does.
  linking: boolean;
  onHold: (id: string) => void;
  onLinkTap: (id: string) => void;
  selected: boolean;
  groupOffsetX: ReturnType<typeof useSharedValue<number>>;
  groupOffsetY: ReturnType<typeof useSharedValue<number>>;
  // How far the whole selection was dragged, once it is let go.
  onGroupMove: (dx: number, dy: number) => void;
  caretIndex: number | null;
  onHeight: (id: string, height: number) => void;
  onMove: (id: string, x: number, y: number) => void;
  onChangeText: (id: string, text: string) => void;
  onEdit: (id: string, x: number, y: number, caretIndex: number | null) => void;
  onDone: () => void;
  onOpen: (id: string) => void;
}) {
  const posX = position.x;
  const posY = position.y;
  // The card follows its placement whenever it is not under the finger:
  // the column re-lays itself out as heights are measured, and a group
  // move gives every chosen card a new place at once. Not while dragging
  // - then the finger, not the state, says where the card is.
  useEffect(() => {
    if (dragging) return;
    posX.value = placement.x;
    posY.value = placement.y;
  }, [placement.x, placement.y, dragging, posX, posY]);
  const isText = TEXT_TYPES.includes(block.type ?? 'paragraph');
  // A browser's multi-line field does not grow with its text: it is a
  // <textarea>, two rows tall, with the rest scrolled out of sight inside
  // it - so a card being typed into shrank to a slot while the text it
  // was showing a moment ago was still there, hidden. Same helper the
  // page's own blocks use; on a phone it does nothing.
  const inputRef = useRef<TextInput | null>(null);
  // Whether the tapped-character caret has been applied to the current
  // editing session; cleared whenever editing ends so the next tap
  // places it again.
  const caretPlacedRef = useRef(false);
  useEffect(() => {
    if (!editing) caretPlacedRef.current = false;
  }, [editing]);
  // The card's own text as the browser drew it - what gets asked which
  // character a click hit.
  const textNodeRef = useRef<Text>(null);
  // Where each line of that text was laid out. A phone has no way to ask
  // which character a touch hit, so the answer is reconstructed from
  // these - see caretFromTextLayout, the same maths the page's blocks
  // have always used.
  const linesRef = useRef<CaretLine[]>([]);
  useEffect(() => {
    autoGrowInput(inputRef.current);
  }, [block.text, editing]);

  async function handleTap(x: number, y: number, pageX: number, pageY: number) {
    // A picture or a file has controls of its own, and they are on the
    // page - so that is where a tap on one goes. Text is typed where it
    // stands.
    if (linking) {
      onLinkTap(block.id);
      return;
    }
    if (!isText) {
      onOpen(block.id);
      return;
    }
    // ONE click, straight to the character it hit. A browser can be asked
    // this outright; without asking, the field opened with the caret at
    // the start and it took a second click to put it where the first one
    // had already pointed. Null on a phone - there is no document to ask
    // - and the field then does what it always did.
    const fromDom = caretIndexFromDom(textNodeRef.current, pageX, pageY);
    if (fromDom !== null) {
      onEdit(block.id, x, y, fromDom);
      return;
    }
    // The phone: the same reconstruction the page's blocks use - the line
    // the touch fell on, then the character along it. Without it the
    // field opened with the caret at the end of the text, wherever the
    // finger had actually been.
    const box = canPlaceCaretByTouch ? await measureNode(textNodeRef.current) : null;
    if (!box) {
      onEdit(block.id, x, y, null);
      return;
    }
    onEdit(
      block.id,
      x,
      y,
      displayIndexForTouch(linesRef.current, block.text ?? '', pageX - box.x, pageY - box.y)
    );
  }

  const dragGesture = Gesture.Pan()
    // While the card is being typed into it must not move under the
    // finger: the touches belong to the text - placing a caret, choosing
    // a word. Tap the canvas to put the text down, then drag.
    .enabled(!editing)
    // Without this the surface underneath also recognises a sliver of the
    // same touch, which lands as a jump when the finger lifts. The board
    // hit exactly this.
    // ...and since the selection box arrived, the box too: it is a Pan
    // on the surface as well, with a SHORTER trigger distance than this
    // one, so it won the touch on every card and the card never moved -
    // the box was drawn instead. Whatever the surface can do with a
    // touch, a touch that begins on a card is not that.
    .blocksExternalGesture(canvasPanGesture, canvasMarqueeGesture, canvasTapGesture, canvasHoldGesture)
    .onStart(() => {
      runOnJS(onDragStart)(block.id);
    })
    // Per-event delta divided by the zoom, so a card keeps up with the
    // finger 1:1 however far in or out the canvas is.
    .onChange((e) => {
      if (selected) {
        // One of a chosen set: the offset is shared, so every other
        // chosen card moves with this one.
        groupOffsetX.value += e.changeX / canvasScale.value;
        groupOffsetY.value += e.changeY / canvasScale.value;
        return;
      }
      posX.value += e.changeX / canvasScale.value;
      posY.value += e.changeY / canvasScale.value;
    })
    .onEnd(() => {
      if (selected) {
        runOnJS(onGroupMove)(groupOffsetX.value, groupOffsetY.value);
        groupOffsetX.value = 0;
        groupOffsetY.value = 0;
      } else {
        runOnJS(onMove)(block.id, posX.value, posY.value);
      }
      runOnJS(onDragEnd)();
    })
    .onFinalize(() => {
      runOnJS(onDragEnd)();
    });

  const tapGesture = Gesture.Tap()
    .enabled(!editing)
    // A tap on a card is not a tap on the canvas beside it - which would
    // put the selection down in the same moment the card was chosen.
    .blocksExternalGesture(canvasTapGesture, canvasMarqueeGesture, canvasHoldGesture)
    .onEnd((e) => {
      runOnJS(handleTap)(posX.value, posY.value, e.absoluteX, e.absoluteY);
    });

  // A hold starts an arrow. The one gesture the card had left, and the
  // same on both devices; it does not touch the drag, the tap, the box
  // or the typing, which took long enough to untangle.
  const holdGesture = Gesture.LongPress()
    .enabled(!editing)
    .minDuration(450)
    .blocksExternalGesture(canvasPanGesture, canvasMarqueeGesture, canvasTapGesture, canvasHoldGesture)
    .onStart(() => {
      runOnJS(onHold)(block.id);
    });

  const gesture = Gesture.Race(dragGesture, tapGesture, holdGesture);

  // The second way to make an arrow: a small handle on the card's right
  // edge, dragged onto another card. It sits on its own detector and
  // blocks the card's own gestures, so a touch that begins on the handle
  // is a line being drawn and never a card being moved. The far end moves
  // by the same zoom-divided delta a card does.
  const handleGesture = Gesture.Pan()
    .enabled(!editing)
    .blocksExternalGesture(dragGesture, tapGesture, holdGesture, canvasPanGesture, canvasMarqueeGesture, canvasTapGesture, canvasHoldGesture)
    .onStart(() => {
      runOnJS(onHandleStart)(block.id);
    })
    .onChange((e) => {
      draftEndX.value += e.changeX / canvasScale.value;
      draftEndY.value += e.changeY / canvasScale.value;
    })
    .onEnd(() => {
      runOnJS(onHandleEnd)(block.id, draftEndX.value, draftEndY.value);
    });

  const cardStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: posX.value + (selected ? groupOffsetX.value : 0) },
      { translateY: posY.value + (selected ? groupOffsetY.value : 0) },
    ],
  }));

  return (
    <GestureDetector gesture={gesture}>
      <Animated.View
        style={[
          styles.card,
          selected && styles.cardSelected,
          editing && styles.cardEditing,
          linkSource && styles.cardLinkSource,
          cardStyle,
        ]}
        onLayout={(e) => onHeight(block.id, e.nativeEvent.layout.height)}
      >
        {ordinal !== null && (
          <View style={styles.ordinal} pointerEvents="none">
            <Text style={styles.ordinalLabel}>{ordinal}</Text>
          </View>
        )}
        {editing ? (
          <>
          {/* The way out, on the card itself. Tapping beside the cards
              works too, but on a phone the keyboard covers most of what
              is beside them - so the one control that is certainly not
              under the keyboard is the card's own corner. An icon: there
              is no room for a word here, and a tick is what "done"
              looks like everywhere. */}
          <Pressable hitSlop={10} style={styles.cardDone} onPress={onDone}>
            <Ionicons name="checkmark" size={18} color={PAPER_TEXT_MUTED} />
          </Pressable>
          <TextInput
            ref={(node) => {
              inputRef.current = node;
              // On mount too: the field is created already holding the
              // whole block's text.
              autoGrowInput(node);
              // The caret goes to the tapped character ONCE, when the
              // field appears. This callback runs on every render - on
              // every letter typed - and placing the caret here each
              // time sent it back to the tap point after each keystroke,
              // so the text "started strictly where I first tapped".
              if (node && caretIndex !== null && !caretPlacedRef.current) {
                caretPlacedRef.current = true;
                // Twice: now, and again once the browser has given the
                // field focus - a selection set before the focus lands is
                // thrown away by the focus itself.
                setSelection(node, caretIndex, caretIndex);
                setTimeout(() => setSelection(node, caretIndex, caretIndex), 0);
              }
            }}
            autoFocus
            multiline
            value={block.text}
            onChangeText={(text) => onChangeText(block.id, text)}
            placeholder="Текст"
            placeholderTextColor={PAPER_TEXT_FAINT}
            style={styles.cardInput}
          />
          </>
        ) : (
          <>
          <CardBody
            block={block}
            textNode={textNodeRef}
            onTextLayout={(e) => {
              linesRef.current = e.nativeEvent.lines;
            }}
          />
          <GestureDetector gesture={handleGesture}>
            <View style={styles.handle} hitSlop={8}>
              <View style={styles.handleDot} />
            </View>
          </GestureDetector>
          </>
        )}
      </Animated.View>
    </GestureDetector>
  );
}

// What a block looks like on the canvas: enough to recognise it, never
// enough to edit it. Editing is the page's job, and a tap is the way
// there.
function CardBody({
  block,
  textNode,
  onTextLayout,
}: {
  block: Block;
  textNode?: React.Ref<Text>;
  onTextLayout?: (e: { nativeEvent: { lines: CaretLine[] } }) => void;
}) {
  const type = block.type ?? 'paragraph';

  if (type === 'image' || type === 'sketch') {
    return block.imageUri ? (
      <AttachmentImage
        uri={block.imageUri}
        driveFileId={block.driveFileId}
        style={styles.cardImage}
        resizeMode="cover"
      />
    ) : (
      <CardRow icon="image-outline" label="Зображення" />
    );
  }
  if (type === 'file') {
    return <CardRow icon="document-outline" label={block.fileTitle || block.fileName || 'Файл'} />;
  }
  if (type === 'link') {
    return <CardRow icon="link-outline" label={block.text || block.linkUrl || 'Посилання'} />;
  }
  if (type === 'dbRow' || type === 'dbView') {
    return <CardRow icon="albums-outline" label={block.text || 'База даних'} />;
  }
  if (type === 'divider') {
    return <View style={styles.cardDivider} />;
  }
  if (type === 'table') {
    return <CardRow icon="grid-outline" label={block.text || 'Таблиця'} />;
  }
  if (type === 'bulleted' || type === 'numbered') {
    return (
      <View style={styles.cardRow}>
        <Ionicons
          name={type === 'bulleted' ? 'ellipse' : 'list-outline'}
          size={type === 'bulleted' ? 7 : 16}
          color={PAPER_TEXT_MUTED}
        />
        <Text style={styles.cardText}>
          {block.text || ' '}
        </Text>
      </View>
    );
  }
  if (type === 'checkbox') {
    return (
      <View style={styles.cardRow}>
        <Ionicons
          name={block.checked ? 'checkbox' : 'square-outline'}
          size={18}
          color={block.checked ? PAPER_TEXT_MUTED : PAPER_TEXT_FAINT}
        />
        <Text style={[styles.cardText, block.checked && styles.cardTextDone]}>
          {block.text || 'Пункт'}
        </Text>
      </View>
    );
  }
  return (
    <Text ref={textNode} onTextLayout={onTextLayout} style={styles.cardText}>
      {block.text || ' '}
    </Text>
  );
}

function CardRow({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  return (
    <View style={styles.cardRow}>
      <Ionicons name={icon} size={18} color={PAPER_TEXT_MUTED} />
      <Text style={styles.cardText} numberOfLines={3}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  viewport: {
    flex: 1,
    overflow: 'hidden',
  },
  fill: {
    flex: 1,
  },
  // The surface itself has no size: the cards are absolutely positioned on
  // it and it is the transform that moves them all together.
  surface: {
    flex: 1,
  },
  // Big enough to catch a tap anywhere around the cards, in surface
  // coordinates - the canvas can be panned and zoomed far from its
  // origin, and this has to still be under wherever it ends up.
  stopEditingCatcher: {
    position: 'absolute',
    left: -4000,
    top: -4000,
    right: -4000,
    bottom: -4000,
  },
  // Opaque, and with a hairline edge: on white paper an edge is the only
  // thing that says where one card ends and the next begins.
  marquee: {
    position: 'absolute',
    borderWidth: 1,
    borderColor: PAPER_EDGE_EDITING,
    backgroundColor: 'rgba(138,180,255,0.12)',
    borderRadius: 4,
  },
  link: {
    position: 'absolute',
  },
  // The card an arrow is about to be drawn from: the arrow's own colour
  // on its edge, so it is plain which end has been chosen.
  cardLinkSource: {
    borderColor: LINK_COLOR,
    borderWidth: 2,
  },
  cardSelected: {
    borderColor: PAPER_EDGE_EDITING,
    borderWidth: 2,
  },
  card: {
    position: 'absolute',
    width: CARD_WIDTH,
    minHeight: 56,
    // No cap on the height: a card used to stop at six lines and end in
    // an ellipsis, which on a surface meant for reading is the card
    // hiding what it is for. It grows to its text instead - the column
    // is laid out from measured heights anyway, so a tall card simply
    // takes the room it needs.
    backgroundColor: PAPER_CARD,
    borderWidth: 1,
    borderColor: PAPER_EDGE,
    borderRadius: 16,
    padding: 12,
    overflow: 'hidden',
    // A shadow rather than a fill difference - the card has to lift off
    // paper of the same colour as itself.
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  // The card being typed into: the app's own blue on its edge, so it is
  // plain which one the keyboard belongs to.
  cardEditing: {
    borderColor: PAPER_EDGE_EDITING,
    borderWidth: 2,
  },
  cardInput: {
    paddingRight: 22,
    // A browser gives a textarea its own default width (the `cols`
    // attribute), which is narrower than the card it sits in - the input
    // has to be told to fill its parent, exactly as the editor's own
    // inputs had to be.
    width: '100%',
    alignSelf: 'stretch',
    textAlignVertical: 'top',
    // No flex here on purpose. In the editor's rows `flex: 1` governs a
    // field's WIDTH (those rows lay out sideways); this card lays out
    // downwards, where flex would govern the HEIGHT instead and fight the
    // grown height above.
    fontSize: 14,
    lineHeight: 19,
    fontFamily: FONT_REGULAR,
    color: PAPER_TEXT,
    padding: 0,
    minHeight: 40,
  },
  // The card's number on the page, in the arrow's colour, hung off the
  // top-left corner so it reads as a label on the card rather than part
  // of its text.
  ordinal: {
    position: 'absolute',
    top: -1,
    left: -1,
    minWidth: 22,
    height: 22,
    paddingHorizontal: 6,
    borderRadius: 11,
    borderBottomRightRadius: 11,
    backgroundColor: LINK_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  ordinalLabel: {
    fontSize: 12,
    fontFamily: FONT_SEMIBOLD,
    color: PAPER_CARD,
  },
  // The corner tick. Padded into the card's own padding rather than
  // pushing the text aside - it only exists while that card is being
  // typed into.
  // A live arrow / the draft line: 2pt of the arrow's colour, positioned
  // and turned entirely by its animated transform.
  linkCross: {
    position: 'absolute',
    width: LINK_DOT,
    height: LINK_DOT,
    borderRadius: LINK_DOT / 2,
    backgroundColor: LINK_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  liveLine: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: 2,
    backgroundColor: LINK_COLOR,
  },
  // The arrow handle, on the card's right edge at half its height. Faint
  // until it is being dragged - it is on every card, and a ring on every
  // card must not shout.
  handle: {
    position: 'absolute',
    right: 2,
    top: '50%',
    marginTop: -9,
    width: 18,
    height: 18,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  handleDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: LINK_COLOR,
    backgroundColor: PAPER_CARD,
    opacity: 0.55,
  },
  cardDone: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 2,
    padding: 4,
  },
  cardImage: {
    width: '100%',
    height: 140,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 19,
    fontFamily: FONT_REGULAR,
    color: PAPER_TEXT,
  },
  cardTextDone: {
    color: PAPER_TEXT_MUTED,
    textDecorationLine: 'line-through',
  },
  cardHeading: {
    fontSize: 17,
    fontFamily: FONT_SEMIBOLD,
    color: PAPER_TEXT,
  },
  cardDivider: {
    height: 1,
    backgroundColor: PAPER_EDGE,
    marginVertical: 8,
  },
  addButton: {
    position: 'absolute',
    right: 20,
    bottom: 28,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: PAPER_TEXT,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
    zIndex: 5,
  },
  emptyState: {
    ...StyleSheet.absoluteFill,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  emptyLabel: {
    fontSize: 14,
    textAlign: 'center',
    fontFamily: FONT_REGULAR,
    color: PAPER_TEXT_FAINT,
  },
});

// forwardRef, only so the screen can reach stopEditing - see
// DocumentCanvasHandle.
const DocumentCanvas = forwardRef(DocumentCanvasInner);
export default DocumentCanvas;
