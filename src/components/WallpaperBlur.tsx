import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { useActiveBackdropOverride } from '../theme/ThemeProvider';
import { setWindowBlur, supportsWindowBlur } from '../utils/mindevaNative';
import { listenWallpaperBoost, wallpaperBoosted } from '../utils/wallpaperBoost';

// The wallpaper's blur is the WINDOW's (utils/mindevaNative's
// setWindowBlur), not a view's - so it is set here, once, from the
// setting, and again whenever the app comes back to the front (the
// window can be recreated behind our back). Draws nothing.
//
// While the calendar or the databases are out (wallpaperBoost) it is
// twice as deep - and never less than a soft blur, so the layer reads as
// glass even with the slider at zero. The change runs in a few steps
// rather than one jump.
const MAX_RADIUS = 160;
const BOOST_MIN = 40;
const STEPS = 5;
const STEP_MS = 40;

export default function WallpaperBlur() {
  const override = useActiveBackdropOverride();
  const [boosted, setBoosted] = useState(wallpaperBoosted);
  useEffect(() => listenWallpaperBoost(setBoosted), []);
  const base = override?.type === 'wallpaper' ? ((override.blur ?? 0) / 100) * MAX_RADIUS : 0;
  const radius = override?.type !== 'wallpaper' ? 0 : boosted ? Math.min(MAX_RADIUS * 2, Math.max(base * 2, BOOST_MIN)) : base;
  const current = useRef(0);

  useEffect(() => {
    if (!supportsWindowBlur) return;
    const from = current.current;
    const timers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 1; i <= STEPS; i++) {
      timers.push(
        setTimeout(() => {
          current.current = from + ((radius - from) * i) / STEPS;
          setWindowBlur(current.current);
        }, (i - 1) * STEP_MS)
      );
    }
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setWindowBlur(radius);
    });
    return () => {
      timers.forEach(clearTimeout);
      sub.remove();
    };
  }, [radius]);
  return null;
}
