import Svg, { Rect } from 'react-native-svg';
import { View } from 'react-native';
import { BoardCard, BoardColumn } from '../types';
import { APPROX_CARD_HEIGHT, COLUMN_MIN_HEIGHT, COLUMN_WIDTH } from '../utils/boardLayout';

// A board's own shape, drawn from its cards rather than captured from the
// screen. A screenshot would need a native capture module, would have to be
// taken at some moment and stored, and would be out of date from the next
// edit onward; this is computed from the same data the list already holds,
// so it is never stale and costs nothing to keep.
//
// What it shows is the layout, not the content: where the columns stand,
// how full they are, what sits loose on the canvas. At this size that is
// the only thing readable - and it is what makes one board recognisable
// from another at a glance.
export default function BoardMiniMap({
  cards,
  columns,
  size,
  tint = 'rgba(255,255,255,0.85)',
  laneTint = 'rgba(255,255,255,0.25)',
}: {
  cards: BoardCard[];
  columns?: BoardColumn[];
  size: number;
  tint?: string;
  laneTint?: string;
}) {
  const lanes = (columns ?? []).map((column) => ({
    x: column.x,
    y: column.y,
    width: COLUMN_WIDTH,
    // Without measured card heights this is an estimate, and it only has
    // to be right enough to place the lane among its neighbours.
    height: Math.max(COLUMN_MIN_HEIGHT, 44 + cards.filter((c) => c.columnId === column.id).length * 100),
  }));
  const boxes = cards.map((card) => ({
    x: card.x,
    y: card.y,
    width: card.width,
    height: APPROX_CARD_HEIGHT,
  }));
  const all = [...lanes, ...boxes];
  if (all.length === 0) return <View style={{ width: size, height: size }} />;

  const minX = Math.min(...all.map((b) => b.x));
  const minY = Math.min(...all.map((b) => b.y));
  const maxX = Math.max(...all.map((b) => b.x + b.width));
  const maxY = Math.max(...all.map((b) => b.y + b.height));
  // One scale for both axes, so the layout keeps its proportions instead of
  // being stretched into the square it's drawn in.
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const scale = (size - 4) / span;
  const offsetX = 2 + ((size - 4) - (maxX - minX) * scale) / 2;
  const offsetY = 2 + ((size - 4) - (maxY - minY) * scale) / 2;

  const place = (b: { x: number; y: number; width: number; height: number }) => ({
    x: offsetX + (b.x - minX) * scale,
    y: offsetY + (b.y - minY) * scale,
    // Nothing below a pixel: a card scaled to 0.4px simply disappears, and
    // an empty square says less than a rough one.
    width: Math.max(1.5, b.width * scale),
    height: Math.max(1.5, b.height * scale),
  });

  return (
    <Svg width={size} height={size}>
      {lanes.map((lane, index) => {
        const r = place(lane);
        return <Rect key={`lane-${index}`} {...r} rx={2} fill={laneTint} />;
      })}
      {boxes.map((box, index) => {
        const r = place(box);
        const card = cards[index];
        return <Rect key={`card-${index}`} {...r} rx={1.5} fill={card.color ?? tint} opacity={card.color ? 0.95 : 0.85} />;
      })}
    </Svg>
  );
}
