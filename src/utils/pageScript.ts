// The two pieces of JavaScript that every hidden page in the app is
// built from - written once here, because the recogniser and the page
// cleaner must prepare a picture in exactly the same way, and a fix
// found in one of them has to reach the other.
//
// NOT ONE BACKSLASH in either of these: they are template literals, and
// a backslash in one arrives in the page eaten - the regular expression
// that became a comment cost a whole afternoon.

// Both the page and the worker are given this, because both of them fetch
// something: the page fetches the photograph, the worker fetches the
// language model. Android's WebView cannot fetch() a file:// URL at all -
// not "returns an error", it refuses the scheme outright, which is what
// arrived as a bare "TypeError: Failed to fetch" with nothing to point at.
// XMLHttpRequest, in the same page, reads those files perfectly well
// (that is what allowFileAccessFromFileURLs is for), so fetch is taught
// to fall back to it and to hand back the small part of a Response that
// Tesseract actually uses.
//
// The other half: a blob URL with a file name stuck on the end is trimmed
// back to the blob. Tesseract builds the model's address itself, always
// as folder + "/ukr.traineddata", so handing it the model already in
// memory means handing it something that will have a name appended.
//
// Deliberately without a single backslash: this text is also written from
// a template literal, and a regular expression here would arrive in the
// page with its backslash eaten - the exact failure of the previous
// round.
export const FETCH_SHIM = `
(function () {
  var native = self.fetch;
  self.fetch = function (input, init) {
    var url = typeof input === 'string' ? input : (input && input.url) || '';
    if (url.indexOf('blob:') === 0 && url.indexOf('.traineddata') > 0) {
      return native.call(self, url.slice(0, url.lastIndexOf('/')), init);
    }
    if (url.indexOf('file://') !== 0) return native.apply(self, arguments);
    return new Promise(function (resolve, reject) {
      try {
        var xhr = new XMLHttpRequest();
        xhr.open('GET', url, true);
        xhr.responseType = 'arraybuffer';
        xhr.onload = function () {
          if (xhr.response && xhr.response.byteLength) {
            resolve({
              ok: true,
              status: 200,
              arrayBuffer: function () { return Promise.resolve(xhr.response); },
            });
          } else {
            reject(new TypeError('порожній файл: ' + url));
          }
        };
        xhr.onerror = function () { reject(new TypeError('файл недоступний: ' + url)); };
        xhr.send();
      } catch (e) {
        reject(new TypeError('файл заборонено: ' + url));
      }
    });
  };
})();
`;

