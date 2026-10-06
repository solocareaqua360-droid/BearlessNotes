const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

// THE SECOND AFTER A NOTE IS CLOSED (2026-10-06). Found with the phone on a
// cable (adb logcat): after a note's page folded back into its card, the
// app took no taps for up to a second, then everything worked once the dock
// changed from the note's to the list's. The system log showed why:
//
//   W Reanimated: synchronouslyUpdateUIProps failed for tag 138740
//   java.lang.reflect.InvocationTargetException ... (≈160 lines of stack)
//   Caused by: RetryableMountingLayerException: Unable to find
//   SurfaceMountingManager for tag: [138740]
//
// Reanimated keeps an animated view's last props in a registry for a while
// after the view is gone, and re-applies them on every event dispatch - and
// react-native-svg dispatches one from every icon whose box moved in a frame
// (the dock animating its new contents). Each attempt on a view that no
// longer exists threw, and Reanimated 4.5 logged every throw WITH its whole
// stack, on the UI thread: 5.4 million log lines from one session, frames
// skipped by the hundred ("Davey! 772-1046ms"), taps waiting behind it.
//
// Reanimated 4.7.1 fixed exactly this line: it asks the mounting manager
// whether the view still exists and skips it quietly if not (the props stay
// in the registry and the commit hook applies them), and it no longer logs
// the stack. Upgrading means a new react-native-worklets outside what Expo
// SDK 57 was tested with, so the same few lines are carried over to the
// 4.5.1 we have, at prebuild, where node_modules is the copy being built.
// Remove this plugin once react-native-reanimated is at 4.7.1 or later.
const MARK = '// mindEva: dead-view fix (backport of reanimated 4.7.1)';

const OLD_CALL = `                try {
                    updatePropsSynchronouslyMethod.invoke(mountingManager, viewTag, props)
                } catch (e: Exception) {
                    Log.w("Reanimated", "synchronouslyUpdateUIProps failed for tag $viewTag", e)
                }`;

const NEW_CALL = `                try {
                    ${MARK}
                    if (getViewExistsMethod?.invoke(mountingManager, viewTag) == false) {
                        return@parse
                    }
                    updatePropsSynchronouslyMethod.invoke(mountingManager, viewTag, props)
                } catch (e: Exception) {
                    Log.w("Reanimated", "synchronouslyUpdateUIProps failed for tag $viewTag: \${e.cause ?: e}")
                }`;

const OLD_FIELD = `    @DoNotStrip
    fun synchronouslyUpdateUIProps(`;

const NEW_FIELD = `    private val getViewExistsMethod by lazy {
        runCatching { mountingManager.javaClass.getMethod("getViewExists", Int::class.javaPrimitiveType) }.getOrNull()
    }

    @DoNotStrip
    fun synchronouslyUpdateUIProps(`;

function patchFile(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`withReanimatedDeadViewFix: ${file} not found`);
  }
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(MARK)) return 'already';
  if (!source.includes(OLD_CALL) || !source.includes(OLD_FIELD)) {
    // A different Reanimated: say so loudly rather than build without the fix.
    throw new Error(
      'withReanimatedDeadViewFix: NativeProxy.kt does not match reanimated 4.5.1 - check whether the fix is still needed'
    );
  }
  fs.writeFileSync(file, source.replace(OLD_CALL, NEW_CALL).replace(OLD_FIELD, NEW_FIELD));
  return 'patched';
}

function nativeProxyPath(projectRoot) {
  const pkg = require.resolve('react-native-reanimated/package.json', { paths: [projectRoot] });
  return path.join(path.dirname(pkg), 'android/src/main/java/com/swmansion/reanimated/NativeProxy.kt');
}

module.exports = function withReanimatedDeadViewFix(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      patchFile(nativeProxyPath(cfg.modRequest.projectRoot));
      return cfg;
    },
  ]);
};

module.exports.patchFile = patchFile;
module.exports.nativeProxyPath = nativeProxyPath;
