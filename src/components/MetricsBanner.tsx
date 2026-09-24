import { Dimensions, PixelRatio, StyleSheet, Text, View, useWindowDimensions } from 'react-native';

// A TEMPORARY BANNER, and the only reason it exists is that the app is
// unreadable on the thing it is meant to describe.
//
// In Samsung DeX everything draws as mush: the user cannot read the
// numbers that would say WHY, and asking them to was asking them to read
// an unreadable screen. So the numbers are drawn here instead - at the
// top of every screen, in the largest type the app has, on solid black
// with white on it - big enough to survive being photographed off a
// monitor that is already illegible.
//
// It answers one question: does the window this app lays out against
// match the display it is drawn on, and at what density. Everything
// about DeX follows from that, and nothing can be decided without it.
//
// REMOVE THIS once the numbers have been read. It is scaffolding.
export default function MetricsBanner() {
  const { width, height } = useWindowDimensions();
  const screen = Dimensions.get('screen');
  const density = PixelRatio.get();
  return (
    <View style={styles.banner} pointerEvents="none">
      <Text style={styles.line}>W {Math.round(width)}x{Math.round(height)}</Text>
      <Text style={styles.line}>S {Math.round(screen.width)}x{Math.round(screen.height)}</Text>
      <Text style={styles.line}>D {density} F {PixelRatio.getFontScale().toFixed(2)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    backgroundColor: '#000',
    paddingVertical: 8,
    paddingHorizontal: 12,
    zIndex: 9999,
  },
  line: {
    color: '#fff',
    // Deliberately enormous. On a phone it is oversized and ugly; on the
    // screen it was written for it is the smallest size that can be read
    // at all.
    fontSize: 44,
    lineHeight: 52,
    fontWeight: '900',
  },
});
