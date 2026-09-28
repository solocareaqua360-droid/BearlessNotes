import { ScrollView, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import DockFrost, { FlatFrostContext } from './DockFrost';
import { ActionButton, Bead } from './ContextDock';
import { topBarFrame } from './TopNavBar';
import { DOCK_BOTTOM, DOCK_PIECE_RADIUS } from '../navigation/dockGeometry';
import { DockAction, DockBead } from '../navigation/navDock';
import { useLift, useTheme } from '../theme/ThemeProvider';

// The same numbers as the dock's own two-bead row and short strip (see
// ContextDock), so the drawer's buttons are the dock's buttons.
const TWO_BEAD = 56;
const STRIP_BUTTON_W = 84;
const WRAP_PAD = 6;

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
}: {
  width: number;
  beads: { left: DockBead | null; right: DockBead | null };
  actions: DockAction[] | null;
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
