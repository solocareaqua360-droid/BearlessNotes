import AsyncStorage from '@react-native-async-storage/async-storage';

// What a file looks like on its card, worked out once and kept.
//
// Deliberately local: every device draws its own, because a thumbnail in
// the record would be a few kilobytes added to every read of the list, on
// every device, forever - to save each one a job it does once in ~200ms.
//
// The work itself happens in FilePreviewWorker (a single hidden WebView);
// this module is only the queue, the cache and who to tell when one is
// ready.

export type FilePreview = {
  // The first lines of a Word file, or the first cells of a sheet.
  text?: string;
  // A picture of a PDF's first page, as a file in the cache.
  thumbUri?: string;
  // Set when it cannot be made, so nothing tries it again in a loop.
  failed?: boolean;
};

export type PreviewJob = {
  id: string;
  uri: string;
  kind: 'docx' | 'xlsx' | 'pdf';
};

// Bumped when what a preview CONTAINS changes - v1 had no picture for
// a Word or Excel file, and there is no telling that apart from
// "not made yet" without this.
const STORAGE_KEY = 'filePreviews.v2';

let cache: Record<string, FilePreview> | null = null;
let loading: Promise<void> | null = null;
const queue: PreviewJob[] = [];
const queued = new Set<string>();
const listeners = new Set<() => void>();
let saveTimer: ReturnType<typeof setTimeout> | null = null;

function notify() {
  listeners.forEach((listener) => listener());
}

export function subscribeToPreviews(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function ensureLoaded(): Promise<void> {
  if (cache) return;
  if (!loading) {
    loading = (async () => {
      try {
        const raw = await AsyncStorage.getItem(STORAGE_KEY);
        cache = raw ? (JSON.parse(raw) as Record<string, FilePreview>) : {};
      } catch {
        cache = {};
      }
      notify();
    })();
  }
  await loading;
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = null;
    if (cache) AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(cache)).catch(() => {});
  }, 1500);
}

export function previewFor(id: string): FilePreview | undefined {
  return cache?.[id];
}

// Asks for one, unless it is already known or already waiting. Returns
// nothing: the card reads the cache and is told when it changes.
export function requestPreview(job: PreviewJob) {
  ensureLoaded().then(() => {
    if (cache?.[job.id] || queued.has(job.id)) return;
    queued.add(job.id);
    queue.push(job);
    notify();
  });
}

export function nextPreviewJob(): PreviewJob | null {
  return queue[0] ?? null;
}

export function finishPreviewJob(id: string, preview: FilePreview) {
  const index = queue.findIndex((job) => job.id === id);
  if (index >= 0) queue.splice(index, 1);
  queued.delete(id);
  ensureLoaded().then(() => {
    if (!cache) return;
    cache[id] = preview;
    scheduleSave();
    notify();
  });
}
