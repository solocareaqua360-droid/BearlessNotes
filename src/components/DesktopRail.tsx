import { CONTROL, RADIUS, TYPE, useDeskColors } from '../theme/desktopTheme';
import { ReactNode, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import { useRailPanel, useRailTree } from '../navigation/navRail';
import { useInnerBackNow } from '../navigation/innerBack';
import { inShell, useStartFront } from '../navigation/desktopTabs';
import { useMainPaneUp } from '../navigation/mainPaneUp';
import { navigationRef } from '../navigationRef';
import { useWorkspace } from '../navigation/workspace';
import TemplatesGroup from './desktop/TemplatesGroup';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';

import { DESKTOP_RAIL_WIDTH, useDesktopNarrow, DESKTOP_RAIL_NARROW, DESKTOP_TITLE_BAND } from '../constants/desktop';

export const RAIL_WIDTH = DESKTOP_RAIL_WIDTH;

// Electron's own words for "this part moves the window" - harmless in a browser.
const DRAG = { WebkitAppRegion: 'drag' } as never;

// Only the calendar is left here (2026-09-30, the user's): the documents
// are the ⌂ tab, the boards and the databases open from the start page and
// from «Панелі → Бази». Where the calendar goes is still undecided.
const SECTIONS: { name: 'Календар'; icon: string }[] = [{ name: 'Календар', icon: 'calendar-outline' }];

// One folder in the tree, and its children under it.
type Node = { path: string; name: string; children: Node[] };

function buildTree(paths: string[]): Node[] {
  const roots: Node[] = [];
  const byPath = new Map<string, Node>();
  // Shortest first, so a parent always exists before the child that
  // needs it - a folder can be only a segment of a deeper one's path.
  for (const path of [...new Set(paths)].sort((a, b) => a.split('/').length - b.split('/').length)) {
    const parts = path.split('/');
    const node: Node = { path, name: parts[parts.length - 1], children: [] };
    byPath.set(path, node);
    const parent = parts.length > 1 ? byPath.get(parts.slice(0, -1).join('/')) : undefined;
    (parent ? parent.children : roots).push(node);
  }
  const sort = (list: Node[]) => {
    list.sort((a, b) => a.name.localeCompare(b.name));
    list.forEach((n) => sort(n.children));
  };
  sort(roots);
  return roots;
}

// The rail, where a cursor is pointing.
//
// It replaces the dock rather than joining it. The dock is a bar 60
// points tall floating at the bottom of the screen, which is where a
// thumb rests and where a cursor never goes - and on a 753-point-tall
// window it costs 96 of them, thirteen per cent of the height, to put
// navigation somewhere the pointer has to travel to.
//
// THE RULE, and it is the reason this is a column and not a menu:
// nothing here may cover the columns to its right. A folder opens
// INSIDE the rail, pushing what is below it down in the rail's own
// scroll. Popovers exist because a 60-point bar has nowhere to put
// anything; 240 by 753 has room, so they have no reason to exist. If
// something cannot fit here expanded, it does not belong here.
export default function DesktopRail({ footer }: { footer?: ReactNode }) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  // The frame is one tone (chrome); what is ON in it is a white card.
  const D = useDeskColors();
  // In the Mac app the rail is see-through: the window's own macOS material
  // (vibrancy, desktop/main.js) is what shows behind it. A browser has none.
  const vibrant = inShell();
  const on = { backgroundColor: vibrant ? 'rgba(255,255,255,0.7)' : D.card };
  const onCard = on;
  // The folders of the screen under the start page are not what is on
  // show while the start page is - home stands over the documents list.
  const startFront = useStartFront();
  const tree = useRailTree();
  const panel = useRailPanel();
  // The way OUT of a screen that was pushed over the tabs - a board, a
  // database, a note. It lived on the dock, and the dock is not here, so
  // hiding the dock took the only exit with it: the user opened a board
  // and had no way back at all. It belongs at the top of the rail, which
  // is where a Mac keeps "back" anyway.
  // The same way back as the main pane's arrow (navigation/innerBack): the
  // screen's own step first, then the level above it - never by history.
  const inner = useInnerBackNow();
  const paneUp = useMainPaneUp();
  const upRun = inner ?? paneUp;
  const leave = upRun ? { onLeave: upRun } : null;
  const workspace = useWorkspace();
  const narrow = useDesktopNarrow();
  const [accountOpen, setAccountOpen] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  // Which of the four is showing. Read through the global ref, not
  // through useNavigationState: this rail stands BESIDE the navigator
  // rather than inside one, and that hook refuses to answer anywhere
  // else - "Couldn't get the navigation state. Is your component inside
  // a navigator?", which it is not, and is not meant to be.
  const [section, setSection] = useState('Документи');
  useEffect(() => {
    const read = () => {
      if (!navigationRef.isReady()) return;
      const state = navigationRef.getRootState() as
        | { index?: number; routes?: { name: string; state?: { index?: number; routes?: { name: string }[] } }[] }
        | undefined;
      const route = state?.routes?.[state.index ?? 0];
      if (!route) return;
      if (route.name !== 'Tabs') {
        setSection(route.name);
        return;
      }
      setSection(route.state?.routes?.[route.state.index ?? 0]?.name ?? 'Документи');
    };
    read();
    return navigationRef.addListener('state', read);
  }, []);

  const roots = useMemo(() => buildTree(tree?.paths ?? []), [tree?.paths]);

  function toggle(path: string) {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }

  function renderNode(node: Node, depth: number) {
    const expanded = open.has(node.path);
    const here = tree?.current === node.path;
    return (
      <View key={node.path}>
        <Pressable
          style={[styles.folder, { paddingLeft: 10 + depth * 14 }, here && [styles.folderHere, on]]}
          onPress={() => tree?.onGo(node.path)}
        >
          {node.children.length > 0 ? (
            <Pressable hitSlop={6} onPress={() => toggle(node.path)} style={styles.twist}>
              <Ionicons
                name={expanded ? 'chevron-down' : 'chevron-forward'}
                size={13}
                color={theme.ink.faint}
              />
            </Pressable>
          ) : (
            <View style={styles.twist} />
          )}
          <Ionicons
            name={expanded ? 'folder-open-outline' : 'folder-outline'}
            size={15}
            color={here ? theme.accent : theme.ink.muted}
          />
          <Text style={[styles.folderName, here && styles.folderNameHere]} numberOfLines={1}>
            {node.name}
          </Text>
        </Pressable>
        {expanded && node.children.map((child) => renderNode(child, depth + 1))}
      </View>
    );
  }

  return (
    // A floating card on the window's ground, not a column with a line down
    // its side: space and a soft shadow set it apart (the way Craft does), and
    // the traffic lights sit inside it.
    <View
      style={[
        styles.rail,
        vibrant ? styles.railVibrant : { backgroundColor: D.ground },
        narrow && { width: DESKTOP_RAIL_NARROW },
      ]}
    >
      {vibrant && <RailFrame ground={D.ground} />}
      <View
        style={[
          styles.railCard,
          vibrant
            ? ({
                // ONLY the card shows the desktop, not the strip it stands in
                // (2026-10-01: "ніби щось відклеїлось" - the whole left strip
                // was see-through, cut off straight where the content began).
                // The ground round the card is painted by RailFrame below,
                // plain pieces of colour (a box-shadow spread did not reach
                // the window's edge in the real window).
                boxShadow: `inset 0 0 0 0.5px ${D.soft.dark ? 'rgba(255,255,255,0.10)' : 'rgba(255,255,255,0.7)'}`,
                borderRadius: RAIL_CARD_RADIUS,
                // The veil, at the user's word (2026-10-01): 65% of the
                // chrome tone in the middle of the card, easing away to
                // nothing at the top and the foot - so the desktop's own
                // colours show fully at the two ends and are held back
                // through the middle, where the rows are read. Eased
                // (smoothstep) stops, not a straight ramp.
                backgroundImage: railVeil(D.soft.dark ? '36,36,38' : '243,242,239', 0.65),
              } as never)
            : { backgroundColor: D.chrome, boxShadow: D.soft.shadow },
        ]}
      >
      {/* Where the traffic lights are. Empty, and draggable: it is the
          window's title bar now. */}
      <View style={[{ height: DESKTOP_TITLE_BAND - 10 }, DRAG]} />
      {/* Its place is kept when there is nowhere to go, so the sections
          under it never jump as it comes and goes. */}
      {leave ? (
        <Pressable style={[styles.leave, on]} onPress={leave.onLeave}>
          <Ionicons name="chevron-back" size={16} color={theme.ink.primary} />
          {!narrow && <Text style={styles.leaveLabel}>Назад</Text>}
        </Pressable>
      ) : (
        <View style={[styles.leave, styles.leaveEmpty]} />
      )}
      <View style={styles.sections}>
        {SECTIONS.map((s) => {
          const active = section === s.name;
          return (
            <Pressable
              key={s.name}
              style={[styles.section, active && [styles.sectionActive, on]]}
              onPress={() => {
                if (navigationRef.isReady()) navigationRef.navigate('Tabs', { screen: s.name } as never);
              }}
            >
              <Ionicons
                name={s.icon as never}
                size={17}
                color={active ? theme.accent : theme.ink.muted}
              />
              {!narrow && <Text style={[styles.sectionLabel, active && styles.sectionLabelActive]}>{s.name}</Text>}
            </Pressable>
          );
        })}
      </View>

      {/* The side panels: what opens to the right of the main pane. Each
          is a switch - open it, or put it away again. */}
      {!!workspace && (
        <View style={styles.panels}>
          {!narrow && <Text style={styles.panelsLabel}>Панелі</Text>}
          {(
            [
              { spec: { kind: 'databases' as const }, icon: 'apps-outline', label: 'Бази' },
              { spec: { kind: 'chat' as const }, icon: 'chatbubbles-outline', label: 'Чат' },
            ]
          ).map((item) => {
            const on = workspace.has(item.spec) && !workspace.hidden;
            return (
              <Pressable
                key={item.label}
                style={[styles.section, on && [styles.sectionActive, onCard]]}
                onPress={() => workspace.toggle(item.spec)}
              >
                <Ionicons name={item.icon as never} size={17} color={on ? theme.accent : theme.ink.muted} />
                {!narrow && <Text style={[styles.sectionLabel, on && styles.sectionLabelActive]}>{item.label}</Text>}
              </Pressable>
            );
          })}
          {workspace.panels.length > 0 && (
            <Pressable style={styles.section} onPress={workspace.toggleHidden}>
              <Ionicons
                name={(workspace.hidden ? 'chevron-back' : 'chevron-forward') as never}
                size={17}
                color={theme.ink.muted}
              />
              {!narrow && <Text style={styles.sectionLabel}>{workspace.hidden ? 'Показати колонку' : 'Сховати колонку'}</Text>}
            </Pressable>
          )}
        </View>
      )}

      {/* Saved windows - see navigation/workspaceTemplates. */}
      {!!workspace && !narrow && <TemplatesGroup />}

      {!!tree && !narrow && !startFront && (
        <>
          <View style={styles.rule} />
          {!!tree.onNewFolder && (
            <Pressable
              style={styles.newFolder}
              // Inside whichever folder the list is standing in, which is
              // what "new folder" means anywhere else a folder tree
              // exists.
              onPress={() => tree.onNewFolder?.(tree.current)}
            >
              <Ionicons name="add" size={15} color={theme.ink.muted} />
              <Text style={styles.newFolderLabel}>Нова папка</Text>
            </Pressable>
          )}
          <ScrollView style={styles.tree} contentContainerStyle={styles.treeContent}>
            <Pressable
              style={[styles.folder, styles.rootRow, tree.current === '' && !tree.bin?.active && [styles.folderHere, on]]}
              onPress={() => tree.onGo('')}
            >
              <View style={styles.twist} />
              <Ionicons
                name="home-outline"
                size={15}
                color={tree.current === '' ? theme.accent : theme.ink.muted}
              />
              <Text style={[styles.folderName, tree.current === '' && styles.folderNameHere]}>Усі</Text>
            </Pressable>
            {roots.map((node) => renderNode(node, 0))}
          </ScrollView>
          {!!tree.bin && (
            <Pressable
              style={[styles.folder, styles.bin, tree.bin.active && [styles.folderHere, on]]}
              onPress={tree.bin.onOpen}
            >
              <View style={styles.twist} />
              <Ionicons
                name="trash-outline"
                size={15}
                color={tree.bin.active ? theme.accent : theme.ink.muted}
              />
              <Text style={[styles.folderName, tree.bin.active && styles.folderNameHere]}>Кошик</Text>
              {tree.bin.count > 0 && <Text style={styles.count}>{tree.bin.count}</Text>}
            </Pressable>
          )}
        </>
      )}
      {/* Whatever the screen puts here - the calendar's month and the
          day's history. Under the sections, above the account, in the
          same place the folder tree stands for a list. */}
      {!!panel && !narrow && <View style={styles.panel}>{panel}</View>}

      {/* Whose data this is, at the foot of the column - where a sidebar
          keeps it. It is the same strip the phone shows across the top;
          only its place changes. */}
      {!!footer && !narrow && <View style={styles.footer}>{footer}</View>}
      {/* Narrow: the account is one icon at the foot of the strip, and what it
          says opens as a card beside it - a bar across the window's foot cost
          a whole line of a half-screen window. */}
      {!!footer && narrow && (
        <View style={styles.accountWrap}>
          <Pressable style={styles.section} onPress={() => setAccountOpen((v) => !v)} accessibilityLabel="Акаунт">
            <Ionicons name="person-circle-outline" size={19} color={accountOpen ? theme.accent : theme.ink.muted} />
          </Pressable>
          {accountOpen && (
            <>
              <Pressable style={styles.accountScrim} onPress={() => setAccountOpen(false)} />
              <View style={styles.accountCard}>{footer}</View>
            </>
          )}
        </View>
      )}
      </View>
    </View>
  );
}

