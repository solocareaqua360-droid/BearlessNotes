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
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { SketchElement, SketchPathElement, SketchShape } from '../types';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { useSoft } from '../theme/soft';
import { useTheme } from '../theme/ThemeProvider';
import { INK, boundsOf, inkOn, parsePathPoints } from '../utils/sketchGeometry';

// The first is the paper's own ink (see sketchGeometry's INK).
const COLORS = [INK, '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6'];
const WIDTHS = [3, 6, 10];
const TEXT_FONT_SIZE = 22;
// How close a touch has to land to a stroke's points to rub them out. The
// eraser removes just the points it passes over (splitting what's left
// into separate strokes), rather than the whole element - erasing a whole
// stroke is what plain "undo" already does.
const ERASE_RADIUS = 18;
const HANDLE_RADIUS = 8;
const HANDLE_TOUCH_RADIUS = 22;

type Point = { x: number; y: number };
type Tool = 'pen' | 'line' | 'arrow' | 'rect' | 'circle' | 'text' | 'select' | 'eraser';
type ShapeTool = SketchShape['kind'];

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

function pointsToPath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

// A shape is stored by its two defining points (plus its kind) rather than
// only as a finished path, so it can still be moved and resized afterwards
// - `d` is just regenerated from them each time.
function shapeToPath(shape: SketchShape, strokeWidth: number): string {
  const { kind, x1, y1, x2, y2 } = shape;
  if (kind === 'line') return `M${x1} ${y1} L${x2} ${y2}`;
  if (kind === 'arrow') {
    const angle = Math.atan2(y2 - y1, x2 - x1);
    const head = Math.max(14, strokeWidth * 4);
    const spread = Math.PI / 7;
    const hx1 = x2 - head * Math.cos(angle - spread);
    const hy1 = y2 - head * Math.sin(angle - spread);
    const hx2 = x2 - head * Math.cos(angle + spread);
    const hy2 = y2 - head * Math.sin(angle + spread);
    return `M${x1} ${y1} L${x2} ${y2} M${hx1} ${hy1} L${x2} ${y2} L${hx2} ${hy2}`;
  }
  if (kind === 'rect') {
    return `M${x1} ${y1} L${x2} ${y1} L${x2} ${y2} L${x1} ${y2} L${x1} ${y1}`;
  }
  // Circle as a 32-sided polygon rather than a true SVG arc: visually
  // indistinguishable at these stroke widths, and it keeps the path made
  // of plain points so the eraser and hit tests work on it unchanged.
  const r = Math.hypot(x2 - x1, y2 - y1) || 1;
  const points: Point[] = [];
  for (let i = 0; i <= 32; i++) {
    const angle = (i / 32) * Math.PI * 2;
    points.push({ x: x1 + r * Math.cos(angle), y: y1 + r * Math.sin(angle) });
  }
  return pointsToPath(points);
}

function shapeElement(shape: SketchShape, color: string, width: number): SketchPathElement {
  return { kind: 'path', d: shapeToPath(shape, width), color, width, shape };
}

// Where the resize grips sit for a selected shape. A line/arrow grabs by
// its two ends, a rectangle by its corners, a circle by one point on its
// rim (its centre is the anchor).
function shapeHandles(shape: SketchShape): Point[] {
  const { kind, x1, y1, x2, y2 } = shape;
  if (kind === 'rect') {
    return [
      { x: x1, y: y1 },
      { x: x2, y: y1 },
      { x: x2, y: y2 },
      { x: x1, y: y2 },
    ];
  }
  if (kind === 'circle') {
    const r = Math.hypot(x2 - x1, y2 - y1) || 1;
    return [{ x: x1 + r, y: y1 }];
  }
  return [
    { x: x1, y: y1 },
    { x: x2, y: y2 },
  ];
}

function resizeShape(shape: SketchShape, handleIndex: number, p: Point): SketchShape {
  if (shape.kind === 'rect') {
    if (handleIndex === 0) return { ...shape, x1: p.x, y1: p.y };
    if (handleIndex === 1) return { ...shape, x2: p.x, y1: p.y };
    if (handleIndex === 2) return { ...shape, x2: p.x, y2: p.y };
    return { ...shape, x1: p.x, y2: p.y };
  }
  if (shape.kind === 'circle') return { ...shape, x2: p.x, y2: p.y };
  if (handleIndex === 0) return { ...shape, x1: p.x, y1: p.y };
  return { ...shape, x2: p.x, y2: p.y };
}

