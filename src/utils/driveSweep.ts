import { doc, getDocsFromServer, updateDoc } from '../firestore';
import { db } from '../firebase';
import { ownedQuery } from './owned';
import { backupFileToDrive, deviceCopyOf, driveFileExists, listMediaFiles, type DriveMediaFile } from './googleDrive';

// THE DRIVE CHECK (2026-11-02, the user: «накопичується сміття… я боюсь, що ти щось недоробиш»). One rule is meant to
// replace every «Видалити копію з Google Диску?»: a file on the Drive lives while anything in the app points at it, and
// goes once nothing does. Step 1 is only this - it COUNTS, it deletes nothing - so the rule can be seen to be right on
// the user's real data before anything is ever removed by it.
//
// How «points at it» is decided, deliberately blunt: every record of every collection is read FROM THE SERVER (a cache
// could be behind and make a used file look unused) and every long id-like word in it is collected; a Drive file is used
// when its id is among them. No field names - a picture's id under a field added next year still counts.
// Any collection that cannot be read fails the whole check: an incomplete answer is never «unused».

// Every collection a Drive id can stand in. A new collection that can hold a picture or a file goes here.
const COLLECTIONS = [
  'documents',
  'boards',
  'photos',
  'files',
  'links',
  'stickers',
  'thoughts',
  'thoughtThemes',
  'chat',
  'chatBoardCopies',
  'customDatabases',
  'customDatabaseRows',
  'customDatabaseViews',
  'tasks',
  'taskLists',
  'flashcards',
  'groups',
  'tags',
  'shortcuts',
  'settings',
  'linkArticles',
];

// A file this young is never counted as unused: another device may have put it on the Drive and not yet written the
// record that points at it.
export const DRIVE_GRACE_DAYS = 14;

export type DriveCheck = {
  files: number;
  bytes: number;
  used: number;
  young: number;
  unused: DriveMediaFile[];
  unusedBytes: number;
  // Of the unused, how many are boards' old previews (their names begin «preview-»).
  unusedPreviews: number;
  records: number;
  // Records pointing at a Drive file that is gone (deleted for good while something still showed it - the board
  // «клавіатурний блок», 2026-11-02), and of those, the ones this device still has a copy of and can put back.
  missing: MissingFile[];
};

export type MissingFile = {
  oldId: string;
  where: string[];
  localCopy: string | null;
  name: string;
  mimeType: string;
  folder: 'Photos' | 'Files';
};

type RecordRow = { collection: string; id: string; data: Record<string, unknown> };

// Every record of every collection, from the server. Any one that cannot be read stops everything.
async function readAllRecords(): Promise<RecordRow[]> {
  const rows: RecordRow[] = [];
  for (const name of COLLECTIONS) {
    let snapshot;
    try {
      snapshot = await getDocsFromServer(ownedQuery(name));
    } catch (e) {
      throw new Error(`Не вдалося прочитати «${name}» з сервера, перевірку зупинено: ${e instanceof Error ? e.message : String(e)}`);
    }
    snapshot.forEach((d) => {
      rows.push({ collection: name, id: d.id, data: (d.data() ?? {}) as Record<string, unknown> });
    });
  }
  return rows;
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype;

// Every «…DriveFileId» in a record with the picture or file it stands for. A board's preview is left out: it is drawn
// again by itself.
function driveRefs(data: unknown, out: { id: string; uri?: string; name: string; mimeType: string; folder: 'Photos' | 'Files' }[]) {
  if (Array.isArray(data)) {
    data.forEach((v) => driveRefs(v, out));
    return;
  }
  if (!isPlain(data)) return;
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string' && /driveFileId$/i.test(key) && key !== 'previewDriveFileId') {
      const prefix = key.slice(0, key.length - 'DriveFileId'.length);
      const uri = (prefix ? data[`${prefix}ImageUri`] : data.imageUri ?? data.fileUri ?? data.uri) as string | undefined;
      const isFile = !prefix && typeof data.fileUri === 'string' && !data.imageUri;
      out.push({
        id: value,
        uri,
        name: (isFile && typeof data.fileName === 'string' ? data.fileName : `${(data.id as string) || value}.jpg`) as string,
        mimeType: (isFile && typeof data.mimeType === 'string' ? data.mimeType : 'image/jpeg') as string,
        folder: isFile ? 'Files' : 'Photos',
      });
    } else driveRefs(value, out);
  }
}

