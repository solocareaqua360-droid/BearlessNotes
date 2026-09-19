import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme, useStyles } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { SHEET_BACKDROP, SHEET_WINDOW } from '../constants/glass';
import {
  ActivityIndicator,
  Keyboard,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from '../firestore';
import { addDoc, ownedQuery, setDoc } from '../utils/owned';
import { db } from '../firebase';
import { Block, Project } from '../types';
import { hapticToggle } from '../utils/haptics';
import { RootStackParamList } from '../navigation';
import ProjectTabsRow, { UNASSIGNED_ID } from '../components/ProjectTabsRow';
import ReminderSheet from '../components/ReminderSheet';
import SortMenuRows from '../components/SortMenuRows';
import { useMultiSelect } from '../hooks/useMultiSelect';
import { useCardCarry } from '../hooks/useCardCarry';
import CardCarryOverlay from '../components/CardCarryOverlay';
import UndoToast from '../components/UndoToast';
import { useSortPref } from '../hooks/useSortPref';
import { cancelReminder, scheduleReminder, type ReminderKind } from '../utils/reminders';
import { formatShortDate, parseDateKey } from '../utils/dateLocale';
import { createTaskInToday } from '../utils/copyToNote';
import { sortItems } from '../utils/sortItems';
import ContentColumn from '../components/ContentColumn';
import { BlurView } from 'expo-blur';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenBackdrop from '../components/ScreenBackdrop';
import Menu from '../components/surfaces/Menu';
import { CHROME_TOP } from '../constants/rail';
import { useDockClearance } from '../navigation/dockGeometry';
import { useDockActions, useDockBeads, useDockLeave, useDockShowContext } from '../navigation/navDock';
import SearchField from '../components/SearchField';
import RenamePrompt from '../components/RenamePrompt';
import { FONT_BOLD, FONT_MEDIUM, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { confirm, notify } from '../components/surfaces/Ask';

const ACCENT = '#4E9A6B';
// The foot the list keeps clear for the dock - the same reckoning
// DatabaseChrome makes.
const DANGER = '#EF4444';
const PROJECT_COLORS = ['#3B82F6', '#16A34A', '#8B5CF6', '#F97316', '#EC4899', '#14B8A6', '#EAB308'];
const tasksCollection = collection(db, 'tasks');
const projectsCollection = collection(db, 'projects');

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// A mismatch with today's date means "not today" without needing an active
// daily reset anywhere - the star just stops rendering filled once the
// stored date is no longer today's, whenever that's next checked.
function todayDateString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

type KanbanStatus = 'inbox' | 'inProgress' | 'paused' | 'done';

type Task = {
  id: string;
  text: string;
  checked: boolean;
  documentId: string;
  projectId?: string;
  todayMarkedDate?: string;
  kanbanStatus?: KanbanStatus;
  reminderDate?: string;
  reminderTime?: string;
  reminderKind?: ReminderKind;
  reminderNotificationId?: string;
  updatedAt: number;
  createdAt?: number;
};

// A task counts as "today" either because it was quick-starred, or because
// its own reminder date is today - the two are meant to read as the same
// thing (see setTaskReminder/toggleToday).
function isTaskToday(task: Task, today: string): boolean {
  return task.todayMarkedDate === today || task.reminderDate === today;
}

function formatReminderBadge(task: Task): string | null {
  if (!task.reminderDate) return null;
  const d = parseDateKey(task.reminderDate);
  const label = formatShortDate(d);
  return task.reminderTime ? `${label} ${task.reminderTime}` : label;
}

// Order defines both the columns left-to-right and what the arrow buttons
// step through - unset kanbanStatus reads as the first entry, so existing
// tasks land in "Вхідні" with no migration needed.
const KANBAN_COLUMNS: { key: KanbanStatus; title: string }[] = [
  { key: 'inbox', title: 'Вхідні' },
  { key: 'inProgress', title: 'В роботі' },
  { key: 'paused', title: 'На паузі' },
  { key: 'done', title: 'Готово' },
];
// Each column ~85% of the screen so the next one peeks at the edge - the
// cue that there's more to swipe to, without a separate paging indicator.
// A screen this wide only happens by unfolding a device like the Galaxy Z
// Fold this app is tested on - at 85% that would show barely more than
// one column, so above this breakpoint every column is instead sized to
// fit all four across the screen at once (matching kanbanBoard's own
// paddingHorizontal below), no peeking, no horizontal scroll needed.
const KANBAN_COLUMN_GAP = 12;
const KANBAN_BOARD_PADDING = 16;
const KANBAN_WIDE_SCREEN_BREAKPOINT = 600;

function kanbanColumnWidthFor(screenWidth: number): number {
  if (screenWidth >= KANBAN_WIDE_SCREEN_BREAKPOINT) {
    const totalGap = KANBAN_COLUMN_GAP * (KANBAN_COLUMNS.length - 1) + KANBAN_BOARD_PADDING * 2;
    return Math.floor((screenWidth - totalGap) / KANBAN_COLUMNS.length);
  }
  return Math.round(screenWidth * 0.85);
}

export default function TasksScreen() {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [kanbanMode, setKanbanMode] = useState(false);
  const { width: windowWidth } = useWindowDimensions();
  const kanbanColumnWidth = kanbanColumnWidthFor(windowWidth);
  // Kanban and bulk-select are mutually exclusive - each has its own
  // interaction model (arrows to move a card vs. checkboxes to pick rows),
  // so switching one on turns the other off instead of trying to make them
  // compose.
  const {
    isSelectMode,
    selectedIds,
    toggleSelectMode,
    toggle: toggleSelected,
    clear: clearSelection,
  } = useMultiSelect();
  const [menuOpen, setMenuOpen] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [creating, setCreating] = useState(false);
  const [creatingBusy, setCreatingBusy] = useState(false);
  const isFocused = useIsFocused();
  // Search on the left and making a task on the right, the way every
  // database has them. Neither existed on this screen: tasks are
  // one-liners scattered over every note, and finding one meant scrolling.
  useDockBeads(
    isFocused && !isSelectMode
      ? {
          icon: isSearching ? 'close-outline' : 'search-outline',
          active: isSearching,
          onPress: () => {
            if (isSearching) setSearchQuery('');
            setIsSearching((prev) => !prev);
          },
        }
      : null,
    isFocused && !isSelectMode
      ? { icon: 'checkbox-outline', badge: 'add-circle-outline', onPress: () => setCreating(true) }
      : null
  );
  useDockActions(
    isFocused
      ? isSelectMode
        ? [
            {
              key: 'cancel',
              icon: 'close-outline',
              label: 'Вийти',
              onPress: () => {
                showContext();
                toggleSelectMode();
              },
            },
            ...(selectedIds.size > 0
              ? [{ key: 'delete', icon: 'trash-outline' as const, label: 'Видалити', onPress: confirmBulkDeleteTasks }]
              : []),
          ]
        : [
            {
              key: 'shape',
              icon: kanbanMode ? 'albums-outline' : 'reorder-four-outline',
              label: kanbanMode ? 'Канбан' : 'Список',
              closesStack: true,
              onPress: () => setKanbanMode((v) => !v),
            },
            { key: 'sort', icon: 'filter-outline', label: 'Порядок', active: menuOpen, onPress: () => setMenuOpen((v) => !v) },
            {
              key: 'select',
              icon: 'checkmark-circle-outline',
              label: 'Вибір',
              onPress: () => {
                setKanbanMode(false);
                toggleSelectMode();
              },
            },
          ]
      : null
  );
  const insets = useSafeAreaInsets();
  const dockClear = useDockClearance();
  const showContext = useDockShowContext();
  // Everything this screen offered on the rail goes to the DOCK now, as
  // on every database: the way out as the leave bead, and what the list
  // can be done TO on the stack's second card. This screen is PUSHED
  // over the tabs, and tasks are made inside a document, so there is no
  // "+" - no bead on the right.
  useDockLeave('arrow-back-outline', () => navigation.goBack());
  const { sortPref, selectSortField } = useSortPref('tasksPrefs');
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [pickerTaskId, setPickerTaskId] = useState<string | null>(null);
  const [reminderTaskId, setReminderTaskId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState('');
  // This device's Android build doesn't resize the window under the
  // keyboard (edge-to-edge delivers it as an inset, not a resize - already
  // confirmed on-device for the editor's pinned toolbar), so the project-
  // picker sheet has to track the keyboard manually the same way.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // The user can't sit and watch midnight pass to test this by hand, so it
  // has to be right by construction rather than by observation: `today` is
  // real state, not a value computed inline at render time, so a screen
  // left open straight through midnight still gets a re-render (and the
  // star correctly stops showing) within a minute of the date changing,
  // not only the next time something else happens to re-render the screen.
  const [today, setToday] = useState(todayDateString());

  useEffect(() => {
    const interval = setInterval(() => {
      const now = todayDateString();
      setToday((prev) => (prev !== now ? now : prev));
    }, 60000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKeyboardHeight(e.endCoordinates.height);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardHeight(0);
    });
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  useEffect(() => {
    // Sorted by checked client-side (a stable sort, so it just regroups
    // without disturbing the newest-first order within each group) rather
    // than via a second orderBy in the query itself, which would need a
    // composite index set up in the Firebase console before it'd work.
    return onSnapshot(ownedQuery('tasks'), (snapshot) => {
      const loaded = [...snapshot.docs]
        .sort((a, b) => ((b.data().updatedAt as number) ?? 0) - ((a.data().updatedAt as number) ?? 0))
        .map((docSnapshot) => ({
        id: docSnapshot.id,
        text: docSnapshot.data().text,
        checked: docSnapshot.data().checked,
        documentId: docSnapshot.data().documentId,
        projectId: docSnapshot.data().projectId,
        todayMarkedDate: docSnapshot.data().todayMarkedDate,
        kanbanStatus: docSnapshot.data().kanbanStatus,
        reminderDate: docSnapshot.data().reminderDate,
        reminderTime: docSnapshot.data().reminderTime,
        reminderKind: docSnapshot.data().reminderKind,
        reminderNotificationId: docSnapshot.data().reminderNotificationId,
        updatedAt: docSnapshot.data().updatedAt ?? 0,
        createdAt: docSnapshot.data().createdAt,
      }));
      loaded.sort((a, b) => Number(a.checked) - Number(b.checked));
      setTasks(loaded);
      setIsLoading(false);
    }, (e) => {
      // A refused read with no handler used to take the screen down; with
      // one, it says what happened. See firestore_silent_empty.
      setIsLoading(false);
      notify('Справи не завантажилися', e.message);
    });
  }, []);

  useEffect(() => {
    return onSnapshot(ownedQuery('projects'), (snapshot) => {
      setProjects(
        snapshot.docs
          .map((docSnapshot) => ({
            id: docSnapshot.id,
            name: docSnapshot.data().name,
            color: docSnapshot.data().color,
          }))
          .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
      );
    }, (e) => notify('Проєкти не завантажилися', e.message));
  }, []);

  const projectsById = useMemo(() => {
    const map: Record<string, Project> = {};
    projects.forEach((p) => {
      map[p.id] = p;
    });
    return map;
  }, [projects]);

  // A task whose projectId no longer resolves to a real project (the
  // project was deleted) falls back to the "Без проекту" bucket here too,
  // rather than needing every affected task rewritten the moment a project
  // is deleted.
  const filteredTasks = useMemo(() => {
    const byProject =
      projectFilter === null
        ? tasks
        : projectFilter === UNASSIGNED_ID
          ? tasks.filter((t) => !t.projectId)
          : tasks.filter((t) => t.projectId === projectFilter);
    const needle = searchQuery.trim().toLowerCase();
    const found = needle ? byProject.filter((t) => t.text.toLowerCase().includes(needle)) : byProject;
    // Sorted once here rather than per-section below - every downstream
    // .filter() (today/unfinished/completed/kanban column) preserves
    // relative order, so this one sort is what all of them end up showing.
    return sortItems(
      found,
      sortPref,
      (t) => t.text || 'Без назви',
      (t) => t.createdAt,
      (t) => t.updatedAt
    );
  }, [tasks, projectFilter, sortPref, searchQuery]);

  // The task doc is a mirror (see DocumentEditorScreen's syncTasksForDocument) -
  // the block inside the source document's own `blocks` array field is the
  // real record, so every change here has to update both, not just this mirror.
  // A task made HERE is a checkbox block in today's daily note - the note
  // the calendar shows for today (`day_<key>`, created with the same
  // `calendarDate` field the calendar's own editor writes, or the day
  // would not count as filled). No new kind of record: for the rest of the
  // app it is a task in a note like every other, so the eight writers
  // below, which all reach for the block through its document, need no
  // second path. The mirror is written here too, the same shape
  // DocumentEditorScreen's syncTasksForDocument writes, so the list shows
  // the task at once rather than after the note is next opened.
  async function createTask(value: string) {
    const text = value.trim();
    if (!text) {
      setCreating(false);
      return;
    }
    setCreatingBusy(true);
    try {
      await createTaskInToday(text);
      setCreating(false);
    } catch (e) {
      notify('Не збереглося', (e as Error).message);
    } finally {
      setCreatingBusy(false);
    }
  }

  async function toggleTask(task: Task) {
    const newChecked = !task.checked;
    hapticToggle(newChecked);
    updateDoc(doc(db, 'tasks', task.id), { checked: newChecked });
    const documentRef = doc(db, 'documents', task.documentId);
    const snapshot = await getDoc(documentRef);
    const data = snapshot.data();
    if (!data) return;
    const blocks: Block[] = data.blocks ?? [];
    const updatedBlocks = blocks.map((b) => (b.id === task.id ? { ...b, checked: newChecked } : b));
    updateDoc(documentRef, { blocks: updatedBlocks });
  }

  // The star and "reminder date is today" are meant to read as the same
  // thing - isTaskToday checks both fields, so turning the star off has to
  // clear both too (per the user: removing the star removes the whole
  // reminder, not just today-marking), including cancelling any scheduled
  // notification.
  async function toggleToday(task: Task) {
    const wasToday = isTaskToday(task, today);
    const newValue = wasToday ? null : today;
    if (wasToday) await cancelReminder(task.reminderNotificationId);
    updateDoc(doc(db, 'tasks', task.id), {
      todayMarkedDate: newValue ?? deleteField(),
      ...(wasToday
        ? {
            reminderDate: deleteField(),
            reminderTime: deleteField(),
            reminderKind: deleteField(),
            reminderNotificationId: deleteField(),
          }
        : {}),
    });
    const documentRef = doc(db, 'documents', task.documentId);
    const snapshot = await getDoc(documentRef);
    const data = snapshot.data();
    if (!data) return;
    const blocks: Block[] = data.blocks ?? [];
    const updatedBlocks = blocks.map((b) => {
      if (b.id !== task.id) return b;
      if (newValue) return { ...b, todayMarkedDate: newValue };
      const {
        todayMarkedDate: _d1,
        reminderDate: _d2,
        reminderTime: _d3,
        reminderKind: _d5,
        reminderNotificationId: _d4,
        ...rest
      } = b;
      return rest;
    });
    updateDoc(documentRef, { blocks: updatedBlocks });
  }

  function openReminderPicker(taskId: string) {
    setReminderTaskId(taskId);
  }

  // Setting a reminder date to today also stars the task (matches
  // isTaskToday/toggleToday's "these are the same thing" rule). Any
  // previous notification is cancelled before a new one is scheduled, so
  // editing an existing reminder never leaves a stale one behind.
  async function saveTaskReminder(reminderDate: string, reminderTime: string | null, reminderKind: ReminderKind) {
    const taskId = reminderTaskId;
    const task = tasks.find((t) => t.id === taskId);
    setReminderTaskId(null);
    if (!task) return;
    await cancelReminder(task.reminderNotificationId);
    const notificationId = reminderTime
      ? await scheduleReminder(task.text, reminderDate, reminderTime, reminderKind)
      : undefined;
    const becomesToday = reminderDate === today;
    updateDoc(doc(db, 'tasks', task.id), {
      reminderDate,
      reminderTime: reminderTime ?? deleteField(),
      reminderKind: reminderTime ? reminderKind : deleteField(),
      reminderNotificationId: notificationId ?? deleteField(),
      ...(becomesToday ? { todayMarkedDate: today } : {}),
    });
    const documentRef = doc(db, 'documents', task.documentId);
    const snapshot = await getDoc(documentRef);
    const data = snapshot.data();
    if (!data) return;
    const blocks: Block[] = data.blocks ?? [];
    const updatedBlocks = blocks.map((b) => {
      if (b.id !== task.id) return b;
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
      if (becomesToday) next.todayMarkedDate = today;
      return next;
    });
    updateDoc(documentRef, { blocks: updatedBlocks });
  }

  async function clearTaskReminder() {
    const taskId = reminderTaskId;
    const task = tasks.find((t) => t.id === taskId);
    setReminderTaskId(null);
    if (!task) return;
    await cancelReminder(task.reminderNotificationId);
    updateDoc(doc(db, 'tasks', task.id), {
      reminderDate: deleteField(),
      reminderTime: deleteField(),
      reminderKind: deleteField(),
      reminderNotificationId: deleteField(),
    });
    const documentRef = doc(db, 'documents', task.documentId);
    const snapshot = await getDoc(documentRef);
    const data = snapshot.data();
    if (!data) return;
    const blocks: Block[] = data.blocks ?? [];
    const updatedBlocks = blocks.map((b) => {
      if (b.id !== task.id) return b;
      const { reminderDate: _d1, reminderTime: _d2, reminderKind: _d5, reminderNotificationId: _d3, ...rest } = b;
      return rest;
    });
    updateDoc(documentRef, { blocks: updatedBlocks });
  }

  // What crossing INTO or OUT OF a column actually does - shared by the
  // card's two arrow buttons and, now, dragging it (useCardCarry). The
  // "Готово" boundary carries the checkbox with it either way: entering it
  // checks the task, leaving it unchecks - the checkbox and the column
  // stay in sync with each other for that one boundary, in both
  // directions.
  async function setTaskStatus(task: Task, newStatus: KanbanStatus) {
    if (newStatus === (task.kanbanStatus ?? 'inbox')) return;
    const wasDone = task.kanbanStatus === 'done';
    const willBeDone = newStatus === 'done';
    const checkedChange = willBeDone && !wasDone ? true : !willBeDone && wasDone ? false : undefined;
    updateDoc(doc(db, 'tasks', task.id), {
      kanbanStatus: newStatus,
      ...(checkedChange !== undefined ? { checked: checkedChange } : {}),
    });
    const documentRef = doc(db, 'documents', task.documentId);
    const snapshot = await getDoc(documentRef);
    const data = snapshot.data();
    if (!data) return;
    const blocks: Block[] = data.blocks ?? [];
    const updatedBlocks = blocks.map((b) => {
      if (b.id !== task.id) return b;
      return { ...b, kanbanStatus: newStatus, ...(checkedChange !== undefined ? { checked: checkedChange } : {}) };
    });
    updateDoc(documentRef, { blocks: updatedBlocks });
  }
  // Steps a task one column left/right - the card's two arrow buttons,
  // the way in before dragging (below) existed and still the way for
  // anyone who would rather tap than carry.
  function moveTaskColumn(task: Task, delta: number) {
    const currentIndex = KANBAN_COLUMNS.findIndex((c) => c.key === (task.kanbanStatus ?? 'inbox'));
    const newIndex = currentIndex + delta;
    if (newIndex < 0 || newIndex >= KANBAN_COLUMNS.length) return;
    setTaskStatus(task, KANBAN_COLUMNS[newIndex].key);
  }

  // Dragging a card between columns. The explorer's own carry (see
  // useCardCarry) was built around a SECOND finger doing the navigating -
  // right for walking a folder tree, but a kanban board is four columns
  // wide and the user was explicit that plain edge auto-scroll is fine
  // here, so that is what this uses instead: no second finger, the board
  // scrolls itself while the carried finger sits near either edge.
  const EDGE_ZONE = 56;
  const EDGE_STEP = 16;
  const boardScrollRef = useRef<ScrollView>(null);
  const boardScrollXRef = useRef(0);
  const fingerXRef = useRef(0);
  const autoScrollTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // What a card picked up carries back to, if let go somewhere that is
  // not a column - useCardCarry's own "drop on nothing" fallback is
  // built for a file manager's "the folder you're standing in"; a kanban
  // board has no such place, so this is set to the CARD'S OWN column the
  // instant it is picked up (onPickUp below), which is exactly what makes
  // that fallback read as "no real move" and cancel quietly instead of
  // moving it somewhere arbitrary.
  const dragOriginRef = useRef<KanbanStatus>('inbox');
  const [kanbanToast, setKanbanToast] = useState<{ taskId: string; from: KanbanStatus; to: KanbanStatus } | null>(
    null
  );
  useEffect(() => {
    if (!kanbanToast) return;
    const id = setTimeout(() => setKanbanToast(null), 4000);
    return () => clearTimeout(id);
  }, [kanbanToast]);
  const kanbanCarry = useCardCarry<Task>({
    currentPath: dragOriginRef.current,
    onPickUp: (items) => {
      dragOriginRef.current = items[0]?.kanbanStatus ?? 'inbox';
    },
    moveItem: async (task, destination) => {
      if (!destination) return;
      await setTaskStatus(task, destination as KanbanStatus);
    },
    onMoved: (items, destination, origin) => {
      if (!destination || !items[0]) return;
      setKanbanToast({ taskId: items[0].id, from: origin as KanbanStatus, to: destination as KanbanStatus });
    },
    // Edge auto-scroll runs off the carried finger's own position
    // (below), not a second one - nothing to do with this axis.
    scrollBy: () => {},
  });
  function startBoardAutoScroll() {
    if (autoScrollTimer.current) return;
    autoScrollTimer.current = setInterval(() => {
      const x = fingerXRef.current;
      const dir = x < EDGE_ZONE ? -1 : x > windowWidth - EDGE_ZONE ? 1 : 0;
      if (dir === 0) return;
      const next = Math.max(0, boardScrollXRef.current + dir * EDGE_STEP);
      boardScrollRef.current?.scrollTo({ x: next, animated: false });
    }, 16);
  }
  function stopBoardAutoScroll() {
    if (autoScrollTimer.current) {
      clearInterval(autoScrollTimer.current);
      autoScrollTimer.current = null;
    }
  }
  const kanbanBoardGesture = Gesture.Pan()
    .activateAfterLongPress(650)
    .runOnJS(true)
    .onStart((e) => {
      kanbanCarry.pickUpAt(e.absoluteX, e.absoluteY);
      startBoardAutoScroll();
    })
    .onUpdate((e) => {
      fingerXRef.current = e.absoluteX;
      kanbanCarry.updateCarry(e.absoluteX, e.absoluteY);
    })
    .onEnd((_e, success) => {
      if (success) kanbanCarry.endCarry();
    })
    .onFinalize(() => {
      stopBoardAutoScroll();
      kanbanCarry.cancelCarry();
    });
  function kanbanToastLabel(status: KanbanStatus) {
    return KANBAN_COLUMNS.find((c) => c.key === status)?.title ?? status;
  }

  function openProjectPicker(taskId: string) {
    setNewProjectName('');
    setPickerTaskId(taskId);
  }

  async function assignProject(projectId: string | null) {
    const taskId = pickerTaskId;
    const task = tasks.find((t) => t.id === taskId);
    setPickerTaskId(null);
    if (!task) return;
    updateDoc(doc(db, 'tasks', task.id), { projectId: projectId ?? deleteField() });
    const documentRef = doc(db, 'documents', task.documentId);
    const snapshot = await getDoc(documentRef);
    const data = snapshot.data();
    if (!data) return;
    const blocks: Block[] = data.blocks ?? [];
    const updatedBlocks = blocks.map((b) => {
      if (b.id !== task.id) return b;
      if (projectId) return { ...b, projectId };
      const { projectId: _drop, ...rest } = b;
      return rest;
    });
    updateDoc(documentRef, { blocks: updatedBlocks });
  }

  async function addProject() {
    const name = newProjectName.trim();
    if (!name) return;
    const color = PROJECT_COLORS[projects.length % PROJECT_COLORS.length];
    await addDoc(projectsCollection, { name, color });
    setNewProjectName('');
  }

  function startEditProject(project: Project) {
    setEditingProjectId(project.id);
    setEditingProjectName(project.name);
  }

  async function saveEditProject() {
    const name = editingProjectName.trim();
    if (editingProjectId && name) {
      await updateDoc(doc(db, 'projects', editingProjectId), { name });
    }
    setEditingProjectId(null);
  }

  function confirmDeleteProject(project: Project) {
    confirm({
      title: 'Видалити проект?',
      message: `Справи з проектом "${project.name}" стануть без проекту.`,
      confirmLabel: 'Видалити',
    }).then((yes) => {
      if (!yes) return;
      deleteDoc(doc(db, 'projects', project.id));
    });
  }

  function toggleGroupExpanded(key: string) {
    setExpandedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  // A task isn't a separate record referenced from multiple documents like
  // other object types will be - it IS the checkbox block, in exactly the
  // one document it was typed into. So deleting it here has to remove that
  // block from its source document too, not just this mirror.
  async function deleteTask(task: Task) {
    deleteDoc(doc(db, 'tasks', task.id));
    const documentRef = doc(db, 'documents', task.documentId);
    const snapshot = await getDoc(documentRef);
    const data = snapshot.data();
    if (!data) return;
    const blocks: Block[] = data.blocks ?? [];
    const remaining = blocks.filter((b) => b.id !== task.id);
    updateDoc(documentRef, {
      blocks: remaining.length > 0 ? remaining : [{ id: generateId(), text: '' }],
    });
  }

  // The only delete path now - a per-card button was removed in favor of
  // select mode, so this covers both a single selected task and many.
  function confirmBulkDeleteTasks() {
    const count = selectedIds.size;
    const isSingle = count === 1;
    confirm({
      title: isSingle ? 'Видалити справу?' : `Видалити справи (${count})?`,
      message: isSingle
        ? 'Чекбокс також зникне з документа, де його написано.'
        : 'Чекбокси також зникнуть з документів, де їх написано.',
      confirmLabel: 'Видалити',
    }).then((yes) => {
      if (!yes) return;
      tasks.filter((t) => selectedIds.has(t.id)).forEach((t) => deleteTask(t));
      clearSelection();
    });
  }

  function renderTaskRow(item: Task) {
    const project = item.projectId ? projectsById[item.projectId] : undefined;
    const isToday = isTaskToday(item, today);
    const isSelected = selectedIds.has(item.id);
    const reminderLabel = formatReminderBadge(item);
    return (
      <View key={item.id} style={styles.row}>
        <Pressable hitSlop={8} onPress={() => toggleTask(item)}>
          <Ionicons
            name={item.checked ? 'checkbox' : 'square-outline'}
            size={22}
            color={item.checked ? ACCENT : 'rgba(255,255,255,0.45)'}
          />
        </Pressable>
        <Pressable
          style={styles.rowTextTap}
          onPress={() =>
            isSelectMode
              ? toggleSelected(item.id)
              : navigation.navigate('Editor', { documentId: item.documentId })
          }
        >
          <Text style={[styles.rowText, item.checked && styles.rowTextChecked]} numberOfLines={2}>
            {item.text}
          </Text>
          <View style={styles.chipsRow}>
            <Pressable onPress={() => openProjectPicker(item.id)}>
              <View
                style={[
                  styles.chip,
                  project ? { backgroundColor: `${project.color}1A` } : styles.chipEmpty,
                ]}
              >
                <Text style={[styles.chipText, { color: project ? project.color : 'rgba(255,255,255,0.45)' }]}>
                  {project ? project.name : 'Вхідні'}
                </Text>
              </View>
            </Pressable>
            {reminderLabel && (
              <Pressable onPress={() => openReminderPicker(item.id)}>
                <View style={styles.reminderChip}>
                  {/* The chip's own icon says which of the two this is -
                      a plain notification should never look like it is
                      about to ring. */}
                  <Ionicons
                    name={item.reminderKind === 'notify' ? 'notifications-outline' : 'alarm-outline'}
                    size={11}
                    color={ACCENT}
                  />
                  <Text style={styles.reminderChipText}>{reminderLabel}</Text>
                </View>
              </Pressable>
            )}
          </View>
        </Pressable>
        <Pressable
          hitSlop={8}
          onPress={() => toggleToday(item)}
          onLongPress={() => openReminderPicker(item.id)}
        >
          <Ionicons name={isToday ? 'star' : 'star-outline'} size={20} color={isToday ? '#F59E0B' : 'rgba(255,255,255,0.45)'} />
        </Pressable>
        {isSelectMode && (
          <Pressable hitSlop={8} onPress={() => toggleSelected(item.id)} style={styles.rowDelete}>
            <Ionicons
              name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
              size={20}
              color={isSelected ? ACCENT : 'rgba(255,255,255,0.45)'}
            />
          </Pressable>
        )}
      </View>
    );
  }

  // Same section renderer for "Сьогодні" (always pinned at the top when it
  // has anything) and for the rest of the list below it - each task
  // renders in exactly one of the two, filtered by todayMarkedDate at the
  // call site so a starred task doesn't also show up in the list below.
  function renderSection(section: {
    key: string;
    title: string | null;
    color: string | null;
    icon?: 'star';
    unfinished: Task[];
    completed: Task[];
  }) {
    return (
      <View key={section.key} style={styles.group}>
        {section.title && (
          <View style={styles.groupHeader}>
            {section.icon === 'star' ? (
              <Ionicons name="star" size={14} color={section.color ?? 'rgba(255,255,255,0.45)'} />
            ) : (
              <View style={[styles.groupDot, { backgroundColor: section.color ?? 'rgba(255,255,255,0.45)' }]} />
            )}
            <Text style={[styles.groupTitle, { color: section.color ?? 'rgba(255,255,255,0.45)' }]}>{section.title}</Text>
          </View>
        )}
        {section.unfinished.map((task) => renderTaskRow(task))}
        {section.completed.length > 0 && (
          <>
            <Pressable style={styles.collapseToggle} onPress={() => toggleGroupExpanded(section.key)}>
              <Ionicons
                name={expandedGroups.has(section.key) ? 'chevron-down' : 'chevron-forward'}
                size={16}
                color="rgba(255,255,255,0.45)"
              />
              <Text style={styles.collapseLabel}>Завершені ({section.completed.length})</Text>
            </Pressable>
            {expandedGroups.has(section.key) && section.completed.map((task) => renderTaskRow(task))}
          </>
        )}
      </View>
    );
  }

  const todayTasks = filteredTasks.filter((t) => isTaskToday(t, today));

  // A card is deliberately smaller than renderTaskRow: no star (every card
  // here is starred by definition, showing it again is just noise) and no
  // delete button - deleting only happens via the flat list's select mode
  // now, so removing a task from Kanban means going back to that view
  // first (the header back button does exactly that while in Kanban).
  function renderKanbanCard(task: Task, columnIndex: number) {
    const project = task.projectId ? projectsById[task.projectId] : undefined;
    const reminderLabel = formatReminderBadge(task);
    const isCarrying = !!kanbanCarry.ghost?.items.some((one) => one.id === task.id);
    return (
      <View
        key={task.id}
        ref={kanbanCarry.registerCard(task.id, () => [task], () => {})}
        collapsable={false}
        style={[styles.kanbanCard, isCarrying && styles.kanbanCardDimmed]}
      >
        <View style={styles.kanbanCardTop}>
          <Pressable hitSlop={8} onPress={() => toggleTask(task)}>
            <Ionicons
              name={task.checked ? 'checkbox' : 'square-outline'}
              size={20}
              color={task.checked ? ACCENT : 'rgba(255,255,255,0.45)'}
            />
          </Pressable>
          <Pressable
            style={styles.kanbanCardTextTap}
            onPress={() => navigation.navigate('Editor', { documentId: task.documentId })}
          >
            <Text style={[styles.kanbanCardText, task.checked && styles.rowTextChecked]} numberOfLines={3}>
              {task.text}
            </Text>
          </Pressable>
        </View>
        <View style={styles.kanbanCardBottom}>
          <View style={styles.chipsRow}>
            <Pressable onPress={() => openProjectPicker(task.id)}>
              <View style={[styles.chip, project ? { backgroundColor: `${project.color}1A` } : styles.chipEmpty]}>
                <Text style={[styles.chipText, { color: project ? project.color : 'rgba(255,255,255,0.45)' }]}>
                  {project ? project.name : 'Вхідні'}
                </Text>
              </View>
            </Pressable>
            {reminderLabel && (
              <Pressable onPress={() => openReminderPicker(task.id)}>
                <View style={styles.reminderChip}>
                  <Ionicons
                    name={task.reminderKind === 'notify' ? 'notifications-outline' : 'alarm-outline'}
                    size={11}
                    color={ACCENT}
                  />
                  <Text style={styles.reminderChipText}>{reminderLabel}</Text>
                </View>
              </Pressable>
            )}
          </View>
          <View style={styles.kanbanArrows}>
            <Pressable
              style={styles.kanbanArrowButton}
              disabled={columnIndex === 0}
              onPress={() => moveTaskColumn(task, -1)}
            >
              <Ionicons name="chevron-back" size={16} color={columnIndex === 0 ? 'rgba(255,255,255,0.25)' : theme.ink.muted} />
            </Pressable>
            <Pressable
              style={styles.kanbanArrowButton}
              disabled={columnIndex === KANBAN_COLUMNS.length - 1}
              onPress={() => moveTaskColumn(task, 1)}
            >
              <Ionicons
                name="chevron-forward"
                size={16}
                color={columnIndex === KANBAN_COLUMNS.length - 1 ? 'rgba(255,255,255,0.25)' : theme.ink.muted}
              />
            </Pressable>
          </View>
        </View>
      </View>
    );
  }

  // Horizontal-scrolling board. On a regular phone width each column is
  // ~85% of the screen so the next one peeks at the edge; on a screen wide
  // enough to be a folded phone's inner display, kanbanColumnWidth is
  // instead sized so all four columns fit on screen at once (see
  // kanbanColumnWidthFor above) - a plain ScrollView with snapping covers
  // both without needing separate paging UI.
  function renderKanbanBoard() {
    return (
      <GestureDetector gesture={kanbanBoardGesture}>
      <ScrollView
        ref={boardScrollRef}
        horizontal
        style={styles.kanbanBoardScroll}
        pagingEnabled={false}
        snapToInterval={kanbanColumnWidth + KANBAN_COLUMN_GAP}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={[styles.kanbanBoard, { paddingBottom: dockClear + insets.bottom }]}
        onScroll={(e) => {
          boardScrollXRef.current = e.nativeEvent.contentOffset.x;
        }}
        scrollEventThrottle={16}
      >
        {KANBAN_COLUMNS.map((column, columnIndex) => {
          const columnTasks = todayTasks.filter((t) => (t.kanbanStatus ?? 'inbox') === column.key);
          return (
            <View
              key={column.key}
              ref={kanbanCarry.registerFolder(column.key)}
              collapsable={false}
              style={{ width: kanbanColumnWidth }}
            >
              <View style={styles.kanbanColumnHead}>
                <Text style={styles.kanbanColumnTitle}>{column.title}</Text>
                <Text style={styles.kanbanColumnCount}>{columnTasks.length}</Text>
              </View>
              <ScrollView style={styles.kanbanColumnBody} contentContainerStyle={styles.kanbanColumnBodyContent}>
                {columnTasks.map((task) => renderKanbanCard(task, columnIndex))}
              </ScrollView>
            </View>
          );
        })}
      </ScrollView>
      </GestureDetector>
    );
  }

  if (isLoading) {
    return (
      <View style={[styles.container, styles.emptyState]}>
        <ActivityIndicator color={ACCENT} />
      </View>
    );
  }

  if (tasks.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="checkbox-outline" size={32} color={ACCENT} />
          </View>
          <Text style={styles.emptyLabel}>Немає справ</Text>
          <Text style={styles.emptyHint}>
            Впишіть текст у чекбокс у будь-якому документі - справа з'явиться тут сама
          </Text>
        </View>
        {/* The first task of all is made from HERE - the "+" bead is on
            the dock whether the list is empty or not. */}
        <RenamePrompt
          visible={creating}
          title="Нова справа"
          initialValue=""
          placeholder="Що зробити?"
          busy={creatingBusy}
          onCancel={() => setCreating(false)}
          onSave={createTask}
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenBackdrop id="tasksBg" />

      <ContentColumn>
        {/* The band the status bar and the rail's top capsule stand in.
            It was the header row's own top padding until the header went. */}
        <View style={{ height: insets.top + CHROME_TOP + 8 }} />
        {/* No header row any more. Its title said the name of the screen
            you had just tapped to reach, and its three buttons were a
            light capsule of this screen's own invention - the one screen
            in the app that was still white. They are on the rail now,
            each in the place it has everywhere else. */}
        {/* Ordering hangs off the button that opens it, above the dock. */}
        {menuOpen && (
          <>
            <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)} />
            <View style={[styles.menuPanel, { bottom: dockClear + insets.bottom }]}>
              <SortMenuRows sortPref={sortPref} onSelectField={selectSortField} accentColor={ACCENT} />
            </View>
          </>
        )}

        {isSearching && (
          <SearchField
            autoFocus
            value={searchQuery}
            onChangeText={setSearchQuery}
            placeholder="Пошук справ"
            onClose={() => {
              setSearchQuery('');
              setIsSearching(false);
            }}
            style={styles.searchRow}
          />
        )}

        {!kanbanMode && projects.length > 0 && (
          <ProjectTabsRow
            items={projects}
            selected={projectFilter}
            onSelect={setProjectFilter}
            // Not assigned to a project = in the inbox; the user's own rule.
            unassignedLabel="Вхідні"
          />
        )}

        {kanbanMode ? (
          <>
            {renderKanbanBoard()}
            {kanbanToast && (
              <UndoToast
                message={`Перенесено в «${kanbanToastLabel(kanbanToast.to)}»`}
                onUndo={() => {
                  const task = tasks.find((t) => t.id === kanbanToast.taskId);
                  if (task) setTaskStatus(task, kanbanToast.from);
                  setKanbanToast(null);
                }}
              />
            )}
            {/* The floating task while one is being carried between
                columns - see useCardCarry. Always mounted, invisible
                until then. */}
            <CardCarryOverlay
              carry={kanbanCarry}
              label={(items) => items[0]?.text ?? 'Справа'}
              icon="checkbox-outline"
              onEnterFolder={() => {}}
            />
          </>
        ) : (
        <ScrollView contentContainerStyle={[styles.list, { paddingBottom: dockClear + insets.bottom }]}>
          {todayTasks.length > 0 &&
            renderSection({
              key: '__today__',
              title: 'СЬОГОДНІ',
              color: '#F59E0B',
              icon: 'star',
              unfinished: todayTasks.filter((t) => !t.checked),
              completed: todayTasks.filter((t) => t.checked),
            })}

          {todayTasks.length > 0 && <View style={styles.todayDivider} />}

          {renderSection({
            key: '__all__',
            title: null,
            color: null,
            unfinished: filteredTasks.filter((t) => !t.checked && !isTaskToday(t, today)),
            completed: filteredTasks.filter((t) => t.checked && !isTaskToday(t, today)),
          })}

          {filteredTasks.length === 0 && (
            <Text style={styles.emptyFilterLabel}>Немає справ із цим фільтром</Text>
          )}
        </ScrollView>
        )}

        <Modal visible={pickerTaskId !== null} transparent animationType="fade" onRequestClose={() => setPickerTaskId(null)}>
          <Pressable style={[styles.modalBackdrop, { paddingBottom: keyboardHeight }]} onPress={() => setPickerTaskId(null)}>
            <Pressable style={styles.modalSheet} onPress={() => {}}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Оберіть проект</Text>

              <Pressable style={styles.modalRow} onPress={() => assignProject(null)}>
                <View style={[styles.modalDot, { backgroundColor: 'rgba(255,255,255,0.45)' }]} />
                <Text style={styles.modalRowText}>Вхідні</Text>
              </Pressable>

              {projects.map((p) =>
                editingProjectId === p.id ? (
                  <View key={p.id} style={styles.modalRow}>
                    <View style={[styles.modalDot, { backgroundColor: p.color }]} />
                    <TextInput
                      style={styles.modalRenameInput}
                      value={editingProjectName}
                      onChangeText={setEditingProjectName}
                      autoFocus
                      onSubmitEditing={saveEditProject}
                      onBlur={saveEditProject}
                      returnKeyType="done"
                    />
                  </View>
                ) : (
                  <View key={p.id} style={styles.modalRow}>
                    <Pressable style={styles.modalRowTap} onPress={() => assignProject(p.id)}>
                      <View style={[styles.modalDot, { backgroundColor: p.color }]} />
                      <Text style={styles.modalRowText}>{p.name}</Text>
                    </Pressable>
                    <Pressable hitSlop={8} onPress={() => startEditProject(p)}>
                      <Ionicons name="pencil-outline" size={16} color="#9CA3AF" />
                    </Pressable>
                    <Pressable hitSlop={8} onPress={() => confirmDeleteProject(p)}>
                      <Ionicons name="close" size={16} color="#9CA3AF" />
                    </Pressable>
                  </View>
                )
              )}

              <View style={styles.modalDivider} />

              <View style={styles.modalAddRow}>
                <TextInput
                  style={styles.modalInput}
                  value={newProjectName}
                  onChangeText={setNewProjectName}
                  placeholder="Новий проект"
                  placeholderTextColor={theme.ink.faint}
                  onSubmitEditing={addProject}
                  returnKeyType="done"
                />
                <Pressable hitSlop={8} onPress={addProject}>
                  <Ionicons name="add-circle" size={26} color={ACCENT} />
                </Pressable>
              </View>
            </Pressable>
          </Pressable>
        </Modal>

        <RenamePrompt
        visible={creating}
        title="Нова справа"
        initialValue=""
        placeholder="Що зробити?"
        busy={creatingBusy}
        onCancel={() => setCreating(false)}
        onSave={createTask}
      />
      <ReminderSheet
          visible={reminderTaskId !== null}
          initialDate={reminderTaskId ? tasks.find((t) => t.id === reminderTaskId)?.reminderDate : undefined}
          initialTime={reminderTaskId ? tasks.find((t) => t.id === reminderTaskId)?.reminderTime : undefined}
          initialKind={reminderTaskId ? tasks.find((t) => t.id === reminderTaskId)?.reminderKind : undefined}
          onClose={() => setReminderTaskId(null)}
          onSave={saveTaskReminder}
          onClear={clearTaskReminder}
        />
      </ContentColumn>

    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
  container: {
    flex: 1,
  },
  searchRow: {
    marginHorizontal: 20,
    marginBottom: 8,
  },
  menuBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 5,
  },
  menuPanel: {
    position: 'absolute',
    // Above the dock, where the button that opens it lives - the
    // `bottom` comes from the call site.
    right: 16,
    width: 200,
    backgroundColor: t.surface,
    borderRadius: 14,
    padding: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
    zIndex: 6,
  },
  selectionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: t.surface,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.08)',
    paddingHorizontal: 20,
    paddingTop: 10,
    paddingBottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  selectionCount: {
    fontSize: 15,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: t.ink.primary,
  },
  selectionDeleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  selectionDeleteLabel: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: DANGER,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  emptyIcon: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyLabel: {
    marginTop: 16,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
  },
  emptyFilterLabel: {
    textAlign: 'center',
    marginTop: 24,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.45)',
  },
  emptyHint: {
    marginTop: 6,
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
  },
  list: {
    paddingVertical: 8,
    paddingLeft: 20,
    gap: 8,
    paddingRight: 20,
  },
  group: {
    gap: 8,
    marginBottom: 8,
  },
  todayDivider: {
    height: 1,
    backgroundColor: t.edge.hairline,
    marginVertical: 4,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    // The list itself keeps the side margins now, so a header lines up
    // with the left edge of the cards under it rather than indenting
    // twice.
    paddingHorizontal: 4,
    paddingTop: 12,
    paddingBottom: 4,
  },
  groupDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  groupTitle: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    letterSpacing: 0.5,
  },
  collapseToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4,
    paddingVertical: 10,
  },
  collapseLabel: {
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.45)',
  },
  // A task sits on a card of its own, the same one a folder row and a
  // file row sit on. On white the rows were separated by nothing but
  // space and that was enough; on the dark backdrop the user could not
  // tell where one ended - "без меж погано зчитується візуально".
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  rowTextTap: {
    flex: 1,
    gap: 5,
  },
  rowText: {
    fontSize: 16,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
  },
  rowTextChecked: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  chipsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chip: {
    alignSelf: 'flex-start',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: 10,
  },
  chipEmpty: {
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: 'rgba(255,255,255,0.25)',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '500',
    fontFamily: FONT_MEDIUM,
  },
  reminderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  reminderChipText: {
    fontSize: 11.5,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: ACCENT,
  },
  rowDelete: {
    padding: 4,
  },
  modalBackdrop: {
    backgroundColor: 'rgba(17,24,39,0.45)',
    ...SHEET_BACKDROP,
  },
  modalSheet: {
    backgroundColor: t.surface,
    ...SHEET_WINDOW,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: t.edge.hairline,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: t.ink.primary,
    marginBottom: 4,
  },
  modalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  modalRowTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  modalDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  modalRowText: {
    fontSize: 16,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
    flexGrow: 1,
  },
  modalDivider: {
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    marginVertical: 4,
  },
  modalAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingTop: 8,
  },
  modalInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
    paddingVertical: 6,
  },
  modalRenameInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: ACCENT,
  },
  kanbanBoardScroll: {
    flex: 1,
  },
  kanbanBoard: {
    paddingLeft: 16,
    paddingRight: 16,
    gap: KANBAN_COLUMN_GAP,
  },
  kanbanColumnHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 8,
    paddingBottom: 10,
  },
  kanbanColumnTitle: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: t.ink.muted,
  },
  kanbanColumnCount: {
    fontSize: 11,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: 'rgba(255,255,255,0.45)',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  kanbanColumnBody: {
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderRadius: 14,
  },
  kanbanColumnBodyContent: {
    padding: 8,
    gap: 8,
    minHeight: 200,
  },
  kanbanCard: {
    backgroundColor: t.surface,
    borderRadius: 12,
    padding: 10,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.06,
  },
  // A card whose task is in hand right now.
  kanbanCardDimmed: {
    opacity: 0.4,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  kanbanCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  kanbanCardTextTap: {
    flex: 1,
  },
  kanbanCardText: {
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
    lineHeight: 19,
  },
  kanbanCardBottom: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 28,
  },
  kanbanArrows: {
    flexDirection: 'row',
    gap: 2,
  },
  kanbanArrowButton: {
    width: 26,
    height: 26,
    borderRadius: 7,
    backgroundColor: 'rgba(255,255,255,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  });
