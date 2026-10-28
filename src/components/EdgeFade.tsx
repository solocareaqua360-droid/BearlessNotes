import { useId, useState, memo } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import { useRenderTimer } from '../utils/perfWatch';
import { FEATURES } from '../features';

// Content scrolling past an edge dissolves into the surface behind it
// instead of being cut off - the user's own words for the hard edge it
// replaces: "ніби зліплено із картонок, а не застосунок". A strip of the
// surface's own colour, solid at the edge and gone a little way in.
//
// Built by the three rules the memory gradient_fades_trap paid for:
// the Svg gets MEASURED numbers (a root at "100%" did not paint at all
// here), the gradient is measured in the box's own units, and the ramp
// is a curve over several stops - a linear one reads as a solid band
// that gives up all at once. Stops always run in ascending order; the
// bottom edge mirrors the values, not the offsets.
const STOPS = 8;

// `solid`: points at the edge that stay fully covered before the fade begins.
// `bar`: this is the fade under the top bar. With the bar's capsule gone (features.openTopBar) the name is plain text, so the
// fade stays solid down to the name and melts only below the bar - a list scrolled under it no longer shows through the name.
// `bar`: true when `height` ends at the bar's foot (16 more points of fade are added below it, short of where a list at rest
// begins); 'roomy' when `height` already runs 20 past the foot (the explorer's own top room) and nothing is added.
function EdgeFade({ edge, color, height: given = 36, solid: givenSolid = 0, bar }: { edge: 'top' | 'bottom'; color: string; height?: number; solid?: number; bar?: boolean | 'roomy' }) {
  useRenderTimer('Край, що тане');
  const open = !!bar && FEATURES.openTopBar;
  const height = open && bar !== 'roomy' ? given + 16 : given;
  const solid = open ? Math.max(givenSolid, bar === 'roomy' ? given - 20 : given - 8) : givenSolid;
  const [width, setWidth] = useState(0);
  const id = `fade${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  // A solid part leaves the fade a shorter run: more stops keep it smooth.
  const count = solid > 0 ? STOPS * 2 : STOPS;
  const stops = Array.from({ length: count }, (_, i) => {
    const u = i / (count - 1);
    // How solid the surface is at this offset from the top of the strip.
    const inward = edge === 'top' ? u : 1 - u;
    const past = solid > 0 ? Math.max(0, (inward * height - solid) / Math.max(1, height - solid)) : inward;
    return { offset: u, opacity: Math.pow(1 - past, 2) };
  });
  return (
    <View
      pointerEvents="none"
      style={[styles.strip, edge === 'top' ? styles.top : styles.bottom, { height }]}
      onLayout={(e) => {
        const w = e.nativeEvent.layout.width;
        setWidth((prev) => (prev === w ? prev : w));
      }}
    >
      {width > 0 && (
        <Svg width={width} height={height}>
          <Defs>
            <LinearGradient id={id} x1="0" y1="0" x2="0" y2={height} gradientUnits="userSpaceOnUse">
              {stops.map((s, i) => (
                <Stop key={i} offset={s.offset} stopColor={color} stopOpacity={s.opacity} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect x={0} y={0} width={width} height={height} fill={`url(#${id})`} />
        </Svg>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  top: {
    top: 0,
  },
  bottom: {
    bottom: 0,
  },
});

// Plain props only, so it skips the renders of the screen around it.
export default memo(EdgeFade);
