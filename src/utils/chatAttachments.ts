import { useCallback, useEffect, useState } from 'react';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import * as XLSX from 'xlsx';
import { doc, getDoc, getDocs, onSnapshot } from '../firestore';
import { db } from '../firebase';
import { ownedQuery, setDoc } from './owned';
import { compressPickedImage } from './photoLibrary';
import { blocksToMarkdown } from './blocksText';
import { GEMINI_MODEL } from './gemini';
import { getGeminiKey } from './geminiKey';
import { INPUT_PRICE_PER_M } from './geminiUsage';
import { listenError } from './listenError';
import type { Block } from '../types';

// WHAT A CONVERSATION CAN BE GIVEN TO READ (2026-10-24, sketches fin5-fin9): a photo, a PDF, a text file, a Word or Excel
// file, a note of the app, a folder of the explorer. Gemini reads photos and PDFs itself; Word and Excel it does not, so they
// are turned into text here (no new library: the xlsx package already reads zips and workbooks). Notes and folders go as
// Markdown. Before anything is sent the parts are counted (Gemini's own countTokens), so the person sees the price and is
// asked when it is above the threshold they set - one threshold for every conversation.

export type ChatAttachment = {
  id: string;
  kind: 'photo' | 'pdf' | 'text' | 'docx' | 'xlsx' | 'note' | 'folder';
  // What the chip says under the name: «12 стор.», «нотатка», «папка · 26».
  name: string;
  sub: string;
  uri?: string;
  mime?: string;
  documentId?: string;
  folderPath?: string;
  sizeBytes?: number;
};

// One part of a Gemini request, as the REST API takes it.
export type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

