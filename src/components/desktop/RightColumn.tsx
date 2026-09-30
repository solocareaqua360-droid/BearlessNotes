import { useEffect, useRef, useState, type RefObject } from 'react';
import { Animated, Easing, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { Ionicons } from '../icons/Ionicons';
import PaneScreen from './PaneScreen';
import UpButton from './UpButton';
import { InnerBackProvider } from '../../navigation/innerBack';
import { navigateToTarget, targetInfo } from '../../navigation/paneTargetInfo';
import type { PaneTarget } from '../../navigation/paneTarget';
import { addTab } from '../../navigation/desktopTabs';
import { go } from '../DesktopTabs';
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
  // What the panel shows now: where a click took it, else its own thing.
  const shown = panel.stack?.length ? panel.stack[panel.stack.length - 1] : panel.target;
  const databaseId = shown?.kind === 'custom' ? shown.databaseId : null;
  useEffect(() => {
    if (!databaseId) return;
    return onSnapshot(doc(db, 'customDatabases', databaseId), (snapshot) => {
      setName((snapshot.data()?.name as string | undefined) ?? null);
    });
  }, [databaseId]);
  if (panel.stack?.length && shown) return targetInfo(shown, name);
  if (panel.kind === 'chat') return { icon: 'chatbubbles-outline', title: 'Чат' };
  if (panel.kind === 'databases' || !shown) return { icon: 'apps-outline', title: 'Бази' };
  return targetInfo(shown, name);
}

// What a panel shows, moved into a tab of the main pane: the panel closes,
// and the same screen is the tab in front. A section that is not a tab by
// going there (Бази, Справи, Чат, Дошки) is made one first, as the
// databases' own «Відкрити в новій вкладці» does.
function moveToTab(panel: Panel, close: () => void) {
  const shown: PaneTarget | undefined = panel.stack?.length ? panel.stack[panel.stack.length - 1] : panel.target;
  if (!shown) {
    if (panel.kind !== 'chat') return;
    go(addTab('section', 'Chat'));
  } else if (shown.kind === 'documents') {
    go(null);
  } else if (shown.kind === 'boards') {
    go(addTab('section', 'Дошки'));
  } else if (shown.kind === 'route' && (shown.route === 'Tasks' || shown.route === 'Chat')) {
    go(addTab('section', shown.route));
  } else {
    // A database: going there makes it a tab (DesktopTabs).
    navigateToTarget(shown);
  }
  close();
}

// How tall each panel stands now, for the line between two of them to start
// a drag from - read at the moment of the press, so not state.
const panelHeights = new Map<string, number>();

