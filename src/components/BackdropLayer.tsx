import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useActiveBackdropOverride, useTheme } from '../theme/ThemeProvider';
import { useCachedAttachment } from '../hooks/useCachedAttachment';
import { listenWallpaperBoost, wallpaperBoosted } from '../utils/wallpaperBoost';

// THE USER'S OWN PICTURE under the whole app («Фон застосунку» →
// «Зображення»), blurred as the slider says. Drawn ONCE, at the root,
// under the navigator - the soft style's screens only lay their veil
// over it (ScreenGround).
//
// Two things keep it from blinking while the slider moves (2026-10-02:
// "при руху повзунка періодично блимає фон телефона"):
// - the theme's own ground lies under it, so nothing behind the app
//   (the window still shows the phone's wallpaper, from the APK that
//   tried it) can ever show through;
// - a new blur is drawn OVER the last one and the last one stays until
//   the new one has loaded, so there is never a frame with no picture.
//
// While the calendar or the databases are out (wallpaperBoost) the blur
// is twice as deep, never under a soft one - option Б.
const MAX_BLUR = 30;
const BOOST_MIN = 12;

export default function BackdropLayer() {
  const theme = useTheme();
  const override = useActiveBackdropOverride();
  const image = override?.type === 'image' ? override : null;
  const status = useCachedAttachment(image?.uri, image?.driveFileId);
  const [boosted, setBoosted] = useState(wallpaperBoosted);
  useEffect(() => listenWallpaperBoost(setBoosted), []);
  const base = image ? (image.blur / 100) * MAX_BLUR : 0;
  const wanted = Math.round(boosted ? Math.min(MAX_BLUR * 2, Math.max(base * 2, BOOST_MIN)) : base);
  // The blur on screen, and the one loading over it.
  const [shown, setShown] = useState<number | null>(null);
  const uri = image?.uri;
  useEffect(() => setShown(null), [uri]);
  if (!image || status !== 'ready') return null;
  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: theme.ground }]} pointerEvents="none">
      {/* Keyed by the blur itself, the same key whether it is the one
          loading or the one shown - so the loaded one is never mounted
          again (a fresh mount would decode again, and blink). */}
      {(shown === null || shown === wanted ? [wanted] : [shown, wanted]).map((radius) => (
        <Image
          key={`blur-${radius}`}
          source={{ uri: image.uri }}
          blurRadius={radius}
          resizeMode="cover"
          style={StyleSheet.absoluteFill}
          onLoad={radius === wanted ? () => setShown(radius) : undefined}
        />
      ))}
    </View>
  );
}
