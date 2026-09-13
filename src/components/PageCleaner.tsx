import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { FETCH_SHIM, FLATTEN_SCRIPT } from '../utils/pageScript';

// A scanned page made to look scanned.
//
// The document scanner crops and straightens, but its own filter leaves
// grey speckle all over clean paper, and the shadow the phone cast is
// still in the picture. Fine for a page that is only going to be read by
// the recogniser - it flattens the light and drops the speckle itself,
// before reading. Wrong for a page that is going to be KEPT and looked
// at. So "Чистий скан" runs the same preparation, in colour, and keeps
// the result: even white paper, crisp ink, the red of a stamp still red.
//
// The same hidden-browser arrangement as the recogniser and the
// previews: one 1x1 WebView, the page written to a file, the pictures
// beside it and read through a blob.

const CLEAN_MAX_SIDE = 2600;

export type CleanRequest = { uris: string[] };

function pageFor(images: string[], dirUrl: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>
  function post(m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  function fail(e, where) {
    post({ ok: false, error: (where ? where + ': ' : '') + ((e && e.message) ? e.message : String(e)) });
  }
  window.onerror = function (message) { fail(message, 'сторінка'); };
  ${FETCH_SHIM}
  ${FLATTEN_SCRIPT}
</script>
<script>
  var images = ${JSON.stringify(images)};
  (async function () {
    try {
      for (var i = 0; i < images.length; i++) {
        post({ page: i + 1, of: images.length });
        var canvas = await preparedPage('${dirUrl}' + images[i], true);
        if (!canvas || typeof canvas.toDataURL !== 'function') {
          fail('зображення не вдалося обробити', 'чищення');
          return;
        }
        post({ page: i + 1, of: images.length, jpeg: canvas.toDataURL('image/jpeg', 0.9).split(',')[1] });
      }
      post({ ok: true });
    } catch (e) {
      fail(e, 'чищення');
    }
  })();
</script></body></html>`;
}

export default function PageCleaner({
  request,
  onProgress,
  onDone,
  onError,
}: {
  request: CleanRequest | null;
  onProgress: (progress: { page: number; of: number }) => void;
  // The cleaned pages, as files, in the order they were given.
  onDone: (uris: string[]) => void;
  onError: (message: string) => void;
}) {
  const [pageUri, setPageUri] = useState<string | null>(null);
  const dirRef = useRef<string>('');
  const cleanedRef = useRef<string[]>([]);

  useEffect(() => {
    if (!request) {
      setPageUri(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const dir = `${LegacyFileSystem.cacheDirectory}ocr/`;
        await LegacyFileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
        dirRef.current = dir;
        cleanedRef.current = [];
        const images: string[] = [];
        for (let i = 0; i < request.uris.length; i += 1) {
          const name = `raw-${Date.now()}-${i}.jpg`;
          const source = request.uris[i];
          // Never enlarged, only shrunk when genuinely huge - the same
          // rule as the recogniser, for the same reason.
          let rendered = await ImageManipulator.manipulate(source).renderAsync();
          const longest = Math.max(rendered.width, rendered.height);
          if (longest > CLEAN_MAX_SIDE) {
            const scale = CLEAN_MAX_SIDE / longest;
            rendered = await ImageManipulator.manipulate(source)
              .resize({
                width: Math.round(rendered.width * scale),
                height: Math.round(rendered.height * scale),
              })
              .renderAsync();
          }
          const saved = await rendered.saveAsync({ compress: 0.92, format: SaveFormat.JPEG });
          await LegacyFileSystem.copyAsync({ from: saved.uri, to: `${dir}${name}` });
          images.push(name);
        }
        if (cancelled) return;
        const target = `${dir}clean-${Date.now()}.html`;
        await LegacyFileSystem.writeAsStringAsync(target, pageFor(images, dir));
        if (!cancelled) setPageUri(target);
      } catch (e) {
        if (!cancelled) onError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  // A page that never answers must not leave the scan hanging.
  useEffect(() => {
    if (!pageUri) return;
    const timer = setTimeout(() => onError('Чистильник не відповів'), 120000);
    return () => clearTimeout(timer);
  }, [pageUri]);

  async function handleMessage(raw: string) {
    try {
      const message = JSON.parse(raw) as {
        ok?: boolean;
        error?: string;
        page?: number;
        of?: number;
        jpeg?: string;
      };
      if (message.jpeg && message.page) {
        const path = `${dirRef.current}clean-${Date.now()}-${message.page}.jpg`;
        await LegacyFileSystem.writeAsStringAsync(path, message.jpeg, { encoding: 'base64' });
        cleanedRef.current[message.page - 1] = path;
        return;
      }
      if (message.page && message.of) {
        onProgress({ page: message.page, of: message.of });
        return;
      }
      if (message.ok) {
        onDone(cleanedRef.current.filter(Boolean));
        return;
      }
      if (message.ok === false) onError(message.error ?? 'Не вдалося почистити');
    } catch {
      onError('Не вдалося почистити');
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
        onError={() => onError('Не вдалося відкрити чистильник')}
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
