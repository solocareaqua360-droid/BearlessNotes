import { useEffect, useRef, useState } from 'react';
import {
  Animated as RNAnimated,
  GestureResponderEvent,
  LayoutChangeEvent,
  Image,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons } from './icons/Ionicons';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SketchElement, SketchImageElement, SketchPathElement, SketchShape } from '../types';
import * as ImagePicker from 'expo-image-picker';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { backupFileToDrive } from '../utils/googleDrive';
import { ask } from './surfaces/Ask';
import AddExistingItemModal from './AddExistingItemModal';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { useSoft } from '../theme/soft';
import { useTheme } from '../theme/ThemeProvider';
import {
  INK,
  boundsOf,
  drawingViewBox,
  inkOn,
  isClosedShape,
  normalizeDeg,
  parsePathPoints,
  pivotOf,
  pointsToPath,
  rotateElementAbout,
  rotatePoint,
  scaleElement,
  shapeElement,
  shapeToPath,
  translateElement,
  unionBox,
  worldBoundsOf,
  type Box,
  type Point,
} from '../utils/sketchGeometry';
import SketchLayer from './SketchLayer';

// The first is the paper's own ink (see sketchGeometry's INK).
const COLORS = [INK, '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6'];
// 1.5 the finest - "додай ще меншу товщину лінії" (2026-10-02).
const WIDTHS = [1.5, 3, 6, 10];
const TEXT_FONT_SIZE = 22;
// How close a touch has to land to a stroke's points to rub them out. The
// eraser removes just the points it passes over (splitting what's left
// into separate strokes), rather than the whole element - erasing a whole
// stroke is what plain "undo" already does.
const ERASE_RADIUS = 18;
const HANDLE = 12;
const HANDLE_TOUCH_RADIUS = 24;
// How far above the box the turning grip stands.
const ROTATE_ARM = 34;
// THE PAPER IS BIGGER THAN THE SCREEN (2026-10-02): two fingers move it and
// zoom it, one finger draws. Everything that is a size on the SCREEN - a
// grip, the turning arm, how close a touch must land - is divided by the
// zoom where it is used, so it stays the same size under the finger.
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;
// The alignment guides, as the boards draw them (BoardScreen's GUIDE_*).
const GUIDE_COLOR = '#FF3D9A';
const GUIDE_SNAP_DISTANCE = 6;
// The selection box stands this far off what it holds.
const FRAME_PAD = 8;

type Tool = 'pen' | 'line' | 'arrow' | 'rect' | 'circle' | 'text' | 'select' | 'eraser';
type ShapeTool = 'line' | 'arrow' | 'rect' | 'circle';

// Lucide's own glyphs, drawn directly ('lc:' - see the Ionicons shim).
const TOOLS: { tool: Tool; icon: string }[] = [
  { tool: 'pen', icon: 'lc:pencil' },
  { tool: 'line', icon: 'lc:minus' },
  { tool: 'arrow', icon: 'lc:move-up-right' },
  { tool: 'rect', icon: 'lc:square' },
  { tool: 'circle', icon: 'lc:circle' },
  { tool: 'text', icon: 'lc:type' },
  { tool: 'select', icon: 'lc:mouse-pointer-2' },
  { tool: 'eraser', icon: 'lc:eraser' },
];

const SHAPE_TOOLS: ShapeTool[] = ['line', 'arrow', 'rect', 'circle'];

function isShapeTool(tool: Tool): tool is ShapeTool {
  return (SHAPE_TOOLS as Tool[]).includes(tool);
}

interface Props {
  visible: boolean;
  initialElements: SketchElement[];
  // A photograph to draw ON. The canvas then takes the PICTURE's shape
  // rather than the screen's, so a stroke laid on a corner of the photo
  // is on that corner everywhere the two are shown together - in the
  // note, and in a PDF export. The picture itself is never touched: the
  // drawing is a layer beside it, which is what lets "show the original"
  // be a switch rather than a second file.
  background?: { uri: string; aspectRatio?: number };
  // The note's paper, when it wears a colour of its own - the drawing is
  // made on the paper it will lie on. The theme's paper otherwise.
  paper?: string;
  onSave: (elements: SketchElement[], width: number, height: number) => void;
  onClose: () => void;
}

// ---- the selection's box ---------------------------------------------------

// What is chosen, as one box: one element's own box, turned with it; or,
// for several, the upright box around all of them.
type Frame = { box: Box; rot: number; pivot: Point };

function frameOf(elements: SketchElement[], ids: number[]): Frame | null {
  const chosen = ids.map((i) => elements[i]).filter(Boolean);
  if (chosen.length === 0) return null;
  if (chosen.length === 1) {
    const b = boundsOf(chosen[0]);
    const box = { minX: b.minX - FRAME_PAD, minY: b.minY - FRAME_PAD, maxX: b.maxX + FRAME_PAD, maxY: b.maxY + FRAME_PAD };
    return { box, rot: chosen[0].rot ?? 0, pivot: pivotOf(chosen[0]) };
  }
  const u = unionBox(chosen.map(worldBoundsOf));
  if (!u) return null;
  const box = { minX: u.minX - FRAME_PAD, minY: u.minY - FRAME_PAD, maxX: u.maxX + FRAME_PAD, maxY: u.maxY + FRAME_PAD };
  return { box, rot: 0, pivot: { x: (box.minX + box.maxX) / 2, y: (box.minY + box.maxY) / 2 } };
}

// The eight grips, in the box's own (unturned) frame: corners and the
// middles of the sides. `ax`/`ay` say which way each one pulls.
type Grip = { x: number; y: number; ax: -1 | 0 | 1; ay: -1 | 0 | 1 };
function gripsOf(box: Box): Grip[] {
  const mx = (box.minX + box.maxX) / 2;
  const my = (box.minY + box.maxY) / 2;
  return [
    { x: box.minX, y: box.minY, ax: -1, ay: -1 },
    { x: mx, y: box.minY, ax: 0, ay: -1 },
    { x: box.maxX, y: box.minY, ax: 1, ay: -1 },
    { x: box.maxX, y: my, ax: 1, ay: 0 },
    { x: box.maxX, y: box.maxY, ax: 1, ay: 1 },
    { x: mx, y: box.maxY, ax: 0, ay: 1 },
    { x: box.minX, y: box.maxY, ax: -1, ay: 1 },
    { x: box.minX, y: my, ax: -1, ay: 0 },
  ];
}

// The element under a finger, the one on top first - judged in the
// element's own frame, so a turned one is hit where it is drawn.
function elementAt(elements: SketchElement[], p: Point, zoom = 1): number {
  const PAD = 12 / zoom;
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    const local = el.rot ? rotatePoint(p, pivotOf(el), -el.rot) : p;
    const b = boundsOf(el);
    if (local.x >= b.minX - PAD && local.x <= b.maxX + PAD && local.y >= b.minY - PAD && local.y <= b.maxY + PAD) return i;
  }
  return -1;
}

