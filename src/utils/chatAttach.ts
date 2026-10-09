import * as ImagePicker from 'expo-image-picker';
import { saveLinkFromUrl } from './linkRecord';
import * as DocumentPicker from 'expo-document-picker';
import { copyPickedFile } from './localCopy';
import { doc, updateDoc } from '../firestore';
import { setDoc } from './owned';
import { db } from '../firebase';
import { backupFileToDrive } from './googleDrive';
import * as Clipboard from 'expo-clipboard';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { Platform } from 'react-native';

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

// Photos and videos, AS MANY AS WERE CHOSEN - one trip to the gallery
// for the whole thought, not one per picture. Each is copied somewhere of
// its own first: the picker's URI can be revoked by the app that handed
// it over, which is the same reason the share handler copies before it
// saves.
export async function pickMediaForChat(): Promise<ChatAttachment[]> {
  const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return [];
  const picked = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images', 'videos'],
    allowsMultipleSelection: true,
    quality: 0.9,
  });
  if (picked.canceled || picked.assets.length === 0) return [];
  const out: ChatAttachment[] = [];
  for (const asset of picked.assets) {
    const isImage = (asset.type ?? 'image') === 'image';
    const id = generateId();
    const name = asset.fileName || `${id}${isImage ? '.jpg' : '.mp4'}`;
    const destUri = await copyPickedFile(asset.uri, id, name);
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
      out.push({ kind: 'photo', id, uri: destUri });
      continue;
    }
    // A video is a FILE here, not a photo: «Зображення» is pictures, and
    // a clip belongs with what is opened rather than looked at.
    out.push(await saveFileRecord(id, destUri, name, mimeType));
  }
  return out;
}

// A SCREENSHOT OFF THE CLIPBOARD (the user, 2026-10-09: «від як вставляються
// скріншоти з буферу обміну в чат» - the keyboard's paste put the picture's
// bytes into the field as a page of «�» characters). The text field cannot
// take a picture, so it is asked for here: whether the clipboard holds one,
// and the picture itself, saved as a photo like any picked one.
export async function clipboardHasPicture(): Promise<boolean> {
  try {
    return await Clipboard.hasImageAsync();
  } catch {
    return false;
  }
}

export async function pasteClipboardPicture(): Promise<ChatAttachment[]> {
  const image = await Clipboard.getImageAsync({ format: 'png' });
  if (!image?.data) return [];
  const id = generateId();
  const name = `скрін-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
  const base64 = image.data.replace(/^data:image\/\w+;base64,/, '');
  let destUri: string;
  if (Platform.OS === 'web') {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    destUri = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
  } else {
    destUri = `${LegacyFileSystem.cacheDirectory}${id}-${name}`;
    await LegacyFileSystem.writeAsStringAsync(destUri, base64, { encoding: 'base64' });
  }
  const now = Date.now();
  await setDoc(
    doc(db, 'photos', id),
    { imageUri: destUri, imageFit: 'contain', title: name, updatedAt: now, createdAt: now, usedInDocuments: {} },
    { merge: true }
  );
  backupFileToDrive(destUri, name, 'image/png', 'Photos').then((uploaded) => {
    if (uploaded) updateDoc(doc(db, 'photos', id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
  });
  return [{ kind: 'photo', id, uri: destUri }];
}

async function saveFileRecord(
  id: string,
  destUri: string,
  name: string,
  mimeType: string
): Promise<ChatAttachment> {
  const now = Date.now();
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

// Anything at all, from the system's own picker - a PDF, a spreadsheet,
// whatever the thought needed. It lands in «Файли», like every other file
// in the app.
export async function pickFileForChat(): Promise<ChatAttachment[]> {
  // copyToCacheDirectory: false and the copy below, for the reason the
  // editor's own file block gives - a cached copy Android hands back can
  // be a stale one under a path this app chose.
  const result = await DocumentPicker.getDocumentAsync({
    type: '*/*',
    multiple: true,
    copyToCacheDirectory: false,
  });
  if (result.canceled || result.assets.length === 0) return [];
  const out: ChatAttachment[] = [];
  for (const asset of result.assets) {
    const id = generateId();
    const destUri = await copyPickedFile(asset.uri, id, asset.name);
    out.push(await saveFileRecord(id, destUri, asset.name, asset.mimeType || 'application/octet-stream'));
  }
  return out;
}

// A link, and with it a geo point and a video: which of the three it is
// comes from the URL itself (see linkPreview's isMapsUrl/isYouTubeUrl),
// exactly as it does for a link shared into the app - so a map pasted
// here lands in «Геоточки» without being told to.
export async function attachLinkToChat(rawUrl: string): Promise<ChatAttachment[]> {
  const saved = await saveLinkFromUrl(rawUrl);
  if (!saved) return [];
  return [{ kind: 'link', id: saved.id, url: saved.url, title: saved.title, imageUrl: saved.imageUrl, siteName: saved.siteName }];
}
