import { getDocs } from '../firestore';
import { ownedQuery } from './owned';
import { isDesktopShell, keepAttachment } from './desktopBridge.web';
import { getDriveToken, hasDriveToken, subscribeToDriveToken } from './driveToken.web';

// Fetching everything BEFORE it is wanted, so "works offline" is true of
// the whole library and not just of what happens to have been opened.
//
// The disk cache on its own (desktopBridge.web) fixes the second look at
// a picture and not the first: a note opened on the train for the first
// time still has an empty frame in it. For a second brain that is the
// case that matters - the moment you need something you did not plan to
// need. So once, after signing in, this walks every attachment the
// account owns and quietly pulls down whatever this machine has not got.
//
// Deliberately unhurried and deliberately quiet:
//  - one file at a time, with a pause between, because this is competing
//    with the app the user is actually using;
//  - it never asks for a Drive token, only uses one already held. A
//    background job must not be what makes the "Підключити Диск" bar
//    appear - that bar is for things the user asked for and did not get;
//  - it stops the moment the token runs out and picks up where it left
//    off the next time one appears.
//
// Only inside the macOS shell. A browser tab has nowhere to put any of
// this, so there it does nothing at all.

const PAUSE_BETWEEN_MS = 250;

export type PrefetchState = { done: number; total: number; running: boolean };

let state: PrefetchState = { done: 0, total: 0, running: false };
const listeners = new Set<() => void>();
let started = false;

export function subscribeToPrefetch(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function prefetchState(): PrefetchState {
  return state;
}

function setState(next: Partial<PrefetchState>) {
  state = { ...state, ...next };
  listeners.forEach((l) => l());
}

// Every Drive copy this account owns, from the four places that hold
// one. Photos and files keep theirs on the record; a board keeps its
// cards' inside the board document; a note keeps its cover's on itself,
// and may also carry ids on blocks that point at another note's picture.
async function everyDriveFileId(): Promise<string[]> {
  const [photos, files, boards, documents] = await Promise.all([
    getDocs(ownedQuery('photos')),
    getDocs(ownedQuery('files')),
    getDocs(ownedQuery('boards')),
    getDocs(ownedQuery('documents')),
  ]);

  const ids = new Set<string>();
  const add = (value: unknown) => {
    if (typeof value === 'string' && value) ids.add(value);
  };

  photos.docs.forEach((d) => add(d.data().driveFileId));
  files.docs.forEach((d) => add(d.data().driveFileId));
  boards.docs.forEach((d) => {
    const cards = d.data().cards;
    const list = Array.isArray(cards) ? cards : Object.values(cards ?? {});
    list.forEach((card) => add((card as { driveFileId?: string })?.driveFileId));
  });
  documents.docs.forEach((d) => {
    const data = d.data();
    add(data.coverDriveFileId);
    ((data.blocks as { driveFileId?: string }[] | undefined) ?? []).forEach((b) => add(b?.driveFileId));
  });

  return Array.from(ids);
}

async function notKeptYet(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const response = await fetch('/__desktop/cache/missing', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids }),
  });
  if (!response.ok) return [];
  const json = (await response.json()) as { missing?: string[] };
  return json.missing ?? [];
}

async function run(): Promise<void> {
  if (state.running) return;
  setState({ running: true, done: 0, total: 0 });
  try {
    const missing = await notKeptYet(await everyDriveFileId());
    setState({ total: missing.length });
    if (missing.length === 0) return;

    let done = 0;
    for (const id of missing) {
      const token = await getDriveToken(false);
      // Out of token: stop rather than ask. Whatever is left is picked up
      // the next time one appears - see the subscription below.
      if (!token) break;
      try {
        const response = await fetch(`https://www.googleapis.com/drive/v3/files/${id}?alt=media`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        // A file that is gone from Drive is counted and skipped; there is
        // nothing to retry and nothing to tell the user, because nothing
        // on screen is missing yet.
        if (response.ok) await keepAttachment(id, await response.blob());
      } catch {
        /* the next launch will try it again */
      }
      done += 1;
      setState({ done });
      await new Promise((resolve) => setTimeout(resolve, PAUSE_BETWEEN_MS));
    }
  } catch {
    /* a refused read or a missing shell - either way, next launch */
  } finally {
    setState({ running: false });
  }
}

// Called once the app knows who is signed in. Runs now if there is a
// token, and again whenever one arrives - which is what makes the very
// first connect fill the folder without anyone asking twice.
export function startOfflinePrefetch(): () => void {
  if (!isDesktopShell() || started) return () => {};
  started = true;
  if (hasDriveToken()) void run();
  return subscribeToDriveToken(() => {
    if (hasDriveToken() && !state.running) void run();
  });
}