function intersects(a: Box, b: Box): boolean {
  return a.minX <= b.maxX && a.maxX >= b.minX && a.minY <= b.maxY && a.maxY >= b.minY;
}

// A turned stroke, with its turn written into its points - what the
// eraser needs, since it rubs out where the stroke IS on the page.
function bakeTurn(el: SketchElement): SketchElement {
  if (!el.rot || el.kind !== 'path') return el;
  const pivot = pivotOf(el);
  const runs = el.d
    .split(/(?=M)/)
    .filter(Boolean)
    .map((run) => parsePathPoints(run).map((p) => rotatePoint(p, pivot, el.rot ?? 0)));
  return { kind: 'path', d: runs.map((r) => pointsToPath(r)).join(' '), color: el.color, width: el.width };
}

// Rubs out just the points the eraser passed over: what's left of a stroke
// is split into separate strokes, so wiping the middle of a line leaves
// its two ends behind instead of deleting the whole thing. A shape that
// gets partly rubbed out loses its shape data (it's no longer a clean
// rectangle/circle) and carries on as a plain path.
function eraseFromElement(el: SketchElement, x: number, y: number, radius = ERASE_RADIUS): SketchElement[] {
  // Words and pictures go whole - there is nothing of them to rub at.
  if (el.kind !== 'path') {
    const local = el.rot ? rotatePoint({ x, y }, pivotOf(el), -el.rot) : { x, y };
    const b = boundsOf(el);
    const hit = local.x >= b.minX - 8 && local.x <= b.maxX + 8 && local.y >= b.minY - 8 && local.y <= b.maxY + 8;
    return hit ? [] : [el];
  }
  const points = parsePathPoints(el.d);
  const near = (p: Point) => Math.hypot(p.x - x, p.y - y) < radius;
  const flat = el.rot ? parsePathPoints((bakeTurn(el) as SketchPathElement).d) : points;
  if (!flat.some(near)) return [el];
  const runs: Point[][] = [];
  let run: Point[] = [];
  for (const p of flat) {
    if (near(p)) {
      if (run.length > 1) runs.push(run);
      run = [];
    } else {
      run.push(p);
    }
  }
  if (run.length > 1) runs.push(run);
  return runs.map((r) => ({ kind: 'path', d: pointsToPath(r), color: el.color, width: el.width }));
}

// What a finger is doing with the selection, from where it started - each
// move is worked out from the elements as they were at the start, so
// nothing drifts however long the finger keeps going.
type Op =
  | { kind: 'move'; start: Point; base: SketchElement[]; ids: number[] }
  | { kind: 'scale'; grip: Grip; frame: Frame; base: SketchElement[]; ids: number[] }
  | { kind: 'rotate'; startAngle: number; frame: Frame; base: SketchElement[]; ids: number[] }
  | { kind: 'marquee'; start: Point; current: Point };

