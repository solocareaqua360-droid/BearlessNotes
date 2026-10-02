import { useEffect, useState } from 'react';
import { Image, StyleSheet, View } from 'react-native';
import { useActiveBackdropOverride } from '../theme/ThemeProvider';
import { useCachedAttachment } from '../hooks/useCachedAttachment';
import { listenWallpaperBoost, wallpaperBoosted } from '../utils/wallpaperBoost';

// THE USER'S OWN PICTURE under the whole app («Фон застосунку» →
// «Зображення»), blurred as the slider says. Drawn ONCE, at the root,
// under the navigator - the soft style's screens only lay their veil
// over it (ScreenGround), the way they do over the phone's wallpaper.
// The wallpaper itself could not be blurred: the window's blur needs a
// translucent window (the home screen would show through), and Android
// hands the wallpaper's picture only to an app with all-files access -
// so the user picks the same picture here instead (2026-10-02).
//
// While the calendar or the databases are out (wallpaperBoost) the blur
// is twice as deep, never under a soft one - option Б.
const MAX_BLUR = 30;
const BOOST_MIN = 12;

export default function BackdropLayer() {
  const override = useActiveBackdropOverride();
  const image = override?.type === 'image' ? override : null;
  const status = useCachedAttachment(image?.uri, image?.driveFileId);
  const [boosted, setBoosted] = useState(wallpaperBoosted);
  useEffect(() => listenWallpaperBoost(setBoosted), []);
  if (!image || status !== 'ready') return null;
  const base = (image.blur / 100) * MAX_BLUR;
  const radius = boosted ? Math.min(MAX_BLUR * 2, Math.max(base * 2, BOOST_MIN)) : base;
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="none">
      <Image source={{ uri: image.uri }} blurRadius={Math.round(radius)} resizeMode="cover" style={StyleSheet.absoluteFill} />
    </View>
  );
}
