import { useEffect, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { GLASS_BODY, GLASS_TEXT, GLASS_TEXT_MUTED } from '../constants/glass';

// A quick look at a Word, Excel or PDF file, without leaving the app and
// without the network - the way a phone's own preview does it: the text
// is there to read, the fancier layout may not survive, and the real
// program is one tap away for anything more.
//
// The conversion runs INSIDE the WebView, not in the app's own JS: mammoth
// (.docx -> HTML), SheetJS (.xlsx -> tables) and pdf.js (pages -> canvas)
// are browser libraries, and the WebView is a browser. They ship with the
// app as plain files (see metro.config.js) and are read and injected here,
// so nothing is fetched and this arrives over the air like any other
// change.
//
// The page is written to a file and loaded from there rather than handed
// over as a string: a scanned PDF is megabytes, and its bytes travel
// inside the page as base64 - a string that size does not survive the
// bridge to the WebView, a file does.

export type QuickLookKind = 'docx' | 'xlsx' | 'pdf';

// What this can show. Anything else goes straight to the app that opens
// it - see openFileExternally.
export function quickLookKindFor(fileName: string): QuickLookKind | null {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'docx') return 'docx';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 'xlsx';
  if (ext === 'pdf') return 'pdf';
  return null;
}

const MAMMOTH = require('../../assets/quicklook/mammoth.jslib');
const XLSX = require('../../assets/quicklook/xlsx.jslib');
// pdf.js proper and its worker. The worker is included inline as well,
// which is what lets pdf.js run it on the page's own thread ("fake
// worker") - there is no URL to load a real one from in here.
const PDFJS = require('../../assets/quicklook/pdf.jslib');
const PDFJS_WORKER = require('../../assets/quicklook/pdf-worker.jslib');

async function readAsset(module: number): Promise<string> {
  const asset = Asset.fromModule(module);
  await asset.downloadAsync();
  if (!asset.localUri) throw new Error('asset missing');
  return LegacyFileSystem.readAsStringAsync(asset.localUri);
}

