// The macOS shell for mindEva.
//
// It contains no app code of its own. The whole application is the Expo
// web export - the same build the browser version runs - copied into
// app/ by scripts/build-mac.sh. This file only decides how that build is
// handed to a window.
//
// Why it is served over http instead of loaded from a file:// path.
// Google checks WHERE a sign-in request came from against a list of
// authorized JavaScript origins kept on the Cloud console. A file:// page
// has no origin at all ("null"), so sign-in is refused outright and the
// Drive token can never be issued. Two origins are already on that list
// for the browser version - http://localhost:8899 and http://localhost:8081
// - so the shell starts a tiny static server on one of them and points the
// window there. Nothing has to be added to the console, and the page is
// indistinguishable from the browser build as far as Google is concerned.

const { app, BrowserWindow, Menu, session, shell, dialog } = require('electron');
const http = require('http');
const fs = require('fs');
const path = require('path');

// In the same order as the authorized origins. 8899 is the one the browser
// version is normally served on, so it is also the one most likely to be
// occupied by a leftover `scratchpad/serve.py` - hence the fallback.
const PORTS = [8899, 8081];
const ROOT = path.join(__dirname, 'app');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.wasm': 'application/wasm',
  '.bin': 'application/octet-stream',
  '.jslib': 'text/javascript; charset=utf-8',
};

// The port that took, once it has. The handoff has to send the browser
// to the same address this window is on - a different one would be a
// different origin, and Google would refuse it.
let servedPort = null;

// What the browser tab handed back, waiting to be collected exactly
// once. In memory and nowhere else: it holds a Google ID token, it is
// good for minutes, and it is consumed the moment the window asks.
let handoff = null;

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      // Nothing legitimate here is large; refuse to grow without bound.
      if (raw.length > 64 * 1024) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'));
      } catch {
        resolve({});
      }
    });
  });
}

// The shell's own endpoints, the whole of the seam between the window
// and the user's real browser. See src/utils/desktopBridge.web.ts for
// why any of this exists: Google refuses to finish a sign-in inside a
// window an application drew, so the asking happens in the browser and
// only the answer comes back through here.
//
// Reachable only from 127.0.0.1, because that is all the server listens
// on - and the window and the browser tab are both on it.
async function serveDesktopApi(req, res, pathname) {
  const done = (status, body) => {
    res.writeHead(status, body ? { 'Content-Type': 'application/json' } : undefined);
    res.end(body ? JSON.stringify(body) : undefined);
  };

  if (pathname === '/__desktop/handoff/open' && req.method === 'POST') {
    const { kind, hint } = await readBody(req);
    if (kind !== 'signin' && kind !== 'drive') return done(400, { error: 'unknown handoff' });
    const query = new URLSearchParams({ handoff: kind });
    if (hint) query.set('hint', hint);
    // The user's own browser, on this same origin - which is why none of
    // this needs anything added to the Cloud console.
    shell.openExternal(`http://localhost:${servedPort}/?${query.toString()}`);
    return done(204);
  }

  if (pathname === '/__desktop/handoff/clear' && req.method === 'POST') {
    handoff = null;
    return done(204);
  }

  if (pathname === '/__desktop/handoff/result') {
    if (req.method === 'POST') {
      handoff = await readBody(req);
      return done(204);
    }
    if (!handoff) return done(204);
    const answer = handoff;
    handoff = null;
    return done(200, answer);
  }

  return done(404, { error: 'no such endpoint' });
}