function moveShape(shape: SketchShape, dx: number, dy: number): SketchShape {
  return { ...shape, x1: shape.x1 + dx, y1: shape.y1 + dy, x2: shape.x2 + dx, y2: shape.y2 + dy };
}

// Only shapes and text can be picked up - a freehand pen stroke stays
// where it was drawn (moving those was explicitly not wanted).
function isSelectable(el: SketchElement): boolean {
  return el.kind === 'text' || el.shape !== undefined;
}

function selectableIndexAt(elements: SketchElement[], x: number, y: number): number {
  const PAD = 14;
  for (let i = elements.length - 1; i >= 0; i--) {
    const el = elements[i];
    if (!isSelectable(el)) continue;
    const b = boundsOf(el);
    if (x >= b.minX - PAD && x <= b.maxX + PAD && y >= b.minY - PAD && y <= b.maxY + PAD) return i;
  }
  return -1;
}

// Rubs out just the points the eraser passed over: what's left of a stroke
// is split into separate strokes, so wiping the middle of a line leaves
// its two ends behind instead of deleting the whole thing. A shape that
// gets partly rubbed out loses its shape data (it's no longer a clean
// rectangle/circle) and carries on as a plain path.
function eraseFromElement(el: SketchElement, x: number, y: number): SketchElement[] {
  if (el.kind === 'text') {
    const b = boundsOf(el);
    const hit = x >= b.minX - 8 && x <= b.maxX + 8 && y >= b.minY - 8 && y <= b.maxY + 8;
    return hit ? [] : [el];
  }
  const points = parsePathPoints(el.d);
  if (!points.some((p) => Math.hypot(p.x - x, p.y - y) < ERASE_RADIUS)) return [el];
  const runs: Point[][] = [];
  let run: Point[] = [];
  for (const p of points) {
    if (Math.hypot(p.x - x, p.y - y) < ERASE_RADIUS) {
      if (run.length > 1) runs.push(run);
      run = [];
    } else {
      run.push(p);
    }
  }
  if (run.length > 1) runs.push(run);
  return runs.map((r) => ({ kind: 'path', d: pointsToPath(r), color: el.color, width: el.width }));
}

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
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);
  const [drag, setDrag] = useState<
    { kind: 'move'; index: number; lastX: number; lastY: number } | { kind: 'handle'; index: number; handle: number } | null
  >(null);
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
      setSelectedIndex(null);
      setDrag(null);
      setTool('pen');
    }
    wasVisibleRef.current = visible;
  }, [visible, initialElements]);

  function handleCanvasLayout(e: LayoutChangeEvent) {
    setCanvasSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
  }

  function eraseAt(x: number, y: number) {
    setElements((prev) => prev.flatMap((el) => eraseFromElement(el, x, y)));
    setSelectedIndex(null);
  }

  function updateElement(index: number, next: SketchElement) {
    setElements((prev) => prev.map((el, i) => (i === index ? next : el)));
  }

  function handleSelectStart(x: number, y: number) {
    // A grip on the already-selected shape wins over picking something
    // else up, so resizing still works when shapes overlap.
    if (selectedIndex !== null) {
      const el = elements[selectedIndex];
      if (el && el.kind === 'path' && el.shape) {
        const handles = shapeHandles(el.shape);
        const handle = handles.findIndex((h) => Math.hypot(h.x - x, h.y - y) < HANDLE_TOUCH_RADIUS);
        if (handle !== -1) {
          setDrag({ kind: 'handle', index: selectedIndex, handle });
          return;
        }
      }
    }
    const index = selectableIndexAt(elements, x, y);
    setSelectedIndex(index === -1 ? null : index);
    if (index !== -1) setDrag({ kind: 'move', index, lastX: x, lastY: y });
  }

  function handleSelectMove(x: number, y: number) {
    if (!drag) return;
    const el = elements[drag.index];
    if (!el) return;
    if (drag.kind === 'handle') {
      if (el.kind === 'path' && el.shape) {
        const shape = resizeShape(el.shape, drag.handle, { x, y });
        updateElement(drag.index, shapeElement(shape, el.color, el.width));
      }
      return;
    }
    const dx = x - drag.lastX;
    const dy = y - drag.lastY;
    if (el.kind === 'text') {
      updateElement(drag.index, { ...el, x: el.x + dx, y: el.y + dy });
    } else if (el.shape) {
      updateElement(drag.index, shapeElement(moveShape(el.shape, dx, dy), el.color, el.width));
    }
    setDrag({ ...drag, lastX: x, lastY: y });
  }

  function handleStart(e: GestureResponderEvent) {
    const { locationX, locationY } = e.nativeEvent;
    if (tool === 'eraser') {
      eraseAt(locationX, locationY);
      return;
    }
    if (tool === 'select') {
      handleSelectStart(locationX, locationY);
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
      handleSelectMove(locationX, locationY);
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
    setDrag(null);
    if (isShapeTool(tool)) {
      if (shapeStart && shapeCurrent && (shapeStart.x !== shapeCurrent.x || shapeStart.y !== shapeCurrent.y)) {
        const shape: SketchShape = {
          kind: tool,
          x1: shapeStart.x,
          y1: shapeStart.y,
          x2: shapeCurrent.x,
          y2: shapeCurrent.y,
        };
        setElements((prev) => [...prev, shapeElement(shape, color, strokeWidth)]);
      }
      setShapeStart(null);
      setShapeCurrent(null);
      return;
    }
    setCurrentPoints((prev) => {
      if (prev.length > 1) {
        setElements((els) => [...els, { kind: 'path', d: pointsToPath(prev), color, width: strokeWidth }]);
      }
      return [];
    });
  }

  function commitText() {
    const value = textValue.trim();
    if (pendingText && value) {
      setElements((els) => [
        ...els,
        { kind: 'text', x: pendingText.x, y: pendingText.y, text: value, color, fontSize: TEXT_FONT_SIZE },
      ]);
    }
    setPendingText(null);
    setTextValue('');
  }

  function undo() {
    setSelectedIndex(null);
    setElements((els) => els.slice(0, -1));
  }

  function clear() {
    setSelectedIndex(null);
    setElements([]);
  }

  function selectTool(t: Tool) {
    if (t !== 'select') setSelectedIndex(null);
    setTool(t);
  }

  function selectColor(c: string) {
    setColor(c);
    // Recolour whatever is selected, so the palette also works as "change
    // this one's colour" rather than only affecting the next thing drawn.
    if (selectedIndex !== null) {
      const el = elements[selectedIndex];
      if (el) updateElement(selectedIndex, { ...el, color: c });
    }
  }

  const previewShape: SketchShape | null =
    isShapeTool(tool) && shapeStart && shapeCurrent
      ? { kind: tool, x1: shapeStart.x, y1: shapeStart.y, x2: shapeCurrent.x, y2: shapeCurrent.y }
      : null;
  const selected = selectedIndex !== null ? elements[selectedIndex] : undefined;
  const selectedBounds = selected ? boundsOf(selected) : null;
  const selectedHandles = selected && selected.kind === 'path' && selected.shape ? shapeHandles(selected.shape) : [];
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
              {elements.map((el, i) =>
                el.kind === 'text' ? (
                  <SvgText key={i} x={el.x} y={el.y} fill={shown(el.color)} fontSize={el.fontSize}>
                    {el.text}
                  </SvgText>
                ) : (
                  <Path
                    key={i}
                    d={el.d}
                    stroke={shown(el.color)}
                    strokeWidth={el.width}
                    fill="none"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                )
              )}
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
              {selectedBounds && (
                <Rect
                  x={selectedBounds.minX - 6}
                  y={selectedBounds.minY - 6}
                  width={selectedBounds.maxX - selectedBounds.minX + 12}
                  height={selectedBounds.maxY - selectedBounds.minY + 12}
                  stroke={S.accent}
                  strokeWidth={1.5}
                  fill="none"
                  rx={6}
                />
              )}
              {selectedHandles.map((h, i) => (
                <Circle key={`h${i}`} cx={h.x} cy={h.y} r={HANDLE_RADIUS} fill={S.card} stroke={S.accent} strokeWidth={2} />
              ))}
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
            <Pressable hitSlop={6} onPress={undo} disabled={elements.length === 0} style={styles.capsuleButton}>
              <Ionicons name={'lc:undo-2' as never} size={19} color={elements.length ? S.ink : S.ink3} />
            </Pressable>
            <View style={[styles.capsuleDivider, { backgroundColor: S.line }]} />
            <Pressable hitSlop={6} onPress={clear} disabled={elements.length === 0} style={styles.capsuleButton}>
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