function pageFor(kind: QuickLookKind, base64: string, library: string): string {
  const convert =
    kind === 'docx'
      ? `mammoth.convertToHtml({ arrayBuffer: bytes.buffer })
           .then(function (r) { root.innerHTML = r.value || '<p class="muted">Порожній документ</p>'; })
           .catch(function (e) { fail(e); });`
      : kind === 'pdf'
        ? `pdfjsLib.getDocument({ data: bytes }).promise.then(function (pdf) {
             root.innerHTML = '';
             var width = document.body.clientWidth - 36;
             var ratio = window.devicePixelRatio || 1;
             // One page after another, so the first is on screen while
             // the rest are still being drawn.
             var n = 1;
             function next() {
               if (n > pdf.numPages) return;
               pdf.getPage(n).then(function (page) {
                 var base = page.getViewport({ scale: 1 });
                 var scale = width / base.width;
                 var viewport = page.getViewport({ scale: scale * ratio });
                 var canvas = document.createElement('canvas');
                 canvas.width = viewport.width;
                 canvas.height = viewport.height;
                 canvas.style.width = width + 'px';
                 canvas.style.height = (viewport.height / ratio) + 'px';
                 canvas.className = 'page';
                 root.appendChild(canvas);
                 return page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise;
               }).then(function () { n += 1; next(); }).catch(function (e) { fail(e); });
             }
             next();
           }).catch(function (e) { fail(e); });`
        : `try {
           var wb = XLSX.read(bytes, { type: 'array' });
           var html = '';
           wb.SheetNames.forEach(function (name) {
             var sheet = wb.Sheets[name];
             html += '<h2>' + name + '</h2>' + XLSX.utils.sheet_to_html(sheet, { header: '', footer: '' });
           });
           root.innerHTML = html || '<p class="muted">Порожня таблиця</p>';
         } catch (e) { fail(e); }`;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; padding: 16px 18px 48px; font: 16px/1.5 -apple-system, Roboto, sans-serif; color: #111827; background: #fff; }
  img { max-width: 100%; height: auto; }
  h1, h2, h3 { line-height: 1.25; }
  h2 { font-size: 15px; color: #6B7280; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: .04em; }
  table { border-collapse: collapse; font-size: 13px; margin: 8px 0 16px; max-width: 100%; }
  td, th { border: 1px solid #E5E7EB; padding: 4px 8px; vertical-align: top; white-space: nowrap; }
  .scroll { overflow-x: auto; }
  .page { display: block; margin: 0 auto 12px; box-shadow: 0 1px 6px rgba(0,0,0,.18); border-radius: 2px; background: #fff; }
  .muted { color: #9CA3AF; }
  .error { color: #B91C1C; }
</style></head><body>
<div id="root" class="scroll"><p class="muted">Відкриваю…</p></div>
<script>${library}</script>
<script>
  var root = document.getElementById('root');
  function fail(e) { root.innerHTML = '<p class="error">Не вдалося показати файл: ' + (e && e.message ? e.message : e) + '</p>'; }
  try {
    var bin = atob('${base64}');
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    ${convert}
  } catch (e) { fail(e); }
</script></body></html>`;
}

export default function DocumentQuickLook({
  file,
  onClose,
  onOpenElsewhere,
}: {
  // null closes it.
  file: { uri: string; name: string; kind: QuickLookKind } | null;
  onClose: () => void;
  // The real program, one tap away.
  onOpenElsewhere: () => void;
}) {
  const insets = useSafeAreaInsets();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!file) {
      setHtml(null);
      setError(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [library, base64] = await Promise.all([
          file.kind === 'docx'
            ? readAsset(MAMMOTH)
            : file.kind === 'xlsx'
              ? readAsset(XLSX)
              : Promise.all([readAsset(PDFJS), readAsset(PDFJS_WORKER)]).then((parts) => parts.join('\n')),
          LegacyFileSystem.readAsStringAsync(file.uri, { encoding: 'base64' }),
        ]);
        if (cancelled) return;
        // To a file, not to the WebView as a string - see the note at the
        // top. A fresh name each time so the WebView never shows a stale
        // page from its cache.
        const target = `${LegacyFileSystem.cacheDirectory}quicklook-${Date.now()}.html`;
        await LegacyFileSystem.writeAsStringAsync(target, pageFor(file.kind, base64, library));
        if (!cancelled) setHtml(target);
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      }
    })();
    return () => {
      cancelled = true;
      // The page written for the last file is not needed once it is gone.
      setHtml((previous) => {
        if (previous) LegacyFileSystem.deleteAsync(previous, { idempotent: true }).catch(() => {});
        return null;
      });
    };
  }, [file]);

  return (
    <Modal visible={file !== null} animationType="slide" onRequestClose={onClose}>
      <View style={styles.root}>
        <View style={[styles.bar, { paddingTop: insets.top + 8 }]}>
          <Pressable hitSlop={10} onPress={onClose}>
            <Ionicons name="close-outline" size={26} color={GLASS_TEXT} />
          </Pressable>
          <Text style={styles.title} numberOfLines={1}>
            {file?.name ?? ''}
          </Text>
          <Pressable hitSlop={10} onPress={onOpenElsewhere} style={styles.openElsewhere}>
            <Ionicons name="open-outline" size={18} color={GLASS_TEXT} />
            <Text style={styles.openElsewhereLabel}>В іншій програмі</Text>
          </Pressable>
        </View>

        {error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>Не вдалося показати файл</Text>
            <Text style={styles.errorHint}>{error}</Text>
          </View>
        ) : html ? (
          <WebView
            originWhitelist={['*']}
            source={{ uri: html }}
            style={styles.web}
            // Nothing here ever needs the network, and nothing may reach it.
            // File access is on only so the page itself can be loaded from
            // the cache directory it was written to.
            javaScriptEnabled
            domStorageEnabled={false}
            allowFileAccess
            allowFileAccessFromFileURLs
            setSupportMultipleWindows={false}
          />
        ) : (
          <View style={styles.center}>
            <ActivityIndicator color={GLASS_TEXT} />
            <Text style={styles.loading}>Відкриваю…</Text>
          </View>
        )}
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#fff',
  },
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingBottom: 10,
    backgroundColor: GLASS_BODY,
  },
  title: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT,
  },
  openElsewhere: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.12)',
  },
  openElsewhereLabel: {
    fontSize: 12,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT,
  },
  web: {
    flex: 1,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
  },
  loading: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: '#6B7280',
  },
  errorText: {
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
    color: '#111827',
  },
  errorHint: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
    textAlign: 'center',
  },
});
