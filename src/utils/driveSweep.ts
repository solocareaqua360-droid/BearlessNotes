import { getDocsFromServer } from '../firestore';
import { ownedQuery } from './owned';
import { listMediaFiles, type DriveMediaFile } from './googleDrive';

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
  records: number;
};

function collectWords(text: string, into: Set<string>) {
  for (const m of text.matchAll(/[A-Za-z0-9_-]{20,}/g)) into.add(m[0]);
}

export async function checkDrive(): Promise<DriveCheck> {
  const files = await listMediaFiles();
  const words = new Set<string>();
  let records = 0;
  for (const name of COLLECTIONS) {
    let snapshot;
    try {
      snapshot = await getDocsFromServer(ownedQuery(name));
    } catch (e) {
      throw new Error(`Не вдалося прочитати «${name}» з сервера, перевірку зупинено: ${e instanceof Error ? e.message : String(e)}`);
    }
    snapshot.forEach((d) => {
      records += 1;
      collectWords(JSON.stringify(d.data()), words);
    });
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
    records,
  };
}
