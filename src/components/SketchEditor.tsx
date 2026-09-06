import { useEffect, useState } from 'react';
import { GestureResponderEvent, LayoutChangeEvent, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Svg, { Path } from 'react-native-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { SketchStroke } from '../types';

const COLORS = ['#111827', '#EF4444', '#F59E0B', '#10B981', '#3B82F6', '#8B5CF6'];
const WIDTHS = [3, 6, 10];

interface Props {
  visible: boolean;
  initialStrokes: SketchStroke[];
  onSave: (strokes: SketchStroke[], width: number, height: number) => void;
  onClose: () => void;
}

function pointsToPath(points: { x: number; y: number }[]): string {
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
}

export default function SketchEditor({ visible, initialStrokes, onSave, onClose }: Props) {
  const [strokes, setStrokes] = useState<SketchStroke[]>(initialStrokes);
  const [currentPoints, setCurrentPoints] = useState<{ x: number; y: number }[]>([]);
  const [color, setColor] = useState(COLORS[0]);
  const [strokeWidth, setStrokeWidth] = useState(WIDTHS[0]);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });

  // Re-seed local state each time the modal opens, since it stays mounted
  // (just hidden) between blocks otherwise and would carry over the
  // previous block's strokes.
  useEffect(() => {
    if (visible) {
      setStrokes(initialStrokes);
      setCurrentPoints([]);
    }
  }, [visible, initialStrokes]);

  function handleCanvasLayout(e: LayoutChangeEvent) {
    setCanvasSize({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height });
  }

  function handleStart(e: GestureResponderEvent) {
    const { locationX, locationY } = e.nativeEvent;
    setCurrentPoints([{ x: locationX, y: locationY }]);
  }

  function handleMove(e: GestureResponderEvent) {
    const { locationX, locationY } = e.nativeEvent;
    setCurrentPoints((prev) => [...prev, { x: locationX, y: locationY }]);
  }

  function handleEnd() {
    setCurrentPoints((prev) => {
      if (prev.length > 1) {
        setStrokes((s) => [...s, { d: pointsToPath(prev), color, width: strokeWidth }]);
      }
      return [];
    });
  }

  function undo() {
    setStrokes((s) => s.slice(0, -1));
  }

  function clear() {
    setStrokes([]);
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <View style={styles.header}>
          <Pressable hitSlop={10} onPress={onClose}>
            <Ionicons name="close" size={24} color="#111827" />
          </Pressable>
          <View style={styles.headerActions}>
            <Pressable hitSlop={10} onPress={undo} disabled={strokes.length === 0}>
              <Ionicons name="arrow-undo-outline" size={22} color={strokes.length ? '#111827' : '#D1D5DB'} />
            </Pressable>
            <Pressable hitSlop={10} onPress={clear} disabled={strokes.length === 0}>
              <Ionicons name="trash-outline" size={22} color={strokes.length ? '#111827' : '#D1D5DB'} />
            </Pressable>
          </View>
          <Pressable
            style={styles.doneButton}
            onPress={() => onSave(strokes, canvasSize.width, canvasSize.height)}
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
            {strokes.map((s, i) => (
              <Path
                key={i}
                d={s.d}
                stroke={s.color}
                strokeWidth={s.width}
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            ))}
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
          </Svg>
        </View>

        <View style={styles.toolbar}>
          <View style={styles.colorRow}>
            {COLORS.map((c) => (
              <Pressable
                key={c}
                hitSlop={4}
                onPress={() => setColor(c)}
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
  toolbar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
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
