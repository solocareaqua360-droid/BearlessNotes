import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { SKETCH_FORMAT, SKETCH_VERSION, type SketchElement, type SketchFile } from './sketch/format';

// WHERE THE DRAWINGS LIVE: one `<id>.sketch.json` each in the app's own
// folder, and the pictures inside them as files beside it (sketch-images/).
// No cloud: a drawing leaves the phone as one file, exported (see
// exportSketch), and that file is what mindEva imports.
const DIR = `${LegacyFileSystem.documentDirectory}sketches/`;
const IMAGES = `${LegacyFileSystem.documentDirectory}sketch-images/`;

async function ensureDirs() {
  await LegacyFileSystem.makeDirectoryAsync(DIR, { intermediates: true }).catch(() => {});
  await LegacyFileSystem.makeDirectoryAsync(IMAGES, { intermediates: true }).catch(() => {});
}

export function newSketch(): SketchFile {
  const now = Date.now();
  return {
    format: SKETCH_FORMAT,
    version: SKETCH_VERSION,
    id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Малюнок',
    createdAt: now,
    updatedAt: now,
    width: 0,
    height: 0,
    elements: [],
  };
}

export async function listSketches(): Promise<SketchFile[]> {
  await ensureDirs();
  const names = await LegacyFileSystem.readDirectoryAsync(DIR);
  const files = await Promise.all(
    names
      .filter((n) => n.endsWith('.sketch.json'))
      .map(async (n) => {
        try {
          return JSON.parse(await LegacyFileSystem.readAsStringAsync(DIR + n)) as SketchFile;
        } catch {
          return null;
        }
      })
  );
  return files.filter((f): f is SketchFile => !!f).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function saveSketch(file: SketchFile): Promise<void> {
  await ensureDirs();
  // Kept without the export-only parts: the pictures are files here.
  const { images: _images, preview: _preview, ...kept } = file;
  await LegacyFileSystem.writeAsStringAsync(`${DIR}${file.id}.sketch.json`, JSON.stringify(kept));
}

// Gone from this phone. The pictures it alone used stay in sketch-images/
// for now (a later clean-up can sweep what no drawing refers to).
export async function deleteSketch(id: string): Promise<void> {
  await LegacyFileSystem.deleteAsync(`${DIR}${id}.sketch.json`, { idempotent: true });
}

// ONE FILE THAT IS THE WHOLE DRAWING: the pictures read into it (base64,
// by the uri their element carries), so it can go anywhere - to mindEva
// first of all.
export async function exportSketch(file: SketchFile): Promise<void> {
  const images: Record<string, string> = {};
  for (const el of file.elements) {
    if (el.kind !== 'image' || images[el.uri]) continue;
    try {
      images[el.uri] = await LegacyFileSystem.readAsStringAsync(el.uri, { encoding: LegacyFileSystem.EncodingType.Base64 });
    } catch {
      // A picture that is no longer there is left out; its frame stays.
    }
  }
  const safe = (file.title || 'Малюнок').replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'sketch';
  const out = `${LegacyFileSystem.cacheDirectory}${safe}.sketch.json`;
  await LegacyFileSystem.writeAsStringAsync(out, JSON.stringify({ ...file, images }));
  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(out, { mimeType: 'application/json', dialogTitle: 'Експорт малюнка' });
  }
}

// A drawing file from anywhere (mindEva's export included, once it has
// one): its pictures written back out as files here, the elements pointed
// at them, and it is a drawing of this phone's - under a new id, so an
// import never overwrites what is already here.
export async function importSketch(): Promise<SketchFile | null> {
  const picked = await DocumentPicker.getDocumentAsync({ type: ['application/json', '*/*'], copyToCacheDirectory: true });
  if (picked.canceled || !picked.assets?.length) return null;
  const raw = JSON.parse(await LegacyFileSystem.readAsStringAsync(picked.assets[0].uri)) as Partial<SketchFile>;
  if (raw.format !== SKETCH_FORMAT || !Array.isArray(raw.elements)) throw new Error('Це не файл малюнка sketchEva.');
  await ensureDirs();
  const moved: Record<string, string> = {};
  for (const [oldUri, data] of Object.entries(raw.images ?? {})) {
    const uri = `${IMAGES}${Date.now()}-${Math.random().toString(36).slice(2, 8)}.jpg`;
    await LegacyFileSystem.writeAsStringAsync(uri, data, { encoding: LegacyFileSystem.EncodingType.Base64 });
    moved[oldUri] = uri;
  }
  const elements = (raw.elements as SketchElement[]).map((el) =>
    el.kind === 'image' && moved[el.uri] ? { ...el, uri: moved[el.uri] } : el
  );
  const base = newSketch();
  const file: SketchFile = {
    ...base,
    version: raw.version ?? SKETCH_VERSION,
    title: raw.title || base.title,
    width: raw.width ?? 0,
    height: raw.height ?? 0,
    elements,
  };
  await saveSketch(file);
  return file;
}
