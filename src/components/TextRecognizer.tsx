import { useEffect, useRef, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { RecognizedPage, ScoredWord, joinWords, tidyWords } from '../utils/recognizedText';
import { FETCH_SHIM, FLATTEN_SCRIPT } from '../utils/pageScript';

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

// As large as is worth handing over: a page of a book at this size has
// letters tall enough to be read reliably, and going further mostly
// costs seconds. Nothing is ever enlarged TO it.
const OCR_MAX_SIDE = 2600;

export type RecognizeRequest = {
  // Local image files, in the order their text should be joined.
  uris: string[];
};

// The shape of what comes back, and the cleaning that turns it into
// prose, both live in one place - see utils/recognizedText.
export type { RecognizedWord, RecognizedPage } from '../utils/recognizedText';


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
function pageFor(images: string[], dirUrl: string, library: string): string {
  // The folder without its trailing slash, computed here on the app side
  // rather than in the page: see the note on the shim above.
  const folder = dirUrl.replace(/\/$/, '');
  // The library is INLINE, not a <script src>. A file:// page asking the
  // WebView for another file:// script does not fail - it hangs, and the
  // parser waits at that tag forever, so the script after it never runs
  // and not even "the page opened" is ever heard. Twice that looked like
  // a recogniser that answers nothing.
  //
  // Every path handed to Tesseract is still absolute: it loads its worker
  // as a Blob, and a blob has no directory of its own to resolve against.
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>
  function post(m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  function fail(e, where) {
    post({ ok: false, error: (where ? where + ': ' : '') + ((e && e.message) ? e.message : String(e)) });
  }
  window.onerror = function (message) { fail(message, 'сторінка'); };
  // Before anything else, so "never opened" can never look like "failed
  // quietly" again.
  post({ stage: 'Відкрито' });
  ${FETCH_SHIM}
  ${FLATTEN_SCRIPT}
</script>
<script>${library}</script>
<script>
  var images = ${JSON.stringify(images)};

  (async function () {
    try {
      if (typeof Tesseract === 'undefined') { fail('бібліотека не завантажилась', 'старт'); return; }
      // The model is read here, once, and handed over as bytes already in
      // memory. The recogniser's own loader would go looking for it over
      // the network, and there is no network involved in any of this.
      post({ stage: 'Читаю модель' });
      var langPath = '${folder}';
      try {
        var answer = await fetch('${dirUrl}ukr.traineddata');
        var bytes = await answer.arrayBuffer();
        if (bytes && bytes.byteLength > 100000) langPath = URL.createObjectURL(new Blob([bytes]));
      } catch (e) {
        // Not fatal: the recogniser can still be pointed at the folder.
        post({ stage: 'Модель з файлу' });
      }
      post({ stage: 'Готую розпізнавач' });
      var worker = await Tesseract.createWorker('ukr', 1, {
        workerPath: '${dirUrl}tesseract-worker.js',
        corePath: '${dirUrl}tesseract-core.js',
        langPath: langPath,
        gzip: false,
        // Nothing to cache: the model ships with the app, and the
        // browser's own storage is empty on every run anyway.
        cacheMethod: 'none',
        logger: function (m) {
          if (m.status === 'recognizing text') post({ progress: m.progress });
        },
        errorHandler: function (e) { fail(e, 'розпізнавач'); },
      });
      var pages = [];
      for (var i = 0; i < images.length; i++) {
        post({ page: i + 1, of: images.length });
        post({ stage: 'Вирівнюю освітлення' });
        var prepared = await preparedPage('${dirUrl}' + images[i]);
        post({ stage: 'Читаю текст' });
        var result = await worker.recognize(prepared);
        // Every word with the box it sits in, in reading order - what
        // lets a finger drag across the picture and pick a passage out
        // of it rather than taking the whole page or nothing.
        var words = (result.data.words || []).map(function (w) {
          return {
            text: w.text,
            // How sure it is, 0-100. A photographed page returns real
            // print in the eighties and its own shadow in the forties,
            // and without this they are indistinguishable.
            confidence: w.confidence,
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
  // The size of every picture as it was actually handed over. The
  // recogniser does not report it - it returns word boxes in the
  // image's own pixels and says nothing about the image itself - and
  // without it the page has no shape to draw the words against.
  const sizesRef = useRef<{ width: number; height: number }[]>([]);

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
          // The worker runs in a world of its own - its own global scope,
          // its own fetch - so it gets its own copy of the shim, ahead of
          // the library it belongs to.
          LegacyFileSystem.writeAsStringAsync(`${dir}tesseract-worker.js`, `${FETCH_SHIM}\n${worker}`),
          LegacyFileSystem.writeAsStringAsync(`${dir}tesseract-core.js`, core),
          LegacyFileSystem.copyAsync({ from: data, to: `${dir}ukr.traineddata` }).catch(() => {}),
        ]);
        // Copied in beside the page and referred to by name - NOT
        // inlined. A scan is several megabytes, and a page carrying two
        // of them as base64 is a ten-megabyte document the WebView never
        // finished opening: no error, no text, just a minute of nothing.
        //
        // Size is the whole game here, and the first version of this got
        // it backwards: it resized every page to 1600px WIDE, which for
        // a portrait page of a book meant throwing away half the detail -
        // and, for a page that had already been stored and compressed,
        // BLOWING IT BACK UP from about twelve hundred. That is why the
        // same document read perfectly the first time (straight off the
        // scanner) and came back in pieces the second (out of the note):
        // they were not the same picture. "Місто" arriving as "Мі" and
        // "сто" is what too few pixels looks like.
        //
        // So: never enlarge, and only shrink what is genuinely huge.
        const images: string[] = [];
        sizesRef.current = [];
        for (let i = 0; i < request.uris.length; i += 1) {
          const name = `scan-${Date.now()}-${i}.jpg`;
          const source = request.uris[i];
          let rendered = await ImageManipulator.manipulate(source).renderAsync();
          const longest = Math.max(rendered.width, rendered.height);
          if (longest > OCR_MAX_SIDE) {
            const scale = OCR_MAX_SIDE / longest;
            rendered = await ImageManipulator.manipulate(source)
              .resize({
                width: Math.round(rendered.width * scale),
                height: Math.round(rendered.height * scale),
              })
              .renderAsync();
          }
          // Barely compressed: this file is read by a machine that is
          // trying to tell a "с" from an "о", and JPEG artefacts are
          // exactly what that looks like.
          const saved = await rendered.saveAsync({ compress: 0.92, format: SaveFormat.JPEG });
          await LegacyFileSystem.copyAsync({ from: saved.uri, to: `${dir}${name}` });
          sizesRef.current.push({ width: saved.width, height: saved.height });
          images.push(name);
        }
        if (cancelled) return;
        const target = `${dir}page-${Date.now()}.html`;
        await LegacyFileSystem.writeAsStringAsync(target, pageFor(images, dir, library));
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
        pages?: (Omit<RecognizedPage, 'words'> & { words: ScoredWord[] })[];
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
        // The size is said out loud while it works. It is the one number
        // that decides whether a page can be read at all, and guessing at
        // it from the outside cost this feature two rounds.
        const size = sizesRef.current[message.page - 1];
        progressRef.current = {
          page: message.page,
          of: message.of,
          progress: 0,
          stage: size ? `Читаю ${size.width}×${size.height}` : undefined,
        };
        onProgress(progressRef.current);
        return;
      }
      if (typeof message.progress === 'number') {
        progressRef.current = { ...progressRef.current, progress: message.progress };
        onProgress(progressRef.current);
        return;
      }
      if (message.ok && message.pages) {
        onDone(
          message.pages.map((page, index) => {
            const size = sizesRef.current[index];
            // The noise goes here, once, so the selection screen and the
            // note can never disagree about what was on the page.
            const words = tidyWords((page.words ?? []) as ScoredWord[]);
            // The word boxes are the last resort for the size: the page
            // is at least as big as the furthest word on it.
            const extentX = words.reduce((most, word) => Math.max(most, word.x1), 0);
            const extentY = words.reduce((most, word) => Math.max(most, word.y1), 0);
            return {
              ...page,
              words,
              text: joinWords(words),
              width: page.width || size?.width || extentX,
              height: page.height || size?.height || extentY,
            };
          })
        );
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
