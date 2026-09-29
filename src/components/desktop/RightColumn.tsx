import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../../firebase';
import { Ionicons } from '../icons/Ionicons';
import PaneScreen from './PaneScreen';
import { useWorkspace, type Panel } from '../../navigation/workspace';
import { useSoft } from '../../theme/soft';
import { DESKTOP_MAIN_MIN, useDesktopNarrow, useDesktopRailWidth } from '../../constants/desktop';
import { SOFT_SEMIBOLD } from '../../utils/fonts';

// The side panels, in a column against the window's right edge: each a
// soft card with a header, standing on the ground with a gap round it -
// the arrangement of Claude Code's own window. Its left edge is a splitter
// that moves the column's width.
const HEADER = 38;

function usePanelTitle(panel: Panel): { icon: string; title: string } {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    if (panel.kind !== 'database' || !panel.databaseId) return;
    return onSnapshot(doc(db, 'customDatabases', panel.databaseId), (snapshot) => {
      setName((snapshot.data()?.name as string | undefined) ?? null);
    });
  }, [panel.kind, panel.databaseId]);
  if (panel.kind === 'chat') return { icon: 'chatbubbles-outline', title: 'Чат' };
  if (panel.kind === 'databases') return { icon: 'apps-outline', title: 'Бази' };
  return { icon: 'grid-outline', title: name || 'База' };
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

export default function RightColumn() {
  const workspace = useWorkspace();
  const S = useSoft();
  const windowWidth = useWindowDimensions().width;
  const railWidth = useDesktopRailWidth();
  useDesktopNarrow();
  const startX = useRef(0);
  const startWidth = useRef(0);
  const handle = useRef<View | null>(null);

  // The splitter: pointer events on the strip itself, then on the window
  // for the rest of the drag, so a fast move that outruns the strip is
  // still followed. RNW gives a View's ref as the DOM node.
  useEffect(() => {
    const node = handle.current as unknown as HTMLElement | null;
    if (!node || typeof node.addEventListener !== 'function') return;
    function onDown(event: PointerEvent) {
      event.preventDefault();
      startX.current = event.clientX;
      startWidth.current = workspace?.width ?? 0;
      const move = (e: PointerEvent) => workspace?.setWidth(startWidth.current + (startX.current - e.clientX));
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
  });

  if (!workspace || workspace.hidden || workspace.panels.length === 0) return null;
  return (
    <View style={[styles.column, { width: Math.max(260, Math.min(workspace.width, windowWidth - railWidth - DESKTOP_MAIN_MIN)), backgroundColor: S.bg }]}>
      <View ref={handle} style={styles.splitter} />
      {/* No limit on how many: past what fits, the column scrolls. */}
      <ScrollView style={styles.stackScroll} contentContainerStyle={styles.stack} showsVerticalScrollIndicator={false}>
        {workspace.panels.map((panel) => (
          <PanelFrame key={panel.id} panel={panel} />
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  column: { flexDirection: 'row' },
  // A strip a little wider than it looks, so the cursor finds it.
  splitter: { width: 8, cursor: 'col-resize' } as never,
  stackScroll: { flex: 1, minWidth: 0 },
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
