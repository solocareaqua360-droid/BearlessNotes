import { useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import {
  FilePreview,
  PreviewJob,
  finishPreviewJob,
  nextPreviewJob,
  subscribeToPreviews,
} from '../utils/filePreviews';

// One hidden browser, working through the queue a file at a time.
//
// This is the whole reason previews are affordable: the alternative - a
// WebView inside every card - is twenty browsers in a scrolling list, each
// a few megabytes of native view. Here there is exactly one, it is 1x1 and
// invisible, and every card ends up showing a plain image or a line of
// text, which costs what a photo thumbnail costs.

const MAMMOTH = require('../../assets/quicklook/mammoth.jslib');
const XLSX = require('../../assets/quicklook/xlsx.jslib');
const PDFJS = require('../../assets/quicklook/pdf.jslib');
const PDFJS_WORKER = require('../../assets/quicklook/pdf-worker.jslib');

async function readAsset(module: number): Promise<string> {
  const asset = Asset.fromModule(module);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('asset missing');
  return LegacyFileSystem.readAsStringAsync(asset.localUri);
}

function pageFor(kind: PreviewJob['kind'], base64: string, library: string): string {
  const body =
    kind === 'docx'
      ? `mammoth.extractRawText({ arrayBuffer: bytes.buffer })
           .then(function (r) {
             var text = (r.value || '').replace(/\\s+/g, ' ').trim();
             done({ text: text.slice(0, 240), thumb: paint(text, false) });
           })
           .catch(fail);`
      : kind === 'xlsx'
        ? `try {
             var wb = XLSX.read(bytes, { type: 'array' });
             var sheet = wb.Sheets[wb.SheetNames[0]];
             var rows = XLSX.utils.sheet_to_csv(sheet).split('\\n').slice(0, 10);
             var flat = rows.slice(0, 4).join(' · ').replace(/,+/g, ' ').replace(/\\s+/g, ' ').trim();
             done({ text: flat.slice(0, 240), thumb: paint(rows, true) });
           } catch (e) { fail(e); }`
        : `pdfjsLib.getDocument({ data: bytes }).promise.then(function (pdf) {
             return pdf.getPage(1).then(function (page) {
               var base = page.getViewport({ scale: 1 });
               // Small on purpose: this is a card, not a reader.
               var scale = 320 / base.width;
               var viewport = page.getViewport({ scale: scale });
               var canvas = document.createElement('canvas');
               canvas.width = viewport.width;
               canvas.height = viewport.height;
               return page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport })
                 .promise.then(function () {
                   done({ thumb: canvas.toDataURL('image/jpeg', 0.7).split(',')[1] });
                 });
             });
           }).catch(fail);`;
  return `<!doctype html><html><head><meta charset="utf-8"></head><body>
<script>${library}</script>
<script>
  function post(m) { window.ReactNativeWebView.postMessage(JSON.stringify(m)); }
  // A picture for the files that have no page to photograph. Not an
  // attempt at rendering the document - the point is only that a Word
  // card and a PDF card are the same kind of thing, and that the shape of
  // what is inside (prose, or a table) can be told at a glance.
  function paint(content, isTable) {
    var W = 320, H = 180, pad = 14;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var c = canvas.getContext('2d');
    c.fillStyle = '#ffffff'; c.fillRect(0, 0, W, H);
    c.font = '11px -apple-system, Roboto, sans-serif';
    if (isTable) {
      // A sheet reads as a grid: its own cells, clipped at the edge, with
      // the first row standing out the way a header does.
      var lh = 16;
      var rows = content.slice(0, 9);
      for (var r = 0; r < rows.length; r++) {
        var y = pad + r * lh;
        if (y > H - 6) break;
        if (r === 0) {
          c.fillStyle = '#F3F4F6';
          c.fillRect(0, y - 11, W, lh);
          c.fillStyle = '#111827';
        } else {
          c.fillStyle = '#374151';
        }
        var cells = String(rows[r]).split(',').slice(0, 4);
        var x = pad;
        for (var k = 0; k < cells.length; k++) {
          c.fillText(String(cells[k]).slice(0, 14), x, y);
          x += (W - pad * 2) / cells.length;
        }
        c.strokeStyle = '#E5E7EB';
        c.beginPath(); c.moveTo(0, y + 4); c.lineTo(W, y + 4); c.stroke();
      }
      return canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
    }
    c.fillStyle = '#374151';
    var lh2 = 15;
    var words = String(content || '').split(/\s+/);
    var line = '', y2 = pad + lh2;
    for (var i = 0; i < words.length && y2 < H - 4; i++) {
      var candidate = line ? line + ' ' + words[i] : words[i];
      if (c.measureText(candidate).width > W - pad * 2) {
        c.fillText(line, pad, y2);
        y2 += lh2;
        line = words[i];
      } else {
        line = candidate;
      }
    }
    if (line && y2 < H - 4) c.fillText(line, pad, y2);
    return canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
  }
  function done(r) { post({ ok: true, result: r }); }
  function fail(e) { post({ ok: false, error: (e && e.message) ? e.message : String(e) }); }
  try {
    var bin = atob('${base64}');
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    ${body}
  } catch (e) { fail(e); }
</script></body></html>`;
}

export default function FilePreviewWorker() {
  const [job, setJob] = useState<PreviewJob | null>(null);
  const [pageUri, setPageUri] = useState<string | null>(null);

  // Takes the next job whenever it is free and the queue is not empty.
  useEffect(() => {
    const pick = () => setJob((current) => current ?? nextPreviewJob());
    pick();
    return subscribeToPreviews(pick);
  }, []);

  useEffect(() => {
    if (!job) {
      setPageUri(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [library, base64] = await Promise.all([
          job.kind === 'docx'
            ? readAsset(MAMMOTH)
            : job.kind === 'xlsx'
              ? readAsset(XLSX)
              : Promise.all([readAsset(PDFJS), readAsset(PDFJS_WORKER)]).then((p) => p.join('\n')),
          LegacyFileSystem.readAsStringAsync(job.uri, { encoding: 'base64' }),
        ]);
        if (cancelled) return;
        const target = `${LegacyFileSystem.cacheDirectory}preview-job-${job.id}.html`;
        await LegacyFileSystem.writeAsStringAsync(target, pageFor(job.kind, base64, library));
        if (!cancelled) setPageUri(target);
      } catch {
        // A file that cannot even be read is not one to keep retrying.
        finishPreviewJob(job.id, { failed: true });
        if (!cancelled) setJob(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [job]);

  async function handleMessage(raw: string) {
    if (!job) return;
    let preview: FilePreview = { failed: true };
    try {
      const message = JSON.parse(raw) as
        | { ok: true; result: { text?: string; thumb?: string } }
        | { ok: false; error: string };
      if (message.ok) {
        // Both at once now: a document has a picture AND its first lines.
        const next: FilePreview = {};
        if (message.result.thumb) {
          const path = `${LegacyFileSystem.cacheDirectory}preview-${job.id}.jpg`;
          await LegacyFileSystem.writeAsStringAsync(path, message.result.thumb, { encoding: 'base64' });
          next.thumbUri = path;
        }
        if (message.result.text) next.text = message.result.text;
        if (next.thumbUri || next.text) preview = next;
      }
    } catch {
      // Whatever came back was not an answer; it counts as one failure,
      // not as a reason to try forever.
    }
    if (pageUri) LegacyFileSystem.deleteAsync(pageUri, { idempotent: true }).catch(() => {});
    finishPreviewJob(job.id, preview);
    setJob(null);
  }

  if (!pageUri) return null;
  return (
    <View style={styles.hidden} pointerEvents="none">
      <WebView
        source={{ uri: pageUri }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled={false}
        allowFileAccess
        allowFileAccessFromFileURLs
        onMessage={(e) => handleMessage(e.nativeEvent.data)}
        // A page that never answers must not hold the queue forever.
        onError={() => job && finishPreviewJob(job.id, { failed: true })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  // Present but invisible: a WebView that is not laid out does not run.
  hidden: {
    position: 'absolute',
    width: 1,
    height: 1,
    opacity: 0,
    left: -10,
    top: -10,
  },
});
