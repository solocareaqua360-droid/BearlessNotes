import * as DocumentPicker from 'expo-document-picker';
import { collection, doc, getDocs, updateDoc } from '../firestore';
import { db } from '../firebase';
import { addDoc, ownedQuery, setDoc } from './owned';
import { linkDocId } from './linkId';
import { categoryFromSiteName } from './linkCategory';
import type { LinkPreview } from './linkPreview';
import { copyPickedFile } from './localCopy';
import { backupFileToDrive } from './googleDrive';
import { pickPhotosFromDevice } from './photoLibrary';
import { ask } from '../components/surfaces/Ask';
import { openCapture } from '../components/CaptureWindow';
import { requestCreate } from '../navigation/startCreate';
import { requestFolder } from '../navigation/folderArrival';
import { ITEMS_COLLECTION_BY_KIND } from '../hooks/useTags';
import type { CustomDatabase, Tag } from '../types';

// ONE PLACE THAT MAKES A THING (stage 1c of the transition plan, 2026-10-10;
// the «+» fan of a project and its folders calls this). Where it lands:
//   arc 1 + 2 - in the FOLDER being looked at (when there is one) and in its
//               own database; with no folder open, in the project only;
//   arc 3     - only in its own database (a task, a database record, chat).
// A document and a board are made right here; the rest are made by their own
// database exactly as before (its «+» is pressed for it, standing in the
// folder - folderArrival), so nothing about HOW a photo or a file is made
// is written a second time.

export type CreateKind =
  | 'board'
  | 'document'
  | 'card'
  | 'geo'
  | 'link'
  | 'video'
  | 'photo'
  | 'file'
  | 'task'
  | 'record'
  | 'chat';

export type CreateTarget = {
  // The folder the user is standing in (a tag), if any.
  folder?: Tag | null;
  // The project the page belongs to.
  groupId?: string;
  navigation: unknown;
  // Made and left where it was made: nothing is opened afterwards (the
  // projects window asks for this - the user, 2026-10-10: «залишає у вікні проектів»).
  stay?: boolean;
  // A name given at the moment of making (a document, a board).
  title?: string;
  attachTag: (tag: Tag, kind: string, itemId: string, collection: string) => Promise<void>;
};

const FOLDER_KIND: Partial<Record<CreateKind, string>> = {
  card: 'flashcard',
  geo: 'link-geo',
  link: 'link-other',
  video: 'link-video',
  photo: 'photo',
  file: 'file',
};

const LINK_CATEGORY: Partial<Record<CreateKind, string>> = { geo: 'geo', link: 'other', video: 'video' };

// Returns the id of a document / board it made itself (the rest are made by their own screens).
export async function createItem(kind: CreateKind, target: CreateTarget): Promise<string | undefined> {
  const nav = target.navigation as { navigate: (name: string, params?: object) => void };
  const now = Date.now();

  if (kind === 'document') {
    const ref = await addDoc(collection(db, 'documents'), {
      title: target.title?.trim() || 'Без назви',
      createdAt: now,
      updatedAt: now,
      blocks: [],
      ...(target.groupId ? { groupId: target.groupId } : {}),
    });
    if (target.folder) await target.attachTag(target.folder, 'document', ref.id, ITEMS_COLLECTION_BY_KIND.document);
    if (!target.stay) nav.navigate('Editor', { documentId: ref.id, autoFocusTitle: true });
    return ref.id;
  }
  if (kind === 'board') {
    // Born as a keyed map - see BoardsListScreen.createBoard.
    const ref = await addDoc(collection(db, 'boards'), {
      title: target.title?.trim() || 'Без назви',
      cards: {},
      createdAt: now,
      updatedAt: now,
      ...(target.groupId ? { groupId: target.groupId } : {}),
    });
    if (target.folder) await target.attachTag(target.folder, 'board', ref.id, 'boards');
    if (!target.stay) nav.navigate('BoardCopy', { boardId: ref.id });
    return ref.id;
  }
  if (kind === 'chat') {
    openCapture();
    return;
  }
  if (kind === 'task') {
    requestCreate('Tasks', undefined, 'Tasks');
    return;
  }
  if (kind === 'record') {
    const snap = await getDocs(ownedQuery('customDatabases'));
    const databases = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<CustomDatabase, 'id'>) }) as CustomDatabase);
    if (databases.length === 0) return;
    const id = await ask({
      title: 'У яку базу?',
      actions: databases
        .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
        .map((d) => ({ id: d.id, label: d.name || 'Без назви', icon: (d.icon as never) ?? 'grid-outline' })),
    });
    if (!id || id === 'cancel') return;
    requestCreate('CustomDatabase', { databaseId: id }, 'CustomDatabase');
    return;
  }

  // The rest: the database's own «+», standing in the folder.
  const folderKind = FOLDER_KIND[kind];
  if (target.folder && folderKind) requestFolder(folderKind, target.folder.path, 'screen');
  const route =
    kind === 'card' ? 'Flashcards' : kind === 'photo' ? 'Photos' : kind === 'file' ? 'Files' : 'Links';
  const params = LINK_CATEGORY[kind] ? { category: LINK_CATEGORY[kind] } : undefined;
  requestCreate(route, params, route);
}

