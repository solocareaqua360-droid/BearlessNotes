import { StyleSheet, View } from 'react-native';
import { useWallpaperVeil } from '../theme/ThemeProvider';

// The flat ground a screen stands on in the soft style - solid as always,
// or, under the phone's own wallpaper (Settings → «Шпалери телефона»),
// thinned to the chosen veil so the wallpaper shows through. Every soft
// screen paints its ground through this, or that screen alone would hide
// the wallpaper.
export default function ScreenGround({ color }: { color: string }) {
  const veil = useWallpaperVeil();
  return (
    <View
      style={[StyleSheet.absoluteFill, { backgroundColor: color }, veil !== null && { opacity: veil }]}
      pointerEvents="none"
    />
  );
}