export default function SketchEditor({ visible, initialElements, background, paper, onSave, onClose }: Props) {
  const S = useSoft();
  const theme = useTheme();
  // No canvas of its own: the drawing is made on the note's paper -
  // "все повинно виглядати так ніби малюнок зроблений на самому аркуші
  // нотатки" (2026-10-02).
  const paperFill = paper ?? theme.paper.fill;
  const paperInk = theme.paper.ink;
  const [elements, setElements] = useState<SketchElement[]>(initialElements);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [shapeStart, setShapeStart] = useState<Point | null>(null);
  const [shapeCurrent, setShapeCurrent] = useState<Point | null>(null);
  // Placement for a new text label; the field itself is a plain overlay in
  // this same window - NOT a nested <Modal>, which on Android takes focus
  // away from its own TextInput (the keyboard opened and closed again).
  const [pendingText, setPendingText] = useState<Point | null>(null);
  const [textValue, setTextValue] = useState('');
  // What is chosen (select tool), and what a finger is doing with it.
  const [selection, setSelection] = useState<number[]>([]);
  const op = useRef<Op | null>(null);
  const [marquee, setMarquee] = useState<Box | null>(null);
  // How the paper lies on the screen: moved by (tx, ty), zoomed by s.
  const [view, setView] = useState({ tx: 0, ty: 0, s: 1 });
  const [guides, setGuides] = useState<{ x: number | null; y: number | null } | null>(null);
  // Every change, undoable: the elements as they were before it.
  const history = useRef<SketchElement[][]>([]);
  const [color, setColor] = useState(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(WIDTHS[0]);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<Tool>('pen');
  // The picture's shape, asked of the file itself. Until it answers the
  // canvas is square, which is only ever seen for a frame.
  const [aspect, setAspect] = useState(background?.aspectRatio ?? 1);
  // The room the picture has, and the box it actually takes in it.
  //
  // A tall photograph asked for `width: 100%` plus its own aspectRatio
  // came out taller than the screen and simply OVERFLOWED - over the
  // toolbar, and over the header, which is where "Готово" lives. So the
  // picture is FITTED: whichever of the two sides runs out first decides
  // the size, and the whole photograph is on screen with its controls.
  const [stage, setStage] = useState({ width: 0, height: 0 });
  // The palette hides behind one dot on the floating bar - open only
  // while it is being used.
  const [paletteOpen, setPaletteOpen] = useState(false);
  // THE SHAPE'S OWN SETTINGS (2026-10-02): an inside filled with a colour,
  // the outline on or off, words in the middle. Defaults for the next
  // rectangle or circle, and - with shapes chosen - changes to those.
  const [shapePanelOpen, setShapePanelOpen] = useState(false);
  const [shapeFill, setShapeFill] = useState<string | null>(null);
  const [shapeStroke, setShapeStroke] = useState(true);
  const [shapeWithText, setShapeWithText] = useState(false);
  // The shape whose words are being written (the same field as a label).
  const [labelFor, setLabelFor] = useState<number | null>(null);
  // The bar goes where the hand puts it.
  //
  // Wherever it rests it covers SOMETHING - the picture is the whole
  // screen - so the answer is not a better place for it but letting the
  // user move it off whatever they are drawing on. Plain PanResponder
  // and RN's own Animated, not gesture-handler: this editor's canvas is
  // built on responder events for the same reason (it is an isolated
  // surface inside a Modal), and mixing the two here has caused trouble
  // before.
  const barPan = useRef(new RNAnimated.ValueXY({ x: 0, y: 0 })).current;
  const barAt = useRef({ x: 0, y: 0 });
  const barDrag = useRef(
    PanResponder.create({
      // Only once the finger has travelled - a tap still belongs to the
      // button under it.
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dx) > 6 || Math.abs(g.dy) > 6,
      onPanResponderGrant: () => {
        barPan.setOffset({ ...barAt.current });
        barPan.setValue({ x: 0, y: 0 });
      },
      onPanResponderMove: RNAnimated.event([null, { dx: barPan.x, dy: barPan.y }], {
        useNativeDriver: false,
      }),
      onPanResponderRelease: (_e, g) => {
        barAt.current = { x: barAt.current.x + g.dx, y: barAt.current.y + g.dy };
        barPan.flattenOffset();
      },
    })
  ).current;
  // The system's own bars. Over a photograph the editor takes the whole
  // screen (no safe-area padding, or the picture loses two strips), so
  // the floating chrome keeps clear of them itself - otherwise "Готово"
  // sat on top of the clock.
  const insets = useSafeAreaInsets();
  const fitted =
    stage.width > 0 && stage.height > 0
      ? stage.width / stage.height > aspect
        ? { width: Math.round(stage.height * aspect), height: stage.height }
        : { width: stage.width, height: Math.round(stage.width / aspect) }
      : { width: 0, height: 0 };
  useEffect(() => {
    if (!visible || !background?.uri || background.aspectRatio) return;
    let alive = true;
    Image.getSize(
      background.uri,
      (w, h) => {
        if (alive && w > 0 && h > 0) setAspect(w / h);
      },
      () => {}
    );
    return () => {
      alive = false;
    };
  }, [visible, background?.uri, background?.aspectRatio]);

  // Re-seed local state when the editor OPENS, since it stays mounted
  // (just hidden) between blocks otherwise and would carry over the
  // previous block's drawing.
  //
  // Keyed strictly off the hidden -> visible transition, never off
  // `initialElements` changing: the parent builds that prop inline
  // (`... || []`), so it's a fresh array on every one of ITS renders - and
  // it re-renders whenever the keyboard opens, because it tracks the
  // keyboard height. Re-seeding on that would wipe everything drawn so far
  // and close the text field the moment its keyboard appeared, which is
  // exactly what it did.
  const wasVisibleRef = useRef(false);
  useEffect(() => {
    if (visible && !wasVisibleRef.current) {
      setElements(initialElements);
      setCurrentPoints([]);
      setShapeStart(null);
      setShapeCurrent(null);
      setPendingText(null);
      setLabelFor(null);
      setTextValue('');
      setSelection([]);
      op.current = null;
      setMarquee(null);
      history.current = [];
      setView({ tx: 0, ty: 0, s: 1 });
      setGuides(null);
      setTool('pen');
      // A drawing that has grown past the screen opens whole, not with
      // its top-left corner showing.
      const box = background ? null : drawingViewBox(initialElements, 0);
      if (box && canvasSize.width > 0 && (box.x < 0 || box.y < 0 || box.x + box.width > canvasSize.width || box.y + box.height > canvasSize.height)) {
        fitView(initialElements);
      }
    }
    wasVisibleRef.current = visible;
  }, [visible, initialElements]);

  function handleCanvasLayout(e: LayoutChangeEvent) {
    setCanvasSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
  }

  // Before a change: what to go back to.
  function remember(before: SketchElement[] = elements) {
    history.current.push(before);
    if (history.current.length > 100) history.current.shift();
  }

  // The eraser is one change per stroke of the finger, not per point.
  const erasing = useRef(false);
  function eraseAt(x: number, y: number) {
    if (!erasing.current) {
      erasing.current = true;
      remember();
    }
    setElements((prev) => prev.flatMap((el) => eraseFromElement(el, x, y, ERASE_RADIUS / view.s)));
    setSelection([]);
  }

  // ---- the select tool -------------------------------------------------------

  function selectStart(p: Point) {
    const frame = frameOf(elements, selection);
    if (frame) {
      const local = rotatePoint(p, frame.pivot, -frame.rot);
      const b = frame.box;
      const mx = (b.minX + b.maxX) / 2;
      // The turning grip, above the box's top middle.
      if (Math.hypot(local.x - mx, local.y - (b.minY - ROTATE_ARM / view.s)) < HANDLE_TOUCH_RADIUS / view.s) {
        op.current = {
          kind: 'rotate',
          startAngle: Math.atan2(p.y - frame.pivot.y, p.x - frame.pivot.x),
          frame,
          base: elements,
          ids: selection,
        };
        return;
      }
      const grip = gripsOf(b).find((g) => Math.hypot(local.x - g.x, local.y - g.y) < HANDLE_TOUCH_RADIUS / view.s);
      if (grip) {
        op.current = { kind: 'scale', grip, frame, base: elements, ids: selection };
        return;
      }
      if (local.x >= b.minX && local.x <= b.maxX && local.y >= b.minY && local.y <= b.maxY) {
        op.current = { kind: 'move', start: p, base: elements, ids: selection };
        return;
      }
    }
    const hit = elementAt(elements, p, view.s);
    if (hit !== -1) {
      setSelection([hit]);
      op.current = { kind: 'move', start: p, base: elements, ids: [hit] };
      return;
    }
    // Empty paper: a frame drawn round what is to be chosen.
    setSelection([]);
    op.current = { kind: 'marquee', start: p, current: p };
    setMarquee({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y });
  }

  function selectMove(p: Point) {
    const o = op.current;
    if (!o) return;
    if (o.kind === 'marquee') {
      o.current = p;
      setMarquee({
        minX: Math.min(o.start.x, p.x),
        minY: Math.min(o.start.y, p.y),
        maxX: Math.max(o.start.x, p.x),
        maxY: Math.max(o.start.y, p.y),
      });
      return;
    }
    const ids = new Set(o.ids);
    if (o.kind === 'move') {
      let dx = p.x - o.start.x;
      let dy = p.y - o.start.y;
      // Alignment guides, as on the boards: an edge or the middle of what
      // is carried settles onto another element's edge or middle when it
      // comes within a few points of it, and a pink line says so.
      const moving = unionBox(o.ids.map((i) => worldBoundsOf(o.base[i])));
      const others = o.base.filter((_, i) => !ids.has(i)).map(worldBoundsOf);
      let guideX: number | null = null;
      let guideY: number | null = null;
      if (moving && others.length) {
        const reach = GUIDE_SNAP_DISTANCE / view.s;
        const snap = (mine: number[], theirs: number[]) => {
          let best: { diff: number; at: number } | null = null;
          for (const m of mine)
            for (const t of theirs) {
              const diff = t - m;
              if (Math.abs(diff) < reach && (!best || Math.abs(diff) < Math.abs(best.diff))) best = { diff, at: t };
            }
          return best;
        };
        const mx = [moving.minX + dx, (moving.minX + moving.maxX) / 2 + dx, moving.maxX + dx];
        const my = [moving.minY + dy, (moving.minY + moving.maxY) / 2 + dy, moving.maxY + dy];
        const tx = others.flatMap((b) => [b.minX, (b.minX + b.maxX) / 2, b.maxX]);
        const ty = others.flatMap((b) => [b.minY, (b.minY + b.maxY) / 2, b.maxY]);
        const sx = snap(mx, tx);
        const sy = snap(my, ty);
        if (sx) {
          dx += sx.diff;
          guideX = sx.at;
        }
        if (sy) {
          dy += sy.diff;
          guideY = sy.at;
        }
      }
      setGuides(guideX === null && guideY === null ? null : { x: guideX, y: guideY });
      setElements(o.base.map((el, i) => (ids.has(i) ? translateElement(el, dx, dy) : el)));
      return;
    }
    if (o.kind === 'rotate') {
      const angle = Math.atan2(p.y - o.frame.pivot.y, p.x - o.frame.pivot.x);
      let delta = ((angle - o.startAngle) * 180) / Math.PI;
      // Settles onto a straight angle when close to one.
      const target = normalizeDeg(o.frame.rot + delta);
      const nearest = Math.round(target / 45) * 45;
      if (Math.abs(target - nearest) < 4) delta += nearest - target;
      setElements(o.base.map((el, i) => (ids.has(i) ? rotateElementAbout(el, delta, o.frame.pivot) : el)));
      return;
    }
    // Scaling: the grip follows the finger, the opposite side stays put.
    const { grip, frame } = o;
    const b = frame.box;
    const local = rotatePoint(p, frame.pivot, -frame.rot);
    const anchor = {
      x: grip.ax === 0 ? (b.minX + b.maxX) / 2 : grip.ax < 0 ? b.maxX : b.minX,
      y: grip.ay === 0 ? (b.minY + b.maxY) / 2 : grip.ay < 0 ? b.maxY : b.minY,
    };
    const span = (from: number, to: number, now: number) => {
      const whole = to - from;
      if (Math.abs(whole) < 1) return 1;
      return Math.max(0.05, (now - from) / whole);
    };
    let sx = grip.ax === 0 ? 1 : span(anchor.x, grip.x, local.x);
    let sy = grip.ay === 0 ? 1 : span(anchor.y, grip.y, local.y);
    if (o.ids.length > 1) {
      // Several at once grow and shrink together, keeping their shapes:
      // a stretch would have to skew the turned ones among them.
      const k = grip.ax === 0 ? sy : grip.ay === 0 ? sx : Math.max(sx, sy);
      sx = k;
      sy = k;
    }
    const worldAnchor = rotatePoint(anchor, frame.pivot, frame.rot);
    setElements(
      o.base.map((el, i) => {
        if (!ids.has(i)) return el;
        if (o.ids.length === 1) return scaleElement(el, sx, sy, anchor);
        const own = el.rot ? rotatePoint(worldAnchor, pivotOf(el), -el.rot) : worldAnchor;
        return scaleElement(el, sx, sy, own);
      })
    );
  }

  function selectEnd() {
    const o = op.current;
    op.current = null;
    setGuides(null);
    if (!o) return;
    if (o.kind === 'marquee') {
      setMarquee(null);
      const box = {
        minX: Math.min(o.start.x, o.current.x),
        minY: Math.min(o.start.y, o.current.y),
        maxX: Math.max(o.start.x, o.current.x),
        maxY: Math.max(o.start.y, o.current.y),
      };
      if (box.maxX - box.minX < 6 && box.maxY - box.minY < 6) return;
      setSelection(elements.map((el, i) => (intersects(worldBoundsOf(el), box) ? i : -1)).filter((i) => i !== -1));
      return;
    }
    // Something changed: one step back undoes the whole gesture.
    if (o.base !== elements) remember(o.base);
  }

  // ---- the canvas ----------------------------------------------------------------

  // A touch, as a point on the paper (the view's pan and zoom undone).
  // The canvas's own place on the screen is read off the same touch:
  // pageX minus locationX - every finger of a pinch is measured from it.
  const origin = useRef({ x: 0, y: 0 });
  function paperPoint(e: GestureResponderEvent): Point {
    const n = e.nativeEvent;
    origin.current = { x: n.pageX - n.locationX, y: n.pageY - n.locationY };
    return { x: (n.locationX - view.tx) / view.s, y: (n.locationY - view.ty) / view.s };
  }
  // Two fingers: the paper moves and zooms under them, and whatever one
  // finger had started is let go of.
  const pinch = useRef<{ c: Point; d: number; view: typeof view } | null>(null);
  function dropUnfinished() {
    setCurrentPoints([]);
    setShapeStart(null);
    setShapeCurrent(null);
    const o = op.current;
    if (o && o.kind !== 'marquee') setElements(o.base);
    op.current = null;
    setMarquee(null);
    setGuides(null);
  }
  function pinchMove(e: GestureResponderEvent): boolean {
    const touches = e.nativeEvent.touches;
    if (background || touches.length < 2) return false;
    const a = { x: touches[0].pageX - origin.current.x, y: touches[0].pageY - origin.current.y };
    const b = { x: touches[1].pageX - origin.current.x, y: touches[1].pageY - origin.current.y };
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    if (!pinch.current) {
      dropUnfinished();
      pinch.current = { c, d, view };
      return true;
    }
    const start = pinch.current;
    const nextS = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, start.view.s * (d / start.d)));
    // The paper point that was under the fingers' middle stays under it.
    const wx = (start.c.x - start.view.tx) / start.view.s;
    const wy = (start.c.y - start.view.ty) / start.view.s;
    setView({ s: nextS, tx: c.x - wx * nextS, ty: c.y - wy * nextS });
    return true;
  }

  function handleStart(e: GestureResponderEvent) {
    const { x: locationX, y: locationY } = paperPoint(e);
    if (tool === 'eraser') {
      eraseAt(locationX, locationY);
      return;
    }
    if (tool === 'select') {
      selectStart({ x: locationX, y: locationY });
      return;
    }
    if (tool === 'text') {
      setTextValue('');
      setPendingText({ x: locationX, y: locationY });
      return;
    }
    if (isShapeTool(tool)) {
      setShapeStart({ x: locationX, y: locationY });
      setShapeCurrent({ x: locationX, y: locationY });
      return;
    }
    setCurrentPoints([{ x: locationX, y: locationY }]);
  }

  function handleMove(e: GestureResponderEvent) {
    if (pinchMove(e) || pinch.current) return;
    const { x: locationX, y: locationY } = paperPoint(e);
    if (tool === 'eraser') {
      eraseAt(locationX, locationY);
      return;
    }
    if (tool === 'select') {
      selectMove({ x: locationX, y: locationY });
      return;
    }
    if (tool === 'text') return;
    if (isShapeTool(tool)) {
      setShapeCurrent({ x: locationX, y: locationY });
      return;
    }
    setCurrentPoints((prev) => [...prev, { x: locationX, y: locationY }]);
  }

  function handleEnd() {
    erasing.current = false;
    if (pinch.current) {
      pinch.current = null;
      return;
    }
    if (tool === 'select') {
      selectEnd();
      return;
    }
    if (isShapeTool(tool)) {
      if (shapeStart && shapeCurrent && (shapeStart.x !== shapeCurrent.x || shapeStart.y !== shapeCurrent.y)) {
        const shape: SketchShape = {
          kind: tool,
          x1: shapeStart.x,
          y1: shapeStart.y,
          x2: shapeCurrent.x,
          y2: shapeCurrent.y,
        };
        remember();
        const closed = shape.kind === 'rect' || shape.kind === 'circle';
        const made: SketchElement = {
          ...shapeElement(shape, color, strokeWidth),
          ...(closed && shapeFill ? { fill: shapeFill } : {}),
          ...(closed && !shapeStroke ? { noStroke: true } : {}),
        };
        setElements((prev) => [...prev, made]);
        // A shape with words: the field opens for them straight away.
        if (closed && shapeWithText) {
          setTextValue('');
          setLabelFor(elements.length);
        }
      }
      setShapeStart(null);
      setShapeCurrent(null);
      return;
    }
    if (currentPoints.length > 1) {
      remember();
      const d = pointsToPath(currentPoints);
      setElements((els) => [...els, { kind: 'path', d, color, width: strokeWidth }]);
    }
    setCurrentPoints([]);
  }

  function commitText() {
    const value = textValue.trim();
    if (labelFor !== null) {
      const index = labelFor;
      const el = elements[index];
      if (el && el.kind === 'path' && (el.label ?? '') !== value) {
        remember();
        const next = { ...el } as SketchPathElement;
        if (value) next.label = value;
        else delete next.label;
        setElements(elements.map((e, i) => (i === index ? next : e)));
      }
      setLabelFor(null);
      setTextValue('');
      return;
    }
    if (pendingText && value) {
      remember();
      setElements((els) => [
        ...els,
        { kind: 'text', x: pendingText.x, y: pendingText.y, text: value, color, fontSize: TEXT_FONT_SIZE },
      ]);
    }
    setPendingText(null);
    setTextValue('');
  }

  // The whole drawing on the screen, clear of the bars above and below -
  // or, with nothing drawn, the paper as it first lay.
  function fitView(els: SketchElement[] = elements) {
    const box = drawingViewBox(els, 24);
    if (!box || canvasSize.width === 0) {
      setView({ tx: 0, ty: 0, s: 1 });
      return;
    }
    const top = insets.top + 72;
    const bottom = insets.bottom + 90;
    const roomH = Math.max(1, canvasSize.height - top - bottom);
    const s = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(1, canvasSize.width / box.width, roomH / box.height)));
    setView({
      s,
      tx: (canvasSize.width - box.width * s) / 2 - box.x * s,
      ty: top + (roomH - box.height * s) / 2 - box.y * s,
    });
  }

  // One step back, whatever the step was.
  function undo() {
    const before = history.current.pop();
    if (!before) return;
    setSelection([]);
    setElements(before);
  }

  // With something chosen, the bin takes just that; otherwise everything.
  function removeChosenOrAll() {
    if (elements.length === 0) return;
    remember();
    if (selection.length) {
      const gone = new Set(selection);
      setElements(elements.filter((_, i) => !gone.has(i)));
    } else setElements([]);
    setSelection([]);
  }

  function selectTool(t: Tool) {
    if (t !== 'select') setSelection([]);
    setTool(t);
  }

  function selectColor(c: string) {
    setColor(c);
    // Recolour whatever is chosen, so the palette also works as "change
    // this one's colour" rather than only affecting the next thing drawn.
    if (selection.length) {
      remember();
      const chosen = new Set(selection);
      setElements(elements.map((el, i) => (chosen.has(i) && el.kind !== 'image' ? { ...el, color: c } : el)));
    }
  }

  // ---- pictures ---------------------------------------------------------------

  // The latest elements, for the moment «Готово» waits on a backup.
  const elementsRef = useRef(elements);
  elementsRef.current = elements;
  // Gallery pictures still on their way to Drive: «Готово» waits a little
  // for them, so the drawing is saved knowing where its backup is.
  const uploads = useRef(new Set<Promise<void>>());
  const [photoPickerOpen, setPhotoPickerOpen] = useState(false);

  // Laid in the middle of what is on screen, a comfortable size, chosen -
  // so it can be moved and sized straight away.
  function placePicture(uri: string, driveFileId: string | undefined, aspect: number) {
    const w = Math.min(canvasSize.width * 0.6, 320) / view.s;
    const h = w / (aspect > 0 ? aspect : 4 / 3);
    const cx = (canvasSize.width / 2 - view.tx) / view.s;
    const cy = (canvasSize.height / 2 - view.ty) / view.s;
    const picture: SketchImageElement = { kind: 'image', x: cx - w / 2, y: cy - h / 2, w, h, uri };
    if (driveFileId) picture.driveFileId = driveFileId;
    remember();
    setElements((prev) => {
      setSelection([prev.length]);
      return [...prev, picture];
    });
    setTool('select');
  }
  function sizeOf(uri: string): Promise<number> {
    return new Promise((resolve) => Image.getSize(uri, (w, h) => resolve(w > 0 && h > 0 ? w / h : 4 / 3), () => resolve(4 / 3)));
  }

  async function addPicture() {
    const from = await ask({
      title: 'Зображення',
      actions: [
        { id: 'gallery', label: 'З галереї телефону', icon: 'images-outline' },
        { id: 'photos', label: 'Із «Зображень»', icon: 'image-outline' },
      ],
    });
    if (from === 'photos') {
      setPhotoPickerOpen(true);
      return;
    }
    if (from !== 'gallery') return;
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.85 });
    if (picked.canceled || picked.assets.length === 0) return;
    const asset = picked.assets[0];
    // A copy of the drawing's own (the picker's address can be taken back
    // by the app that gave it), backed up to Drive like any attachment -
    // and NOT a record in «Зображення».
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    // (A browser has no cache folder to copy into: there the picked
    // address is all there is.)
    const uri = LegacyFileSystem.cacheDirectory ? `${LegacyFileSystem.cacheDirectory}sketch-${id}.jpg` : asset.uri;
    if (uri !== asset.uri) await LegacyFileSystem.copyAsync({ from: asset.uri, to: uri });
    const aspect = asset.width && asset.height ? asset.width / asset.height : await sizeOf(uri);
    placePicture(uri, undefined, aspect);
    const upload = backupFileToDrive(uri, `sketch-${id}.jpg`, asset.mimeType || 'image/jpeg', 'Photos').then((done) => {
      if (done) {
        setElements((prev) => prev.map((el) => (el.kind === 'image' && el.uri === uri ? { ...el, driveFileId: done.fileId } : el)));
        elementsRef.current = elementsRef.current.map((el) =>
          el.kind === 'image' && el.uri === uri ? { ...el, driveFileId: done.fileId } : el
        );
      }
    });
    uploads.current.add(upload);
    upload.finally(() => uploads.current.delete(upload));
  }

  async function finish() {
    if (uploads.current.size) {
      await Promise.race([Promise.all([...uploads.current]), new Promise((r) => setTimeout(r, 6000))]);
    }
    onSave(elementsRef.current, canvasSize.width, canvasSize.height);
  }

  // The closed shapes among the chosen ones.
  const chosenShapes = selection.filter((i) => elements[i] && isClosedShape(elements[i]));
  const shapePanelShown = tool === 'rect' || tool === 'circle' || chosenShapes.length > 0;
  // One shape chosen: the panel shows ITS fill and outline.
  const oneShape = chosenShapes.length === 1 ? elements[chosenShapes[0]] : null;
  const oneFill = oneShape && oneShape.kind === 'path' ? oneShape.fill ?? null : undefined;
  const oneStroke = oneShape && oneShape.kind === 'path' ? !oneShape.noStroke : undefined;
  useEffect(() => {
    if (oneFill !== undefined) setShapeFill(oneFill);
    if (oneStroke !== undefined) setShapeStroke(oneStroke);
  }, [oneFill, oneStroke]);
  function changeChosenShapes(change: (el: SketchPathElement) => SketchPathElement) {
    if (chosenShapes.length === 0) return;
    remember();
    const set = new Set(chosenShapes);
    setElements(elements.map((el, i) => (set.has(i) && el.kind === 'path' ? change(el) : el)));
  }
  function chooseFill(c: string | null) {
    setShapeFill(c);
    changeChosenShapes((el) => {
      const next = { ...el };
      if (c) next.fill = c;
      else {
        delete next.fill;
        // Neither outline nor inside would be nothing at all.
        delete next.noStroke;
      }
      return next;
    });
  }
  function toggleStroke() {
    const on = !shapeStroke;
    setShapeStroke(on);
    if (!on && !shapeFill) setShapeFill(color);
    changeChosenShapes((el) => {
      const next = { ...el };
      if (on) delete next.noStroke;
      else {
        next.noStroke = true;
        if (!next.fill) next.fill = el.color;
      }
      return next;
    });
  }
  function writeLabel() {
    if (chosenShapes.length === 1) {
      const el = elements[chosenShapes[0]];
      setTextValue(el.kind === 'path' ? el.label ?? '' : '');
      setLabelFor(chosenShapes[0]);
      setShapePanelOpen(false);
    } else setShapeWithText((v) => !v);
  }

  const previewShape: SketchShape | null =
    isShapeTool(tool) && shapeStart && shapeCurrent
      ? { kind: tool, x1: shapeStart.x, y1: shapeStart.y, x2: shapeCurrent.x, y2: shapeCurrent.y }
      : null;
  // One screen point, on the paper (see MIN_ZOOM).
  const k = 1 / view.s;
  // The chosen ones' box, only while the select tool is in hand.
  const frame = tool === 'select' ? frameOf(elements, selection) : null;
  const danger = S.dark ? '#FF7A6E' : '#C8452F';
  const shown = (c: string) => inkOn(c, paperInk);
  const round = { backgroundColor: S.card, boxShadow: S.shadow };

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <View style={[styles.container, { backgroundColor: background ? '#111' : paperFill }]}>
        <View
          style={background ? styles.canvasStage : styles.canvasFill}
          onLayout={(e) => setStage({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
        >
          <View
            style={[styles.canvas, background && { flex: 0, width: fitted.width, height: fitted.height }]}
            onLayout={handleCanvasLayout}
            onStartShouldSetResponder={() => true}
            onMoveShouldSetResponder={() => true}
            onResponderGrant={handleStart}
            onResponderMove={handleMove}
            onResponderRelease={handleEnd}
          >
            {!!background && <Image source={{ uri: background.uri }} style={StyleSheet.absoluteFill} resizeMode="cover" />}
            <Svg style={StyleSheet.absoluteFill}>
              <G transform={`translate(${view.tx} ${view.ty}) scale(${view.s})`}>
                <SketchLayer elements={elements} ink={paperInk} />
                {currentPoints.length > 1 && (
                  <Path
                    d={pointsToPath(currentPoints)}
                    stroke={shown(color)}
                    strokeWidth={strokeWidth}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {previewShape && (
                  <Path
                    d={shapeToPath(previewShape, strokeWidth)}
                    stroke={shown(color)}
                    strokeWidth={strokeWidth}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )}
                {/* Several chosen: each one's own outline, faint, inside the
                    box that holds them all. */}
                {frame &&
                  selection.length > 1 &&
                  selection.map((i) => {
                    const el = elements[i];
                    if (!el) return null;
                    const ob = boundsOf(el);
                    const op2 = pivotOf(el);
                    return (
                      <G key={`o${i}`} transform={el.rot ? `rotate(${el.rot} ${op2.x} ${op2.y})` : undefined}>
                        <Rect
                          x={ob.minX - 3}
                          y={ob.minY - 3}
                          width={ob.maxX - ob.minX + 6}
                          height={ob.maxY - ob.minY + 6}
                          stroke={S.accent}
                          strokeOpacity={0.45}
                          strokeWidth={1 * k}
                          fill="none"
                          rx={4}
                        />
                      </G>
                    );
                  })}
                {frame && (
                  <G transform={frame.rot ? `rotate(${frame.rot} ${frame.pivot.x} ${frame.pivot.y})` : undefined}>
                    <Rect
                      x={frame.box.minX}
                      y={frame.box.minY}
                      width={frame.box.maxX - frame.box.minX}
                      height={frame.box.maxY - frame.box.minY}
                      stroke={S.accent}
                      strokeWidth={1.5 * k}
                      fill="none"
                    />
                    {/* The turning grip, on a short arm above the top. */}
                    <Path
                      d={`M${(frame.box.minX + frame.box.maxX) / 2} ${frame.box.minY} L${(frame.box.minX + frame.box.maxX) / 2} ${frame.box.minY - (ROTATE_ARM - 9) * k}`}
                      stroke={S.accent}
                      strokeWidth={1.5 * k}
                    />
                    <Circle
                      cx={(frame.box.minX + frame.box.maxX) / 2}
                      cy={frame.box.minY - ROTATE_ARM * k}
                      r={9 * k}
                      fill={S.card}
                      stroke={S.accent}
                      strokeWidth={2 * k}
                    />
                    {gripsOf(frame.box).map((g, i) => (
                      <Rect
                        key={`g${i}`}
                        x={g.x - (HANDLE * k) / 2}
                        y={g.y - (HANDLE * k) / 2}
                        width={HANDLE * k}
                        height={HANDLE * k}
                        rx={3 * k}
                        fill={S.card}
                        stroke={S.accent}
                        strokeWidth={2 * k}
                      />
                    ))}
                  </G>
                )}
                {marquee && (
                  <Rect
                    x={marquee.minX}
                    y={marquee.minY}
                    width={marquee.maxX - marquee.minX}
                    height={marquee.maxY - marquee.minY}
                    stroke={S.accent}
                    strokeWidth={1 * k}
                    strokeDasharray={`${5 * k} ${4 * k}`}
                    fill={S.accent}
                    fillOpacity={0.08}
                    rx={4}
                  />
                )}
                {/* The alignment guides, across the whole visible paper. */}
                {guides?.x != null && (
                  <Path
                    d={`M${guides.x} ${-view.ty / view.s} L${guides.x} ${(canvasSize.height - view.ty) / view.s}`}
                    stroke={GUIDE_COLOR}
                    strokeWidth={1 * k}
                    strokeDasharray={`${6 * k} ${4 * k}`}
                  />
                )}
                {guides?.y != null && (
                  <Path
                    d={`M${-view.tx / view.s} ${guides.y} L${(canvasSize.width - view.tx) / view.s} ${guides.y}`}
                    stroke={GUIDE_COLOR}
                    strokeWidth={1 * k}
                    strokeDasharray={`${6 * k} ${4 * k}`}
                  />
                )}
              </G>
            </Svg>
          </View>
        </View>

        {/* THE TOP: three soft pieces floating over the paper - the way
            out, what undoes, and «Готово» - instead of a white strip with
            a hairline under it. */}
        <View style={[styles.top, { top: insets.top + 10 }]} pointerEvents="box-none">
          <Pressable hitSlop={6} onPress={onClose} style={[styles.roundButton, round]}>
            <Ionicons name={'lc:x' as never} size={20} color={S.ink} />
          </Pressable>
          <View style={[styles.capsule, round]}>
            <Pressable hitSlop={6} onPress={undo} disabled={history.current.length === 0} style={styles.capsuleButton}>
              <Ionicons name={'lc:undo-2' as never} size={19} color={history.current.length ? S.ink : S.ink3} />
            </Pressable>
            <View style={[styles.capsuleDivider, { backgroundColor: S.line }]} />
            {/* Moved or zoomed: how far, and a tap brings the whole
                drawing back into view. */}
            {(view.s !== 1 || view.tx !== 0 || view.ty !== 0) && (
              <>
                <Pressable hitSlop={6} onPress={() => fitView()} style={styles.zoomButton}>
                  <Text style={[styles.zoomLabel, { color: S.ink2 }]}>{Math.round(view.s * 100)}%</Text>
                </Pressable>
                <View style={[styles.capsuleDivider, { backgroundColor: S.line }]} />
              </>
            )}
            {/* With something chosen, it takes just that. */}
            <Pressable hitSlop={6} onPress={removeChosenOrAll} disabled={elements.length === 0} style={styles.capsuleButton}>
              <Ionicons name={'lc:trash' as never} size={19} color={elements.length ? danger : S.ink3} />
            </Pressable>
          </View>
          <Pressable
            hitSlop={6}
            onPress={finish}
            style={[styles.roundButton, { backgroundColor: S.ink, boxShadow: S.shadow }]}
          >
            <Ionicons name={'lc:check' as never} size={21} color={S.card} />
          </Pressable>
        </View>

        {/* THE TOOLS: one soft pill that floats and goes where the hand
            puts it; the colour is a single dot that opens the palette
            above it. */}
        {paletteOpen && (
          <RNAnimated.View
            style={[
              styles.palette,
              { bottom: insets.bottom + 84, backgroundColor: S.card, boxShadow: S.popShadow, transform: barPan.getTranslateTransform() },
            ]}
          >
            <View style={styles.paletteRow}>
              {COLORS.map((c) => (
                <Pressable
                  key={c}
                  hitSlop={4}
                  onPress={() => {
                    selectColor(c);
                    setPaletteOpen(false);
                  }}
                  style={[styles.swatchRing, color === c && { borderColor: S.ink2 }]}
                >
                  <View style={[styles.swatch, { backgroundColor: shown(c) }, shown(c) === S.card && { borderWidth: 1, borderColor: S.line }]} />
                </Pressable>
              ))}
            </View>
            <View style={styles.paletteRow}>
              {WIDTHS.map((w) => (
                <Pressable
                  key={w}
                  hitSlop={4}
                  onPress={() => setStrokeWidth(w)}
                  style={[styles.widthButton, strokeWidth === w && { backgroundColor: S.fill }]}
                >
                  <View style={{ width: w * 2, height: w * 2, borderRadius: w, backgroundColor: S.ink }} />
                </Pressable>
              ))}
            </View>
          </RNAnimated.View>
        )}
        {shapePanelOpen && shapePanelShown && (
          <RNAnimated.View
            style={[
              styles.palette,
              { bottom: insets.bottom + 84, backgroundColor: S.card, boxShadow: S.popShadow, transform: barPan.getTranslateTransform() },
            ]}
          >
            {/* The inside: none, or one of the colours as a soft tint. */}
            <View style={styles.paletteRow}>
              <Pressable
                hitSlop={4}
                onPress={() => chooseFill(null)}
                style={[styles.swatchRing, shapeFill === null && { borderColor: S.ink2 }]}
              >
                <View style={[styles.swatch, styles.swatchEmpty, { borderColor: S.line }]}>
                  <Ionicons name={'lc:x' as never} size={14} color={S.ink3} />
                </View>
              </Pressable>
              {COLORS.map((c) => (
                <Pressable
                  key={c}
                  hitSlop={4}
                  onPress={() => chooseFill(c)}
                  style={[styles.swatchRing, shapeFill === c && { borderColor: S.ink2 }]}
                >
                  <View style={[styles.swatch, { backgroundColor: shown(c), opacity: 0.45 }]} />
                </Pressable>
              ))}
            </View>
            <View style={styles.paletteRow}>
              <Pressable
                onPress={toggleStroke}
                style={[styles.shapeToggle, { backgroundColor: shapeStroke ? S.ink : S.fill }]}
              >
                <Ionicons name={'lc:square' as never} size={16} color={shapeStroke ? S.card : S.ink2} />
                <Text style={[styles.shapeToggleLabel, { color: shapeStroke ? S.card : S.ink2 }]}>Рамка</Text>
              </Pressable>
              <Pressable
                onPress={writeLabel}
                style={[
                  styles.shapeToggle,
                  { backgroundColor: chosenShapes.length !== 1 && shapeWithText ? S.ink : S.fill },
                ]}
              >
                <Ionicons
                  name={'lc:type' as never}
                  size={16}
                  color={chosenShapes.length !== 1 && shapeWithText ? S.card : S.ink2}
                />
                <Text
                  style={[
                    styles.shapeToggleLabel,
                    { color: chosenShapes.length !== 1 && shapeWithText ? S.card : S.ink2 },
                  ]}
                >
                  {chosenShapes.length === 1 ? 'Текст у фігурі' : 'З текстом'}
                </Text>
              </Pressable>
            </View>
          </RNAnimated.View>
        )}
        <RNAnimated.View
          style={[
            styles.toolbar,
            { bottom: insets.bottom + 14, backgroundColor: S.card, boxShadow: S.popShadow, transform: barPan.getTranslateTransform() },
          ]}
          {...barDrag.panHandlers}
        >
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tools}>
            {TOOLS.map(({ tool: t, icon }) => (
              <Pressable
                key={t}
                hitSlop={4}
                style={[styles.tool, tool === t && { backgroundColor: S.ink }]}
                onPress={() => selectTool(t)}
              >
                <Ionicons name={icon as never} size={19} color={tool === t ? S.card : S.ink2} />
              </Pressable>
            ))}
            {/* A picture: from the gallery, or from «Зображення». Not on a
                photograph, which already is one. */}
            {!background && (
              <Pressable hitSlop={4} style={styles.tool} onPress={addPicture}>
                <Ionicons name={'lc:image-plus' as never} size={19} color={S.ink2} />
              </Pressable>
            )}
          </ScrollView>
          <View style={[styles.toolbarDivider, { backgroundColor: S.line }]} />
          <Pressable
            hitSlop={6}
            onPress={() => {
              setShapePanelOpen(false);
              setPaletteOpen((open) => !open);
            }}
            style={styles.tool}
          >
            <View style={[styles.colorDot, { backgroundColor: shown(color), borderColor: S.line }]} />
          </Pressable>
          {/* The shape's own settings - only while a rectangle or circle
              is in hand, or one is chosen. */}
          {shapePanelShown && (
            <Pressable
              hitSlop={6}
              onPress={() => {
                setPaletteOpen(false);
                setShapePanelOpen((open) => !open);
              }}
              style={[styles.tool, shapePanelOpen && { backgroundColor: S.fill }]}
            >
              <Ionicons name={'lc:paint-bucket' as never} size={19} color={S.ink2} />
            </Pressable>
          )}
        </RNAnimated.View>

        <AddExistingItemModal
          visible={photoPickerOpen}
          allowedTabs={['photo']}
          onPick={(block) => {
            setPhotoPickerOpen(false);
            if (!block.imageUri) return;
            const uri = block.imageUri;
            sizeOf(uri).then((aspect) => placePicture(uri, block.driveFileId, aspect));
          }}
          onClose={() => setPhotoPickerOpen(false)}
        />

        {(pendingText || labelFor !== null) && (
          <View style={styles.textBackdrop}>
            <View style={[styles.textCard, { backgroundColor: S.card, boxShadow: S.popShadow }]}>
              <Text style={[styles.textTitle, { color: S.ink }]}>{labelFor !== null ? 'Текст у фігурі' : 'Текст'}</Text>
              <TextInput
                autoFocus
                value={textValue}
                onChangeText={setTextValue}
                onSubmitEditing={commitText}
                placeholder="Текст…"
                placeholderTextColor={S.ink3}
                style={[styles.textInput, { color: S.ink, backgroundColor: S.fill }]}
              />
              <View style={styles.textButtons}>
                <Pressable
                  style={styles.textCancel}
                  onPress={() => {
                    setPendingText(null);
                    setLabelFor(null);
                    setTextValue('');
                  }}
                >
                  <Text style={[styles.textCancelLabel, { color: S.ink2 }]}>Скасувати</Text>
                </Pressable>
                <Pressable
                  style={[styles.textSave, { backgroundColor: S.ink }, !textValue.trim() && labelFor === null && { opacity: 0.35 }]}
                  disabled={!textValue.trim() && labelFor === null}
                  onPress={commitText}
                >
                  <Text style={[styles.textSaveLabel, { color: S.card }]}>Додати</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </View>
    </Modal>
  );
}

const ROUND = 46;
const TOOL = 40;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  canvas: {
    flex: 1,
  },
  // Drawing on a photograph, the canvas is the PICTURE's box - centred
  // in what is left of the screen, with the dark around it so the edges
  // of the photo are plain to see.
  canvasStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  canvasFill: {
    flex: 1,
  },
  top: {
    position: 'absolute',
    left: 14,
    right: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  roundButton: {
    width: ROUND,
    height: ROUND,
    borderRadius: ROUND / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  capsule: {
    height: ROUND,
    borderRadius: ROUND / 2,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 6,
  },
  capsuleButton: {
    width: 44,
    height: ROUND,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomButton: {
    minWidth: 52,
    height: 46,
    paddingHorizontal: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  zoomLabel: {
    fontSize: 13,
    fontFamily: SOFT_MEDIUM,
    fontVariant: ['tabular-nums'],
  },
  capsuleDivider: {
    width: StyleSheet.hairlineWidth,
    height: 20,
  },
  toolbar: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '92%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    padding: 6,
    borderRadius: 28,
  },
  tools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  tool: {
    width: TOOL,
    height: TOOL,
    borderRadius: TOOL / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  toolbarDivider: {
    width: StyleSheet.hairlineWidth,
    height: 22,
    marginHorizontal: 4,
  },
  colorDot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 1,
  },
  palette: {
    position: 'absolute',
    alignSelf: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 24,
  },
  paletteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  swatchRing: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 2,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  swatch: {
    width: 24,
    height: 24,
    borderRadius: 12,
  },
  swatchEmpty: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shapeToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 14,
    borderRadius: 18,
  },
  shapeToggleLabel: {
    fontSize: 14,
    fontFamily: SOFT_MEDIUM,
  },
  widthButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  textBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.25)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  textCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 24,
    padding: 20,
    gap: 14,
  },
  textTitle: {
    fontSize: 17,
    fontFamily: SOFT_SEMIBOLD,
  },
  textInput: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: SOFT_REGULAR,
  },
  textButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 10,
  },
  textCancel: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  textCancelLabel: {
    fontSize: 15,
    fontFamily: SOFT_MEDIUM,
  },
  textSave: {
    borderRadius: 20,
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  textSaveLabel: {
    fontSize: 15,
    fontFamily: SOFT_SEMIBOLD,
  },
});
