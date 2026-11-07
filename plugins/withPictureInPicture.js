const { withAndroidManifest, withMainActivity, AndroidConfig } = require('expo/config-plugins');

const { getMainActivityOrThrow } = AndroidConfig.Manifest;

// System picture-in-picture for the video player. Two pieces:
//  1. the manifest: MainActivity may enter PiP, and it must NOT be
//     recreated when the window shrinks (configChanges), or the video
//     would restart;
//  2. MainActivity reports the PiP window opening/closing to
//     modules/cinema-native, which hands it on to JS.
function withPictureInPicture(config) {
  config = withAndroidManifest(config, (c) => {
    const activity = getMainActivityOrThrow(c.modResults);
    activity.$['android:supportsPictureInPicture'] = 'true';
    const needed = ['screenSize', 'smallestScreenSize', 'screenLayout', 'orientation'];
    const have = (activity.$['android:configChanges'] || '').split('|').filter(Boolean);
    for (const n of needed) if (!have.includes(n)) have.push(n);
    activity.$['android:configChanges'] = have.join('|');
    return c;
  });

  return withMainActivity(config, (c) => {
    let src = c.modResults.contents;
    if (src.includes('PipState.changed')) return c;
    if (c.modResults.language !== 'kt') {
      throw new Error('withPictureInPicture: MainActivity is not Kotlin');
    }
    const imports = ['android.content.res.Configuration', 'expo.modules.cinemanative.PipState'];
    const missing = imports.filter((i) => !src.includes(`import ${i}`));
    if (missing.length) {
      src = src.replace(/(^package .*$)/m, `$1\n\n${missing.map((i) => `import ${i}`).join('\n')}`);
    }
    const method = `
  override fun onPictureInPictureModeChanged(isInPictureInPictureMode: Boolean, newConfig: Configuration) {
    super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
    PipState.changed(isInPictureInPictureMode)
  }
`;
    const last = src.lastIndexOf('}');
    src = src.slice(0, last) + method + src.slice(last);
    c.modResults.contents = src;
    return c;
  });
}

module.exports = withPictureInPicture;
