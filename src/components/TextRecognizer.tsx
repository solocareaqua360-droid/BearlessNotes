import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as LegacyFileSystem from 'expo-file-system/legacy';

// Reading the text off a photographed page, on the device, offline.
//
// Android's own free recogniser (ML Kit) does not do Cyrillic at all, so
// this is Tesseract, compiled to WebAssembly, running in the same kind of
// hidden browser the previews use. Everything it needs ships with the app
// - the library, the WASM core and the Ukrainian model (3.8MB, the "fast"
// one: on a real page it produced output identical to the full model at a
// fraction of the size).
//
// Asked for explicitly, never automatically: most photographs are not
// pages, and spending ten seconds of someone's phone on every one of them
// would be rude.

const TESSERACT = require('../../assets/ocr/tesseract.jslib');
const TESSERACT_WORKER = require('../../assets/ocr/tesseract-worker.jslib');
const TESSERACT_CORE = require('../../assets/ocr/tesseract-core.jslib');
const UKR_DATA = require('../../assets/ocr/ukr.traineddata.bin');

export type RecognizeRequest = {
  // Local image files, in the order their text should be joined.
  uris: string[];
};

async function assetUri(module: number): Promise<string> {
  const asset = Asset.fromModule(module);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('asset missing');
  return asset.localUri;
}

async function assetText(module: number): Promise<string> {
  return LegacyFileSystem.readAsStringAsync(await assetUri(module));
}

// The page that does the work. Tesseract wants its worker and its core as
// URLs it can load, so they are written into one directory and pointed at
// by name - the WebView is loaded from that same directory, which is what
// makes them same-origin for it.
function pageFor(images: string[]): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script src="./tesseract.js"></script>
<script>
  function post(m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  var images = ${JSON.stringify(images)};
  (async function () {
    try {
      var worker = await Tesseract.createWorker('ukr', 1, {
        workerPath: './tesseract-worker.js',
        corePath: './tesseract-core.js',
        // The model sits next to this page, uncompressed.
        langPath: '.',
        gzip: false,
        logger: function (m) {
          if (m.status === 'recognizing text') post({ progress: m.progress });
        },
      });
      var pages = [];
      for (var i = 0; i < images.length; i++) {
        post({ page: i + 1, of: images.length });
        var result = await worker.recognize(images[i]);
        pages.push(result.data.text || '');
      }
      await worker.terminate();
      post({ ok: true, pages: pages });
    } catch (e) {
      post({ ok: false, error: (e && e.message) ? e.message : String(e) });
    }
  })();
</script></body></html>`;
}

export type RecognizeProgress = { page: number; of: number; progress: number };

export default function TextRecognizer({
  request,
  onProgress,
  onDone,
  onError,
}: {
  request: RecognizeRequest | null;
  onProgress: (progress: RecognizeProgress) => void;
  onDone: (pages: string[]) => void;
  onError: (message: string) => void;
}) {
  const [pageUri, setPageUri] = useState<string | null>(null);
  const progressRef = useRef<RecognizeProgress>({ page: 1, of: 1, progress: 0 });

  useEffect(() => {
    if (!request) {
      setPageUri(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        // One directory holding the page and everything it loads: the
        // WebView is loaded from inside it, so these are all same-origin
        // and a file:// worker is allowed to start.
        const dir = `${LegacyFileSystem.cacheDirectory}ocr/`;
        await LegacyFileSystem.makeDirectoryAsync(dir, { intermediates: true }).catch(() => {});
        const [library, worker, core, data] = await Promise.all([
          assetText(TESSERACT),
          assetText(TESSERACT_WORKER),
          assetText(TESSERACT_CORE),
          assetUri(UKR_DATA),
        ]);
        await Promise.all([
          LegacyFileSystem.writeAsStringAsync(`${dir}tesseract.js`, library),
          LegacyFileSystem.writeAsStringAsync(`${dir}tesseract-worker.js`, worker),
          LegacyFileSystem.writeAsStringAsync(`${dir}tesseract-core.js`, core),
          LegacyFileSystem.copyAsync({ from: data, to: `${dir}ukr.traineddata` }).catch(() => {}),
        ]);
        // The images travel as data URIs: a file:// page may not read
        // other files, and copying them in would double every photo.
        const images = await Promise.all(
          request.uris.map(async (uri) => {
            const base64 = await LegacyFileSystem.readAsStringAsync(uri, { encoding: 'base64' });
            return `data:image/jpeg;base64,${base64}`;
          })
        );
        if (cancelled) return;
        const target = `${dir}page-${Date.now()}.html`;
        await LegacyFileSystem.writeAsStringAsync(target, pageFor(images));
        if (!cancelled) setPageUri(target);
      } catch (e) {
        if (!cancelled) onError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [request]);

  function handleMessage(raw: string) {
    try {
      const message = JSON.parse(raw) as {
        ok?: boolean;
        pages?: string[];
        error?: string;
        page?: number;
        of?: number;
        progress?: number;
      };
      if (message.page && message.of) {
        progressRef.current = { page: message.page, of: message.of, progress: 0 };
        onProgress(progressRef.current);
        return;
      }
      if (typeof message.progress === 'number') {
        progressRef.current = { ...progressRef.current, progress: message.progress };
        onProgress(progressRef.current);
        return;
      }
      if (message.ok && message.pages) {
        onDone(message.pages);
        return;
      }
      if (message.ok === false) onError(message.error ?? 'Не вдалося розпізнати');
    } catch {
      onError('Не вдалося розпізнати');
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
        onError={() => onError('Не вдалося відкрити розпізнавач')}
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