// loadImage / curve / flatten / preparedPage(url, color): reads a picture
// through a blob (a file:// picture drawn into a canvas taints it), takes
// the light out of the paper, pulls the levels apart, and hands back a
// canvas - grey for reading, in colour for keeping.
export const FLATTEN_SCRIPT = `
  // Taking the light out of the paper, which is the difference between a
  // photograph of a book and a scan of one.
  //
  // Tesseract decides "ink or paper" with ONE threshold for the whole
  // page. On a photograph with a shadow across it that threshold cannot
  // be right everywhere: the lit half reads, and the half in shade comes
  // apart - "Ринсвінд" arriving as "гвінд", "заражав" as "ав", always at
  // the start of the line, always where the shadow lay.
  //
  // So the page is divided by its own illumination first. The lightest
  // thing in any small block of a page of text IS the paper, whatever the
  // light is doing there; dividing each pixel by that leaves ink dark and
  // paper white from corner to corner.
  function loadImage(url) {
    return new Promise(function (resolve, reject) {
      var img = new Image();
      img.onload = function () { resolve(img); };
      img.onerror = function () { reject(new Error('зображення не відкрилось')); };
      img.src = url;
    });
  }

  // The levels pulled apart: anything nearly white IS white, and the
  // darkest ink is black. What this removes is the grey speckle the
  // document scanner's own filter sprinkles over clean paper - it
  // survives the flattening as a faint grey, and this is where it goes.
  // The middle stays a ramp, so the soft edges of the letters are kept.
  function curve(v) {
    v = (v - 60) * 255 / 145;
    return v > 255 ? 255 : v < 0 ? 0 : v;
  }

  function flatten(img, color) {
    var W = img.width, H = img.height;
    var canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    var ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    var B = 32;
    var gw = Math.ceil(W / B), gh = Math.ceil(H / B);
    // Too small to have an interesting shadow; leave it alone.
    if (gw < 3 || gh < 3) return canvas;
    var image = ctx.getImageData(0, 0, W, H);
    var px = image.data;
    var gray = new Uint8Array(W * H);
    for (var i = 0, p = 0; p < gray.length; i += 4, p++) {
      gray[p] = (px[i] * 77 + px[i + 1] * 151 + px[i + 2] * 28) >> 8;
    }
    // The paper, block by block.
    var back = new Uint8Array(gw * gh);
    for (var by = 0; by < gh; by++) {
      var yTo = Math.min(H, (by + 1) * B);
      for (var bx = 0; bx < gw; bx++) {
        var xTo = Math.min(W, (bx + 1) * B);
        var best = 0;
        for (var y = by * B; y < yTo; y++) {
          var row = y * W;
          for (var x = bx * B; x < xTo; x++) {
            var v = gray[row + x];
            if (v > best) best = v;
          }
        }
        back[by * gw + bx] = best;
      }
    }
    // Smoothed, so the blocks themselves do not print through.
    var soft = new Uint8Array(gw * gh);
    for (var sy = 0; sy < gh; sy++) {
      for (var sx = 0; sx < gw; sx++) {
        var sum = 0, n = 0;
        for (var dy = -1; dy <= 1; dy++) {
          for (var dx = -1; dx <= 1; dx++) {
            var yy = sy + dy, xx = sx + dx;
            if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
            sum += back[yy * gw + xx]; n++;
          }
        }
        soft[sy * gw + sx] = Math.round(sum / n);
      }
    }
    // Every pixel divided by the light that fell on it.
    for (var ny = 0; ny < H; ny++) {
      var gy = ny / B - 0.5;
      var iy = Math.floor(gy); var fy = gy - iy;
      if (iy < 0) { iy = 0; fy = 0; }
      if (iy > gh - 2) { iy = gh - 2; fy = 1; }
      for (var nx = 0; nx < W; nx++) {
        var gx = nx / B - 0.5;
        var ix = Math.floor(gx); var fx = gx - ix;
        if (ix < 0) { ix = 0; fx = 0; }
        if (ix > gw - 2) { ix = gw - 2; fx = 1; }
        var top = soft[iy * gw + ix] * (1 - fx) + soft[iy * gw + ix + 1] * fx;
        var bottom = soft[(iy + 1) * gw + ix] * (1 - fx) + soft[(iy + 1) * gw + ix + 1] * fx;
        var light = top * (1 - fy) + bottom * fy;
        if (light < 1) light = 1;
        var gain = 255 / light;
        var at = (ny * W + nx) * 4;
        if (color) {
          // A stored page keeps its colour: every channel lifted by the
          // same amount, so paper goes white and red ink stays red.
          px[at] = curve(px[at] * gain);
          px[at + 1] = curve(px[at + 1] * gain);
          px[at + 2] = curve(px[at + 2] * gain);
        } else {
          var out = curve(gray[ny * W + nx] * gain);
          px[at] = out; px[at + 1] = out; px[at + 2] = out;
        }
        px[at + 3] = 255;
      }
    }
    ctx.putImageData(image, 0, 0);
    return canvas;
  }

  // Read through a blob, not straight off the disk: a canvas that has had
  // a file:// picture drawn into it is TAINTED, and then neither its
  // pixels nor its contents can be read back at all.
  async function preparedPage(url, color) {
    var answer = await fetch(url);
    var bytes = await answer.arrayBuffer();
    var img = await loadImage(URL.createObjectURL(new Blob([bytes], { type: 'image/jpeg' })));
    try {
      return flatten(img, color);
    } catch (e) {
      // Better a photograph read badly than nothing read at all.
      return img;
    }
  }
`;
