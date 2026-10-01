import { ReactNode, useEffect } from 'react';
import { StyleSheet, Text, View, type StyleProp, type TextStyle } from 'react-native';
import Animated, {
  Extrapolation,
  interpolate,
  useAnimatedScrollHandler,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withSpring,
  type SharedValue,
} from 'react-native-reanimated';

// «ПОЛИЦІ» (the user's, 2026-10-02): a grouped list drawn as shelves - each
// group a row of its own tiles that scrolls sideways, the groups one under
// another. Written once for every database; custom databases first.
//
// THE MOTION, as the user asked for it ("щоб картки пролистувались як
// живі ... можуть навіть трохи накладатись одна на одну поки не почну
// прокручувати"):
//  - at rest a shelf is a DECK: each tile tucked a little under the one
//    before it, the first on top, a touch smaller the further back;
//  - scrolling the shelf spreads the deck into a plain row with its gaps,
//    and bringing it back to its start gathers it again (asked for as a
//    first guess - "давай зробимо що має а там подивимось");
//  - opening the screen, the tiles come in from the right on a spring, one
//    after another, the shelves a beat after each other, top down.

export type Shelf<T> = { key: string; label: string; items: T[] };

const GAP = 12;
// How much of a tile the next one hides at rest, and how far along the
// shelf's own scroll the deck is fully spread.
const TUCK = 0.24;
const SPREAD_AT = 56;
// How small the tiles behind get, per place back, and no smaller than this.
const SHRINK = 0.03;
const SMALLEST = 0.88;
// The entrance: per tile, per shelf, and only for the tiles that can be
// seen - the rest are off the screen and simply stand.
const TILE_DELAY = 45;
const SHELF_DELAY = 70;
const ANIMATED_TILES = 6;

export default function ShelfRows<T>({
  shelves,
  tileWidth,
  padding,
  keyOf,
  renderTile,
  labelStyle,
  countStyle,
  footer,
  bottomPad,
  topPad = 0,
}: {
  shelves: Shelf<T>[];
  tileWidth: number;
  padding: number;
  keyOf: (item: T) => string;
  renderTile: (item: T, width: number) => ReactNode;
  // The database's own group-header text, so a shelf reads like its
  // other grouped views.
  labelStyle?: StyleProp<TextStyle>;
  countStyle?: StyleProp<TextStyle>;
  footer?: ReactNode;
  bottomPad: number;
  // Room for a header that floats over the shelves.
  topPad?: number;
}) {
  return (
    <Animated.ScrollView contentContainerStyle={{ paddingTop: topPad + 8, paddingBottom: bottomPad }}>
      {shelves.map((shelf, index) => (
        <View key={shelf.key} style={styles.shelf}>
          <View style={[styles.header, { paddingHorizontal: padding }]}>
            <Text style={[styles.label, labelStyle]} numberOfLines={1}>
              {shelf.label}
            </Text>
            <Text style={countStyle}>{shelf.items.length}</Text>
          </View>
          <ShelfRow
            items={shelf.items}
            order={index}
            tileWidth={tileWidth}
            padding={padding}
            keyOf={keyOf}
            renderTile={renderTile}
          />
        </View>
      ))}
      {footer}
    </Animated.ScrollView>
  );
}

function ShelfRow<T>({
  items,
  order,
  tileWidth,
  padding,
  keyOf,
  renderTile,
}: {
  items: T[];
  order: number;
  tileWidth: number;
  padding: number;
  keyOf: (item: T) => string;
  renderTile: (item: T, width: number) => ReactNode;
}) {
  const scrollX = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((event) => {
    scrollX.value = event.contentOffset.x;
  });
  return (
    <Animated.ScrollView
      horizontal
      onScroll={onScroll}
      scrollEventThrottle={16}
      showsHorizontalScrollIndicator={false}
      snapToInterval={tileWidth + GAP}
      decelerationRate="fast"
      // A sideways scroller inside the page's own: without these it is
      // squeezed to nothing in height (see DocumentsScreen's old sticker
      // row, which learned it).
      style={styles.row}
      contentContainerStyle={{ paddingHorizontal: padding }}
    >
      {items.map((item, i) => (
        <Tile key={keyOf(item)} index={i} count={items.length} order={order} width={tileWidth} scrollX={scrollX}>
          {renderTile(item, tileWidth)}
        </Tile>
      ))}
    </Animated.ScrollView>
  );
}

function Tile({
  index,
  count,
  order,
  width,
  scrollX,
  children,
}: {
  index: number;
  count: number;
  order: number;
  width: number;
  scrollX: SharedValue<number>;
  children: ReactNode;
}) {
  // 0 = not yet in, 1 = in. Tiles past the first few start in.
  const entered = useSharedValue(index < ANIMATED_TILES ? 0 : 1);
  useEffect(() => {
    if (index >= ANIMATED_TILES) return;
    entered.value = withDelay(
      order * SHELF_DELAY + index * TILE_DELAY,
      withSpring(1, { damping: 15, stiffness: 150, mass: 0.9 })
    );
    // Once, on mount: a shelf re-rendered (a record edited) does not
    // play its entrance again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const style = useAnimatedStyle(() => {
    const spread = interpolate(scrollX.value, [0, SPREAD_AT], [0, 1], Extrapolation.CLAMP);
    const gathered = 1 - spread;
    // Tucked under the tile before it: pulled back by its own gap and a
    // share of the tile before, for every place along.
    const tuck = -(GAP + width * TUCK) * index * gathered;
    const scale = Math.max(SMALLEST, 1 - SHRINK * index * gathered);
    const e = entered.value;
    return {
      opacity: Math.min(1, e * 1.4),
      transform: [{ translateX: tuck + (1 - e) * (width * 0.6) }, { scale }],
    };
  });
  return (
    <Animated.View
      // The first tile on top, the rest each a step further under.
      style={[{ width, marginRight: index === count - 1 ? 0 : GAP, zIndex: count - index }, style]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  shelf: {
    marginBottom: 18,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 8,
    marginBottom: 8,
  },
  label: {
    flexShrink: 1,
  },
  row: {
    flexGrow: 0,
    flexShrink: 0,
  },
});
