import { useEffect } from 'react';
import { AppState } from 'react-native';
import { useActiveBackdropOverride } from '../theme/ThemeProvider';
import { setWindowBlur, supportsWindowBlur } from '../utils/mindevaNative';

// The wallpaper's blur is the WINDOW's (utils/mindevaNative's
// setWindowBlur), not a view's - so it is set here, once, from the
// setting, and again whenever the app comes back to the front (the
// window can be recreated behind our back). Draws nothing.
const MAX_RADIUS = 160;

export default function WallpaperBlur() {
  const override = useActiveBackdropOverride();
  const radius = override?.type === 'wallpaper' ? ((override.blur ?? 0) / 100) * MAX_RADIUS : 0;
  useEffect(() => {
    if (!supportsWindowBlur) return;
    setWindowBlur(radius);
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setWindowBlur(radius);
    });
    return () => sub.remove();
  }, [radius]);
  return null;
}
