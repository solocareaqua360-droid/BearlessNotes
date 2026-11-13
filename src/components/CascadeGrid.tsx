import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { View, useWindowDimensions } from 'react-native';

// THE CASCADE, ONE CONTINUOUS PIECE (the user, 2026-10-12: «дірки» and uneven gaps appeared where
// my first version cut the list into blocks). Columns of cards at their own sizes: each next card
// goes into the SHORTER column, judged by what is known of it - its measured height once it has
// been drawn, an estimate before. The assignment is made once per set of items and then kept, so
// nothing jumps while measurements arrive. A card far from the screen is a spacer of the same
// height (not mounted), which keeps a long list light.

// The scroll position, shared: a screen tells it when its list moved a good step, and every
// cascade on that screen re-checks which of its cards are near the window.
const store = { tick: 0, listeners: new Set<() => void>() };
export function notifyCascadeScroll() {
  store.tick += 1;
  store.listeners.forEach((l) => l());
}
const subscribe = (l: () => void) => {
  store.listeners.add(l);
  return () => {
    store.listeners.delete(l);
  };
};
const getTick = () => store.tick;

function CascadeGrid<T extends { id: string }>({
  items,
  columns,
  colWidth,
  gap,
  estimate,
  renderCell,
}: {
  items: T[];
  columns: number;
  colWidth: number;
  gap: number;
  estimate: (item: T) => number;
  renderCell: (item: T) => React.ReactNode;
}) {
  const { height: winH } = useWindowDimensions();
  const box = useRef<View>(null);
  const [winY, setWinY] = useState(0);
  const tick = useSyncExternalStore(subscribe, getTick);
  // Measured heights: kept in a ref (a measurement alone must not re-render everything), and a
  // slow tick says «recompute the tops».
  const measured = useRef(new Map<string, number>());
  const [version, setVersion] = useState(0);
  const bump = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onMeasured = useCallback((id: string, h: number) => {
    const rounded = Math.round(h);
    if (measured.current.get(id) === rounded) return;
    measured.current.set(id, rounded);
    if (bump.current) clearTimeout(bump.current);
    bump.current = setTimeout(() => setVersion((v) => v + 1), 140);
  }, []);
  useEffect(
    () => () => {
      if (bump.current) clearTimeout(bump.current);
    },
    []
  );

  // Where the box stands in the window, re-read when the list has moved.
  useEffect(() => {
    box.current?.measureInWindow((_x, y) => setWinY(y));
  }, [tick, version]);

  // The assignment: once per set of items (and column count / width).
  const columnsOf = useMemo(() => {
    const cols: T[][] = Array.from({ length: columns }, () => []);
    const heights = new Array(columns).fill(0);
    items.forEach((item) => {
      let at = 0;
      for (let c = 1; c < columns; c++) if (heights[c] < heights[at]) at = c;
      cols[at].push(item);
      heights[at] += (measured.current.get(item.id) ?? estimate(item)) + gap;
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, columns, colWidth, gap]);

  return (
    <View ref={box} collapsable={false} style={{ flexDirection: 'row', alignItems: 'flex-start', gap, marginBottom: gap }}>
      {columnsOf.map((col, ci) => {
        let top = 0;
        return (
          <View key={ci} style={{ width: colWidth }}>
            {col.map((item) => {
              const h = measured.current.get(item.id) ?? estimate(item);
              const t = top;
              top += h + gap;
              const near = winY + t + h > -winH * 1.2 && winY + t < winH * 2.4;
              if (!near) return <View key={item.id} style={{ height: h, marginBottom: gap }} />;
              return (
                <View
                  key={item.id}
                  style={{ marginBottom: gap }}
                  onLayout={(e) => onMeasured(item.id, e.nativeEvent.layout.height)}
                >
                  {renderCell(item)}
                </View>
              );
            })}
          </View>
        );
      })}
    </View>
  );
}

export default memo(CascadeGrid) as typeof CascadeGrid;