// THE GROUND ROUND THE SEE-THROUGH CARD (the Mac app's): the window is
// transparent there (vibrancy), and only the card should show the desktop.
// Four bands for the gaps and four corner pieces whose radial gradient
// leaves exactly the card's rounded corner clear. Plain colour, nothing to
// touch.
// A veil of `rgb` at `peak` in the middle, easing to 0 at both ends.
function railVeil(rgb: string, peak: number): string {
  const stops: string[] = [];
  for (let i = 0; i <= 12; i++) {
    const at = i / 12;
    // 0 at the ends, 1 in the middle, eased (smoothstep of the distance).
    const t = 1 - Math.abs(at - 0.5) * 2;
    const eased = t * t * (3 - 2 * t);
    stops.push(`rgba(${rgb},${(eased * peak).toFixed(3)}) ${Math.round(at * 100)}%`);
  }
  return `linear-gradient(to bottom, ${stops.join(', ')})`;
}

const GAP = 8;
// CONCENTRIC, not equal (the user, 2026-10-01: "радіуси однакові, тому вони
// ніколи не зійдуться"): a corner nested in another at a gap looks parallel
// only when its radius is the outer one LESS the gap. The outer one is the
// window's own - macOS 26 rounds a window like this about 16 points, which
// at the shell's 0.95 zoom is ~17 of the page's - so the card is 17 - 8.
const WINDOW_RADIUS = 17;
export const RAIL_CARD_RADIUS = WINDOW_RADIUS - GAP;
function RailFrame({ ground }: { ground: string }) {
  const r = RAIL_CARD_RADIUS;
  const band = { position: 'absolute', backgroundColor: ground } as const;
  const corner = (at: string) =>
    ({
      position: 'absolute',
      width: r,
      height: r,
      backgroundImage: `radial-gradient(circle at ${at}, transparent ${r - 0.5}px, ${ground} ${r}px)`,
    }) as never;
  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      <View style={[band, { left: 0, right: 0, top: 0, height: GAP }]} />
      <View style={[band, { left: 0, right: 0, bottom: 0, height: GAP }]} />
      <View style={[band, { left: 0, top: 0, bottom: 0, width: GAP }]} />
      <View style={[band, { right: 0, top: 0, bottom: 0, width: GAP }]} />
      <View style={[corner('100% 100%'), { left: GAP, top: GAP }]} />
      <View style={[corner('0% 100%'), { right: GAP, top: GAP }]} />
      <View style={[corner('100% 0%'), { left: GAP, bottom: GAP }]} />
      <View style={[corner('0% 0%'), { right: GAP, bottom: GAP }]} />
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  rail: {
    width: RAIL_WIDTH,
    // Its own ground, and it had none - so on a dark theme the light
    // backing of the window showed straight through it and the labels
    // went almost invisible on it. A column that stands beside every
    // screen has to paint itself; only the screens have a background
    // of their own.
    backgroundColor: t.ground,
    padding: 8,
    paddingRight: 0,
    // Over the main pane's edge, so the account card can hang out of the strip.
    zIndex: 40,
  },
  // The Mac app's: the strip itself is clear (its ground comes from the
  // card's shadow), and a gap on the right too, so the card stands off the
  // content as it does off the window.
  railVibrant: {
    backgroundColor: 'transparent',
    paddingRight: 8,
  },
  railCard: {
    flex: 1,
    borderRadius: RADIUS.panel,
    paddingBottom: 10,
  },
  leave: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 30,
    marginHorizontal: 8,
    marginBottom: 6,
    paddingHorizontal: 8,
    borderRadius: RADIUS.control,
    backgroundColor: t.selected,
  },
  leaveEmpty: {
    backgroundColor: 'transparent',
  },
  leaveLabel: {
    fontSize: TYPE.sm,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  sections: {
    paddingHorizontal: 8,
    gap: 2,
  },
  accountWrap: {
    marginTop: 'auto' as never,
    paddingHorizontal: 8,
  },
  accountScrim: {
    position: 'fixed',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
  } as never,
  accountCard: {
    position: 'absolute',
    left: 52,
    bottom: 0,
    width: 260,
    padding: 10,
    borderRadius: RADIUS.menu,
    backgroundColor: t.paper.fill,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.edge.hairline,
    boxShadow: '0px 8px 24px rgba(0,0,0,0.16)',
    zIndex: 60,
  } as never,
  panels: {
    paddingHorizontal: 8,
    gap: 2,
    marginTop: 10,
  },
  panelsLabel: {
    fontSize: TYPE.xs,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.faint,
    paddingHorizontal: 10,
    paddingBottom: 2,
  },
  section: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: CONTROL.nav,
    paddingHorizontal: 10,
    borderRadius: RADIUS.control,
  },
  sectionActive: {
    backgroundColor: t.selected,
  },
  sectionLabel: {
    fontSize: TYPE.sm,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
  },
  sectionLabelActive: {
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  // Space where a line used to be.
  rule: {
    height: 0,
    marginVertical: 8,
  },
  newFolder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: CONTROL.tab,
    marginHorizontal: 8,
    marginBottom: 2,
    paddingHorizontal: 10,
    borderRadius: RADIUS.control,
  },
  newFolderLabel: {
    fontSize: TYPE.xs,
    fontFamily: FONT_REGULAR,
    color: t.ink.faint,
  },
  tree: {
    flex: 1,
  },
  treeContent: {
    paddingHorizontal: 8,
    paddingBottom: 8,
  },
  rootRow: {
    paddingLeft: 10,
  },
  folder: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    height: CONTROL.tab,
    paddingRight: 8,
    borderRadius: RADIUS.control,
  },
  folderHere: {
    backgroundColor: t.selected,
  },
  twist: {
    width: 14,
    alignItems: 'center',
  },
  folderName: {
    flex: 1,
    fontSize: TYPE.sm,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
  },
  folderNameHere: {
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  count: {
    fontSize: TYPE.xs,
    fontFamily: FONT_REGULAR,
    color: t.ink.faint,
  },
  bin: {
    marginTop: 4,
    marginHorizontal: 8,
  },
  panel: {
    flex: 1,
    minHeight: 0,
    paddingTop: 10,
    // What does not fit is cut, not drawn over the account strip below.
    overflow: 'hidden',
  },
  // Set apart by space, not a line.
  footer: {
    marginTop: 12,
    paddingTop: 4,
  },
});
