import { type ReactNode, useState } from "react";
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
const GAP = 12;
const TUCK = 0.24; // how much of a tile the next one hides at rest
const SPREAD_AT = 56; // how far along the shelf's own scroll the deck is fully spread
const SHRINK = 0.03; // how small the tiles behind get, per place back
const SMALLEST = 0.88;
const DECK_VISIBLE = 7; // how many tiles a gathered deck builds before the shelf is touched

export function ShelfRow<T>({
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
  // Tiles past the first few are tucked out of sight: built only once a finger moves the shelf.
  const [all, setAll] = useState(items.length <= DECK_VISIBLE);
  const shown = all ? items : items.slice(0, DECK_VISIBLE);
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
        <Tile key={keyOf(item)} index={i} count={items.length} width={tileWidth} scrollX={scrollX}>
          {renderTile(item)}
        </Tile>
      ))}
    </Animated.ScrollView>
  );
}

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
  return (
    // The first tile on top, the rest each a step further under.
    <Animated.View style={[{ width, marginRight: index === count - 1 ? 0 : GAP, zIndex: count - index }, style]}>{children}</Animated.View>
  );
}

const styles = StyleSheet.create({
  row: { flexGrow: 0, flexShrink: 0 },
});
