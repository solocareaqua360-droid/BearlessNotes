import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavDockActions, useNavDockBeads, useNavDockContext } from '../navigation/navDock';
import { MAX_CONTENT_WIDTH } from './ContentColumn';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';

// Where a cursor is pointing, this is the dock - unrolled.
//
// It renders the very same things the dock does, off the very same
// publications: the path the screen is standing in, what it can do, and
// its two beads. Nothing here is a second implementation, which is the
// point - a screen that gains a button gains it in both places, and the
// two can never drift.
//
// Why a row above the list rather than a bar at the bottom: a bar at the
// bottom of the screen is where a THUMB rests. A pointer starts at what
// it last clicked, which is the list, so the controls belong at the top
// of it - and the path belongs there too, being a line rather than a
// column (which is why it is here and not in the rail).
//
// Held to the content's own 760 rather than the full window, so it lines
// up with the cards instead of running away to the edges - the same
// reason ContentColumn exists at all.

function ActionIcon({ icon, size, color }: { icon: string; size: number; color: string }) {
  // "mc:<name>" is a MaterialCommunityIcons one - see DockAction.icon.
  if (icon.startsWith('mc:')) {
    return <MaterialCommunityIcons name={icon.slice(3) as never} size={size} color={color} />;
  }
  return <Ionicons name={icon as never} size={size} color={color} />;
}

// What it takes off the top of the window. Anything drawn in a PORTAL
// sits at window level and cannot see this row taking its space, so it
// has to be told - the project badge in the editor is exactly that, and
// landed on top of these buttons until it was.
export const DESKTOP_TOOLBAR_HEIGHT = 46;

export default function DesktopToolbar() {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const context = useNavDockContext();
  const actions = useNavDockActions();
  const beads = useNavDockBeads();

  // «Папки» stays, and dropping it was a mistake worth writing down.
  //
  // The rail did take over the folder TREE, so the button no longer
  // opens something that is not already open - but the drawer behind it
  // was never only folders. It also holds the tag FILTER (the
  // Мульти/Ізолюючий choice), the tag editing, and the three-way mode
  // switch that decides whether this list is in «Провідник» at all.
  // Removing the button took all three away with it, and on the Mac
  // that left no way to make a folder at all.
  //
  // So it is back, under the name of what it actually is now.
  const shown = (actions ?? []).map((a) => (a.key === 'tags' ? { ...a, label: 'Теги' } : a));

  // Words under the icons only while they fit. A note publishes seven
  // actions - «Полотно», «Референси», «Вибір», «Вигляд», «Проект»,
  // «Експорт», «Видалити» - and seven labelled buttons are wider than
  // the row, so they ran back over the path on the left and the two
  // were drawn on top of each other. Past five it is icons, which is
  // what the dock itself does when it runs out of room.
  const withLabels = shown.length <= 5;

  const crumbs = context?.kind === 'path' ? context.crumbs : [];
  const onGo = context?.kind === 'path' ? context.onGo : undefined;

  // Nothing published means nothing to show - a board, say, which owns
  // its whole window.
  if (!shown.length && !beads.left && !beads.right && crumbs.length === 0) return null;

  return (
    <View style={styles.frame} pointerEvents="box-none">
      <View style={styles.bar}>
        <View style={styles.crumbs}>
          {crumbs.length > 0 && (
            <Pressable style={styles.crumb} onPress={() => onGo?.('')}>
              <Ionicons name="home-outline" size={14} color={theme.ink.muted} />
            </Pressable>
          )}
          {crumbs.map((name, index) => {
            const last = index === crumbs.length - 1;
            return (
              <View key={`${name}-${index}`} style={styles.crumbCell}>
                <Ionicons name="chevron-forward" size={12} color={theme.ink.faint} />
                <Pressable
                  style={styles.crumb}
                  onPress={() => onGo?.(crumbs.slice(0, index + 1).join('/'))}
                >
                  <Text style={[styles.crumbLabel, last && styles.crumbLast]} numberOfLines={1}>
                    {name}
                  </Text>
                </Pressable>
              </View>
            );
          })}
        </View>

        <View style={styles.controls}>
          {!!beads.left && (
            <Pressable
              style={[styles.button, beads.left.active && styles.buttonOn]}
              onPress={beads.left.onPress}
              onLongPress={beads.left.onLongPress}
            >
              <ActionIcon icon={beads.left.icon} size={17} color={theme.ink.primary} />
            </Pressable>
          )}
          {shown.map((action) => (
            <Pressable
              key={action.key}
              style={[styles.button, action.active && styles.buttonOn]}
              onPress={action.onPress}
              onLongPress={action.onLongPress}
            >
              <ActionIcon icon={action.icon} size={17} color={theme.ink.primary} />
              {!!action.label && withLabels && <Text style={styles.buttonLabel}>{action.label}</Text>}
            </Pressable>
          ))}
          {!!beads.right && (
            // The one filled button: the thing this screen is FOR.
            <Pressable
              style={styles.primary}
              onPress={beads.right.onPress}
              onLongPress={beads.right.onLongPress}
            >
              <Ionicons name="add" size={18} color={theme.onAccent} />
            </Pressable>
          )}
        </View>
      </View>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  frame: {
    width: '100%',
    alignItems: 'center',
    // Same as the rail's: this strip sits above the screens rather than
    // inside one, so nothing else paints behind it.
    backgroundColor: t.ground,
  },
  bar: {
    width: '100%',
    maxWidth: MAX_CONTENT_WIDTH,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 6,
  },
  crumbs: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    // Both, and they are not the same thing: minWidth lets the row
    // shrink below its content, overflow stops what is left of the
    // content being painted outside it. Without the pair, a long path
    // and a full set of buttons met in the middle.
    minWidth: 0,
    overflow: 'hidden',
  },
  crumbCell: {
    flexDirection: 'row',
    alignItems: 'center',
    minWidth: 0,
  },
  crumb: {
    paddingHorizontal: 4,
    paddingVertical: 3,
    borderRadius: 6,
  },
  crumbLabel: {
    flexShrink: 1,
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
  },
  crumbLast: {
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    // Never squeezed: a button that has shrunk is a button that cannot
    // be hit. The path gives way instead.
    flexShrink: 0,
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    height: 30,
    paddingHorizontal: 9,
    borderRadius: 8,
  },
  buttonOn: {
    backgroundColor: t.selected,
  },
  buttonLabel: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
  },
  primary: {
    width: 30,
    height: 30,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: t.accent,
    marginLeft: 4,
  },
});
