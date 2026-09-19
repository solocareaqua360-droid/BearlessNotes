import { ForwardedRef, forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Dimensions,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView as RNScrollView,
  StyleSheet,
  Text,
  TextInput,
  UIManager,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { useFlattenPhoto } from '../hooks/useFlattenPhoto';
import { scanPages } from '../utils/documentScanner';
import * as Print from 'expo-print';
import * as Clipboard from 'expo-clipboard';
import { insertedPiece, parsePastedText, worthSplitting, type ParsedBlock } from '../utils/pasteBlocks';
import { dateKey, formatShortDate, parseDateKey } from '../utils/dateLocale';
import ReminderSheet from '../components/ReminderSheet';
import { cancelReminder, scheduleReminder, type ReminderKind } from '../utils/reminders';
// The new expo-file-system File/Directory API tracks read permission per
// picked URI internally and rejects copying a URI it didn't hand out
// itself ("Missing 'READ' permission") - the legacy module just wraps a
// plain native file copy given two paths, which is what actually works
// for re-homing a file expo-document-picker (a different module) picked.
import * as LegacyFileSystem from 'expo-file-system/legacy';
// react-native-gesture-handler's own ScrollView (not the core RN one) so it
// shares the same touch arena as our rows' Pan gestures - otherwise a swipe
// starting on a block (its TextInput especially) never reaches the
// ScrollView's own scroll recognition and only the icon column can scroll.
import { GestureHandlerRootView, ScrollView } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  scrollTo,
  useAnimatedReaction,
  useAnimatedRef,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { useEditorKeyboard, useKeyboardState } from '../hooks/useEditorKeyboard';
import { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  getDocFromCache,
  onSnapshot,
  query,
  updateDoc,
} from '../firestore';
import { ownedQuery, setDoc } from '../utils/owned';
import SaveDestinationSheet from '../components/SaveDestinationSheet';
import { addItemToBoard, createBoardAndAddItem } from '../utils/addItemToBoard';
import { db } from '../firebase';
import { Block, CanvasLink, BlockType, Group, SketchElement, Tag } from '../types';
import { groupAppliesTo } from '../utils/groups';
import { RootStackParamList } from '../navigation';
import ZoomableImageViewer from '../components/ZoomableImageViewer';
import VideoPlayerModal from '../components/VideoPlayerModal';
import RenamePrompt from '../components/RenamePrompt';
import DocumentTagsBlock from '../components/DocumentTagsBlock';
import SketchEditor from '../components/SketchEditor';
import EditorToolbar, { EDITOR_TOOLBAR_HEIGHT } from '../components/EditorToolbar';
import { BLOCK_ACTIONS, BlockAction } from '../components/blockActions';
import { clearCopiedObject, getCopiedObject, useCopiedObject } from '../utils/objectClipboard';
import { backupFileToDrive } from '../utils/googleDrive';
import { ensureFileIsHere, openFileExternally } from '../utils/openFileExternally';
import TextRecognizer, {
  RecognizeProgress,
  RecognizeRequest,
  RecognizedPage,
} from '../components/TextRecognizer';
import TextSelection from '../components/TextSelection';
import { ask, confirm, notify } from '../components/surfaces/Ask';
import { clipBlocksToNote, clippedBlock } from '../utils/copyToNote';
import DocumentQuickLook, { QuickLookKind, quickLookKindFor } from '../components/DocumentQuickLook';
import GroupPickerSheet, { CAMERA_PHOTOS_GROUP_ID } from '../components/GroupPickerSheet';
import { useTags } from '../hooks/useTags';
import { measureNode } from '../utils/measureNode';
import { setSelection } from '../utils/setSelection';
import { autoGrowInput } from '../utils/autoGrowInput';
import { applyLiveRecord, recordIdFor, useLiveRecords } from '../hooks/useLiveRecords';
import { attachmentInfoText } from '../utils/attachmentInfo';
import { showDownloadedFile } from '../utils/downloadToFolder';
import AttachmentImage from '../components/AttachmentImage';
import DocumentCanvas, { DocumentCanvasHandle } from '../components/DocumentCanvas';
import CanvasReferencePanel from '../components/CanvasReferencePanel';
import CrashBoundary from '../components/CrashBoundary';
import { assembleWithDivider } from '../utils/canvasOrder';
import { stableStringify } from '../utils/stableStringify';
import { hapticToggle } from '../utils/haptics';
import { linkDocId } from '../utils/linkId';
import { getVideoEmbedInfo } from '../utils/videoEmbed';
import { fetchLinkPreview, LinkPreview } from '../utils/linkPreview';
import { useRecordColour, useStyles, useTheme } from '../theme/ThemeProvider';
import { makeStyles } from '../components/documentEditorStyles';
import BlockList from '../components/BlockList';
import {
  buildBlock,
  buildDocumentHtml,
  buildDocumentText,
  COLOR_CLOSE,
  COLOR_OPEN,
  displayIndexForRawIndex,
  displayValueOf,
  downloadToDevice,
  generateId,
  HIGHLIGHT_CLOSE,
  HIGHLIGHT_OPEN,
  LIST_TYPES,
  newBlock,
  parseFormattedText,
  plainTextOf,
  rawIndexForDisplayIndex,
  sanitizeFileName,
} from '../utils/documentBlocks';
import type { colorForDocument } from '../utils/documentColor';
import { useDownloadToast } from '../hooks/useDownloadToast';
import DownloadToast from '../components/DownloadToast';
import UndoToast from '../components/UndoToast';
import GlassDrop, { GlassIcon } from '../components/GlassDrop';
import { COVER_GRADIENTS, CoverGradientView } from '../theme/covers';
import StockPhotoPicker from '../components/StockPhotoPicker';
import AddExistingItemModal from '../components/AddExistingItemModal';
import { BlurView } from 'expo-blur';
import { useIsFocused } from '@react-navigation/native';
import {
  useDockActions,
  useDockBeads,
  useDockOpensOnActions,
  useDockShowContext,
  useNavDockFace,
} from '../navigation/navDock';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { GlassPortal } from '../components/GlassPortal';
import { useBlurTarget } from '../components/GlassTarget';
import { GLASS_DANGER, GLASS_TEXT, GLASS_TEXT_FAINT } from '../constants/glass';
import { CAPSULE_DROP, CHROME_TOP, RAIL_RIGHT } from '../constants/rail';
import { dockRowWidth, useDockClearance } from '../navigation/dockGeometry';
import SaveRing from '../components/SaveRing';

// The rail's capsule stood on its end is RAIL_WIDTH across; lying down on
// a pane's left edge it is this tall - 19 of padding above and below a
// 24px icon, inside the 1px border. What the title has to clear there.
const HORIZONTAL_CAPSULE_HEIGHT = 19 * 2 + 24 + 2;

// The subset of BLOCK_ACTIONS that make sense applied to a whole GROUP
// of selected blocks at once - a type flip with no side effect on the
// document's own array length or contents. The rest of BLOCK_ACTIONS
// (image/camera/file/scan/sketch/table/existing) each open an
// interactive picker for ONE target and have no honest bulk meaning;
// divider is left out too - converting several blocks to dividers at
// once would also mean splicing a new empty block in after each one
// (see convertBlockType's own divider branch), which is a different,
// more surprising shape of change than the plain flips here.
const SELECT_FORMAT_ACTIONS = BLOCK_ACTIONS.filter((a) =>
  (['heading', 'bulleted', 'numbered', 'checkbox', 'code'] as BlockAction[]).includes(a.key)
);

// The same actions, named for a button a quarter of a card wide. The
// full names come from the "+" sheet, where there is a whole row each;
// "Нумерований список" under an icon this size would shrink to the point
// of being a grey smudge, which is worse than a shorter true word.
const SELECT_FORMAT_LABELS: Partial<Record<BlockAction, string>> = {
  heading: 'Заголовок',
  bulleted: 'Список',
  numbered: 'Нумерація',
  checkbox: 'Чекбокс',
  code: 'Код',
};

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

// Палітра №3 (Теплий Теракотовий) - just for the edit-mode FAB, matching
// DocumentsScreen's "+". Everything else in the editor takes the
// theme's own accent, which a colour scheme can move.
const EDIT_FAB_COLOR = '#BE7657';
const DANGER = '#EF4444';
const AUTOSAVE_DELAY_MS = 600;
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
    }
  // Pane mode (DocumentsScreen's two-pane layout on a wide screen): the
  // WHOLE editor, header and title and cover included - unlike embedded
  // mode, which strips all of that because the calendar draws its own.
  // The only difference from the stack screen is that there's no stack to
  // pop: the back arrow hands the pane back to the list instead.
  | {
      pane: true;
      documentId: string;
      navigation: NativeStackNavigationProp<RootStackParamList>;
      autoFocusTitle?: boolean;
      onClose: () => void;
      // The pane taking the whole window, list and all. Offered only in
      // pane mode: on a phone every document is already full-screen, so
      // the button would toggle nothing.
      isFullscreen?: boolean;
      // Where this pane's right edge is, measured in from the window's -
      // in two panes the rail belongs on the pane's edge, not the
      // window's, or it lands on top of the other half.
      railRight?: number;
      // With the document on the LEFT half, its rail belongs on the
      // window's left edge - the right one is the list's.
      railLeft?: number;
      // The line the list's own cards start on. In two panes the document
      // starts there too, so the two halves read as one row - and the
      // capsule sits on that line, over the cover.
      railTop?: number;
      onToggleFullscreen?: () => void;
      // A note made out of THIS one's blocks takes the pane this one is
      // in, instead of being pushed over the whole window: the board or
      // the list on the other half stays where it is, and the clipping
      // opens beside it ready to edit. Without this the clipping covered
      // the very thing it was being made next to.
      onOpenInPane?: (documentId: string, options?: { offerBoard?: boolean }) => void;
      // The pane's own way of carrying what the route param carries for a
      // pushed screen - see navigation.ts's offerBoard.
      offerBoard?: boolean;
      // Mirrored out so the screen around this pane can hold off writing
      // the same document while there are keystrokes here that haven't
      // been saved yet - see BoardScreen's live rebuild.
      onSaveStatusChange?: (status: 'saved' | 'saving') => void;
    };

export type DocumentEditorHandle = {
  toggleSelectMode: () => void;
};

