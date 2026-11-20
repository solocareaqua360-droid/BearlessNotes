import type { SavedArticle } from './articleReader';

export type ReaderColors = { background: string; ink: string; muted: string; accent: string };

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// The reading page itself, built from the article's own cleaned text -
// every character escaped, nothing of the original site's markup or
// scripts carried over. Drawn by a WebView on the phone and an iframe in
// the browser, because both give real text selection: long-press, drag
// the handles, across paragraphs, the way every reader works. The one
// script here only reports what is selected, through whichever channel
// the host listens on.
export function buildReaderHtml(article: SavedArticle, colors: ReaderColors): string {
  const body = article.blocks
    .map((block) => {
      const text = escapeHtml(block.text);
      if (block.kind === 'h') return `<h2>${text}</h2>`;
      if (block.kind === 'li') return `<p class="li">${text}</p>`;
      if (block.kind === 'q') return `<blockquote>${text}</blockquote>`;
      return `<p>${text}</p>`;
    })
    .join('\n');
  const meta = [article.siteName, article.byline].filter(Boolean).map((s) => escapeHtml(s as string)).join(' · ');
  return `<!DOCTYPE html>
<html lang="uk"><head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<style>
  :root { color-scheme: light dark; }
  html, body { margin: 0; background: ${colors.background}; }
  body {
    color: ${colors.ink};
    font-family: Georgia, 'Noto Serif', 'Droid Serif', serif;
    font-size: 19px;
    line-height: 1.62;
    padding: 12px 20px 140px;
    -webkit-text-size-adjust: 100%;
    overflow-wrap: break-word;
  }
  main { max-width: 680px; margin: 0 auto; }
  h1 { font-size: 1.45em; line-height: 1.25; margin: 0.2em 0 0.3em; }
  .meta { color: ${colors.muted}; font-family: system-ui, sans-serif; font-size: 0.72em; margin-bottom: 1.4em; }
  h2 { font-size: 1.15em; line-height: 1.3; margin: 1.5em 0 0.4em; }
  p { margin: 0 0 1em; }
  p.li { padding-left: 1.1em; text-indent: -0.8em; }
  p.li::before { content: '• '; color: ${colors.muted}; }
  blockquote { margin: 0 0 1em; padding-left: 0.9em; border-left: 3px solid ${colors.accent}; color: ${colors.muted}; }
  ::selection { background: ${colors.accent}55; }
</style>
</head><body><main>
${article.title ? `<h1>${escapeHtml(article.title)}</h1>` : ''}
${meta ? `<div class="meta">${meta}</div>` : ''}
${body}
</main>
<script>
(function () {
  var last = null;
  function send() {
    var sel = window.getSelection();
    var text = sel ? String(sel.toString()).trim() : '';
    if (text === last) return;
    last = text;
    var msg = JSON.stringify({ type: 'selection', text: text });
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(msg);
    else if (window.parent !== window) window.parent.postMessage(msg, '*');
  }
  document.addEventListener('selectionchange', send);
  window.__clearSelection = function () {
    var sel = window.getSelection();
    if (sel) sel.removeAllRanges();
    send();
  };
})();
</script>
</body></html>`;
}
