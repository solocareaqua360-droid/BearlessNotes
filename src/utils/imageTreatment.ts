// Turning any picture - a logo, a screenshot, a stock photo of a truck -
// into something that belongs on this board rather than looking pasted
// onto it.
//
// The problem a duotone solves: put a red YouTube thumbnail and a
// multicoloured Google Maps pin side by side on a dark board, and every
// tile shouts its own colour at once - a collage, not a dashboard. A
// photograph brings its OWN hue no matter how carefully it is cropped.
//
// A duotone throws that hue away and keeps only the shape: every pixel's
// brightness is looked up between two colours - dark for a shadow, the
// TILE'S OWN colour for a highlight - so a YouTube logo and a photo of a
// truck end up printed in the same ink. What varies between tiles is
// exactly the one thing that is supposed to vary: the tile's colour.
//
// NOT ONE BACKSLASH here: this is a template literal building a page, and
// a regular expression written here would have its backslash eaten before
// the page ever saw it - the exact failure that cost a whole afternoon
// with the OCR reader.

function hexChannel(hex: string, offset: number): number {
  return parseInt(hex.slice(offset, offset + 2), 16);
}

// The dark end of the gradient, shared by every tile: not pure black, so
// a picture never goes to a dead hole in the corner, and warm enough to
// sit on the app's own near-black rather than reading as a cutout.
const SHADOW = { r: 15, g: 13, b: 12 };

export function duotoneScript(hex: string): string {
  const clean = hex.replace('#', '');
  const highlight = {
    r: hexChannel(clean, 0),
    g: hexChannel(clean, 2),
    b: hexChannel(clean, 4),
  };
  return `
(function () {
  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('зображення не відкрилось')); };
      img.src = url;
    });
  }

  // Every pixel's brightness, read between the shadow and the tile's own
  // colour. Gamma-lifted a touch (0.85) so mid-tones lean toward the
  // highlight - a duotone read flat and grey without it, on a dark board
  // where flat grey is exactly what everything else already is.
  function duotone(img) {
    var W = img.width, H = img.height;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    var image = ctx.getImageData(0, 0, W, H);
    var px = image.data;
    var sr = ${SHADOW.r}, sg = ${SHADOW.g}, sb = ${SHADOW.b};
    var hr = ${highlight.r}, hg = ${highlight.g}, hb = ${highlight.b};
    for (var i = 0; i < px.length; i += 4) {
      var luminance = (px[i] * 77 + px[i + 1] * 151 + px[i + 2] * 28) / 65536;
      var t = Math.pow(luminance, 0.85);
      px[i] = sr + (hr - sr) * t;
      px[i + 1] = sg + (hg - sg) * t;
      px[i + 2] = sb + (hb - sb) * t;
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  // Read through a blob, not straight off the disk: a canvas that has had
  // a file:// picture drawn into it is TAINTED, and neither its pixels
  // nor its contents can be read back afterward.
  window.__duotone = async function (url) {
    var answer = await fetch(url);
    var bytes = await answer.arrayBuffer();
    var img = await loadImage(URL.createObjectURL(new Blob([bytes])));
    return duotone(img);
  };
})();
`;
}