const MAX_BYTES = 20 * 1024 * 1024;
const MAX_SHEET_ROWS = 2000;
const MAX_FOLDER_CHARS = 400_000;
const newId = () => `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const TEXT_EXT = new Set(['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'html', 'htm', 'xml', 'yaml', 'yml', 'log', 'rtf', 'js', 'ts', 'tsx', 'jsx', 'py', 'java', 'kt', 'swift', 'c', 'cpp', 'h', 'cs', 'go', 'rb', 'php', 'sh', 'sql', 'css']);
const extOf = (name: string) => (name.split('.').pop() ?? '').toLowerCase();

// The kind a picked file is read as - by its extension first (mime types from pickers are unreliable), then its mime.
export function kindOfFile(name: string, mime?: string): ChatAttachment['kind'] | null {
  const ext = extOf(name);
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (ext === 'docx' || mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') return 'docx';
  if (ext === 'xlsx' || ext === 'xls' || mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || mime === 'application/vnd.ms-excel') return 'xlsx';
  if (['jpg', 'jpeg', 'png', 'webp', 'heic', 'heif'].includes(ext) || (mime ?? '').startsWith('image/')) return 'photo';
  if (TEXT_EXT.has(ext) || (mime ?? '').startsWith('text/')) return 'text';
  return null;
}

const SUB: Record<ChatAttachment['kind'], string> = { photo: 'фото', pdf: 'PDF', text: 'текст', docx: 'Word', xlsx: 'Excel', note: 'нотатка', folder: 'папка' };

async function photosFrom(result: ImagePicker.ImagePickerResult): Promise<ChatAttachment[]> {
  if (result.canceled) return [];
  const out: ChatAttachment[] = [];
  for (const asset of result.assets) {
    const uri = await compressPickedImage(asset.uri, asset.width, asset.height);
    out.push({ id: newId(), kind: 'photo', name: 'Фото', sub: SUB.photo, uri, mime: 'image/jpeg' });
  }
  return out;
}

export async function pickCamera(): Promise<ChatAttachment[]> {
  const permission = await ImagePicker.requestCameraPermissionsAsync();
  if (!permission.granted) throw new Error('Немає дозволу на камеру');
  return photosFrom(await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 }));
}

export async function pickGallery(): Promise<ChatAttachment[]> {
  return photosFrom(await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 1 }));
}

export async function pickFile(): Promise<ChatAttachment[]> {
  const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: true, multiple: true });
  if (result.canceled || result.assets.length === 0) return [];
  const out: ChatAttachment[] = [];
  for (const asset of result.assets) {
    if ((asset.size ?? 0) > MAX_BYTES) throw new Error(`Файл «${asset.name}» більший за 20 МБ - Gemini його не прийме в одному запиті`);
    const kind = kindOfFile(asset.name, asset.mimeType);
    if (!kind) throw new Error(`Gemini не читає цей тип файлу: ${asset.name}`);
    if (kind === 'photo') {
      out.push({ id: newId(), kind, name: asset.name, sub: SUB.photo, uri: asset.uri, mime: asset.mimeType ?? 'image/jpeg', sizeBytes: asset.size });
      continue;
    }
    out.push({ id: newId(), kind, name: asset.name, sub: SUB[kind], uri: asset.uri, mime: asset.mimeType, sizeBytes: asset.size });
  }
  return out;
}

export function noteAttachment(d: { id: string; title: string }): ChatAttachment {
  return { id: newId(), kind: 'note', name: d.title || 'Без назви', sub: SUB.note, documentId: d.id };
}

export function folderAttachment(f: { path: string; name: string; count: number }): ChatAttachment {
  return { id: newId(), kind: 'folder', name: f.name, sub: `папка · ${f.count}`, folderPath: f.path };
}

// ---- reading -------------------------------------------------------------------------------------------------------------

async function readBase64(uri: string): Promise<string> {
  try {
    return await LegacyFileSystem.readAsStringAsync(uri, { encoding: LegacyFileSystem.EncodingType.Base64 });
  } catch {
    // The browser: a blob: or data: address.
    const blob = await (await fetch(uri)).blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).replace(/^data:[^,]*,/, ''));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }
}

async function readText(uri: string): Promise<string> {
  try {
    return await LegacyFileSystem.readAsStringAsync(uri);
  } catch {
    return await (await fetch(uri)).text();
  }
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

// word/document.xml as plain text: a paragraph per line, tabs and breaks kept, every tag dropped.
export function docxXmlToText(xml: string): string {
  return decodeEntities(
    xml
      .replace(/<w:tab\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<[^>]+>/g, '')
  )
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function docxText(base64: string): string {
  const cfb = XLSX.CFB.read(base64, { type: 'base64' });
  const entry = XLSX.CFB.find(cfb, 'word/document.xml') ?? XLSX.CFB.find(cfb, '/word/document.xml');
  if (!entry || !entry.content) throw new Error('у файлі немає тексту');
  const bytes = entry.content as Uint8Array | number[];
  const xml = new TextDecoder('utf-8').decode(bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes));
  return docxXmlToText(xml);
}

function xlsxText(base64: string): string {
  const book = XLSX.read(base64, { type: 'base64' });
  return book.SheetNames.map((name) => {
    const rows = XLSX.utils.sheet_to_csv(book.Sheets[name], { blankrows: false }).split('\n');
    const cut = rows.length > MAX_SHEET_ROWS;
    return `Аркуш «${name}»${cut ? ` (перші ${MAX_SHEET_ROWS} рядків з ${rows.length})` : ''}:\n${rows.slice(0, MAX_SHEET_ROWS).join('\n')}`;
  }).join('\n\n');
}

async function noteMarkdown(documentId: string): Promise<{ title: string; text: string } | null> {
  try {
    const snap = await getDoc(doc(db, 'documents', documentId));
    if (!snap.exists()) return null;
    const data = snap.data() as { title?: string; blocks?: Block[]; deletedAt?: number };
    if (data.deletedAt) return null;
    return { title: data.title || 'Без назви', text: blocksToMarkdown(data.blocks ?? []) };
  } catch {
    return null;
  }
}

// The notes filed in a folder of the explorer and in the folders under it: a note is IN a folder when its tagIds carry a tag
// whose path is that folder's (see useAllFolderItems / ExplorerScreen) - a folder that is only the way to deeper ones has no
// tag of its own, its notes are the deeper ones'.
async function folderNotes(path: string): Promise<{ title: string; text: string }[]> {
  const tagSnap = await getDocs(ownedQuery('tags'));
  const ids = new Set(
    tagSnap.docs
      .filter((d: { data: () => Record<string, unknown> }) => {
        const p = String(d.data().path ?? '');
        return p === path || p.startsWith(`${path}/`);
      })
      .map((d: { id: string }) => d.id)
  );
  if (ids.size === 0) return [];
  const docSnap = await getDocs(ownedQuery('documents'));
  return docSnap.docs
    .map((d: { data: () => Record<string, unknown> }) => d.data())
    .filter((data: Record<string, unknown>) => {
      if (data.deletedAt || data.owner) return false;
      const tagIds = (data.tagIds as string[] | undefined) ?? [];
      return tagIds.some((t) => ids.has(t));
    })
    .map((data: Record<string, unknown>) => ({ title: String(data.title || 'Без назви'), text: blocksToMarkdown((data.blocks as Block[] | undefined) ?? []) }));
}

// The attachments as the parts of a request, and what could not be read (to say so, not to fail the whole message).
export async function attachmentParts(list: ChatAttachment[]): Promise<{ parts: GeminiPart[]; notes: string[] }> {
  const parts: GeminiPart[] = [];
  const notes: string[] = [];
  for (const a of list) {
    try {
      if (a.kind === 'photo' && a.uri) {
        parts.push({ inlineData: { mimeType: a.mime && a.mime.startsWith('image/') ? a.mime : 'image/jpeg', data: await readBase64(a.uri) } });
      } else if (a.kind === 'pdf' && a.uri) {
        parts.push({ text: `Файл «${a.name}»:` }, { inlineData: { mimeType: 'application/pdf', data: await readBase64(a.uri) } });
      } else if (a.kind === 'text' && a.uri) {
        parts.push({ text: `Файл «${a.name}»:\n${await readText(a.uri)}` });
      } else if (a.kind === 'docx' && a.uri) {
        parts.push({ text: `Файл «${a.name}» (Word):\n${docxText(await readBase64(a.uri))}` });
      } else if (a.kind === 'xlsx' && a.uri) {
        parts.push({ text: `Файл «${a.name}» (Excel):\n${xlsxText(await readBase64(a.uri))}` });
      } else if (a.kind === 'note' && a.documentId) {
        const note = await noteMarkdown(a.documentId);
        if (note) parts.push({ text: `Нотатка «${note.title}»:\n${note.text}` });
        else notes.push(`Нотатку «${a.name}» не вдалося прочитати`);
      } else if (a.kind === 'folder' && a.folderPath) {
        const all = await folderNotes(a.folderPath);
        let total = 0;
        const taken: string[] = [];
        for (const n of all) {
          const piece = `## ${n.title}\n${n.text}`;
          if (total + piece.length > MAX_FOLDER_CHARS) break;
          taken.push(piece);
          total += piece.length;
        }
        const cut = taken.length < all.length;
        parts.push({ text: `Папка «${a.name}» (${taken.length} нотаток${cut ? ` з ${all.length} - решта не вмістилась` : ''}):\n\n${taken.join('\n\n')}` });
        if (cut) notes.push(`З папки «${a.name}» узято ${taken.length} нотаток з ${all.length}`);
      }
    } catch (e) {
      notes.push(`«${a.name}» не вдалося прочитати: ${(e as Error).message}`);
    }
  }
  return { parts, notes };
}

