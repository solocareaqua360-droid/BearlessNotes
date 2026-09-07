import { ReactNode, useEffect, useRef, useState } from 'react';
import {
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
import { dateKey, formatShortDate, parseDateKey } from '../utils/dateLocale';
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
import { deleteDoc, deleteField, doc, getDoc, setDoc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import Svg, { Path, Text as SvgText } from 'react-native-svg';
import { Block, BlockType, SketchElement, Tag } from '../types';
import { RootStackParamList } from '../navigation';
import ZoomableImageViewer from '../components/ZoomableImageViewer';
import RenamePrompt from '../components/RenamePrompt';
import DocumentTagsBlock from '../components/DocumentTagsBlock';
import SketchEditor from '../components/SketchEditor';
import EditorToolbar, { EDITOR_TOOLBAR_HEIGHT } from '../components/EditorToolbar';
import { BlockAction } from '../components/blockActions';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { backupFileToDrive } from '../utils/googleDrive';
import { useTags } from '../hooks/useTags';
import { linkDocId } from '../utils/linkId';

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
  const block: Block = { id, text, type };
  if (type === 'checkbox') block.checked = false;
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
// so the block always has something to show instead of erroring.
type LinkPreview = { title?: string; imageUrl?: string; siteName?: string };

function isMapsUrl(url: string): boolean {
  return /google\.[^/]+\/maps|goo\.gl\/maps|maps\.app\.goo\.gl/i.test(url);
}
function isYouTubeUrl(url: string): boolean {
  return /(youtube\.com\/watch|youtu\.be\/)/i.test(url);
}
function isTikTokUrl(url: string): boolean {
  return /tiktok\.com\//i.test(url);
}

// Google Maps' own "Share" button embeds the place name right in the URL
// path (/maps/place/<name>/...) - reading it back out is free and needs no
// network call. A raw coordinates-only link (no /place/ segment) has no name
// to recover this way; reverse geocoding it would need a paid-tier Google
// API, so that case is left to fall back to a generic "Геоточка" label.
function extractMapsPlaceName(url: string): string | null {
  try {
    const match = new URL(url).pathname.match(/\/maps\/place\/([^/]+)/);
    return match ? decodeURIComponent(match[1].replace(/\+/g, ' ')) : null;
  } catch {
    return null;
  }
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

async function fetchOEmbed(oembedUrl: string): Promise<LinkPreview | null> {
  try {
    const res = await fetch(oembedUrl);
    if (!res.ok) return null;
    const data = await res.json();
    const preview: LinkPreview = {};
    if (data.title) preview.title = data.title;
    if (data.thumbnail_url) preview.imageUrl = data.thumbnail_url;
    if (data.author_name) preview.siteName = data.author_name;
    return preview;
  } catch {
    return null;
  }
}

function decodeHtmlEntities(text: string): string {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function extractMetaTag(html: string, property: string): string | null {
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${property}["'][^>]+content=["']([^"']*)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${property}["']`, 'i'),
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    if (match) return decodeHtmlEntities(match[1]);
  }
  return null;
}

async function fetchOpenGraphPreview(url: string): Promise<LinkPreview | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const html = await res.text();
    const preview: LinkPreview = {};
    const title = extractMetaTag(html, 'og:title');
    const image = extractMetaTag(html, 'og:image');
    const siteName = extractMetaTag(html, 'og:site_name');
    if (title) preview.title = title;
    if (image) preview.imageUrl = image;
    if (siteName) preview.siteName = siteName;
    return Object.keys(preview).length > 0 ? preview : null;
  } catch {
    return null;
  }
}

async function fetchLinkPreview(url: string): Promise<LinkPreview> {
  if (isMapsUrl(url)) {
    const placeName = extractMapsPlaceName(url);
    return placeName ? { title: placeName, siteName: 'Геоточка' } : { siteName: 'Геоточка' };
  }
  if (isYouTubeUrl(url)) {
    const oembed = await fetchOEmbed(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
    if (oembed) return { ...oembed, siteName: oembed.siteName ? `${oembed.siteName} · YouTube` : 'YouTube' };
  }
  if (isTikTokUrl(url)) {
    const oembed = await fetchOEmbed(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
    if (oembed) return { ...oembed, siteName: oembed.siteName ? `${oembed.siteName} · TikTok` : 'TikTok' };
  }
  const og = await fetchOpenGraphPreview(url);
  if (og) return { ...og, siteName: og.siteName ?? hostnameOf(url) };
  return { siteName: hostnameOf(url) };
}

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

async function downloadToDevice(sourceUri: string, fileName: string, mimeType: string) {
  const dirUri = await getDownloadDirUri();
  if (!dirUri) return;
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
  };
  try {
    await writeInto(dirUri);
  } catch {
    // The previously granted folder may have been revoked since (e.g. the
    // user cleared it from Android's settings) - ask once more instead of
    // silently failing on every future download.
    const freshDirUri = await getDownloadDirUri(true);
    if (!freshDirUri) return;
    await writeInto(freshDirUri);
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
};

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

  // There's no cloud copy yet, so the cache file IS the only copy - Android
  // can purge app cache under storage pressure, which would silently orphan
  // the block. Checking on each mount (not just trusting that attaching it
  // succeeded) is what makes the badge an honest confirmation rather than a
  // decoration that's still green after the file is actually gone.
  const [fileCached, setFileCached] = useState<boolean | null>(null);
  useEffect(() => {
    if (type !== 'file' || !item.fileUri) return;
    let cancelled = false;
    LegacyFileSystem.getInfoAsync(item.fileUri).then((info) => {
      if (!cancelled) setFileCached(info.exists);
    });
    return () => {
      cancelled = true;
    };
  }, [type, item.fileUri]);

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
    content = item.imageUri ? (
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
    ) : (
      <Text style={styles.blockPlaceholder}>Немає зображення</Text>
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
  } else if (type === 'file') {
    // No cloud upload yet - the URI is the file picker's own local cache
    // copy, so opening it (via the OS's "open with" sheet) works instantly
    // and offline on this device, but the block won't resolve on another one.
    content = (
      <View style={styles.fileBlockRow}>
        <Pressable
          disabled={isSelectMode}
          onPress={() => onOpenFile(item.id)}
          style={styles.fileBlockTap}
        >
          <View style={styles.fileIconWrap}>
            <Ionicons name={fileIconFor(item.fileName)} size={22} color={fileIconColorFor(item.fileName)} />
            {fileCached !== null && (
              <View style={[styles.fileCacheBadge, !fileCached && styles.fileCacheBadgeMissing]}>
                <Ionicons name={fileCached ? 'checkmark' : 'close'} size={9} color="#fff" />
              </View>
            )}
          </View>
          <Text style={styles.fileBlockName} numberOfLines={1}>
            {item.fileName ?? 'Файл'}
          </Text>
        </Pressable>
        {!isSelectMode && (
          <>
            <Pressable hitSlop={8} onPress={onOpenFileDatabase} style={styles.fileDbButton}>
              <Ionicons name="server-outline" size={16} color="#6B7280" />
            </Pressable>
            <Pressable hitSlop={8} onPress={() => onDownloadFile(item.id)}>
              <Ionicons name="download-outline" size={18} color="#6B7280" />
            </Pressable>
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
        style={[styles.blockInput, item.checked && styles.checkedText]}
        multiline
      />
    ) : (
      // Outside edit mode, formatting markers (**bold** etc.) are parsed
      // into styled runs instead of showing as raw text - and a plain
      // Text has no touch handling of its own to fight the ScrollView.
      <View key="locked" style={styles.blockInput} pointerEvents="none">
        <Text style={[styles.blockDisplayText, item.checked && styles.checkedText]}>
          {item.text ? (
            <FormattedText segments={parseFormattedText(item.text)} defaultColor="#111827" />
          ) : (
            <Text style={styles.blockPlaceholder}>…</Text>
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
        {reminderLabel && (
          <View style={styles.checkboxReminderRow}>
            <Ionicons name="alarm-outline" size={11} color={ACCENT} />
            <Text style={styles.checkboxReminderText}>{reminderLabel}</Text>
          </View>
        )}
        </View>
      );
    } else {
      content = textField;
    }
  }

  return (
    <View
      style={[styles.blockRow, isSelected && styles.blockRowSelected, showBoundary && styles.blockRowBoundary]}
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
          name={isSelectMode ? (isSelected ? 'checkbox' : 'square-outline') : 'reorder-two-outline'}
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
            listNumber={listNumber}
            textVersion={textVersion}
            onChangeText={onChangeText}
            onBackspaceEmpty={onBackspaceEmpty}
            onToggleSelected={onToggleSelected}
            onToggleChecked={onToggleChecked}
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
  | NativeStackScreenProps<RootStackParamList, 'Editor'>
  | {
      embedded: true;
      documentId: string;
      navigation: NativeStackNavigationProp<RootStackParamList>;
      extraFields?: Record<string, unknown>;
    };

export default function DocumentEditorScreen(props: Props) {
  const embedded = 'embedded' in props;
  const documentId = 'embedded' in props ? props.documentId : props.route.params.documentId;
  const navigation = props.navigation;
  const extraFields = 'embedded' in props ? (props.extraFields ?? {}) : {};
  const [title, setTitle] = useState('');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const [tagIds, setTagIds] = useState<string[]>([]);
  const { tags, attachTag, detachTag, createAndAttachTag, renameTag } = useTags();
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
  const [imageRenameId, setImageRenameId] = useState<string | null>(null);
  const [sketchEditorBlockId, setSketchEditorBlockId] = useState<string | null>(null);
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
      const snapshot = await getDoc(doc(db, 'documents', documentId));
      const data = snapshot.data();
      setTitle(data?.title ?? '');
      setTagIds(data?.tagIds ?? []);
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
      // project/today assignment from the mirror - no explicit field
      // deletion needed.
      if (b.projectId) taskDoc.projectId = b.projectId;
      if (b.todayMarkedDate) taskDoc.todayMarkedDate = b.todayMarkedDate;
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
      setDoc(doc(db, 'photos', b.id), photoDoc, { merge: true });
      // A genuinely new photo (not one already mirrored before this
      // render) also gets backed up to Google Drive, if connected -
      // fire-and-forget, since a failed/skipped backup must never block
      // attaching the photo itself.
      if (!knownPhotoBlockIdsRef.current.has(b.id)) {
        backupFileToDrive(b.imageUri!, `${b.id}.jpg`, 'image/jpeg', 'Photos').then((driveFileId) => {
          if (driveFileId) updateDoc(doc(db, 'photos', b.id), { driveFileId });
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
      setDoc(doc(db, 'files', b.id), fileDoc, { merge: true });
      if (!knownFileBlockIdsRef.current.has(b.id)) {
        backupFileToDrive(b.fileUri!, b.fileName ?? b.id, b.mimeType ?? 'application/octet-stream', 'Files').then(
          (driveFileId) => {
            if (driveFileId) updateDoc(doc(db, 'files', b.id), { driveFileId });
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
      setDoc(
        doc(db, 'documents', documentId),
        { title, blocks, updatedAt: Date.now(), ...extraFields },
        { merge: true }
      ).then(() => setSaveStatus('saved'));
      syncTasksForDocument(blocks);
      syncLinksForDocument(blocks);
      syncPhotosForDocument(blocks);
      syncFilesForDocument(blocks);
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, blocks, isLoaded]);

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

  function toggleImageFit(id: string) {
    snapshotBeforeChange();
    setBlocks((prev) =>
      prev.map((b) =>
        b.id === id ? { ...b, imageFit: (b.imageFit ?? 'contain') === 'contain' ? 'cover' : 'contain' } : b
      )
    );
  }

  function downloadImageBlock(uri: string) {
    downloadToDevice(uri, `photo-${Date.now()}.jpg`, 'image/jpeg');
  }

  function downloadFileBlock(id: string) {
    const block = blocks.find((b) => b.id === id);
    if (!block?.fileUri) return;
    downloadToDevice(block.fileUri, block.fileName ?? 'file', block.mimeType ?? 'application/octet-stream');
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
      setBlocks((prev) => prev.map((b) => (b.id === id ? buildBlock(id, type, '') : b)));
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
    snapshotBeforeChange();
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === id);
      if (index === -1) return prev;
      const next = [...prev];
      next[index] = { ...buildBlock(id, 'image', ''), imageUri: uri };
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
      case 'file':
        pickFileForBlock(blockId);
        return;
      case 'scan':
        scanDocumentForBlock(blockId);
        return;
      case 'sketch':
        addSketchBlock(blockId);
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
    return <View style={[styles.container, embedded && styles.containerEmbedded]} />;
  }

  return (
    <View style={[styles.container, embedded && styles.containerEmbedded]}>
      {!embedded && (
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back" size={22} color="#111827" />
          </Pressable>
        </View>
        <Text style={styles.headerStatus}>
          {saveStatus === 'saving' ? 'Збереження…' : 'Збережено'}
        </Text>
        <View style={styles.headerRight}>
          <Pressable hitSlop={6} onPress={toggleSelectMode}>
            <Ionicons name={isSelectMode ? 'close' : 'ellipse-outline'} size={19} color="#fff" />
          </Pressable>
          <View style={styles.headerRightDivider} />
          <Pressable
            hitSlop={6}
            onPress={() => navigation.navigate('Placeholder', { icon: 'ellipsis-horizontal-outline', label: 'Скоро' })}
          >
            <Ionicons name="ellipsis-horizontal-outline" size={19} color="#fff" />
          </Pressable>
        </View>
      </View>
      )}

      {/* Embedded (CalendarScreen): the select-mode control the header
          carries in the full-screen editor, as one slim row - the
          embedding screen owns the top of the screen, so there's no
          header here to hang it off. Undo/redo live in the pinned toolbar
          now (both here and in the full-screen header above), not here. */}
      {embedded && (
        <View style={styles.embeddedToolbar}>
          <Text style={styles.headerStatus}>{saveStatus === 'saving' ? 'Збереження…' : 'Збережено'}</Text>
          <View style={styles.embeddedToolbarButtons}>
            <Pressable hitSlop={10} onPress={toggleSelectMode}>
              <Ionicons name={isSelectMode ? 'close' : 'ellipse-outline'} size={20} color="#111827" />
            </Pressable>
          </View>
        </View>
      )}

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
        {!embedded && (
        <TextInput
          key={isEditMode ? 'editable' : 'locked'}
          value={title}
          onChangeText={handleTitleChange}
          // The pinned toolbar acts on a block, not the title - hide it
          // rather than have it apply to whatever block last had focus.
          onFocus={() => setFocusedBlockId(null)}
          editable={isEditMode}
          pointerEvents={isEditMode ? 'auto' : 'none'}
          placeholder="Без назви"
          style={styles.titleInput}
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
        />

        {selectedIds.size > 0 ? (
          <Pressable style={styles.deleteSelected} onPress={deleteSelectedBlocks}>
            <Ionicons name="trash-outline" size={18} color={DANGER} />
            <Text style={styles.deleteSelectedLabel}>Видалити ({selectedIds.size})</Text>
          </Pressable>
        ) : (
          <Pressable style={styles.addBlock} onPress={addBlockAtEnd}>
            <Ionicons name="add" size={18} color="#111827" />
            <Text style={styles.addBlockLabel}>Додати блок</Text>
          </Pressable>
        )}
      </ScrollView>

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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
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
  headerStatus: {
    fontSize: 13,
    color: '#9CA3AF',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
  },
  embeddedToolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  embeddedToolbarButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 18,
  },
  // Select-mode toggle + "..." merged into one pill, filled the same color
  // as the edit-mode FAB rather than two separate plain icon buttons.
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
  deleteSelected: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  deleteSelectedLabel: {
    fontSize: 15,
    color: DANGER,
  },
});
