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
import { readZip, bytesToBase64 } from '../utils/zip';
import { importMarkdown } from '../utils/markdownFile';
import { openFileExternally } from '../utils/openFileExternally';
import { navigationRef } from '../navigationRef';
import { notify } from './surfaces/Ask';

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

export type QuickLookKind = 'docx' | 'xlsx' | 'pdf' | 'md' | 'pptx' | 'zip';

// What this can show. Anything else goes straight to the app that opens
// it - see openFileExternally.
export function quickLookKindFor(fileName: string): QuickLookKind | null {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'docx') return 'docx';
  if (ext === 'xlsx' || ext === 'xls' || ext === 'csv') return 'xlsx';
  if (ext === 'pdf') return 'pdf';
  // 2026-10-31: a Markdown file (read, and taken in as a note), a slide deck (its text and pictures, a card a slide - not its layout),
  // an archive (its files, each opened in turn).
  if (ext === 'md' || ext === 'markdown') return 'md';
  if (ext === 'pptx') return 'pptx';
  if (ext === 'zip') return 'zip';
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
    kind === 'md'
      ? `var text = new TextDecoder('utf-8').decode(bytes).replace(/^\\uFEFF/, '');
         root.innerHTML = renderMarkdown(text) || '<p class="muted">Порожній файл</p>';
         allDone = true; pageDone();`
      : kind === 'pptx'
      ? `var cfb = XLSX.CFB.read(bytes, { type: 'array' });
         var find = function (p) { var e = XLSX.CFB.find(cfb, p) || XLSX.CFB.find(cfb, '/' + p); return e && e.content ? new Uint8Array(e.content) : null; };
         var decode = function (u) { return new TextDecoder('utf-8').decode(u); };
         var xml = function (u) { return new DOMParser().parseFromString(decode(u), 'application/xml'); };
         var kids = function (el, name) { var out = []; for (var i = 0; i < el.childNodes.length; i++) { var c = el.childNodes[i]; if (c.nodeType === 1 && (!name || c.localName === name)) out.push(c); } return out; };
         var all = function (el, name) { return Array.prototype.slice.call(el.getElementsByTagNameNS('*', name)); };
         var paraText = function (p) { return all(p, 't').map(function (t) { return t.textContent; }).join(''); };
         // The text of a shape, paragraph by paragraph; a slide's title placeholder is drawn as its heading.
         var shapeHtml = function (sp) {
           var ph = all(sp, 'ph')[0];
           var isTitle = ph && /title/i.test(ph.getAttribute('type') || '');
           var paras = all(sp, 'p').map(paraText).filter(function (t) { return t.trim(); });
           if (!paras.length) return '';
           if (isTitle) return '<h3>' + paras.map(esc).join('<br>') + '</h3>';
           return paras.map(function (t) { return '<p>' + esc(t) + '</p>'; }).join('');
         };
         // A table: its rows and cells, a cell's paragraphs on lines of their own; merged cells keep their span.
         var tableHtml = function (tbl) {
           var rows = kids(tbl, 'tr');
           return '<div class="scroll"><table>' + rows.map(function (tr, ri) {
             return '<tr>' + kids(tr, 'tc').map(function (tc) {
               if (tc.getAttribute('hMerge') === '1' || tc.getAttribute('vMerge') === '1') return '';
               var span = (tc.getAttribute('gridSpan') ? ' colspan="' + tc.getAttribute('gridSpan') + '"' : '') + (tc.getAttribute('rowSpan') ? ' rowspan="' + tc.getAttribute('rowSpan') + '"' : '');
               var text = all(tc, 'p').map(paraText).map(esc).join('<br>');
               return (ri === 0 ? '<th' : '<td') + span + '>' + text + (ri === 0 ? '</th>' : '</td>');
             }).join('') + '</tr>';
           }).join('') + '</table></div>';
         };
         var slides = [];
         cfb.FullPaths.forEach(function (p) { var m = p.match(/ppt\\/slides\\/slide(\\d+)\\.xml$/); if (m) slides.push(+m[1]); });
         slides.sort(function (a, b) { return a - b; });
         var html = '';
         slides.forEach(function (n) {
           var raw = find('ppt/slides/slide' + n + '.xml');
           if (!raw) return;
           var doc = xml(raw);
           var images = {};
           var rels = find('ppt/slides/_rels/slide' + n + '.xml.rels');
           if (rels) all(xml(rels), 'Relationship').forEach(function (r) {
             if (/\\/image$/.test(r.getAttribute('Type') || '')) images[r.getAttribute('Id')] = 'ppt/' + (r.getAttribute('Target') || '').replace(/^\\.\\.\\//, '');
           });
           var picHtml = function (pic) {
             var blip = all(pic, 'blip')[0];
             if (!blip) return '';
             var id = blip.getAttribute('r:embed') || blip.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'embed');
             var path = images[id];
             var img = path ? find(path) : null;
             if (!img) return '';
             var ext = (path.split('.').pop() || 'png').toLowerCase();
             if (ext === 'emf' || ext === 'wmf') return '';
             var bin = '';
             for (var k = 0; k < img.length; k += 8192) bin += String.fromCharCode.apply(null, img.subarray(k, k + 8192));
             return '<img src="data:image/' + (ext === 'jpg' ? 'jpeg' : ext) + ';base64,' + btoa(bin) + '">';
           };
           // The slide's shapes in the order they stand; a group is walked into.
           var walk = function (el) {
             return kids(el).map(function (c) {
               if (c.localName === 'sp') return shapeHtml(c);
               if (c.localName === 'pic') return picHtml(c);
               if (c.localName === 'grpSp') return walk(c);
               if (c.localName === 'graphicFrame') { var tbl = all(c, 'tbl')[0]; return tbl ? tableHtml(tbl) : ''; }
               return '';
             }).join('');
           };
           var tree = all(doc, 'spTree')[0];
           html += '<div class="slide"><div class="num">Слайд ' + n + '</div>' + (tree ? walk(tree) : '') + '</div>';
         });
         root.innerHTML = html || '<p class="muted">У презентації не знайшлося слайдів</p>';
         allDone = true; pageDone();`
      : kind === 'zip'
      ? `var cfb = XLSX.CFB.read(bytes, { type: 'array' });
         var rows = [];
         cfb.FileIndex.forEach(function (f, i) {
           if (f.type !== 2 || !f.content) return;
           var raw = (cfb.FullPaths[i] || f.name).replace(/^Root Entry\\//, '');
           var name = raw;
           try { name = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(raw.split('').map(function (c) { return c.charCodeAt(0) & 255; }))); } catch (e) {}
           if (name.charAt(0) === '\\u0001' || /\\/$/.test(name) || name.indexOf('__MACOSX/') === 0) return;
           rows.push({ name: name, size: f.content.length });
         });
         rows.sort(function (a, b) { return a.name.localeCompare(b.name); });
         var kb = function (n) { return n < 1024 ? n + ' Б' : n < 1048576 ? Math.round(n / 1024) + ' КБ' : (n / 1048576).toFixed(1) + ' МБ'; };
         root.innerHTML = rows.length
           ? '<p class="muted">' + rows.length + ' файлів у архіві. Натисни файл, щоб відкрити.</p>' + rows.map(function (r) {
               var parts = r.name.split('/'), file = parts.pop();
               return '<div class="zrow" data-name="' + esc(r.name) + '"><div class="zname">' + esc(file) + '</div><div class="zmeta">' + (parts.length ? esc(parts.join(' / ')) + ' · ' : '') + kb(r.size) + '</div></div>';
             }).join('')
           : '<p class="muted">Архів порожній</p>';
         root.addEventListener('click', function (ev) {
           var row = ev.target.closest ? ev.target.closest('.zrow') : null;
           if (row && window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify({ open: row.getAttribute('data-name') }));
         });
         allDone = true; pageDone();`
      : kind === 'docx'
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
  h1.md, h2.md, h3.md, h4.md { font-size: inherit; color: #111827; text-transform: none; letter-spacing: 0; }
  h1.md { font-size: 24px; } h2.md { font-size: 20px; } h3.md { font-size: 17px; }
  .li { margin: 3px 0; }
  pre { background: #F3F4F6; border-radius: 8px; padding: 10px; overflow-x: auto; font-size: 13px; }
  code { background: #F3F4F6; border-radius: 4px; padding: 0 3px; }
  pre code { background: none; padding: 0; }
  blockquote { margin: 8px 0; padding: 6px 12px; border-radius: 8px; background: #F5F3EE; }
  th { background: #F5F3EE; text-align: left; }
  hr { border: none; border-top: 1px solid #E5E7EB; margin: 14px 0; }
  .slide { box-sizing: border-box; max-width: 100%; border: 1px solid #E5E7EB; border-radius: 14px; padding: 14px 16px; margin: 0 0 14px; }
  .slide .num { font-size: 12px; color: #9CA3AF; margin-bottom: 6px; }
  .slide h3 { margin: 0 0 8px; font-size: 18px; }
  .slide table { white-space: normal; }
  .slide td, .slide th { white-space: normal; min-width: 60px; }
  .slide p { margin: 4px 0; }
  .slide img { display: block; margin: 10px auto 0; border-radius: 8px; max-height: 360px; }
  .zrow { padding: 12px 4px; border-bottom: 1px solid #F0EFEA; }
  .zname { font-size: 16px; color: #111827; word-break: break-word; }
  .zmeta { font-size: 13px; color: #9CA3AF; margin-top: 2px; }
  .error { color: #B91C1C; }
</style></head><body>
<div id="root" class="${kind === 'pptx' || kind === 'md' || kind === 'zip' ? '' : 'scroll'}"><p class="muted">Відкриваю…</p></div>
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
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  // MARKDOWN, enough to read a note written in it: headings, lists, checkboxes, quotes, code, rules, tables, bold/italic/code/links.
  function inline(t) {
    return esc(t)
      .replace(/!\\[([^\\]]*)\\]\\(([^)]+)\\)/g, '<span class="muted">[$1]</span>')
      .replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>')
      .replace(/\\*\\*([^*]+)\\*\\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\\*([^*\\s][^*]*)\\*/g, '$1<i>$2</i>')
      .replace(/\`([^\`]+)\`/g, '<code>$1</code>')
      .replace(/~~([^~]+)~~/g, '<s>$1</s>')
      .replace(/&lt;br\\s*\\/?&gt;/gi, '<br>');
  }
  function renderMarkdown(src) {
    var lines = src.replace(/\\r\\n?/g, '\\n').split('\\n'), out = [], para = [], i = 0;
    function flush() { if (para.length) { out.push('<p>' + para.map(inline).join('<br>') + '</p>'); para = []; } }
    while (i < lines.length) {
      var l = lines[i], m;
      if (/^\\s*\`\`\`/.test(l)) { flush(); var code = []; i++; while (i < lines.length && !/^\\s*\`\`\`/.test(lines[i])) code.push(lines[i++]); out.push('<pre><code>' + esc(code.join('\\n')) + '</code></pre>'); i++; continue; }
      if (/^\\s*\\|.*\\|\\s*$/.test(l)) {
        flush(); var rows = [];
        while (i < lines.length && /^\\s*\\|.*\\|\\s*$/.test(lines[i])) { if (!/^\\s*\\|[\\s:|-]+\\|\\s*$/.test(lines[i])) rows.push(lines[i].trim().replace(/^\\||\\|$/g, '').split('|')); i++; }
        out.push('<div class="scroll"><table>' + rows.map(function (r, ri) { return '<tr>' + r.map(function (c) { return (ri ? '<td>' : '<th>') + inline(c.trim()) + (ri ? '</td>' : '</th>'); }).join('') + '</tr>'; }).join('') + '</table></div>');
        continue;
      }
      if (!l.trim()) { flush(); i++; continue; }
      if ((m = l.match(/^(#{1,6})\\s+(.*)$/))) { flush(); out.push('<h' + Math.min(6, m[1].length) + ' class="md">' + inline(m[2]) + '</h' + Math.min(6, m[1].length) + '>'); i++; continue; }
      if (/^\\s*([-*_])\\1{2,}\\s*$/.test(l)) { flush(); out.push('<hr>'); i++; continue; }
      if ((m = l.match(/^(\\s*)[-*•]\\s+\\[([ xX])\\]\\s+(.*)$/))) { flush(); out.push('<div class="li" style="margin-left:' + (m[1].length * 9) + 'px">' + (m[2] === ' ' ? '☐' : '☑') + ' ' + inline(m[3]) + '</div>'); i++; continue; }
      if ((m = l.match(/^(\\s*)[-*•]\\s+(.*)$/))) { flush(); out.push('<div class="li" style="margin-left:' + (m[1].length * 9) + 'px">• ' + inline(m[2]) + '</div>'); i++; continue; }
      if ((m = l.match(/^(\\s*)(\\d+)[.)]\\s+(.*)$/))) { flush(); out.push('<div class="li" style="margin-left:' + (m[1].length * 9) + 'px">' + m[2] + '. ' + inline(m[3]) + '</div>'); i++; continue; }
      if ((m = l.match(/^>\\s?(.*)$/))) { flush(); out.push('<blockquote>' + inline(m[1]) + '</blockquote>'); i++; continue; }
      para.push(l); i++;
    }
    flush();
    return out.join('');
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
  // A file taken out of an archive and looked at in turn (its own quick look over this one).
  const [inner, setInner] = useState<{ uri: string; name: string; kind: QuickLookKind } | null>(null);
  async function openZipEntry(name: string) {
    if (!file) return;
    try {
      const entry = readZip(await LegacyFileSystem.readAsStringAsync(file.uri, { encoding: 'base64' })).find((e) => e.path === name);
      if (!entry) return;
      const base = name.split('/').pop() || 'файл';
      const target = `${LegacyFileSystem.cacheDirectory}zip-${Date.now()}-${base.replace(/[^\w.\-а-яіїєґА-ЯІЇЄҐ ]/g, '_')}`;
      await LegacyFileSystem.writeAsStringAsync(target, bytesToBase64(entry.bytes), { encoding: 'base64' });
      const kind = quickLookKindFor(base);
      if (kind) setInner({ uri: target, name: base, kind });
      else await openFileExternally({ fileUri: target, fileName: base });
    } catch (e) {
      notify('Не вдалося відкрити файл з архіву', (e as Error).message);
    }
  }
  // A .md taken in as a note of the app (utils/markdownFile): it opens, the preview steps away.
  async function importAsNote() {
    if (!file) return;
    try {
      const text = await LegacyFileSystem.readAsStringAsync(file.uri, { encoding: 'utf8' });
      const id = await importMarkdown(text, file.name);
      onClose();
      if (navigationRef.isReady()) (navigationRef.navigate as (n: string, p?: object) => void)('Editor', { documentId: id });
    } catch (e) {
      notify('Не вдалося імпортувати', (e as Error).message);
    }
  }
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
          file.kind === 'md'
            ? Promise.resolve('')
            : file.kind === 'docx'
            ? readAsset(MAMMOTH)
            : file.kind === 'xlsx' || file.kind === 'pptx' || file.kind === 'zip'
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
            {file?.kind === 'md' && (
              <Pressable hitSlop={8} onPress={importAsNote} accessibilityLabel="Імпортувати як нотатку" style={styles.pillButton}>
                <Ionicons name="download-outline" size={19} color={S.ink} />
              </Pressable>
            )}
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
                const data = JSON.parse(e.nativeEvent.data);
                if (typeof data.open === 'string') openZipEntry(data.open);
                else setFound(data);
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

  const innerLook = inner ? (
    <DocumentQuickLook
      file={inner}
      onClose={() => setInner(null)}
      onOpenElsewhere={() => openFileExternally({ fileUri: inner.uri, fileName: inner.name })}
    />
  ) : null;
  if (embedded) return file ? <>{body}{innerLook}</> : null;
  return (
    <FlipModal visible={file !== null} flipFrom={flipFrom} animationType="slide" onRequestClose={onClose}>
      {body}
      {innerLook}
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
