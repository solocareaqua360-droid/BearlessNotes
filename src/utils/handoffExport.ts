// A portion for Claude written to disk, with its screenshots beside it - the
// Mac app's. On the phone there is nowhere a Claude session could read it
// from, so it answers null and the portion goes as text alone (the
// attachments named, the pictures sent by hand).
export type HandoffItem = { key: string; name: string; uri: string; driveFileId?: string };

export async function saveHandoffFiles(
  _folder: string,
  _items: HandoffItem[]
): Promise<Record<string, string> | null> {
  return null;
}

export async function saveHandoffText(_folder: string, _name: string, _text: string): Promise<string | null> {
  return null;
}
