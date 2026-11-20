// THE MAC'S PASTE KEEPS THE SHAPE (2026-10-21, the user: five points copied out of a chat landed as ONE plain block, no
// list, no heading). Selecting text in a rendered page puts BOTH plain text and HTML on the clipboard; the plain text has
// lost the numbers and the bold, the HTML still has <ol>, <li>, <h2>, <strong>. So on a paste into a note's block the HTML
// is read back into the markdown the editor already understands (pasteBlocks.parsePastedText turns "# ", "1. ", "- ",
// "| a | b |" into blocks) and inserted as plain text - the existing paste pipeline does the splitting.
const BLOCK_TAGS = /<(h[1-6]|ol|ul|li|table|pre|blockquote)\b/i;

function inline(node: Node): string {
  if (node.nodeType === Node.TEXT_NODE) return (node.textContent ?? '').replace(/\s+/g, ' ');
  if (node.nodeType !== Node.ELEMENT_NODE) return '';
  const el = node as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const inner = Array.from(el.childNodes).map(inline).join('');
  if (tag === 'br') return '\n';
  if (tag === 'strong' || tag === 'b') return inner.trim() ? `**${inner.trim()}**` : inner;
  if (tag === 'em' || tag === 'i') return inner.trim() ? `*${inner.trim()}*` : inner;
  return inner;
}

function block(el: Element, out: string[], listType: 'ul' | 'ol' | null, index: { n: number }): void {
  const tag = el.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) {
    const level = Number(tag[1]);
    out.push(`${'#'.repeat(level)} ${inline(el).trim()}`, '');
    return;
  }
  if (tag === 'ul' || tag === 'ol') {
    const counter = { n: 0 };
    Array.from(el.children).forEach((child) => block(child, out, tag as 'ul' | 'ol', counter));
    out.push('');
    return;
  }
  if (tag === 'li') {
    index.n += 1;
    // The item's own text, not its nested list (that is walked below as lines of its own).
    const own = Array.from(el.childNodes)
      .filter((c) => !(c.nodeType === Node.ELEMENT_NODE && /^(ul|ol)$/i.test((c as Element).tagName)))
      .map(inline)
      .join('')
      .trim();
    out.push(listType === 'ol' ? `${index.n}. ${own}` : `- ${own}`);
    Array.from(el.children).forEach((child) => {
      if (/^(ul|ol)$/i.test(child.tagName)) block(child, out, null, { n: 0 });
    });
    return;
  }
  if (tag === 'pre') {
    out.push('```', el.textContent ?? '', '```', '');
    return;
  }
  if (tag === 'table') {
    const rows = Array.from(el.querySelectorAll('tr')).map((tr) => Array.from(tr.children).map((c) => inline(c).trim().replace(/\|/g, '\\|')));
    rows.forEach((cells, i) => {
      out.push(`| ${cells.join(' | ')} |`);
      if (i === 0) out.push(`| ${cells.map(() => '---').join(' | ')} |`);
    });
    out.push('');
    return;
  }
  if (tag === 'p' || tag === 'blockquote') {
    const text = inline(el).trim();
    if (text) out.push(text, '');
    return;
  }
  // A wrapper (div, section...): its children are the blocks. A wrapper with only inline content is one paragraph.
  const hasBlockChild = Array.from(el.children).some((c) => /^(h[1-6]|p|ul|ol|li|table|pre|div|section|blockquote)$/i.test(c.tagName));
  if (hasBlockChild) {
    Array.from(el.childNodes).forEach((child) => {
      if (child.nodeType === Node.ELEMENT_NODE) block(child as Element, out, listType, index);
      else {
        const t = (child.textContent ?? '').trim();
        if (t) out.push(t, '');
      }
    });
  } else {
    const text = inline(el).trim();
    if (text) out.push(text, '');
  }
}

export function htmlToMarkdown(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const out: string[] = [];
  Array.from(doc.body.childNodes).forEach((child) => {
    if (child.nodeType === Node.ELEMENT_NODE) block(child as Element, out, null, { n: 0 });
    else {
      const t = (child.textContent ?? '').trim();
      if (t) out.push(t, '');
    }
  });
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// Once for the whole window, however many editors are mounted (a second listener would insert the text twice).
let installed = false;
export function installPasteMarkdown(): () => void {
  if (typeof window === 'undefined' || installed) return () => {};
  installed = true;
  const onPaste = (event: ClipboardEvent) => {
    const target = event.target as HTMLElement | null;
    // Only a note's own block: nothing else in the app (search, the board's blocks, a code block) is touched.
    if (!target || target.tagName !== 'TEXTAREA' || !target.closest('[data-noteblock]')) return;
    const html = event.clipboardData?.getData('text/html') ?? '';
    if (!html || !BLOCK_TAGS.test(html)) return;
    const md = htmlToMarkdown(html);
    if (!md || !/[\n]/.test(md)) return;
    event.preventDefault();
    // Typed in by the browser as if it were the user's own text: the field's input event carries it into the editor.
    document.execCommand('insertText', false, md);
  };
  window.addEventListener('paste', onPaste, true);
  return () => {};
}