// ---- price ----------------------------------------------------------------------------------------------------------------

function estimate(parts: GeminiPart[], textBefore: string): number {
  let n = Math.ceil(textBefore.length / 4);
  for (const p of parts) {
    if ('text' in p) n += Math.ceil(p.text.length / 4);
    else if (p.inlineData.mimeType.startsWith('image/')) n += 1300;
    else n += Math.ceil((p.inlineData.data.length * 0.75) / 3000);
  }
  return n;
}

// The tokens the request would take: Gemini's own count (free), or an estimate when that cannot be asked.
export async function countTokens(parts: GeminiPart[], textBefore: string): Promise<number> {
  try {
    const key = await getGeminiKey();
    if (!key) return estimate(parts, textBefore);
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:countTokens?key=${encodeURIComponent(key)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: textBefore || ' ' }, ...parts] }] }),
    });
    const data = await response.json().catch(() => null);
    const total = data?.totalTokens;
    return response.ok && typeof total === 'number' ? total : estimate(parts, textBefore);
  } catch {
    return estimate(parts, textBefore);
  }
}

export function priceOfTokens(tokens: number): number {
  return (tokens * INPUT_PRICE_PER_M) / 1e6;
}

// ---- the threshold, one for every conversation ----------------------------------------------------------------------------

const PREFS = () => doc(db, 'settings', 'assistantCostPrefs');
export const DEFAULT_COST_THRESHOLD = 0.05;
const parseThreshold = (v: unknown): number | null => (v === null ? null : typeof v === 'number' && v > 0 ? v : DEFAULT_COST_THRESHOLD);

// null = «Не питати».
export function useCostThreshold(): [number | null, (v: number | null) => void] {
  const [value, setValue] = useState<number | null>(DEFAULT_COST_THRESHOLD);
  useEffect(
    () =>
      onSnapshot(
        PREFS(),
        (snap: { data: () => Record<string, unknown> | undefined }) => {
          const data = snap.data();
          setValue(data && 'threshold' in data ? parseThreshold(data.threshold) : DEFAULT_COST_THRESHOLD);
        },
        listenError('assistantCostPrefs')
      ),
    []
  );
  const set = useCallback((v: number | null) => {
    setValue(v);
    setDoc(PREFS(), { threshold: v }, { merge: true }).catch(() => {});
  }, []);
  return [value, set];
}

export async function getCostThreshold(): Promise<number | null> {
  try {
    const snap = await getDoc(PREFS());
    const data = snap.data() as Record<string, unknown> | undefined;
    return data && 'threshold' in data ? parseThreshold(data.threshold) : DEFAULT_COST_THRESHOLD;
  } catch {
    return DEFAULT_COST_THRESHOLD;
  }
}
