// The seam between the macOS application and the user's real browser.
//
// Google refuses OAuth to a browser embedded in an application. Not at
// the first gate - the sign-in form appears and takes an address - but at
// the second, after the address is submitted, where it answers "Не
// вдається ввійти в обліковий запис - можливо, цей веб-переглядач або
// додаток небезпечний". That reads like a warning about the account and
// is a warning about the window it is drawn in. Stripping every trace of
// Electron from the user agent and from the Client Hints headers gets
// past the first gate and not the second, so pretending is not a fix,
// only a longer-lived disguise.
//
// So the application stops pretending and does what Google asks of a
// desktop program: the asking happens in the browser the user already
// has, and only the ANSWER comes back.
//
//   1. The app asks the shell to open the browser at its own address
//      (http://localhost:8899 - the same origin, which is why none of
//      this needs anything added to the Cloud console).
//   2. That tab signs in normally, as the browser version always has,
//      and posts the resulting credential back to the shell.
//   3. The app, which has been polling, picks it up and signs in with it.
//
// After that it is over for good: Firebase keeps its own session on
// disk, so this runs once per installation rather than once per launch.

export type HandoffKind = 'signin' | 'drive';

export type Handoff = {
  kind: HandoffKind;
  // Google's own ID token for the account that signed in. Short-lived,
  // and used at once: Firebase exchanges it for a session of its own.
  idToken?: string | null;
  email?: string | null;
  // A Drive token is a different grant from a different Cloud project -
  // see driveToken.web for why the two cannot be one window.
  driveToken?: { token: string; expiresAt: number } | null;
  error?: string | null;
};

function params(): URLSearchParams {
  try {
    return new URLSearchParams(window.location.search);
  } catch {
    return new URLSearchParams();
  }
}

// Running inside the macOS shell rather than in an ordinary browser tab.
// The shell says so when it loads the page; nothing else sets this.
export function isDesktopShell(): boolean {
  return params().get('desktop') === '1';
}

// This tab IS the browser half of a handoff - opened by the shell, with
// one job, and not the app.
export function handoffRequest(): { kind: HandoffKind; hint: string | null } | null {
  const kind = params().get('handoff');
  if (kind !== 'signin' && kind !== 'drive') return null;
  return { kind, hint: params().get('hint') };
}

// --- the application's half -------------------------------------------

async function shell(path: string, body?: unknown): Promise<Response | null> {
  try {
    return await fetch(`/__desktop/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    return null;
  }
}

// Opens the browser and waits for what comes back. Rejects rather than
// resolving empty, because every caller here has something to say on
// screen and nothing to say about silence.
export async function requestFromBrowser(kind: HandoffKind, hint?: string | null): Promise<Handoff> {
  await shell('handoff/clear', {});
  const opened = await shell('handoff/open', { kind, hint: hint ?? null });
  if (!opened || !opened.ok) {
    throw new Error('Не вдалося відкрити браузер');
  }

  // Three minutes: long enough to find the window, choose an account and
  // type a password, short enough that a forgotten tab does not leave a
  // spinner turning for ever.
  const deadline = Date.now() + 180_000;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 900));
    const response = await shell('handoff/result');
    if (!response || response.status !== 200) continue;
    const handoff = (await response.json()) as Handoff;
    if (handoff.error) throw new Error(handoff.error);
    return handoff;
  }
  throw new Error('Браузер не відповів. Спробуй ще раз.');
}

// --- the browser tab's half -------------------------------------------

export async function reportToShell(handoff: Handoff): Promise<boolean> {
  const response = await shell('handoff/result', handoff);
  return !!response && response.ok;
}
