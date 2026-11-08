import { memo, type ReactNode, useState } from "react";
import { StyleSheet } from "react-native";
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  type SharedValue,
} from "react-native-reanimated";

// A SHELF (the small version of mindEva's «Полиці»): one row of tiles that
// scrolls sideways, a shelf to a group, the shelves one under another. At rest
// the row is a DECK - each tile tucked a little under the one before it, a touch
// smaller the further back, so you see at once that there is more; the first
// finger-width of scrolling spreads it into a plain row with gaps, and bringing
// it back to the start gathers it again.
//
// Only the first few tiles are built when the shelf appears (a gathered deck
// shows three), the rest once a finger touches the shelf - so a screen with
// many shelves opens and scrolls without building hundreds of tiles at once.
// (A plain scroller, not a FlatList: the deck needs each tile to carry its own
// zIndex among its siblings, which a list's cells would swallow.)
const GAP = 12;
const TUCK = 0.24; // how much of a tile the next one hides at rest
const SPREAD_AT = 56; // how far along the shelf's own scroll the deck is fully spread
const SHRINK = 0.03; // how small the tiles behind get, per place back
const SMALLEST = 0.88;
const FIRST_BATCH = 5; // a gathered deck shows three tiles; five is a safe margin

function ShelfRowImpl<T>({
  items,
  tileWidth,
  padding,
  keyOf,
  renderTile,
}: {
  items: T[];
  tileWidth: number;
  padding: number;
  keyOf: (item: T) => string;
  renderTile: (item: T) => ReactNode;
}) {
  const scrollX = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollX.value = e.contentOffset.x;
  });
  const [all, setAll] = useState(items.length <= FIRST_BATCH);
  const shown = all ? items : items.slice(0, FIRST_BATCH);
  const count = items.length;
  return (
    <Animated.ScrollView
      horizontal
      onScrollBeginDrag={() => setAll(true)}
      onScroll={onScroll}
      scrollEventThrottle={16}
      showsHorizontalScrollIndicator={false}
      snapToInterval={tileWidth + GAP}
      decelerationRate="fast"
      // A sideways scroller inside the page's own scroller is squeezed to nothing without these.
      style={styles.row}
      contentContainerStyle={{ paddingHorizontal: padding }}
    >
      {shown.map((item, i) => (
        <Tile key={keyOf(item)} index={i} count={count} width={tileWidth} scrollX={scrollX}>
          {renderTile(item)}
        </Tile>
      ))}
    </Animated.ScrollView>
  );
}

export const ShelfRow = memo(ShelfRowImpl) as typeof ShelfRowImpl;

function Tile({
  index,
  count,
  width,
  scrollX,
  children,
}: {
  index: number;
  count: number;
  width: number;
  scrollX: SharedValue<number>;
  children: ReactNode;
}) {
  const style = useAnimatedStyle(() => {
    const spread = interpolate(scrollX.value, [0, SPREAD_AT], [0, 1], Extrapolation.CLAMP);
    const gathered = 1 - spread;
    const tuck = -(GAP + width * TUCK) * index * gathered;
    const scale = Math.max(SMALLEST, 1 - SHRINK * index * gathered);
    return { transform: [{ translateX: tuck }, { scale }] };
  });
  // The first tile on top, the rest each a step further under.
  return <Animated.View style={[{ width, marginRight: index === count - 1 ? 0 : GAP, zIndex: count - index }, style]}>{children}</Animated.View>;
}

const styles = StyleSheet.create({
  row: { flexGrow: 0, flexShrink: 0 },
});
