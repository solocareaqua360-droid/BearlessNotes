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
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Circle, Path, Rect, Text as SvgText } from 'react-native-svg';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { SketchElement, SketchPathElement, SketchShape } from '../types';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

const COLORS = ['#111827', '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6'];
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

const TOOLS: { tool: Tool; family: 'ion' | 'mci'; icon: string }[] = [
  { tool: 'pen', family: 'ion', icon: 'pencil-outline' },
  { tool: 'line', family: 'ion', icon: 'remove-outline' },
  { tool: 'arrow', family: 'ion', icon: 'arrow-forward-outline' },
  { tool: 'rect', family: 'ion', icon: 'square-outline' },
  { tool: 'circle', family: 'ion', icon: 'ellipse-outline' },
  { tool: 'text', family: 'ion', icon: 'text-outline' },
  { tool: 'select', family: 'mci', icon: 'cursor-move' },
  { tool: 'eraser', family: 'mci', icon: 'eraser' },
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
  onSave: (elements: SketchElement[], width: number, height: number) => void;
  onClose: () => void;
}

function pointsToPath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

// Every element's `d` is built from plain M/L segments only (no arcs, no
// curves) - that keeps one parser good for every hit test the editor does:
// erasing, selecting, and bounding boxes.
function parsePathPoints(d: string): Point[] {
  return d
    .split(/(?=[ML])/)
    .filter(Boolean)
    .map((segment) => {
      const [x, y] = segment.slice(1).trim().split(' ').map(Number);
      return { x, y };
    });
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

function boundsOf(el: SketchElement): { minX: number; minY: number; maxX: number; maxY: number } {
  if (el.kind === 'text') {
    const approxWidth = Math.max(el.text.length * el.fontSize * 0.55, 20);
    return { minX: el.x, minY: el.y - el.fontSize, maxX: el.x + approxWidth, maxY: el.y };
  }
  const points = parsePathPoints(el.d);
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
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

export default function SketchEditor({ visible, initialElements, background, onSave, onClose }: Props) {
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
  // Over a photograph the bar is dark glass, so its own marks are light.
  const ink = background ? '#fff' : '#111827';
  const inkOff = background ? 'rgba(255,255,255,0.35)' : '#D1D5DB';
  const selected = selectedIndex !== null ? elements[selectedIndex] : undefined;
  const selectedBounds = selected ? boundsOf(selected) : null;
  const selectedHandles = selected && selected.kind === 'path' && selected.shape ? shapeHandles(selected.shape) : [];

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView
        style={[styles.container, background && styles.containerDark]}
        edges={background ? [] : ['top', 'bottom']}
      >
        {/* Drawing on a photograph, the bars float OVER it rather than
            standing above and below: a picture squeezed between two
            solid bars is a picture you cannot see, which is what the
            user met. On a blank canvas they stay where they were. */}
        <View style={[styles.header, background && [styles.headerFloating, { paddingTop: insets.top + 8 }]]}>
          <Pressable hitSlop={10} onPress={onClose}>
            <Ionicons name="close" size={24} color={ink} />
          </Pressable>
          <View style={styles.headerActions}>
            <Pressable hitSlop={10} onPress={undo} disabled={elements.length === 0}>
              <Ionicons name="arrow-undo-outline" size={22} color={elements.length ? ink : inkOff} />
            </Pressable>
            <Pressable hitSlop={10} onPress={clear} disabled={elements.length === 0}>
              <Ionicons name="trash-outline" size={22} color={elements.length ? ink : inkOff} />
            </Pressable>
          </View>
          <Pressable
            style={styles.doneButton}
            onPress={() => onSave(elements, canvasSize.width, canvasSize.height)}
          >
            <Text style={styles.doneLabel}>Готово</Text>
          </Pressable>
        </View>

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
          {!!background && (
            <Image
              source={{ uri: background.uri }}
              style={StyleSheet.absoluteFill}
              resizeMode="cover"
            />
          )}
          <Svg style={StyleSheet.absoluteFill}>
            {elements.map((el, i) =>
              el.kind === 'text' ? (
                <SvgText key={i} x={el.x} y={el.y} fill={el.color} fontSize={el.fontSize}>
                  {el.text}
                </SvgText>
              ) : (
                <Path
                  key={i}
                  d={el.d}
                  stroke={el.color}
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
                stroke={color}
                strokeWidth={strokeWidth}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
            {previewShape && (
              <Path
                d={shapeToPath(previewShape, strokeWidth)}
                stroke={color}
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
                stroke="#3B82F6"
                strokeWidth={1}
                strokeDasharray="6 4"
                fill="none"
              />
            )}
            {selectedHandles.map((h, i) => (
              <Circle key={`h${i}`} cx={h.x} cy={h.y} r={HANDLE_RADIUS} fill="#fff" stroke="#3B82F6" strokeWidth={2} />
            ))}
          </Svg>
        </View>
        </View>

        {background ? (
          // One pill, floating clear of every edge: the tools in a row,
          // then the colour as a single dot that opens the palette above
          // it. Three stacked rows across the whole foot of the screen
          // was a quarter of the picture spent on controls.
          <>
            {paletteOpen && (
              <RNAnimated.View
                style={[
                  styles.palettePop,
                  { bottom: insets.bottom + 68, transform: barPan.getTranslateTransform() },
                ]}
              >
                {COLORS.map((c) => (
                  <Pressable
                    key={c}
                    hitSlop={4}
                    onPress={() => {
                      selectColor(c);
                      setPaletteOpen(false);
                    }}
                    style={[styles.colorSwatch, { backgroundColor: c }, color === c && styles.colorSwatchActive]}
                  />
                ))}
                <View style={styles.pillDivider} />
                {WIDTHS.map((w) => (
                  <Pressable
                    key={w}
                    hitSlop={4}
                    onPress={() => setStrokeWidth(w)}
                    style={[styles.widthButton, strokeWidth === w && styles.widthButtonActive]}
                  >
                    <View style={[styles.widthDot, { width: w * 2, height: w * 2, borderRadius: w }]} />
                  </Pressable>
                ))}
              </RNAnimated.View>
            )}
            <RNAnimated.View
              style={[
                styles.toolbarFloating,
                { bottom: insets.bottom + 10, transform: barPan.getTranslateTransform() },
              ]}
              {...barDrag.panHandlers}
            >
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.pillTools}
              >
                {TOOLS.map(({ tool: t, family, icon }) => (
                  <Pressable
                    key={t}
                    hitSlop={4}
                    style={[styles.pillTool, tool === t && styles.pillToolActive]}
                    onPress={() => selectTool(t)}
                  >
                    {family === 'ion' ? (
                      <Ionicons name={icon as never} size={17} color={tool === t ? '#111827' : '#fff'} />
                    ) : (
                      <MaterialCommunityIcons name={icon as never} size={17} color={tool === t ? '#111827' : '#fff'} />
                    )}
                  </Pressable>
                ))}
              </ScrollView>
              <View style={styles.pillDivider} />
              <Pressable hitSlop={6} onPress={() => setPaletteOpen((open) => !open)} style={styles.pillColor}>
                <View style={[styles.pillColorDot, { backgroundColor: color }]} />
              </Pressable>
            </RNAnimated.View>
          </>
        ) : (
          <View style={styles.toolbar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolRow}>
            {TOOLS.map(({ tool: t, family, icon }) => (
                <Pressable
                key={t}
                hitSlop={4}
                style={[styles.toolButton, tool === t && styles.toolButtonActive]}
                onPress={() => selectTool(t)}
              >
                {family === 'ion' ? (
                    <Ionicons name={icon as never} size={20} color={tool === t ? '#fff' : '#111827'} />
                ) : (
                    <MaterialCommunityIcons name={icon as never} size={20} color={tool === t ? '#fff' : '#111827'} />
                )}
                </Pressable>
            ))}
            </ScrollView>
            <View style={styles.colorRow}>
            {COLORS.map((c) => (
                <Pressable
                key={c}
                hitSlop={4}
                onPress={() => selectColor(c)}
                style={[styles.colorSwatch, { backgroundColor: c }, color === c && styles.colorSwatchActive]}
              />
            ))}
            </View>
            <View style={styles.widthRow}>
            {WIDTHS.map((w) => (
                <Pressable
                key={w}
                hitSlop={4}
                onPress={() => setStrokeWidth(w)}
                style={[styles.widthButton, strokeWidth === w && styles.widthButtonActive]}
              >
                  <View style={[styles.widthDot, { width: w * 2, height: w * 2, borderRadius: w }]} />
                </Pressable>
            ))}
            </View>
          </View>
        )}

        {pendingText && (
          <View style={styles.textPromptBackdrop}>
            <View style={styles.textPromptCard}>
              <Text style={styles.textPromptTitle}>Текст</Text>
              <TextInput
                autoFocus
                value={textValue}
                onChangeText={setTextValue}
                onSubmitEditing={commitText}
                placeholder="Текст…"
                placeholderTextColor="rgba(255,255,255,0.3)"
                style={styles.textPromptInput}
              />
              <View style={styles.textPromptButtons}>
                <Pressable
                  style={styles.textPromptCancel}
                  onPress={() => {
                    setPendingText(null);
                    setTextValue('');
                  }}
                >
                  <Text style={styles.textPromptCancelLabel}>Скасувати</Text>
                </Pressable>
                <Pressable
                  style={[styles.textPromptSave, !textValue.trim() && styles.textPromptSaveDisabled]}
                  disabled={!textValue.trim()}
                  onPress={commitText}
                >
                  <Text style={styles.textPromptSaveLabel}>Додати</Text>
                </Pressable>
              </View>
            </View>
          </View>
        )}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  containerDark: {
    backgroundColor: '#111',
  },
  // Floating: over the picture, out of the layout, on its own glass.
  headerFloating: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    zIndex: 10,
    borderBottomWidth: 0,
    backgroundColor: 'rgba(17,17,17,0.55)',
  },
  // The floating bar: ONE pill, centred, clear of every edge - the
  // shape Apple's own markup uses, and the reference the user drew.
  toolbarFloating: {
    position: 'absolute',
    alignSelf: 'center',
    // Not the width of the screen: the tools scroll inside the bar when
    // they do not fit, and a bar that stops well short of both edges
    // reads as something lying ON the picture rather than a strip of
    // furniture across the bottom of it.
    maxWidth: '76%',
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 6,
    paddingVertical: 5,
    borderRadius: 24,
    backgroundColor: 'rgba(28,28,30,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
    shadowColor: '#000',
    shadowOpacity: 0.35,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  pillTools: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
  },
  pillTool: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillToolActive: {
    backgroundColor: '#fff',
  },
  pillDivider: {
    width: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginVertical: 6,
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  pillColor: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillColorDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: 'rgba(255,255,255,0.85)',
  },
  // The palette, only while it is open, on its own pill above the bar.
  palettePop: {
    position: 'absolute',
    alignSelf: 'center',
    maxWidth: '94%',
    zIndex: 10,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 22,
    backgroundColor: 'rgba(28,28,30,0.94)',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.18)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#E5E7EB',
  },
  headerActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 20,
  },
  doneButton: {
    backgroundColor: '#3B82F6',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: 8,
  },
  doneLabel: {
    color: '#fff',
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
  },
  canvas: {
    flex: 1,
    backgroundColor: '#fff',
  },
  // Drawing on a photograph, the canvas is the PICTURE's box - centred
  // in what is left of the screen, with the dark around it so the edges
  // of the photo are plain to see.
  canvasStage: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111',
  },
  canvasFill: {
    flex: 1,
  },
  toolbar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  toolRow: {
    flexDirection: 'row',
    gap: 10,
  },
  toolButton: {
    width: 36,
    height: 36,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  toolButtonActive: {
    backgroundColor: '#3B82F6',
  },
  colorRow: {
    flexDirection: 'row',
    gap: 14,
  },
  colorSwatch: {
    width: 28,
    height: 28,
    borderRadius: 14,
  },
  colorSwatchActive: {
    borderWidth: 3,
    borderColor: '#9CA3AF',
  },
  widthRow: {
    flexDirection: 'row',
    gap: 14,
  },
  widthButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#F3F4F6',
  },
  widthButtonActive: {
    backgroundColor: '#DBEAFE',
  },
  widthDot: {
    backgroundColor: '#111827',
  },
  textPromptBackdrop: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  textPromptCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  textPromptTitle: {
    fontSize: 17,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: '#111827',
  },
  textPromptInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: '#111827',
  },
  textPromptButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 4,
  },
  textPromptCancel: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  textPromptCancelLabel: {
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: '#6B7280',
  },
  textPromptSave: {
    backgroundColor: '#3B82F6',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  textPromptSaveDisabled: {
    backgroundColor: '#BFDBFE',
  },
  textPromptSaveLabel: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: '#fff',
  },
});
