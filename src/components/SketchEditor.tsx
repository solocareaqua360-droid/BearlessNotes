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
import { SketchElement, SketchPathElement, SketchShape } from '../types';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { useSoft } from '../theme/soft';
import { useTheme } from '../theme/ThemeProvider';
import {
  INK,
  boundsOf,
  inkOn,
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
const WIDTHS = [3, 6, 10];
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
function elementAt(elements: SketchElement[], p: Point): number {
  const PAD = 12;
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
  if (!el.rot || el.kind === 'text') return el;
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
function eraseFromElement(el: SketchElement, x: number, y: number): SketchElement[] {
  if (el.kind === 'text') {
    const local = el.rot ? rotatePoint({ x, y }, pivotOf(el), -el.rot) : { x, y };
    const b = boundsOf(el);
    const hit = local.x >= b.minX - 8 && local.x <= b.maxX + 8 && local.y >= b.minY - 8 && local.y <= b.maxY + 8;
    return hit ? [] : [el];
  }
  const points = parsePathPoints(el.d);
  const near = (p: Point) => Math.hypot(p.x - x, p.y - y) < ERASE_RADIUS;
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
      setTextValue('');
      setSelection([]);
      op.current = null;
      setMarquee(null);
      history.current = [];
      setTool('pen');
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
    setElements((prev) => prev.flatMap((el) => eraseFromElement(el, x, y)));
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
      if (Math.hypot(local.x - mx, local.y - (b.minY - ROTATE_ARM)) < HANDLE_TOUCH_RADIUS) {
        op.current = {
          kind: 'rotate',
          startAngle: Math.atan2(p.y - frame.pivot.y, p.x - frame.pivot.x),
          frame,
          base: elements,
          ids: selection,
        };
        return;
      }
      const grip = gripsOf(b).find((g) => Math.hypot(local.x - g.x, local.y - g.y) < HANDLE_TOUCH_RADIUS);
      if (grip) {
        op.current = { kind: 'scale', grip, frame, base: elements, ids: selection };
        return;
      }
      if (local.x >= b.minX && local.x <= b.maxX && local.y >= b.minY && local.y <= b.maxY) {
        op.current = { kind: 'move', start: p, base: elements, ids: selection };
        return;
      }
    }
    const hit = elementAt(elements, p);
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
      const dx = p.x - o.start.x;
      const dy = p.y - o.start.y;
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

  function handleStart(e: GestureResponderEvent) {
    const { locationX, locationY } = e.nativeEvent;
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
    const { locationX, locationY } = e.nativeEvent;
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
        setElements((prev) => [...prev, shapeElement(shape, color, strokeWidth)]);
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
      setElements(elements.map((el, i) => (chosen.has(i) ? { ...el, color: c } : el)));
    }
  }

  const previewShape: SketchShape | null =
    isShapeTool(tool) && shapeStart && shapeCurrent
      ? { kind: tool, x1: shapeStart.x, y1: shapeStart.y, x2: shapeCurrent.x, y2: shapeCurrent.y }
      : null;
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
                        strokeWidth={1}
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
                    strokeWidth={1.5}
                    fill="none"
                  />
                  {/* The turning grip, on a short arm above the top. */}
                  <Path
                    d={`M${(frame.box.minX + frame.box.maxX) / 2} ${frame.box.minY} L${(frame.box.minX + frame.box.maxX) / 2} ${frame.box.minY - ROTATE_ARM + 9}`}
                    stroke={S.accent}
                    strokeWidth={1.5}
                  />
                  <Circle
                    cx={(frame.box.minX + frame.box.maxX) / 2}
                    cy={frame.box.minY - ROTATE_ARM}
                    r={9}
                    fill={S.card}
                    stroke={S.accent}
                    strokeWidth={2}
                  />
                  {gripsOf(frame.box).map((g, i) => (
                    <Rect
                      key={`g${i}`}
                      x={g.x - HANDLE / 2}
                      y={g.y - HANDLE / 2}
                      width={HANDLE}
                      height={HANDLE}
                      rx={3}
                      fill={S.card}
                      stroke={S.accent}
                      strokeWidth={2}
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
                  strokeWidth={1}
                  strokeDasharray="5 4"
                  fill={S.accent}
                  fillOpacity={0.08}
                  rx={4}
                />
              )}
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
            {/* With something chosen, it takes just that. */}
            <Pressable hitSlop={6} onPress={removeChosenOrAll} disabled={elements.length === 0} style={styles.capsuleButton}>
              <Ionicons name={'lc:trash' as never} size={19} color={elements.length ? danger : S.ink3} />
            </Pressable>
          </View>
          <Pressable
            hitSlop={6}
            onPress={() => onSave(elements, canvasSize.width, canvasSize.height)}
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
          </ScrollView>
          <View style={[styles.toolbarDivider, { backgroundColor: S.line }]} />
          <Pressable hitSlop={6} onPress={() => setPaletteOpen((open) => !open)} style={styles.tool}>
            <View style={[styles.colorDot, { backgroundColor: shown(color), borderColor: S.line }]} />
          </Pressable>
        </RNAnimated.View>

        {pendingText && (
          <View style={styles.textBackdrop}>
            <View style={[styles.textCard, { backgroundColor: S.card, boxShadow: S.popShadow }]}>
              <Text style={[styles.textTitle, { color: S.ink }]}>Текст</Text>
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
                    setTextValue('');
                  }}
                >
                  <Text style={[styles.textCancelLabel, { color: S.ink2 }]}>Скасувати</Text>
                </Pressable>
                <Pressable
                  style={[styles.textSave, { backgroundColor: S.ink }, !textValue.trim() && { opacity: 0.35 }]}
                  disabled={!textValue.trim()}
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
