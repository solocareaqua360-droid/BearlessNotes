import { SketchElement } from '../types';

// A drawing, as SVG markup.
//
// The editor draws the very same elements with react-native-svg's <Path>
// and <Text> (see SketchEditor) - this writes them out as the markup a
// plain WebView understands, which is what expo-print turns into a PDF.
// So a sketch exports as VECTORS: it stays sharp at any zoom, and there
// is no screenshot step and so no native module.
//
// Until this existed the exporter had nothing to say about a sketch and
// wrote the words "[Малюнок]" into the document instead - which is what
// a note full of drawings came out of a PDF export looking like.

function escapeXml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type SketchSvgOptions = {
  // Laid over something else (a photograph) rather than standing on its
  // own: the svg is positioned absolutely and its background stays clear.
  overlay?: boolean;
  // What the drawing was captured against. Without them the canvas has
  // no coordinate system and the paths would be drawn at the wrong size.
  width?: number;
  height?: number;
};

export function sketchToSvg(
  elements: SketchElement[] | undefined,
  { overlay, width, height }: SketchSvgOptions = {}
): string {
  if (!elements?.length) return '';
  // The size the elements were drawn against. A sketch saved before those
  // fields existed falls back to the box its own elements occupy, so an
  // old drawing exports at a sane size rather than not at all.
  const w = width && width > 0 ? width : boundsOf(elements).w;
  const h = height && height > 0 ? height : boundsOf(elements).h;
  const body = elements
    .map((el) =>
      el.kind === 'text'
        ? `<text x="${el.x}" y="${el.y}" fill="${el.color}" font-size="${el.fontSize}" ` +
          `font-family="sans-serif">${escapeXml(el.text)}</text>`
        : `<path d="${escapeXml(el.d)}" stroke="${el.color}" stroke-width="${el.width}" fill="none" ` +
          `stroke-linecap="round" stroke-linejoin="round"/>`
    )
    .join('');
  const style = overlay
    ? 'position:absolute;left:0;top:0;width:100%;height:100%;'
    : 'width:100%;height:auto;margin:8px 0;';
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="${style}" ` +
    `preserveAspectRatio="none">${body}</svg>`;
}

// A photograph with a drawing over it: one box, the picture filling it,
// the drawing on top in the same coordinate system. The photo itself is
// never touched - this is only how the two are put together for an
// export, the same way the app puts them together on screen.
export function photoWithSketchHtml(
  imgTag: string,
  elements: SketchElement[] | undefined,
  width?: number,
  height?: number
): string {
  const svg = sketchToSvg(elements, { overlay: true, width, height });
  if (!svg) return imgTag;
  return `<div style="position:relative;display:inline-block;max-width:100%;margin:8px 0;">${imgTag}${svg}</div>`;
}

function boundsOf(elements: SketchElement[]): { w: number; h: number } {
  let maxX = 0;
  let maxY = 0;
  for (const el of elements) {
    if (el.kind === 'text') {
      maxX = Math.max(maxX, el.x + el.text.length * el.fontSize * 0.6);
      maxY = Math.max(maxY, el.y);
      continue;
    }
    // The path's own numbers - every command in these strings is written
    // as absolute coordinates by the editor, so reading the pairs off is
    // enough to find the box without parsing the grammar.
    const numbers = el.d.match(/-?\d+(\.\d+)?/g) ?? [];
    for (let i = 0; i + 1 < numbers.length; i += 2) {
      maxX = Math.max(maxX, Number(numbers[i]));
      maxY = Math.max(maxY, Number(numbers[i + 1]));
    }
  }
  return { w: Math.max(1, Math.ceil(maxX)), h: Math.max(1, Math.ceil(maxY)) };
}
