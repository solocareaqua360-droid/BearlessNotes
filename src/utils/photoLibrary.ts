import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { doc, updateDoc } from '../firestore';
import { db } from '../firebase';
import { setDoc } from './owned';
import { generateId } from './documentBlocks';
import { backupFileToDrive } from './googleDrive';

export type NewPhoto = { id: string; imageUri: string; createdAt: number };

// Same resize-then-compress DocumentEditorScreen's own image blocks go
// through before ever being saved anywhere.
export async function compressPickedImage(uri: string, width: number, height: number): Promise<string> {
  const MAX_DIMENSION = 1600;
  try {
    const longest = Math.max(width, height);
    let context = ImageManipulator.manipulate(uri);
    if (longest > MAX_DIMENSION) {
      const scale = MAX_DIMENSION / longest;
      context = context.resize({ width: Math.round(width * scale), height: Math.round(height * scale) });
    }
    const rendered = await context.renderAsync();
    const saved = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
    return saved.uri;
  } catch {
    return uri;
  }
}

// The one write every new Photos record shares - the Photos screen's own
// "+" and a link card's photo button alike. `imageUri` is already the
// final, compressed file. Backed up to Drive in the background, same as
// any photo.
// `fromCamera`: the mark the Photos base's built-in «З камери» reads (it replaced the service project «Фото», 2026-10-22).
export async function writePhotoRecord(imageUri: string, options: { groupId?: string; fromCamera?: boolean; id?: string } = {}): Promise<NewPhoto> {
  const now = Date.now();
  const id = options.id ?? generateId();
  const data: Record<string, unknown> = {
    imageUri,
    imageFit: 'contain',
    updatedAt: now,
    createdAt: now,
    usedInDocuments: {},
  };
  if (options.groupId) data.groupId = options.groupId;
  if (options.fromCamera) data.fromCamera = true;
  await setDoc(doc(db, 'photos', id), data, { merge: true });
  backupFileToDrive(imageUri, `${id}.jpg`, 'image/jpeg', 'Photos').then((uploaded) => {
    if (uploaded) updateDoc(doc(db, 'photos', id), { driveFileId: uploaded.fileId, driveBytes: uploaded.bytes });
  });
  return { id, imageUri, createdAt: now };
}

// Straight from the phone's gallery (several at once) or its camera,
// each compressed and written as its own Photos record. Resolves to
// nothing picked when permission is refused or the picker is cancelled.
export async function pickPhotosFromDevice(
  source: 'gallery' | 'camera',
  // `record: false` (2026-10-31, the one rule for pictures): only the picture is made - nothing is written to the base; the caller
  // decides whether it ever goes there.
  options: { groupId?: string; record?: boolean } = {}
): Promise<NewPhoto[]> {
  const permission =
    source === 'camera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return [];
  const result =
    source === 'camera'
      ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
      : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1, allowsMultipleSelection: true });
  if (result.canceled || result.assets.length === 0) return [];
  const added: NewPhoto[] = [];
  for (const asset of result.assets) {
    const imageUri = await compressPickedImage(asset.uri, asset.width, asset.height);
    added.push(options.record === false ? { id: generateId(), imageUri, createdAt: Date.now() } : await writePhotoRecord(imageUri, options));
  }
  return added;
}
