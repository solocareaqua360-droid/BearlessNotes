import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { FETCH_SHIM } from '../utils/pageScript';
import { duotoneScript } from '../utils/imageTreatment';

// Runs every tile background - wherever it came from, the gallery or the
// stock-photo search - through the same duotone before it is kept. See
// imageTreatment.ts for why: one picture's own colours are what made the
// board read as a collage rather than a single thing.
//
// The same hidden-WebView shape as the recogniser and the old preview
// worker: one 1x1 WebView, the picture copied in beside the page and read
// through a blob, never inlined - a few megabytes of base64 is a page
// that never finishes opening.

export type StylistRequest = { uri: string; color: string };

function pageFor(image: string, dirUrl: string, color: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>
  function post(m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  function fail(e) { post({ ok: false, error: (e && e.message) ? e.message : String(e) }); }
  window.onerror = function (message) { fail(message); };
  ${FETCH_SHIM}
  ${duotoneScript(color)}
</script>
<script>
  (async function () {
    try {
      var canvas = await window.__duotone('${dirUrl}${image}');
      post({ ok: true, jpeg: canvas.toDataURL('image/jpeg', 0.9).split(',')[1] });
    } catch (e) {
      fail(e);
    }
  })();
</script></body></html>`;
}

export default function BackgroundStylist({
  request,
  onDone,
  onError,
}: {
  request: StylistRequest | null;
  // A local file, already toned - ready to be kept as a tile's background.
  onDone: (uri: string) => void;
  onError: (message: string) => void;
}) {
  const [pageUri, setPageUri] = useState<string | null>(null);

  useEffect(() => {
    if (!request) {
      setPageUri(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const dir = `${LegacyFileSystem.cacheDirectory}bgstyle/`;
        await LegacyFileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
        // Downscaled going in: this becomes a tile's background, never
        // more than a few hundred points across, and a duotone reads no
        // better at four times that size - only slower to compute.
        const rendered = await ImageManipulator.manipulate(request.uri).resize({ width: 900 }).renderAsync();
        const saved = await rendered.saveAsync({ compress: 0.9, format: SaveFormat.JPEG });
        const name = `src-${Date.now()}.jpg`;
        await LegacyFileSystem.copyAsync({ from: saved.uri, to: `${dir}${name}` });
        if (cancelled) return;
        const target = `${dir}page-${Date.now()}.html`;
        await LegacyFileSystem.writeAsStringAsync(target, pageFor(name, dir, request.color));
        if (!cancelled) setPageUri(target);
      } catch (e) {
        if (!cancelled) onError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  useEffect(() => {
    if (!pageUri) return;
    const timer = setTimeout(() => onError('Стилізатор не відповів'), 30000);
    return () => clearTimeout(timer);
  }, [pageUri]);

  async function handleMessage(raw: string) {
    try {
      const message = JSON.parse(raw) as { ok?: boolean; jpeg?: string; error?: string };
      if (message.ok && message.jpeg) {
        const path = `${LegacyFileSystem.cacheDirectory}bgstyle/tile-${Date.now()}.jpg`;
        await LegacyFileSystem.writeAsStringAsync(path, message.jpeg, { encoding: 'base64' });
        onDone(path);
        return;
      }
      onError(message.error ?? 'Не вдалося стилізувати зображення');
    } catch {
      onError('Не вдалося стилізувати зображення');
    }
  }

  if (!pageUri) return null;
  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        source={{ uri: pageUri }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        allowFileAccess
        allowFileAccessFromFileURLs
        allowUniversalAccessFromFileURLs
        onMessage={(e) => handleMessage(e.nativeEvent.data)}
        onError={() => onError('Не вдалося відкрити стилізатор')}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: -10,
    top: -10,
  },
});
