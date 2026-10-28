import { useEffect, useRef, useState } from 'react';
import FlipModal from './FlipModal';
import type { FlipFrom } from '../utils/flipOpen';
import { ActivityIndicator, Keyboard, Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import TextInput from './AppTextInput';
import { Ionicons } from './icons/Ionicons';
import { WebView } from 'react-native-webview';
import { Asset } from 'expo-asset';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { GLASS_TEXT, GLASS_TEXT_MUTED } from '../constants/glass';
import { useSoft } from '../theme/soft';
import { topBarFrame } from './TopNavBar';

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
           .then(function (r) { root.innerHTML = r.value || '<p class="muted">Порожній документ</p>'; allDone = true; pageDone(); })
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
               if (n > pdf.numPages) { allDone = true; pageDone(); return; }
               pdf.getPage(n).then(function (page) {
                 var base = page.getViewport({ scale: 1 });
                 var scale = width / base.width;
                 var cssViewport = page.getViewport({ scale: scale });
                 var viewport = page.getViewport({ scale: scale * ratio });
                 var box = document.createElement('div');
                 box.className = 'page';
                 box.style.width = width + 'px';
                 box.style.height = cssViewport.height + 'px';
                 var canvas = document.createElement('canvas');
                 canvas.width = viewport.width;
                 canvas.height = viewport.height;
                 box.appendChild(canvas);
                 root.appendChild(box);
                 return page.render({ canvasContext: canvas.getContext('2d'), viewport: viewport }).promise.then(function () {
                   // The words, invisible, laid over the picture where they stand - what the search finds and
                   // lights up. A page whose words cannot be read is still a page: its picture stays.
                   return page.getTextContent().then(function (tc) {
                     tc.items.forEach(function (it) { textChars += (it.str || '').length; });
                     var layer = document.createElement('div');
                     layer.className = 'textLayer';
                     layer.style.setProperty('--scale-factor', scale);
                     box.appendChild(layer);
                     return pdfjsLib.renderTextLayer({ textContentSource: tc, container: layer, viewport: cssViewport }).promise;
                   }).catch(function () {});
                 });
               }).then(function () { n += 1; pageDone(); next(); }).catch(function (e) { fail(e); });
             }
             next();
           }).catch(function (e) { fail(e); });`
        : `try {
           // A CSV carries no word on its encoding; read as UTF-8, Ukrainian headers came out as Ð Ð°Ñ.
           var wb = XLSX.read(bytes, { type: 'array', codepage: 65001 });
           var html = '';
           wb.SheetNames.forEach(function (name) {
             var sheet = wb.Sheets[name];
             // A sheet with no cells at all carries no '!ref', and
             // sheet_to_html reads that range with no guard of its own -
             // decoding undefined is where "Cannot read properties of
             // undefined (reading 'indexOf')" came from, and it took the
             // WHOLE workbook's preview down, not just the empty sheet.
             if (!sheet || !sheet['!ref']) {
               html += '<h2>' + name + '</h2><p class="muted">Порожній аркуш</p>';
               return;
             }
             try {
               html += '<h2>' + name + '</h2>' + XLSX.utils.sheet_to_html(sheet, { header: '', footer: '' });
             } catch (e) {
               // One sheet the library cannot render is one sheet, not
               // the file.
               html += '<h2>' + name + '</h2><p class="error">Цей аркуш показати не вдалося</p>';
             }
           });
           root.innerHTML = html || '<p class="muted">Порожня таблиця</p>';
           allDone = true; pageDone();
         } catch (e) { fail(e); }`;
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  body { margin: 0; padding: 16px 18px 120px; font: 16px/1.5 -apple-system, Roboto, sans-serif; color: #111827; background: #fff; }
  img { max-width: 100%; height: auto; }
  h1, h2, h3 { line-height: 1.25; }
  h2 { font-size: 15px; color: #6B7280; margin: 20px 0 8px; text-transform: uppercase; letter-spacing: .04em; }
  table { border-collapse: collapse; font-size: 13px; margin: 8px 0 16px; max-width: 100%; }
  td, th { border: 1px solid #E5E7EB; padding: 4px 8px; vertical-align: top; white-space: nowrap; }
  .scroll { overflow-x: auto; }
  .page { position: relative; display: block; margin: 0 auto 12px; box-shadow: 0 1px 6px rgba(0,0,0,.18); border-radius: 2px; background: #fff; overflow: hidden; }
  .page canvas { display: block; width: 100%; height: 100%; }
  .textLayer { position: absolute; left: 0; top: 0; right: 0; bottom: 0; overflow: hidden; line-height: 1; text-size-adjust: none; -webkit-text-size-adjust: none; transform-origin: 0 0; }
  .textLayer span, .textLayer br { color: transparent; position: absolute; white-space: pre; transform-origin: 0% 0%; }
  mark { background: #F5DCC6; color: inherit; border-radius: 3px; }
  mark.cur { background: #E58B4E; color: #fff; }
  .textLayer mark { color: transparent; background: rgba(229, 139, 78, .22); border-radius: 2px; }
  .textLayer mark.cur { color: transparent; background: rgba(229, 139, 78, .55); box-shadow: 0 0 0 2px #E58B4E; }
  td.hitcell { background: #FBEDE1; }
  td.curcell { background: #F5DCC6; }
  .muted { color: #9CA3AF; }
  .error { color: #B91C1C; }
</style></head><body>
<div id="root" class="scroll"><p class="muted">Відкриваю…</p></div>
<script>${library}</script>
<script>
  var root = document.getElementById('root');
  // SEARCH (2026-10-16, sketch WcuFoVrdGuUZYV6sNydUTb): the app sends find(query) and step(+1/-1); every match
  // becomes a <mark>, the current one .cur; the count goes back to the app.
  var allDone = false, textChars = -1, Q = '', marks = [], cur = -1;
  if (${kind === 'pdf' ? 'true' : 'false'}) textChars = 0;
  function post() {
    if (!window.ReactNativeWebView) return;
    window.ReactNativeWebView.postMessage(JSON.stringify({ count: marks.length, index: cur, noText: allDone && textChars === 0, ready: allDone }));
  }
  function clearMarks() {
    marks.forEach(function (m) {
      var p = m.parentNode;
      if (!p) return;
      p.replaceChild(document.createTextNode(m.textContent), m);
      p.normalize();
    });
    marks = [];
    var cells = document.querySelectorAll('td.hitcell');
    for (var i = 0; i < cells.length; i++) cells[i].classList.remove('hitcell', 'curcell');
  }
  function show(scroll) {
    var cells = document.querySelectorAll('td.curcell');
    for (var i = 0; i < cells.length; i++) cells[i].classList.remove('curcell');
    marks.forEach(function (m, i) { m.className = i === cur ? 'cur' : ''; });
    var m = marks[cur];
    if (!m) return;
    var td = m.closest ? m.closest('td') : null;
    if (td) td.classList.add('curcell');
    if (scroll) m.scrollIntoView({ block: 'center', inline: 'center' });
  }
  function find(q, keep) {
    var prev = cur;
    clearMarks();
    Q = q;
    cur = -1;
    if (!q) { post(); return; }
    var needle = q.toLocaleLowerCase();
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach(function (node) {
      var text = node.nodeValue;
      var low = text.toLocaleLowerCase();
      var at = low.indexOf(needle);
      if (at < 0 || low.length !== text.length) return;
      var frag = document.createDocumentFragment();
      var last = 0;
      while (at >= 0) {
        frag.appendChild(document.createTextNode(text.slice(last, at)));
        var m = document.createElement('mark');
        m.textContent = text.slice(at, at + needle.length);
        frag.appendChild(m);
        marks.push(m);
        var td = node.parentNode && node.parentNode.closest ? node.parentNode.closest('td') : null;
        if (td) td.classList.add('hitcell');
        last = at + needle.length;
        at = low.indexOf(needle, last);
      }
      frag.appendChild(document.createTextNode(text.slice(last)));
      node.parentNode.replaceChild(frag, node);
    });
    if (marks.length) {
      cur = keep && prev >= 0 ? Math.min(prev, marks.length - 1) : 0;
      show(!keep);
    }
    post();
  }
  function step(d) {
    if (!marks.length) return;
    cur = (cur + d + marks.length) % marks.length;
    show(true);
    post();
  }
  // A PDF draws page after page: the matches on pages that arrive later join in, the current one stays.
  function pageDone() {
    if (Q) find(Q, true);
    else post();
  }
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
  embedded,
  flipFrom,
}: {
  // Opened from the file's card: the preview comes round from its back
  // (utils/flipOpen, FlipModal).
  flipFrom?: FlipFrom | null;
  // null closes it.
  file: { uri: string; name: string; kind: QuickLookKind } | null;
  onClose: () => void;
  // The real program, one tap away.
  onOpenElsewhere: () => void;
  // Drawn in place - the left half of a wide screen, beside the list -
  // rather than as a sheet over everything. Same look, same bar; only
  // where it stands differs.
  embedded?: boolean;
}) {
  const insets = useSafeAreaInsets();
  const S = useSoft();
  const { width: windowWidth } = useWindowDimensions();
  const [html, setHtml] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // SEARCH IN THE FILE (2026-10-16, sketch WcuFoVrdGuUZYV6sNydUTb): a field where the dock always is, the count and
  // two arrows in it; the page itself marks the matches (see find/step in pageFor).
  const webRef = useRef<WebView>(null);
  const inputRef = useRef<TextInput>(null);
  const [query, setQuery] = useState('');
  const [focused, setFocused] = useState(false);
  const [found, setFound] = useState<{ count: number; index: number; noText: boolean; ready: boolean }>({
    count: 0,
    index: -1,
    noText: false,
    ready: false,
  });
  const [keyboardH, setKeyboardH] = useState(0);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardH(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardH(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  // A new file starts with no search.
  useEffect(() => {
    setQuery('');
    setFound({ count: 0, index: -1, noText: false, ready: false });
  }, [file]);
  // Typed: asked of the page a beat later, not on every letter.
  useEffect(() => {
    const t = setTimeout(() => webRef.current?.injectJavaScript(`find(${JSON.stringify(query)}); true;`), 180);
    return () => clearTimeout(t);
  }, [query]);
  const step = (d: 1 | -1) => webRef.current?.injectJavaScript(`step(${d}); true;`);
  const searching = focused || query.length > 0;
  const closeSearch = () => {
    setQuery('');
    inputRef.current?.blur();
    Keyboard.dismiss();
  };
  const frame = topBarFrame(windowWidth);
  const counter =
    !query
      ? ''
      : found.noText
        ? 'Немає тексту'
        : found.count === 0
          ? found.ready
            ? 'Не знайдено'
            : '…'
          : `${found.index + 1} з ${found.count}`;

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

  const body = (
      <View style={styles.root}>
        {/* The file's name in the app's own white bar; the way out is the circle at the dock's end. */}
        <View style={{ paddingTop: (embedded ? 0 : insets.top) + 8, paddingBottom: 8, backgroundColor: S.bg }}>
          <View
            style={[
              styles.pill,
              { marginLeft: frame.left, width: frame.width, backgroundColor: S.chrome, boxShadow: S.shadow },
            ]}
          >
            <View style={styles.pillTitle}>
              <Ionicons name="document-outline" size={17} color={S.ink} />
              <Text style={[styles.title, { color: S.ink }]} numberOfLines={1}>
                {file?.name ?? ''}
              </Text>
            </View>
            <Pressable hitSlop={8} onPress={onOpenElsewhere} accessibilityLabel="В іншій програмі" style={styles.pillButton}>
              <Ionicons name="open-outline" size={19} color={S.ink} />
            </Pressable>
          </View>
        </View>

        {error ? (
          <View style={styles.center}>
            <Text style={styles.errorText}>Не вдалося показати файл</Text>
            <Text style={styles.errorHint}>{error}</Text>
          </View>
        ) : html ? (
          <WebView
            ref={webRef}
            onMessage={(e) => {
              try {
                setFound(JSON.parse(e.nativeEvent.data));
              } catch {}
            }}
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

        {/* THE DOCK: the search field and the circle (back; while searching, the way out of the search). */}
        {!error && (
          <View
            pointerEvents="box-none"
            style={[styles.dock, { left: frame.left, width: frame.width, bottom: keyboardH > 0 ? keyboardH + 10 : insets.bottom + 18 }]}
          >
            <Pressable
              onPress={() => inputRef.current?.focus()}
              style={[styles.field, { backgroundColor: S.chrome, boxShadow: S.shadow }]}
            >
              <Ionicons name="search-outline" size={19} color={S.ink2} />
              <TextInput
                ref={inputRef}
                value={query}
                onChangeText={setQuery}
                onFocus={() => setFocused(true)}
                onBlur={() => setFocused(false)}
                onSubmitEditing={() => step(1)}
                placeholder="Знайти у файлі"
                placeholderTextColor={S.ink3}
                returnKeyType="search"
                submitBehavior="submit"
                style={[styles.fieldInput, { color: S.ink }]}
              />
              {!!counter && <Text style={[styles.counter, { color: S.ink3 }]}>{counter}</Text>}
              {found.count > 0 && !!query && (
                <>
                  <Pressable hitSlop={4} onPress={() => step(-1)} accessibilityLabel="Попередній збіг" style={[styles.stepButton, { backgroundColor: S.fillSolid }]}>
                    <Ionicons name="chevron-up" size={17} color={S.ink} />
                  </Pressable>
                  <Pressable hitSlop={4} onPress={() => step(1)} accessibilityLabel="Наступний збіг" style={[styles.stepButton, { backgroundColor: S.ink }]}>
                    <Ionicons name="chevron-down" size={17} color={S.chrome} />
                  </Pressable>
                </>
              )}
            </Pressable>
            <Pressable
              onPress={searching ? closeSearch : onClose}
              hitSlop={6}
              accessibilityLabel={searching ? 'Закрити пошук' : 'Назад'}
              style={[styles.circle, { backgroundColor: S.chrome, boxShadow: S.shadow }]}
            >
              <Ionicons name={searching ? 'close' : 'chevron-back'} size={searching ? 20 : 22} color={S.ink} />
            </Pressable>
          </View>
        )}
      </View>
  );

  if (embedded) return file ? body : null;
  return (
    <FlipModal visible={file !== null} flipFrom={flipFrom} animationType="slide" onRequestClose={onClose}>
      {body}
    </FlipModal>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#fff',
  },
  pill: {
    height: 46,
    borderRadius: 23,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 52,
    paddingRight: 6,
  },
  pillTitle: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  pillButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    flexShrink: 1,
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
  },
  dock: {
    position: 'absolute',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  field: {
    flex: 1,
    height: 56,
    borderRadius: 28,
    flexDirection: 'row',
    alignItems: 'center',
    paddingLeft: 18,
    paddingRight: 6,
    gap: 8,
  },
  fieldInput: {
    flex: 1,
    minWidth: 0,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    paddingVertical: 0,
  },
  counter: {
    fontSize: 12.5,
    fontFamily: FONT_SEMIBOLD,
  },
  stepButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },
  circle: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
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
