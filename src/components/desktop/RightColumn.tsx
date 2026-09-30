import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { Ionicons } from '../icons/Ionicons';
import PaneScreen from './PaneScreen';
import { targetInfo } from '../../navigation/paneTargetInfo';
import { COLUMN_MIN, useWorkspace, type Panel } from '../../navigation/workspace';
import { useSoft } from '../../theme/soft';
import { DESKTOP_MAIN_MIN, useDesktopRailWidth } from '../../constants/desktop';
import { SOFT_SEMIBOLD } from '../../utils/fonts';

// The side panels, in a column against the window's right edge: each a
// soft card with a header, standing on the ground with a gap round it -
// the arrangement of Claude Code's own window. Its left edge is a splitter
// that moves the column's width.
const HEADER = 38;

function usePanelTitle(panel: Panel): { icon: string; title: string } {
  const [name, setName] = useState<string | null>(null);
  const databaseId = panel.target?.kind === 'custom' ? panel.target.databaseId : null;
  useEffect(() => {
    if (!databaseId) return;
    return onSnapshot(doc(db, 'customDatabases', databaseId), (snapshot) => {
      setName((snapshot.data()?.name as string | undefined) ?? null);
    });
  }, [databaseId]);
  if (panel.kind === 'chat') return { icon: 'chatbubbles-outline', title: 'Чат' };
  if (panel.kind === 'databases' || !panel.target) return { icon: 'apps-outline', title: 'Бази' };
  return targetInfo(panel.target, name);
}

function PanelFrame({ panel }: { panel: Panel }) {
  const S = useSoft();
  const workspace = useWorkspace();
  const { icon, title } = usePanelTitle(panel);
  return (
    <View
      style={[
        styles.panel,
        { backgroundColor: S.bg, boxShadow: S.shadow },
        panel.folded ? styles.panelFolded : styles.panelOpen,
      ]}
    >
      <View style={[styles.header, { borderBottomColor: S.line }, panel.folded && { borderBottomWidth: 0 }]}>
        <Ionicons name={icon as never} size={16} color={S.ink2} />
        <Text style={[styles.title, { color: S.ink }]} numberOfLines={1}>
          {title}
        </Text>
        <Pressable
          hitSlop={6}
          style={styles.headerButton}
          onPress={() => workspace?.toggleFold(panel.id)}
          accessibilityLabel={panel.folded ? 'Розгорнути' : 'Згорнути'}
        >
          <Ionicons name={panel.folded ? 'chevron-down' : 'chevron-up'} size={16} color={S.ink2} />
        </Pressable>
        <Pressable hitSlop={6} style={styles.headerButton} onPress={() => workspace?.close(panel.id)} accessibilityLabel="Закрити панель">
          <Ionicons name="close" size={17} color={S.ink2} />
        </Pressable>
      </View>
      {/* Folded, the screen goes away and is built again on unfolding -
          a panel that is only a header costs nothing to keep. */}
      {!panel.folded && (
        <View style={styles.body}>
          <PaneScreen panel={panel} />
        </View>
      )}
    </View>
  );
}

// A column whose panels are ALL folded gives its width back: it shrinks to a
// narrow strip with one icon per panel, and a click on an icon unfolds that
// panel (the column takes its width again).
const STRIP_WIDTH = 44;
function FoldedStrip({ panels }: { panels: Panel[] }) {
  const S = useSoft();
  const workspace = useWorkspace();
  return (
    <View style={[styles.strip, { width: STRIP_WIDTH }]}>
      {panels.map((panel) => (
        <FoldedIcon key={panel.id} panel={panel} color={S.ink2} fill={S.fill} onPress={() => workspace?.toggleFold(panel.id)} />
      ))}
    </View>
  );
}

function FoldedIcon({ panel, color, fill, onPress }: { panel: Panel; color: string; fill: string; onPress: () => void }) {
  const { icon, title } = usePanelTitle(panel);
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel={`Розгорнути: ${title}`}
      // The browser's own tooltip - a name for an icon that has none.
      {...({ title } as object)}
      style={(state) => [styles.stripButton, (state as { hovered?: boolean }).hovered && { backgroundColor: fill }]}
    >
      <Ionicons name={icon as never} size={17} color={color} />
    </Pressable>
  );
}

