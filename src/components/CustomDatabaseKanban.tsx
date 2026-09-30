import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { GestureDetector, ScrollView } from 'react-native-gesture-handler';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useReferenceDrag } from '../hooks/useReferenceDrag';
import { useSoftSurface } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';
import type { Block, CustomDatabaseRow, FieldDef } from '../types';

// A KANBAN VIEW of a database: one column per option of a select field, the
// records as their own cards in them, and a record dragged from one column
// to another CHANGES THE FIELD'S VALUE ("має" - the user's answer to
// whether the move writes it, or the view is only for looking).
//
// Held (a beat) and dragged: the same gesture the board's database window
// uses (useReferenceDrag) - a bare long-press Pan that owns the touch only
// once it has begun, so the columns scroll as ever until then. Near either
// edge of the screen the row of columns scrolls itself, or a column that
// is not on screen could never be reached.
const EDGE = 56;
const STEP = 18;

type Column = { key: string; label: string; color?: string; rows: CustomDatabaseRow[] };

export default function CustomDatabaseKanban({
  field,
  rows,
  renderRow,
  titleOf,
  onMove,
  bottomInset,
}: {
  // The select / multi-select field the columns come from.
  field: FieldDef;
  rows: CustomDatabaseRow[];
  renderRow: (row: CustomDatabaseRow) => ReactNode;
  // The record's name - what the card in hand says.
  titleOf: (row: CustomDatabaseRow) => string;
  // optionId null = «Без значення».
  onMove: (row: CustomDatabaseRow, optionId: string | null) => void;
  bottomInset: number;
}) {
  const S = useSoftSurface();
  const insets = useSafeAreaInsets();
  const { width: windowW } = useWindowDimensions();
  const columnW = Math.min(320, Math.round(windowW * 0.78));

  const columns = useMemo<Column[]>(() => {
    const keyOf = (row: CustomDatabaseRow): string | null => {
      const value = row.values?.[field.id];
      if (Array.isArray(value)) return value.length ? String(value[0]) : null;
      return value === undefined || value === null || value === '' ? null : String(value);
    };
    const options = field.options ?? [];
    const known = new Set(options.map((o) => o.id));
    const list: Column[] = options.map((o) => ({ key: o.id, label: o.label, color: o.color, rows: [] }));
    const empty: Column = { key: '', label: 'Без значення', rows: [] };
    rows.forEach((row) => {
      const key = keyOf(row);
      const column = key && known.has(key) ? list.find((c) => c.key === key) : null;
      (column ?? empty).rows.push(row);
    });
    return empty.rows.length > 0 ? [...list, empty] : list;
  }, [field, rows]);

  const rowsById = useMemo(() => new Map(rows.map((r) => [r.id, r])), [rows]);
  const columnNodes = useRef(new Map<string, View>());
  const scrollRef = useRef<ScrollView>(null);
  const scrollX = useRef(0);
  const fingerX = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const [hoverKey, setHoverKey] = useState<string | null>(null);

  const stopScrolling = () => {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
  };
  useEffect(() => stopScrolling, []);

  const columnAt = (x: number, y: number, done: (key: string | null) => void) => {
    const entries = [...columnNodes.current.entries()];
    let pending = entries.length;
    let hit: string | null = null;
    if (pending === 0) return done(null);
    entries.forEach(([key, node]) =>
      node.measureInWindow((nx, ny, nw, nh) => {
        if (x >= nx && x <= nx + nw && y >= ny && y <= ny + nh) hit = key;
        pending -= 1;
        if (pending === 0) done(hit);
      })
    );
  };

  const drag = useReferenceDrag({
    onMove: (x, y) => {
      fingerX.current = x;
      columnAt(x, y, setHoverKey);
      if (!timer.current) {
        timer.current = setInterval(() => {
          const fx = fingerX.current;
          if (fx === null) return;
          if (fx < EDGE) {
            scrollX.current = Math.max(0, scrollX.current - STEP);
            scrollRef.current?.scrollTo({ x: scrollX.current, animated: false });
          } else if (fx > windowW - EDGE) {
            scrollX.current += STEP;
            scrollRef.current?.scrollTo({ x: scrollX.current, animated: false });
          }
        }, 16);
      }
    },
    onFinished: () => {
      stopScrolling();
      fingerX.current = null;
      setHoverKey(null);
    },
    onDrop: (block, x, y, respond) => {
      columnAt(x, y, (key) => {
        const row = rowsById.get(block.id);
        if (key === null || !row) return respond(false);
        onMove(row, key === '' ? null : key);
        respond(true);
      });
    },
  });

  const ink = S?.ink ?? '#FFFFFF';
  const ink3 = S?.ink3 ?? 'rgba(255,255,255,0.6)';

  return (
    <GestureDetector gesture={drag.gesture}>
      <View style={styles.wrap}>
        <ScrollView
          ref={scrollRef}
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.columns}
          onScroll={(e) => {
            scrollX.current = e.nativeEvent.contentOffset.x;
          }}
          scrollEventThrottle={16}
        >
          {columns.map((column) => (
            <View
              key={column.key || '__empty__'}
              ref={(node) => {
                if (node) columnNodes.current.set(column.key, node);
                else columnNodes.current.delete(column.key);
              }}
              collapsable={false}
              style={[
                styles.column,
                { width: columnW },
                S && { backgroundColor: S.fill },
                hoverKey === column.key && (S ? { boxShadow: `0px 0px 0px 2px ${S.accent}` } : { borderColor: '#FFFFFF', borderWidth: 2 }),
              ]}
            >
              <View style={styles.head}>
                {column.color ? <View style={[styles.dot, { backgroundColor: column.color }]} /> : null}
                <Text style={[styles.title, { color: ink }]} numberOfLines={1}>
                  {column.label}
                </Text>
                <Text style={[styles.count, { color: ink3 }]}>{column.rows.length}</Text>
              </View>
              <ScrollView
                style={styles.list}
                contentContainerStyle={[styles.listContent, { paddingBottom: bottomInset + insets.bottom }]}
                showsVerticalScrollIndicator={false}
                nestedScrollEnabled
              >
                {column.rows.map((row) => {
                  const block = { id: row.id, text: '' } as Block;
                  return (
                    <View key={row.id} ref={drag.registerRow(`kan-${row.id}`, () => block, titleOf(row))} collapsable={false}>
                      {renderRow(row)}
                    </View>
                  );
                })}
                {column.rows.length === 0 && <Text style={[styles.empty, { color: ink3 }]}>Порожньо</Text>}
              </ScrollView>
            </View>
          ))}
        </ScrollView>
        <View ref={drag.ghostAnchor} pointerEvents="none" collapsable={false} style={{ position: 'absolute', left: 0, top: 0, width: 0, height: 0 }} />
        {drag.ghost && (
          <View style={[styles.ghostWrap, { left: drag.ghost.x, top: drag.ghost.y }]} pointerEvents="none">
            <View style={[styles.ghost, S && { backgroundColor: S.card, boxShadow: S.popShadow }]}>
              <Text style={[styles.ghostLabel, { color: S ? S.ink : '#111827' }]} numberOfLines={1}>
                {drag.ghost.label}
              </Text>
            </View>
          </View>
        )}
      </View>
    </GestureDetector>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
  },
  columns: {
    gap: 10,
    paddingHorizontal: 16,
    paddingBottom: 8,
  },
  column: {
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.08)',
    paddingTop: 12,
    overflow: 'hidden',
  },
  head: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 14,
    paddingBottom: 10,
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  title: {
    flex: 1,
    fontSize: 15.5,
    fontFamily: SOFT_SEMIBOLD,
    letterSpacing: -0.2,
  },
  count: {
    fontSize: 13,
    fontFamily: SOFT_MEDIUM,
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: 8,
    paddingHorizontal: 8,
  },
  empty: {
    textAlign: 'center',
    fontSize: 14,
    paddingVertical: 24,
  },
  ghostWrap: {
    position: 'absolute',
    zIndex: 60,
    transform: [{ scale: 1.04 }],
  },
  ghost: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
    backgroundColor: '#FFFFFF',
    alignSelf: 'flex-start',
  },
  ghostLabel: {
    fontSize: 14,
    fontFamily: SOFT_SEMIBOLD,
    maxWidth: 200,
  },
});
