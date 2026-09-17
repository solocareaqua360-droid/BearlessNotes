import * as ImagePicker from 'expo-image-picker';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { doc, updateDoc } from '../firestore';
import { setDoc } from './owned';
import { db } from '../firebase';
import { backupFileToDrive } from './googleDrive';
import { fetchLinkPreview } from './linkPreview';
import { linkDocId } from './linkId';

// What a chat message can carry besides its words. Whatever is attached
// becomes a record in its OWN database at the same moment - the user's
// own requirement: "все, що типу фотографії, посилання - це все одразу
// буде попадати в базу даних". The message keeps only a pointer, so the
// picture in the chat and the picture in «Зображення» are one picture.
export type ChatAttachment =
  | { kind: 'photo'; id: string; uri: string }
  | { kind: 'file'; id: string; uri: string; name: string; mimeType?: string }
  | { kind: 'link'; id: string; url: string; title?: string; imageUrl?: string; siteName?: string };

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// A picked photo or video, copied somewhere of its own first: the picker's
// URI can be revoked by the app that handed it over, which is the same
// reason the share handler copies before it saves.
export async function pickMediaForChat(): Promise<ChatAttachment | null> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    quality: 0.9,
  });
  if (picked.canceled || picked.assets.length === 0) return null;
  const asset = picked.assets[0];
  const isImage = (asset.type ?? 'image') === 'image';
  const id = generateId();
  const name = asset.fileName || `${id}${isImage ? '.jpg' : '.mp4'}`;
  const destUri = `${LegacyFileSystem.cacheDirectory}${id}-${name}`;
  await LegacyFileSystem.copyAsync({ from: asset.uri, to: destUri });
  const now = Date.now();
  const mimeType = asset.mimeType || (isImage ? 'image/jpeg' : 'video/mp4');

  if (isImage) {
    await setDoc(
      doc(db, 'photos', id),
      { imageUri: destUri, imageFit: 'contain', title: name, updatedAt: now, createdAt: now, usedInDocuments: {} },
      { merge: true }
    );
    backupFileToDrive(destUri, name, mimeType, 'Photos').then((uploaded) => {
      if (uploaded) updateDoc(doc(db, 'photos', id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
    });
    return { kind: 'photo', id, uri: destUri };
  }

  // A video is a FILE here, not a photo: «Зображення» is pictures, and a
  // clip belongs with everything else that is opened rather than looked at.
  await setDoc(
    doc(db, 'files', id),
    {
      fileUri: destUri,
      fileName: name,
      title: name,
      mimeType,
      updatedAt: now,
      createdAt: now,
      usedInDocuments: {},
    },
    { merge: true }
  );
  backupFileToDrive(destUri, name, mimeType, 'Files').then((uploaded) => {
    if (uploaded) updateDoc(doc(db, 'files', id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
  });
  return { kind: 'file', id, uri: destUri, name, mimeType };
}

// A link, and with it a geo point and a video: which of the three it is
// comes from the URL itself (see linkPreview's isMapsUrl/isYouTubeUrl),
// exactly as it does for a link shared into the app - so a map pasted
// here lands in «Геоточки» without being told to.
export async function attachLinkToChat(rawUrl: string): Promise<ChatAttachment | null> {
  const url = rawUrl.trim();
  if (!url) return null;
  const preview = await fetchLinkPreview(url).catch(() => ({}) as Awaited<ReturnType<typeof fetchLinkPreview>>);
  const id = linkDocId(url);
  const now = Date.now();
  const data: Record<string, unknown> = { url, createdAt: now, updatedAt: now, usedInDocuments: {} };
  if (preview.title) data.title = preview.title;
  if (preview.imageUrl) data.imageUrl = preview.imageUrl;
  if (preview.siteName) data.siteName = preview.siteName;
  await setDoc(doc(db, 'links', id), data, { merge: true });
  return { kind: 'link', id, url, title: preview.title, imageUrl: preview.imageUrl, siteName: preview.siteName };
}