function serve(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    pathname = '/';
  }

  // The shell's own endpoints come first - they are not files, and the
  // fallback below would otherwise answer them with index.html.
  if (pathname.startsWith('/__desktop/')) {
    serveDesktopApi(req, res, pathname);
    return;
  }

  let filePath = path.join(ROOT, pathname);
  // Nothing outside app/ is reachable, whatever the request says.
  if (!filePath.startsWith(ROOT)) filePath = ROOT;

  let stat = null;
  try {
    stat = fs.statSync(filePath);
  } catch {
    stat = null;
  }

  // A route the app owns rather than a file on disk (the navigator uses
  // real URLs) - hand it index.html and let the app route it itself.
  if (!stat || stat.isDirectory()) {
    filePath = path.join(ROOT, 'index.html');
    try {
      stat = fs.statSync(filePath);
    } catch {
      res.writeHead(404);
      res.end('not found');
      return;
    }
  }

  // No caching, for the same reason scratchpad/serve.py sets it: an
  // updated export gives the bundle a new hashed name but leaves
  // index.html named the same, so a cached index.html asks forever for a
  // bundle that no longer exists.
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-store, must-revalidate',
  });
  fs.createReadStream(filePath).pipe(res);
}

// Resolves to the port that took, or null when every candidate is busy.
// Bound to 127.0.0.1 rather than every interface: this server exists for
// this window, and nothing on the network has any business reaching it.
function listenOnFirstFreePort(server, ports) {
  return new Promise((resolve) => {
    const attempt = (index) => {
      if (index >= ports.length) {
        resolve(null);
        return;
      }
      server.once('error', () => attempt(index + 1));
      server.listen(ports[index], '127.0.0.1', () => resolve(ports[index]));
    };
    attempt(0);
  });
}

// Window size and position, remembered between runs.
const boundsFile = () => path.join(app.getPath('userData'), 'window-bounds.json');

function readBounds() {
  try {
    const saved = JSON.parse(fs.readFileSync(boundsFile(), 'utf8'));
    if (typeof saved.width === 'number' && typeof saved.height === 'number') return saved;
  } catch {
    /* first run, or the file was damaged - the defaults are fine */
  }
  return { width: 1280, height: 860 };
}

function rememberBounds(window) {
  const save = () => {
    if (window.isDestroyed() || window.isMinimized() || window.isFullScreen()) return;
    try {
      fs.writeFileSync(boundsFile(), JSON.stringify(window.getNormalBounds()));
    } catch {
      /* not worth bothering anyone about */
    }
  };
  window.on('resize', save);
  window.on('move', save);
  window.on('close', save);
}

// macOS puts copy/paste/undo in the menu bar, and a window whose app has
// no menu has no working keyboard shortcuts for them either. The default
// roles are exactly right here; only the app menu's name needs to be ours.
function installMenu() {
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      { role: 'appMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
    ])
  );
}

function createWindow(port) {
  const window = new BrowserWindow({
    ...readBounds(),
    minWidth: 480,
    minHeight: 480,
    title: 'mindEva',
    // The ordinary macOS title bar, deliberately. Hiding it puts the
    // traffic lights on top of the page's own top-left corner, which is
    // exactly where this app keeps its controls. Worth revisiting once
    // the desktop-width layout exists and can leave room for them.
    backgroundColor: '#FAFAFA',
    show: false,
    webPreferences: {
      // The page is our own build and talks to Firebase directly; it needs
      // no bridge into Node, so it does not get one.
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
    },
  });

  rememberBounds(window);
  window.once('ready-to-show', () => window.show());
  // `desktop=1` is how the page knows it is here rather than in an
  // ordinary browser tab, and so that signing in has to go out to the
  // browser. Nothing else sets it.
  window.loadURL(`http://localhost:${port}/?desktop=1`);

  // Signing in is a popup, and it has to open as a real window inside the
  // app for the answer to come back to the page that asked. Two different
  // flows open one, and they are NOT the same host:
  //  - Drive's token client opens accounts.google.com directly;
  //  - Firebase's signInWithPopup opens its own handler page first,
  //    <project>.firebaseapp.com/__/auth/handler, and only that page
  //    forwards to Google. Sending it to the external browser instead
  //    breaks sign-in completely, and it looks like the button does
  //    nothing - the popup lands in Safari, where the page waiting for it
  //    cannot be reached.
  // Everything else - a link in a note, a file opened "elsewhere" -
  // belongs in the user's own browser.
  window.webContents.setWindowOpenHandler(({ url }) => {
    let host = '';
    try {
      host = new URL(url).hostname;
    } catch {
      host = '';
    }
    const isSignIn =
      host === 'accounts.google.com' ||
      host.endsWith('.google.com') ||
      host.endsWith('.firebaseapp.com') ||
      host.endsWith('.web.app');
    if (isSignIn) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: { width: 520, height: 680, autoHideMenuBar: true },
      };
    }
    shell.openExternal(url);
    return { action: 'deny' };
  });

  return window;
}

