import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';

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

// One word and the box it occupies, in the recognised image's own pixels.
export type RecognizedWord = { text: string; x0: number; y0: number; x1: number; y1: number };

// A page as it came back: its whole text, and the words it is made of,
// against the picture they were read from.
export type RecognizedPage = {
  text: string;
  words: RecognizedWord[];
  width: number;
  height: number;
  image: string;
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
function pageFor(images: string[], dirUrl: string): string {
  // Every path absolute. Tesseract loads its worker as a Blob, and a blob
  // has no directory of its own - so a relative corePath or langPath
  // inside it resolves against nothing and the whole thing fails silently,
  // which is exactly what a minute of waiting for text looked like.
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script src="${dirUrl}tesseract.js"></script>
<script>
  function post(m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  function fail(e, where) {
    post({ ok: false, error: (where ? where + ': ' : '') + ((e && e.message) ? e.message : String(e)) });
  }
  // Anything the page itself throws, including a script that failed to
  // load - silence is the one thing this must never do.
  window.onerror = function (message) { fail(message, 'сторінка'); };
  var images = ${JSON.stringify(images)};
  // Before anything else: proof that the page opened and its script ran.
  post({ stage: 'Відкрито' });
  (async function () {
    try {
      if (typeof Tesseract === 'undefined') { fail('бібліотека не завантажилась', 'старт'); return; }
      post({ stage: 'Готую розпізнавач' });
      var worker = await Tesseract.createWorker('ukr', 1, {
        workerPath: '${dirUrl}tesseract-worker.js',
        corePath: '${dirUrl}tesseract-core.js',
        // The folder the model sits in, uncompressed.
        langPath: '${dirUrl}'.replace(/\/$/, ''),
        gzip: false,
        logger: function (m) {
          if (m.status === 'recognizing text') post({ progress: m.progress });
        },
        errorHandler: function (e) { fail(e, 'розпізнавач'); },
      });
      var pages = [];
      for (var i = 0; i < images.length; i++) {
        post({ page: i + 1, of: images.length });
        // By name, next to the page - see the note about inlining.
        var result = await worker.recognize('${dirUrl}' + images[i]);
        // Every word with the box it sits in, in reading order - what
        // lets a finger drag across the picture and pick a passage out
        // of it rather than taking the whole page or nothing.
        var words = (result.data.words || []).map(function (w) {
          return {
            text: w.text,
            x0: w.bbox.x0, y0: w.bbox.y0, x1: w.bbox.x1, y1: w.bbox.y1,
          };
        });
        pages.push({
          text: result.data.text || '',
          words: words,
          width: (result.data.imageWidth || 0),
          height: (result.data.imageHeight || 0),
          image: '${dirUrl}' + images[i],
        });
      }
      await worker.terminate();
      post({ ok: true, pages: pages });
    } catch (e) {
      fail(e, 'читання');
    }
  })();
</script></body></html>`;
}

export type RecognizeProgress = { page: number; of: number; progress: number; stage?: string };

export default function TextRecognizer({
  request,
  onProgress,
  onDone,
  onError,
}: {
  request: RecognizeRequest | null;
  onProgress: (progress: RecognizeProgress) => void;
  onDone: (pages: RecognizedPage[]) => void;
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
        // Copied in beside the page and referred to by name - NOT
        // inlined. A scan is several megabytes, and a page carrying two
        // of them as base64 is a ten-megabyte document the WebView never
        // finished opening: no error, no text, just a minute of nothing.
        //
        // Downscaled on the way in as well. On a real page 1600px across
        // gave output identical to the full size, at a fraction of the
        // work.
        const images: string[] = [];
        for (let i = 0; i < request.uris.length; i += 1) {
          const name = `scan-${Date.now()}-${i}.jpg`;
          const context = ImageManipulator.manipulate(request.uris[i]).resize({ width: 1600 });
          const rendered = await context.renderAsync();
          const saved = await rendered.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
          await LegacyFileSystem.copyAsync({ from: saved.uri, to: `${dir}${name}` });
          images.push(name);
        }
        if (cancelled) return;
        const target = `${dir}page-${Date.now()}.html`;
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

  // Nothing came back in two minutes: something inside the page died
  // without saying so, and a spinner that never ends is worse than a
  // sentence explaining that.
  useEffect(() => {
    if (!pageUri) return;
    const timer = setTimeout(() => onError('Розпізнавач не відповів'), 120000);
    return () => clearTimeout(timer);
  }, [pageUri]);

  function handleMessage(raw: string) {
    try {
      const message = JSON.parse(raw) as {
        ok?: boolean;
        pages?: RecognizedPage[];
        error?: string;
        page?: number;
        of?: number;
        progress?: number;
        stage?: string;
      };
      if (message.stage) {
        onProgress({ ...progressRef.current, stage: message.stage });
        return;
      }
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