function PanelFrame({ panel }: { panel: Panel }) {
  const S = useSoft();
  const workspace = useWorkspace();
  const { icon, title } = usePanelTitle(panel);
  return (
    <InnerBackProvider>
    <View
      onLayout={(e) => panelHeights.set(panel.id, e.nativeEvent.layout.height)}
      style={[
        styles.panel,
        // A hairline all round as well as the shadow: the panel is the same
        // colour as the ground, and a shadow alone is soft on the lit side.
        { backgroundColor: S.bg, boxShadow: S.shadow, borderWidth: StyleSheet.hairlineWidth, borderColor: S.line },
        panel.folded ? styles.panelFolded : styles.panelOpen,
      ]}
    >
      <View style={[styles.header, { borderBottomColor: S.line }, panel.folded && { borderBottomWidth: 0 }]}>
        {/* The panel's one way back (navigation/innerBack): the screen's own
            step inside itself first, then where a click inside the panel
            took it. Its place is kept either way. */}
        {!panel.folded && (
          <UpButton size={26} fallback={panel.stack?.length ? () => workspace?.popInPanel(panel.id) : null} />
        )}
        <Ionicons name={icon as never} size={16} color={S.ink2} />
        <Text style={[styles.title, { color: S.ink }]} numberOfLines={1}>
          {title}
        </Text>
        {/* Not for the databases list itself: it never stands in the main
            pane. A database opened inside it can go. */}
        {!(panel.kind === 'databases' && !panel.stack?.length) && (
        <Pressable
          hitSlop={6}
          style={(state) => [styles.headerButton, (state as { hovered?: boolean }).hovered && { backgroundColor: S.fill }]}
          onPress={() => moveToTab(panel, () => workspace?.close(panel.id))}
          accessibilityLabel="Перенести у вкладку"
          {...({ title: 'Перенести у вкладку' } as object)}
        >
          <Ionicons name="browsers-outline" size={15} color={S.ink2} />
        </Pressable>
        )}
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
    </InnerBackProvider>
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

// The round button that comes up when the pointer rests on a splitter: two
// arrows going opposite ways, sliding to and fro the whole time it is there
// (Samsung's own way to say "these two trade places") - no words. Between
// columns the arrows go sideways, between two panels up and down.
function SwapCapsule({ vertical, onPress }: { vertical: boolean; onPress: () => void }) {
  const S = useSoft();
  const slide = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(slide, { toValue: 1, duration: 620, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(slide, { toValue: 0, duration: 620, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [slide]);
  const TRAVEL = 4;
  const forward = slide.interpolate({ inputRange: [0, 1], outputRange: [-TRAVEL, TRAVEL] });
  const backward = slide.interpolate({ inputRange: [0, 1], outputRange: [TRAVEL, -TRAVEL] });
  const axis = vertical ? 'translateX' : 'translateY';
  return (
    <Pressable
      onPress={onPress}
      accessibilityLabel="Поміняти місцями"
      style={[
        styles.capsule,
        vertical ? styles.capsuleBeside : styles.capsuleAbove,
        { backgroundColor: S.ink, boxShadow: S.popShadow },
      ]}
    >
      <Animated.View style={{ transform: [{ [axis]: forward }] as never }}>
        <Ionicons name={(vertical ? 'arrow-forward' : 'arrow-down') as never} size={13} color={S.bg} />
      </Animated.View>
      <Animated.View style={{ transform: [{ [axis]: backward }] as never }}>
        <Ionicons name={(vertical ? 'arrow-back' : 'arrow-up') as never} size={13} color={S.bg} />
      </Animated.View>
    </Pressable>
  );
}

// Hover on a node, told through the DOM: React Native Web's own hover
// callbacks do not fire for a View that is not a Pressable.
function useHover(): [RefObject<View | null>, boolean] {
  const ref = useRef<View | null>(null);
  const [hover, setHover] = useState(false);
  useEffect(() => {
    const node = ref.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    const on = () => setHover(true);
    const off = () => setHover(false);
    node.addEventListener('mouseenter', on);
    node.addEventListener('mouseleave', off);
    return () => {
      node.removeEventListener('mouseenter', on);
      node.removeEventListener('mouseleave', off);
    };
  }, []);
  return [ref, hover];
}

// A drag along one axis on a node: the position at the press, the position
// now, and the end. Pointer events on the node, then on the window for the
// rest of the drag, so a fast move that outruns the strip is still
// followed. RNW gives a View's ref as the DOM node.
function useDrag(
  ref: RefObject<View | null>,
  axis: 'x' | 'y',
  handlers: { start: () => void; move: (delta: number) => void }
) {
  const latest = useRef(handlers);
  latest.current = handlers;
  useEffect(() => {
    const node = ref.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    function onDown(event: PointerEvent) {
      // The capsule inside the strip is a button, not a handle.
      if ((event.target as HTMLElement).closest?.('[aria-label="Поміняти місцями"]')) return;
      event.preventDefault();
      const from = axis === 'x' ? event.clientX : event.clientY;
      latest.current.start();
      const move = (e: PointerEvent) => latest.current.move((axis === 'x' ? e.clientX : e.clientY) - from);
      const up = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        document.body.style.cursor = '';
      };
      document.body.style.cursor = axis === 'x' ? 'col-resize' : 'row-resize';
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    }
    node.addEventListener('pointerdown', onDown);
    return () => node.removeEventListener('pointerdown', onDown);
  }, [ref, axis]);
}

// The line on a column's left edge moves THE BOUNDARY it stands on, and only
// that - the way every split view does: the line between the main pane and
// the first column trades width between those two (the far column does not
// move), the line between the two columns trades between those two (the
// main pane does not move). `onDrag` is told how far the pointer has gone
// since the press and does the trading. Rests on it: the line lights up
// and, between two columns, the round button offers to swap them.
function Splitter({ onStart, onDrag, swap }: { onStart: () => void; onDrag: (delta: number) => void; swap?: () => void }) {
  const S = useSoft();
  const [ref, hover] = useHover();
  const latest = useRef({ onStart, onDrag });
  latest.current = { onStart, onDrag };
  useDrag(ref, 'x', {
    start: () => latest.current.onStart(),
    move: (delta) => latest.current.onDrag(delta),
  });
  return (
    <View ref={ref} style={styles.splitter}>
      <View style={[styles.splitterLine, { backgroundColor: hover ? S.ink3 : S.line }, hover && styles.splitterLineOn]} />
      {hover && !!swap && <SwapCapsule vertical onPress={swap} />}
    </View>
  );
}

// The widths the columns were DRAWN at when a splitter was pressed. A drag
// starts from those, not from what was asked for - they differ once the
// room has clamped a width, and a drag from the asked-for number first had
// to eat that difference before anything moved.
const dragBase: { current: number[] } = { current: [] };

// The line between two panels of one column: drags their heights against
// each other, and rests offer to swap them.
function HSplitter({ above, below }: { above: Panel; below: Panel }) {
  const S = useSoft();
  const workspace = useWorkspace();
  const [ref, hover] = useHover();
  const base = useRef({ a: 0, b: 0 });
  const latest = useRef({ workspace, above, below });
  latest.current = { workspace, above, below };
  const both = !above.folded && !below.folded;
  useDrag(ref, 'y', {
    start: () => {
      base.current = { a: panelHeights.get(latest.current.above.id) ?? 0, b: panelHeights.get(latest.current.below.id) ?? 0 };
    },
    move: (delta) => {
      if (!both) return;
      const { a, b } = base.current;
      const total = a + b;
      if (total <= 0) return;
      // Neither gets smaller than a panel can be used at.
      const nextA = Math.max(120, Math.min(total - 120, a + delta));
      // The two keep their COMBINED share of the column, so a third panel
      // beside them is not squeezed by the drag.
      const share = (latest.current.above.weight ?? 1) + (latest.current.below.weight ?? 1);
      latest.current.workspace?.setWeight(latest.current.above.id, (share * nextA) / total);
      latest.current.workspace?.setWeight(latest.current.below.id, share - (share * nextA) / total);
    },
  });
  return (
    <View ref={ref} style={[styles.hsplitter, both && styles.hsplitterResizable]}>
      <View style={[styles.hsplitterLine, { backgroundColor: hover ? S.ink3 : 'transparent' }]} />
      {hover && (
        <SwapCapsule vertical={false} onPress={() => workspace?.swapPanels(above.id, below.id)} />
      )}
    </View>
  );
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
  const all = [
    { panels: nearest, index: 0 as const },
    { panels: far, index: 1 as const },
  ].filter((c) => c.panels.length > 0);
  // A column of nothing but folded panels is not a column: its panels go to
  // ONE strip at the right edge, whichever column they came from - a strip
  // per column was two rails where one would hold them.
  const columns = all.filter((c) => !c.panels.every((p) => p.folded));
  const stripPanels = all.filter((c) => c.panels.every((p) => p.folded)).flatMap((c) => c.panels);
  const stripRoom = stripPanels.length > 0 ? STRIP_WIDTH + 8 : 0;
  const usable = room - stripRoom;
  // What each column is drawn at. The OUTER one keeps what it was given (as
  // far as the room allows); the one beside the main pane takes what is
  // left of the room after it, so a window that narrows eats the main pane's
  // neighbour first, never the far edge.
  const widths: number[] = (() => {
    if (columns.length < 2) return columns.map((c) => Math.max(COLUMN_MIN, Math.min(workspace.widths[c.index], usable - 8)));
    const far = Math.max(COLUMN_MIN, Math.min(workspace.widths[columns[1].index], usable - COLUMN_MIN - 16));
    const near = Math.max(COLUMN_MIN, Math.min(workspace.widths[columns[0].index], usable - far - 16));
    return [near, far];
  })();
  const startDrag = () => {
    dragBase.current = widths;
  };
  // Main | first column: the first column alone changes, the main pane
  // absorbs it.
  const dragOuter = (delta: number) => {
    const [near0, far0] = dragBase.current;
    const max = usable - (columns.length > 1 ? far0 + 16 : 8);
    workspace.setWidth(columns[0].index, Math.max(COLUMN_MIN, Math.min(max, near0 - delta)));
  };
  // First column | second: the two trade, the main pane stays.
  const dragBetween = (delta: number) => {
    const [near0, far0] = dragBase.current;
    const shift = Math.max(COLUMN_MIN - near0, Math.min(far0 - COLUMN_MIN, delta));
    workspace.setWidth(columns[0].index, near0 + shift);
    workspace.setWidth(columns[1].index, far0 - shift);
  };
  const total = widths.reduce((a, b) => a + b, 0) + 8 * columns.length + stripRoom;
  return (
    <View style={[styles.group, { width: total, backgroundColor: S.bg }]}>
      {columns.map((column, position) => (
        <View key={column.index} style={styles.groupColumn}>
          <Splitter
            onStart={startDrag}
            onDrag={position === 0 ? dragOuter : dragBetween}
            swap={position > 0 ? () => workspace.swapColumns() : undefined}
          />
          {/* No limit on how many: past what fits, the column scrolls. */}
          <ScrollView
            style={[styles.stackScroll, { width: widths[position] }]}
            contentContainerStyle={styles.stack}
            showsVerticalScrollIndicator={false}
          >
            {column.panels.map((panel, at) => (
              <View key={panel.id} style={panel.folded ? styles.slotFolded : [styles.slotOpen, { flexGrow: panel.weight ?? 1 }]}>
                {at > 0 && <HSplitter above={column.panels[at - 1]} below={panel} />}
                <PanelFrame panel={panel} />
              </View>
            ))}
          </ScrollView>
        </View>
      ))}
      {stripPanels.length > 0 && (
        <View style={styles.groupColumn}>
          <View style={styles.splitterSpace} />
          <FoldedStrip panels={stripPanels} />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  group: { flexDirection: 'row' },
  groupColumn: { flexDirection: 'row' },
  splitterSpace: { width: 8 },
  strip: { paddingVertical: 8, paddingRight: 6, gap: 4, alignItems: 'center' },
  stripButton: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  // A strip a little wider than the line it draws, so the cursor finds it.
  splitter: { width: 8, cursor: 'col-resize', alignItems: 'center', justifyContent: 'center', zIndex: 20 } as never,
  splitterLine: { width: 2, height: '18%', minHeight: 60, borderRadius: 1 },
  splitterLineOn: { width: 3 },
  hsplitter: { position: 'absolute', top: -8, left: 0, right: 0, height: 8, zIndex: 20, alignItems: 'center', justifyContent: 'center' },
  hsplitterResizable: { cursor: 'row-resize' } as never,
  hsplitterLine: { height: 2, width: '22%', minWidth: 60, borderRadius: 1 },
  // Round, two arrows stacked (side by side for a horizontal splitter).
  capsule: { position: 'absolute', width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center', gap: 1, zIndex: 30 },
  capsuleBeside: { top: '46%', left: '50%', marginLeft: -17, flexDirection: 'column' },
  capsuleAbove: { top: -13, left: '50%', marginLeft: -17, flexDirection: 'row', gap: 2 },
  slotOpen: { flexBasis: 0, minHeight: 300 },
  slotFolded: { flexGrow: 0, flexShrink: 0 },
  stackScroll: { flexGrow: 0, flexShrink: 0 },
  // Room on BOTH sides for the panel's shadow: the scroll view clips what
  // stands outside it, and with nothing on the left the panel's left edge
  // had no shadow and ran into the ground ("лівий край зливається").
  stack: { flexGrow: 1, paddingLeft: 6, paddingRight: 8, paddingVertical: 8, gap: 8 },
  panel: { borderRadius: 18, overflow: 'hidden', minHeight: HEADER },
  // Shares the column while there is room, and never gets shorter than a
  // panel can be used at - past that the column scrolls instead.
  panelOpen: { flex: 1 },
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
