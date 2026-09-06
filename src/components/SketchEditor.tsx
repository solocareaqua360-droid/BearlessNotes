import { useEffect, useState } from 'react';
import {
  GestureResponderEvent,
  LayoutChangeEvent,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SketchElement } from '../types';

const COLORS = ['#111827', '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6'];
const WIDTHS = [3, 6, 10];
const TEXT_FONT_SIZE = 22;
// How close a touch has to land to an element to erase it - whole-element
// erase (not true pixel erasing), since elements are vector data rather
// than a raster canvas.
const ERASE_RADIUS = 24;

type Point = { x: number; y: number };
type Tool = 'pen' | 'line' | 'rect' | 'circle' | 'text' | 'eraser';

const TOOLS: { tool: Tool; icon: keyof typeof Ionicons.glyphMap }[] = [
  { tool: 'pen', icon: 'pencil-outline' },
  { tool: 'line', icon: 'remove-outline' },
  { tool: 'rect', icon: 'square-outline' },
  { tool: 'circle', icon: 'ellipse-outline' },
  { tool: 'text', icon: 'text-outline' },
];

interface Props {
  visible: boolean;
  initialElements: SketchElement[];
  onSave: (elements: SketchElement[], width: number, height: number) => void;
  onClose: () => void;
}

function pointsToPath(points: Point[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

function parsePathPoints(d: string): Point[] {
  return d
    .split(/(?=[ML])/)
    .filter(Boolean)
    .map((segment) => {
      const [x, y] = segment.slice(1).trim().split(' ').map(Number);
      return { x, y };
    });
}

// A rectangle/circle only needs its own start/end drag points, not a
// point-by-point trace like a pen stroke - each just becomes a plain SVG
// path so it renders through the exact same <Path> element as a stroke.
// The circle is a 32-sided polygon rather than a true SVG arc - visually
// indistinguishable at normal stroke widths, but it keeps every element's
// `d` built from plain M/L points, so parsePathPoints (used for erasing)
// doesn't need separate arc-math just for this one shape.
function shapePath(tool: 'line' | 'rect' | 'circle', start: Point, end: Point): string {
  if (tool === 'line') return `M${start.x} ${start.y} L${end.x} ${end.y}`;
  if (tool === 'rect') {
    return `M${start.x} ${start.y} L${end.x} ${start.y} L${end.x} ${end.y} L${start.x} ${end.y} Z`;
  }
  const r = Math.hypot(end.x - start.x, end.y - start.y) || 1;
  const { x: cx, y: cy } = start;
  const segments = 32;
  const points: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * Math.PI * 2;
    points.push({ x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) });
  }
  return pointsToPath(points);
}

function elementNear(el: SketchElement, x: number, y: number): boolean {
  if (el.kind === 'text') return Math.hypot(el.x - x, el.y - y) < ERASE_RADIUS;
  return parsePathPoints(el.d).some((p) => Math.hypot(p.x - x, p.y - y) < ERASE_RADIUS);
}