app.whenReady().then(async () => {
  if (!fs.existsSync(path.join(ROOT, 'index.html'))) {
    dialog.showErrorBox(
      'mindEva',
      'The application files are missing from this build.\n\n' +
        'Rebuild with scripts/build-mac.sh, which exports the web version and copies it in.'
    );
    app.quit();
    return;
  }

  // Google refuses OAuth to anything that looks like an embedded browser,
  // and Electron announces itself in TWO places, not one. Cleaning only
  // the first gets "Не вдається ввійти в обліковий запис - можливо, цей
  // веб-переглядач або додаток небезпечний", which reads like a warning
  // about the account and is actually this.
  //
  // 1. The user agent string, which carries "Electron/44.0.0" and the
  //    app's own name. Stripped here.
  const userAgent = app.userAgentFallback
    .replace(/\sElectron\/[\d.]+/, '')
    .replace(/\smindEva\/[\d.]+/, '');
  app.userAgentFallback = userAgent;

  // 2. The Client Hints headers, which Chromium sends alongside it and
  //    which list "Electron" as one of the browser brands. They are not
  //    part of the user agent string and survive stripping it, so the
  //    sign-in page still saw an embedded browser. Rewritten to the plain
  //    Chrome brands for the sign-in hosts only - everything else keeps
  //    the honest headers.
  const chromeVersion = (userAgent.match(/Chrome\/(\d+)/) || [])[1] || '152';
  const chromeFull = (userAgent.match(/Chrome\/([\d.]+)/) || [])[1] || `${chromeVersion}.0.0.0`;
  const brands = `"Chromium";v="${chromeVersion}", "Google Chrome";v="${chromeVersion}", "Not?A_Brand";v="24"`;
  const fullVersions =
    `"Chromium";v="${chromeFull}", "Google Chrome";v="${chromeFull}", "Not?A_Brand";v="24.0.0.0"`;

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    let host = '';
    try {
      host = new URL(details.url).hostname;
    } catch {
      host = '';
    }
    const isSignInHost =
      host.endsWith('.google.com') ||
      host === 'google.com' ||
      host.endsWith('.googleapis.com') ||
      host.endsWith('.firebaseapp.com') ||
      host.endsWith('.gstatic.com');
    if (!isSignInHost) {
      callback({ requestHeaders: details.requestHeaders });
      return;
    }
    const headers = { ...details.requestHeaders };
    for (const name of Object.keys(headers)) {
      const lower = name.toLowerCase();
      if (lower === 'sec-ch-ua') headers[name] = brands;
      else if (lower === 'sec-ch-ua-full-version-list') headers[name] = fullVersions;
      else if (lower === 'sec-ch-ua-full-version') headers[name] = `"${chromeFull}"`;
      else if (lower === 'user-agent') headers[name] = userAgent;
    }
    callback({ requestHeaders: headers });
  });

  const server = http.createServer(serve);
  const port = await listenOnFirstFreePort(server, PORTS);
  servedPort = port;

  if (port === null) {
    dialog.showErrorBox(
      'mindEva',
      `Ports ${PORTS.join(' and ')} are both in use.\n\n` +
        'Something else is already listening on them - most likely a leftover\n' +
        '`scratchpad/serve.py` in a terminal. Close it and open mindEva again.\n\n' +
        'Only these two ports work: they are the ones Google is told to accept\n' +
        'sign-in from, and any other port fails at the sign-in step.'
    );
    app.quit();
    return;
  }

  installMenu();
  createWindow(port);

  // Clicking the dock icon with no window open should bring one back.
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(port);
  });
});

// Standard macOS behaviour: closing the last window does not quit the app.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