function DocumentEditorScreen(props: Props, ref: ForwardedRef<DocumentEditorHandle>) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const embedded = 'embedded' in props;
  // Puts a shared/downloaded photo together with its drawing - see
  // useFlattenPhoto. `flattenNode` mounts off-screen; it only ever
  // draws for the one frame a flatten is actually happening.
  const { flatten: flattenPhoto, node: flattenNode } = useFlattenPhoto();
  // The editor's own controls stand on the right edge the way the
  // documents screen's do. Drawn through the portal for the blur's sake,
  // which means they have to withdraw when this screen isn't the one on
  // show - a native stack keeps the screen under the top one mounted.
  const editorBlurTarget = useBlurTarget();
  const editorFocused = useIsFocused();
  const editorInsets = useSafeAreaInsets();
  const railRight = 'pane' in props ? (props.railRight ?? RAIL_RIGHT) : RAIL_RIGHT;
  const railLeft = 'pane' in props ? props.railLeft : undefined;
  const railTop = 'pane' in props ? props.railTop : undefined;
  // Which edge the rail stands on, and which way its menu opens from it.
  const railSide = railLeft !== undefined ? { left: railLeft } : { right: railRight };
  // On the left edge the capsule lies down: standing on its end there it
  // ran straight through the title and the first blocks, which is the one
  // thing the rail must never do on the side the text starts from.
  const railHorizontal = railLeft !== undefined;
  // The "…" panel used to open BESIDE the rail, so it needed to know
  // which edge the rail stood on. It drops out of the dock now and is as
  // wide as the dock, so it has no side to pick.

  // A document with nothing in it is not a document. Anything a block can
  // carry counts, not just text - an image or an embedded row with no
  // caption is still content.
  function hasContent(t: string, bs: Block[], cover?: string) {
    const titled = t.trim() !== '' && t.trim() !== 'Без назви';
    if (titled || cover) return true;
    return bs.some(
      (b) =>
        !!b.text?.trim() ||
        !!b.imageUri ||
        !!b.fileUri ||
        !!b.linkUrl ||
        !!b.sketchElements?.length ||
        !!b.dbRowDatabaseId ||
        !!b.dbViewDatabaseId ||
        b.type === 'divider' ||
        b.type === 'table'
    );
  }

  function confirmDeleteDocument() {
    setExportMenuOpen(false);
    confirm({
      title: 'У кошик?',
      message: 'Нотатку можна буде повернути з кошика протягом 30 днів.',
      confirmLabel: 'У кошик',
    }).then(async (yes) => {
      if (!yes) return;
      // Into the bin, not gone: the tags, mirrors and arrows stay as they
      // are so a restored note is the whole note. Throwing it away for
      // good is the bin's job - see the documents screen.
      await setDoc(doc(db, 'documents', documentId), { deletedAt: Date.now() }, { merge: true });
      if (closePane) closePane();
      else navigation.goBack();
    });
  }
  const documentId =
    'embedded' in props ? props.documentId : 'pane' in props ? props.documentId : props.route.params.documentId;
  const navigation = props.navigation;
  const extraFields = 'embedded' in props ? (props.extraFields ?? {}) : {};
  const onSelectModeChange = 'embedded' in props ? props.onSelectModeChange : undefined;
  const onSaveStatusChange =
    'embedded' in props ? props.onSaveStatusChange : 'pane' in props ? props.onSaveStatusChange : undefined;
  // In a pane there is nothing on a stack to go back to - the arrow empties
  // the pane and leaves the list beside it alone.
  const closePane = 'pane' in props ? props.onClose : null;
  const paneFullscreen = 'pane' in props ? !!props.isFullscreen : false;
  const onToggleFullscreen = 'pane' in props ? props.onToggleFullscreen : undefined;
  // Only set right after DocumentsScreen creates a brand-new document - see
  // navigation.ts's own comment on this param.
  const autoFocusTitle =
    'pane' in props ? !!props.autoFocusTitle : !embedded && !('pane' in props) && !!props.route.params.autoFocusTitle;
  // This note was just cut out of another one, and the offer to put it on
  // a board came in with it - see clipSelectedToNote. Shown once: state,
  // not the param itself, so dismissing it actually dismisses it.
  const [boardOffer, setBoardOffer] = useState(
    'pane' in props
      ? !!props.offerBoard
      : !embedded && !!props.route.params.offerBoard
  );
  // In a pane the clipping replaces THIS pane's document rather than
  // being pushed over the screen beside it.
  const openInPane = 'pane' in props ? props.onOpenInPane : undefined;
  const [boardPicker, setBoardPicker] = useState(false);
  const recordColour = useRecordColour();
  const [title, setTitle] = useState('');
  // Set on a daily note - the calendar writes it (see extraFields), and
  // so does a task made from outside one. A day's name is its DATE: the
  // diary list has always called it that, the calendar draws it in its
  // own header, and only this screen, opening a day raw, called it «Без
  // назви» - "враження складається, що це якась нотатка... не повинно
  // бути плутанини".
  const [calendarDate, setCalendarDate] = useState<string | null>(null);
  const [blocks, setBlocks] = useState<Block[]>([]);
  // «Полотно» - the same document as a surface rather than a page. A view,
  // not a second copy: what moves on it is the block itself (see
  // DocumentCanvas and Block.canvas). Never for the embedded daily note,
  // which is a sheet inside another screen with no room for a canvas.
  const [canvasMode, setCanvasMode] = useState(false);
  // Whether a card on the canvas currently has the caret in it, and the
  // way to ask the canvas to let go of it. The rail's back arrow used to
  // walk out of the document while the caret was still blinking; ending
  // the typing is what "back" means at that moment.
  const canvasApiRef = useRef<DocumentCanvasHandle | null>(null);
  // «Референси» - see CanvasReferencePanel. Closed by default even while
  // in canvas mode; the user's own workflow is to open it, drag a few
  // things over, close it, and keep working with just the board.
  const [referencePanelOpen, setReferencePanelOpen] = useState(false);
  useEffect(() => {
    if (!canvasMode) setReferencePanelOpen(false);
  }, [canvasMode]);
  const [canvasEditing, setCanvasEditing] = useState(false);
  // The arrows between cards on the canvas - a keyed map, see
  // DocumentItem.canvasLinks. Saved with the document, like everything
  // else on this screen.
  const [canvasLinks, setCanvasLinks] = useState<Record<string, CanvasLink>>({});

  // Leaving the canvas is when its arrows are honoured: the page is
  // reordered to read down the chains - see orderByCanvasLinks for the
  // rule. Here and not while arrows are being drawn, so the page never
  // reshuffles under a reader who has not asked to see it; and through
  // handleReorderBlocks, so it is one undo away like any other reorder.
  // Shown after leaving the canvas, only when the arrows actually changed
  // something - a silent reorder read as the page shuffling itself.
  // Auto-dismisses like every other toast in the app; "Скасувати" is the
  // editor's own undo, since handleReorderBlocks already snapshots before
  // applying the new order.
  const [canvasReorderToast, setCanvasReorderToast] = useState(false);
  useEffect(() => {
    if (!canvasReorderToast) return;
    const timeoutId = setTimeout(() => setCanvasReorderToast(false), 4000);
    return () => clearTimeout(timeoutId);
  }, [canvasReorderToast]);

  function leaveCanvas() {
    // What the arrows assembled, a line, then the leftovers - see
    // assembleWithDivider. The line is an ordinary divider block of this
    // document's, made the way every block here is made.
    const reordered = assembleWithDivider(blocks, canvasLinks, () =>
      buildBlock(generateId(), 'divider', '')
    );
    if (reordered !== blocks) {
      handleReorderBlocks(reordered);
      setCanvasReorderToast(true);
    }
    setCanvasMode(false);
  }
  const [tagIds, setTagIds] = useState<string[]>([]);
  // Cover image and "paper color" (below) - see the "..." menu. Both are
  // local-only settings (no cloud backup for the cover, same as any other
  // image block before its own async Drive upload finishes) and both are
  // skipped entirely in embedded mode (CalendarScreen's daily notes),
  // matching the header/title/tags block right above them.
  const [coverImageUri, setCoverImageUri] = useState<string | undefined>(undefined);
  // The chosen cover gradient's id - see theme/covers. Saved beside the
  // cover picture and synced the same way.
  const [coverGradient, setCoverGradient] = useState<string | undefined>(undefined);
  // "Пошук зображень" from the cover menu - see StockPhotoPicker.
  const [searchingCover, setSearchingCover] = useState(false);
  // A note created and then left untouched shouldn't be kept. Gated on
  // autoFocusTitle, which is set only when the document was made a moment
  // ago by the "+" button - opening an existing empty note and backing out
  // of it must never delete it.
  const bornEmptyRef = useRef(autoFocusTitle);
  const contentRef = useRef({ title, blocks, coverImageUri });
  contentRef.current = { title, blocks, coverImageUri };
  useEffect(
    () => () => {
      if (!bornEmptyRef.current) return;
      const { title: t, blocks: b, coverImageUri: c } = contentRef.current;
      if (hasContent(t, b, c)) return;
      deleteDoc(doc(db, 'documents', documentId)).catch(() => {});
    },
    []
  );

  // Recolors the page to this document's OWN card color (colorForDocument)
  // - the same color already shown for it everywhere else in the app
  // (Documents grid, Files/Links/BoardsList tiles) - rather than a
  // separately-picked color, so a document always has exactly one color
  // identity across the whole app.
  const [paperColorEnabled, setPaperColorEnabled] = useState(false);
  const paperColor = paperColorEnabled ? recordColour(documentId) : null;
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
    return onSnapshot(ownedQuery('groups'), (snapshot) => {
      setGroups(
        snapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Group, 'id'>) }))
          .filter((g) => groupAppliesTo(g, 'document'))
          .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
      );
    });
  }, [embedded]);
  const { tags, attachTag, detachTag, createAndAttachTag, renameTag } = useTags();
  const { downloadToast, showDownloadToast, dismissDownloadToast } = useDownloadToast();
  const [isLoaded, setIsLoaded] = useState(false);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving'>('saved');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isSelectMode, setIsSelectMode] = useState(false);
  // The title behaves like a block: plain text until tapped, a live input
  // while being edited. Starts active only for a brand-new document (see
  // autoFocusTitle), which is what raises the keyboard onto it right away.
  const [titleActive, setTitleActive] = useState(autoFocusTitle);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
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
  // Reading the text off a page - see TextRecognizer. `after` is the block
  // the result is put under, so a scan and its text stay together.
  const [recognizing, setRecognizing] = useState<{
    request: RecognizeRequest;
    after: string;
  } | null>(null);
  const [recognizeProgress, setRecognizeProgress] = useState<RecognizeProgress | null>(null);
  // The pages just scanned, waiting to be told what to become.
  // The recognised pages, waiting for the user to pick what they want
  // off them.
  const [selecting, setSelecting] = useState<{ pages: RecognizedPage[]; after: string } | null>(null);

  function startRecognizing(uris: string[], after: string) {
    setRecognizeProgress({ page: 1, of: uris.length, progress: 0 });
    setRecognizing({ request: { uris }, after });
  }
  const [playingVideoUrl, setPlayingVideoUrl] = useState<string | null>(null);
  const [imageRenameId, setImageRenameId] = useState<string | null>(null);
  const [sketchEditorBlockId, setSketchEditorBlockId] = useState<string | null>(null);
  // The Word or Excel file being looked at without leaving the note - see
  // DocumentQuickLook. Carries the record so "open elsewhere" can hand the
  // same file on.
  const [quickLook, setQuickLook] = useState<{
    uri: string;
    name: string;
    kind: QuickLookKind;
    file: { fileUri: string; fileName: string; mimeType?: string; driveFileId?: string };
  } | null>(null);
  const [existingItemPickerBlockId, setExistingItemPickerBlockId] = useState<string | null>(null);
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  // Set on a document generated from a board (see boardToDocument.ts).
  // The board is where the connections and the comment cards stayed - the
  // reasoning behind what this document says - so the document keeps a way
  // back to it rather than trying to carry any of that in its own text.
  const [sourceBoardId, setSourceBoardId] = useState<string | null>(null);
  const copiedObject = useCopiedObject();
  const [reminderBlockId, setReminderBlockId] = useState<string | null>(null);
  const focusIdRef = useRef<string | null>(null);
  const focusToEndRef = useRef(false);
  const focusCursorIndexRef = useRef<number | null>(null);
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
  // The title's own field, kept only so it can be grown to its text as it
  // is typed - see autoGrowInput.
  const titleInputRef = useRef<TextInput | null>(null);
  const dayName = calendarDate ? formatShortDate(parseDateKey(calendarDate)) : null;
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // An animated ref (not a plain useRef) so the keyboard-synced scroll below
  // can drive it from the UI thread; `.current` still works for the plain
  // JS scrollTo calls elsewhere.
  // Typed as the RN instance (what gesture-handler's ScrollView forwards
  // its ref to) - gesture-handler's own `ScrollView` type is the component.
  const scrollViewRef = useAnimatedRef<RNScrollView>();
  const scrollOffsetRef = useRef(0);
  // Same offset, readable from a worklet - the synced scroll needs to know
  // where the list was the moment the keyboard started moving.
  const scrollOffsetSV = useSharedValue(0);
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

  // The same blocks, with every photo/file/link one showing what its
  // record says now rather than what it said when it was inserted. Only
  // listened for when this document actually references something, so a
  // plain text note opens no listeners at all.
  const hasReferenceBlocks = useMemo(
    () => blocks.some((b) => recordIdFor(b) !== null),
    [blocks]
  );
  const liveRecords = useLiveRecords(hasReferenceBlocks);
  const liveBlocks = useMemo(
    () => (hasReferenceBlocks ? blocks.map((b) => applyLiveRecord(b, liveRecords)) : blocks),
    [blocks, liveRecords, hasReferenceBlocks]
  );
  // A link whose title couldn't be fetched automatically (a raw-coordinates
  // Maps link, or any page with no fetchable title) pauses the conversion
  // here instead of silently landing in the `links` mirror unnamed - an
  // unnamed link is one the user will never find again in a future
  // "Посилання" database list.
  const [linkTitlePrompt, setLinkTitlePrompt] = useState<{ blockId: string; url: string; preview: LinkPreview } | null>(
    null
  );
  const [linkTitlePromptValue, setLinkTitlePromptValue] = useState('');

  // The document as the server has it, as far as this screen knows: set
  // from what was loaded, from every version that arrives while the note
  // is open, and from every write of our own. It is the answer to two
  // questions this screen used to get wrong.
  //
  // "Is there anything to save?" - a note used to be written back the
  // moment it was OPENED, without a single edit, because the autosave
  // ran off "the blocks changed" and loading is a change. Opened from a
  // stale cache on one device, that write put the stale copy over the
  // other device's work. Now nothing is written unless it differs from
  // what the server holds.
  //
  // "Which of my blocks are mine?" - when another device's version
  // arrives, a block that differs from this snapshot is one edited here
  // since the last write, and stays; the rest take what arrived.
  type ServerShape = {
    title: string;
    blocks: Block[];
    coverImageUri: string | undefined;
    coverGradient: string | undefined;
    paperColorEnabled: boolean;
    groupId: string | null;
    canvasLinks: Record<string, CanvasLink>;
  };
  // Sync diagnostics, in the browser's console only. Put in while the
  // note sync was being chased across two devices; costs nothing on a
  // phone, where it does not run.
  function syncLog(what: string, detail?: unknown) {
    if (Platform.OS !== 'web') return;
    // eslint-disable-next-line no-console
    console.log(`[sync ${new Date().toISOString().slice(11, 23)}] ${what}`, detail ?? '');
  }
  const serverRef = useRef<ServerShape | null>(null);
  const serverBlockRef = useRef<Map<string, string>>(new Map());
  function rememberServer(shape: ServerShape) {
    serverRef.current = shape;
    serverBlockRef.current = new Map(shape.blocks.map((b) => [b.id, stableStringify(b)]));
  }
  function shapeFrom(data: Record<string, unknown> | undefined, blocksNow: Block[]): ServerShape {
    return {
      title: (data?.title as string) ?? '',
      blocks: blocksNow,
      coverImageUri: (data?.coverImageUri as string | undefined) || undefined,
      coverGradient: (data?.coverGradient as string | undefined) || undefined,
      paperColorEnabled: !!data?.paperColorEnabled,
      groupId: (data?.groupId as string | undefined) ?? null,
      canvasLinks: (data?.canvasLinks as Record<string, CanvasLink> | undefined) ?? {},
    };
  }
  function sameAsServer(shape: ServerShape): boolean {
    const server = serverRef.current;
    if (!server) return false;
    return (
      server.title === shape.title &&
      server.coverImageUri === shape.coverImageUri &&
      server.coverGradient === shape.coverGradient &&
      server.paperColorEnabled === shape.paperColorEnabled &&
      server.groupId === shape.groupId &&
      stableStringify(server.canvasLinks) === stableStringify(shape.canvasLinks) &&
      server.blocks.length === shape.blocks.length &&
      shape.blocks.every((b, i) => {
        const was = server.blocks[i];
        return was.id === b.id && serverBlockRef.current.get(b.id) === stableStringify(b);
      })
    );
  }

  // Another device's version, merged in rather than imposed - the
  // board's rule, for the board's reason. Per block: one that differs
  // here from what the server last held is an edit made here and not
  // yet written, and stays; so does the block with the caret in it,
  // whatever its state; a block deleted here stays deleted; everything
  // else, and the order, takes what arrived. Blocks made here and not
  // yet written are kept, each after the block it followed.
  function mergeRemote(remote: ServerShape) {
    const server = serverRef.current;
    const focusedId = focusedBlockIdRef.current;
    // Worked out NOW, from the blocks as they are now, not inside a
    // functional setBlocks. The updater runs later, on the next render -
    // by which time rememberServer below has already replaced "what the
    // server holds" with the version that just arrived. Judged against
    // THAT, every block the other device changed looked like an edit
    // made here, was kept in its old form, and written straight back:
    // two open copies of a note threw one block back and forth every
    // second and a card moved on the phone was returned to where it had
    // been. The order of these two lines is the whole fix.
    {
      const local = contentRef.current.blocks;
      const localById = new Map(local.map((b) => [b.id, b]));
      const serverIds = new Set(server?.blocks.map((b) => b.id) ?? []);
      const isDirty = (b: Block) => serverBlockRef.current.get(b.id) !== stableStringify(b);
      const deletedHere = (id: string) => serverIds.has(id) && !localById.has(id);
      const merged: Block[] = [];
      for (const r of remote.blocks) {
        if (deletedHere(r.id)) continue;
        const mine = localById.get(r.id);
        merged.push(mine && (mine.id === focusedId || isDirty(mine)) ? mine : r);
      }
      // New here, unknown to the server: keep each where it was, after
      // its predecessor if that predecessor is still around.
      const mergedIds = new Set(merged.map((b) => b.id));
      local.forEach((b, index) => {
        if (mergedIds.has(b.id) || serverIds.has(b.id)) return;
        const prev = index > 0 ? local[index - 1].id : null;
        const at = prev ? merged.findIndex((m) => m.id === prev) : -1;
        merged.splice(at === -1 ? merged.length : at + 1, 0, b);
        mergedIds.add(b.id);
      });
      setBlocks(merged);
    }
    if (server && server.title === title) setTitle(remote.title);
    if (server && server.coverImageUri === coverImageUri) setCoverImageUri(remote.coverImageUri);
    if (server && server.coverGradient === coverGradient) setCoverGradient(remote.coverGradient);
    if (server && server.paperColorEnabled === paperColorEnabled) setPaperColorEnabled(remote.paperColorEnabled);
    if (server && server.groupId === groupId) setGroupId(remote.groupId);
    // Arrows are a keyed map, so both sides' additions survive: what
    // changed here since the last write stays, the rest takes the
    // server's.
    setCanvasLinks((local) => {
      const was = server?.canvasLinks ?? {};
      const next: Record<string, CanvasLink> = { ...remote.canvasLinks };
      for (const [id, link] of Object.entries(local)) {
        if (stableStringify(was[id]) !== stableStringify(link)) next[id] = link;
      }
      for (const id of Object.keys(was)) {
        if (!(id in local)) delete next[id];
      }
      return next;
    });
    rememberServer(remote);
  }

  // The listener below is registered once and lives for as long as the
  // note is open; mergeRemote is remade every render with that render's
  // title, cover and so on. Reached through a ref, so the listener always
  // calls the current one and never compares against values from the
  // render it was registered in.
  const mergeRemoteRef = useRef(mergeRemote);
  mergeRemoteRef.current = mergeRemote;

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
      setCalendarDate((data?.calendarDate as string | undefined) ?? null);
      setTagIds(data?.tagIds ?? []);
      setCoverImageUri(data?.coverImageUri);
      setCoverGradient(data?.coverGradient);
      setPaperColorEnabled(!!data?.paperColorEnabled);
      setGroupId(data?.groupId ?? null);
      setSourceBoardId(data?.boardId ?? null);
      setCanvasLinks(data?.canvasLinks ?? {});
      const loadedBlocks: Block[] = data?.blocks ?? [];
      setBlocks(loadedBlocks.length > 0 ? loadedBlocks : [newBlock()]);
      rememberServer(shapeFrom(data, loadedBlocks));
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
      setIsLoaded(true);
    })();
  }, [documentId]);

  // While the note is open, it hears the server. An open editor used to
  // read once and never again, so a change made on the other device was
  // invisible here - and the next autosave here wrote over it. Only
  // versions from the server count: a snapshot carrying this device's
  // own pending write is an echo, and one from the cache is what we
  // already loaded.
  useEffect(() => {
    if (!isLoaded) return;
    return onSnapshot(doc(db, 'documents', documentId), (snapshot) => {
      if (snapshot.metadata.hasPendingWrites || snapshot.metadata.fromCache) return;
      const data = snapshot.data();
      if (!data) return;
      const remote = shapeFrom(data, (data.blocks as Block[]) ?? []);
      // The same version we already hold - our own write, arrived back
      // from the server - changes nothing.
      if (serverRef.current && sameAsServer({ ...remote, blocks: remote.blocks })) {
        syncLog('snapshot = own echo', { updatedAt: data.updatedAt });
        rememberServer(remote);
        return;
      }
      syncLog('snapshot = REMOTE CHANGE, merging', {
        updatedAt: data.updatedAt,
        changed: remote.blocks
          .filter((b) => serverBlockRef.current.get(b.id) !== stableStringify(b))
          .map((b) => `${b.id.slice(-4)}${b.canvas ? `@${Math.round(b.canvas.x)},${Math.round(b.canvas.y)}` : ''}`)
          .join(','),
        order: remote.blocks.map((b) => b.id.slice(-4)).join('>'),
      });
      mergeRemoteRef.current(remote);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoaded, documentId]);

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
      // Only on first sync, same guard as the Drive backup below - a
      // genuinely new camera photo starts in the fixed "Фото" group, but
      // re-saving the document on every edit must never force it back
      // there after the user has since moved it to a different group.
      const isNewPhoto = !knownPhotoBlockIdsRef.current.has(b.id);
      // The title obeys that same guard now, and for the same reason one
      // step further on. It is written when this block CREATES the record
      // and never again: after that the record owns it. Renaming a photo
      // in its own database used to survive only until the next time a
      // document mentioning it was touched, because this line wrote the
      // block's copy - taken at insert time - straight back over it.
      // Renaming from inside a document still works; it writes the record
      // directly now (see renameImageBlock) instead of going through here.
      if (isNewPhoto && b.imageTitle) photoDoc.title = b.imageTitle;
      if (b.imageFit) photoDoc.imageFit = b.imageFit;
      if (b.createdAt) photoDoc.createdAt = b.createdAt;
      if (isNewPhoto && b.imageSource === 'camera') photoDoc.groupId = CAMERA_PHOTOS_GROUP_ID;
      // A drawing made on this block (see onDrawOverImage) mirrors into the
      // photos database too - same rule as the title above, just without
      // the isNewPhoto guard: drawing is additive, never something a later
      // save should silently revert.
      if (b.sketchElements?.length) {
        photoDoc.sketchElements = b.sketchElements;
        photoDoc.sketchWidth = b.sketchWidth;
        photoDoc.sketchHeight = b.sketchHeight;
      }
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
      const isNewFile = !knownFileBlockIdsRef.current.has(b.id);
      if (b.mimeType) fileDoc.mimeType = b.mimeType;
      // Written on creation only - see syncPhotosForDocument's guard on
      // the same field. A file renamed in the Files database was losing
      // that name to whichever document mentioned it next. Nothing renames
      // a file from inside a document, so there is no second writer here
      // to arrange, only this one to stop.
      if (isNewFile && b.fileTitle) fileDoc.title = b.fileTitle;
      if (b.createdAt) fileDoc.createdAt = b.createdAt;
      setDoc(doc(db, 'files', b.id), fileDoc, { merge: true });
      // !b.driveFileId - see syncPhotosForDocument's identical guard: stops
      // a reference to an already-backed-up file (a different document's
      // existing file, just added here too) from re-uploading a duplicate.
      if (isNewFile && !b.driveFileId) {
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

  // Embedded database rows (see the 'dbRow' block type). Only the
  // back-link is written - never the row's own content, and never a
  // delete: unlike a photo/file/sticker record (which exists BECAUSE a
  // document made it), a row belongs to its database and outlives every
  // document that happens to mention it. Hence the plain field delete
  // below rather than removeDocumentUsage, which cleans up an orphaned
  // record.
  const knownCustomRowIdsRef = useRef<Set<string>>(new Set());

  function syncCustomRowsForDocument(currentBlocks: Block[]) {
    const rowBlocks = currentBlocks.filter((b) => (b.type ?? 'paragraph') === 'dbRow');
    const currentIds = new Set(rowBlocks.map((b) => b.id));
    rowBlocks.forEach((b) => {
      updateDoc(doc(db, 'customDatabaseRows', b.id), {
        [`usedInDocuments.${documentId}`]: true,
      }).catch(() => {
        // Deleted from its database in the meantime - the block stays and
        // renders its "запис видалено" state, nothing to record.
      });
    });
    knownCustomRowIdsRef.current.forEach((id) => {
      if (!currentIds.has(id)) {
        updateDoc(doc(db, 'customDatabaseRows', id), {
          [`usedInDocuments.${documentId}`]: deleteField(),
        }).catch(() => {});
      }
    });
    knownCustomRowIdsRef.current = currentIds;
  }

  // Same shape one level up, for embedded saved views ('dbView' blocks) -
  // a view belongs to its database exactly like a row does, so it's the
  // same back-link-only, never-delete convention.
  const knownCustomViewIdsRef = useRef<Set<string>>(new Set());

  function syncCustomViewsForDocument(currentBlocks: Block[]) {
    const viewBlocks = currentBlocks.filter((b) => (b.type ?? 'paragraph') === 'dbView');
    const currentIds = new Set(viewBlocks.map((b) => b.id));
    viewBlocks.forEach((b) => {
      updateDoc(doc(db, 'customDatabaseViews', b.id), {
        [`usedInDocuments.${documentId}`]: true,
      }).catch(() => {
        // Deleted from its database in the meantime - the block stays and
        // renders its "вигляд видалено" state, nothing to record.
      });
    });
    knownCustomViewIdsRef.current.forEach((id) => {
      if (!currentIds.has(id)) {
        updateDoc(doc(db, 'customDatabaseViews', id), {
          [`usedInDocuments.${documentId}`]: deleteField(),
        }).catch(() => {});
      }
    });
    knownCustomViewIdsRef.current = currentIds;
  }

  useEffect(() => {
    if (!isLoaded) return;
    // Nothing to write when nothing differs from what the server holds -
    // which is the case the moment a note has been opened, and the case
    // when another device's version has just been merged in. See
    // serverRef.
    const shape: ServerShape = { title, blocks, coverImageUri: coverImageUri || undefined, coverGradient: coverGradient || undefined, paperColorEnabled, groupId, canvasLinks };
    if (sameAsServer(shape)) return;
    syncLog('will save: differs from server', {
      dirtyBlocks: blocks.filter((b) => serverBlockRef.current.get(b.id) !== stableStringify(b)).map((b) => b.id.slice(-4)).join(','),
      orderChanged: serverRef.current ? serverRef.current.blocks.map((b) => b.id).join() !== blocks.map((b) => b.id).join() : 'no server yet',
      focused: focusedBlockIdRef.current?.slice(-4) ?? null,
    });
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
      // Cleared here rather than in the cleanup: from this point there is
      // nothing scheduled, and the listener above reads this to tell
      // "waiting to write" from "nothing pending".
      saveTimeoutRef.current = null;
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
          coverGradient: coverGradient || deleteField(),
          groupId: groupId ?? deleteField(),
          // A map written under merge:true MERGES its keys - a link
          // removed here simply stayed on the server, and the other
          // device kept drawing it. Every key the server holds that this
          // copy no longer has is written as a deletion.
          canvasLinks: {
            ...canvasLinks,
            ...Object.fromEntries(
              Object.keys(serverRef.current?.canvasLinks ?? {})
                .filter((id) => !(id in canvasLinks))
                .map((id) => [id, deleteField()])
            ),
          },
          ...createdAtField,
          ...extraFields,
        },
        { merge: true }
      )
        .then(() => {
          rememberServer({ title, blocks, coverImageUri: coverImageUri || undefined, coverGradient: coverGradient || undefined, paperColorEnabled, groupId, canvasLinks });
          setSaveStatus('saved');
          syncLog('saved', { blocks: blocks.length });
        })
        .catch((e: Error) => {
          // A refused write used to be silent: the ring kept turning and
          // nothing said why. The rule from the web work - an error must
          // reach the screen.
          syncLog('SAVE FAILED', { message: e.message });
          notify('Не збереглося', e.message);
        });
      syncTasksForDocument(blocks);
      syncLinksForDocument(blocks);
      syncPhotosForDocument(blocks);
      syncFilesForDocument(blocks);
      syncStickersForDocument(blocks);
      syncCustomRowsForDocument(blocks);
      syncCustomViewsForDocument(blocks);
    }, AUTOSAVE_DELAY_MS);
    return () => {
      if (saveTimeoutRef.current) clearTimeout(saveTimeoutRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, blocks, coverImageUri, coverGradient, paperColorEnabled, groupId, canvasLinks, isLoaded]);

  // Whoever set focusIdRef wants that block to be the live input next. A
  // block only has a TextInput while it's the active one, so this first
  // makes it active (which mounts the input) and then, on the re-run that
  // follows, focuses it and places the cursor.
  useEffect(() => {
    const id = focusIdRef.current;
    if (!id) return;
    if (focusedBlockId !== id) {
      focusedBlockIdRef.current = id;
      setTitleActive(false);
      setFocusedBlockId(id);
      return;
    }
    const input = inputRefs.current[id];
    if (!input) return;
    input.focus();
    measureActiveInputForSync(input);
    // The field's own length now - the DISPLAY text, since that is what
    // it actually holds (see the active TextInput's value); a code block
    // is the one field still showing its raw text untouched.
    const fieldLength = (block: Block) => ((block.type ?? 'paragraph') === 'code' ? block.text.length : plainTextOf(block.text).length);
    if (focusToEndRef.current) {
      const block = blocks.find((b) => b.id === id);
      if (block) setSelection(input, fieldLength(block), fieldLength(block));
      focusToEndRef.current = false;
    } else if (focusCursorIndexRef.current !== null) {
      const block = blocks.find((b) => b.id === id);
      const index = Math.min(focusCursorIndexRef.current, block ? fieldLength(block) : 0);
      setSelection(input, index, index);
      focusCursorIndexRef.current = null;
    }
    focusIdRef.current = null;
  }, [blocks, focusedBlockId]);

  // See keyboardDidHide below - a hide that is NOT followed by a show.
  const deactivateTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Is this app the one on screen right now? Every keyboard signal below
  // is gated on it (2026-09-19).
  //
  // Leaving to the home screen or another app is not one clean event -
  // it is a RACE between Android tearing the window's IME inset down and
  // the activity being paused, and the user's own report is exactly what
  // a race looks like from outside: "тепер баг не регулярний", the pill
  // sometimes surviving the round trip and sometimes not. Worse, Android
  // keeps the IME itself alive and RESTORES it when the app comes back,
  // WITHOUT replaying the inset animation - so the frame handler, the
  // pill's only position source, never learns the keyboard came back and
  // leaves it at 0 under a keyboard that is plainly standing there.
  //
  // So the rule is not "guess which writer won the race" (three separate
  // attempts at that have now been reverted) but "an app that is not on
  // screen does not react to the keyboard at all, and asks again from
  // scratch when it returns" - see the resync effect below useEditorKeyboard.
  // A ref for the JS-thread listeners, a shared value for the worklets;
  // they are written together and never separately.
  const appActiveRef = useRef(true);
  const appActiveSV = useSharedValue(1);

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
      // Not on screen: nothing here means anything (see appActiveRef).
      // Scrolling a block into view behind a home screen is the clearest
      // case - by the time anyone looks, the measurement it scrolled to
      // was taken against a window that was being torn down.
      if (!appActiveRef.current) return;
      cancelDismissFallback();
      if (deactivateTimeoutRef.current) {
        clearTimeout(deactivateTimeoutRef.current);
        deactivateTimeoutRef.current = null;
      }
      const height = e.endCoordinates.height;
      // NOT the pill's position source any more (2026-09-19). Measured
      // on-device: during Android's own "swipe up and hold" recent-apps
      // gesture, THIS event - and only this one - reports a height
      // exactly `insets.bottom` lower than reality (323 vs the true 338,
      // twice captured, exact both times), while the frame handler below
      // (onStart/onMove/onEnd, tagged separately) never does. A same-
      // signature guard here (discard a drop matching the inset while
      // already showing) did NOT fix it - a second capture showed
      // `keyboardDidHide` (unwatched, sets keyboardSV to 0) likely firing
      // in between, so "already showing" was already false by the time
      // the bad value landed, and the guard never triggered.
      //
      // The two APIs behind these paths are genuinely different:
      // `Keyboard` is RN's bridge over Android's legacy
      // OnGlobalLayoutListener, which Android re-fires during this
      // gesture as the nav bar's own inset is briefly recalculated
      // against a different reference frame; `useKeyboardHandler` is
      // built on WindowInsetsAnimationCompat, and the keyboard is not
      // actually animating during this gesture - it never fires an
      // update, spurious or otherwise. So rather than filter this
      // event's number, it is no longer trusted for the pill's position
      // at all - the frame handler already both drives the smooth
      // animation and no-ops correctly when nothing is moving, and RN's
      // own listener stays for what it hasn't been shown to break:
      // toggling the toolbar's visibility and scheduling the scroll
      // safety net below.
      setKeyboardHeight(height);
      scheduleScrollAdjust(height);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      // Not on screen: a hide fired while the app is going away says
      // nothing about whether the user is done typing - Android hides
      // the IME as part of the transition and hands it straight back on
      // return. Blurring the block on that would be the one thing that
      // actually ends the editing session, and it is not what happened.
      if (!appActiveRef.current) return;
      cancelDismissFallback();
      // NOT reset here any more (2026-09-19): `keyboardSV` is the frame
      // handler's alone now (onMove/onEnd, confirmed clean by direct
      // measurement) - on a REAL dismissal those already carry it down
      // to 0 in real time, live with the keyboard's own animation, so
      // forcing it here was always redundant on a genuine close and was
      // the exact line that made the pill snap during Android's
      // recent-apps gesture's spurious hide (see the two diagnostic
      // rounds above this comment for the measurements).
      //
      // Back-gesture dismissal hides the keyboard WITHOUT blurring the
      // EditText on Android, so the active block would otherwise stay a
      // live input with the keyboard down - the one place a swipe still
      // wouldn't scroll. Keyboard down means nothing is being edited: hand
      // the block (or title) back to plain text.
      //
      // Deferred, NOT immediate: focus moving from one field to the next
      // (the old input unmounting, the new one mounting a frame later)
      // also fires a hide that a show follows within a moment - acting on
      // that hide killed the block that had just been tapped. Only a hide
      // with no show behind it is a real dismissal; keyboardDidShow above
      // cancels this.
      //
      // `setKeyboardHeight(0)` is eager again. It spent one commit
      // inside the deferred block below, to stop a spurious hide from
      // flickering everything that reads it - but the price was the
      // Полотно/select-mode dock arriving 400ms late after an ordinary
      // dismissal, which was immediately visible. Those two are the
      // only readers that were ever visible on this path, and they now
      // take `keyboardOpen` (derived from the frame handler's own live
      // height - see its own comment) instead, which crosses at the
      // right instant without a timer and never crosses spuriously.
      // What still reads `keyboardHeight` after them - the caret-
      // follows-typing scroll, an embedded-mode capsule offset, the
      // scroll safety net - wants the plain event value, and a
      // momentarily wrong one costs them nothing visible.
      setKeyboardHeight(0);
      if (deactivateTimeoutRef.current) clearTimeout(deactivateTimeoutRef.current);
      deactivateTimeoutRef.current = setTimeout(() => {
        deactivateTimeoutRef.current = null;
        deactivateActiveInput();
      }, 400);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
      cancelDismissFallback();
      if (deactivateTimeoutRef.current) clearTimeout(deactivateTimeoutRef.current);
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

  // Hand the active block (or the title) back to plain text: the keyboard
  // is down, so nothing is being edited. Two callers - the deferred branch
  // of keyboardDidHide, and the resync that runs when the app comes back
  // to a keyboard that did not survive the trip.
  function deactivateActiveInput() {
    const activeId = focusedBlockIdRef.current;
    if (activeId) {
      inputRefs.current[activeId]?.blur();
      focusedBlockIdRef.current = null;
      setFocusedBlockId(null);
      setActiveSelection(null);
    }
    setTitleActive(false);
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
  // On a phone the bar rides on the keyboard, so it shows with it. A
  // browser raises no keyboard, and the bar never showed at all - which
  // left the laptop with no way to add a picture, a file or a record to
  // a note. There it shows whenever a block is being written in, pinned
  // to the bottom edge (keyboardSV is 0, so that is where it lands).
  // Mounted for as long as a block is being edited - NOT gated on
  // `keyboardHeight` any more (2026-09-19). That gate was the actual
  // source of the flash-away-and-back bug: `keyboardHeight` is a
  // discrete JS boolean-ish value written by event listeners that can
  // themselves be spurious (Android's recent-apps gesture), so gating a
  // MOUNT on it meant a single bad event was enough to unmount and
  // remount the whole toolbar. `focusedBlockId` never flips on that
  // kind of noise - only a deliberate tap in or out of a block changes
  // it - so the toolbar now stays mounted the whole time, and its
  // POSITION (bottom: keyboardSV.value, below) is the only thing that
  // moves, continuously, frame by frame, off the one value already
  // confirmed clean (the frame handler alone, see keyboardSV's own
  // writers). A momentary bad frame in that value is at most a single
  // frame of position jitter - nothing for React to mount or unmount
  // over, so there is nothing left to flash.
  const isToolbarVisible = focusedBlockId !== null;
  toolbarHeightRef.current = isToolbarVisible ? EDITOR_TOOLBAR_HEIGHT : 0;

  // Keyboard-synced scroll. The post-keyboard pass below
  // (scrollFocusedBlockIntoView) can only run once the keyboard has
  // finished rising, so the block used to sit still while the keyboard
  // came up and then hop into place afterwards - the "jump" the user kept
  // seeing. react-native-keyboard-controller reports the keyboard's own
  // animation frame by frame on the UI thread; this measures the active
  // row at the first frame, works out how far it has to move, and scrolls
  // that distance in step with the keyboard's progress. The block and the
  // keyboard then move as one motion, the way iOS does it. The old pass
  // stays as a safety net (it no-ops within a few px of the target).
  const keyboardSV = useSharedValue(0); // live keyboard height, mid-animation
  // TRIED AND REVERTED (2026-09-19): a third "final word" here, resyncing
  // `keyboardSV` from react-native-keyboard-controller's own reactive
  // `useKeyboardState`, on the theory that switching apps left one of
  // the other two writers stale. Measured on-device instead of guessed
  // a third time: at the exact instant of the app-switcher swipe,
  // `useKeyboardState`'s height reads exactly `inset.bottom` HIGHER than
  // the plain RN Keyboard event's own height (336 vs 351, 323 vs 338 -
  // both a 15px gap, both matching the safe-area inset exactly). In
  // steady state the two already agree. So this resync was never a
  // no-op the way the other two correctors are: right when the glitch
  // happens, it wrote a value inflated by exactly the nav-bar inset into
  // the position the pill uses with NO inset added elsewhere (see
  // pinnedToolbarStyle's own comment on why) - it was the cause of the
  // "sits with a gap" report, not a fix for it. Kept as a comment, not
  // code, so this exact theory is not re-tried.
  const controllerKeyboardHeight = useKeyboardState((s) => s.height);
  // Mirrored into a ref for the resume resync below, whose AppState
  // listener is registered once and would otherwise close over the very
  // first render's value forever.
  const controllerKeyboardHeightRef = useRef(0);
  controllerKeyboardHeightRef.current = controllerKeyboardHeight;
  const syncBaseOffset = useSharedValue(0);
  const syncShift = useSharedValue(0);
  // The active input's bottom edge (screen coords) and the list offset at
  // the moment it was measured - taken with the plain RN measure right
  // after activation (see the focus effect), which is the same call the
  // safety-net pass uses, so both agree on the target. -1 = no valid
  // measurement (title active, or the measure hasn't come back yet).
  // Reanimated's own UI-thread measure() was tried first and resolved to
  // the wrong view here (a 2500px-tall ancestor), so it isn't used.
  const activeInputBottomSV = useSharedValue(-1);
  const activeInputOffsetSV = useSharedValue(0);
  // useWindowDimensions, not a bare Dimensions.get() read: this one feeds
  // the keyboard-sync math below, and a value that doesn't re-render when
  // the window actually changes is the same trap that broke the calendar's
  // week strip twice (see CalendarScreen's PLATE_MARGIN comment).
  const { height: windowHeight, width: windowWidth } = useWindowDimensions();
  useEffect(() => {
    if (focusedBlockId === null) activeInputBottomSV.value = -1;
  }, [focusedBlockId]);
  function measureActiveInputForSync(input: TextInput) {
    activeInputBottomSV.value = -1;
    measureNode(input).then((box) => {
      if (!box) return;
      activeInputBottomSV.value = box.y + box.height;
      activeInputOffsetSV.value = scrollOffsetRef.current;
    });
  }
  useEditorKeyboard(
    {
      onStart: (e) => {
        'worklet';
        if (appActiveSV.value === 0) return; // see onMove
        syncShift.value = 0;
        if (e.progress !== 1) return; // closing - nothing to bring into view
        runOnJS(setKeyboardHeight)(e.height);
        // Title, or nothing measured yet: the safety net handles it.
        if (activeInputBottomSV.value < 0) return;
        // Where the input's bottom is NOW: the activation-time measure,
        // corrected for any scrolling since.
        const inputBottom = activeInputBottomSV.value - (scrollOffsetSV.value - activeInputOffsetSV.value);
        // Same target as scrollFocusedBlockIntoView: input bottom just
        // above the keyboard, with the toolbar (which the keyboard brings
        // up with it) taken off the visible area too.
        const visibleBottom = windowHeight - e.height - EDITOR_TOOLBAR_HEIGHT;
        syncBaseOffset.value = scrollOffsetSV.value;
        syncShift.value = Math.max(0, inputBottom - visibleBottom + 24);
      },
      onMove: (e) => {
        'worklet';
        // Frozen while the app is off screen: this is the writer that
        // carries the pill down to 0 during the exit transition, and
        // nothing brings it back up afterwards because Android restores
        // the IME without an animation. Holding the last on-screen value
        // means a round trip has no effect at all - and if the keyboard
        // really did go away meanwhile, the resync on return says so.
        if (appActiveSV.value === 0) return;
        keyboardSV.value = e.height;
        if (syncShift.value > 0) {
          scrollTo(scrollViewRef, 0, syncBaseOffset.value + syncShift.value * e.progress, false);
        }
      },
      onEnd: (e) => {
        'worklet';
        if (appActiveSV.value === 0) return; // see onMove
        keyboardSV.value = e.height;
        if (syncShift.value > 0) {
          scrollTo(scrollViewRef, 0, syncBaseOffset.value + syncShift.value, false);
          syncShift.value = 0;
        }
      },
    },
    [windowHeight]
  );
  // The other half of the appActiveRef rule: everything above ignores the
  // keyboard while the app is off screen, and this asks Android what is
  // actually true the moment it comes back.
  //
  // Both answers matter equally. The IME usually survives the round trip
  // (the user's own reading: "андроід не опускає клавіатуру в фоні") and
  // is simply standing there on return with no animation to announce it -
  // then the pill has to be put back at its real height. But sometimes the
  // keyboard really is gone, and then the frozen value is stale-high and
  // would leave the pill floating in the middle of the screen, which is a
  // worse bug than the one this fixes - so a keyboard that is NOT there is
  // written down to 0 just as deliberately, and the block deactivated the
  // same way an ordinary dismissal would.
  //
  // Deferred one beat rather than read on the spot: at the instant
  // AppState flips, Android has not necessarily finished restoring the
  // IME, and a reading taken then says "no keyboard" about a keyboard that
  // is a frame away from appearing.
  useEffect(() => {
    let resumeTimer: ReturnType<typeof setTimeout> | null = null;
    const sub = AppState.addEventListener('change', (state) => {
      const active = state === 'active';
      appActiveRef.current = active;
      appActiveSV.value = active ? 1 : 0;
      if (resumeTimer) {
        clearTimeout(resumeTimer);
        resumeTimer = null;
      }
      if (!active) return;
      resumeTimer = setTimeout(() => {
        resumeTimer = null;
        if (!appActiveRef.current) return;
        // WHETHER there is a keyboard is RN's question to answer - it is
        // the API that tracks the window, and `isVisible()` is the one
        // reading that is unambiguous either way.
        //
        // HOW TALL it is, is not. Measured twice on-device, both times
        // exact: RN's own number comes in lower than reality by exactly
        // `insets.bottom` (323 against a true 338, 336 against 351),
        // because it reports the keyboard against a window that already
        // has the nav-bar inset taken out of it. Trusting it here put the
        // bar 15px down behind the keyboard - the user's screenshot,
        // `last:resume:323 inset:15`, and the same trap already written
        // down in the project memory on 2026-09-10 against
        // `keyboardDidShow`. keyboard-controller measures the IME's own
        // animation instead and had the true height all along; in steady
        // state the two agree, so the larger is right whenever they
        // don't.
        const height = Keyboard.isVisible()
          ? Math.max(Keyboard.metrics()?.height ?? 0, controllerKeyboardHeightRef.current)
          : 0;
        keyboardSV.value = height;
        setKeyboardHeight(height);
        if (height === 0) deactivateActiveInput();
      }, 250);
    });
    return () => {
      if (resumeTimer) clearTimeout(resumeTimer);
      sub.remove();
    };
  }, []);
  // The room below the last block. Driven from the live keyboard height on
  // the UI thread rather than from keyboardHeight state: the synced scroll
  // above needs the content to already be tall enough on every frame of
  // the keyboard's rise, and a padding that only grows once React has
  // re-rendered lands too late for that - the list would hit its end
  // mid-animation and the rest of the move would happen afterwards.
  // Generous even with the keyboard down (160): the last line of a long
  // document was ending up pinned against the bottom edge. Costs nothing
  // on a short document, which doesn't scroll at all.
  const bottomSpacerStyle = useAnimatedStyle(() => ({
    height: Math.max(160, keyboardSV.value + 80 + EDITOR_TOOLBAR_HEIGHT),
  }));
  // "Is the keyboard up", taken from the one value that has been proved
  // clean (the frame handler's own live height) rather than from the
  // event listeners. Everything that used to read `keyboardHeight` for
  // this question - most visibly the Полотно/select-mode dock, which
  // shows only with the keyboard down - now reads this instead, because
  // `keyboardHeight`'s own reset had to be delayed by 400ms to survive
  // Android's spurious hide during the recent-apps gesture, and that
  // delay was plainly visible as the dock arriving late after an
  // ordinary dismissal. This crosses the moment the keyboard actually
  // passes the threshold on its own animation - no timer - and during
  // the spurious gesture the frame handler never fires at all, so it
  // never crosses spuriously either.
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  useAnimatedReaction(
    () => keyboardSV.value > 48,
    (open, previous) => {
      if (open !== previous) runOnJS(setKeyboardOpen)(open);
    }
  );

  // «План навігації», the merge the whole plan was heading for: the note
  // stops DRAWING a dock of its own and PUBLISHES what it can do, the way
  // every other screen already does (useDockActions in DocumentsScreen is
  // the model). One object on screen instead of two that resemble each
  // other.
  //
  // It is not a re-skin. The note's own dock was built before the dock's
  // look was measured off the user's Samsung reference, so it was the one
  // surface still made of GlassDrop and still sized in POINTS - both of
  // them against rules this project had already paid for ("the dock's
  // material is the drawer's two layers, not GlassDrop"; "size the dock in
  // fractions of screen width, never in points"). Publishing instead of
  // drawing means those rules cannot be missed here again, because there
  // is no second place they could be missed in.
  //
  // Same gates as the dock it replaces: not embedded (a note inside the
  // calendar has no business owning the foot of the screen), only while
  // this screen is the focused one, and NOT while the keyboard is up -
  // the formatting toolbar owns the foot then, and two things in one
  // place is the confusion this is meant to remove. Publishing null is
  // exactly how a screen says "nothing here", so the gate is the value,
  // not an early return.
  // Which card of the stack is in front. Select mode turns the dock's
  // page to the actions itself and the ✕ turns it back - the stack is
  // the note's select-mode bar now, not a bar of its own.
  // How far above the bottom edge anything has to start to clear the
  // dock - read off the dock's own geometry, never guessed.
  const menuClearance = useDockClearance();
  const showContext = useDockShowContext();
  const [, setDockFace] = useNavDockFace();
  // The way out, in the dock's own leave bead - the top-right capsule's
  // first button. One step at a time, exactly as that button did it: put
  // the text down, then shut the drawer, and leave the note only once
  // there is nothing left open. Back walking straight out of the note
  // while the reference drawer stood open is what left it with no way to
  // close at all.
  // The way out of the note, as its OWN ROUND BUTTON at the left of the
  // row - the user's ask, and it replaces the chevron that used to ride
  // inside the card. A bead is the dock's slot for what never changes,
  // which is exactly what leaving is: it means the same thing whether
  // you are on the page, on the canvas or picking blocks, so it has no
  // business moving with the cards that do change.
  //
  // It also ends the chevron's own trouble, unexplained to the last:
  // its first press while selecting ended the selection instead of
  // leaving. A separate round button beside the card cannot be confused
  // with ✕ inside it, by the hand or by anything else.
  //
  // One step at a time, exactly as the corner capsule's arrow does it:
  // put the text down, then shut the drawer, and leave the note only
  // once there is nothing left open. Back walking straight out while
  // the reference drawer stood open is what left it with no way to
  // close at all.
  useDockBeads(
    !embedded
      ? {
          icon: 'arrow-back-outline',
          onPress: () => {
            if (canvasEditing) {
              canvasApiRef.current?.stopEditing();
              return;
            }
            if (referencePanelOpen) {
              setReferencePanelOpen(false);
              return;
            }
            if (closePane) closePane();
            else navigation.goBack();
          },
        }
      : null,
    null
  );
  // ...and to OPEN on them. A note has no context of its own, and the
  // dock's standing rule for that case is to open on the desks - right
  // for a list at its root, wrong here, where the actions are the whole
  // reason this note stopped drawing a dock of its own.
  useDockOpensOnActions(!embedded);
  // NOT wider while selecting, though the dock can be (useDockWide, and
  // it was declared here for one round). The user's own call once they
  // saw it: the row keeps its width and the last buttons are reached by
  // scrolling - "док не розширювати і тоді видалення буде видно тільки
  // після прокручування доку". A dock that changes width between modes
  // is also a dock that stands in two places, which is the thing this
  // whole design has been holding still.
  //
  // The mechanism stays in ContextDock: it is declared, not inferred, so
  // nothing happens unless a screen asks. The note no longer asks - and
  // could not anyway, now that it publishes a bead (the stretch only
  // runs where both bead slots are genuinely empty).
  const showActions = () => setDockFace('actions');
  const dockLive = !embedded && editorFocused && !keyboardOpen;
  useDockActions(
    !dockLive
      ? null
      : isSelectMode
      ? [
          // The way out, and the count rides it: the ticks on the blocks
          // say which are chosen, but not once they have scrolled past,
          // and none of the three below is a button to press without
          // knowing how many it is about to take.
          {
            key: 'cancel',
            icon: 'close-outline',
            label: 'Вийти',
            count: selectedIds.size,
            onPress: () => {
              showContext();
              toggleSelectMode();
            },
          },
          // Formatting stays ONE tap, on the same card. Five buttons
          // past the four a card fits, so the row scrolls - which is the
          // honest way to admit there are more than fit, and far better
          // than the alternative that was on the table: a «Тип» button
          // opening a sheet, i.e. two taps for the thing the user
          // explicitly asked to be able to do while picking blocks
          // ("інколи блоки треба просто форматувати, наприклад зробити
          // пронумерований список"). The long names are cut to one word
          // each - a quarter of a card is no place for "Нумерований
          // список".
          ...SELECT_FORMAT_ACTIONS.map((entry) => ({
            key: `type:${entry.key}`,
            icon: entry.family === 'material-community' ? `mc:${entry.icon}` : entry.icon,
            label: SELECT_FORMAT_LABELS[entry.key] ?? entry.label,
            onPress: () => convertSelectedBlocks(entry.key as BlockType),
          })),
          {
            key: 'copy',
            icon: 'copy-outline',
            label: 'Копія',
            onPress: copySelectedBlocks,
          },
          {
            key: 'clip',
            icon: 'document-text-outline',
            label: 'В нотатку',
            onPress: clipSelectedToNote,
          },
          {
            key: 'delete',
            icon: 'trash-outline',
            label: 'Видалити',
            onPress: deleteSelectedBlocks,
          },
        ]
      : [
          // One button, two states - the app's own idea, already proven
          // by the back arrow that becomes a checkmark. The label says
          // where the press takes you, exactly as the "…" menu's row
          // used to.
          {
            key: 'mode',
            icon: canvasMode ? 'document-text-outline' : 'shapes-outline',
            label: canvasMode ? 'Сторінка' : 'Полотно',
            onPress: () => (canvasMode ? leaveCanvas() : setCanvasMode(true)),
          },
          // Only where it means something. References have no business on
          // the page, and a control that cannot act is one you have to
          // read and dismiss every time.
          ...(canvasMode
            ? [
                {
                  key: 'refs',
                  icon: 'albums-outline',
                  label: 'Референси',
                  active: referencePanelOpen,
                  onPress: () => setReferencePanelOpen((v) => !v),
                },
              ]
            : []),
          // Everything below came out of the "…" menu at the user's own
          // request, in the order they are reached for: picking blocks
          // most, throwing the note away least. Past the four a card
          // shows, and deliberately so - "док не розширювати і тоді
          // видалення буде видно тільки після прокручування доку". The
          // one button you must not hit by accident is the one you have
          // to travel to.
          //
          // NONE of them on the canvas: "в режимі полотна нам потрібен
          // сторінка та референси". The canvas is a different surface
          // with a different job - there is no block list to pick from,
          // no paper to colour, and the two buttons that do still make
          // sense there (export, delete) are not worth the other three
          // being present and inert. A control that cannot act is one
          // you read and dismiss every time, which is the same rule
          // «Референси» already follows in the other direction.
          ...(canvasMode
            ? []
            : [
          {
            key: 'select',
            icon: 'checkmark-circle-outline',
            label: 'Вибір',
            onPress: () => {
              setExportMenuOpen(false);
              toggleSelectMode();
              showActions();
            },
          },
          // «Вигляд» is a cover, a row of gradients and a paper colour -
          // a panel, not a button, so what moves into the dock is the
          // WAY IN to it. The panel itself stays what it is.
          {
            key: 'look',
            icon: 'color-palette-outline',
            label: 'Вигляд',
            active: exportMenuOpen,
            onPress: () => setExportMenuOpen((v) => !v),
          },
          {
            key: 'group',
            icon: 'folder-outline',
            label: 'Група',
            active: !!groupId,
            onPress: () => {
              setExportMenuOpen(false);
              setGroupPickerVisible(true);
            },
          },
          {
            key: 'export',
            icon: 'share-outline',
            label: 'Експорт',
            onPress: () => {
              setExportMenuOpen(false);
              askExport();
            },
          },
          {
            key: 'trash',
            icon: 'trash-outline',
            label: 'Видалити',
            onPress: confirmDeleteDocument,
          },
              ]),
        ]
  );
  // The pinned toolbar rides on the live height, so it comes up (and goes
  // down) glued to the keyboard's top edge rather than appearing at the
  // final position ahead of it.
  //
  // bottom is keyboardSV.value alone - NOT + insets.bottom. It used to add
  // the bottom safe-area inset (a leftover from a plain keyboardHeight
  // state, meant to clear the gesture bar), but the scroll math in
  // scrollFocusedBlockIntoView (visibleBottom) has only ever measured
  // against the bare keyboard height, with no such inset - so the bar sat
  // insets.bottom higher than where content was actually being scrolled
  // clear to, leaving a gap of exactly that height between the bar and
  // the keyboard with the next block's text showing through it.
  // The bar's own presence is CONTINUOUS now, not a mount decision
  // (2026-09-19, after three fixes that each traded one artifact for
  // another). Keying the mount off `focusedBlockId` stopped the flash
  // during Android's recent-apps gesture, but left the other half of
  // the problem: `focusedBlockId` is only cleared by the 400ms
  // deferred block in keyboardDidHide, so on an ordinary dismissal the
  // bar rode the keyboard down and then SAT at the bottom edge, plainly
  // visible, until that timer fired. Same delay as before, moved to a
  // different variable.
  //
  // So it no longer waits for anything to decide it is gone: it fades
  // and slides out as a pure function of the keyboard's own live
  // height. At 0 it is fully transparent and pushed its whole height
  // below the bottom edge; by ~48px of keyboard it is fully in place.
  // On a real dismissal that reaches zero in step with the keyboard's
  // own animation - zero added latency, because there is no timer in
  // the path at all. During the spurious gesture the frame handler
  // never fires, `keyboardSV` never moves, and so this never changes
  // either: nothing to flash.
  //
  // Web has no keyboard events to drive any of it, so it keeps the bar
  // plainly visible whenever a block is focused, exactly as before.
  const pinnedToolbarStyle = useAnimatedStyle(() => {
    if (Platform.OS === 'web') return { bottom: keyboardSV.value, opacity: 1, transform: [] };
    const shown = Math.min(1, Math.max(0, keyboardSV.value / 48));
    return {
      bottom: keyboardSV.value,
      opacity: shown,
      transform: [{ translateY: (1 - shown) * (EDITOR_TOOLBAR_HEIGHT + 24) }],
    };
  });

  function scrollFocusedBlockIntoView(currentKeyboardHeight: number) {
    const id = focusedBlockIdRef.current;
    const input = id ? inputRefs.current[id] : null;
    if (!input) return;
    measureNode(input).then((box) => {
      if (!box) return;
      const { height, y: pageY } = box;
      // RN's first keyboardDidShow can under-report the height by the
      // suggestion strip (323 vs the real 338 on-device) - the synced
      // scroll already targeted the real one, so measuring against the
      // smaller value here would "correct" by those 15px for nothing.
      const effectiveKeyboardHeight = Math.max(currentKeyboardHeight, keyboardSV.value);
      const visibleBottom =
        Dimensions.get('window').height - effectiveKeyboardHeight - toolbarHeightRef.current;
      const overflow = pageY + height - visibleBottom + 24;
      // A few px of slack: the pre-scroll at activation (see the focus
      // effect) and the post-keyboard pass land within a pixel or two of
      // each other, and a second scroll for that is a visible twitch.
      if (overflow > 4) {
        scrollViewRef.current?.scrollTo({ y: scrollOffsetRef.current + overflow, animated: true });
      }
    });
  }

  // A tap on a locked block: make it the one live TextInput (the focus
  // effect above then focuses it once it has mounted and places the
  // cursor - at cursorIndex when the tap position gave one, else at the
  // end).
  function handleActivateBlock(id: string, cursorIndex?: number) {
    focusIdRef.current = id;
    focusToEndRef.current = cursorIndex === undefined;
    focusCursorIndexRef.current = cursorIndex ?? null;
    focusedBlockIdRef.current = id;
    setTitleActive(false);
    setFocusedBlockId(id);
  }

  // The keyboard going away (back gesture, "done") or focus moving on to
  // another block returns this one to plain, scroll-through text. Guarded
  // on the ref so a blur that lands after the NEXT block has already taken
  // over doesn't knock that block back out.
  function handleBlockBlur(id: string) {
    if (focusedBlockIdRef.current !== id) return;
    focusedBlockIdRef.current = null;
    setFocusedBlockId(null);
    setActiveSelection(null);
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
      if (firstBlock) handleActivateBlock(firstBlock.id, 0);
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
    // sel.start/end are DISPLAY positions (the active field's own
    // selection, marker-free) - the wrap/unwrap itself still has to
    // happen on the RAW text, since that is what markers live in.
    const rawSegments = parseFormattedText(block.text);
    const rawStart = rawIndexForDisplayIndex(rawSegments, block.text, sel.start);
    const rawEnd = rawIndexForDisplayIndex(rawSegments, block.text, sel.end);
    const before = block.text.slice(0, rawStart);
    const selected = block.text.slice(rawStart, rawEnd);
    const after = block.text.slice(rawEnd);
    // A single '*' (italic) also matches the tail of '**' (bold), so a
    // plain endsWith/startsWith would misfire "already italic" on text
    // that's actually bold-wrapped. Require the boundary to be exactly
    // this marker, not a longer one that happens to contain it.
    const isExactBoundary =
      open === '*'
        ? before.endsWith('*') && !before.endsWith('**') && after.startsWith('*') && !after.startsWith('**')
        : before.endsWith(open) && after.startsWith(close);
    let newText: string;
    let newRawStart: number;
    if (isExactBoundary) {
      newText = before.slice(0, -open.length) + selected + after.slice(close.length);
      newRawStart = rawStart - open.length;
    } else {
      newText = before + open + selected + close + after;
      newRawStart = rawStart + open.length;
    }
    const newRawEnd = newRawStart + selected.length;
    snapshotBeforeChange();
    setBlocks((prev) => prev.map((b) => (b.id === sel.blockId ? { ...b, text: newText } : b)));
    // Back to display terms for the field's own selection - the new text
    // just gained or lost markers, so this is read off the NEW raw text.
    const newStart = displayIndexForRawIndex(newText, newRawStart);
    const newEnd = displayIndexForRawIndex(newText, newRawEnd);
    setActiveSelection({ blockId: sel.blockId, start: newStart, end: newEnd });
    requestAnimationFrame(() => {
      setSelection(inputRefs.current[sel.blockId], newStart, newEnd);
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
    // sel.start/end are DISPLAY positions - convert to raw before slicing
    // block.text, same as applyMarkerToSelection above.
    const rawSegments = parseFormattedText(block.text);
    const rawStart = rawIndexForDisplayIndex(rawSegments, block.text, sel.start);
    const rawEnd = rawIndexForDisplayIndex(rawSegments, block.text, sel.end);
    const openPattern = kind === 'c' ? COLOR_OPEN : HIGHLIGHT_OPEN;
    const closeTag = kind === 'c' ? COLOR_CLOSE : HIGHLIGHT_CLOSE;
    const before = block.text.slice(0, rawStart);
    const selected = block.text.slice(rawStart, rawEnd);
    const after = block.text.slice(rawEnd);
    // openPattern is anchored to the start of a string (^...) for matching
    // an upcoming tag while parsing; here we need "ends with", so the
    // leading ^ has to be dropped before anchoring to the end instead.
    const existingOpenMatch = before.match(new RegExp(openPattern.source.replace(/^\^/, '') + '$'));
    const hasExistingClose = after.startsWith(closeTag);
    let newText: string;
    let newRawStart: number;
    if (existingOpenMatch && hasExistingClose) {
      const existingHex = existingOpenMatch[1];
      if (existingHex.toLowerCase() === hex.toLowerCase()) {
        // Same color already applied - remove it.
        newText = before.slice(0, -existingOpenMatch[0].length) + selected + after.slice(closeTag.length);
        newRawStart = rawStart - existingOpenMatch[0].length;
      } else {
        // Different color - swap the hex value in place, tag lengths match.
        const newOpen = `{${kind}:${hex}}`;
        newText = before.slice(0, -existingOpenMatch[0].length) + newOpen + selected + after;
        newRawStart = rawStart - existingOpenMatch[0].length + newOpen.length;
      }
    } else {
      const openTag = `{${kind}:${hex}}`;
      newText = before + openTag + selected + closeTag + after;
      newRawStart = rawStart + openTag.length;
    }
    const newRawEnd = newRawStart + selected.length;
    snapshotBeforeChange();
    setBlocks((prev) => prev.map((b) => (b.id === sel.blockId ? { ...b, text: newText } : b)));
    const newStart = displayIndexForRawIndex(newText, newRawStart);
    const newEnd = displayIndexForRawIndex(newText, newRawEnd);
    setActiveSelection({ blockId: sel.blockId, start: newStart, end: newEnd });
    requestAnimationFrame(() => {
      setSelection(inputRefs.current[sel.blockId], newStart, newEnd);
    });
  }

  // "/" in an empty block opens the menu of things a block can become or
  // hold - the way every notes app on a laptop does it, and what the user
  // asked for: on a laptop the toolbar is a long way from the caret, and
  // "/" is right under the fingers. The same list the toolbar's "+" has,
  // and the same handler behind it; only the way in is new. Picking
  // clears the "/" first, so the block does not keep a stray slash in
  // front of a picture; walking away leaves the "/" as typed.
  async function openSlashMenu(id: string) {
    const offered = BLOCK_ACTIONS.filter((entry) => Platform.OS !== 'web' || entry.key !== 'scan');
    const picked = (await ask({
      title: 'Що вставити?',
      actions: offered.map((entry) => ({
        id: entry.key,
        label: entry.label,
        // «Питання» draws Ionicons; the two list glyphs come from another
        // family and take the nearest Ionicons stand-ins here.
        icon:
          entry.family === 'ionicons'
            ? entry.icon
            : entry.key === 'numbered'
              ? 'list-circle-outline'
              : 'list-outline',
      })),
    })) as BlockAction | 'cancel';
    if (picked === 'cancel') return;
    setBlocks((prev) => prev.map((b) => (b.id === id && b.text === '/' ? { ...b, text: '' } : b)));
    handleBlockAction(picked, id);
  }

  function handleBlockChange(id: string, text: string) {
    snapshotForTyping();
    keepCaretVisibleWhileTyping();
    const current = blocks.find((b) => b.id === id);
    const currentType = current?.type ?? 'paragraph';

    // A paste that carries a shape keeps it. React Native hands a
    // TextInput plain text and nothing else, so the structure is read
    // back OUT of what was inserted (see pasteBlocks): blank lines part
    // paragraphs, "- " and "1." and "[ ]" become the lists they are
    // written as, a run of tab-separated lines becomes a table. Before
    // this, a page copied from anywhere arrived as one paragraph the
    // length of the page.
    // A code block takes text exactly as it comes: no paste parsing, no
    // splitting on a blank line, no link conversion. Every newline in it
    // is the author's own, which is the whole point of the block.
    if (currentType === 'code') {
      setBlocks((prev) => prev.map((block) => (block.id === id ? { ...block, text } : block)));
      return;
    }

    if (!['image', 'file', 'sketch', 'table', 'dbRow', 'dbView', 'link', 'divider'].includes(currentType)) {
      const inserted = insertedPiece(current?.text ?? '', text);
      if (inserted && /[\n\t]/.test(inserted.piece)) {
        const parsed = parsePastedText(inserted.piece);
        if (worthSplitting(parsed)) {
          applyPaste(id, currentType, inserted.head, parsed, inserted.tail);
          return;
        }
      }
    }
    // A slash typed into an EMPTY block, and only then - a "/" in the
    // middle of a sentence is a slash.
    if (text === '/' && (current?.text ?? '') === '' && !['image', 'file', 'sketch', 'table', 'dbRow', 'dbView', 'link', 'divider'].includes(currentType)) {
      openSlashMenu(id);
    }

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

  // A parsed paste, laid into the document.
  //
  // The first piece joins what was already in the block (so pasting at
  // the end of a sentence continues that sentence), the rest become
  // blocks of their own after it, and whatever stood after the caret
  // ends up at the end - the text around a paste is the user's own.
  function applyPaste(
    id: string,
    currentType: BlockType,
    head: string,
    parsed: ParsedBlock[],
    tail: string
  ) {
    const [first, ...rest] = parsed;
    const made = rest.map((piece) => {
      const block = buildBlock(generateId(), piece.type, piece.text);
      if (piece.checked) block.checked = true;
      if (piece.headingLevel) block.headingLevel = piece.headingLevel;
      if (piece.codeLanguage) block.codeLanguage = piece.codeLanguage;
      if (piece.tableRows) block.tableRows = piece.tableRows;
      return block;
    });
    // The caret lands at the end of what was pasted.
    const last = made[made.length - 1];
    if (last) focusIdRef.current = last.id;
    bumpTextVersion(id);
    setBlocks((prev) => {
      const index = prev.findIndex((block) => block.id === id);
      if (index === -1) return prev;
      const next = [...prev];
      // The block the paste started in keeps its own type unless it was
      // empty and the first piece brought one of its own.
      const emptyHost = head.trim() === '' && (prev[index].text ?? '') === '';
      if (emptyHost && first.type !== 'paragraph') {
        const rebuilt = buildBlock(id, first.type, first.text);
        if (first.checked) rebuilt.checked = true;
        if (first.headingLevel) rebuilt.headingLevel = first.headingLevel;
        if (first.codeLanguage) rebuilt.codeLanguage = first.codeLanguage;
        if (first.tableRows) rebuilt.tableRows = first.tableRows;
        next[index] = rebuilt;
      } else {
        next[index] = { ...next[index], text: `${head}${first.type === 'table' ? '' : first.text}` };
      }
      if (rest.length === 0 && tail) next[index] = { ...next[index], text: `${next[index].text}${tail}` };
      else if (last && tail) made[made.length - 1] = { ...last, text: `${last.text}${tail}` };
      next.splice(index + 1, 0, ...made);
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

  // Tapping an embedded row opens it in its own database, with that row's
  // editor already open (see CustomDatabase's openRowId param) - the same
  // "jump to the record behind this block" move the file/photo/link blocks
  // already offer through their little database button.
  function openCustomRowBlock(databaseId: string, rowId: string) {
    navigation.navigate('CustomDatabase', { databaseId, openRowId: rowId });
  }

  // Tapping an embedded view's header opens its own database with that
  // exact view applied (see CustomDatabase's openViewId param), the same
  // "jump to the thing behind this block" move as openCustomRowBlock.
  function openCustomViewBlock(databaseId: string, viewId: string) {
    navigation.navigate('CustomDatabase', { databaseId, openViewId: viewId });
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
    hapticToggle(!blocksRef.current.find((b) => b.id === id)?.checked);
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
  function showDownloadedFileInFolder(uri: string, mimeType: string) {
    dismissDownloadToast();
    // See showDownloadedFile: a SAF destination is a content:// URI, which
    // is not something expo-sharing can take.
    showDownloadedFile(uri, mimeType);
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
  async function saveBlockReminder(reminderDate: string, reminderTime: string | null, reminderKind: ReminderKind) {
    const id = reminderBlockId;
    setReminderBlockId(null);
    const block = blocks.find((b) => b.id === id);
    if (!block) return;
    await cancelReminder(block.reminderNotificationId);
    const notificationId = reminderTime
      ? await scheduleReminder(block.text, reminderDate, reminderTime, reminderKind)
      : undefined;
    const becomesToday = reminderDate === dateKey(new Date());
    snapshotBeforeChange();
    setBlocks((prev) =>
      prev.map((b) => {
        if (b.id !== id) return b;
        const next: Block = { ...b, reminderDate };
        if (reminderTime) {
          next.reminderTime = reminderTime;
          next.reminderKind = reminderKind;
        } else {
          delete next.reminderTime;
          delete next.reminderKind;
        }
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
        const {
          reminderDate: _d1,
          reminderTime: _d2,
          reminderKind: _d4,
          reminderNotificationId: _d3,
          ...rest
        } = b;
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

  async function downloadImageBlock(block: Block) {
    const uri = await flattenPhoto(
      block.imageUri!,
      block.driveFileId,
      block.sketchElements,
      block.sketchWidth,
      block.sketchHeight
    );
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
    // Five answers when there is already a cover - which is exactly two
    // more than Android's own dialog will show, and it drops the extra
    // without a word. Here they are rows, so all of them fit.
    ask({
      title: coverImageUri ? 'Змінити заставку' : 'Додати заставку',
      actions: [
        { id: 'gallery', label: 'Галерея', icon: 'images-outline' },
        { id: 'camera', label: 'Камера', icon: 'camera-outline' },
        // The same free library the tile board's own backgrounds search
        // - see StockPhotoPicker. No duotone here: that step belongs to
        // the tile board's own colour-matching, not to a note's cover.
        { id: 'stock', label: 'Пошук зображень', icon: 'search-outline' },
        ...(coverImageUri
          ? [{ id: 'remove', label: 'Прибрати заставку', tone: 'danger' as const, icon: 'trash-outline' as const }]
          : []),
      ],
    }).then((answer) => {
      if (answer === 'gallery' || answer === 'camera') pickCoverImage(answer);
      else if (answer === 'stock') setSearchingCover(true);
      else if (answer === 'remove') setCoverImageUri(undefined);
    });
  }

  // A stock pick lands as a local file with no width/height attached -
  // Image.getSize reads what compressPickedImage needs, the same two
  // numbers the gallery/camera path already has from the OS picker.
  function pickCoverImageFromStock(uri: string) {
    setSearchingCover(false);
    Image.getSize(
      uri,
      async (width, height) => {
        const compressed = await compressPickedImage(uri, width, height);
        setCoverImageUri(compressed);
        setCoverGradient(undefined);
      },
      () => notify('Не вдалося встановити заставку', 'Не визначився розмір зображення')
    );
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
    // A picture is the cover now; a gradient chosen earlier lets go, or
    // it would keep winning over the picture in the card.
    setCoverGradient(undefined);
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
  // A scanned page is kept more generously than a photograph from the
  // gallery, and on purpose: the detail IS the content. Stored at the
  // snapshot settings (1600px, quality 0.7) a page of a book came back
  // out of the note with its words broken in half when it was read - the
  // same document that read perfectly straight off the scanner.
  async function compressScannedImage(uri: string): Promise<string> {
    const SCAN_MAX_DIMENSION = 2400;
    try {
      const probe = await ImageManipulator.manipulate(uri).renderAsync();
      const longest = Math.max(probe.width, probe.height);
      let context = ImageManipulator.manipulate(uri);
      if (longest > SCAN_MAX_DIMENSION) {
        const scale = SCAN_MAX_DIMENSION / longest;
        context = context.resize({
          width: Math.round(probe.width * scale),
          height: Math.round(probe.height * scale),
        });
      }
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ compress: 0.85, format: SaveFormat.JPEG });
      return saved.uri;
    } catch {
      return uri;
    }
  }

  // Returns the last page's own block id, so a caller that also wants the
  // text knows where to put it.
  async function insertScannedImages(id: string, uris: string[]): Promise<string | null> {
    const compressed: string[] = [];
    for (const uri of uris) {
      compressed.push(await compressScannedImage(uri));
    }
    snapshotBeforeChange();
    let lastBlockId: string | null = null;
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === id);
      if (index === -1) return prev;
      const imageBlocks = compressed.map((uri, i) => ({
        ...buildBlock(i === 0 ? id : generateId(), 'image', ''),
        imageUri: uri,
      }));
      lastBlockId = imageBlocks[imageBlocks.length - 1]?.id ?? null;
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
    return lastBlockId;
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
    let pages: string[] | null;
    try {
      pages = await scanPages();
    } catch {
      return;
    }
    if (!pages) return;
    chooseScanShape(id, pages);
  }

  async function chooseScanShape(id: string, pages: string[]) {
    // «Питання»: its answers are rows, so a third and a fourth one fit.
    // Android's own dialog takes three buttons and silently drops the
    // rest, which is exactly how the fourth answer went missing once.
    //
    // Text is an answer, not a mode of the other two: the pages are kept
    // as pictures either way and the reading goes under them, so there is
    // always something to check it against.
    const choice = await ask({
      title: `Відскановано сторінок: ${pages.length}`,
      actions: [
        { id: 'photo', label: 'Як фото', icon: 'image-outline' },
        { id: 'pdf', label: 'Як PDF', icon: 'document-text-outline' },
        {
          id: 'text',
          label: 'Фото + текст',
          hint: 'Розпізнати написане і додати під знімками',
          icon: 'text-outline',
        },
      ],
    });
    if (choice === 'photo') insertScannedImages(id, pages);
    if (choice === 'pdf') insertScannedPdf(id, pages);
    if (choice === 'text') {
      const lastId = await insertScannedImages(id, pages);
      if (lastId) startRecognizing(pages, lastId);
    }
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
      case 'heading':
      case 'code':
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

  // The picture under the canvas, when the block being drawn on is one.
  const sketchBlock = sketchEditorBlockId ? blocks.find((b) => b.id === sketchEditorBlockId) : undefined;
  const sketchBackground =
    sketchBlock && (sketchBlock.type ?? 'paragraph') === 'image' && sketchBlock.imageUri
      ? { uri: sketchBlock.imageUri }
      : undefined;

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

  // Straight into the app built for that kind of file - a .docx into
  // Office, a PDF into the reader - see openFileExternally, which is
  // shared with the files database so a file opens the same way wherever
  // it is tapped.
  async function openFileBlock(id: string) {
    const block = blocks.find((b) => b.id === id);
    if (!block?.fileUri) return;
    const file = {
      fileUri: block.fileUri,
      fileName: block.fileName ?? 'Файл',
      mimeType: block.mimeType,
      driveFileId: block.driveFileId,
    };
    // A Word or Excel file is looked at right here (see DocumentQuickLook);
    // anything else goes to the app that opens it.
    const kind = quickLookKindFor(file.fileName);
    if (kind) {
      if (await ensureFileIsHere(file)) {
        setQuickLook({ uri: file.fileUri, name: block.fileTitle || file.fileName, kind, file });
      }
      return;
    }
    await openFileExternally(file);
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

  // The chosen blocks as a note of their own, named after this one. Asked
  // each time whether they are copied or moved: "вирізки" reads like
  // cutting, but taking blocks out of a note is not something to do by
  // accident, and both answers are useful.
  async function clipSelectedToNote() {
    const ordered = blocks.filter((b) => selectedIds.has(b.id));
    if (ordered.length === 0) return;
    const answer = await ask({
      title: 'Нова нотатка з вирізок',
      message: `${ordered.length} ${ordered.length === 1 ? 'блок' : 'блоки(ів)'} з «${title.trim() || 'Без назви'}»`,
      actions: [
        { id: 'copy', label: 'Копіювати', tone: 'primary' },
        { id: 'move', label: 'Перенести' },
      ],
    });
    if (answer !== 'copy' && answer !== 'move') return;
    const moving = answer === 'move';
    let clippedId: string;
    try {
      clippedId = await clipBlocksToNote(
        `${title.trim() || 'Без назви'} (вирізки)`,
        ordered.map((b) => clippedBlock(b, moving))
      );
    } catch (e) {
      notify('Не збереглося', (e as Error).message);
      return;
    }
    if (moving) {
      snapshotBeforeChange();
      setBlocks((prev) => {
        const next = prev.filter((block) => !selectedIds.has(block.id));
        return next.length > 0 ? next : [newBlock()];
      });
    }
    setSelectedIds(new Set());
    setIsSelectMode(false);
    if (openInPane) openInPane(clippedId, { offerBoard: true });
    else navigation.navigate('Editor', { documentId: clippedId, offerBoard: true });
  }

  // Accepting the offer above. The note already exists in Firestore - the
  // clipping wrote it before this screen opened - so the card can point
  // at it straight away.
  async function putThisNoteOnBoard(boardId: string | null) {
    const name = title.trim() || 'Без назви';
    setBoardPicker(false);
    setBoardOffer(false);
    try {
      const item = { id: documentId, kind: 'document', title: name, data: {} };
      if (boardId) await addItemToBoard(boardId, item);
      else await createBoardAndAddItem(name, item);
    } catch (e) {
      notify('Не вдалося додати на дошку', (e as Error).message);
    }
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

  // «Експорт» is one button in the dock and two possible files, so the
  // button asks. Through the app's own Ask surface rather than a raw
  // Alert, and in the same shape the scanner already uses for "Як фото
  // / Як PDF" - one question, the answers as the actions.
  function askExport() {
    ask({
      title: 'Експортувати нотатку',
      actions: [
        { id: 'pdf', label: 'У PDF' },
        { id: 'txt', label: 'У TXT' },
      ],
    }).then((id) => {
      if (id === 'pdf') exportAsPdf();
      else if (id === 'txt') exportAsTxt();
    });
  }

  function toggleSelectMode() {
    setIsSelectMode((prev) => !prev);
    setSelectedIds(new Set());
  }

  // A block held and let go where it stood - see BlockList's
  // onHoldWithoutDrag. The user's own design, and it retires the
  // «Вибрати» row from the "…" menu: the way into select mode is now the
  // gesture people already try on a list of things, and it arrives with
  // the block you were holding already ticked, so the mode is never
  // entered empty.
  //
  // Already in select mode: the hold is just another tick, which is what
  // the tap does too - a hold that undid a selection would be a trap.
  function selectFromHold(id: string) {
    if (isSelectMode) {
      toggleSelected(id);
      return;
    }
    setIsSelectMode(true);
    setSelectedIds(new Set([id]));
    // And the dock turns its own page. The actions for a selection are
    // on the stack's second card, and asking the user to swipe to the
    // card they clearly just asked for would be the same "invisible
    // exit" mistake the calendar context already taught this project.
    showActions();
  }

  // Format while selecting, without a keyboard or a single focused
  // block - the "/" toolbar's own convertBlockType only ever knew one
  // target. Same toggle-back-to-paragraph rule per block as that one
  // (tapping the icon a second time on an already-numbered block
  // un-numbers it), applied across every selected id in one state
  // update and one undo step, rather than one per block. Selection and
  // select mode stay on afterwards - formatting is something you do
  // WHILE picking blocks, not a reason to leave that mode.
  function convertSelectedBlocks(type: BlockType) {
    if (selectedIds.size === 0) return;
    snapshotBeforeChange();
    setBlocks((prev) =>
      prev.map((b) => {
        if (!selectedIds.has(b.id)) return b;
        const currentType = b.type ?? 'paragraph';
        const nextType = currentType === type ? 'paragraph' : type;
        return buildBlock(b.id, nextType, b.text);
      })
    );
  }

  useImperativeHandle(ref, () => ({ toggleSelectMode }));

  useEffect(() => {
    onSelectModeChange?.(isSelectMode);
  }, [isSelectMode]);

  useEffect(() => {
    onSaveStatusChange?.(saveStatus);
  }, [saveStatus]);

  // The canvas's "+": what the page's "/" menu offers for pictures,
  // files and records, without leaving the canvas. A block is made at
  // the place the canvas points at (the middle of the view), and the
  // same handlers the page uses then fill it - so a picture taken here
  // is a picture block like any other, mirrored into Фото, backed up to
  // Drive, everything. Text is just the empty card, to be typed into.
  async function addToCanvas(at: { x: number; y: number }) {
    const choice = await ask({
      title: 'Що додати?',
      actions: [
        { id: 'text', label: 'Текст', icon: 'text-outline' },
        { id: 'camera', label: 'Камера', icon: 'camera-outline' },
        { id: 'gallery', label: 'Зображення', icon: 'image-outline' },
        { id: 'file', label: 'Файл', icon: 'document-outline' },
        { id: 'existing', label: 'З бази', hint: 'Фото, файл, посилання або запис, що вже є', icon: 'albums-outline' },
      ],
    });
    if (choice === 'cancel') return;
    snapshotBeforeChange();
    const created: Block = { ...newBlock(), canvas: at };
    setBlocks((prev) => [...prev, created]);
    if (choice === 'camera') takePhotoForBlock(created.id);
    else if (choice === 'gallery') pickImageForBlock(created.id);
    else if (choice === 'file') pickFileForBlock(created.id);
    else if (choice === 'existing') setExistingItemPickerBlockId(created.id);
  }

  // What a drop from the reference panel actually does - the same clone
  // pattern the board/database copy-paste clipboard already uses
  // (pasteCopiedObject, below): a fresh id so it is its own block here,
  // never the source's, at the exact surface point it was let go over
  // (CanvasReferencePanel's own drop handler already converted the
  // screen point through DocumentCanvasHandle.screenToSurface).
  function insertReferenceBlock(block: Block, at: { x: number; y: number }) {
    snapshotBeforeChange();
    const created: Block = { ...block, id: generateId(), createdAt: Date.now(), canvas: at };
    setBlocks((prev) => [...prev, created]);
  }

  function addBlockAtEnd() {
    snapshotBeforeChange();
    const created = newBlock();
    focusIdRef.current = created.id;
    setBlocks((prev) => [...prev, created]);
  }

  // Whatever was last copied from a board card or a database screen, as a
  // block. It references the same photo, file or link - pasting it puts
  // that object here, not a second copy of it (see objectClipboard).
  function pasteCopiedObject() {
    const value = getCopiedObject();
    if (!value) return;
    snapshotBeforeChange();
    const pasted: Block = { ...value.block, id: generateId(), createdAt: Date.now() };
    setBlocks((prev) => [...prev, pasted]);
    clearCopiedObject();
  }

  function handleReorderBlocks(next: Block[]) {
    snapshotBeforeChange();
    setBlocks(next);
  }

  async function shareImageBlock(block: Block) {
    try {
      const available = await Sharing.isAvailableAsync();
      if (!available) return;
      const uri = await flattenPhoto(
        block.imageUri!,
        block.driveFileId,
        block.sketchElements,
        block.sketchWidth,
        block.sketchHeight
      );
      await Sharing.shareAsync(uri);
    } catch {
      // No sharing app available or the user backed out - nothing to do.
    }
  }

  function renameImageBlock(id: string, title: string) {
    snapshotBeforeChange();
    setBlocks((prev) => prev.map((b) => (b.id === id ? { ...b, imageTitle: title } : b)));
    // Straight to the record, because the sync no longer carries titles
    // for a photo that already exists - see syncPhotosForDocument. The
    // block keeps its own copy as the fallback it has always been; the
    // name everything actually shows comes from here.
    setDoc(doc(db, 'photos', id), { title, updatedAt: Date.now() }, { merge: true });
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

  // From liveBlocks, not blocks: the picture on the block came through the
  // record overlay (see useLiveRecords), and a viewer reading the raw
  // block instead got no driveFileId - a picture that showed in the note
  // and opened onto a crossed-out cloud.
  const viewerBlock = viewerImageId ? liveBlocks.find((b) => b.id === viewerImageId) : null;

  // The page's text, under the page itself. Tesseract reads the number
  // sign as "Мо"/"Ме"/"Хо" almost every time - that one is worth fixing
  // here rather than leaving in every scanned document.
  function tidyRecognized(text: string): string {
    return text
      .replace(/\b[МХ][ое]\s?(?=\d)/g, '№ ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  // The pages come back with every word and the box it sits in, so the
  // next step is not "here is the text" but "choose what you want off the
  // page" - see TextSelection.
  function showRecognized(pages: RecognizedPage[]) {
    const after = recognizing?.after;
    setRecognizing(null);
    setRecognizeProgress(null);
    const anything = pages.some((page) => page.words.length > 0);
    if (!after || !anything) {
      notify('Нічого не знайшлось', 'На цьому знімку не вдалося прочитати текст.');
      return;
    }
    setSelecting({ pages, after });
  }

  function insertRecognizedText(text: string) {
    const after = selecting?.after;
    setSelecting(null);
    const tidied = tidyRecognized(text);
    if (!after || !tidied) return;
    setBlocks((prev) => {
      const index = prev.findIndex((b) => b.id === after);
      if (index < 0) return prev;
      const next = [...prev];
      next.splice(index + 1, 0, { id: generateId(), text: tidied });
      return next;
    });
  }
  const imageRenameBlock = imageRenameId ? blocks.find((b) => b.id === imageRenameId) : null;

  if (!isLoaded) {
    // Should resolve almost instantly now that the initial load tries the
    // local cache first (see above) - this only shows at all on a genuine
    // cache miss, and a spinner reads as "loading" rather than a stray
    // blank flash.
    return (
      <View style={[styles.container, styles.loadingContainer, embedded && styles.containerEmbedded]}>
        <ActivityIndicator color={theme.accent} />
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
      <View
        style={[
          styles.header,
          // In a pane the document starts on the same line the list's
          // cards do - so the cover, not empty space, is what the capsule
          // lies across.
          //
          // Except where the capsule LIES DOWN, which is what it does on
          // the left edge of a pane: there it is a bar across the top of
          // the document, and starting the text on the same line put the
          // title underneath it. Its own height plus a gap, so the title
          // begins below it instead.
          railTop !== undefined && {
            paddingTop: railTop + (railHorizontal ? HORIZONTAL_CAPSULE_HEIGHT + 12 : 0),
            paddingBottom: 0,
          },
        ]}
      >
        {/* Empty - both its buttons stand on the rail. It stays for the
            top spacing it gives whatever comes first. */}
        <View style={styles.headerLeft} />
      </View>
      )}

      {/* The same rail the documents screen has: standing on the right
          edge, in the same glass, at the same size, with its own blur -
          which is why it goes through the portal, like every other piece
          of glass here. */}
      {!embedded && editorFocused && (
        <GlassPortal>
          {/* The same line the documents screen's capsule hangs from, off
              the same constants - the two screens sit one behind the
              other, and a capsule that shifted between them would read as
              a different control. */}
          <View
            style={[
              styles.editorRail,
              { top: railTop ?? editorInsets.top + CHROME_TOP + CAPSULE_DROP },
              railSide,
            ]}
            pointerEvents="box-none"
          >
            <GlassDrop style={[styles.headerRight, railHorizontal && styles.headerRightRow]}>
              {/* The way out first, full screen in the middle, the menu
                  last - reading order on a capsule lying down, and the
                  one you reach for most at the end nearest the text. */}
              <Pressable
                hitSlop={8}
                onPress={() => {
                  // One step at a time: put the text down, then shut
                  // the drawer, and leave the document only once there
                  // is nothing left open. Back walking straight out of
                  // the note while the reference drawer stood open is
                  // what left it with no way to close at all.
                  if (canvasEditing) {
                    canvasApiRef.current?.stopEditing();
                    return;
                  }
                  if (referencePanelOpen) {
                    setReferencePanelOpen(false);
                    return;
                  }
                  if (closePane) closePane();
                  else navigation.goBack();
                }}
              >
                <GlassIcon
                  name={canvasEditing ? 'checkmark-outline' : 'arrow-back-outline'}
                  size={24}
                />
              </Pressable>
              {/* Only where there are two panes to collapse into one. */}
              {!!onToggleFullscreen && (
                <>
                  <View
                    style={[styles.headerRightDivider, railHorizontal && styles.headerRightDividerRow]}
                  />
                  <Pressable hitSlop={8} onPress={onToggleFullscreen}>
                    <GlassIcon
                      name={paneFullscreen ? 'contract-outline' : 'expand-outline'}
                      size={24}
                    />
                  </Pressable>
                </>
              )}
              <View style={[styles.headerRightDivider, railHorizontal && styles.headerRightDividerRow]} />
              {/* Page/canvas moved into the "..." menu below (see "Вигляд")
                  - a third icon on the capsule pushed the page's own text
                  narrower than it needed to be, for a button used far less
                  often than back or the menu itself. */}
              <Pressable hitSlop={8} onPress={() => setExportMenuOpen((v) => !v)}>
                <GlassIcon name="ellipsis-horizontal-outline" size={24} />
              </Pressable>
              {/* The save indicator STAYS on this capsule's outline,
                  and this is the reason the capsule itself survives the
                  merge rather than dissolving into the dock with its
                  buttons.

                  It was moved to the dock's front card for one round -
                  bigger, more central, the same stadium shape - and the
                  user stopped it before it shipped, with the argument
                  that settles it: this thing fires on EVERY save, which
                  is every few seconds of typing, and a light travelling
                  round a capsule directly under the line being read is
                  "новорічна гірлянда з відстані 50 сантиметрів 2
                  години". The corner is not a worse place for it, it is
                  the RIGHT place - "вона одночасно і в центрі і не в
                  центрі уваги". Peripheral vision notices a change
                  without the eye having to read it.

                  Rule for anything ambient that repeats: the middle of
                  the screen is for what you act on, the corner for what
                  you only need to notice. Last child, so it draws over
                  the blur. */}
              <SaveRing saving={saveStatus === 'saving'} />
            </GlassDrop>
          </View>
        </GlassPortal>
      )}

      {/* The note's own dock USED TO STAND HERE, in two faces - the
          Полотно/Референси row and the select-mode row. Both are gone
          (2026-09-19): the note publishes what it can do and ContextDock
          draws it, the way every other screen already worked.

          It was the last surface still made of GlassDrop and still sized
          in POINTS, both against rules this project had already paid for
          - so it read as a different control standing in the same place
          as the real dock. Publishing instead of drawing means there is
          no second place those rules can be missed in.

          The select face's five block-type conversions moved onto the
          actions card WITH everything else, past the four a card fits,
          so that row scrolls. Deliberately: the alternative was a «Тип»
          button opening a sheet, and that is two taps for the one thing
          the user explicitly asked to be able to do while picking blocks.
          A scrolling row admits there are more than fit; a sheet hides
          them. */}
      {exportMenuOpen && <Pressable style={styles.exportMenuBackdrop} onPress={() => setExportMenuOpen(false)} />}
      {exportMenuOpen && (
        <GlassPortal>
        // Beside the rail rather than under the old header corner: its
        // top lines up with the rail's, and it stops short of it.
        <View
          style={[
            styles.exportMenuPanel,
            {
              // As wide as the dock, and standing on it. The user's own
              // proposal - "панель буде випадати шириною в док... щоб
              // було гармонійно" - and the width is READ from the dock's
              // own geometry rather than measured by eye, because two
              // things only read as one object while they agree to the
              // pixel. It used to hang off the rail in the top-right
              // corner, which is where its button used to be.
              width: dockRowWidth(windowWidth),
              left: Math.round((windowWidth - dockRowWidth(windowWidth)) / 2),
              bottom: menuClearance,
              // Never taller than the room above the dock. The rows it
              // holds are what you set ONCE, so scrolling to them costs
              // nothing - being clipped by a panel with overflow hidden
              // would cost everything below the fold.
              maxHeight: windowHeight - menuClearance - editorInsets.top - 24,
            },
          ]}
        >
          <BlurView
            intensity={60}
            tint="dark"
            blurMethod="dimezisBlurView"
            blurTarget={editorBlurTarget ?? undefined}
            style={StyleSheet.absoluteFill}
            pointerEvents="none"
          />
          <RNScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={styles.exportMenuScroll}
          >
          <Text style={styles.exportMenuLabel}>Вигляд</Text>
          {/* «Полотно»/«Сторінка» and «Референси» used to stand here.
              They are the two things you press many times in one sitting,
              and they were lying deeper than the choice of paper colour -
              so they moved to the dock at the foot of the screen, where
              they are one press away. What stays in this menu is what you
              set once. */}
          <Text style={styles.exportMenuLabel}>Оформлення</Text>
          <Pressable style={styles.exportMenuRow} onPress={openCoverImageOptions}>
            <Ionicons name="image-outline" size={17} color={GLASS_TEXT} />
            <Text style={styles.exportMenuRowLabel}>
              {coverImageUri ? 'Змінити заставку' : 'Додати заставку'}
            </Text>
          </Pressable>
          {/* The cover's gradients, right under the row that sets a
              picture: tap one to make it the cover (and let go of any
              picture), tap the chosen one again to fall back to the
              note's own default. */}
          <View style={styles.coverSwatches}>
            {COVER_GRADIENTS.map((g) => {
              const on = coverGradient === g.id;
              return (
                <Pressable
                  key={g.id}
                  hitSlop={4}
                  onPress={() => {
                    setCoverGradient(on ? undefined : g.id);
                    if (!on) setCoverImageUri(undefined);
                  }}
                  style={[styles.coverSwatch, on && styles.coverSwatchOn]}
                >
                  <CoverGradientView gradient={g} style={styles.coverSwatchFill} />
                </Pressable>
              );
            })}
          </View>
          <Pressable style={styles.exportMenuRow} onPress={() => setPaperColorEnabled((v) => !v)}>
            <Ionicons name="color-palette-outline" size={17} color={GLASS_TEXT} />
            <Text style={styles.exportMenuRowLabel}>Колір паперу</Text>
            {paperColorEnabled && <Ionicons name="checkmark" size={18} color={theme.accent} />}
          </Pressable>
          <Text style={styles.exportMenuLabel}>Організація</Text>
          <Pressable
            style={styles.exportMenuRow}
            onPress={() => {
              setExportMenuOpen(false);
              setGroupPickerVisible(true);
            }}
          >
            <Ionicons name="folder-outline" size={17} color={GLASS_TEXT} />
            <Text style={styles.exportMenuRowLabel}>
              {groups.find((g) => g.id === groupId)?.name ?? 'Додати в групу'}
            </Text>
          </Pressable>
          {!!sourceBoardId && (
            <>
              <Text style={styles.exportMenuLabel}>Джерело</Text>
              <Pressable
                style={styles.exportMenuRow}
                onPress={() => {
                  setExportMenuOpen(false);
                  navigation.navigate('Tabs', {
                    screen: 'Дошки',
                    params: { screen: 'Board', params: { boardId: sourceBoardId, openDocumentId: documentId } },
                  });
                }}
              >
                <Ionicons name="grid-outline" size={17} color={GLASS_TEXT} />
                <Text style={styles.exportMenuRowLabel}>Показати дошку</Text>
              </Pressable>
            </>
          )}
          <Text style={styles.exportMenuLabel}>Експорт</Text>
          <Pressable style={styles.exportMenuRow} onPress={exportAsPdf}>
            <Ionicons name="document-text-outline" size={17} color={GLASS_TEXT} />
            <Text style={styles.exportMenuRowLabel}>У PDF</Text>
          </Pressable>
          <Pressable style={styles.exportMenuRow} onPress={exportAsTxt}>
            <Ionicons name="reader-outline" size={17} color={GLASS_TEXT} />
            <Text style={styles.exportMenuRowLabel}>У TXT</Text>
          </Pressable>
          <View style={styles.exportMenuRule} />
          <Pressable
            style={styles.exportMenuRow}
            onPress={() => {
              setExportMenuOpen(false);
              toggleSelectMode();
            }}
          >
            <Ionicons
              name={isSelectMode ? 'close-outline' : 'ellipse-outline'}
              size={17}
              color={GLASS_TEXT}
            />
            <Text style={styles.exportMenuRowLabel}>{isSelectMode ? 'Скасувати вибір' : 'Вибрати'}</Text>
          </Pressable>
          <Pressable style={styles.exportMenuRow} onPress={confirmDeleteDocument}>
            <Ionicons name="trash-outline" size={17} color={GLASS_DANGER} />
            <Text style={[styles.exportMenuRowLabel, { color: GLASS_DANGER }]}>Видалити документ</Text>
          </Pressable>
          </RNScrollView>
        </View>
        </GlassPortal>
      )}

      {/* Embedded (CalendarScreen): the select-mode toggle and save
          checkmark both live in CalendarScreen's own header capsule now,
          not in a row here - see onSelectModeChange/onSaveStatusChange and
          the exposed toggleSelectMode ref method above. Undo/redo live in
          the pinned toolbar (both here and in the full-screen header
          above), not here either. */}

      {canvasMode && !embedded && (
        <DocumentCanvas
          ref={canvasApiRef}
          onEditingChange={setCanvasEditing}
          links={canvasLinks}
          onAdd={addToCanvas}
          // Arrows have a direction now - it is what says which end of a
          // chain is the beginning. So the same pair asked for the SAME
          // way round is the arrow being taken away; asked for the other
          // way round, it is the arrow turning to point the other way.
          // One gesture makes, turns and unmakes.
          onToggleLink={(from, to) => {
            setCanvasLinks((prev) => {
              const same = Object.entries(prev).find(([, l]) => l.from === from && l.to === to);
              const reversed = Object.entries(prev).find(([, l]) => l.from === to && l.to === from);
              const next = { ...prev };
              if (same) delete next[same[0]];
              else if (reversed) next[reversed[0]] = { from, to };
              else next[`${Date.now()}-${Math.random().toString(36).slice(2)}`] = { from, to };
              return next;
            });
          }}
          // The live records, same as the page: a photo renamed elsewhere
          // is renamed on the canvas too.
          blocks={liveBlocks}
          onMoveBlock={(id, x, y) => updateBlockFields(id, { canvas: { x, y } })}
          // The page's own handler: one place decides what typing into a
          // block means - a list that continues itself, an undo snapshot
          // per pause, the mirror records. The canvas is another keyboard
          // pointed at the same document, not a second editor.
          onChangeText={handleBlockChange}
          // Writing stays on the page. A tap says which block, the page
          // opens with it active - the canvas is for arranging, not typing.
          onOpenBlock={(id) => {
            leaveCanvas();
            handleActivateBlock(id);
          }}
        />
      )}

      {/* «Референси» - a drawer over the LEFT of the canvas, never the
          whole screen: the canvas has to stay visible and reachable on
          the right as the drop target, and the right edge is the rail's. Same shape on every width for now
          - the Fold's own wide inner screen could stand a true side pane
          instead, deliberately deferred rather than risked in the same
          pass as this screen's own existing embedded/pane double-split
          rule (see pane_double_split memory). */}
      {canvasMode && !embedded && referencePanelOpen && (
        <View style={styles.referencePanelDock} pointerEvents="box-none">
          {/* Its own boundary: a panel that browses every database in the
              app has more ways to fail than the note it stands beside,
              and none of them should be able to take the note down. */}
          <CrashBoundary>
            <CanvasReferencePanel
              visible
              onClose={() => setReferencePanelOpen(false)}
              canvasRef={canvasApiRef}
              onInsertBlock={insertReferenceBlock}
            />
          </CrashBoundary>
        </View>
      )}

      {!(canvasMode && !embedded) && (
      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollArea}
        contentContainerStyle={[
          embedded && styles.scrollAreaEmbedded,
          // Used to stop short of the rail the way a mail's text does
          // under its capsule - narrowing every block on the page, at
          // every scroll position, to clear a capsule that only ever
          // shows near the top. Dropping the capsule to two buttons (see
          // the "..." menu's own "Вигляд" section) was the point of doing
          // that: the field now runs the full width, with just its own
          // 20 of side padding; the short capsule may sit over the very
          // top of the scroll on its own translucent glass, same as any
          // other floating header here.
          // Embedded, with the keyboard down, the floating island sits over
          // the bottom of this list - the last block (and "Додати блок")
          // has to be able to scroll clear of it.
          // The pinned toolbar covers its own strip above the keyboard on
          // top of that, so it gets added whenever the bar is showing.
          // Bottom room is the animated spacer at the end of the list, not
          // padding here - see bottomSpacerStyle.
        ]}
        keyboardShouldPersistTaps="handled"
        // Android's ScrollView scrolls on its own to "reveal" an EditText
        // that gains focus (requestChildFocus / requestChildRectangleOnScreen).
        // Here that fired for the freshly mounted, not-yet-laid-out input
        // of a tapped block - it computed the reveal against an empty rect
        // at the top and flung the whole list back to offset 0, then
        // smooth-scrolled down to the input again, all before the keyboard
        // had even started rising. Traced on-device: that was the first
        // of the two jumps on every tap. This screen positions the active
        // block itself (keyboard-synced scroll + safety net above), so the
        // built-in behaviour is switched off.
        scrollsChildToFocus={false}
        onScroll={(e) => {
          scrollOffsetRef.current = e.nativeEvent.contentOffset.y;
          scrollOffsetSV.value = e.nativeEvent.contentOffset.y;
        }}
        scrollEventThrottle={16}
      >
        {!embedded && coverImageUri && (
          <Pressable onPress={openCoverImageOptions}>
            {/* A cover stores only its path, not a Drive id of its own. It
                is always one of the document's own pictures, though, so
                the block that carries the same path knows where the copy
                is - and a cover with no such block simply shows its
                state, as any picture here does. See AttachmentImage. */}
            <AttachmentImage
              uri={coverImageUri}
              driveFileId={blocks.find((b) => b.imageUri === coverImageUri)?.driveFileId}
              style={styles.coverImage}
              countsAsUse
            />
          </Pressable>
        )}

        {!embedded && titleActive && (
        <TextInput
          autoFocus
          // Grown to its text, same as a block's field - a long title
          // soft-wraps, and in a browser a wrapped textarea clips instead
          // of growing. See autoGrowInput.
          ref={(node) => {
            titleInputRef.current = node;
            autoGrowInput(node);
          }}
          value={title}
          onChangeText={(text) => {
            handleTitleChange(text);
            autoGrowInput(titleInputRef.current);
          }}
          // The pinned toolbar acts on a block, not the title - hide it
          // rather than have it apply to whatever block last had focus.
          onFocus={() => {
            focusedBlockIdRef.current = null;
            setFocusedBlockId(null);
          }}
          onBlur={() => setTitleActive(false)}
          placeholder={dayName ?? 'Без назви'}
          placeholderTextColor={paperColor?.textMuted ?? theme.paper.inkFaint}
          style={[styles.titleInput, paperColor && { color: paperColor.text }]}
          multiline
        />
        )}
        {!embedded && !titleActive && (
        // Same locked/active split as a block: plain text a swipe scrolls
        // through, a tap turns it into the input above.
        <Pressable onPress={() => setTitleActive(true)}>
          <Text
            style={[
              styles.titleInput,
              paperColor && { color: paperColor.text },
              // A day's date is its NAME, not a placeholder standing in
              // for one - so it is not drawn in the faint colour an
              // unnamed note's is.
              !title && !dayName && { color: paperColor?.textMuted ?? theme.paper.inkFaint },
            ]}
          >
            {title || dayName || 'Без назви'}
          </Text>
        </Pressable>
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
          // The daily note's sheet runs under the rail, so its rows draw
          // no handle column - see BlockRow's hideHandle.
          hideHandle={embedded}
          // Drawn from the records as they are NOW, not as they were when
          // the block was inserted - see useLiveRecords. Applied HERE and
          // nowhere else on purpose: `blocks` is what gets saved, and a
          // live value must never be written back into the document as
          // though someone had typed it.
          blocks={liveBlocks}
          onReorder={handleReorderBlocks}
          onHoldWithoutDrag={selectFromHold}
          selectedIds={selectedIds}
          isSelectMode={isSelectMode}
          focusedBlockId={focusedBlockId}
          onActivate={handleActivateBlock}
          onBlur={handleBlockBlur}
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
          onDrawOverImage={openSketchBlock}
          onOpenFile={openFileBlock}
          onDownloadFile={downloadFileBlock}
          onOpenFileDatabase={() => navigation.navigate('Files')}
          onOpenLink={openLinkBlock}
          onOpenLinkDatabase={openLinkDatabase}
          onOpenSketch={openSketchBlock}
          allTags={tags}
          onOpenCustomRow={openCustomRowBlock}
          onOpenCustomView={openCustomViewBlock}
          onInputRef={(id, ref) => {
            inputRefs.current[id] = ref;
          }}
          paperColor={paperColor}
        />

        {selectedIds.size === 0 && (
          <View style={styles.addBlockRow}>
            <Pressable style={styles.addBlock} onPress={addBlockAtEnd}>
              <Ionicons name="add" size={18} color={paperColor?.text ?? theme.paper.ink} />
              <Text style={[styles.addBlockLabel, paperColor && { color: paperColor.text }]}>Додати блок</Text>
            </Pressable>
            {/* Only while there is something to paste, and it says what
                that something is - a paste button that might do nothing is
                worse than none. */}
            {!!copiedObject && (
              <Pressable style={styles.addBlock} onPress={pasteCopiedObject}>
                <Ionicons name="clipboard-outline" size={18} color={paperColor?.text ?? theme.paper.ink} />
                <Text style={[styles.addBlockLabel, paperColor && { color: paperColor.text }]}>
                  Вставити {copiedObject.label}
                </Text>
              </Pressable>
            )}
          </View>
        )}
        <Animated.View style={bottomSpacerStyle} />
      </ScrollView>
      )}

      {embedded && selectedIds.size > 0 && (
        // Embedded only (CalendarScreen's daily note) - there is no
        // Полотно dock there to share a slot with (that dock is
        // !embedded-only, since CalendarScreen owns its own header
        // capsule), so this stays the plain dark capsule it always was.
        // The regular document editor's own select mode now shares the
        // docDock slot above instead - see selectedIds.size there.
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
            <Pressable style={styles.selectedActionBtn} hitSlop={6} onPress={clipSelectedToNote}>
              <Ionicons name="document-text-outline" size={18} color="#fff" />
              <Text style={styles.selectedActionLabel}>В нотатку</Text>
            </Pressable>
            <Pressable style={styles.selectedActionBtn} hitSlop={6} onPress={deleteSelectedBlocks}>
              <Ionicons name="trash-outline" size={18} color="#fff" />
              <Text style={styles.selectedActionLabel}>Видалити</Text>
            </Pressable>
          </View>
        </View>
      )}

      {/* The offer that rides in with a clipping - accept or refuse, and
          either way it is gone. It stands where the select-mode bar
          stands, and never at the same time as it. */}
      {boardOffer && selectedIds.size === 0 && (
        <View style={styles.selectedActionsWrap} pointerEvents="box-none">
          <View style={styles.selectedActionsCapsule}>
            <Text style={styles.selectedActionsCount}>Додати на дошку?</Text>
            <View style={styles.selectedActionsDivider} />
            <Pressable style={styles.selectedActionBtn} hitSlop={6} onPress={() => setBoardPicker(true)}>
              <Ionicons name="checkmark" size={18} color="#fff" />
              <Text style={styles.selectedActionLabel}>Так</Text>
            </Pressable>
            <Pressable style={styles.selectedActionBtn} hitSlop={6} onPress={() => setBoardOffer(false)}>
              <Ionicons name="close" size={18} color="#fff" />
              <Text style={styles.selectedActionLabel}>Ні</Text>
            </Pressable>
          </View>
        </View>
      )}

      <SaveDestinationSheet
        visible={boardPicker}
        boardsOnly
        title="На яку дошку?"
        onPickNewBoard={() => putThisNoteOnBoard(null)}
        onPickExistingBoard={(boardId) => putThisNoteOnBoard(boardId)}
        onClose={() => setBoardPicker(false)}
      />

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
              driveFileId={viewerBlock.driveFileId}
              onClose={() => setViewerImageId(null)}
              actions={[
                {
                  key: 'rename',
                  icon: 'pencil-outline',
                  label: 'Назва',
                  // Viewer first, then the prompt - RenamePrompt is a
                  // layer inside the screen, not a Modal, so opened from
                  // behind this one it sat underneath and appeared only
                  // when the picture was dismissed.
                  onPress: () => {
                    const id = viewerBlock.id;
                    setViewerImageId(null);
                    setImageRenameId(id);
                  },
                },
                {
                  // The name and the rest of what the record knows, asked
                  // for rather than printed under the picture - a note
                  // stays a note. Read fresh, so it is what is true now
                  // and not what the block was given when it was made.
                  key: 'info',
                  icon: 'information-circle-outline',
                  label: 'Інфо',
                  onPress: () => {
                    const id = viewerBlock.id;
                    const fallback = viewerBlock.imageTitle;
                    // The viewer closes FIRST, as "База" and "Текст"
                    // already do. It is a Modal, and on Android a Modal
                    // is its own native window drawn over everything -
                    // including the app's own question windows, which are
                    // mounted once at the root. So the info panel opened
                    // underneath it and only appeared when the picture
                    // was dismissed, which read as the window arriving on
                    // the wrong tap.
                    setViewerImageId(null);
                    attachmentInfoText('photos', id, fallback).then((text) =>
                      notify('Про зображення', text)
                    );
                  },
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
                  // Never automatic: most photographs are not pages, and
                  // spending ten seconds of the phone on every one of
                  // them would be rude. Asked for, on the picture that
                  // has text in it.
                  key: 'ocr',
                  icon: 'text-outline',
                  label: 'Текст',
                  // Asked before it starts. It is the one action in this
                  // bar that takes ten seconds of the phone and adds
                  // blocks to the document, and it sat between "База" and
                  // "Поділитись" where a mis-aimed thumb sets it going
                  // with nothing to stop it.
                  onPress: () => {
                    const uri = viewerBlock.imageUri!;
                    const afterId = viewerBlock.id;
                    // Closed BEFORE the question, not after it. The
                    // question is a layer in the screen too, so asking it
                    // from behind this Modal would have hidden it exactly
                    // the way the info panel was hidden - and a
                    // confirmation nobody can see is worse than none.
                    setViewerImageId(null);
                    confirm({
                      title: 'Прочитати текст із зображення?',
                      message: 'Займе кілька секунд. Прочитане додасться в документ під цим зображенням.',
                      confirmLabel: 'Прочитати',
                      tone: 'primary',
                    }).then((yes) => {
                      if (yes) startRecognizing([uri], afterId);
                    });
                  },
                },
                {
                  key: 'share',
                  icon: 'share-social-outline',
                  label: 'Поділитись',
                  // The picture and its drawing (if it has one) go out
                  // together - see useFlattenPhoto. The layer is never
                  // touched by this; it is only put together for the
                  // file that leaves the app.
                  onPress: () => shareImageBlock(viewerBlock),
                },
                {
                  key: 'download',
                  icon: 'download-outline',
                  label: 'Завантажити',
                  // Viewer first, for a quieter version of the same
                  // reason: this finishes with a toast saying where the
                  // file went, and that toast lives in the screen. Behind
                  // the viewer it was invisible for its whole four
                  // seconds, so a download that worked looked like one
                  // that did nothing.
                  onPress: () => {
                    const block = viewerBlock;
                    setViewerImageId(null);
                    downloadImageBlock(block);
                  },
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

      <TextSelection
        pages={selecting?.pages ?? null}
        onClose={() => setSelecting(null)}
        onInsert={insertRecognizedText}
      />

      <TextRecognizer
        request={recognizing?.request ?? null}
        onProgress={setRecognizeProgress}
        onDone={showRecognized}
        onError={(message) => {
          setRecognizing(null);
          setRecognizeProgress(null);
          notify('Не вдалося розпізнати', message);
        }}
      />
      {/* It takes seconds, not an instant - so it says so, and says which
          page it is on. */}
      {recognizeProgress && (
        <View style={styles.ocrToast}>
          <ActivityIndicator color="#fff" />
          <Text style={styles.ocrToastLabel}>
            {recognizeProgress.stage ?? 'Читаю текст'}
            {recognizeProgress.of > 1 ? ` · ${recognizeProgress.page} з ${recognizeProgress.of}` : ''}
            {recognizeProgress.progress > 0 ? ` · ${Math.round(recognizeProgress.progress * 100)}%` : ''}
          </Text>
        </View>
      )}

      <VideoPlayerModal url={playingVideoUrl} onClose={() => setPlayingVideoUrl(null)} />

      {/* Pinned directly above the keyboard, mounted for as long as
          isToolbarVisible - which now means only `focusedBlockId !==
          null` (see its own comment). It deliberately DOES sit at the
          bottom edge and stay mounted for a moment after the keyboard
          closes now, rather than unmounting the instant some event says
          the keyboard is down: a whole night's investigation (2026-09-19)
          traced a flash-away-and-back bug on Android's recent-apps
          gesture to exactly the opposite design - gating this mount on
          `keyboardHeight`, a value written by event listeners that can
          themselves fire spuriously, meant one bad event was enough to
          unmount and remount the entire bar. Keying the mount off
          `focusedBlockId` instead - which only ever changes on a
          deliberate tap in or out of a block - and leaving its POSITION
          as the only continuously-animated thing (bottom: keyboardSV.value,
          driven solely by the frame handler, confirmed immune to that
          same gesture) means a bad frame is at most a pixel of jitter,
          never something for React to mount or unmount over.
          The window does NOT resize under the keyboard here (measured
          on-device: window stays at the full screen height whether the
          keyboard is up or down, since edge-to-edge delivers the keyboard
          as an inset rather than honouring
          android.softwareKeyboardLayoutMode), so the bar has to be placed
          at `bottom: keyboardHeight` by hand - nothing lifts it for us. */}
      {isToolbarVisible && (
        <Animated.View
          style={[styles.pinnedToolbar, pinnedToolbarStyle]}
          pointerEvents="box-none"
          // In a browser, pressing the mouse on anything takes the focus
          // off the field - so reaching for a toolbar button blurred the
          // block, the block stopped being the focused one, and the
          // toolbar vanished under the pointer before the click landed.
          // Refusing the mouse-down's default keeps the caret where it
          // is; the click itself still arrives. A phone has no mouse and
          // the prop is not sent there.
          {...(Platform.OS === 'web'
            ? ({ onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() } as object)
            : {})}
        >
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
        </Animated.View>
      )}

      <DocumentQuickLook
        file={quickLook}
        onClose={() => setQuickLook(null)}
        onOpenElsewhere={() => {
          const file = quickLook?.file;
          setQuickLook(null);
          if (file) openFileExternally(file);
        }}
      />

      <SketchEditor
        visible={sketchEditorBlockId !== null}
        initialElements={
          (sketchEditorBlockId && blocks.find((b) => b.id === sketchEditorBlockId)?.sketchElements) || []
        }
        // Opened on a PHOTOGRAPH, the same editor draws on it: the canvas
        // takes the picture's shape, so what is drawn here lands in the
        // same place in the note and in an export. Opened on a sketch
        // block there is no picture, and it is the blank canvas it was.
        background={sketchBackground}
        onSave={saveSketchElements}
        onClose={closeSketchEditor}
      />

      <ReminderSheet
        visible={reminderBlockId !== null}
        initialDate={reminderBlockId ? blocks.find((b) => b.id === reminderBlockId)?.reminderDate : undefined}
        initialTime={reminderBlockId ? blocks.find((b) => b.id === reminderBlockId)?.reminderTime : undefined}
        initialKind={reminderBlockId ? blocks.find((b) => b.id === reminderBlockId)?.reminderKind : undefined}
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
          {/* A transparent Modal opens its own Android window, outside the
              screen's normal keyboard-resize handling - same fix as
              RenamePrompt's own copy of this dialog shape. */}
          <KeyboardAvoidingView
            style={styles.linkPromptBackdrop}
            behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
          >
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
                placeholderTextColor={GLASS_TEXT_FAINT}
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
          </KeyboardAvoidingView>
        </Modal>
      )}
      {downloadToast && (
        <DownloadToast
          fileName={downloadToast.fileName}
          onShowInFolder={() => showDownloadedFileInFolder(downloadToast.uri, downloadToast.mimeType)}
          onIgnore={dismissDownloadToast}
        />
      )}
      {!downloadToast && canvasReorderToast && (
        <UndoToast
          message="Порядок сторінки змінено за стрілками"
          onUndo={() => {
            undo();
            setCanvasReorderToast(false);
          }}
        />
      )}
      <AddExistingItemModal
        visible={existingItemPickerBlockId !== null}
        includeCustomDatabases
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
                  // A dbRow/dbView block reuses the referenced row's/
                  // view's own id (blockFromCustomRow/blockFromCustomView)
                  // - same collision risk.
                  (b.type ?? 'paragraph') === 'dbRow' ||
                  (b.type ?? 'paragraph') === 'dbView' ||
                  // A sticker block reuses its own record's id (any
                  // content type - paragraph/image/sketch), same
                  // collision risk as file/image above.
                  b.isSticker
              )
              .map((b) => b.id)
          )
        }
      />

      <StockPhotoPicker
        visible={searchingCover}
        onClose={() => setSearchingCover(false)}
        onPicked={pickCoverImageFromStock}
      />
      {flattenNode}
    </View>
  );
}

export default forwardRef(DocumentEditorScreen);