// A LINK (a page, a video, a geo point) made without leaving the window it was
// asked from: the same record the Links list makes by its «+» (linkDocId, so a
// link pasted into a note later converges on it), put in the folder being
// looked at and in the project of the page. Kept next to LinksScreen's own
// saveNewLink on purpose - when one changes, change the other.
export async function saveLinkInPlace(
  url: string,
  preview: LinkPreview,
  title: string,
  where: { folder?: Tag | null; groupId?: string; attachTag: CreateTarget['attachTag'] }
): Promise<string> {
  const id = linkDocId(url);
  const now = Date.now();
  const data: Record<string, unknown> = { url, updatedAt: now, createdAt: now, usedInDocuments: {} };
  if (title) data.title = title;
  if (preview.imageUrl) data.imageUrl = preview.imageUrl;
  if (preview.siteName) data.siteName = preview.siteName;
  if (preview.geoLat != null && preview.geoLng != null) {
    data.geoLat = preview.geoLat;
    data.geoLng = preview.geoLng;
  }
  if (where.groupId) data.groupId = where.groupId;
  await setDoc(doc(db, 'links', id), data, { merge: true });
  if (where.folder) {
    await where.attachTag(where.folder, `link-${categoryFromSiteName(preview.siteName)}`, id, 'links');
  }
  return id;
}

// PHOTOS from the gallery or the camera, each its own Photos record (the same
// write the Photos list makes), filed in the folder and the project.
export async function addPhotosInPlace(
  source: 'gallery' | 'camera',
  where: { folder?: Tag | null; groupId?: string; attachTag: CreateTarget['attachTag'] }
): Promise<string[]> {
  const added = await pickPhotosFromDevice(source, where.groupId ? { groupId: where.groupId } : {});
  if (where.folder) for (const photo of added) await where.attachTag(where.folder, 'photo', photo.id, 'photos');
  return added.map((p) => p.id);
}

// FILES from the device picker, written as the Files list writes them (copy
// kept, Drive backup in the background), filed in the folder and the project.
export async function addFilesInPlace(where: { folder?: Tag | null; groupId?: string; attachTag: CreateTarget['attachTag'] }): Promise<string[]> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false, multiple: true });
  if (result.canceled || result.assets.length === 0) return [];
  const now = Date.now();
  const made: string[] = [];
  for (const asset of result.assets) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const fileUri = await copyPickedFile(asset.uri, id, asset.name);
    const data: Record<string, unknown> = { fileUri, fileName: asset.name, updatedAt: now, createdAt: now, usedInDocuments: {} };
    if (asset.mimeType) data.mimeType = asset.mimeType;
    if (where.groupId) data.groupId = where.groupId;
    await setDoc(doc(db, 'files', id), data, { merge: true });
    backupFileToDrive(fileUri, asset.name, asset.mimeType ?? 'application/octet-stream', 'Files').then((uploaded) => {
      if (uploaded) updateDoc(doc(db, 'files', id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
    });
    if (where.folder) await where.attachTag(where.folder, 'file', id, 'files');
    made.push(id);
  }
  return made;
}