// The same record with one Drive id put in place of another, wherever it stands; anything that is not a plain value,
// array or object (a Timestamp) is left exactly as it is.
function swapId(value: unknown, from: string, to: string): unknown {
  if (typeof value === 'string') return value.includes(from) ? value.split(from).join(to) : value;
  if (Array.isArray(value)) return value.map((v) => swapId(v, from, to));
  if (isPlain(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, swapId(v, from, to)]));
  return value;
}

function collectWords(text: string, into: Set<string>) {
  for (const m of text.matchAll(/[A-Za-z0-9_-]{20,}/g)) into.add(m[0]);
}

export async function checkDrive(): Promise<DriveCheck> {
  const files = await listMediaFiles();
  const rows = await readAllRecords();
  const words = new Set<string>();
  rows.forEach((r) => collectWords(JSON.stringify(r.data), words));
  const records = rows.length;
  // What records point at that is not among the app's files: asked of the Drive one by one (it may live elsewhere).
  const onDrive = new Set(files.map((f) => f.id));
  const missingById = new Map<string, MissingFile>();
  for (const r of rows) {
    const refs: Parameters<typeof driveRefs>[1] = [];
    driveRefs(r.data, refs);
    for (const ref of refs) {
      if (onDrive.has(ref.id)) continue;
      const known = missingById.get(ref.id);
      if (known) {
        known.where.push(`${r.collection}/${r.id}`);
        if (!known.localCopy && ref.uri) known.localCopy = await deviceCopyOf(ref.uri, ref.id);
        continue;
      }
      if (await driveFileExists(ref.id)) {
        onDrive.add(ref.id);
        continue;
      }
      missingById.set(ref.id, {
        oldId: ref.id,
        where: [`${r.collection}/${r.id}`],
        localCopy: await deviceCopyOf(ref.uri, ref.id),
        name: ref.name,
        mimeType: ref.mimeType,
        folder: ref.folder,
      });
    }
  }
  const youngAfter = Date.now() - DRIVE_GRACE_DAYS * 86_400_000;
  let used = 0;
  let young = 0;
  const unused: DriveMediaFile[] = [];
  for (const f of files) {
    if (words.has(f.id)) used += 1;
    else if (f.createdAt > youngAfter) young += 1;
    else unused.push(f);
  }
  return {
    files: files.length,
    bytes: files.reduce((n, f) => n + f.bytes, 0),
    used,
    young,
    unused,
    unusedBytes: unused.reduce((n, f) => n + f.bytes, 0),
    unusedPreviews: unused.filter((f) => f.name.startsWith('preview-')).length,
    records,
    missing: [...missingById.values()],
  };
}

// PUTTING BACK what is gone from the Drive but still on this device: uploaded again, and every record that pointed at
// the old id now points at the new one (the photo's record and the board card share ONE copy, as before). Records are
// read again first, so nothing written since the check is overwritten with an older version.
export async function restoreMissing(missing: MissingFile[]): Promise<{ restored: number; failed: number }> {
  const here = missing.filter((m) => m.localCopy);
  if (here.length === 0) return { restored: 0, failed: 0 };
  const rows = await readAllRecords();
  let restored = 0;
  let failed = 0;
  for (const m of here) {
    const uploaded = await backupFileToDrive(m.localCopy!, m.name, m.mimeType, m.folder).catch(() => null);
    if (!uploaded) {
      failed += 1;
      continue;
    }
    for (const r of rows) {
      if (!JSON.stringify(r.data).includes(m.oldId)) continue;
      const changes: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(r.data)) {
        const next = swapId(value, m.oldId, uploaded.fileId);
        if (JSON.stringify(next) !== JSON.stringify(value)) changes[key] = next;
      }
      if (Object.keys(changes).length === 0) continue;
      await updateDoc(doc(db, r.collection, r.id), changes);
      r.data = { ...r.data, ...changes };
    }
    restored += 1;
  }
  return { restored, failed };
}
