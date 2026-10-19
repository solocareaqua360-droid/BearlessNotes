const fs = require('fs');
const path = require('path');
const { withDangerousMod } = require('@expo/config-plugins');

// A SHARE THAT EMPTIED THE WHOLE APP (found 2026-10-16). expo-share-intent
// 8.0.1 reads a shared file's name and size with
//
//   val queryResult: Cursor = resolver.query(uri, null, null, null, null)!!
//   queryResult.moveToFirst()
//   val fileName = queryResult.getString(...)
//
// and never looks at what came back. When the cursor is empty - the app was
// handed a file it has no grant to read (a share fired from adb, a provider
// that refuses) - getString throws CursorIndexOutOfBoundsException «Index 0
// requested, with a size of 0» inside OnNewIntent; React treats that as a
// fatal host error and DESTROYS itself, and the window stays blank (only
// the wallpaper) until the app is started again. Same for a file whose
// picture size cannot be read. The everyday path (Gallery -> Share ->
// mindEva) carries the grant and was never hit, which is why this waited
// for a new APK rather than being urgent.
//
// Fixed the way withReanimatedDeadViewFix fixes Reanimated: the same file,
// patched at prebuild, where node_modules is the copy being built (no npm
// script - those change the runtime fingerprint, see CLAUDE.md). A name
// that cannot be read falls back to the uri's last segment; a size that
// cannot be read stays empty. Remove this plugin once expo-share-intent
// checks its cursor itself.
const MARK = '// mindEva: share-intent cursor fix';

const OLD_QUERY = `            val queryResult: Cursor = resolver.query(uri, null, null, null, null)!!
            queryResult.moveToFirst()
            val fileName = queryResult.getString(queryResult.getColumnIndex(OpenableColumns.DISPLAY_NAME))
            val fileSize = queryResult.getString(queryResult.getColumnIndex(OpenableColumns.SIZE))
            queryResult.close()

            val mimeType = resolver.getType(uri)!!`;

const NEW_QUERY = `            ${MARK}
            var fileName: String? = null
            var fileSize: String? = null
            try {
                resolver.query(uri, null, null, null, null)?.use { c: Cursor ->
                    if (c.moveToFirst()) {
                        val nameAt = c.getColumnIndex(OpenableColumns.DISPLAY_NAME)
                        val sizeAt = c.getColumnIndex(OpenableColumns.SIZE)
                        if (nameAt >= 0) fileName = c.getString(nameAt)
                        if (sizeAt >= 0) fileSize = c.getString(sizeAt)
                    }
                }
            } catch (e: Exception) {
                notifyError("Cannot read the shared file's name (getFileInfo): \${e.message}")
            }
            if (fileName == null) fileName = uri.lastPathSegment

            val mimeType = (try { resolver.getType(uri) } catch (e: Exception) { null }) ?: "application/octet-stream"`;

const OLD_MEDIA_START = `            var mediaDuration: String? = null;
`;
const NEW_MEDIA_START = `            var mediaDuration: String? = null;
            try {
`;
const OLD_MEDIA_END = `            }

            return mapOf(
                    "contentUri" to uri.toString(),`;
const NEW_MEDIA_END = `            }
            } catch (e: Exception) {
                notifyError("Cannot read the shared file's size (getFileInfo): \${e.message}")
            }

            return mapOf(
                    "contentUri" to uri.toString(),`;

function patchFile(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`withShareIntentCursorFix: ${file} not found`);
  }
  const source = fs.readFileSync(file, 'utf8');
  if (source.includes(MARK)) return 'already';
  const count = (s) => source.split(s).length - 1;
  if (count(OLD_QUERY) !== 1 || count(OLD_MEDIA_START) !== 1 || count(OLD_MEDIA_END) !== 1) {
    // A different expo-share-intent: say so loudly rather than build without the fix.
    throw new Error(
      'withShareIntentCursorFix: ExpoShareIntentModule.kt does not match expo-share-intent 8.0.1 - check whether the fix is still needed'
    );
  }
  fs.writeFileSync(
    file,
    source.replace(OLD_QUERY, NEW_QUERY).replace(OLD_MEDIA_START, NEW_MEDIA_START).replace(OLD_MEDIA_END, NEW_MEDIA_END)
  );
  return 'patched';
}

function modulePath(projectRoot) {
  const pkg = require.resolve('expo-share-intent/package.json', { paths: [projectRoot] });
  return path.join(path.dirname(pkg), 'android/src/main/java/expo/modules/shareintent/ExpoShareIntentModule.kt');
}

module.exports = function withShareIntentCursorFix(config) {
  return withDangerousMod(config, [
    'android',
    (cfg) => {
      patchFile(modulePath(cfg.modRequest.projectRoot));
      return cfg;
    },
  ]);
};

module.exports.patchFile = patchFile;
module.exports.modulePath = modulePath;
