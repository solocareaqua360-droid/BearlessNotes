// BYTES WAITING FOR THEIR DRIVE COPY, kept in the browser's own storage.
//
// A photo or file picked in a browser is a blob: URL - alive only in the
// tab that made it. Its Drive copy is what every other device (and this
// one, after a reload) reads, and that copy needs a Drive token, which
// the browser gets only after a "Підключити Диск" click each hour. When
// the upload could not run, the blob: URL was all there was, and a reload
// took it: a black square here, "Недоступно на цьому пристрої" on the
// phone (2026-09-29). So the bytes are kept here from the moment they are
// read until the upload succeeds, keyed by that blob: URL - the value the
// document and the record hold - and the upload is tried again as soon
// as a token arrives (see googleDrive.web's flush).
import type { PendingUpload } from './pendingUploads';

export type { PendingUpload } from './pendingUploads';

const DB_NAME = 'mindeva-pending-uploads';
const STORE = 'pending';

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE, { keyPath: 'uri' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE, mode);
    const request = work(tx.objectStore(STORE));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

type Row = PendingUpload & { blob: Blob };

export async function keepPending(entry: PendingUpload, blob: Blob): Promise<void> {
  try {
    await run('readwrite', (store) => store.put({ ...entry, blob } as Row));
  } catch (e) {
    console.warn('[pendingUploads] could not keep', entry.fileName, e);
  }
}

export async function readPending(uri: string): Promise<Blob | null> {
  try {
    const row = (await run('readonly', (store) => store.get(uri))) as Row | undefined;
    return row?.blob ?? null;
  } catch {
    return null;
  }
}

export async function dropPending(uri: string): Promise<void> {
  try {
    await run('readwrite', (store) => store.delete(uri));
  } catch {
    // Left behind, it is retried and dropped next time - harmless.
  }
}

export async function listPending(): Promise<PendingUpload[]> {
  try {
    const rows = (await run('readonly', (store) => store.getAll())) as Row[];
    return rows.map(({ uri, fileName, mimeType, subFolder }) => ({ uri, fileName, mimeType, subFolder }));
  } catch {
    return [];
  }
}
