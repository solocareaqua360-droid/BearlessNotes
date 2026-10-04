import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import SoftIcon from './SoftIcon';
import type { SoftTokens } from '../theme/soft';
import { SOFT_REGULAR } from '../utils/fonts';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DockFrost, { FlatFrostContext } from './DockFrost';
import { ActionButton, Bead, SOFT_DOCK_GLYPHS } from './ContextDock';
import { topBarFrame } from './TopNavBar';
import { DOCK_BOTTOM, DOCK_PIECE_RADIUS } from '../navigation/dockGeometry';
import { DockAction, DockBead } from '../navigation/navDock';
import { useLift, useTheme } from '../theme/ThemeProvider';

// The same numbers as the dock's own two-bead row and short strip (see
// ContextDock), so the drawer's buttons are the dock's buttons.
const TWO_BEAD = 56;
const STRIP_BUTTON_W = 84;
const WRAP_PAD = 6;
// How far a circle set into the search field sits in from its edges - as
// in ContextDock.
const FIELD_INSET = 5;

// THE DOCK, DRAWN INSIDE A DRAWER - the calendar's: its two beads (search,
// the pencil) or, while the day's blocks are being chosen, the strip of
// what can be done to them. Laid out to the drawer's width and moving
// with it, flat glass on its opaque surface - the "прив'язані" the user
// asked for, instead of the window's dock standing over the drawer's
// edge. The window's dock fades out while the drawer is out (DockPortal).
export default function InlineDock({
  width,
  beads,
  actions,
  soft,
  back,
}: {
  // THE SAME DOCK AS THE WINDOW'S, the experiment of 2026-10-04 (see
  // ContextDock's `merged`): given a way back, the soft dock is the search
  // field holding "+" (or the pencil) as a small circle, and the way back
  // is the round button on the right.
  back?: () => void;
  width: number;
  beads: { left: DockBead | null; right: DockBead | null };
  actions: DockAction[] | null;
  // The soft style (theme/soft) - the same two pieces the window's dock
  // draws on a soft screen: a search field and a round write button, or
  // one quiet capsule of actions.
  soft?: SoftTokens | null;
}) {
  const theme = useTheme();
  const lift = useLift();
  const insets = useSafeAreaInsets();
  const frame = topBarFrame(width);
  const bottom = DOCK_BOTTOM + insets.bottom + WRAP_PAD;

  if (actions && actions.length > 0) {
    const short = actions.length <= 5;
    const buttonW = short ? Math.min(STRIP_BUTTON_W, Math.floor(frame.width / actions.length)) : Math.floor(frame.width / 5);
    const stripW = short ? buttonW * actions.length : frame.width;
    if (soft) {
      return (
        <View
          pointerEvents="box-none"
          style={[styles.row, { bottom, left: frame.left + (frame.width - stripW) / 2, width: stripW }]}
        >
          <View
            style={{ width: stripW, height: TWO_BEAD, borderRadius: TWO_BEAD / 2, backgroundColor: soft.chrome, boxShadow: soft.shadow, overflow: 'hidden' }}
          >
            <ScrollView horizontal scrollEnabled={!short} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stripContent}>
              {actions.map((action) => (
                <ActionButton key={action.key} action={action} width={buttonW} height={TWO_BEAD - 4} iconSize={20} theme={theme} onDone={() => {}} soft={soft} />
              ))}
            </ScrollView>
          </View>
        </View>
      );
    }
    return (
      <FlatFrostContext.Provider value>
        <View
          pointerEvents="box-none"
          style={[styles.row, { bottom, left: frame.left + (frame.width - stripW) / 2, width: stripW }]}
        >
          <DockFrost style={[styles.strip, { width: stripW, height: TWO_BEAD }, lift]} radius={DOCK_PIECE_RADIUS}>
            <ScrollView horizontal scrollEnabled={!short} showsHorizontalScrollIndicator={false} contentContainerStyle={styles.stripContent}>
              {actions.map((action, i) => (
                <View key={action.key} style={styles.slot}>
                  {short && i > 0 && <View style={[styles.divider, { backgroundColor: theme.glass.inkMuted }]} />}
                  <ActionButton action={action} width={buttonW} height={TWO_BEAD - 4} iconSize={19} theme={theme} onDone={() => {}} />
                </View>
              ))}
            </ScrollView>
          </DockFrost>
        </View>
      </FlatFrostContext.Provider>
    );
  }

  if (soft) {
    const surface = { backgroundColor: soft.chrome, boxShadow: soft.shadow, height: TWO_BEAD, borderRadius: TWO_BEAD / 2 };
    const left = beads.left;
    const right = beads.right;
    const leftIcon = left ? SOFT_DOCK_GLYPHS[left.icon] : undefined;
    const rightIcon = right ? SOFT_DOCK_GLYPHS[right.icon] : undefined;
    if (back && left && !left.active) {
      const circle = TWO_BEAD - FIELD_INSET * 2;
      const inset = (filled: boolean, pressed: boolean) => [
        styles.softButton,
        {
          width: circle,
          height: circle,
          borderRadius: circle / 2,
          marginRight: FIELD_INSET,
          backgroundColor: filled ? soft.ink : pressed ? soft.line : soft.fillSolid,
        },
      ];
      return (
        <View pointerEvents="box-none" style={[styles.row, { bottom, left: frame.left, width: frame.width, gap: 10 }]}>
          <View style={[styles.softField, surface, { paddingLeft: 0, paddingRight: 0, gap: 0 }]}>
            <Pressable
              onPress={left.onPress}
              onLongPress={left.onLongPress}
              disabled={left.dimmed}
              accessibilityLabel="Пошук"
              style={styles.softFieldPart}
            >
              {leftIcon ? (
                <SoftIcon name={leftIcon} size={20} color={soft.ink2} />
              ) : (
                <Ionicons name={left.icon as never} size={19} color={soft.ink2} />
              )}
              <Text style={[styles.softFieldText, { color: soft.ink3 }]} numberOfLines={1}>
                Пошук
              </Text>
            </Pressable>
            {right?.extra && (
              <Pressable
                onPress={right.extra.onPress}
                accessibilityLabel={right.extra.label}
                style={({ pressed }) => inset(!!right.extra?.active, pressed)}
              >
                <Ionicons name={right.extra.icon as never} size={20} color={right.extra.active ? soft.card : soft.ink} />
              </Pressable>
            )}
            {right && (
              <Pressable
                onPress={right.onPress}
                onLongPress={right.onLongPress}
                disabled={right.dimmed}
                accessibilityLabel="Створити"
                style={({ pressed }) => [inset(false, pressed), right.dimmed && { opacity: 0.5 }]}
              >
                {rightIcon ? (
                  <SoftIcon name={rightIcon} size={22} color={soft.ink} />
                ) : (
                  <Ionicons name={right.icon as never} size={21} color={soft.ink} />
                )}
              </Pressable>
            )}
          </View>
          <Pressable onPress={back} accessibilityLabel="Назад" style={[styles.softButton, surface, { width: TWO_BEAD }]}>
            <Ionicons name="chevron-back" size={22} color={soft.ink} />
          </Pressable>
        </View>
      );
    }
    return (
      <View pointerEvents="box-none" style={[styles.row, { bottom, left: frame.left, width: frame.width, gap: 10 }]}>
        {left ? (
          <Pressable
            onPress={left.onPress}
            onLongPress={left.onLongPress}
            disabled={left.dimmed}
            accessibilityLabel={left.active ? 'Закрити пошук' : 'Пошук'}
            style={[styles.softField, surface]}
          >
            {leftIcon ? (
              <SoftIcon name={leftIcon} size={20} color={soft.ink2} />
            ) : (
              <Ionicons name={left.icon as never} size={19} color={soft.ink2} />
            )}
            <Text style={[styles.softFieldText, { color: soft.ink3 }]} numberOfLines={1}>
              {left.active ? 'Закрити пошук' : 'Пошук'}
            </Text>
          </Pressable>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        {right?.extra && (
          <Pressable
            onPress={right.extra.onPress}
            accessibilityLabel={right.extra.label}
            style={[styles.softButton, surface, { width: TWO_BEAD }, right.extra.active && { backgroundColor: soft.ink }]}
          >
            <Ionicons name={right.extra.icon as never} size={21} color={right.extra.active ? soft.card : soft.ink} />
          </Pressable>
        )}
        {right && (
          <Pressable
            onPress={right.onPress}
            onLongPress={right.onLongPress}
            disabled={right.dimmed}
            accessibilityLabel="Писати"
            style={[styles.softButton, surface, { width: TWO_BEAD }]}
          >
            {rightIcon ? (
              <SoftIcon name={rightIcon} size={23} color={soft.ink} />
            ) : (
              <Ionicons name={right.icon as never} size={21} color={soft.ink} />
            )}
          </Pressable>
        )}
      </View>
    );
  }

  return (
    <FlatFrostContext.Provider value>
      <View
        pointerEvents="box-none"
        style={[styles.row, styles.beads, { bottom, left: frame.left + TWO_BEAD / 2, width: frame.width - TWO_BEAD }]}
      >
        {beads.left ? <Bead bead={beads.left} theme={theme} lift={lift} size={TWO_BEAD} height={TWO_BEAD} /> : <View style={{ width: TWO_BEAD }} />}
        {beads.right ? <Bead bead={beads.right} theme={theme} lift={lift} size={TWO_BEAD} height={TWO_BEAD} /> : <View style={{ width: TWO_BEAD }} />}
      </View>
    </FlatFrostContext.Provider>
  );
}

const styles = StyleSheet.create({
  row: {
    position: 'absolute',
    flexDirection: 'row',
  },
  beads: {
    justifyContent: 'space-between',
  },
  softField: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 18,
  },
  softFieldPart: {
    flex: 1,
    height: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 18,
  },
  softFieldText: {
    flex: 1,
    fontSize: 15,
    fontFamily: SOFT_REGULAR,
  },
  softButton: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  strip: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  stripContent: {
    alignItems: 'center',
  },
  slot: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  divider: {
    position: 'absolute',
    left: 0,
    top: '25%',
    height: '50%',
    width: StyleSheet.hairlineWidth,
    opacity: 0.45,
  },
});
