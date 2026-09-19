import { useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';

// One slider, its track painted as a gradient of whatever colours the
// caller hands it - a rainbow strip for hue, grey-to-colour for
// saturation, black-to-colour-to-white for lightness. Lives on its own
// now that both the scheme wheel's per-stop controls and anything else
// that wants a coloured track can reach for it.
//
// PanResponder rather than gesture-handler: one drag, nothing competing
// to arbitrate against, same reasoning SketchEditor's own toolbar drag
// uses.
export default function GradientSlider({
  value,
  stops,
  onChange,
}: {
  // 0 to 1.
  value: number;
  // 2 or more colours, evenly spaced across the track.
  stops: string[];
  onChange: (v: number) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  // Read through a ref: PanResponder is built once, and a handler that
  // closed over the first render's width would divide by a stale
  // number forever.
  const widthRef = useRef(0);
  widthRef.current = trackWidth;
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => {
        if (widthRef.current <= 0) return;
        changeRef.current(Math.max(0, Math.min(1, e.nativeEvent.locationX / widthRef.current)));
      },
      onPanResponderMove: (e) => {
        if (widthRef.current <= 0) return;
        changeRef.current(Math.max(0, Math.min(1, e.nativeEvent.locationX / widthRef.current)));
      },
    })
  ).current;
  return (
    <View
      style={styles.track}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      {...responder.panHandlers}
    >
      {trackWidth > 0 && (
        <Svg width={trackWidth} height={28} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="gsTrack" x1="0" y1="0" x2="1" y2="0">
              {stops.map((c, i) => (
                <Stop key={i} offset={i / (stops.length - 1)} stopColor={c} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect width={trackWidth} height={28} rx={14} fill="url(#gsTrack)" />
        </Svg>
      )}
      <View pointerEvents="none" style={[styles.thumb, { left: `${value * 100}%` }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
  },
  thumb: {
    position: 'absolute',
    top: -2,
    width: 4,
    height: 32,
    marginLeft: -2,
    borderRadius: 2,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.4)',
  },
});
