import { StyleSheet, Text, View } from 'react-native';
import Svg, { Ellipse, Polygon, Rect } from 'react-native-svg';
import { BoardShape } from '../types';
import { FONT_SEMIBOLD } from '../utils/fonts';

// A board shape's own look - rectangle, ellipse, triangle, diamond or
// plain text - lifted out of BoardScreen so the boards-list preview
// (BoardMiniMap/BoardMiniature) can draw the SAME shapes rather than
// reinventing per-kind SVG paths of its own. Deliberately just the
// picture: no drag, no selection, no resize handles - those stay in
// BoardScreen's own DraggableShape, which wraps this in its gestures.
export const SHAPE_STROKE = 2;
export const SHAPE_TEXT_SIZE_DEFAULT = 16;
export const SHAPE_LABEL_SIZE_DEFAULT = 14;

export default function ShapeBody({
  shape,
  width,
  height,
  stroke,
  fill,
  ink,
}: {
  shape: BoardShape;
  width: number;
  height: number;
  stroke: string;
  // 'none', or the same colour as the outline at a fraction of it - see
  // shapeFillFor in BoardScreen. Kept as one prop rather than recomputed
  // per element so every element in one shape agrees.
  fill: string;
  ink: string;
}) {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  // Half the stroke sits outside the path, so every shape is drawn
  // inset by that much or its outline is clipped by its own box.
  const i = SHAPE_STROKE / 2;
  const fontSize = shape.fontSize ?? (shape.kind === 'text' ? SHAPE_TEXT_SIZE_DEFAULT : SHAPE_LABEL_SIZE_DEFAULT);
  return (
    <>
      {shape.kind !== 'text' && (
        <Svg width={w} height={h} style={StyleSheet.absoluteFill} pointerEvents="none">
          {(shape.kind === 'rect' || shape.kind === 'square') && (
            <Rect
              x={i}
              y={i}
              width={w - SHAPE_STROKE}
              height={h - SHAPE_STROKE}
              rx={10}
              fill={fill}
              stroke={stroke}
              strokeWidth={SHAPE_STROKE}
            />
          )}
          {(shape.kind === 'ellipse' || shape.kind === 'circle') && (
            <Ellipse
              cx={w / 2}
              cy={h / 2}
              rx={w / 2 - i}
              ry={h / 2 - i}
              fill={fill}
              stroke={stroke}
              strokeWidth={SHAPE_STROKE}
            />
          )}
          {shape.kind === 'triangle' && (
            <Polygon
              points={`${w / 2},${i} ${w - i},${h - i} ${i},${h - i}`}
              fill={fill}
              stroke={stroke}
              strokeWidth={SHAPE_STROKE}
              strokeLinejoin="round"
            />
          )}
          {shape.kind === 'diamond' && (
            <Polygon
              points={`${w / 2},${i} ${w - i},${h / 2} ${w / 2},${h - i} ${i},${h / 2}`}
              fill={fill}
              stroke={stroke}
              strokeWidth={SHAPE_STROKE}
              strokeLinejoin="round"
            />
          )}
        </Svg>
      )}
      {/* The words sit in the middle of whatever was drawn - and for
          'text' they ARE the whole thing. Padded well in from the edge:
          a triangle and a diamond have very little room at their points,
          and text that runs into the outline reads as a mistake. */}
      <View style={[styles.shapeTextWrap, shape.kind === 'text' && styles.shapeTextWrapBare]}>
        <Text
          style={[
            styles.shapeText,
            { color: shape.kind === 'text' ? shape.color ?? ink : ink, fontSize },
            shape.kind === 'text' && styles.shapeTextLoose,
          ]}
        >
          {shape.text || (shape.kind === 'text' ? 'Текст' : '')}
        </Text>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  shapeTextWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 18,
    paddingVertical: 14,
  },
  shapeTextWrapBare: {
    position: 'relative',
    paddingHorizontal: 4,
    paddingVertical: 4,
  },
  shapeText: {
    fontFamily: FONT_SEMIBOLD,
    textAlign: 'center',
  },
  shapeTextLoose: {
    textAlign: 'left',
  },
});
