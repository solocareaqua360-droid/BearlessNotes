import { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { GLASS_ISLAND } from '../constants/glass';

// A capsule squeezed to a line at the point where a scrolling row of pills
// runs out of room - the "tunnel" they slide into rather than being cut
// off mid-word against whatever sits to their right.
//
// It's one oval drawn as two halves on either side of the row: the near
// half sits UNDER the pills (an arriving pill covers its edge), the far
// half sits OVER them (its edge covers the leaving pill) - which is what
// makes it read as a tunnel rather than as one more pill next to the row.
// Purely visual - neither half catches touches.
//
// Geometry assumes the child is a ProjectTabsRow (its pills are 32px tall
// with 10px of padding under them) and that the child itself clips its
// content at this wrapper's right edge. Both halves hang 2px past that
// edge, so a pill runs out of view under the far half, 2px inside the
// oval's far border, never against its near one.
const TUNNEL_WIDTH = 10;

export default function TabsTunnel({ children }: { children: ReactNode }) {
  return (
    <View style={styles.wrap}>
      <View style={styles.near} pointerEvents="none">
        <View style={[styles.oval, styles.ovalNear]} />
      </View>
      {children}
      <View style={styles.far} pointerEvents="none">
        <View style={[styles.oval, styles.ovalFar]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Takes whatever width the row's other children leave, and lets the
  // tabs scroll within it - minWidth: 0 is what lets a flex child shrink
  // below its content instead of pushing its siblings off the row.
  wrap: {
    flex: 1,
    minWidth: 0,
  },
  // The two clipping windows the oval is drawn through - each shows
  // exactly one half of it, so the halves never overlap (two layers of the
  // same glass would paint a visibly darker seam down the middle).
  // Overhang a pill by 4px at each end so the oval reads as the thing the
  // pills disappear into, not as another pill.
  near: {
    position: 'absolute',
    right: TUNNEL_WIDTH / 2 - 2,
    top: -4,
    bottom: 6,
    width: TUNNEL_WIDTH / 2,
    overflow: 'hidden',
  },
  far: {
    position: 'absolute',
    right: -2,
    top: -4,
    bottom: 6,
    width: TUNNEL_WIDTH / 2,
    overflow: 'hidden',
  },
  // The oval itself, at full width inside each half-width window - the
  // window's overflow clip is what leaves only one half of it visible.
  // Same glass as every other capsule on these screens, deliberately: an
  // opaque one did hide the pill, but at the near edge, which read as the
  // pill simply ending early.
  oval: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: TUNNEL_WIDTH,
    borderRadius: 999,
    backgroundColor: GLASS_ISLAND,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  // Fainter border on the near half: the pills that cover it are glass
  // too, so at full strength the line still showed through them.
  ovalNear: { left: 0, borderColor: 'rgba(255,255,255,0.18)' },
  ovalFar: { right: 0 },
});
