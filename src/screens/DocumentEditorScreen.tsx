import { ForwardedRef, ReactNode, forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Image,
  Keyboard,
  LayoutAnimation,
  LayoutChangeEvent,
  Linking,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import DocumentScanner, { ResponseType, ScanDocumentResponseStatus } from 'react-native-document-scanner-plugin';
import * as Print from 'expo-print';
import * as Clipboard from 'expo-clipboard';
import { dateKey, formatShortDate, parseDateKey } from '../utils/dateLocale';
import ReminderSheet from '../components/ReminderSheet';
import { cancelReminder, scheduleReminder } from '../utils/reminders';
// The new expo-file-system File/Directory API tracks read permission per
// picked URI internally and rejects copying a URI it didn't hand out
// itself ("Missing 'READ' permission") - the legacy module just wraps a
// plain native file copy given two paths, which is what actually works
// for re-homing a file expo-document-picker (a different module) picked.
import * as LegacyFileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
// react-native-gesture-handler's own ScrollView (not the core RN one) so it
// shares the same touch arena as our rows' Pan gestures - otherwise a swipe
// starting on a block (its TextInput especially) never reaches the
// ScrollView's own scroll recognition and only the icon column can scroll.
import { Gesture, GestureDetector, GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocFromCache,
  onSnapshot,
  orderBy,
  query,
  setDoc,
  updateDoc,
} from '@react-native-firebase/firestore';
import { db } from '../firebase';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import { Block, BlockType, Group, SketchElement, Tag, TableRow } from '../types';
import { RootStackParamList } from '../navigation';
import ZoomableImageViewer from '../components/ZoomableImageViewer';
import VideoPlayerModal from '../components/VideoPlayerModal';
import RenamePrompt from '../components/RenamePrompt';
import DocumentTagsBlock from '../components/DocumentTagsBlock';
import SketchEditor from '../components/SketchEditor';
import EditorToolbar, { EDITOR_TOOLBAR_HEIGHT } from '../components/EditorToolbar';
import { BlockAction } from '../components/blockActions';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { backupFileToDrive } from '../utils/googleDrive';
import GroupPickerSheet, { CAMERA_PHOTOS_GROUP_ID } from '../components/GroupPickerSheet';
import { useTags } from '../hooks/useTags';
import { useCachedAttachment } from '../hooks/useCachedAttachment';
import { linkDocId } from '../utils/linkId';
import { getVideoEmbedInfo } from '../utils/videoEmbed';
import { fetchLinkPreview, LinkPreview } from '../utils/linkPreview';
import { colorForDocument } from '../utils/documentColor';
import { useDownloadToast } from '../hooks/useDownloadToast';
import DownloadToast from '../components/DownloadToast';
import AddExistingItemModal from '../components/AddExistingItemModal';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const ACCENT = '#3B82F6';
// Палітра №3 (Теплий Теракотовий) - just for the edit-mode FAB, matching
// DocumentsScreen's "+"; the rest of the editor keeps its own ACCENT.
const EDIT_FAB_COLOR = '#BE7657';
const DANGER = '#EF4444';
const AUTOSAVE_DELAY_MS = 600;
const DRAG_LONG_PRESS_MS = 350;
const DOWNLOAD_DIR_STORAGE_KEY = 'bearlessNotes.downloadDirUri';

// Small fixed palette rather than a full color picker - enough variety for
// notes without the complexity of a hue/saturation UI.

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Firestore rejects `undefined` anywhere in a document, so every block is
// built through this one place instead of ad-hoc object literals scattered
// around - it never sets a field it doesn't need (checked only exists on
// checkbox blocks) rather than setting that field to undefined.
function buildBlock(id: string, type: BlockType, text: string): Block {
  const block: Block = { id, text, type, createdAt: Date.now() };
  if (type === 'checkbox') block.checked = false;
  if (type === 'table') block.tableRows = [{ cells: ['', ''] }, { cells: ['', ''] }];
  return block;
}

function newBlock(): Block {
  return buildBlock(generateId(), 'paragraph', '');
}

const LIST_TYPES: BlockType[] = ['bulleted', 'numbered', 'checkbox'];

// Read-only mirror of TasksScreen's own formatReminderBadge - a checkbox
// block only ever displays its reminder here (editing happens from the
// Tasks screen, where the picker and the star/date rules live).
function formatReminderBadge(item: Block): string | null {
  if (!item.reminderDate) return null;
  const label = formatShortDate(parseDateKey(item.reminderDate));
  return item.reminderTime ? `${label} ${item.reminderTime}` : label;
}

// A generic document icon, tinted per extension so a PDF/Word/Excel
// attachment is recognizable at a glance without needing per-brand icons.
function fileIconFor(name?: string): 'document-text-outline' | 'document-outline' {
  return (name ?? '').toLowerCase().endsWith('.pdf') ? 'document-text-outline' : 'document-outline';
}

function fileIconColorFor(name?: string): string {
  const ext = (name ?? '').toLowerCase().split('.').pop();
  if (ext === 'pdf') return '#DC2626';
  if (ext === 'doc' || ext === 'docx') return '#2563EB';
  if (ext === 'xls' || ext === 'xlsx') return '#16A34A';
  return '#6B7280';
}

// A bare URL on its own paragraph auto-converts into a 'link' block (see
// scheduleLinkConversion) carrying whatever preview this can fetch for free -
// no image is ever downloaded/stored, only a remote URL loaded live by
// <Image>, so a broken/expired preview at worst shows nothing rather than
// costing storage. Every branch degrades to {siteName: hostname} on failure
// so the block always has something to show instead of erroring. The actual
// fetch/parse logic lives in utils/linkPreview.ts, shared with LinksScreen's
// own "+" button (adding a link with no document at all).

// Asks once (via Android's Storage Access Framework) which folder to save
// downloads into - the user picks it in the system's own file browser, so
// it shows up there like any other downloaded file - and reuses that same
// folder afterward instead of prompting on every download.
async function getDownloadDirUri(forceReprompt = false): Promise<string | null> {
  if (!forceReprompt) {
    const stored = await AsyncStorage.getItem(DOWNLOAD_DIR_STORAGE_KEY);
    if (stored) return stored;
  }
  const permission = await LegacyFileSystem.StorageAccessFramework.requestDirectoryPermissionsAsync();
  if (!permission.granted) return null;
  await AsyncStorage.setItem(DOWNLOAD_DIR_STORAGE_KEY, permission.directoryUri);
  return permission.directoryUri;
}

// Returns the saved file's own content:// URI (for the post-download
// "Показати в папці" toast) or null if the user never granted/re-granted a
// download folder.
async function downloadToDevice(sourceUri: string, fileName: string, mimeType: string): Promise<string | null> {
  const dirUri = await getDownloadDirUri();
  if (!dirUri) return null;
  const dot = fileName.lastIndexOf('.');
  const nameWithoutExt = dot > 0 ? fileName.slice(0, dot) : fileName;
  const writeInto = async (targetDirUri: string) => {
    const destUri = await LegacyFileSystem.StorageAccessFramework.createFileAsync(
      targetDirUri,
      nameWithoutExt,
      mimeType
    );
    const content = await LegacyFileSystem.readAsStringAsync(sourceUri, { encoding: 'base64' });
    await LegacyFileSystem.writeAsStringAsync(destUri, content, { encoding: 'base64' });
    return destUri;
  };
  try {
    return await writeInto(dirUri);
  } catch {
    // The previously granted folder may have been revoked since (e.g. the
    // user cleared it from Android's settings) - ask once more instead of
    // silently failing on every future download.
    const freshDirUri = await getDownloadDirUri(true);
    if (!freshDirUri) return null;
    return await writeInto(freshDirUri);
  }
}

// Inline formatting is stored as plain markers inside the block's own text
// (**bold**, *italic*, __underline__, ~~strikethrough~~, {c:#hex}color{/c},
// {h:#hex}highlight{/h}) rather than a separate rich-text model - Android's
// TextInput can't render live bold-while-typing inside an editable field
// regardless of data model, so there was nothing to gain from a heavier
// representation. Markers are visible as-is while a block is being edited
// (see BlockRow) and parsed into styled <Text> runs otherwise.
const COLOR_OPEN = /^\{c:(#[0-9A-Fa-f]{6})\}/;
const HIGHLIGHT_OPEN = /^\{h:(#[0-9A-Fa-f]{6})\}/;
const COLOR_CLOSE = '{/c}';
const HIGHLIGHT_CLOSE = '{/h}';

type TextStyle = {
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strikethrough?: boolean;
  color?: string;
  highlight?: string;
};

type TextSegment = TextStyle & { text: string };

function parseFormattedText(text: string): TextSegment[] {
  const segments: TextSegment[] = [];
  parseFormattedInto(text, {}, segments);
  return segments;
}

function parseFormattedInto(text: string, style: TextStyle, out: TextSegment[]) {
  let i = 0;
  let plainStart = 0;
  const flushPlain = (end: number) => {
    if (end > plainStart) out.push({ text: text.slice(plainStart, end), ...style });
  };
  while (i < text.length) {
    const rest = text.slice(i);
    let consumed = 0;
    if (rest.startsWith('**')) {
      const close = rest.indexOf('**', 2);
      if (close !== -1) {
        flushPlain(i);
        parseFormattedInto(rest.slice(2, close), { ...style, bold: true }, out);
        consumed = close + 2;
      }
    } else if (rest.startsWith('__')) {
      const close = rest.indexOf('__', 2);
      if (close !== -1) {
        flushPlain(i);
        parseFormattedInto(rest.slice(2, close), { ...style, underline: true }, out);
        consumed = close + 2;
      }
    } else if (rest.startsWith('~~')) {
      const close = rest.indexOf('~~', 2);
      if (close !== -1) {
        flushPlain(i);
        parseFormattedInto(rest.slice(2, close), { ...style, strikethrough: true }, out);
        consumed = close + 2;
      }
    } else if (rest.startsWith('*')) {
      const close = rest.indexOf('*', 1);
      if (close !== -1) {
        flushPlain(i);
        parseFormattedInto(rest.slice(1, close), { ...style, italic: true }, out);
        consumed = close + 1;
      }
    } else if (COLOR_OPEN.test(rest)) {
      const m = rest.match(COLOR_OPEN)!;
      const close = rest.indexOf(COLOR_CLOSE, m[0].length);
      if (close !== -1) {
        flushPlain(i);
        parseFormattedInto(rest.slice(m[0].length, close), { ...style, color: m[1] }, out);
        consumed = close + COLOR_CLOSE.length;
      }
    } else if (HIGHLIGHT_OPEN.test(rest)) {
      const m = rest.match(HIGHLIGHT_OPEN)!;
      const close = rest.indexOf(HIGHLIGHT_CLOSE, m[0].length);
      if (close !== -1) {
        flushPlain(i);
        parseFormattedInto(rest.slice(m[0].length, close), { ...style, highlight: m[1] }, out);
        consumed = close + HIGHLIGHT_CLOSE.length;
      }
    }
    if (consumed > 0) {
      i += consumed;
      plainStart = i;
    } else {
      i++;
    }
  }
  flushPlain(text.length);
}

// Same segments FormattedText renders on-screen, reused so an exported
// PDF keeps bold/italic/underline/strikethrough/color instead of showing
// the raw **markers**.
function plainTextOf(text: string): string {
  return parseFormattedText(text)
    .map((s) => s.text)
    .join('');
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function segmentToHtml(seg: TextSegment): string {
  let html = escapeHtml(seg.text);
  if (seg.bold) html = `<b>${html}</b>`;
  if (seg.italic) html = `<i>${html}</i>`;
  if (seg.underline) html = `<u>${html}</u>`;
  if (seg.strikethrough) html = `<s>${html}</s>`;
  if (seg.highlight) html = `<span style="background:${seg.highlight}">${html}</span>`;
  if (seg.color) html = `<span style="color:${seg.color}">${html}</span>`;
  return html;
}

function textToHtml(text: string): string {
  return parseFormattedText(text).map(segmentToHtml).join('') || '&nbsp;';
}

function formatSum(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

// --- Table formulas -------------------------------------------------
// A cell's raw text is either a plain value or a formula starting with
// "=" that references other cells by A1-style address (e.g. "B3") or a
// rectangular range ("B1:B3"). Support is deliberately small: either a
// whole-cell SUM/AVERAGE/MIN/MAX/COUNT(range) call, or a plain
// arithmetic expression (+ - * / and parens) with cell refs substituted
// in - enough for "simple arithmetic, sum a column" without pulling in
// a real formula-language parser. No eval/new Function (Hermes doesn't
// reliably support dynamic code eval), so arithmetic is evaluated with
// a small hand-written recursive-descent parser.

function columnLetter(index: number): string {
  let n = index + 1;
  let s = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function columnIndexFromLetters(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function parseCellRef(ref: string): { row: number; col: number } | null {
  const m = /^([A-Za-z]+)([0-9]+)$/.exec(ref.trim());
  if (!m) return null;
  const row = parseInt(m[2], 10) - 1;
  if (row < 0) return null;
  return { row, col: columnIndexFromLetters(m[1]) };
}

function evaluateArithmetic(expr: string): number {
  let i = 0;
  const peek = () => expr[i];
  function parseNumber(): number {
    const start = i;
    while (i < expr.length && /[0-9.]/.test(expr[i])) i++;
    const n = parseFloat(expr.slice(start, i));
    return Number.isNaN(n) ? 0 : n;
  }
  function parseFactor(): number {
    while (peek() === ' ') i++;
    if (peek() === '(') {
      i++;
      const v = parseExpr();
      while (peek() === ' ') i++;
      if (peek() === ')') i++;
      return v;
    }
    if (peek() === '-') {
      i++;
      return -parseFactor();
    }
    if (peek() === '+') {
      i++;
      return parseFactor();
    }
    return parseNumber();
  }
  function parseTerm(): number {
    let v = parseFactor();
    for (;;) {
      while (peek() === ' ') i++;
      if (peek() === '*') {
        i++;
        v *= parseFactor();
      } else if (peek() === '/') {
        i++;
        const d = parseFactor();
        v = d !== 0 ? v / d : 0;
      } else break;
    }
    return v;
  }
  function parseExpr(): number {
    let v = parseTerm();
    for (;;) {
      while (peek() === ' ') i++;
      if (peek() === '+') {
        i++;
        v += parseTerm();
      } else if (peek() === '-') {
        i++;
        v -= parseTerm();
      } else break;
    }
    return v;
  }
  const result = parseExpr();
  return Number.isFinite(result) ? result : 0;
}

function evaluateRange(rangeExpr: string, rows: TableRow[], stack: Set<string>): number[] {
  const [fromRaw, toRaw] = rangeExpr.split(':');
  const from = parseCellRef(fromRaw ?? '');
  const to = parseCellRef((toRaw ?? fromRaw) ?? '');
  if (!from || !to) return [];
  const values: number[] = [];
  const rMin = Math.min(from.row, to.row);
  const rMax = Math.max(from.row, to.row);
  const cMin = Math.min(from.col, to.col);
  const cMax = Math.max(from.col, to.col);
  for (let r = rMin; r <= rMax; r++) {
    for (let c = cMin; c <= cMax; c++) values.push(evaluateCell(rows, r, c, stack));
  }
  return values;
}

function evaluateFormula(expr: string, rows: TableRow[], stack: Set<string>): number {
  const trimmed = expr.trim();
  const fnMatch = /^([A-Za-z]+)\(([^()]*)\)$/.exec(trimmed);
  if (fnMatch) {
    const fn = fnMatch[1].toUpperCase();
    const values = evaluateRange(fnMatch[2], rows, stack);
    if (fn === 'SUM') return values.reduce((a, b) => a + b, 0);
    if (fn === 'AVERAGE' || fn === 'AVG')
      return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
    if (fn === 'MIN') return values.length ? Math.min(...values) : 0;
    if (fn === 'MAX') return values.length ? Math.max(...values) : 0;
    if (fn === 'COUNT') return values.length;
  }
  const substituted = trimmed.replace(/[A-Za-z]+[0-9]+/g, (ref) => {
    const parsed = parseCellRef(ref);
    if (!parsed) return '0';
    return String(evaluateCell(rows, parsed.row, parsed.col, stack));
  });
  return evaluateArithmetic(substituted);
}

// `stack` guards against a formula that (directly or transitively)
// references its own cell - without it a cycle would recurse forever.
function evaluateCell(rows: TableRow[], row: number, col: number, stack: Set<string>): number {
  const key = `${row}:${col}`;
  if (stack.has(key)) return 0;
  const raw = (rows[row]?.cells[col] ?? '').trim();
  if (!raw) return 0;
  if (raw.startsWith('=')) {
    stack.add(key);
    const result = evaluateFormula(raw.slice(1), rows, stack);
    stack.delete(key);
    return result;
  }
  const n = parseFloat(raw.replace(',', '.'));
  return Number.isNaN(n) ? 0 : n;
}

function displayValueOf(rows: TableRow[], row: number, col: number): string {
  const raw = rows[row]?.cells[col] ?? '';
  if (raw.trim().startsWith('=')) return formatSum(evaluateCell(rows, row, col, new Set()));
  return raw;
}

// Builds one self-contained HTML document from the title + blocks, for
// expo-print's HTML -> PDF (same approach as the scanner's own PDF
// assembly - no native module needed). Images are inlined as base64 data
// URIs since expo-print's WebView renderer can't reliably resolve local
// file:// paths; files/links/sketches fall back to a plain placeholder
// line rather than trying to render them.
async function buildDocumentHtml(title: string, blocks: Block[]): Promise<string> {
  const parts: string[] = [];
  for (const block of blocks) {
    const type = block.type ?? 'paragraph';
    if (type === 'divider') {
      parts.push('<hr/>');
    } else if (type === 'checkbox') {
      const style = block.checked ? 'text-decoration:line-through;opacity:0.6;' : '';
      parts.push(`<p style="margin:4px 0;${style}">${block.checked ? '☑' : '☐'} ${textToHtml(block.text)}</p>`);
    } else if (type === 'bulleted') {
      parts.push(`<ul style="margin:2px 0;"><li>${textToHtml(block.text)}</li></ul>`);
    } else if (type === 'numbered') {
      parts.push(`<ol style="margin:2px 0;"><li>${textToHtml(block.text)}</li></ol>`);
    } else if (type === 'image' && block.imageUri) {
      try {
        const base64 = await LegacyFileSystem.readAsStringAsync(block.imageUri, { encoding: 'base64' });
        parts.push(`<img src="data:image/jpeg;base64,${base64}" style="max-width:100%;margin:8px 0;" />`);
      } catch {
        parts.push('<p>[Зображення]</p>');
      }
    } else if (type === 'file') {
      parts.push(`<p>[Файл: ${escapeHtml(block.fileTitle || block.fileName || '')}]</p>`);
    } else if (type === 'link') {
      parts.push(
        `<p><a href="${escapeHtml(block.linkUrl ?? '')}">${escapeHtml(block.linkTitle || block.linkUrl || '')}</a></p>`
      );
    } else if (type === 'sketch') {
      parts.push('<p>[Малюнок]</p>');
    } else if (type === 'table') {
      const rows = block.tableRows ?? [];
      const rowsHtml = rows
        .map(
          (row, r) =>
            `<tr>${row.cells
              .map(
                (_, c) =>
                  `<td style="border:1px solid #ccc;padding:4px 8px;">${escapeHtml(displayValueOf(rows, r, c))}</td>`
              )
              .join('')}</tr>`
        )
        .join('');
      parts.push(`<table style="border-collapse:collapse;margin:8px 0;">${rowsHtml}</table>`);
    } else if (block.text.trim()) {
      parts.push(`<p style="margin:4px 0;">${textToHtml(block.text)}</p>`);
    }
  }
  return `<html><body style="font-family:-apple-system,sans-serif;padding:24px;">
    <h1>${escapeHtml(title || 'Без назви')}</h1>
    ${parts.join('\n')}
  </body></html>`;
}

// Plain-text equivalent for the .txt export - a table's columns become
// tab-separated so pasting into a spreadsheet still lines up.
function buildDocumentText(title: string, blocks: Block[]): string {
  const lines: string[] = [title || 'Без назви', ''];
  for (const block of blocks) {
    const type = block.type ?? 'paragraph';
    const plain = plainTextOf(block.text);
    if (type === 'divider') {
      lines.push('---');
    } else if (type === 'checkbox') {
      lines.push(`${block.checked ? '[x]' : '[ ]'} ${plain}`);
    } else if (type === 'bulleted') {
      lines.push(`- ${plain}`);
    } else if (type === 'numbered') {
      lines.push(`1. ${plain}`);
    } else if (type === 'file') {
      lines.push(`[Файл: ${block.fileTitle || block.fileName || ''}]`);
    } else if (type === 'link') {
      lines.push(`${block.linkTitle || ''} ${block.linkUrl || ''}`.trim());
    } else if (type === 'sketch') {
      lines.push('[Малюнок]');
    } else if (type === 'table') {
      const rows = block.tableRows ?? [];
      rows.forEach((row, r) => lines.push(row.cells.map((_, c) => displayValueOf(rows, r, c)).join('\t')));
    } else {
      lines.push(plain);
    }
  }
  return lines.join('\n');
}

function sanitizeFileName(name: string): string {
  return name.replace(/[/\\]/g, '-').trim() || 'Без назви';
}

function FormattedText({ segments, defaultColor }: { segments: TextSegment[]; defaultColor: string }) {
  return (
    <>
      {segments.map((seg, i) => {
        const decorations = [seg.underline && 'underline', seg.strikethrough && 'line-through']
          .filter(Boolean)
          .join(' ');
        return (
          <Text
            key={i}
            style={{
              fontWeight: seg.bold ? '700' : '400',
              fontStyle: seg.italic ? 'italic' : 'normal',
              textDecorationLine: (decorations || 'none') as 'none' | 'underline' | 'line-through',
              color: seg.color ?? defaultColor,
              backgroundColor: seg.highlight,
            }}
          >
            {seg.text}
          </Text>
        );
      })}
    </>
  );
}

// Content of a single block: a leading icon (a drag handle normally, or a
// checkbox while select mode is on) and the block's own content, which
// varies by type (see below). Dragging is handled by the wrapping
// SortableBlockRow below, not in here.
type BlockRowProps = {
  item: Block;
  isSelected: boolean;
  isSelectMode: boolean;
  isEditMode: boolean;
  showBoundary: boolean;
  listNumber?: number;
  textVersion: number;
  onChangeText: (id: string, text: string) => void;
  onBackspaceEmpty: (id: string) => void;
  onToggleSelected: (id: string) => void;
  onToggleChecked: (id: string) => void;
  onOpenReminder: (id: string) => void;
  onUpdateBlock: (id: string, patch: Partial<Block>) => void;
  onFocus: (id: string) => void;
  onSelectionChange: (id: string, start: number, end: number) => void;
  onOpenImage: (id: string) => void;
  onToggleImageFit: (id: string) => void;
  onOpenFile: (id: string) => void;
  onDownloadFile: (id: string) => void;
  onOpenFileDatabase: () => void;
  onOpenLink: (url: string) => void;
  onOpenLinkDatabase: (block: Block) => void;
  onOpenSketch: (id: string) => void;
  inputRef: (ref: TextInput | null) => void;
  // null when "Колір паперу" is off, OR for a sticker block specifically -
  // a sticker keeps its own yellow/dark treatment regardless of the
  // document's paper color (see the isSticker comment in types.ts).
  paperColor: ReturnType<typeof colorForDocument> | null;
};

// A simple editable grid - text-only cells (no rich-text markup inside a
// cell), rows all kept the same length as columns are added/removed. The
// sum row is computed here at render time from tableShowSum rather than
// stored, so it can never drift out of sync with edited cells - parses
// each cell as a number (comma or dot decimal), treating anything that
// doesn't parse as 0.
// Spreadsheet-style table: lettered column headers + numbered row gutter
// (so a cell has an address to reference), tap-to-select cells, and a
// formula bar above the grid for typing/editing a cell's raw text - a
// full-width input beats squeezing formula text into a ~80px cell, and
// keeps only one TextInput mounted instead of one per cell (this editor
// has hit real Android keyboard/focus bugs with many TextInputs jammed
// together before, see the sketch editor's text-tool history).
function TableBlockContent({
  block,
  canEdit,
  onUpdate,
}: {
  block: Block;
  canEdit: boolean;
  onUpdate: (patch: Partial<Block>) => void;
}) {
  const rows = block.tableRows && block.tableRows.length > 0 ? block.tableRows : [{ cells: ['', ''] }];
  const columnCount = rows[0]?.cells.length ?? 0;
  const [selected, setSelected] = useState<{ r: number; c: number } | null>(null);
  // Whether the formula bar currently holds keyboard focus - reliable now
  // that the grid's ScrollView has keyboardShouldPersistTaps="always"
  // (tapping a cell no longer blurs the bar first), unlike when this only
  // gated on the cell's raw text: that trapped a user on a formula cell
  // forever, since every formula's text starts with "=" and there was no
  // way to tell "still composing" from "done, tap normally now".
  const [formulaFocused, setFormulaFocused] = useState(false);
  const formulaInputRef = useRef<TextInput>(null);

  function selectCell(r: number, c: number) {
    setSelected({ r, c });
    formulaInputRef.current?.focus();
  }

  function setCell(r: number, c: number, value: string) {
    const next = rows.map((row) => ({ cells: [...row.cells] }));
    next[r].cells[c] = value;
    onUpdate({ tableRows: next });
  }

  // Excel-style tap-to-reference: while actively composing a formula
  // (formula bar focused and the selected cell's own text is already
  // "=..."), tapping another cell appends that cell's address instead of
  // jumping the selection there - so building "=SUM(A1:A3)" is type
  // "=SUM(", tap A1, type ":", tap A3, type ")" rather than typing every
  // cell address by hand. The formula bar's own checkmark/"Done" key ends
  // this mode so a finished formula can be left behind to select and edit
  // other cells normally.
  function handleCellPress(r: number, c: number) {
    if (!canEdit) return;
    if (selected && formulaFocused) {
      const currentRaw = rows[selected.r]?.cells[selected.c] ?? '';
      if (currentRaw.trim().startsWith('=')) {
        setCell(selected.r, selected.c, currentRaw + columnLetter(c) + String(r + 1));
        formulaInputRef.current?.focus();
        return;
      }
    }
    selectCell(r, c);
  }

  function confirmFormula() {
    formulaInputRef.current?.blur();
  }

  function addRow() {
    onUpdate({
      tableRows: [...rows.map((row) => ({ cells: [...row.cells] })), { cells: Array(columnCount).fill('') }],
    });
  }

  function addColumn() {
    onUpdate({ tableRows: rows.map((row) => ({ cells: [...row.cells, ''] })) });
  }

  function removeRow(r: number) {
    if (rows.length <= 1) return;
    if (selected?.r === r) setSelected(null);
    onUpdate({ tableRows: rows.filter((_, i) => i !== r) });
  }

  // Appends a real total row with an actual =SUM(...) formula per
  // column, rather than a separate virtual display-only row - it's just
  // another editable row, so it can be edited or deleted like any other.
  function addSumRow() {
    const lastRow = rows.length;
    const sumCells = Array.from({ length: columnCount }, (_, c) => {
      const letter = columnLetter(c);
      return `=SUM(${letter}1:${letter}${lastRow})`;
    });
    onUpdate({ tableRows: [...rows.map((row) => ({ cells: [...row.cells] })), { cells: sumCells }] });
  }

  const selectedRaw = selected ? rows[selected.r]?.cells[selected.c] ?? '' : '';

  return (
    <View style={styles.tableBlock}>
      {canEdit && (
        <View style={styles.tableFormulaBar}>
          <View style={styles.tableFormulaRefBadge}>
            <Text style={styles.tableFormulaRefText}>
              {selected ? `${columnLetter(selected.c)}${selected.r + 1}` : '—'}
            </Text>
          </View>
          <TextInput
            ref={formulaInputRef}
            style={styles.tableFormulaInput}
            value={selectedRaw}
            editable={canEdit}
            onChangeText={(value) => selected && setCell(selected.r, selected.c, value)}
            onFocus={() => setFormulaFocused(true)}
            onBlur={() => setFormulaFocused(false)}
            placeholder={selected ? 'Значення або =SUM(A1:A3)' : 'Виберіть клітинку'}
            placeholderTextColor="#9CA3AF"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={confirmFormula}
            blurOnSubmit
          />
          {formulaFocused && (
            <Pressable hitSlop={8} onPress={confirmFormula} style={styles.tableFormulaDoneButton}>
              <Ionicons name="checkmark" size={18} color="#fff" />
            </Pressable>
          )}
        </View>
      )}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="always">
        <View>
          <View style={styles.tableHeaderRow}>
            <View style={styles.tableGutterCell} />
            {Array.from({ length: columnCount }, (_, c) => (
              <View key={c} style={styles.tableColumnHeaderCell}>
                <Text style={styles.tableColumnHeaderText}>{columnLetter(c)}</Text>
              </View>
            ))}
          </View>
          {rows.map((row, r) => (
            <View key={r} style={styles.tableRow}>
              <View style={styles.tableGutterCell}>
                <Text style={styles.tableGutterText}>{r + 1}</Text>
              </View>
              {row.cells.map((_, c) => {
                const isSelected = selected?.r === r && selected?.c === c;
                return (
                  <Pressable
                    key={c}
                    style={[styles.tableCell, isSelected && styles.tableCellSelected]}
                    onPress={() => handleCellPress(r, c)}
                  >
                    <Text style={styles.tableCellText} numberOfLines={1}>
                      {displayValueOf(rows, r, c)}
                    </Text>
                  </Pressable>
                );
              })}
              {canEdit && rows.length > 1 && (
                <Pressable hitSlop={8} onPress={() => removeRow(r)} style={styles.tableRowRemove}>
                  <Ionicons name="close" size={14} color="#9CA3AF" />
                </Pressable>
              )}
            </View>
          ))}
        </View>
      </ScrollView>
      {canEdit && (
        <View style={styles.tableControls}>
          <Pressable style={styles.tableControlBtn} onPress={addRow}>
            <Ionicons name="add" size={14} color="#6B7280" />
            <Text style={styles.tableControlLabel}>Рядок</Text>
          </Pressable>
          <Pressable style={styles.tableControlBtn} onPress={addColumn}>
            <Ionicons name="add" size={14} color="#6B7280" />
            <Text style={styles.tableControlLabel}>Колонка</Text>
          </Pressable>
          <Pressable style={styles.tableControlBtn} onPress={addSumRow}>
            <Ionicons name="calculator-outline" size={14} color="#6B7280" />
            <Text style={styles.tableControlLabel}>Підсумок</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

function BlockRow({
  item,
  isSelected,
  isSelectMode,
  isEditMode,
  showBoundary,
  listNumber,
  textVersion,
  onChangeText,
  onBackspaceEmpty,
  onToggleSelected,
  onToggleChecked,
  onOpenReminder,
  onUpdateBlock,
  onFocus,
  onSelectionChange,
  onOpenImage,
  onToggleImageFit,
  onOpenFile,
  onDownloadFile,
  onOpenFileDatabase,
  onOpenLink,
  onOpenLinkDatabase,
  onOpenSketch,
  inputRef,
  paperColor,
}: BlockRowProps) {
  // Outside edit mode (or while selecting), the text field is completely
  // inert to touch (pointerEvents: 'none') rather than merely
  // non-editable - a TextInput that can still receive touches keeps
  // claiming them for cursor placement even when non-editable, which is
  // exactly what was blocking swipe-to-scroll over blocks. With no
  // TextInput to compete with, a swipe anywhere reaches the ScrollView
  // just like it already did over the icon column.
  const canEditText = isEditMode && !isSelectMode;
  const type = item.type ?? 'paragraph';
  // A sticker keeps its own yellow regardless of the document's paper
  // color - see BlockRowProps.paperColor.
  const rowPaperColor = item.isSticker ? null : paperColor;

  // A file/image block only ever stores a local URI - Android can purge app
  // cache under storage pressure, and a different device never had it in
  // the first place. useCachedAttachment checks on each mount (not just
  // trusting that attaching it once succeeded) and quietly re-downloads
  // from the Drive backup when there is one, so the badge below is an
  // honest confirmation rather than a decoration that's still green after
  // the file is actually gone.
  const fileCacheStatus = useCachedAttachment(type === 'file' ? item.fileUri : undefined, item.driveFileId);
  const imageCacheStatus = useCachedAttachment(type === 'image' ? item.imageUri : undefined, item.driveFileId);

  let content: ReactNode;
  if (type === 'divider') {
    content = <View style={styles.dividerLine} />;
  } else if (type === 'image') {
    // 'contain' keeps the photo's real proportions, with any leftover space
    // in the fixed-height box showing the box's own pale gray background
    // instead of cropping the image; 'cover' fills the box entirely,
    // cropping whatever doesn't fit. The small corner button switches
    // between the two per image.
    const fit = item.imageFit ?? 'contain';
    content = !item.imageUri ? (
      <Text style={styles.blockPlaceholder}>Немає зображення</Text>
    ) : imageCacheStatus === 'restoring' || imageCacheStatus === 'checking' ? (
      <View style={[styles.blockImageWrap, styles.attachmentStatusBox]}>
        <ActivityIndicator color="#9CA3AF" />
        {imageCacheStatus === 'restoring' && <Text style={styles.attachmentStatusLabel}>Відновлення з Диску…</Text>}
      </View>
    ) : imageCacheStatus === 'missing' ? (
      <View style={[styles.blockImageWrap, styles.attachmentStatusBox]}>
        <Ionicons name="cloud-offline-outline" size={22} color="#9CA3AF" />
        <Text style={styles.attachmentStatusLabel}>Недоступно на цьому пристрої</Text>
      </View>
    ) : (
      <View style={styles.blockImageWrap}>
        <Pressable
          disabled={isSelectMode}
          onPress={() => onOpenImage(item.id)}
          style={styles.blockImageTap}
        >
          <Image source={{ uri: item.imageUri }} style={styles.blockImage} resizeMode={fit} />
        </Pressable>
        {!isSelectMode && (
          <Pressable
            hitSlop={8}
            style={styles.imageFitToggle}
            onPress={() => onToggleImageFit(item.id)}
          >
            <Ionicons name={fit === 'contain' ? 'crop-outline' : 'contract-outline'} size={16} color="#fff" />
          </Pressable>
        )}
      </View>
    );
  } else if (type === 'sketch') {
    // viewBox reuses the exact canvas size the elements were captured
    // against (see SketchEditor) so the drawing scales correctly here
    // regardless of how much smaller this preview box is.
    const elements = item.sketchElements ?? [];
    const vbWidth = item.sketchWidth || 1;
    const vbHeight = item.sketchHeight || 1;
    content = (
      <Pressable
        disabled={isSelectMode}
        onPress={() => onOpenSketch(item.id)}
        style={styles.blockImageWrap}
      >
        {elements.length > 0 ? (
          <Svg width="100%" height="100%" viewBox={`0 0 ${vbWidth} ${vbHeight}`}>
            {elements.map((el, i) =>
              el.kind === 'text' ? (
                <SvgText key={i} x={el.x} y={el.y} fill={el.color} fontSize={el.fontSize}>
                  {el.text}
                </SvgText>
              ) : (
                <Path
                  key={i}
                  d={el.d}
                  stroke={el.color}
                  strokeWidth={el.width}
                  fill="none"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )
            )}
          </Svg>
        ) : (
          <Text style={styles.blockPlaceholder}>Порожній малюнок</Text>
        )}
      </Pressable>
    );
  } else if (type === 'table') {
    content = (
      <TableBlockContent
        block={item}
        canEdit={canEditText}
        onUpdate={(patch) => onUpdateBlock(item.id, patch)}
      />
    );
  } else if (type === 'file') {
    // fileCacheStatus 'restoring' means it was missing locally but is being
    // quietly re-pulled from its Drive backup right now (useCachedAttachment) -
    // 'missing' means either that failed or there never was a backup, in
    // which case opening/downloading it can't work until the device that
    // still has it re-syncs.
    content = (
      <View style={styles.fileBlockRow}>
        <Pressable
          disabled={isSelectMode || fileCacheStatus !== 'ready'}
          onPress={() => onOpenFile(item.id)}
          style={styles.fileBlockTap}
        >
          <View style={styles.fileIconWrap}>
            <Ionicons name={fileIconFor(item.fileName)} size={22} color={fileIconColorFor(item.fileName)} />
            {fileCacheStatus === 'restoring' || fileCacheStatus === 'checking' ? (
              <View style={styles.fileCacheBadge}>
                <ActivityIndicator size="small" color="#fff" style={styles.fileCacheBadgeSpinner} />
              </View>
            ) : (
              <View style={[styles.fileCacheBadge, fileCacheStatus === 'missing' && styles.fileCacheBadgeMissing]}>
                <Ionicons name={fileCacheStatus === 'ready' ? 'checkmark' : 'close'} size={9} color="#fff" />
              </View>
            )}
          </View>
          <Text style={styles.fileBlockName} numberOfLines={1}>
            {item.fileName ?? 'Файл'}
          </Text>
          {fileCacheStatus === 'missing' && <Text style={styles.attachmentStatusLabel}>Недоступно тут</Text>}
        </Pressable>
        {!isSelectMode && (
          <>
            <Pressable hitSlop={8} onPress={onOpenFileDatabase} style={styles.fileDbButton}>
              <Ionicons name="server-outline" size={16} color="#6B7280" />
            </Pressable>
            {fileCacheStatus === 'ready' && (
              <Pressable hitSlop={8} onPress={() => onDownloadFile(item.id)}>
                <Ionicons name="download-outline" size={18} color="#6B7280" />
              </Pressable>
            )}
          </>
        )}
      </View>
    );
  } else if (type === 'link') {
    // Three visual variants (matching the approved mockup): a big-thumbnail
    // YouTube/TikTok card with a play badge, a smaller side-thumbnail
    // generic card, and a compact icon-only card when there's no preview
    // image (geo links, or any fetch that came back empty). Each variant is
    // an outer View holding two SIBLING Pressables (not one nested inside
    // the other, same trick as the image block's corner buttons) - the main
    // one opens the URL, the small "database" icon jumps to this link's
    // entry in its Links database screen instead.
    const url = item.linkUrl ?? item.text;
    const isVideo = (item.linkSiteName ?? '').includes('YouTube') || (item.linkSiteName ?? '').includes('TikTok');
    const isGeo = item.linkSiteName === 'Геоточка';
    if (isVideo && item.linkImageUrl) {
      content = (
        <View style={styles.linkCardVideo}>
          <Pressable disabled={isSelectMode} onPress={() => onOpenLink(url)}>
            <View style={styles.linkVideoThumbWrap}>
              <Image source={{ uri: item.linkImageUrl }} style={styles.linkVideoThumb} resizeMode="cover" />
              <View style={styles.linkPlayBadge}>
                <Ionicons name="play" size={18} color="#fff" />
              </View>
            </View>
            <View style={styles.linkCardBody}>
              <Text style={styles.linkCardTitle} numberOfLines={2}>
                {item.linkTitle || url}
              </Text>
              {!!item.linkSiteName && (
                <Text style={styles.linkCardCaption} numberOfLines={1}>
                  {item.linkSiteName}
                </Text>
              )}
            </View>
          </Pressable>
          {!isSelectMode && (
            <Pressable
              hitSlop={6}
              style={styles.linkDbButtonVideo}
              onPress={() => onOpenLinkDatabase(item)}
            >
              <Ionicons name="server-outline" size={14} color="#fff" />
            </Pressable>
          )}
        </View>
      );
    } else if (item.linkImageUrl) {
      content = (
        <View style={styles.linkCardGeneric}>
          <Pressable disabled={isSelectMode} onPress={() => onOpenLink(url)} style={styles.linkCardGenericTap}>
            <Image source={{ uri: item.linkImageUrl }} style={styles.linkGenericThumb} resizeMode="cover" />
            <View style={[styles.linkCardBody, styles.linkCardBodyWithDbButton]}>
              <Text style={styles.linkCardTitle} numberOfLines={2}>
                {item.linkTitle || url}
              </Text>
              {!!item.linkSiteName && (
                <Text style={styles.linkCardCaption} numberOfLines={1}>
                  {item.linkSiteName}
                </Text>
              )}
            </View>
          </Pressable>
          {!isSelectMode && (
            <Pressable
              hitSlop={6}
              style={styles.linkDbButtonGeneric}
              onPress={() => onOpenLinkDatabase(item)}
            >
              <Ionicons name="server-outline" size={14} color="#6B7280" />
            </Pressable>
          )}
        </View>
      );
    } else {
      content = (
        <View style={styles.linkCardCompact}>
          <Pressable disabled={isSelectMode} onPress={() => onOpenLink(url)} style={styles.linkCardCompactTap}>
            <View style={[styles.linkCompactIcon, isGeo && styles.linkCompactIconGeo]}>
              <Ionicons name={isGeo ? 'location-outline' : 'link-outline'} size={18} color={isGeo ? '#16A34A' : ACCENT} />
            </View>
            <Text style={styles.linkCompactText} numberOfLines={1}>
              {item.linkTitle || item.linkSiteName || url}
            </Text>
          </Pressable>
          {!isSelectMode && (
            <Pressable hitSlop={6} onPress={() => onOpenLinkDatabase(item)} style={styles.linkDbButtonCompact}>
              <Ionicons name="server-outline" size={16} color="#9CA3AF" />
            </Pressable>
          )}
        </View>
      );
    }
  } else {
    const textField = canEditText ? (
      <TextInput
        // Android's TextInput doesn't reliably pick up a dynamic `editable`
        // change on an already-mounted view; keying on canEditText forces
        // a clean remount so the native EditText is created with the
        // correct editable/pointerEvents state instead of getting stuck
        // non-editable. textVersion is folded in too - see its declaration
        // for why (avoids a transient grow/shrink flicker on Enter-split).
        key={`editable-${textVersion}`}
        ref={inputRef}
        value={item.text}
        onChangeText={(text) => onChangeText(item.id, text)}
        onFocus={() => onFocus(item.id)}
        onSelectionChange={({ nativeEvent }) =>
          onSelectionChange(item.id, nativeEvent.selection.start, nativeEvent.selection.end)
        }
        onKeyPress={({ nativeEvent }) => {
          if (nativeEvent.key === 'Backspace' && item.text === '') {
            onBackspaceEmpty(item.id);
          }
        }}
        placeholder={type === 'checkbox' ? 'Завдання…' : '…'}
        placeholderTextColor={rowPaperColor?.textMuted}
        style={[styles.blockInput, item.checked && styles.checkedText, rowPaperColor && { color: rowPaperColor.text }]}
        multiline
      />
    ) : (
      // Outside edit mode, formatting markers (**bold** etc.) are parsed
      // into styled runs instead of showing as raw text - and a plain
      // Text has no touch handling of its own to fight the ScrollView.
      <View key="locked" style={styles.blockInput} pointerEvents="none">
        <Text style={[styles.blockDisplayText, item.checked && styles.checkedText]}>
          {item.text ? (
            <FormattedText
              segments={parseFormattedText(item.text)}
              defaultColor={rowPaperColor?.text ?? '#111827'}
            />
          ) : (
            <Text style={[styles.blockPlaceholder, rowPaperColor && { color: rowPaperColor.textMuted }]}>…</Text>
          )}
        </Text>
      </View>
    );

    if (type === 'bulleted' || type === 'numbered') {
      content = (
        <View style={styles.prefixedRow}>
          <Text style={styles.bulletMark}>{type === 'numbered' ? `${listNumber ?? 1}.` : '•'}</Text>
          {textField}
        </View>
      );
    } else if (type === 'checkbox') {
      const reminderLabel = formatReminderBadge(item);
      content = (
        <View style={styles.checkboxBlock}>
        <View style={styles.prefixedRow}>
          <Pressable hitSlop={8} onPress={() => onToggleChecked(item.id)}>
            <Ionicons
              name={item.checked ? 'checkbox' : 'square-outline'}
              size={20}
              color={item.checked ? ACCENT : '#9CA3AF'}
            />
          </Pressable>
          {textField}
        </View>
        {!isSelectMode && (
          <Pressable style={styles.checkboxReminderRow} hitSlop={4} onPress={() => onOpenReminder(item.id)}>
            <Ionicons name="alarm-outline" size={11} color={reminderLabel ? ACCENT : '#9CA3AF'} />
            <Text style={[styles.checkboxReminderText, !reminderLabel && styles.checkboxReminderTextEmpty]}>
              {reminderLabel ?? 'Нагадування'}
            </Text>
          </Pressable>
        )}
        </View>
      );
    } else {
      content = textField;
    }
  }

  return (
    <View
      style={[
        styles.blockRow,
        isSelected && styles.blockRowSelected,
        showBoundary && styles.blockRowBoundary,
        // A sticker keeps its yellow background even once placed here -
        // agreed explicitly: it should stay visibly "a sticker", not blend
        // in as an ordinary paragraph/image/sketch block.
        item.isSticker && styles.blockRowSticker,
        // Blends the row into the colored page instead of keeping its own
        // white card look - skipped while selected, whose own light-blue
        // highlight is a stronger, more important affordance than the
        // paper color. showBoundary only draws a border (see
        // blockRowBoundary), so it stays visible over the transparent fill.
        rowPaperColor && !isSelected && { backgroundColor: 'transparent' },
      ]}
    >
      {content}
      {/* On the right, under the header's select-mode toggle (also on the
          right) so the two read as one control. */}
      <Pressable
        hitSlop={8}
        disabled={!isSelectMode}
        onPress={() => onToggleSelected(item.id)}
        style={styles.dragHandle}
      >
        <Ionicons
          name={isSelectMode ? (isSelected ? 'checkmark-circle' : 'ellipse-outline') : 'reorder-two-outline'}
          size={isSelectMode ? 26 : 20}
          color={isSelected ? ACCENT : '#9CA3AF'}
        />
      </Pressable>
    </View>
  );
}

// react-native-draggable-flatlist AND react-native-swipeable-item both
// have the same underlying assumption: they render their content inside a
// `flex: 1` view expecting a parent with an already-known fixed height
// (like a standard FlatList row). Our blocks have variable-height text, so
// nothing here ever gives them that fixed height, and `flex: 1` inside an
// auto-height parent collapses to 0 - blocks existed in state but were
// invisible. So drag-to-reorder is hand-built directly on gesture-handler:
// a plain View per block (no virtualization, fine for a single document's
// block count), each row's position measured via onLayout, and a
// long-press-then-pan gesture. The dragged row itself never moves during
// the gesture (and the array isn't touched until release) - only a thin
// "drop line" indicator (rendered by the parent BlockList) snaps between
// rows to show where it will land, which is what actually feels smooth,
// instead of live-reordering + re-animating the whole list on every frame.
type SortableBlockRowProps = {
  item: Block;
  isSelected: boolean;
  isSelectMode: boolean;
  isEditMode: boolean;
  isDragging: boolean;
  isDragActive: boolean;
  compressTowardOffset: number;
  listNumber?: number;
  textVersion: number;
  onLayout: (e: LayoutChangeEvent) => void;
  onDragStart: () => void;
  onDragUpdate: (translationY: number) => void;
  onDragEnd: () => void;
  onToggleSelected: (id: string) => void;
  onToggleChecked: (id: string) => void;
  onOpenReminder: (id: string) => void;
  onUpdateBlock: (id: string, patch: Partial<Block>) => void;
  onChangeText: (id: string, text: string) => void;
  onBackspaceEmpty: (id: string) => void;
  onFocus: (id: string) => void;
  onSelectionChange: (id: string, start: number, end: number) => void;
  onOpenImage: (id: string) => void;
  onToggleImageFit: (id: string) => void;
  onOpenFile: (id: string) => void;
  onDownloadFile: (id: string) => void;
  onOpenFileDatabase: () => void;
  onOpenLink: (url: string) => void;
  onOpenLinkDatabase: (block: Block) => void;
  onOpenSketch: (id: string) => void;
  inputRef: (ref: TextInput | null) => void;
  paperColor: ReturnType<typeof colorForDocument> | null;
};

function SortableBlockRow({
  item,
  isSelected,
  isSelectMode,
  isEditMode,
  isDragging,
  isDragActive,
  compressTowardOffset,
  listNumber,
  textVersion,
  onLayout,
  onDragStart,
  onDragUpdate,
  onDragEnd,
  onToggleSelected,
  onToggleChecked,
  onOpenReminder,
  onUpdateBlock,
  onChangeText,
  onBackspaceEmpty,
  onFocus,
  onSelectionChange,
  onOpenImage,
  onToggleImageFit,
  onOpenFile,
  onDownloadFile,
  onOpenFileDatabase,
  onOpenLink,
  onOpenLinkDatabase,
  onOpenSketch,
  inputRef,
  paperColor,
}: SortableBlockRowProps) {
  // This gesture's whole job is JS-side (finding the nearest gap, updating
  // React state) - there's no per-frame UI-thread animation to protect
  // here, so it runs plainly on the JS thread instead of being wrapped in
  // worklet/runOnJS ceremony for no benefit.
  const dragGesture = Gesture.Pan()
    .activateAfterLongPress(DRAG_LONG_PRESS_MS)
    .runOnJS(true)
    .onStart(() => onDragStart())
    .onUpdate((e) => onDragUpdate(e.translationY))
    .onEnd(() => onDragEnd());

  // TextInput has its own native touch handling (cursor placement, text
  // selection) that otherwise wins the race for any touch starting on the
  // text itself. Gesture.Native() + Simultaneous tells gesture-handler to
  // let our gesture and the TextInput's own handling run at the same time
  // instead of waiting for one to fail before trying the other. This
  // operates below React Native's own pointerEvents, so it has to be left
  // out of the composition entirely outside edit mode - otherwise it keeps
  // deferring to the text field's native touch handling even though that
  // field is pointerEvents: 'none', which is exactly what was still
  // blocking the ScrollView from ever seeing a swipe over a block.
  const canEditText = isEditMode && !isSelectMode;
  const gesture = canEditText ? Gesture.Simultaneous(dragGesture, Gesture.Native()) : dragGesture;

  // Every row currently being dragged - whether it's the one lone block or
  // one of several in a multi-select bulk move - eases toward faded and
  // squashed while the gesture is in progress, echoing the "being pulled
  // into the drop line" idea, and eases back once it's released.
  // compressTowardOffset (0 for the anchor itself) also slides each of the
  // OTHER selected rows toward the anchor's center as it shrinks, so a
  // multi-select group visibly converges on the block that was actually
  // long-pressed instead of each row just collapsing into its own middle.
  const compress = useSharedValue(0);
  useEffect(() => {
    compress.value = withTiming(isDragging ? 1 : 0, { duration: 150 });
  }, [isDragging]);
  const compressStyle = useAnimatedStyle(() => ({
    opacity: 1 - compress.value * 0.65,
    transform: [
      { translateY: compressTowardOffset * compress.value },
      { scaleY: 1 - compress.value * 0.8 },
    ],
  }));

  return (
    <View onLayout={onLayout}>
      <GestureDetector gesture={gesture}>
        <Animated.View style={compressStyle}>
          <BlockRow
            item={item}
            isSelected={isSelected}
            isSelectMode={isSelectMode}
            isEditMode={isEditMode}
            showBoundary={isDragActive}
            paperColor={paperColor}
            listNumber={listNumber}
            textVersion={textVersion}
            onChangeText={onChangeText}
            onBackspaceEmpty={onBackspaceEmpty}
            onToggleSelected={onToggleSelected}
            onToggleChecked={onToggleChecked}
            onOpenReminder={onOpenReminder}
            onUpdateBlock={onUpdateBlock}
            onFocus={onFocus}
            onSelectionChange={onSelectionChange}
            onOpenImage={onOpenImage}
            onToggleImageFit={onToggleImageFit}
            onOpenFile={onOpenFile}
            onDownloadFile={onDownloadFile}
            onOpenFileDatabase={onOpenFileDatabase}
            onOpenLink={onOpenLink}
            onOpenLinkDatabase={onOpenLinkDatabase}
            onOpenSketch={onOpenSketch}
            inputRef={inputRef}
          />
        </Animated.View>
      </GestureDetector>
    </View>
  );
}
type BlockListProps = {
  blocks: Block[];
  onReorder: (blocks: Block[]) => void;
  selectedIds: Set<string>;
  isSelectMode: boolean;
  isEditMode: boolean;
  textVersions: Record<string, number>;
  onToggleSelected: (id: string) => void;
  onToggleChecked: (id: string) => void;
  onOpenReminder: (id: string) => void;
  onUpdateBlock: (id: string, patch: Partial<Block>) => void;
  onChangeText: (id: string, text: string) => void;
  onBackspaceEmpty: (id: string) => void;
  onFocus: (id: string) => void;
  onSelectionChange: (id: string, start: number, end: number) => void;
  onOpenImage: (id: string) => void;
  onToggleImageFit: (id: string) => void;
  onOpenFile: (id: string) => void;
  onDownloadFile: (id: string) => void;
  onOpenFileDatabase: () => void;
  onOpenLink: (url: string) => void;
  onOpenLinkDatabase: (block: Block) => void;
  onOpenSketch: (id: string) => void;
  onInputRef: (id: string, ref: TextInput | null) => void;
  paperColor: ReturnType<typeof colorForDocument> | null;
};

function BlockList({
  blocks,
  onReorder,
  selectedIds,
  isSelectMode,
  isEditMode,
  textVersions,
  onToggleSelected,
  onToggleChecked,
  onOpenReminder,
  onUpdateBlock,
  onChangeText,
  onBackspaceEmpty,
  onFocus,
  onSelectionChange,
  onOpenImage,
  onToggleImageFit,
  onOpenFile,
  onDownloadFile,
  onOpenFileDatabase,
  onOpenLink,
  onOpenLinkDatabase,
  onOpenSketch,
  onInputRef,
  paperColor,
}: BlockListProps) {
  const [draggingIds, setDraggingIds] = useState<string[] | null>(null);
  // The block actually long-pressed to start the drag - the rest of a
  // multi-select group should visually collapse toward this one, not each
  // toward its own separate center.
  const [dragAnchorId, setDragAnchorId] = useState<string | null>(null);
  const [insertIndex, setInsertIndexState] = useState<number | null>(null);
  const insertIndexRef = useRef<number | null>(null);
  const dropLineY = useSharedValue(0);
  // Extra horizontal inset applied to the drop line while it's actively
  // being dragged between gaps (making it "trохи коротшою" / a bit
  // shorter); it eases back to 0 (full width) as part of the final settle.
  const dropLineInset = useSharedValue(0);
  const rowLayouts = useRef<Record<string, { y: number; height: number }>>({});
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  function setInsertIndex(index: number | null) {
    insertIndexRef.current = index;
    setInsertIndexState(index);
  }

  function handleRowLayout(id: string, e: LayoutChangeEvent) {
    rowLayouts.current[id] = {
      y: e.nativeEvent.layout.y,
      height: e.nativeEvent.layout.height,
    };
  }

  // Y position of the "gap" before the block that would sit at `index`
  // within the list of NON-dragged blocks (or after the last one, if index
  // is past the end) - where the drop-line sits. Dragged blocks (a single
  // one, or a whole multi-select group) never move during the gesture, so
  // this always reads straight from their last measured, still-accurate
  // layout.
  function gapYFor(index: number, draggingSet: Set<string>): number {
    const remaining = blocksRef.current.filter((b) => !draggingSet.has(b.id));
    if (remaining.length === 0) return 0;
    if (index <= 0) return rowLayouts.current[remaining[0].id]?.y ?? 0;
    if (index >= remaining.length) {
      const last = remaining[remaining.length - 1];
      const rl = rowLayouts.current[last.id];
      return rl ? rl.y + rl.height : 0;
    }
    return rowLayouts.current[remaining[index].id]?.y ?? 0;
  }

  // How many non-dragged blocks have their midpoint above this Y - i.e.
  // where the dragged block(s) would land among the OTHER blocks if
  // dropped now. Nothing is actually reordered until the gesture ends.
  function computeInsertIndex(currentY: number, draggingSet: Set<string>): number {
    const list = blocksRef.current;
    let index = 0;
    for (let i = 0; i < list.length; i++) {
      if (draggingSet.has(list[i].id)) continue;
      const rl = rowLayouts.current[list[i].id];
      if (!rl) continue;
      if (currentY > rl.y + rl.height / 2) {
        index++;
      }
    }
    return index;
  }

  // A long-press on a block that's part of a multi-selection (2+ selected)
  // drags the whole selected group together, in their existing relative
  // order; otherwise it's just that one block, same as before select mode
  // and bulk move existed.
  function dragGroupFor(anchorId: string): string[] {
    if (isSelectMode && selectedIds.has(anchorId) && selectedIds.size > 1) {
      return blocksRef.current.filter((b) => selectedIds.has(b.id)).map((b) => b.id);
    }
    return [anchorId];
  }

  function handleDragStart(anchorId: string, ids: string[]) {
    setDraggingIds(ids);
    setDragAnchorId(anchorId);
    const layout = rowLayouts.current[anchorId];
    const draggingSet = new Set(ids);
    const currentIndex = layout
      ? computeInsertIndex(layout.y + layout.height / 2, draggingSet)
      : 0;
    setInsertIndex(currentIndex);
    dropLineY.value = gapYFor(currentIndex, draggingSet);
    dropLineInset.value = withTiming(14, { duration: 150 });
  }

  function handleDragUpdate(anchorId: string, ids: string[], translationY: number) {
    const layout = rowLayouts.current[anchorId];
    if (!layout) return;
    const draggingSet = new Set(ids);
    const currentY = layout.y + translationY + layout.height / 2;
    const targetIndex = computeInsertIndex(currentY, draggingSet);
    if (targetIndex !== insertIndexRef.current) {
      setInsertIndex(targetIndex);
      // overshootClamping stops it swinging past the target and settling
      // back - the "rocking like a boat" feeling - while keeping the same
      // eased, springy deceleration on the way there. The little bounce the
      // user actually wants only happens once, at the very end of the drag
      // (see handleDragEnd), not on every one of these mid-drag snaps.
      dropLineY.value = withSpring(gapYFor(targetIndex, draggingSet), {
        damping: 26,
        stiffness: 260,
        overshootClamping: true,
      });
    }
  }

  function commitReorder(ids: string[]) {
    const targetIndex = insertIndexRef.current;
    const list = blocksRef.current;
    if (targetIndex !== null) {
      const draggingSet = new Set(ids);
      const draggedBlocks = list.filter((b) => draggingSet.has(b.id));
      const remaining = list.filter((b) => !draggingSet.has(b.id));
      const next = [...remaining];
      next.splice(targetIndex, 0, ...draggedBlocks);
      const changed = next.some((b, i) => b.id !== list[i]?.id);
      if (changed) {
        LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
        onReorder(next);
      }
    }
    setDraggingIds(null);
    setDragAnchorId(null);
    setInsertIndex(null);
  }

  // How far (in px) this row needs to travel to visually converge on the
  // anchor row's center - 0 for the anchor itself, and 0 for anything not
  // currently part of the drag. Layouts are stable during a drag (nothing
  // moves until release), so this stays constant for the gesture's duration.
  function compressOffsetFor(id: string): number {
    if (!dragAnchorId || !draggingIds?.includes(id)) return 0;
    const anchorLayout = rowLayouts.current[dragAnchorId];
    const thisLayout = rowLayouts.current[id];
    if (!anchorLayout || !thisLayout) return 0;
    const anchorCenter = anchorLayout.y + anchorLayout.height / 2;
    const thisCenter = thisLayout.y + thisLayout.height / 2;
    return anchorCenter - thisCenter;
  }

  function handleDragEnd(ids: string[]) {
    dropLineInset.value = withTiming(0, { duration: 200 });
    // A synthetic velocity makes the spring overshoot its target and settle
    // back even though it's often already resting there (no natural
    // distance left to travel) - a small, deliberate "landing" bounce that
    // only plays once, here, instead of on every mid-drag snap above.
    const targetIndex = insertIndexRef.current;
    const draggingSet = new Set(ids);
    dropLineY.value = withSpring(
      gapYFor(targetIndex ?? 0, draggingSet),
      { damping: 12, stiffness: 300, velocity: 260 },
      (finished) => {
        if (finished) runOnJS(commitReorder)(ids);
      }
    );
  }

  const dropLineStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: dropLineY.value - 2 }],
    left: 8 + dropLineInset.value,
    right: 8 + dropLineInset.value,
  }));

  // Numbering restarts after any non-numbered block breaks the run, like a
  // real numbered list rather than a permanently incrementing counter.
  let runningNumber = 0;

  return (
    <View style={styles.blockListContainer}>
      {blocks.map((item, index) => {
        if (item.type === 'numbered') {
          runningNumber = index > 0 && blocks[index - 1].type === 'numbered' ? runningNumber + 1 : 1;
        } else {
          runningNumber = 0;
        }
        return (
        <SortableBlockRow
          key={item.id}
          item={item}
          isSelected={selectedIds.has(item.id)}
          isSelectMode={isSelectMode}
          isEditMode={isEditMode}
          isDragging={draggingIds?.includes(item.id) ?? false}
          isDragActive={draggingIds !== null}
          listNumber={item.type === 'numbered' ? runningNumber : undefined}
          textVersion={textVersions[item.id] ?? 0}
          compressTowardOffset={compressOffsetFor(item.id)}
          onLayout={(e) => handleRowLayout(item.id, e)}
          onDragStart={() => handleDragStart(item.id, dragGroupFor(item.id))}
          onDragUpdate={(translationY) =>
            handleDragUpdate(item.id, dragGroupFor(item.id), translationY)
          }
          onDragEnd={() => handleDragEnd(dragGroupFor(item.id))}
          onToggleSelected={onToggleSelected}
          onToggleChecked={onToggleChecked}
          onOpenReminder={onOpenReminder}
          onUpdateBlock={onUpdateBlock}
          onChangeText={onChangeText}
          onBackspaceEmpty={onBackspaceEmpty}
          onFocus={onFocus}
          onSelectionChange={onSelectionChange}
          onOpenImage={onOpenImage}
          onToggleImageFit={onToggleImageFit}
          onOpenFile={onOpenFile}
          onDownloadFile={onDownloadFile}
          onOpenFileDatabase={onOpenFileDatabase}
          onOpenLink={onOpenLink}
          onOpenLinkDatabase={onOpenLinkDatabase}
          onOpenSketch={onOpenSketch}
          inputRef={(ref) => onInputRef(item.id, ref)}
          paperColor={paperColor}
        />
        );
      })}

      {draggingIds && insertIndex !== null && (
        <Animated.View pointerEvents="none" style={[styles.dropLine, dropLineStyle]} />
      )}
    </View>
  );
}

// Embedded mode (CalendarScreen) mounts this same component inline, below
// its own date header, instead of pushing it as a stack screen - see
// CalendarScreen's own comment on why the daily-note editor is the exact
// same block editor as a regular document rather than a separate one.
// `extraFields` is merged into every autosave write (CalendarScreen passes
// `{ calendarDate }` so a daily note's document carries that field from its
// very first save, without this screen needing to know what a calendar day
// is); `navigation` still has to be the real navigation prop from the
// embedding screen (not a stub) since Links/Photos/Files/Placeholder are
// all pushed from inside here exactly as from a normal document.
type Props =
  | NativeStackScreenProps<RootStackParamList, 'Editor' | 'EditorModal'>
  | {
      embedded: true;
      documentId: string;
      navigation: NativeStackNavigationProp<RootStackParamList>;
      extraFields?: Record<string, unknown>;
      // CalendarScreen owns its own header capsule (select-mode toggle +
      // save checkmark live there now, not in a separate row above the
      // note) and has no other way to reach this instance's internal
      // state - these mirror it out, and the ref below lets it drive the
      // toggle without lifting isSelectMode into two-way controlled props.
      onSelectModeChange?: (isSelectMode: boolean) => void;
      onSaveStatusChange?: (status: 'saved' | 'saving') => void;
    };

export type DocumentEditorHandle = {
  toggleSelectMode: () => void;
};

function DocumentEditorScreen(props: Props, ref: ForwardedRef<DocumentEditorHandle>) {
  const embedded = 'embedded' in props;
  const documentId = 'embedded' in props ? props.documentId : props.route.params.documentId;
  const navigation = props.navigation;
  const extraFields = 'embedded' in props ? (props.extraFields ?? {}) : {};
  const onSelectModeChange = 'embedded' in props ? props.onSelectModeChange : undefined;
  const onSaveStatusChange = 'embedded' in props ? props.onSaveStatusChange : undefined;
  // Only set right after DocumentsScreen creates a brand-new document - see
  // navigation.ts's own comment on this param.
  const autoFocusTitle = !embedded && !!props.route.params.autoFocusTitle;
  const [title, setTitle] = useState('');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  // Cover image and "paper color" (below) - see the "..." menu. Both are
  // local-only settings (no cloud backup for the cover, same as any other
  // image block before its own async Drive upload finishes) and both are
  // skipped entirely in embedded mode (CalendarScreen's daily notes),
  // matching the header/title/tags block right above them.
  const [coverImageUri, setCoverImageUri] = useState<string | undefined>(undefined);
  // Recolors the page to this document's OWN card color (colorForDocument)
  // - the same color already shown for it everywhere else in the app
  // (Documents grid, Files/Links/BoardsList tiles) - rather than a
  // separately-picked color, so a document always has exactly one color
  // identity across the whole app.
  const [paperColorEnabled, setPaperColorEnabled] = useState(false);
  const paperColor = paperColorEnabled ? colorForDocument(documentId) : null;
  // Same `groups` collection DocumentsScreen's own group tabs/bulk-assign
  // use (kind 'document') - this is just a second place to set the same
  // field, so a document doesn't have to be re-selected from the list to
  // be grouped while you're already writing it. Skipped in embedded mode
  // (daily notes), same as cover/paper color above.
  const [groupId, setGroupId] = useState<string | null>(null);
  const [groups, setGroups] = useState<Group[]>([]);
  const [groupPickerVisible, setGroupPickerVisible] = useState(false);
  useEffect(() => {
    if (embedded) return;
    return onSnapshot(query(collection(db, 'groups'), orderBy('name')), (snapshot) => {
      setGroups(
        snapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as { name: string; color: string; kind: string }) }))
          .filter((g) => g.kind === 'document')
      );
    });
  }, [embedded]);
  const { tags, attachTag, detachTag, createAndAttachTag, renameTag } = useTags();
  const { downloadToast, showDownloadToast, dismissDownloadToast } = useDownloadToast();
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);
  const [isEditMode, setIsEditMode] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // The window is drawn edge-to-edge (measured: window height === screen
  // height with the keyboard both up and down), so nothing keeps the
  // pinned toolbar clear of the gesture bar - or of the strip the
  // keyboard's own top row occupies - unless this inset is added by hand.
  const insets = useSafeAreaInsets();
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);
  const [activeSelection, setActiveSelection] = useState<{ blockId: string; start: number; end: number } | null>(
    null
  );
  // The block the pinned toolbar currently acts on - null (title focused,
  // or nothing) hides the bar entirely, since there's no block for its
  // buttons to apply to.
  const [focusedBlockId, setFocusedBlockId] = useState<string | null>(null);
  const [viewerImageId, setViewerImageId] = useState<string | null>(null);
  const [playingVideoUrl, setPlayingVideoUrl] = useState<string | null>(null);
  const [imageRenameId, setImageRenameId] = useState<string | null>(null);
  const [sketchEditorBlockId, setSketchEditorBlockId] = useState<string | null>(null);
  const [existingItemPickerBlockId, setExistingItemPickerBlockId] = useState<string | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  const [reminderBlockId, setReminderBlockId] = useState<string | null>(null);
  const focusIdRef = useRef<string | null>(null);
  const focusToEndRef = useRef(false);
  const focusedBlockIdRef = useRef<string | null>(null);
  // A block whose text gets truncated by splitting off a new block below it
  // (Enter in a list item, or the paragraph double-Enter) keeps the SAME
  // native EditText instance - Android briefly renders that EditText's own
  // uncontrolled multi-line content (still holding the newline the user just
  // typed) before the corrected, newline-free `value` prop reaches it a
  // render later, growing the row by a line and then shrinking it back. That
  // transient grow/shrink is what shows up as the screen jumping up and then
  // back down to the edited line. Bumping this per-block counter and folding
  // it into the TextInput's key forces a fresh EditText - mounted directly
  // with the already-correct text - instead of updating the old one in place.
  const textVersionsRef = useRef<Record<string, number>>({});

  function bumpTextVersion(id: string) {
    textVersionsRef.current[id] = (textVersionsRef.current[id] ?? 0) + 1;
  }
  const inputRefs = useRef<Record<string, TextInput | null>>({});
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollViewRef = useRef<ScrollView>(null);
  const scrollOffsetRef = useRef(0);
  const undoStackRef = useRef<{ title: string; blocks: Block[] }[]>([]);
  const redoStackRef = useRef<{ title: string; blocks: Block[] }[]>([]);
  const isTypingBurstRef = useRef(false);
  const typingBurstTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Debounces the bare-URL-to-link-card conversion so it fires once typing
  // pauses rather than on every keystroke, and lets a still-in-flight timer
  // for a block be cancelled if the text changes again (or stops being a
  // bare URL) before it fires.
  const linkConversionTimeoutsRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Set from the initial load below (true only when the document didn't
  // exist yet in Firestore - a fresh daily note, see the autosave effect's
  // own comment on setDoc+merge). A regular document already exists by the
  // time this screen opens, so this stays false and its own createdAt
  // (set at DocumentsScreen's addDoc) is left untouched.
  const isNewDocumentRef = useRef(false);
  const isMountedRef = useRef(true);
  useEffect(
    () => () => {
      isMountedRef.current = false;
    },
    []
  );
  // Mirrors `blocks` for reads inside async callbacks (the preview fetch can
  // take seconds) - a plain closure over `blocks` would see whatever state
  // was current when the timeout/fetch was scheduled, not the latest.
  const blocksRef = useRef<Block[]>(blocks);
  blocksRef.current = blocks;
  // A link whose title couldn't be fetched automatically (a raw-coordinates
  // Maps link, or any page with no fetchable title) pauses the conversion
  // here instead of silently landing in the `links` mirror unnamed - an
  // unnamed link is one the user will never find again in a future
  // "Посилання" database list.
  const [linkTitlePrompt, setLinkTitlePrompt] = useState<{ blockId: string; url: string; preview: LinkPreview } | null>(
    null
  );
  const [linkTitlePromptValue, setLinkTitlePromptValue] = useState('');

  useEffect(() => {
    (async () => {
      // Opening a note almost always follows just having seen it in a list
      // that's already live-subscribed to this same collection (Documents,
      // Search, Diary) - Firestore's SDK shares one client-side cache
      // across every query, so the doc is already sitting there. Try that
      // first (near-instant, no round trip) and only fall back to a real
      // fetch on a cache miss (e.g. opened from a state where the list was
      // never loaded), instead of a network read every single time.
      const docRef = doc(db, 'documents', documentId);
      let snapshot;
      try {
        snapshot = await getDocFromCache(docRef);
        if (!snapshot.exists()) throw new Error('not cached');
      } catch {
        snapshot = await getDoc(docRef);
      }
      const data = snapshot.data();
      isNewDocumentRef.current = !snapshot.exists();
      setTitle(data?.title ?? '');
      setTagIds(data?.tagIds ?? []);
      setCoverImageUri(data?.coverImageUri);
      setPaperColorEnabled(!!data?.paperColorEnabled);
      setGroupId(data?.groupId ?? null);
      const loadedBlocks: Block[] = data?.blocks ?? [];
      setBlocks(loadedBlocks.length > 0 ? loadedBlocks : [newBlock()]);
      // Seed the "what does this document currently mirror" trackers from
      // the blocks as loaded, not an empty set - otherwise a link/task
      // removed before the very first debounced sync ever runs (e.g.
      // deleting a block within the first ~600ms of opening the document)
      // would never be recognized as a removal, leaving a stale mirror
      // entry that keeps pointing at this document forever.
      knownTaskBlockIdsRef.current = new Set(
        loadedBlocks.filter((b) => (b.type ?? 'paragraph') === 'checkbox' && b.text.trim() !== '').map((b) => b.id)
      );
      knownLinkIdsRef.current = new Set(
        loadedBlocks.filter((b) => (b.type ?? 'paragraph') === 'link' && b.linkUrl).map((b) => linkDocId(b.linkUrl!))
      );
      knownPhotoBlockIdsRef.current = new Set(
        loadedBlocks.filter((b) => (b.type ?? 'paragraph') === 'image' && b.imageUri).map((b) => b.id)
      );
      knownFileBlockIdsRef.current = new Set(
        loadedBlocks.filter((b) => (b.type ?? 'paragraph') === 'file' && b.fileUri).map((b) => b.id)
      );
      knownStickerBlockIdsRef.current = new Set(loadedBlocks.filter((b) => b.isSticker).map((b) => b.id));
      // The title TextInput remounts (its own `key` toggles editable/locked)
      // exactly when isEditMode flips, which is what lets its `autoFocus`
      // prop actually fire here instead of doing nothing (autoFocus only
      // ever fires on a component's own first mount).
      if (autoFocusTitle) setIsEditMode(true);
      setIsLoaded(true);
    })();
  }, [documentId]);

  // Checkbox blocks with text are database objects by default - no explicit
  // "convert to object" step, per PROJECT_BRIEF.md's object model. Every
  // checkbox block with non-empty text gets a mirrored doc in the `tasks`
  // collection (keyed by the block's own id); an emptied checkbox, one
  // converted away from checkbox, or a deleted block all show up the same
  // way here - simply missing from the current pass - and get their task
  // doc removed. Blocks live inside each document's own `blocks` array
  // field, which Firestore can't query across documents directly, so this
  // mirror is what a future cross-document "Справи" list will actually read
  // from.
  const knownTaskBlockIdsRef = useRef<Set<string>>(new Set());

  function syncTasksForDocument(currentBlocks: Block[]) {
    const taskBlocks = currentBlocks.filter(
      (b) => (b.type ?? 'paragraph') === 'checkbox' && b.text.trim() !== ''
    );
    const currentIds = new Set(taskBlocks.map((b) => b.id));
    taskBlocks.forEach((b) => {
      const taskDoc: Record<string, unknown> = {
        text: b.text,
        checked: !!b.checked,
        documentId,
        updatedAt: Date.now(),
      };
      // setDoc below replaces the whole document, so simply not including
      // these when the block doesn't have them is what clears a removed
      // project/today/kanban/reminder assignment from the mirror - no
      // explicit field deletion needed. Every field TasksScreen writes onto
      // a block has to be carried forward here too, or the very next edit
      // anywhere in this document (this runs on every save, not just task
      // edits) silently wipes it back out of the mirror.
      if (b.projectId) taskDoc.projectId = b.projectId;
      if (b.todayMarkedDate) taskDoc.todayMarkedDate = b.todayMarkedDate;
      if (b.kanbanStatus) taskDoc.kanbanStatus = b.kanbanStatus;
      if (b.reminderDate) taskDoc.reminderDate = b.reminderDate;
      if (b.reminderTime) taskDoc.reminderTime = b.reminderTime;
      if (b.reminderNotificationId) taskDoc.reminderNotificationId = b.reminderNotificationId;
      // The block's own createdAt (set once at buildBlock, unaffected by
      // later edits) - has to be carried forward on every write same as the
      // fields above, since this setDoc has no {merge:true} and would
      // otherwise wipe it back out on the task's very next edit.
      if (b.createdAt) taskDoc.createdAt = b.createdAt;
      setDoc(doc(db, 'tasks', b.id), taskDoc);
    });
    knownTaskBlockIdsRef.current.forEach((id) => {
      if (!currentIds.has(id)) {
        deleteDoc(doc(db, 'tasks', id));
      }
    });
    knownTaskBlockIdsRef.current = currentIds;
  }

  // 'link' blocks (see convertUrlToLinkBlock) are database objects by
  // default too, same as checkboxes - mirrored into a top-level `links`
  // collection so a future cross-document "Посилання" list can query them.
  // Unlike tasks, a link record is keyed by the URL itself (linkDocId), not
  // the block id - the same link pasted into two documents has to land on
  // ONE record with both documents listed, not two separate "duplicate"
  // entries. `usedInDocuments` is a map of documentId -> true; each
  // document only ever touches its OWN key in that map (via a nested-object
  // merge, or a dotted-path delete), so two documents syncing at once can
  // never clobber each other's membership.
  const knownLinkIdsRef = useRef<Set<string>>(new Set());

  function syncLinksForDocument(currentBlocks: Block[]) {
    const linkBlocks = currentBlocks.filter((b) => (b.type ?? 'paragraph') === 'link' && b.linkUrl);
    const linkIdsInThisDoc = new Set<string>();
    const representativeBlock = new Map<string, Block>();
    linkBlocks.forEach((b) => {
      const linkId = linkDocId(b.linkUrl!);
      linkIdsInThisDoc.add(linkId);
      // Two blocks in this same document could share a URL - only one of
      // them needs to seed the record's shared preview fields.
      if (!representativeBlock.has(linkId)) representativeBlock.set(linkId, b);
    });
    linkIdsInThisDoc.forEach((linkId) => {
      const b = representativeBlock.get(linkId)!;
      const linkDocData: Record<string, unknown> = {
        url: b.linkUrl,
        updatedAt: Date.now(),
        usedInDocuments: { [documentId]: true },
      };
      if (b.linkTitle) linkDocData.title = b.linkTitle;
      if (b.linkImageUrl) linkDocData.imageUrl = b.linkImageUrl;
      if (b.linkSiteName) linkDocData.siteName = b.linkSiteName;
      // {merge:true} below never erases a field once set, so this only
      // needs to be included once - re-sending the same value every sync is
      // harmless.
      if (b.createdAt) linkDocData.createdAt = b.createdAt;
      setDoc(doc(db, 'links', linkId), linkDocData, { merge: true });
    });
    knownLinkIdsRef.current.forEach((linkId) => {
      if (!linkIdsInThisDoc.has(linkId)) {
        removeDocumentUsage('links', linkId);
      }
    });
    knownLinkIdsRef.current = linkIdsInThisDoc;
  }

  // This document no longer has any block for this record - clear just this
  // document's own flag (other documents may still reference it), and if
  // that was the last one, delete the now-unused record entirely instead of
  // leaving an orphaned, invisible entry in Firestore. Shared by links,
  // photos, and files - they all use the same `usedInDocuments` map shape.
  async function removeDocumentUsage(collectionName: string, recordId: string) {
    try {
      await updateDoc(doc(db, collectionName, recordId), { [`usedInDocuments.${documentId}`]: deleteField() });
      const snapshot = await getDoc(doc(db, collectionName, recordId));
      const remaining = (snapshot.data()?.usedInDocuments ?? {}) as Record<string, boolean>;
      if (Object.keys(remaining).length === 0) {
        await deleteDoc(doc(db, collectionName, recordId));
      }
    } catch {
      // Already gone - most likely deleted directly from that database screen.
    }
  }

  // 'image' and 'file' blocks are database objects too, mirrored the same
  // way as links - but unlike links, there's no meaningful "same content" to
  // deduplicate on (every attach is its own local device file, even if
  // visually identical), so these stay keyed by the block's own id, same as
  // tasks. They still use the `usedInDocuments` map shape (in practice
  // always exactly one key today) rather than a single documentId field, so
  // the document-picker UI keeps working unchanged once a future "insert an
  // existing photo/file into another document" feature adds a second one.
  const knownPhotoBlockIdsRef = useRef<Set<string>>(new Set());

  function syncPhotosForDocument(currentBlocks: Block[]) {
    const photoBlocks = currentBlocks.filter((b) => (b.type ?? 'paragraph') === 'image' && b.imageUri);
    const currentIds = new Set(photoBlocks.map((b) => b.id));
    photoBlocks.forEach((b) => {
      const photoDoc: Record<string, unknown> = {
        imageUri: b.imageUri,
        updatedAt: Date.now(),
        usedInDocuments: { [documentId]: true },
      };
      if (b.imageTitle) photoDoc.title = b.imageTitle;
      if (b.imageFit) photoDoc.imageFit = b.imageFit;
      if (b.createdAt) photoDoc.createdAt = b.createdAt;
      // Only on first sync, same guard as the Drive backup below - a
      // genuinely new camera photo starts in the fixed "Фото" group, but
      // re-saving the document on every edit must never force it back
      // there after the user has since moved it to a different group.
      const isNewPhoto = !knownPhotoBlockIdsRef.current.has(b.id);
      if (isNewPhoto && b.imageSource === 'camera') photoDoc.groupId = CAMERA_PHOTOS_GROUP_ID;
      setDoc(doc(db, 'photos', b.id), photoDoc, { merge: true });
      // A genuinely new photo (not one already mirrored before this
      // render) also gets backed up to Google Drive, if connected -
      // fire-and-forget, since a failed/skipped backup must never block
      // attaching the photo itself. The extra !b.driveFileId guard is what
      // stops this from re-uploading a duplicate when the block is instead
      // a reference to a photo that already exists (and is already backed
      // up) in a different document - see blockFromPhoto.
      if (isNewPhoto && !b.driveFileId) {
        backupFileToDrive(b.imageUri!, `${b.id}.jpg`, 'image/jpeg', 'Photos').then((result) => {
          if (result) updateDoc(doc(db, 'photos', b.id), { driveFileId: result.fileId, driveBytes: result.bytes });
        });
      }
    });
    knownPhotoBlockIdsRef.current.forEach((id) => {
      if (!currentIds.has(id)) {
        removeDocumentUsage('photos', id);
      }
    });
    knownPhotoBlockIdsRef.current = currentIds;
  }

  const knownFileBlockIdsRef = useRef<Set<string>>(new Set());

  function syncFilesForDocument(currentBlocks: Block[]) {
    const fileBlocks = currentBlocks.filter((b) => (b.type ?? 'paragraph') === 'file' && b.fileUri);
    const currentIds = new Set(fileBlocks.map((b) => b.id));
    fileBlocks.forEach((b) => {
      const fileDoc: Record<string, unknown> = {
        fileUri: b.fileUri,
        fileName: b.fileName,
        updatedAt: Date.now(),
        usedInDocuments: { [documentId]: true },
      };
      if (b.mimeType) fileDoc.mimeType = b.mimeType;
      if (b.fileTitle) fileDoc.title = b.fileTitle;
      if (b.createdAt) fileDoc.createdAt = b.createdAt;
      setDoc(doc(db, 'files', b.id), fileDoc, { merge: true });
      // !b.driveFileId - see syncPhotosForDocument's identical guard: stops
      // a reference to an already-backed-up file (a different document's
      // existing file, just added here too) from re-uploading a duplicate.
      if (!knownFileBlockIdsRef.current.has(b.id) && !b.driveFileId) {
        backupFileToDrive(b.fileUri!, b.fileName ?? b.id, b.mimeType ?? 'application/octet-stream', 'Files').then(
          (result) => {
            if (result) updateDoc(doc(db, 'files', b.id), { driveFileId: result.fileId, driveBytes: result.bytes });
          }
        );
      }
    });
    knownFileBlockIdsRef.current.forEach((id) => {
      if (!currentIds.has(id)) {
        removeDocumentUsage('files', id);
      }
    });
    knownFileBlockIdsRef.current = currentIds;
  }

  // Unlike removeDocumentUsage (shared by links/photos/files, which
  // deleteDoc's the record once usedInDocuments empties out), a sticker
  // must never be hard-deleted - it just goes back to being "free" (shows
  // up again in the Documents-screen strip / StickersScreen). So this
  // clears only this document's own usedInDocuments key and stops there,
  // deliberately not reusing removeDocumentUsage.
  async function removeStickerUsage(recordId: string) {
    try {
      await updateDoc(doc(db, 'stickers', recordId), { [`usedInDocuments.${documentId}`]: deleteField() });
    } catch {
      // Already gone, or never existed (e.g. trashed and later - still
      // never deleted, so this shouldn't normally happen, but a stale ref
      // pointing at a genuinely missing doc must not crash the save).
    }
  }

  // A sticker block is any paragraph/image/sketch block with `isSticker`
  // set (see blockFromSticker) - its own `type` is one of those three
  // ordinary types, so filtering by `type` the way syncPhotosForDocument/
  // syncFilesForDocument do would also catch every ordinary block in the
  // document. `isSticker` is what makes this safe.
  const knownStickerBlockIdsRef = useRef<Set<string>>(new Set());

  function syncStickersForDocument(currentBlocks: Block[]) {
    const stickerBlocks = currentBlocks.filter((b) => b.isSticker);
    const currentIds = new Set(stickerBlocks.map((b) => b.id));
    stickerBlocks.forEach((b) => {
      const stickerDoc: Record<string, unknown> = {
        type: b.type ?? 'paragraph',
        updatedAt: Date.now(),
        usedInDocuments: { [documentId]: true },
      };
      if (b.text) stickerDoc.text = b.text;
      if (b.imageUri) stickerDoc.imageUri = b.imageUri;
      if (b.driveFileId) stickerDoc.driveFileId = b.driveFileId;
      if (b.driveBytes) stickerDoc.driveBytes = b.driveBytes;
      if (b.sketchElements) stickerDoc.sketchElements = b.sketchElements;
      if (b.sketchWidth) stickerDoc.sketchWidth = b.sketchWidth;
      if (b.sketchHeight) stickerDoc.sketchHeight = b.sketchHeight;
      if (b.createdAt) stickerDoc.createdAt = b.createdAt;
      setDoc(doc(db, 'stickers', b.id), stickerDoc, { merge: true });
    });
    knownStickerBlockIdsRef.current.forEach((id) => {
      if (!currentIds.has(id)) {
        removeStickerUsage(id);
      }
    });
    knownStickerBlockIdsRef.current = currentIds;
  }

  useEffect(() => {
    if (!isLoaded) return;
    setSaveStatus('saving');
    if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    saveTimeoutRef.current = setTimeout(() => {
      // setDoc+merge rather than updateDoc - a daily note's document (see
      // `embedded`/`extraFields` above) doesn't exist in Firestore yet the
      // first time this fires, and updateDoc would reject a write to a
      // missing document. Harmless for a regular document, which already
      // exists by the time this screen opens (created by DocumentsScreen's
      // own "+" before navigating here).
      // createdAt only on the very first save of a genuinely new document
      // (a daily note that didn't exist yet) - {merge:true} means it's
      // never touched again after that, same as every later autosave.
      const createdAtField = isNewDocumentRef.current ? { createdAt: Date.now() } : {};
      isNewDocumentRef.current = false;
      setDoc(
        doc(db, 'documents', documentId),
        {
          title,
          blocks,
          updatedAt: Date.now(),
          paperColorEnabled,
          // deleteField() rather than omitting the key or writing undefined
          // (which Firestore rejects outright) - a cover removed after
          // having been set has to actually clear the field, not leave the
          // old uri sitting there under merge:true.
          coverImageUri: coverImageUri || deleteField(),
          groupId: groupId ?? deleteField(),
          ...createdAtField,
          ...extraFields,
        },
        { merge: true }
      ).then(() => setSaveStatus('saved'));
      syncTasksForDocument(blocks);
      syncLinksForDocument(blocks);
      syncPhotosForDocument(blocks);
      syncFilesForDocument(blocks);
      syncStickersForDocument(blocks);
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, blocks, coverImageUri, paperColorEnabled, groupId, isLoaded]);

  useEffect(() => {
    const id = focusIdRef.current;
    if (!id) return;
    const input = inputRefs.current[id];
    input?.focus();
    if (focusToEndRef.current) {
      const block = blocks.find((b) => b.id === id);
      if (block) {
        input?.setSelection(block.text.length, block.text.length);
      }
      focusToEndRef.current = false;
    }
    focusIdRef.current = null;
  }, [blocks]);

  // Expo Go's own manifest isn't affected by app.json's
  // android.softwareKeyboardLayoutMode, so the keyboard never resizes the
  // window here the way a real build's adjustResize would - the screen has
  // to track the keyboard itself and scroll the focused block above it.
  // Measured on-device (dev-build, Android 15): the window does NOT resize
  // under the keyboard even though app.json sets
  // android.softwareKeyboardLayoutMode: "resize" - window height stays at
  // the full screen height whether the keyboard is up or down, because
  // edge-to-edge delivers the keyboard as an inset instead. So the manual
  // scroll compensation below is still doing real work (it is not
  // double-compensating), and anything pinned above the keyboard has to be
  // positioned by hand from this height.
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      cancelDismissFallback();
      setKeyboardHeight(e.endCoordinates.height);
      scheduleScrollAdjust(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      cancelDismissFallback();
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
      cancelDismissFallback();
      if (scrollAdjustTimeoutRef.current) clearTimeout(scrollAdjustTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Moving focus between blocks (e.g. Enter creating a new one) can fire
  // keyboardDidShow again even though the keyboard never really left the
  // screen, and the new block's own layout hasn't settled yet at the exact
  // moment it's focused. Debouncing collapses those into a single
  // measurement taken once things are quiet, instead of an early (wrong)
  // scroll immediately followed by a corrective one - the visible
  // "jumps up then down" the user saw. Single-Enter now creates a new list
  // item on every press (not just double-Enter), so this focus-swap blip
  // happens far more often; 60ms wasn't always longer than the gap between
  // the focus-driven call and the keyboard-driven one, so both could still
  // fire as two separate scrolls. 180ms comfortably covers that gap.
  const scrollAdjustTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keyboard.dismiss() (a JS-triggered dismiss, as opposed to the user
  // tapping away or hitting back - both of which fire keyboardDidHide
  // reliably) doesn't reliably fire keyboardDidHide on Android - a known
  // RN issue, and the same class of Android keyboard-timing bug this
  // editor has already hit elsewhere (see the double-Enter workaround).
  // Left unhandled, keyboardHeight can get stuck positive after "done",
  // which keeps the pinned toolbar showing (or makes it reappear with no
  // keyboard-rise delay the next time edit mode opens - it was already
  // "up" as far as this state knew).
  //
  // The real events stay the source of truth for keyboardHeight - this is
  // only a bounded safety net for when Android drops the hide event after
  // OUR OWN dismiss() call: request one right after calling dismiss(),
  // and if no real event arrives within the window, assume the hide
  // succeeded silently and force the state itself. A genuine event
  // arriving first (either direction - showing again counts too, e.g. the
  // user reopened before the fallback fired) cancels it, so it never
  // fights a real, current keyboard state.
  const dismissFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function cancelDismissFallback() {
    if (dismissFallbackRef.current) {
      clearTimeout(dismissFallbackRef.current);
      dismissFallbackRef.current = null;
    }
  }

  function requestDismissFallback() {
    cancelDismissFallback();
    dismissFallbackRef.current = setTimeout(() => {
      dismissFallbackRef.current = null;
      setKeyboardHeight(0);
    }, 350);
  }

  function scheduleScrollAdjust(currentKeyboardHeight: number) {
    if (scrollAdjustTimeoutRef.current) clearTimeout(scrollAdjustTimeoutRef.current);
    scrollAdjustTimeoutRef.current = setTimeout(() => {
      scrollFocusedBlockIntoView(currentKeyboardHeight);
    }, 180);
  }

  // Typing needs a THROTTLE, not scheduleScrollAdjust's debounce: a debounce
  // that restarts on every keystroke never fires at all while someone keeps
  // typing, which is exactly when the caret is drifting down behind the
  // keyboard line by line. This runs at most ~4x/second during a continuous
  // burst, and scrollFocusedBlockIntoView itself no-ops unless the block
  // has actually overflowed the visible area, so it stays cheap.
  const typingScrollAtRef = useRef(0);
  function keepCaretVisibleWhileTyping() {
    if (keyboardHeight <= 0) return;
    const now = Date.now();
    if (now - typingScrollAtRef.current < 250) return;
    typingScrollAtRef.current = now;
    scrollFocusedBlockIntoView(keyboardHeight);
  }

  // The pinned toolbar sits between the keyboard and the block list, so a
  // block scrolled to sit just above the keyboard would end up hidden
  // behind the bar - its height comes off the visible area too. Kept in a
  // ref because the scroll runs from a debounced timer, not from render.
  const toolbarHeightRef = useRef(0);

  // Same condition EditorToolbar itself renders on - kept here because the
  // list's bottom padding and the scroll maths above both need to know
  // whether the bar is currently taking up room. Gated on the keyboard
  // too: with it down the bar would just sit inert on the bottom edge.
  const isToolbarVisible = keyboardHeight > 0 && focusedBlockId !== null;
  toolbarHeightRef.current = isToolbarVisible ? EDITOR_TOOLBAR_HEIGHT : 0;

  function scrollFocusedBlockIntoView(currentKeyboardHeight: number) {
    const id = focusedBlockIdRef.current;
    const input = id ? inputRefs.current[id] : null;
    if (!input) return;
    input.measure((_x, _y, _width, height, _pageX, pageY) => {
      const visibleBottom =
        Dimensions.get('window').height - currentKeyboardHeight - toolbarHeightRef.current;
      const overflow = pageY + height - visibleBottom + 24;
      if (overflow > 0) {
        scrollViewRef.current?.scrollTo({ y: scrollOffsetRef.current + overflow, animated: true });
      }
    });
  }

  function handleBlockFocus(id: string) {
    focusedBlockIdRef.current = id;
    setFocusedBlockId(id);
    if (keyboardHeight > 0) {
      scheduleScrollAdjust(keyboardHeight);
    }
  }

  // The bar appearing/disappearing changes how much room is left above the
  // keyboard, but nothing else re-runs the scroll compensation for that -
  // a block focused right as the keyboard opens gets one scroll (from the
  // keyboard event) computed against the bar's height already, but a block
  // whose format row swaps in or out (selecting/deselecting text) needs
  // its own pass. Only while the keyboard is actually up; with it down the
  // bar just rests on the bottom edge, nothing to compensate.
  useEffect(() => {
    if (keyboardHeight > 0) scheduleScrollAdjust(keyboardHeight);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isToolbarVisible]);

  // Drives the formatting toolbar: it only shows for a real (non-empty)
  // selection, since there's nothing to apply Bold/Italic/etc. to otherwise.
  function handleBlockSelectionChange(id: string, start: number, end: number) {
    setActiveSelection(start === end ? null : { blockId: id, start, end });
  }

  const UNDO_HISTORY_LIMIT = 50;
  const TYPING_BURST_MS = 800;

  // Captures the state as it was right BEFORE a discrete, structural
  // change (add/delete/reorder a block) - each of these is its own undo
  // step. Also ends any in-progress typing burst, so unrelated typing
  // before and after a structural edit never gets merged into one step.
  function snapshotBeforeChange() {
    undoStackRef.current.push({ title, blocks });
    if (undoStackRef.current.length > UNDO_HISTORY_LIMIT) undoStackRef.current.shift();
    redoStackRef.current = [];
    isTypingBurstRef.current = false;
    setCanUndo(true);
    setCanRedo(false);
  }

  // Typing a whole sentence one keystroke at a time shouldn't be one undo
  // step per character - only the FIRST change since the last pause gets
  // snapshotted; a timer marks the burst over after a short quiet spell,
  // so the next keystroke (in this block or another) starts a fresh one.
  function snapshotForTyping() {
    if (!isTypingBurstRef.current) {
      snapshotBeforeChange();
      isTypingBurstRef.current = true;
    }
    if (typingBurstTimeoutRef.current) clearTimeout(typingBurstTimeoutRef.current);
    typingBurstTimeoutRef.current = setTimeout(() => {
      isTypingBurstRef.current = false;
    }, TYPING_BURST_MS);
  }

  function undo() {
    const previous = undoStackRef.current.pop();
    if (!previous) return;
    redoStackRef.current.push({ title, blocks });
    isTypingBurstRef.current = false;
    setTitle(previous.title);
    setBlocks(previous.blocks);
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(true);
  }

  function redo() {
    const next = redoStackRef.current.pop();
    if (!next) return;
    undoStackRef.current.push({ title, blocks });
    isTypingBurstRef.current = false;
    setTitle(next.title);
    setBlocks(next.blocks);
    setCanRedo(redoStackRef.current.length > 0);
    setCanUndo(true);
  }

  function handleTitleChange(text: string) {
    snapshotForTyping();
    // The title field is multiline only so a long title soft-wraps instead
    // of running off-screen - a hard Enter should still just move on to the
    // document body instead of literally breaking the title onto two
    // lines. Cuts the title at the first newline (anything typed after it
    // in the same change, e.g. a multi-line paste, is dropped rather than
    // kept in the title) and hands focus straight to the first block.
    const newlineIndex = text.indexOf('\n');
    if (newlineIndex !== -1) {
      setTitle(text.slice(0, newlineIndex));
      const firstBlock = blocks[0];
      if (firstBlock) inputRefs.current[firstBlock.id]?.focus();
      return;
    }
    setTitle(text);
  }

  // tagIds isn't part of the title/blocks autosave cycle - each of these
  // writes straight to Firestore via useTags (which also updates the tag
  // doc's own usedIn/types), then mirrors the result into local state since
  // this screen loads the document once with getDoc rather than a live
  // onSnapshot listener.
  async function handleAttachTag(tag: Tag) {
    setTagIds((prev) => (prev.includes(tag.id) ? prev : [...prev, tag.id]));
    await attachTag(tag, 'document', documentId, 'documents');
  }

  async function handleDetachTag(tag: Tag) {
    setTagIds((prev) => prev.filter((id) => id !== tag.id));
    await detachTag(tag, 'document', documentId, 'documents');
  }

  async function handleCreateAndAttachTag(path: string, icon: string, color: string) {
    const newId = await createAndAttachTag(path, icon, color, 'document', documentId, 'documents');
    setTagIds((prev) => [...prev, newId]);
  }

  // Wraps (or unwraps, if already exactly wrapped) the active selection
  // with a marker pair, then restores the selection over the same text so
  // repeated taps toggle cleanly and the user can keep applying more
  // formats to the same range.
  function applyMarkerToSelection(open: string, close: string) {
    const sel = activeSelection;
    if (!sel) return;
    const block = blocks.find((b) => b.id === sel.blockId);
    if (!block) return;
    const before = block.text.slice(0, sel.start);
    const selected = block.text.slice(sel.start, sel.end);
    const after = block.text.slice(sel.end);
    // A single '*' (italic) also matches the tail of '**' (bold), so a
    // plain endsWith/startsWith would misfire "already italic" on text
    // that's actually bold-wrapped. Require the boundary to be exactly
    // this marker, not a longer one that happens to contain it.
    const isExactBoundary =
      open === '*'
        ? before.endsWith('*') && !before.endsWith('**') && after.startsWith('*') && !after.startsWith('**')
        : before.endsWith(open) && after.startsWith(close);
    let newText: string;
    let newStart: number;
    if (isExactBoundary) {
      newText = before.slice(0, -open.length) + selected + after.slice(close.length);
      newStart = sel.start - open.length;
    } else {
      newText = before + open + selected + close + after;
      newStart = sel.start + open.length;
    }
    const newEnd = newStart + selected.length;
    snapshotBeforeChange();
    setBlocks((prev) => prev.map((b) => (b.id === sel.blockId ? { ...b, text: newText } : b)));
    setActiveSelection({ blockId: sel.blockId, start: newStart, end: newEnd });
    requestAnimationFrame(() => {
      inputRefs.current[sel.blockId]?.setSelection(newStart, newEnd);
    });
  }

  // Color/highlight need their own version since the "already applied"
  // check has to match any hex value, not one fixed marker, and re-tapping
  // a different swatch should replace the color rather than nest a second
  // tag around the first.
  function applyColorToSelection(kind: 'c' | 'h', hex: string) {
    const sel = activeSelection;
    if (!sel) return;
    const block = blocks.find((b) => b.id === sel.blockId);
    if (!block) return;
    const openPattern = kind === 'c' ? COLOR_OPEN : HIGHLIGHT_OPEN;
    const closeTag = kind === 'c' ? COLOR_CLOSE : HIGHLIGHT_CLOSE;
    const before = block.text.slice(0, sel.start);
    const selected = block.text.slice(sel.start, sel.end);
    const after = block.text.slice(sel.end);
    // openPattern is anchored to the start of a string (^...) for matching
    // an upcoming tag while parsing; here we need "ends with", so the
    // leading ^ has to be dropped before anchoring to the end instead.
    const existingOpenMatch = before.match(new RegExp(openPattern.source.replace(/^\^/, '') + '$'));
    const hasExistingClose = after.startsWith(closeTag);
    let newText: string;
    let newStart: number;
    if (existingOpenMatch && hasExistingClose) {
      const existingHex = existingOpenMatch[1];
      if (existingHex.toLowerCase() === hex.toLowerCase()) {
        // Same color already applied - remove it.
        newText = before.slice(0, -existingOpenMatch[0].length) + selected + after.slice(closeTag.length);
        newStart = sel.start - existingOpenMatch[0].length;
      } else {
        // Different color - swap the hex value in place, tag lengths match.
        const newOpen = `{${kind}:${hex}}`;
        newText = before.slice(0, -existingOpenMatch[0].length) + newOpen + selected + after;
        newStart = sel.start - existingOpenMatch[0].length + newOpen.length;
      }
    } else {
      const openTag = `{${kind}:${hex}}`;
      newText = before + openTag + selected + closeTag + after;
      newStart = sel.start + openTag.length;
    }
    const newEnd = newStart + selected.length;
    snapshotBeforeChange();
    setBlocks((prev) => prev.map((b) => (b.id === sel.blockId ? { ...b, text: newText } : b)));
    setActiveSelection({ blockId: sel.blockId, start: newStart, end: newEnd });
    requestAnimationFrame(() => {
      inputRefs.current[sel.blockId]?.setSelection(newStart, newEnd);
    });
  }

  function handleBlockChange(id: string, text: string) {
    snapshotForTyping();
    keepCaretVisibleWhileTyping();
    const currentType = blocks.find((b) => b.id === id)?.type ?? 'paragraph';

    // List items (bulleted/numbered/checkbox) continue the list on a
    // single Enter instead of needing a second one - typing a whole
    // sentence per item would be tedious otherwise. Pressing Enter on an
    // already-empty item exits the list instead of adding another blank
    // one, matching how most list editors behave.
    if (LIST_TYPES.includes(currentType)) {
      const newlineIndex = text.indexOf('\n');
      if (newlineIndex !== -1) {
        const before = text.slice(0, newlineIndex);
        const after = text.slice(newlineIndex + 1);
        if (before === '') {
          setBlocks((prev) => prev.map((b) => (b.id === id ? buildBlock(b.id, 'paragraph', after) : b)));
          return;
        }
        const created = buildBlock(generateId(), currentType, after);
        focusIdRef.current = created.id;
        bumpTextVersion(id);
        setBlocks((prev) => {
          const index = prev.findIndex((b) => b.id === id);
          if (index === -1) return prev;
          const next = [...prev];
          next[index] = { ...next[index], text: before };
          next.splice(index + 1, 0, created);
          return next;
        });
        return;
      }
      setBlocks((prev) => prev.map((block) => (block.id === id ? { ...block, text } : block)));
      return;
    }

    // React Native's TextInput never reports whether Shift was held for
    // Enter (Android's own bridge code discards that before it reaches JS,
    // on any keyboard, soft or hardware) - so for a plain paragraph, a
    // single Enter has to just be a line break within the block, and
    // creating a new block instead needs its own distinct signal: pressing
    // Enter again on the resulting empty line, i.e. two consecutive
    // newlines.
    const doubleNewlineIndex = text.indexOf('\n\n');
    if (doubleNewlineIndex === -1) {
      setBlocks((prev) => prev.map((block) => (block.id === id ? { ...block, text } : block)));
      // A paragraph whose ENTIRE trimmed text is a bare URL auto-converts to
      // a link card once typing/pasting settles (see convertUrlToLinkBlock) -
      // debounced so a URL that's still being typed/edited doesn't fire mid-
      // keystroke, and cancelled outright as soon as the text stops matching.
      const trimmed = text.trim();
      if (currentType === 'paragraph' && /^https?:\/\/\S+$/i.test(trimmed)) {
        if (linkConversionTimeoutsRef.current[id]) clearTimeout(linkConversionTimeoutsRef.current[id]);
        linkConversionTimeoutsRef.current[id] = setTimeout(() => {
          delete linkConversionTimeoutsRef.current[id];
          convertUrlToLinkBlock(id, trimmed);
        }, 800);
      } else if (linkConversionTimeoutsRef.current[id]) {
        clearTimeout(linkConversionTimeoutsRef.current[id]);
        delete linkConversionTimeoutsRef.current[id];
      }
      return;
    }
    // Both newlines are consumed here - the blank line the first Enter left
    // behind shouldn't linger in either block.
    const before = text.slice(0, doubleNewlineIndex);
    const after = text.slice(doubleNewlineIndex + 2);
    const created: Block = { ...newBlock(), text: after };
    focusIdRef.current = created.id;
    bumpTextVersion(id);
    setBlocks((prev) => {
      const index = prev.findIndex((block) => block.id === id);
      const next = [...prev];
      next[index] = { ...next[index], text: before };
      next.splice(index + 1, 0, created);
      return next;
    });
  }

  // The block may have been deleted, retyped into something else, or
  // converted to a different type while the preview was still fetching (or
  // while the mandatory-name prompt below was sitting open) - in any of
  // those cases the stale result should just be dropped.
  function isLinkConversionStillValid(id: string, url: string): boolean {
    const block = blocksRef.current.find((b) => b.id === id);
    return !!block && (block.type ?? 'paragraph') === 'paragraph' && block.text.trim() === url;
  }

  function applyLinkConversion(id: string, url: string, preview: LinkPreview, title: string) {
    setBlocks((prev) => {
      const block = prev.find((b) => b.id === id);
      if (!block || (block.type ?? 'paragraph') !== 'paragraph' || block.text.trim() !== url) return prev;
      return prev.map((b) => {
        if (b.id !== id) return b;
        const linkBlock: Block = { ...buildBlock(id, 'link', url), linkUrl: url, linkTitle: title };
        if (preview.imageUrl) linkBlock.linkImageUrl = preview.imageUrl;
        if (preview.siteName) linkBlock.linkSiteName = preview.siteName;
        return linkBlock;
      });
    });
  }

  async function convertUrlToLinkBlock(id: string, url: string) {
    const preview = await fetchLinkPreview(url);
    if (!isMountedRef.current || !isLinkConversionStillValid(id, url)) return;
    if (preview.title) {
      applyLinkConversion(id, url, preview, preview.title);
    } else {
      // No title to show (a raw-coordinates Maps link with nothing to read
      // out of the URL, or a page with no fetchable og:title) - stop and
      // ask instead of quietly filing an unnamed link nobody could find
      // later.
      setLinkTitlePrompt({ blockId: id, url, preview });
      setLinkTitlePromptValue('');
    }
  }

  function confirmLinkTitlePrompt() {
    const prompt = linkTitlePrompt;
    const title = linkTitlePromptValue.trim();
    if (!prompt || !title) return;
    if (isLinkConversionStillValid(prompt.blockId, prompt.url)) {
      applyLinkConversion(prompt.blockId, prompt.url, prompt.preview, title);
    }
    setLinkTitlePrompt(null);
    setLinkTitlePromptValue('');
  }

  function cancelLinkTitlePrompt() {
    setLinkTitlePrompt(null);
    setLinkTitlePromptValue('');
  }

  async function openLinkBlock(url: string) {
    // A YouTube/TikTok link plays right here (see VideoPlayerModal) instead
    // of handing off to the YouTube/TikTok app or a browser tab - anything
    // else keeps opening externally exactly as before.
    if (getVideoEmbedInfo(url)) {
      setPlayingVideoUrl(url);
      return;
    }
    try {
      await Linking.openURL(url);
    } catch {
      // Nothing sensible to show if the URL can't be opened (no handling
      // app, malformed URL, etc.) - silently doing nothing beats a crash.
    }
  }

  // The small "database" icon on a link card jumps to that link's own
  // category screen (see LinksScreen's identical categorization) rather
  // than opening the URL - the two live on the exact same card, so their
  // tap targets have to stay clearly separate.
  function openLinkDatabase(block: Block) {
    const siteName = block.linkSiteName ?? '';
    const category =
      siteName.includes('YouTube') || siteName.includes('TikTok')
        ? 'video'
        : siteName === 'Геоточка'
          ? 'geo'
          : 'other';
    navigation.navigate('Links', { category });
  }

  function handleBackspaceOnEmpty(id: string) {
    const index = blocks.findIndex((block) => block.id === id);
    if (index <= 0) return;
    snapshotBeforeChange();
    setBlocks((prev) => {
      const prevIndex = prev.findIndex((block) => block.id === id);
      if (prevIndex <= 0) return prev;
      const previous = prev[prevIndex - 1];
      focusIdRef.current = previous.id;
      focusToEndRef.current = true;
      const next = [...prev];
      next.splice(prevIndex, 1);
      return next;
    });
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  function toggleChecked(id: string) {
    snapshotBeforeChange();
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, checked: !b.checked } : b)));
  }

  // Generic patch for block-type-specific fields (currently just the table
  // block's cells/sum toggle) - one callback instead of a new prop for
  // every field a future block type might need.
  function updateBlockFields(id: string, patch: Partial<Block>) {
    snapshotBeforeChange();
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  }

  // Android has no cross-app "reveal this file, highlighted, in Files"
  // intent - the closest a normal app can get is opening the OS "open
  // with" chooser directly on that file, the same mechanism this app
  // already uses for opening attachments (see openFile/Sharing.shareAsync
  // elsewhere in this file).
  async function showDownloadedFileInFolder(uri: string, mimeType: string) {
    dismissDownloadToast();
    const available = await Sharing.isAvailableAsync();
    if (!available) return;
    await Sharing.shareAsync(uri, { mimeType });
  }

  async function exportAsPdf() {
    setExportMenuOpen(false);
    const html = await buildDocumentHtml(title, blocks);
    const { uri } = await Print.printToFileAsync({ html });
    const fileName = `${sanitizeFileName(title)}.pdf`;
    const destUri = await downloadToDevice(uri, fileName, 'application/pdf');
    if (destUri) showDownloadToast(fileName, destUri, 'application/pdf');
  }

  async function exportAsTxt() {
    setExportMenuOpen(false);
    const text = buildDocumentText(title, blocks);
    const tempUri = `${LegacyFileSystem.cacheDirectory}${generateId()}.txt`;
    await LegacyFileSystem.writeAsStringAsync(tempUri, text, { encoding: 'utf8' });
    const fileName = `${sanitizeFileName(title)}.txt`;
    const destUri = await downloadToDevice(tempUri, fileName, 'text/plain');
    if (destUri) showDownloadToast(fileName, destUri, 'text/plain');
  }

  function openReminderBlock(id: string) {
    setReminderBlockId(id);
  }

  // Unlike TasksScreen's version, this only ever touches this document's
  // OWN blocks state - no separate write to the `tasks` mirror is needed,
  // since the existing autosave effect already calls syncTasksForDocument
  // on every blocks change and (now that it's fixed) carries these fields
  // over on its own.
  async function saveBlockReminder(reminderDate: string, reminderTime: string | null) {
    const id = reminderBlockId;
    setReminderBlockId(null);
    const block = blocks.find((b) => b.id === id);
    if (!block) return;
    await cancelReminder(block.reminderNotificationId);
    const notificationId = reminderTime ? await scheduleReminder(block.text, reminderDate, reminderTime) : undefined;
    const becomesToday = reminderDate === dateKey(new Date());
    snapshotBeforeChange();
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        const next: Block = { ...b, reminderDate };
        if (reminderTime) next.reminderTime = reminderTime;
        else delete next.reminderTime;
        if (notificationId) next.reminderNotificationId = notificationId;
        else delete next.reminderNotificationId;
        if (becomesToday) next.todayMarkedDate = dateKey(new Date());
        return next;
      })
    );
  }

  async function clearBlockReminder() {
    const id = reminderBlockId;
    setReminderBlockId(null);
    const block = blocks.find((b) => b.id === id);
    if (!block) return;
    await cancelReminder(block.reminderNotificationId);
    snapshotBeforeChange();
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        const { reminderDate: _d1, reminderTime: _d2, reminderNotificationId: _d3, ...rest } = b;
        return rest;
      })
    );
  }

  function toggleImageFit(id: string) {
    snapshotBeforeChange();
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, imageFit: (b.imageFit ?? 'contain') === 'contain' ? 'cover' : 'contain' } : b
      )
    );
  }

  async function downloadImageBlock(uri: string) {
    const fileName = `photo-${Date.now()}.jpg`;
    const destUri = await downloadToDevice(uri, fileName, 'image/jpeg');
    if (destUri) showDownloadToast(fileName, destUri, 'image/jpeg');
  }

  async function downloadFileBlock(id: string) {
    const block = blocks.find((b) => b.id === id);
    if (!block?.fileUri) return;
    const fileName = block.fileName ?? 'file';
    const mimeType = block.mimeType ?? 'application/octet-stream';
    const destUri = await downloadToDevice(block.fileUri, fileName, mimeType);
    if (destUri) showDownloadToast(fileName, destUri, mimeType);
  }

  // Converts the block that triggered the "/" menu into the chosen type.
  // Divider blocks hold no text, so there's nothing left to type into them -
  // a fresh empty paragraph is inserted right after (only if one doesn't
  // already follow) and gets focus, so the user can keep writing without an
  // extra tap. List/checkbox blocks keep editing the same block instead,
  // since their whole point is typing a label into them.
  function convertBlockType(id: string, type: BlockType) {
    snapshotBeforeChange();
    if (type === 'divider') {
      setBlocks((prev) => {
        const index = prev.findIndex((b) => b.id === id);
        if (index === -1) return prev;
        const next = [...prev];
        next[index] = buildBlock(id, 'divider', '');
        if (index === next.length - 1) {
          const trailing = newBlock();
          next.splice(index + 1, 0, trailing);
          focusIdRef.current = trailing.id;
        } else {
          focusIdRef.current = next[index + 1].id;
        }
        return next;
      });
    } else {
      focusIdRef.current = id;
      setBlocks((prev) =>
        prev.map((b) => {
          if (b.id !== id) return b;
          const currentType = b.type ?? 'paragraph';
          // Tapping the same list/checkbox icon again on a block already of
          // that type toggles it back to plain text instead of being a
          // one-way conversion - and either way, the text already typed
          // carries over rather than starting from a blank block.
          const nextType = currentType === type ? 'paragraph' : type;
          return buildBlock(id, nextType, b.text);
        })
      );
    }
  }

  // Longest side capped at 1600px (skipped if already smaller) and
  // re-compressed to a moderate JPEG quality, so a multi-megabyte photo
  // straight from a modern phone camera doesn't get stored at full size in
  // every document. Falls back to the picker's own output if manipulation
  // fails for any reason - a slightly larger image beats losing the pick.
  async function compressPickedImage(uri: string, width: number, height: number): Promise<string> {
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

  // Shared by both the gallery picker and the camera below - same
  // compress-then-splice-into-the-block-list logic either way, the only
  // difference is where the source URI came from.
  function insertImageIntoBlock(id: string, uri: string, source?: 'camera') {
    snapshotBeforeChange();
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === id);
      if (index === -1) return prev;
      const next = [...prev];
      next[index] = { ...buildBlock(id, 'image', ''), imageUri: uri, ...(source ? { imageSource: source } : {}) };
      if (index === next.length - 1) {
        const trailing = newBlock();
        next.splice(index + 1, 0, trailing);
        focusIdRef.current = trailing.id;
      } else {
        focusIdRef.current = next[index + 1].id;
      }
      return next;
    });
  }

  // "З бази даних" (see AddExistingItemModal) - the picked block already
  // carries the SAME id as the existing files/photos record it references
  // (blockFromFile/blockFromPhoto) or, for a link, a fresh id tied back to
  // the record by URL (blockFromLink) - either way this is a full replace
  // of the placeholder block, not an in-place field update like
  // insertImageIntoBlock/pickFileForBlock, since the id itself changes.
  function insertExistingItemIntoBlock(placeholderId: string, item: Block) {
    setExistingItemPickerBlockId(null);
    snapshotBeforeChange();
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === placeholderId);
      if (index === -1) return prev;
      const next = [...prev];
      next[index] = item;
      if (index === next.length - 1) {
        const trailing = newBlock();
        next.splice(index + 1, 0, trailing);
        focusIdRef.current = trailing.id;
      } else {
        focusIdRef.current = next[index + 1].id;
      }
      return next;
    });
  }

  // Same pick -> compress path as a block's own image (pickImageForBlock
  // right below), just storing the result as the document's own
  // coverImageUri instead of inserting a block - no separate mirror
  // record and no Drive backup, exactly like a cover has nowhere else in
  // the app to show up.
  function openCoverImageOptions() {
    setExportMenuOpen(false);
    Alert.alert(coverImageUri ? 'Змінити заставку' : 'Додати заставку', undefined, [
      { text: 'Галерея', onPress: () => pickCoverImage('gallery') },
      { text: 'Камера', onPress: () => pickCoverImage('camera') },
      ...(coverImageUri
        ? [{ text: 'Прибрати заставку', style: 'destructive' as const, onPress: () => setCoverImageUri(undefined) }]
        : []),
      { text: 'Скасувати', style: 'cancel' as const },
    ]);
  }

  async function pickCoverImage(source: 'gallery' | 'camera') {
    const permission =
      source === 'camera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const uri = await compressPickedImage(asset.uri, asset.width, asset.height);
    setCoverImageUri(uri);
  }

  async function pickImageForBlock(id: string) {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const uri = await compressPickedImage(asset.uri, asset.width, asset.height);
    insertImageIntoBlock(id, uri);
  }

  // The document scanner (see scanDocumentForBlock) already covers "capture
  // a page to digitize" - this is the separate, simpler "just take a
  // picture" case (no edge detection/cropping/multi-page), same as picking
  // one from the gallery but from the camera instead.
  async function takePhotoForBlock(id: string) {
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: ['images'],
      quality: 1,
    });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const uri = await compressPickedImage(asset.uri, asset.width, asset.height);
    insertImageIntoBlock(id, uri, 'camera');
  }

  // No cloud upload yet - the picker's own cache copy is what gets stored
  // and later opened, so this only works on the device the file was
  // attached from.
  async function pickFileForBlock(id: string) {
    // copyToCacheDirectory: false keeps the raw content:// SAF URI instead
    // of the picker's own file:// cache copy. Traced through both modules'
    // Android source: expo-file-system's permission check unconditionally
    // trusts any content:// URI, but only trusts a file:// one that falls
    // under the exact cache directory ITS OWN Context resolves - which,
    // under Expo Go's per-experience sandboxing, isn't the same directory
    // expo-document-picker actually copied into. That mismatch is what
    // produced both "Not allowed to read file under given URL" (from
    // expo-sharing) and "isn't readable" (from copyAsync's own check) on
    // that file:// path. Reading through content:// instead sidesteps the
    // whole comparison.
    const result = await DocumentPicker.getDocumentAsync({ type: '*/*', copyToCacheDirectory: false });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    const fileUri = `${LegacyFileSystem.cacheDirectory}${generateId()}-${asset.name}`;
    await LegacyFileSystem.copyAsync({ from: asset.uri, to: fileUri });
    snapshotBeforeChange();
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === id);
      if (index === -1) return prev;
      const next = [...prev];
      const fileBlock: Block = { ...buildBlock(id, 'file', ''), fileUri, fileName: asset.name };
      if (asset.mimeType) fileBlock.mimeType = asset.mimeType;
      next[index] = fileBlock;
      if (index === next.length - 1) {
        const trailing = newBlock();
        next.splice(index + 1, 0, trailing);
        focusIdRef.current = trailing.id;
      } else {
        focusIdRef.current = next[index + 1].id;
      }
      return next;
    });
  }

  // Same size cap/quality as compressPickedImage, but for a scanned page
  // whose dimensions aren't known upfront (the scanner plugin only returns
  // a file path) - render once un-resized just to read them off, then reuse
  // the existing compressor with those.
  async function compressScannedImage(uri: string): Promise<string> {
    try {
      const probe = await ImageManipulator.manipulate(uri).renderAsync();
      return await compressPickedImage(uri, probe.width, probe.height);
    } catch {
      return uri;
    }
  }

  async function insertScannedImages(id: string, uris: string[]) {
    const compressed: string[] = [];
    for (const uri of uris) {
      compressed.push(await compressScannedImage(uri));
    }
    snapshotBeforeChange();
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === id);
      if (index === -1) return prev;
      const imageBlocks = compressed.map((uri, i) => ({
        ...buildBlock(i === 0 ? id : generateId(), 'image', ''),
        imageUri: uri,
      }));
      const next = [...prev];
      next.splice(index, 1, ...imageBlocks);
      const lastIndex = index + imageBlocks.length - 1;
      if (lastIndex === next.length - 1) {
        const trailing = newBlock();
        next.push(trailing);
        focusIdRef.current = trailing.id;
      } else {
        focusIdRef.current = next[lastIndex + 1].id;
      }
      return next;
    });
  }

  // Assembles scanned pages into one PDF via expo-print (HTML -> PDF, no
  // native module needed) rather than the scanner plugin's own output,
  // which is JPEG-only. Pages go in as base64 data URIs - expo-print's
  // WebView renderer isn't guaranteed to resolve a local file:// path.
  async function insertScannedPdf(id: string, uris: string[]) {
    const pagesHtml = await Promise.all(
      uris.map(async (uri) => {
        const base64 = await LegacyFileSystem.readAsStringAsync(uri, { encoding: 'base64' });
        return `<div style="page-break-after: always;"><img src="data:image/jpeg;base64,${base64}" style="width:100%;" /></div>`;
      })
    );
    // A4 at 72 PPI.
    const { uri: pdfUri } = await Print.printToFileAsync({
      html: `<html><body style="margin:0;">${pagesHtml.join('')}</body></html>`,
      width: 595,
      height: 842,
    });
    const fileName = `Скан ${dateKey(new Date())}.pdf`;
    const fileUri = `${LegacyFileSystem.cacheDirectory}${generateId()}-${fileName}`;
    await LegacyFileSystem.copyAsync({ from: pdfUri, to: fileUri });
    snapshotBeforeChange();
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === id);
      if (index === -1) return prev;
      const next = [...prev];
      next[index] = { ...buildBlock(id, 'file', ''), fileUri, fileName, mimeType: 'application/pdf' };
      if (index === next.length - 1) {
        const trailing = newBlock();
        next.splice(index + 1, 0, trailing);
        focusIdRef.current = trailing.id;
      } else {
        focusIdRef.current = next[index + 1].id;
      }
      return next;
    });
  }

  async function scanDocumentForBlock(id: string) {
    let result;
    try {
      result = await DocumentScanner.scanDocument({ responseType: ResponseType.ImageFilePath });
    } catch {
      return;
    }
    const pages = result.scannedImages;
    if (result.status !== ScanDocumentResponseStatus.Success || !pages?.length) return;
    Alert.alert(`Відскановано сторінок: ${pages.length}`, 'Як зберегти?', [
      { text: 'Скасувати', style: 'cancel' },
      { text: 'Як фото', onPress: () => insertScannedImages(id, pages) },
      { text: 'Як PDF', onPress: () => insertScannedPdf(id, pages) },
    ]);
  }

  // A new sketch block starts empty and opens straight into the editor -
  // there's nothing useful to show in the document until it's drawn. The
  // paragraph -> sketch conversion here is deliberately NOT on the undo
  // stack (no snapshotBeforeChange) - it's provisional until something is
  // actually drawn and saved; closeSketchEditor below reverts it cleanly
  // if the user backs out without drawing anything, with nothing for undo
  // to unwind either way.
  const pendingNewSketchIdRef = useRef<string | null>(null);

  function addSketchBlock(id: string) {
    pendingNewSketchIdRef.current = id;
    setBlocks((prev) => prev.map((b) => (b.id === id ? buildBlock(id, 'sketch', '') : b)));
    setSketchEditorBlockId(id);
  }

  // Single dispatcher for the toolbar's insert row - one BlockAction union
  // instead of eight separate callback props, so a new block type only
  // needs an entry in blockActions.tsx plus one case here, not a new prop
  // threaded through the toolbar too.
  function handleBlockAction(action: BlockAction, blockId: string) {
    switch (action) {
      case 'bulleted':
      case 'numbered':
      case 'checkbox':
      case 'divider':
        convertBlockType(blockId, action);
        return;
      case 'image':
        pickImageForBlock(blockId);
        return;
      case 'camera':
        takePhotoForBlock(blockId);
        return;
      case 'file':
        pickFileForBlock(blockId);
        return;
      case 'scan':
        scanDocumentForBlock(blockId);
        return;
      case 'sketch':
        addSketchBlock(blockId);
        return;
      case 'table':
        convertBlockType(blockId, 'table');
        return;
      case 'existing':
        setExistingItemPickerBlockId(blockId);
    }
  }

  function openSketchBlock(id: string) {
    setSketchEditorBlockId(id);
  }

  function closeSketchEditor() {
    const id = sketchEditorBlockId;
    setSketchEditorBlockId(null);
    if (id && pendingNewSketchIdRef.current === id) {
      setBlocks((prev) => {
        const index = prev.findIndex((b) => b.id === id);
        if (index === -1 || (prev[index].sketchElements?.length ?? 0) > 0) return prev;
        const next = [...prev];
        next[index] = buildBlock(id, 'paragraph', '');
        return next;
      });
    }
    pendingNewSketchIdRef.current = null;
  }

  function saveSketchElements(elements: SketchElement[], width: number, height: number) {
    const id = sketchEditorBlockId;
    if (!id) return;
    setSketchEditorBlockId(null);
    pendingNewSketchIdRef.current = null;
    snapshotBeforeChange();
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === id);
      if (index === -1) return prev;
      const next = [...prev];
      next[index] = { ...next[index], sketchElements: elements, sketchWidth: width, sketchHeight: height };
      return next;
    });
  }

  async function openFileBlock(id: string) {
    const block = blocks.find((b) => b.id === id);
    if (!block?.fileUri) return;
    const available = await Sharing.isAvailableAsync();
    if (!available) return;
    await Sharing.shareAsync(block.fileUri, {
      mimeType: block.mimeType,
      dialogTitle: block.fileName,
    });
  }

  async function copySelectedBlocks() {
    const ordered = blocks.filter((b) => selectedIds.has(b.id));
    const text = ordered
      .map((b) => {
        if ((b.type ?? 'paragraph') === 'table') {
          const rows = b.tableRows ?? [];
          return rows.map((row, r) => row.cells.map((_, c) => displayValueOf(rows, r, c)).join('\t')).join('\n');
        }
        return plainTextOf(b.text);
      })
      .join('\n');
    await Clipboard.setStringAsync(text);
  }

  function deleteSelectedBlocks() {
    snapshotBeforeChange();
    setBlocks((prev) => {
      const next = prev.filter((block) => !selectedIds.has(block.id));
      return next.length > 0 ? next : [newBlock()];
    });
    setSelectedIds(new Set());
    setIsSelectMode(false);
  }

  function toggleSelectMode() {
    setIsSelectMode((prev) => !prev);
    setSelectedIds(new Set());
  }

  useImperativeHandle(ref, () => ({ toggleSelectMode }));

  useEffect(() => {
    onSelectModeChange?.(isSelectMode);
  }, [isSelectMode]);

  useEffect(() => {
    onSaveStatusChange?.(saveStatus);
  }, [saveStatus]);

  // Outside edit mode a block's TextInput is pointerEvents: 'none' (see
  // BlockRow) so scrolling can reach through it - which means there's no
  // per-block tap to "start editing here"; the pencil button is the only
  // way in, and it always resumes at the end of the last block, cursor and
  // all, like continuing a line you were already writing.
  function toggleEditMode() {
    if (isEditMode) {
      Keyboard.dismiss();
      requestDismissFallback();
      setIsEditMode(false);
      setActiveSelection(null);
      return;
    }
    setIsEditMode(true);
    if (blocks.length === 0) return;
    const last = blocks[blocks.length - 1];
    requestAnimationFrame(() => {
      const input = inputRefs.current[last.id];
      input?.focus();
      input?.setSelection(last.text.length, last.text.length);
    });
  }

  function addBlockAtEnd() {
    snapshotBeforeChange();
    const created = newBlock();
    focusIdRef.current = created.id;
    setIsEditMode(true);
    setBlocks((prev) => [...prev, created]);
  }

  function handleReorderBlocks(next: Block[]) {
    snapshotBeforeChange();
    setBlocks(next);
  }

  async function shareImageBlock(uri: string) {
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) return;
      await Sharing.shareAsync(uri);
    } catch {
      // No sharing app available or the user backed out - nothing to do.
    }
  }

  function renameImageBlock(id: string, title: string) {
    snapshotBeforeChange();
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, imageTitle: title } : b)));
  }

  // A shortcut for the same thing select-mode's own delete already does -
  // opened from the full-screen viewer instead of selecting the block first.
  // No separate undo-toast here: the existing undo/redo (header arrows)
  // already covers reverting this, same as any other block deletion.
  function deleteImageBlockFromViewer(id: string) {
    snapshotBeforeChange();
    setBlocks((prev) => {
      const next = prev.filter((b) => b.id !== id);
      return next.length > 0 ? next : [newBlock()];
    });
    setViewerImageId(null);
  }

  const viewerBlock = viewerImageId ? blocks.find((b) => b.id === viewerImageId) : null;
  const imageRenameBlock = imageRenameId ? blocks.find((b) => b.id === imageRenameId) : null;

  if (!isLoaded) {
    // Should resolve almost instantly now that the initial load tries the
    // local cache first (see above) - this only shows at all on a genuine
    // cache miss, and a spinner reads as "loading" rather than a stray
    // blank flash.
    return (
      <View style={[styles.container, styles.loadingContainer, embedded && styles.containerEmbedded]}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  return (
    <View
      style={[
        styles.container,
        embedded && styles.containerEmbedded,
        paperColor && { backgroundColor: paperColor.background },
      ]}
    >
      {!embedded && (
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color={paperColor?.text ?? '#111827'} />
          </Pressable>
        </View>
        <View style={styles.headerRightGroup}>
          {/* A separate circle, not a 4th chip inside the pill - matches
              CalendarScreen's own saveDot treatment. */}
          <View style={[styles.saveDot, saveStatus === 'saved' && styles.saveDotSaved]}>
            <Ionicons name="checkmark" size={17} color={saveStatus === 'saved' ? '#171310' : '#fff'} />
          </View>
          <View style={styles.headerRight}>
            <Pressable hitSlop={6} onPress={() => setExportMenuOpen((v) => !v)}>
              <Ionicons name="ellipsis-horizontal-outline" size={19} color="#fff" />
            </Pressable>
            <View style={styles.headerRightDivider} />
            <Pressable hitSlop={6} onPress={toggleSelectMode}>
              <Ionicons name={isSelectMode ? 'close' : 'ellipse-outline'} size={19} color="#fff" />
            </Pressable>
          </View>
        </View>
      </View>
      )}

      {exportMenuOpen && <Pressable style={styles.exportMenuBackdrop} onPress={() => setExportMenuOpen(false)} />}
      {exportMenuOpen && (
        <View style={styles.exportMenuPanel}>
          <Text style={styles.exportMenuLabel}>Оформлення</Text>
          <Pressable style={styles.exportMenuRow} onPress={openCoverImageOptions}>
            <Ionicons name="image-outline" size={17} color="#111827" />
            <Text style={styles.exportMenuRowLabel}>
              {coverImageUri ? 'Змінити заставку' : 'Додати заставку'}
            </Text>
          </Pressable>
          <Pressable style={styles.exportMenuRow} onPress={() => setPaperColorEnabled((v) => !v)}>
            <Ionicons name="color-palette-outline" size={17} color="#111827" />
            <Text style={styles.exportMenuRowLabel}>Колір паперу</Text>
            {paperColorEnabled && <Ionicons name="checkmark" size={18} color={ACCENT} />}
          </Pressable>
          <Text style={styles.exportMenuLabel}>Організація</Text>
          <Pressable
            style={styles.exportMenuRow}
            onPress={() => {
              setExportMenuOpen(false);
              setGroupPickerVisible(true);
            }}
          >
            <Ionicons name="folder-outline" size={17} color="#111827" />
            <Text style={styles.exportMenuRowLabel}>
              {groups.find((g) => g.id === groupId)?.name ?? 'Додати в групу'}
            </Text>
          </Pressable>
          <Text style={styles.exportMenuLabel}>Експорт</Text>
          <Pressable style={styles.exportMenuRow} onPress={exportAsPdf}>
            <Ionicons name="document-text-outline" size={17} color="#111827" />
            <Text style={styles.exportMenuRowLabel}>У PDF</Text>
          </Pressable>
          <Pressable style={styles.exportMenuRow} onPress={exportAsTxt}>
            <Ionicons name="reader-outline" size={17} color="#111827" />
            <Text style={styles.exportMenuRowLabel}>У TXT</Text>
          </Pressable>
        </View>
      )}

      {/* Embedded (CalendarScreen): the select-mode toggle and save
          checkmark both live in CalendarScreen's own header capsule now,
          not in a row here - see onSelectModeChange/onSaveStatusChange and
          the exposed toggleSelectMode ref method above. Undo/redo live in
          the pinned toolbar (both here and in the full-screen header
          above), not here either. */}

      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollArea}
        contentContainerStyle={[
          embedded && styles.scrollAreaEmbedded,
          // Embedded, with the keyboard down, the floating island sits over
          // the bottom of this list - the last block (and "Додати блок")
          // has to be able to scroll clear of it.
          // The pinned toolbar covers its own strip above the keyboard on
          // top of that, so it gets added whenever the bar is showing.
          {
            paddingBottom:
              (keyboardHeight > 0 ? keyboardHeight + 40 : embedded ? 120 : 40) +
              (isToolbarVisible ? EDITOR_TOOLBAR_HEIGHT : 0),
          },
        ]}
        keyboardShouldPersistTaps="handled"
        onScroll={(e) => {
          scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        {!embedded && coverImageUri && (
          <Pressable onPress={openCoverImageOptions}>
            <Image source={{ uri: coverImageUri }} style={styles.coverImage} resizeMode="cover" />
          </Pressable>
        )}

        {!embedded && (
        <TextInput
          key={isEditMode ? 'editable' : 'locked'}
          autoFocus={autoFocusTitle}
          value={title}
          onChangeText={handleTitleChange}
          // The pinned toolbar acts on a block, not the title - hide it
          // rather than have it apply to whatever block last had focus.
          onFocus={() => setFocusedBlockId(null)}
          editable={isEditMode}
          pointerEvents={isEditMode ? 'auto' : 'none'}
          placeholder="Без назви"
          placeholderTextColor={paperColor?.textMuted}
          style={[styles.titleInput, paperColor && { color: paperColor.text }]}
          multiline
        />
        )}

        {/* Calendar days deliberately have no tags at all - the user was
            explicit: keeps the day-flipping simple, and a day never needed
            them the way a real document does. */}
        {!embedded && (
        <DocumentTagsBlock
          tagIds={tagIds}
          tags={tags}
          onAttach={handleAttachTag}
          onDetach={handleDetachTag}
          onCreateAndAttach={handleCreateAndAttachTag}
          onRenameTag={renameTag}
        />
        )}

        <BlockList
          blocks={blocks}
          onReorder={handleReorderBlocks}
          selectedIds={selectedIds}
          isSelectMode={isSelectMode}
          isEditMode={isEditMode}
          textVersions={textVersionsRef.current}
          onToggleSelected={toggleSelected}
          onToggleChecked={toggleChecked}
          onOpenReminder={openReminderBlock}
          onUpdateBlock={updateBlockFields}
          onChangeText={handleBlockChange}
          onBackspaceEmpty={handleBackspaceOnEmpty}
          onFocus={handleBlockFocus}
          onSelectionChange={handleBlockSelectionChange}
          onOpenImage={setViewerImageId}
          onToggleImageFit={toggleImageFit}
          onOpenFile={openFileBlock}
          onDownloadFile={downloadFileBlock}
          onOpenFileDatabase={() => navigation.navigate('Files')}
          onOpenLink={openLinkBlock}
          onOpenLinkDatabase={openLinkDatabase}
          onOpenSketch={openSketchBlock}
          onInputRef={(id, ref) => {
            inputRefs.current[id] = ref;
          }}
          paperColor={paperColor}
        />

        {selectedIds.size === 0 && (
          <Pressable style={styles.addBlock} onPress={addBlockAtEnd}>
            <Ionicons name="add" size={18} color={paperColor?.text ?? '#111827'} />
            <Text style={[styles.addBlockLabel, paperColor && { color: paperColor.text }]}>Додати блок</Text>
          </Pressable>
        )}
      </ScrollView>

      {selectedIds.size > 0 && (
        // Same floating dark-glass capsule as BulkActionBar (Files/Photos/
        // Links/Documents) - this screen has its own bespoke select-mode
        // bar instead of that shared component (blocks aren't tag/group-
        // able the way those rows are), but it was still a plain in-flow
        // row with no capsule styling, and floated right under the
        // edit-mode pencil FAB below.
        <View
          style={[
            styles.selectedActionsWrap,
            embedded && keyboardHeight > 0 && { bottom: keyboardHeight + 16 },
          ]}
          pointerEvents="box-none"
        >
          <View style={styles.selectedActionsCapsule}>
            <Text style={styles.selectedActionsCount}>{selectedIds.size}</Text>
            <View style={styles.selectedActionsDivider} />
            <Pressable style={styles.selectedActionBtn} hitSlop={6} onPress={copySelectedBlocks}>
              <Ionicons name="copy-outline" size={18} color="#fff" />
              <Text style={styles.selectedActionLabel}>Копіювати</Text>
            </Pressable>
            <Pressable style={styles.selectedActionBtn} hitSlop={6} onPress={deleteSelectedBlocks}>
              <Ionicons name="trash-outline" size={18} color="#fff" />
              <Text style={styles.selectedActionLabel}>Видалити</Text>
            </Pressable>
          </View>
        </View>
      )}

      {selectedIds.size === 0 && (
        <Pressable
          style={[
            styles.editModeFab,
            // Embedded, the keyboard also has to be dodged - otherwise
            // there's no way to tap "done" without dismissing it some other
            // way first. (With the keyboard down, the base 100 already
            // clears the floating island and the tags-drawer button.)
            embedded && keyboardHeight > 0 && { bottom: keyboardHeight + 16 },
          ]}
          onPress={toggleEditMode}
        >
          <Ionicons name={isEditMode ? 'checkmark-outline' : 'create-outline'} size={24} color="#fff" />
        </Pressable>
      )}

      {viewerBlock?.imageUri && (
        <Modal
          visible
          transparent
          animationType="fade"
          onRequestClose={() => setViewerImageId(null)}
        >
          {/* RN's Modal renders into its own native window on Android, outside the
              app-level GestureHandlerRootView in App.tsx - gesture-handler
              gestures need their own root re-declared inside it or pinch/pan
              here silently do nothing. */}
          <GestureHandlerRootView style={{ flex: 1 }}>
            <ZoomableImageViewer
              uri={viewerBlock.imageUri}
              onClose={() => setViewerImageId(null)}
              actions={[
                {
                  key: 'rename',
                  icon: 'pencil-outline',
                  label: 'Назва',
                  onPress: () => setImageRenameId(viewerBlock.id),
                },
                {
                  key: 'database',
                  icon: 'server-outline',
                  label: 'База',
                  onPress: () => {
                    setViewerImageId(null);
                    navigation.navigate('Photos');
                  },
                },
                {
                  key: 'share',
                  icon: 'share-social-outline',
                  label: 'Поділитись',
                  onPress: () => shareImageBlock(viewerBlock.imageUri!),
                },
                {
                  key: 'download',
                  icon: 'download-outline',
                  label: 'Завантажити',
                  onPress: () => downloadImageBlock(viewerBlock.imageUri!),
                },
                {
                  key: 'delete',
                  icon: 'trash-outline',
                  label: 'Видалити',
                  color: '#F87171',
                  onPress: () => deleteImageBlockFromViewer(viewerBlock.id),
                },
              ]}
            />
          </GestureHandlerRootView>
        </Modal>
      )}

      <VideoPlayerModal url={playingVideoUrl} onClose={() => setPlayingVideoUrl(null)} />

      {/* Pinned directly above the keyboard, and only mounted while
          isToolbarVisible - EditorToolbar itself only checks
          focusedBlockId (title focus vs. a block), not the keyboard, so
          without this the bar would just slide down to the bottom edge
          and stay rendered there once the keyboard closes, instead of
          disappearing with it. Confirmed on-device: keyboardDidHide does
          fire reliably (this was mis-diagnosed as an event problem before
          logging proved otherwise) - it was this render never having been
          gated on it.
          The window does NOT resize under the keyboard here (measured
          on-device: window stays at the full screen height whether the
          keyboard is up or down, since edge-to-edge delivers the keyboard
          as an inset rather than honouring
          android.softwareKeyboardLayoutMode), so the bar has to be placed
          at `bottom: keyboardHeight` by hand - nothing lifts it for us. */}
      {isToolbarVisible && (
        <View style={[styles.pinnedToolbar, { bottom: keyboardHeight + insets.bottom }]} pointerEvents="box-none">
          <EditorToolbar
            focusedBlockId={focusedBlockId}
            activeSelection={activeSelection}
            onBlockAction={handleBlockAction}
            canUndo={canUndo}
            canRedo={canRedo}
            onUndo={undo}
            onRedo={redo}
            onApplyMarker={applyMarkerToSelection}
            onApplyColor={applyColorToSelection}
          />
        </View>
      )}

      <SketchEditor
        visible={sketchEditorBlockId !== null}
        initialElements={
          (sketchEditorBlockId && blocks.find((b) => b.id === sketchEditorBlockId)?.sketchElements) || []
        }
        onSave={saveSketchElements}
        onClose={closeSketchEditor}
      />

      <ReminderSheet
        visible={reminderBlockId !== null}
        initialDate={reminderBlockId ? blocks.find((b) => b.id === reminderBlockId)?.reminderDate : undefined}
        initialTime={reminderBlockId ? blocks.find((b) => b.id === reminderBlockId)?.reminderTime : undefined}
        onClose={() => setReminderBlockId(null)}
        onSave={saveBlockReminder}
        onClear={clearBlockReminder}
      />

      <RenamePrompt
        visible={imageRenameId !== null}
        title="Назва фото"
        initialValue={imageRenameBlock?.imageTitle ?? ''}
        onCancel={() => setImageRenameId(null)}
        onSave={(title) => {
          if (imageRenameId) renameImageBlock(imageRenameId, title);
          setImageRenameId(null);
        }}
      />

      <GroupPickerSheet
        visible={groupPickerVisible}
        kind="document"
        groups={groups}
        onPick={(id) => {
          setGroupId(id);
          setGroupPickerVisible(false);
        }}
        onClose={() => setGroupPickerVisible(false)}
      />

      {linkTitlePrompt && (
        <Modal visible transparent animationType="fade" onRequestClose={cancelLinkTitlePrompt}>
          <View style={styles.linkPromptBackdrop}>
            <View style={styles.linkPromptCard}>
              <Text style={styles.linkPromptTitle}>Назва посилання</Text>
              <Text style={styles.linkPromptHint}>
                Не вдалося підтягнути заголовок автоматично - введіть назву, щоб потім знайти це посилання в базі.
              </Text>
              <TextInput
                autoFocus
                value={linkTitlePromptValue}
                onChangeText={setLinkTitlePromptValue}
                placeholder="Наприклад: Кафе на Портовій"
                style={styles.linkPromptInput}
              />
              <View style={styles.linkPromptButtons}>
                <Pressable style={styles.linkPromptCancelButton} onPress={cancelLinkTitlePrompt}>
                  <Text style={styles.linkPromptCancelLabel}>Скасувати</Text>
                </Pressable>
                <Pressable
                  style={[
                    styles.linkPromptSaveButton,
                    !linkTitlePromptValue.trim() && styles.linkPromptSaveButtonDisabled,
                  ]}
                  disabled={!linkTitlePromptValue.trim()}
                  onPress={confirmLinkTitlePrompt}
                >
                  <Text style={styles.linkPromptSaveLabel}>Зберегти</Text>
                </Pressable>
              </View>
            </View>
          </View>
        </Modal>
      )}
      {downloadToast && (
        <DownloadToast
          fileName={downloadToast.fileName}
          onShowInFolder={() => showDownloadedFileInFolder(downloadToast.uri, downloadToast.mimeType)}
          onIgnore={dismissDownloadToast}
        />
      )}
      <AddExistingItemModal
        visible={existingItemPickerBlockId !== null}
        onPick={(item) => {
          if (existingItemPickerBlockId) insertExistingItemIntoBlock(existingItemPickerBlockId, item);
        }}
        onClose={() => setExistingItemPickerBlockId(null)}
        excludeIds={
          new Set(
            blocks
              .filter(
                (b) =>
                  ((b.type ?? 'paragraph') === 'file' && b.fileUri) ||
                  ((b.type ?? 'paragraph') === 'image' && b.imageUri) ||
                  // A sticker block reuses its own record's id (any
                  // content type - paragraph/image/sketch), same
                  // collision risk as file/image above.
                  b.isSticker
              )
              .map((b) => b.id)
          )
        }
      />
    </View>
  );
}

export default forwardRef(DocumentEditorScreen);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  // Embedded (CalendarScreen): this white panel sits over the gradient
  // background, not a plain white page - rounded top corners let that
  // gradient show through the cut-away triangles instead of a hard edge.
  containerEmbedded: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    overflow: 'hidden',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  headerRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // Select-mode toggle + "..." merged into one pill, filled the same color
  // as the edit-mode FAB rather than separate plain icon buttons.
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 34,
    borderRadius: 17,
    paddingHorizontal: 12,
    backgroundColor: EDIT_FAB_COLOR,
  },
  headerRightDivider: {
    width: 1,
    height: 14,
    backgroundColor: 'rgba(255,255,255,0.4)',
  },
  exportMenuBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 5,
  },
  exportMenuPanel: {
    position: 'absolute',
    top: 96,
    right: 20,
    width: 180,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    zIndex: 6,
  },
  exportMenuLabel: {
    fontSize: 11,
    fontWeight: '700',
    textTransform: 'uppercase',
    color: '#9CA3AF',
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 2,
  },
  exportMenuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  exportMenuRowLabel: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
  },
  // A translucent-on-terracotta circle while saving, solid white once
  // saved - replaces the old "Збереження…"/"Збережено" text label
  // entirely. Diameter matches headerRight's own height so the circle and
  // the pill read as a matched pair beside each other.
  saveDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(0,0,0,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.5)',
  },
  saveDotSaved: {
    backgroundColor: '#fff',
    borderColor: 'transparent',
  },
  editModeFab: {
    position: 'absolute',
    right: 20,
    // Same height off the bottom as DocumentsScreen's "+" - low enough to
    // reach, high enough that the toolbar pinned along the bottom edge
    // (keyboard down) doesn't cover it.
    bottom: 100,
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: EDIT_FAB_COLOR,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: EDIT_FAB_COLOR,
    shadowOpacity: 0.5,
    shadowOffset: { width: 0, height: 3 },
    shadowRadius: 6,
  },
  scrollArea: {
    flex: 1,
  },
  pinnedToolbar: {
    position: 'absolute',
    left: 0,
    right: 0,
  },
  // Embedded (CalendarScreen): no header and no title/tags block eating
  // the top (calendar days have neither), so the block list needs its own
  // small top breathing room instead.
  scrollAreaEmbedded: {
    paddingTop: 4,
  },
  coverImage: {
    width: '100%',
    height: 180,
  },
  titleInput: {
    // At least 2x the previous 24.
    fontSize: 48,
    fontWeight: '600',
    color: '#111827',
    paddingHorizontal: 20,
    paddingBottom: 12,
  },
  blockListContainer: {
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  blockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'transparent',
    backgroundColor: '#fff',
  },
  blockRowSelected: {
    backgroundColor: '#EFF6FF',
  },
  blockRowBoundary: {
    borderColor: '#E5E7EB',
  },
  // A sticker block keeps this even when selected/boundary-highlighted -
  // it's later in the style array than both, so it wins over
  // blockRowSelected's own background.
  blockRowSticker: {
    backgroundColor: '#FBE97A',
  },
  dragHandle: {
    padding: 6,
  },
  blockInput: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  blockDisplayText: {
    fontSize: 16,
    lineHeight: 22,
  },
  blockPlaceholder: {
    color: '#9CA3AF',
  },
  checkedText: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  prefixedRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  checkboxBlock: {
    flex: 1,
  },
  checkboxReminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    marginLeft: 24,
    marginTop: 2,
  },
  checkboxReminderText: {
    fontSize: 11,
    fontWeight: '600',
    color: ACCENT,
  },
  checkboxReminderTextEmpty: {
    color: '#9CA3AF',
    fontWeight: '500',
  },
  bulletMark: {
    fontSize: 18,
    color: '#111827',
    paddingLeft: 4,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
    marginVertical: 12,
    marginHorizontal: 4,
  },
  tableBlock: {
    flex: 1,
    gap: 6,
    paddingVertical: 4,
  },
  tableFormulaBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  tableFormulaRefBadge: {
    minWidth: 36,
    paddingHorizontal: 6,
    paddingVertical: 4,
    borderRadius: 6,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
  },
  tableFormulaRefText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6B7280',
  },
  tableFormulaInput: {
    flex: 1,
    fontSize: 13,
    color: '#111827',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 6,
  },
  tableFormulaDoneButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: ACCENT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableHeaderRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: 2,
  },
  tableGutterCell: {
    width: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tableGutterText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9CA3AF',
  },
  tableColumnHeaderCell: {
    width: 84,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 4,
  },
  tableColumnHeaderText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#9CA3AF',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tableCell: {
    width: 84,
    justifyContent: 'center',
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 6,
  },
  tableCellSelected: {
    borderColor: ACCENT,
    borderWidth: 2,
    backgroundColor: '#EFF6FF',
  },
  tableCellText: {
    fontSize: 14,
    color: '#111827',
  },
  tableRowRemove: {
    padding: 2,
  },
  tableControls: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 2,
  },
  tableControlBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  tableControlLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#6B7280',
  },
  blockImageWrap: {
    flex: 1,
    height: 180,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
    overflow: 'hidden',
  },
  blockImage: {
    width: '100%',
    height: '100%',
  },
  blockImageTap: {
    flex: 1,
  },
  imageFitToggle: {
    position: 'absolute',
    top: 6,
    right: 6,
    backgroundColor: 'rgba(0,0,0,0.45)',
    borderRadius: 12,
    padding: 5,
  },
  fileBlockRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: '#F3F4F6',
  },
  fileBlockTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  fileBlockName: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
  },
  fileDbButton: {
    padding: 2,
  },
  fileIconWrap: {
    position: 'relative',
  },
  fileCacheBadge: {
    position: 'absolute',
    right: -5,
    bottom: -5,
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: '#16A34A',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: '#F3F4F6',
  },
  fileCacheBadgeMissing: {
    backgroundColor: '#DC2626',
  },
  fileCacheBadgeSpinner: {
    transform: [{ scale: 0.6 }],
  },
  attachmentStatusBox: {
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
  },
  attachmentStatusLabel: {
    fontSize: 11,
    color: '#9CA3AF',
  },
  linkCardVideo: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    overflow: 'hidden',
    position: 'relative',
  },
  linkDbButtonVideo: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkVideoThumbWrap: {
    width: '100%',
    height: 140,
    backgroundColor: '#111827',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkVideoThumb: {
    width: '100%',
    height: '100%',
  },
  linkPlayBadge: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkCardGeneric: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#F3F4F6',
    overflow: 'hidden',
    position: 'relative',
  },
  linkCardGenericTap: {
    flexDirection: 'row',
  },
  linkDbButtonGeneric: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: 'rgba(243,244,246,0.9)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkGenericThumb: {
    width: 80,
    height: 80,
    backgroundColor: '#F3F4F6',
  },
  linkCardBody: {
    flex: 1,
    minWidth: 0,
    padding: 12,
    justifyContent: 'center',
    gap: 4,
  },
  linkCardBodyWithDbButton: {
    paddingRight: 40,
  },
  linkCardTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  linkCardCaption: {
    fontSize: 12,
    color: '#9CA3AF',
  },
  linkCardCompact: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#F9FAFB',
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  linkCardCompactTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 4,
  },
  linkDbButtonCompact: {
    padding: 6,
  },
  linkCompactIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: 'rgba(59,130,246,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  linkCompactIconGeo: {
    backgroundColor: 'rgba(22,163,74,0.12)',
  },
  linkCompactText: {
    flex: 1,
    fontSize: 14,
    color: '#111827',
  },
  linkPromptBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  linkPromptCard: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    gap: 12,
  },
  linkPromptTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
  },
  linkPromptHint: {
    fontSize: 13,
    color: '#6B7280',
    lineHeight: 18,
  },
  linkPromptInput: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: '#111827',
  },
  linkPromptButtons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 12,
    marginTop: 4,
  },
  linkPromptCancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  linkPromptCancelLabel: {
    fontSize: 15,
    color: '#6B7280',
  },
  linkPromptSaveButton: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 18,
  },
  linkPromptSaveButtonDisabled: {
    backgroundColor: '#BFDBFE',
  },
  linkPromptSaveLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  dropLine: {
    position: 'absolute',
    top: 0,
    left: 8,
    right: 8,
    height: 4,
    borderRadius: 2,
    backgroundColor: ACCENT,
  },
  addBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  addBlockLabel: {
    fontSize: 15,
    color: '#111827',
  },
  selectedActionsWrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 100,
    alignItems: 'center',
  },
  selectedActionsCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: 'rgba(20,20,20,0.55)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
    borderRadius: 24,
    paddingHorizontal: 16,
    paddingVertical: 10,
    shadowColor: '#000',
    shadowOpacity: 0.3,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  selectedActionsCount: {
    fontSize: 14,
    fontWeight: '800',
    color: '#fff',
  },
  selectedActionsDivider: {
    width: 1,
    height: 22,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  selectedActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  selectedActionLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
});