export default function SketchEditor({ visible, initialElements, onSave, onClose }: Props) {
  const [elements, setElements] = useState<SketchElement[]>(initialElements);
  const [currentPoints, setCurrentPoints] = useState<Point[]>([]);
  const [shapeStart, setShapeStart] = useState<Point | null>(null);
  const [shapeCurrent, setShapeCurrent] = useState<Point | null>(null);
  const [pendingText, setPendingText] = useState<{ x: number; y: number; value: string } | null>(null);
  const [color, setColor] = useState(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(WIDTHS[0]);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [tool, setTool] = useState<Tool>('pen');

  // Re-seed local state each time the modal opens, since it stays mounted
  // (just hidden) between blocks otherwise and would carry over the
  // previous block's drawing.
  useEffect(() => {
    if (visible) {
      setElements(initialElements);
      setCurrentPoints([]);
      setShapeStart(null);
      setShapeCurrent(null);
      setPendingText(null);
      setTool('pen');
    }
  }, [visible, initialElements]);

  function handleCanvasLayout(e: LayoutChangeEvent) {
    setCanvasSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
  }

  function eraseAt(x: number, y: number) {
    setElements((prev) => prev.filter((el) => !elementNear(el, x, y)));
  }

  function handleStart(e: GestureResponderEvent) {
    const { locationX, locationY } = e.nativeEvent;
    if (tool === 'eraser') {
      eraseAt(locationX, locationY);
      return;
    }
    if (tool === 'text') {
      setPendingText({ x: locationX, y: locationY, value: '' });
      return;
    }
    if (tool === 'line' || tool === 'rect' || tool === 'circle') {
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
    if (tool === 'text') return;
    if (tool === 'line' || tool === 'rect' || tool === 'circle') {
      setShapeCurrent({ x: locationX, y: locationY });
      return;
    }
    setCurrentPoints((prev) => [...prev, { x: locationX, y: locationY }]);
  }

  function handleEnd() {
    if (tool === 'line' || tool === 'rect' || tool === 'circle') {
      if (shapeStart && shapeCurrent && (shapeStart.x !== shapeCurrent.x || shapeStart.y !== shapeCurrent.y)) {
        setElements((prev) => [
          ...prev,
          { kind: 'path', d: shapePath(tool, shapeStart, shapeCurrent), color, width: strokeWidth },
        ]);
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
    setPendingText((p) => {
      if (p && p.value.trim()) {
        setElements((els) => [
          ...els,
          { kind: 'text', x: p.x, y: p.y, text: p.value.trim(), color, fontSize: TEXT_FONT_SIZE },
        ]);
      }
      return null;
    });
  }

  function undo() {
    setElements((els) => els.slice(0, -1));
  }

  function clear() {
    setElements([]);
  }

  function selectColor(c: string) {
    if (tool === 'eraser') setTool('pen');
    setColor(c);
  }

  const previewShapeD = shapeStart && shapeCurrent ? shapePath(tool as 'line' | 'rect' | 'circle', shapeStart, shapeCurrent) : null;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable hitSlop={10} onPress={onClose}>
            <Ionicons name="close" size={24} color="#111827" />
          </Pressable>
          <View style={styles.headerActions}>
            <Pressable hitSlop={10} onPress={undo} disabled={elements.length === 0}>
              <Ionicons name="arrow-undo-outline" size={22} color={elements.length ? '#111827' : '#D1D5DB'} />
            </Pressable>
            <Pressable hitSlop={10} onPress={clear} disabled={elements.length === 0}>
              <Ionicons name="trash-outline" size={22} color={elements.length ? '#111827' : '#D1D5DB'} />
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
          style={styles.canvas}
          onLayout={handleCanvasLayout}
          onStartShouldSetResponder={() => true}
          onMoveShouldSetResponder={() => true}
          onResponderGrant={handleStart}
          onResponderMove={handleMove}
          onResponderRelease={handleEnd}
        >
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
            {previewShapeD && (
              <Path
                d={previewShapeD}
                stroke={color}
                strokeWidth={strokeWidth}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            )}
          </Svg>

          {pendingText && (
            <TextInput
              autoFocus
              value={pendingText.value}
              onChangeText={(v) => setPendingText((p) => p && { ...p, value: v })}
              onSubmitEditing={commitText}
              onBlur={commitText}
              placeholder="Текст…"
              style={[
                styles.textOverlayInput,
                { left: pendingText.x, top: pendingText.y - TEXT_FONT_SIZE, color, fontSize: TEXT_FONT_SIZE },
              ]}
            />
          )}
        </View>

        <View style={styles.toolbar}>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.toolRow}>
            {TOOLS.map(({ tool: t, icon }) => (
              <Pressable
                key={t}
                hitSlop={4}
                style={[styles.toolButton, tool === t && styles.toolButtonActive]}
                onPress={() => setTool(t)}
              >
                <Ionicons name={icon} size={20} color={tool === t ? '#fff' : '#111827'} />
              </Pressable>
            ))}
            <Pressable
              hitSlop={4}
              style={[styles.toolButton, tool === 'eraser' && styles.toolButtonActive]}
              onPress={() => setTool('eraser')}
            >
              <MaterialCommunityIcons name="eraser" size={20} color={tool === 'eraser' ? '#fff' : '#111827'} />
            </Pressable>
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
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
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
  },
  canvas: {
    flex: 1,
    backgroundColor: '#fff',
  },
  textOverlayInput: {
    position: 'absolute',
    minWidth: 80,
    padding: 0,
    fontWeight: '600',
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
});
