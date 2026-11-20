import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as ImagePicker from 'expo-image-picker';
import { backupFileToDrive } from './googleDrive';
import { setThoughtVideo, type ThoughtVideo } from '../hooks/useThoughts';

// THE VIDEO OF A THOUGHT (2026-11-16, the inbox: «якщо просто відео, то це відео; відео і коментар - відео з підписом»).
// A shared or picked video file is COPIED into the app's own folder (a share's address does not live long), its first
// frame kept as a picture for the card, and both backed up to Drive in the background like every file of the app - so
// a reinstall or the other device brings them back.
const DIR = `${FileSystem.documentDirectory}thought-videos/`;
const freshName = (ext: string) => `${DIR}${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
const extOf = (uri: string, mime?: string) => {
  const e = /\.(mp4|mov|m4v|webm|3gp|mkv)(\?|$)/i.exec(uri)?.[1]?.toLowerCase();
  if (e) return e;
  if (mime?.includes('quicktime')) return 'mov';
  if (mime?.includes('webm')) return 'webm';
  return 'mp4';
};
export const videoMime = (uri: string) => {
  const e = extOf(uri);
  return e === 'mov' ? 'video/quicktime' : e === 'webm' ? 'video/webm' : e === '3gp' ? 'video/3gpp' : e === 'mkv' ? 'video/x-matroska' : 'video/mp4';
};

// One video from the phone's gallery.
export async function pickThoughtVideo(): Promise<{ uri: string; name?: string; durationMs?: number } | null> {
  const picked = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsMultipleSelection: false, quality: 1 });
  if (picked.canceled || !picked.assets.length) return null;
  const a = picked.assets[0];
  return { uri: a.uri, name: a.fileName ?? undefined, durationMs: typeof a.duration === 'number' ? a.duration : undefined };
}

// The first frame (half a second in - a first frame is often black), as a picture in the app's folder.
export async function videoThumb(uri: string): Promise<string | undefined> {
  if (Platform.OS === 'web') return undefined;
  try {
    const { getThumbnailAsync } = await import('expo-video-thumbnails');
    const shot = await getThumbnailAsync(uri, { time: 500, quality: 0.7 });
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
    const to = freshName('jpg');
    await FileSystem.copyAsync({ from: shot.uri, to });
    return to;
  } catch {
    return undefined;
  }
}

// The video into the app's own folder (already there: left as it is), with its picture.
export async function keepThoughtVideo(input: { uri: string; name?: string; mimeType?: string; durationMs?: number }): Promise<ThoughtVideo> {
  let uri = input.uri;
  if (Platform.OS !== 'web' && !uri.startsWith(DIR)) {
    await FileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
    const to = freshName(extOf(uri, input.mimeType));
    await FileSystem.copyAsync({ from: uri, to });
    uri = to;
  }
  const thumbUri = await videoThumb(uri);
  return { uri, ...(thumbUri ? { thumbUri } : {}), ...(input.name ? { name: input.name } : {}), ...(input.durationMs ? { durationMs: input.durationMs } : {}) };
}

// After the thought is saved: the video and its picture go to Drive, and the thought learns their ids. Silent - the
// thought is kept already, and a missing sign-in only means the copy waits.
export async function backupThoughtVideo(thoughtId: string, video: ThoughtVideo) {
  let next = video;
  if (!video.driveFileId) {
    const name = video.name || video.uri.split('/').pop() || 'video.mp4';
    const up = await backupFileToDrive(video.uri, name, videoMime(video.uri), 'Files').catch(() => null);
    if (up) next = { ...next, driveFileId: up.fileId };
  }
  if (video.thumbUri && !video.thumbDriveFileId) {
    const up = await backupFileToDrive(video.thumbUri, video.thumbUri.split('/').pop() || 'video.jpg', 'image/jpeg', 'Photos').catch(() => null);
    if (up) next = { ...next, thumbDriveFileId: up.fileId };
  }
  if (next !== video) await setThoughtVideo(thoughtId, next).catch(() => {});
}
