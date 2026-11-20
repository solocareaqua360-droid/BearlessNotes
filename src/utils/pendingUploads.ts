// Bytes waiting for their Drive copy - a BROWSER concern only (see
// pendingUploads.web.ts). On a phone a picked file already lives on disk
// under a file:// path that survives a restart, and backfillDrive is its
// retry, so there is nothing to keep here.
export type PendingUpload = { uri: string; fileName: string; mimeType: string; subFolder: 'Photos' | 'Files' };

export async function keepPending(_entry: PendingUpload, _blob: Blob): Promise<void> {}

export async function readPending(_uri: string): Promise<Blob | null> {
  return null;
}

export async function dropPending(_uri: string): Promise<void> {}

export async function listPending(): Promise<PendingUpload[]> {
  return [];
}