// The strip on a column's left edge. Dragged left it makes THAT column
// wider, dragged right narrower - each column has its own, so the near one
// and the far one are not tied together. Pointer events on the strip, then
// on the window for the rest of the drag, so a fast move that outruns the
// strip is still followed. RNW gives a View's ref as the DOM node.
function Splitter({ column, width }: { column: 0 | 1; width: number }) {
  const workspace = useWorkspace();
  const handle = useRef<View | null>(null);
  const latest = useRef({ workspace, width });
  latest.current = { workspace, width };
  useEffect(() => {
    const node = handle.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    function onDown(event: PointerEvent) {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = latest.current.width;
      const move = (e: PointerEvent) => latest.current.workspace?.setWidth(column, startWidth + (startX - e.clientX));
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.style.cursor = '';
      };
      document.body.style.cursor = 'col-resize';
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }
    node.addEventListener('pointerdown', onDown);
    return () => node.removeEventListener('pointerdown', onDown);
  }, [column]);
  return <View ref={handle} style={styles.splitter} />;
}

export default function RightColumn() {
  const workspace = useWorkspace();
  const S = useSoft();
  const windowWidth = useWindowDimensions().width;
  const railWidth = useDesktopRailWidth();

  // Two columns need room for two of them and for the main pane; a window
  // that has it shows two, one that has not stacks everything in one.
  const room = windowWidth - railWidth - DESKTOP_MAIN_MIN;
  const twoColumns = room >= COLUMN_MIN * 2 + 16;

  if (!workspace || workspace.hidden || workspace.panels.length === 0) return null;
  // The panels of each column, in the order they were opened. With one
  // column shown they all stand in it, still in that order.
  const nearest = workspace.panels.filter((p) => (twoColumns ? p.column === 0 : true));
  const far = twoColumns ? workspace.panels.filter((p) => p.column === 1) : [];
  // A column with nothing in it is not drawn, and the other takes its place.
  const columns = [
    { panels: nearest, index: 0 as const },
    { panels: far, index: 1 as const },
  ].filter((c) => c.panels.length > 0);
  // Each keeps its own width, but together they leave the main pane its room.
  const widthOf = (position: number, index: 0 | 1) => {
    const wanted = workspace.widths[index];
    if (columns.length < 2) return Math.max(COLUMN_MIN, Math.min(wanted, room - 8));
    const first = position === 0 ? Math.min(wanted, room - COLUMN_MIN - 16) : 0;
    if (position === 0) return Math.max(COLUMN_MIN, first);
    const nearW = Math.max(COLUMN_MIN, Math.min(workspace.widths[columns[0].index], room - COLUMN_MIN - 16));
    return Math.max(COLUMN_MIN, Math.min(wanted, room - nearW - 16));
  };
  // A column of nothing but folded panels is a strip, not a column.
  const folded = columns.map((c) => c.panels.every((p) => p.folded));
  const widths = columns.map((c, position) => (folded[position] ? STRIP_WIDTH : widthOf(position, c.index)));
  const total = widths.reduce((a, b) => a + b, 0) + 8 * columns.length;
  return (
    <View style={[styles.group, { width: total, backgroundColor: S.bg }]}>
      {columns.map((column, position) => (
        folded[position] ? (
          <View key={column.index} style={styles.groupColumn}>
            <View style={styles.splitterSpace} />
            <FoldedStrip panels={column.panels} />
          </View>
        ) : (
        <View key={column.index} style={styles.groupColumn}>
          <Splitter column={column.index} width={widths[position]} />
          {/* No limit on how many: past what fits, the column scrolls. */}
          <ScrollView
            style={[styles.stackScroll, { width: widths[position] }]}
            contentContainerStyle={styles.stack}
            showsVerticalScrollIndicator={false}
          >
            {column.panels.map((panel) => (
              <PanelFrame key={panel.id} panel={panel} />
            ))}
          </ScrollView>
        </View>
        )
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row' },
  groupColumn: { flexDirection: 'row' },
  splitterSpace: { width: 8 },
  strip: { paddingVertical: 8, paddingRight: 6, gap: 4, alignItems: 'center' },
  stripButton: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  // A strip a little wider than it looks, so the cursor finds it.
  splitter: { width: 8, cursor: 'col-resize' } as never,
  stackScroll: { flexGrow: 0, flexShrink: 0 },
  stack: { flexGrow: 1, paddingRight: 8, paddingVertical: 8, gap: 8 },
  panel: { borderRadius: 18, overflow: 'hidden', minHeight: HEADER },
  // Shares the column while there is room, and never gets shorter than a
  // panel can be used at - past that the column scrolls instead.
  panelOpen: { flexGrow: 1, flexBasis: 0, minHeight: 300 },
  panelFolded: { flexGrow: 0, flexShrink: 0 },
  header: {
    height: HEADER,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 14,
    paddingRight: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  title: { flex: 1, fontSize: 13.5, fontFamily: SOFT_SEMIBOLD },
  headerButton: { width: 26, height: 26, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  body: { flex: 1, minHeight: 0 },
});
