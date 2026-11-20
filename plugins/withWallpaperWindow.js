const { withAndroidStyles, AndroidConfig } = require('@expo/config-plugins');

// THE PHONE'S WALLPAPER UNDER THE APP (asked 2026-10-01: "повторити ефект
// просвічування фону на android", the way the Mac app shows the desktop
// through its glass). Android's own window flag for it is
// android:windowShowWallpaper - the system draws the home-screen
// wallpaper behind the window - and the window's own background has to
// be clear for any of it to be seen.
//
// Nothing shows through by itself: every screen still paints its own
// ground over this, as it always has. Only the backdrop called
// «Шпалери телефона» in Settings (ScreenBackdrop) leaves its ground
// see-through - so turning that off puts the app back exactly as it was.
function setItem(style, name, value) {
  style.item = (style.item ?? []).filter((item) => item.$.name !== name);
  style.item.push({ $: { name }, _: value });
}

module.exports = function withWallpaperWindow(config) {
  return withAndroidStyles(config, (cfg) => {
    const appTheme = AndroidConfig.Styles.getAppThemeGroup?.() ?? { name: 'AppTheme' };
    const styles = cfg.modResults.resources.style ?? [];
    const theme = styles.find((s) => s.$.name === appTheme.name);
    if (theme) {
      setItem(theme, 'android:windowShowWallpaper', 'true');
      setItem(theme, 'android:windowBackground', '@android:color/transparent');
    }
    return cfg;
  });
};
