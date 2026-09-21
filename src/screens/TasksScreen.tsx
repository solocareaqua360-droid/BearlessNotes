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
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
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
import { Block, Group, Recurrence, Subtask, TaskList } from '../types';
import { nextRecurrenceDate, recurrenceLabel } from '../utils/recurrence';
import AddExistingItemModal from '../components/AddExistingItemModal';
import { hapticToggle } from '../utils/haptics';
import { RootStackParamList } from '../navigation';
import ProjectTabsRow, { UNASSIGNED_ID } from '../components/ProjectTabsRow';
import GroupPickerSheet from '../components/GroupPickerSheet';
import { groupAppliesTo } from '../utils/groups';
import ReminderSheet from '../components/ReminderSheet';
import SortMenuRows from '../components/SortMenuRows';
import { useMultiSelect } from '../hooks/useMultiSelect';
import { useCardCarry } from '../hooks/useCardCarry';
import CardCarryOverlay from '../components/CardCarryOverlay';
import UndoToast from '../components/UndoToast';
import { useSortPref } from '../hooks/useSortPref';
import { cancelReminder, scheduleReminder, type ReminderKind } from '../utils/reminders';
import { formatShortDate, parseDateKey, WEEKDAY_FULL } from '../utils/dateLocale';
import { createTaskInToday, createTaskOnDate } from '../utils/copyToNote';
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

// The foot the list keeps clear for the dock - the same reckoning
// DatabaseChrome makes.
const DANGER = '#EF4444';
const tasksCollection = collection(db, 'tasks');
const taskListsCollection = collection(db, 'taskLists');

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
  groupId?: string;
  listId?: string;
  todayMarkedDate?: string;
  kanbanStatus?: KanbanStatus;
  reminderDate?: string;
  reminderTime?: string;
  reminderKind?: ReminderKind;
  reminderNotificationId?: string;
  comment?: string;
  subtasks?: Subtask[];
  attachments?: Block[];
  recurrence?: Recurrence;
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
  const accent = theme.sections.tasks;
  const styles = useStyles(makeStyles);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Tasks'>>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [groups, setGroups] = useState<Group[]>([]);
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
  // Which tasks currently show their own expanded row - subtasks, the
  // comment field and attachments, none of which ever appear anywhere
  // else (see Block.comment's own comment on why).
  const [expandedTaskIds, setExpandedTaskIds] = useState<Set<string>>(new Set());
  function toggleTaskExpanded(id: string) {
    setExpandedTaskIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  // The new-subtask text field, one per task that has ever had one open -
  // kept here rather than local to the row so it survives the row's own
  // re-renders while typing.
  const [subtaskDrafts, setSubtaskDrafts] = useState<Record<string, string>>({});
  // The comment field's own draft, same reasoning - starts from the
  // task's saved comment the first time its row expands, then tracks
  // typing until it's saved on blur.
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  // Which task the file/photo picker is currently open for.
  const [attachTaskId, setAttachTaskId] = useState<string | null>(null);
  // Which task the recurrence picker is currently open for.
  const [recurrenceTaskId, setRecurrenceTaskId] = useState<string | null>(null);
  const [pickerTaskId, setPickerTaskId] = useState<string | null>(null);
  const [reminderTaskId, setReminderTaskId] = useState<string | null>(null);
  // Same three, for the list picker - see TaskList. Scoped to whichever
  // project the picked task already has (see openListPicker/assignTaskList).
  const [listPickerTaskId, setListPickerTaskId] = useState<string | null>(null);
  const [newTaskListName, setNewTaskListName] = useState('');
  const [editingTaskListId, setEditingTaskListId] = useState<string | null>(null);
  const [editingTaskListName, setEditingTaskListName] = useState('');
  // The list's own short description - a separate small prompt (see
  // RenamePrompt below) rather than an inline field, since it only ever
  // needs editing from its one spot (the list's own section header),
  // never repeated per row the way a task's comment is.
  const [describingListId, setDescribingListId] = useState<string | null>(null);
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
        groupId: docSnapshot.data().groupId,
        listId: docSnapshot.data().listId,
        todayMarkedDate: docSnapshot.data().todayMarkedDate,
        kanbanStatus: docSnapshot.data().kanbanStatus,
        reminderDate: docSnapshot.data().reminderDate,
        reminderTime: docSnapshot.data().reminderTime,
        reminderKind: docSnapshot.data().reminderKind,
        reminderNotificationId: docSnapshot.data().reminderNotificationId,
        comment: docSnapshot.data().comment,
        subtasks: docSnapshot.data().subtasks,
        attachments: docSnapshot.data().attachments,
        recurrence: docSnapshot.data().recurrence,
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

  // Arrived from a "Проект справ" board card (see navigation.ts's own
  // comment on this param) - "Всі" guarantees the task is visible
  // regardless of its own project, since the board doesn't know or care
  // which project tab was last selected here. One-shot: the ref stops
  // this from re-firing (and re-collapsing anything the user opens by
  // hand afterwards) on every unrelated re-render.
  const focusedTaskRef = useRef<string | null>(null);
  useEffect(() => {
    const focusTaskId = route.params?.focusTaskId;
    if (!focusTaskId || focusedTaskRef.current === focusTaskId) return;
    if (!tasks.some((t) => t.id === focusTaskId)) return;
    focusedTaskRef.current = focusTaskId;
    setProjectFilter(null);
    setKanbanMode(false);
    setExpandedTaskIds((prev) => new Set(prev).add(focusTaskId));
  }, [route.params, tasks]);

  useEffect(() => {
    return onSnapshot(ownedQuery('groups'), (snapshot) => {
      setGroups(
        snapshot.docs
          .map((d) => ({ id: d.id, ...(d.data() as Omit<Group, 'id'>) }))
          .filter((g) => groupAppliesTo(g, 'task'))
          .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
      );
    }, (e) => notify('Проєкти не завантажилися', e.message));
  }, []);

  const [taskLists, setTaskLists] = useState<TaskList[]>([]);
  useEffect(() => {
    return onSnapshot(ownedQuery('taskLists'), (snapshot) => {
      setTaskLists(
        snapshot.docs
          .map((docSnapshot) => ({
            id: docSnapshot.id,
            name: docSnapshot.data().name,
            color: docSnapshot.data().color,
            groupId: docSnapshot.data().groupId,
            description: docSnapshot.data().description,
          }))
          .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
      );
    }, (e) => notify('Списки не завантажилися', e.message));
  }, []);

  const taskListsById = useMemo(() => {
    const map: Record<string, TaskList> = {};
    taskLists.forEach((l) => {
      map[l.id] = l;
    });
    return map;
  }, [taskLists]);

  const projectsById = useMemo(() => {
    const map: Record<string, Group> = {};
    groups.forEach((g) => {
      map[g.id] = g;
    });
    return map;
  }, [groups]);

  // A task whose groupId no longer resolves to a real project (the
  // project was deleted, or un-kinded away from Tasks) falls back to the
  // "Без проекту" bucket here too, rather than needing every affected task
  // rewritten the moment that happens.
  const filteredTasks = useMemo(() => {
    const byProject =
      projectFilter === null
        ? tasks
        : projectFilter === UNASSIGNED_ID
          ? tasks.filter((t) => !t.groupId)
          : tasks.filter((t) => t.groupId === projectFilter);
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

  // The project chip only earns its keep where several projects are
  // mixed together - once the tabs above already say which ONE project
  // is on screen ("Всі"'s own selected pill, or "Без проєкту"'s), a chip
  // repeating that on every row is exactly the duplicate the user asked
  // to drop: "якщо я відкрию проект то вгорі є обрана карусель проектів
  // і так все зрозуміло". Shown only on "Всі" (projectFilter === null).
  const showProjectChip = projectFilter === null;
  // A real, single project selected (not "Всі" and not "Без проєкту") -
  // its own lists get to stand as section headers instead of a per-row
  // chip repeating a name already grouped under.
  const isProjectSpecific = projectFilter !== null && projectFilter !== UNASSIGNED_ID;

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
      // A real project tab open (not "Всі"/"Вхідні") - the new task
      // starts there instead of needing a second tap to catch up to
      // where it was made.
      await createTaskInToday(text, projectFilter && projectFilter !== UNASSIGNED_ID ? projectFilter : undefined);
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
    if (newChecked) spawnNextRecurrence(task);
    updateDoc(doc(db, 'tasks', task.id), { checked: newChecked });
    const documentRef = doc(db, 'documents', task.documentId);
    const snapshot = await getDoc(documentRef);
    const data = snapshot.data();
    if (!data) return;
    const blocks: Block[] = data.blocks ?? [];
    const updatedBlocks = blocks.map((b) => (b.id === task.id ? { ...b, checked: newChecked } : b));
    updateDoc(documentRef, { blocks: updatedBlocks });
  }

  // The shared shape every mutation above hand-rolls: patch the mirror,
  // then read-modify-write the one block inside the owning document that
  // actually carries the field. Comment/subtasks/attachments are new
  // enough not to have their own eight copies of this - one helper, used
  // by all three, rather than a ninth through eleventh near-duplicate.
  async function updateTaskBothSides(
    task: Task,
    mirrorPatch: Record<string, unknown>,
    blockPatch: (b: Block) => Block
  ) {
    updateDoc(doc(db, 'tasks', task.id), mirrorPatch);
    const documentRef = doc(db, 'documents', task.documentId);
    const snapshot = await getDoc(documentRef);
    const data = snapshot.data();
    if (!data) return;
    const blocks: Block[] = data.blocks ?? [];
    const updatedBlocks = blocks.map((b) => (b.id === task.id ? blockPatch(b) : b));
    updateDoc(documentRef, { blocks: updatedBlocks });
  }

  function saveTaskComment(task: Task, comment: string) {
    const trimmed = comment.trim();
    updateTaskBothSides(
      task,
      { comment: trimmed || deleteField() },
      (b) => {
        if (trimmed) return { ...b, comment: trimmed };
        const { comment: _c, ...rest } = b;
        return rest;
      }
    );
  }

  function addSubtask(task: Task, text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;
    const subtask: Subtask = { id: generateId(), text: trimmed, checked: false };
    const next = [...(task.subtasks ?? []), subtask];
    updateTaskBothSides(task, { subtasks: next }, (b) => ({ ...b, subtasks: next }));
  }

  function toggleSubtask(task: Task, subtaskId: string) {
    const next = (task.subtasks ?? []).map((s) => (s.id === subtaskId ? { ...s, checked: !s.checked } : s));
    updateTaskBothSides(task, { subtasks: next }, (b) => ({ ...b, subtasks: next }));
  }

  function deleteSubtask(task: Task, subtaskId: string) {
    const next = (task.subtasks ?? []).filter((s) => s.id !== subtaskId);
    updateTaskBothSides(task, { subtasks: next }, (b) => ({ ...b, subtasks: next }));
  }

  function addAttachment(task: Task, block: Block) {
    const next = [...(task.attachments ?? []), block];
    updateTaskBothSides(task, { attachments: next }, (b) => ({ ...b, attachments: next }));
  }

  function removeAttachment(task: Task, attachmentId: string) {
    const next = (task.attachments ?? []).filter((a) => a.id !== attachmentId);
    updateTaskBothSides(task, { attachments: next }, (b) => ({ ...b, attachments: next }));
  }

  // A recurring task needs a date to advance FROM (see
  // nextRecurrenceDate) - turning recurrence on for a task with no
  // reminder date yet gives it today's, the same way starring a task
  // already means "reminder date is today" elsewhere in this screen.
  function setTaskRecurrence(task: Task, recurrence: Recurrence | null) {
    setRecurrenceTaskId(null);
    const needsDate = recurrence && !task.reminderDate;
    updateTaskBothSides(
      task,
      {
        recurrence: recurrence ?? deleteField(),
        ...(needsDate ? { reminderDate: today, todayMarkedDate: today } : {}),
      },
      (b) => {
        const next = { ...b };
        if (recurrence) next.recurrence = recurrence;
        else delete next.recurrence;
        if (needsDate) {
          next.reminderDate = today;
          next.todayMarkedDate = today;
        }
        return next;
      }
    );
  }

  // Fires from toggleTask/setTaskStatus wherever a task actually becomes
  // checked - see Block.recurrence's own comment: one occurrence at a
  // time, never a batch of future dates. Carries the rule, project and
  // list forward; subtasks/comment/attachments belonged to the
  // occurrence that just finished, not to the series, so they start
  // empty on the new one.
  function spawnNextRecurrence(task: Task) {
    if (!task.recurrence || !task.reminderDate) return;
    const nextDate = nextRecurrenceDate(task.recurrence, task.reminderDate);
    createTaskOnDate(task.text, nextDate, {
      groupId: task.groupId,
      listId: task.listId,
      recurrence: task.recurrence,
      reminderTime: task.reminderTime,
      reminderKind: task.reminderKind,
    });
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
    if (checkedChange) spawnNextRecurrence(task);
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
    setPickerTaskId(taskId);
  }

  // GroupPickerSheet owns create/rename/delete of the project itself now
  // (kind: 'task') - this only ever has to write the CHOICE onto the task.
  async function assignGroup(groupId: string | null) {
    const taskId = pickerTaskId;
    const task = tasks.find((t) => t.id === taskId);
    setPickerTaskId(null);
    if (!task) return;
    // A list belongs to exactly one project (see TaskList) - changing
    // (or clearing) the project makes any list already on the task
    // meaningless, since it was scoped to the OLD project. Left alone
    // only when the "new" project is actually the same one already set.
    const dropsList = groupId !== (task.groupId ?? null) && !!task.listId;
    updateDoc(doc(db, 'tasks', task.id), {
      groupId: groupId ?? deleteField(),
      ...(dropsList ? { listId: deleteField() } : {}),
    });
    const documentRef = doc(db, 'documents', task.documentId);
    const snapshot = await getDoc(documentRef);
    const data = snapshot.data();
    if (!data) return;
    const blocks: Block[] = data.blocks ?? [];
    const updatedBlocks = blocks.map((b) => {
      if (b.id !== task.id) return b;
      const next = { ...b };
      if (groupId) next.groupId = groupId;
      else delete next.groupId;
      if (dropsList) delete next.listId;
      return next;
    });
    updateDoc(documentRef, { blocks: updatedBlocks });
  }

  // Lists live INSIDE a project (see TaskList) - the picker only ever
  // opens for a task that already has one, and only ever offers that
  // same project's own lists.
  function openListPicker(taskId: string) {
    setNewTaskListName('');
    setListPickerTaskId(taskId);
  }

  function assignTaskList(listId: string | null) {
    const taskId = listPickerTaskId;
    const task = tasks.find((t) => t.id === taskId);
    setListPickerTaskId(null);
    if (!task) return;
    updateTaskBothSides(task, { listId: listId ?? deleteField() }, (b) => {
      if (listId) return { ...b, listId };
      const { listId: _drop, ...rest } = b;
      return rest;
    });
  }

  async function addTaskList(groupId: string) {
    const name = newTaskListName.trim();
    if (!name) return;
    const color = theme.cards[taskLists.length % theme.cards.length];
    await addDoc(taskListsCollection, { name, color, groupId });
    setNewTaskListName('');
  }

  function startEditTaskList(list: TaskList) {
    setEditingTaskListId(list.id);
    setEditingTaskListName(list.name);
  }

  async function saveEditTaskList() {
    const name = editingTaskListName.trim();
    if (editingTaskListId && name) {
      await updateDoc(doc(db, 'taskLists', editingTaskListId), { name });
    }
    setEditingTaskListId(null);
  }

  function confirmDeleteTaskList(list: TaskList) {
    // Closed first - «Питання» is a layer inside this same window (see
    // Ask.tsx's own comment on why it isn't a Modal), but the list picker
    // IS a native Modal, a separate window Android draws on top of
    // everything else regardless of what's asked for behind it. Left
    // open, the two windows' content interleaves instead of one cleanly
    // covering the other.
    setListPickerTaskId(null);
    confirm({
      title: 'Видалити список?',
      message: `Справи зі списком "${list.name}" стануть без списку.`,
      confirmLabel: 'Видалити',
    }).then((yes) => {
      if (!yes) return;
      deleteDoc(doc(db, 'taskLists', list.id));
    });
  }

  async function saveListDescription(value: string) {
    const listId = describingListId;
    setDescribingListId(null);
    if (!listId) return;
    const trimmed = value.trim();
    await updateDoc(doc(db, 'taskLists', listId), { description: trimmed || deleteField() });
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

  function renderTaskRow(item: Task, opts: { showProjectChip: boolean; showListChip: boolean }) {
    const project = item.groupId ? projectsById[item.groupId] : undefined;
    const list = item.listId ? taskListsById[item.listId] : undefined;
    const isToday = isTaskToday(item, today);
    const isSelected = selectedIds.has(item.id);
    const reminderLabel = formatReminderBadge(item);
    const isExpanded = expandedTaskIds.has(item.id);
    const subtaskCount = item.subtasks?.length ?? 0;
    return (
      <View key={item.id} style={styles.row}>
        <View style={styles.rowMain}>
          <Pressable hitSlop={8} onPress={() => toggleTask(item)}>
            <Ionicons
              name={item.checked ? 'checkbox' : 'square-outline'}
              size={22}
              color={item.checked ? accent : 'rgba(255,255,255,0.45)'}
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
              {/* Only where several projects are mixed on screen at once -
                  see showProjectChip's own comment. */}
              {opts.showProjectChip && (
                <Pressable onPress={() => openProjectPicker(item.id)}>
                  <View
                    style={[
                      styles.chip,
                      project ? { backgroundColor: `${project.color}1A` } : styles.chipEmpty,
                    ]}
                  >
                    <Ionicons
                      name="cube-outline"
                      size={11}
                      color={project ? project.color : 'rgba(255,255,255,0.45)'}
                    />
                    <Text style={[styles.chipText, { color: project ? project.color : 'rgba(255,255,255,0.45)' }]}>
                      {project ? project.name : 'Вхідні'}
                    </Text>
                  </View>
                </Pressable>
              )}
              {/* A list lives INSIDE a project - nothing to pick until the
                  task has one, so the chip itself only exists then. Hidden
                  once a single project's own view already groups tasks
                  under the list's name as a section header (see
                  isProjectSpecific) - showing both would say the same
                  thing twice. */}
              {project && opts.showListChip && (
                <Pressable onPress={() => openListPicker(item.id)}>
                  <View style={[styles.chip, list ? { backgroundColor: `${list.color}1A` } : styles.chipEmpty]}>
                    <Ionicons name="list-outline" size={11} color={list ? list.color : 'rgba(255,255,255,0.45)'} />
                    <Text style={[styles.chipText, { color: list ? list.color : 'rgba(255,255,255,0.45)' }]}>
                      {list ? list.name : 'Без списку'}
                    </Text>
                  </View>
                </Pressable>
              )}
              {reminderLabel && (
                <Pressable onPress={() => openReminderPicker(item.id)}>
                  <View style={styles.reminderChip}>
                    {/* The chip's own icon says which of the two this is -
                        a plain notification should never look like it is
                        about to ring. */}
                    <Ionicons
                      name={item.reminderKind === 'notify' ? 'notifications-outline' : 'alarm-outline'}
                      size={11}
                      color={accent}
                    />
                    <Text style={styles.reminderChipText}>{reminderLabel}</Text>
                  </View>
                </Pressable>
              )}
              {subtaskCount > 0 && (
                <View style={styles.reminderChip}>
                  <Ionicons name="git-branch-outline" size={11} color="rgba(255,255,255,0.6)" />
                  <Text style={styles.reminderChipText}>{subtaskCount}</Text>
                </View>
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
          {/* Everything below the fold - subtasks, comment, attachments -
              never shows anywhere but here, so a chevron is the only way
              to it (see Block.comment's own comment on why). */}
          <Pressable hitSlop={8} onPress={() => toggleTaskExpanded(item.id)}>
            <Ionicons
              name={isExpanded ? 'chevron-up' : 'chevron-down'}
              size={18}
              color="rgba(255,255,255,0.45)"
            />
          </Pressable>
          {isSelectMode && (
            <Pressable hitSlop={8} onPress={() => toggleSelected(item.id)} style={styles.rowDelete}>
              <Ionicons
                name={isSelected ? 'checkmark-circle' : 'ellipse-outline'}
                size={20}
                color={isSelected ? accent : 'rgba(255,255,255,0.45)'}
              />
            </Pressable>
          )}
        </View>
        {isExpanded && renderTaskDetails(item)}
      </View>
    );
  }

  // The part of a task that never appears anywhere but its own expanded
  // row - see Block.comment/subtasks/attachments. Subtasks are a small,
  // disposable shape of their own (Subtask), never a nested Block: no
  // project, no reminder, no kanban column, nothing a real task carries.
  function renderTaskDetails(item: Task) {
    const subtasks = item.subtasks ?? [];
    const attachments = item.attachments ?? [];
    const project = item.groupId ? projectsById[item.groupId] : undefined;
    const list = item.listId ? taskListsById[item.listId] : undefined;
    const draft = subtaskDrafts[item.id] ?? '';
    const commentDraft = commentDrafts[item.id] ?? item.comment ?? '';
    const submitSubtask = () => {
      if (!draft.trim()) return;
      addSubtask(item, draft);
      setSubtaskDrafts((prev) => ({ ...prev, [item.id]: '' }));
    };
    return (
      <View style={styles.details}>
        {subtasks.map((s) => (
          <View key={s.id} style={styles.subtaskRow}>
            <Pressable hitSlop={8} onPress={() => toggleSubtask(item, s.id)}>
              <Ionicons
                name={s.checked ? 'checkbox' : 'square-outline'}
                size={18}
                color={s.checked ? accent : 'rgba(255,255,255,0.45)'}
              />
            </Pressable>
            <Text style={[styles.subtaskText, s.checked && styles.rowTextChecked]} numberOfLines={2}>
              {s.text}
            </Text>
            <Pressable hitSlop={8} onPress={() => deleteSubtask(item, s.id)}>
              <Ionicons name="close" size={16} color="rgba(255,255,255,0.35)" />
            </Pressable>
          </View>
        ))}
        <View style={styles.subtaskAddRow}>
          <TextInput
            value={draft}
            onChangeText={(v) => setSubtaskDrafts((prev) => ({ ...prev, [item.id]: v }))}
            placeholder="Нова підзадача"
            placeholderTextColor="rgba(255,255,255,0.35)"
            style={styles.subtaskInput}
            onSubmitEditing={submitSubtask}
            returnKeyType="done"
          />
          <Pressable hitSlop={8} onPress={submitSubtask}>
            <Ionicons name="add-circle-outline" size={22} color={accent} />
          </Pressable>
        </View>

        <TextInput
          value={commentDraft}
          onChangeText={(v) => setCommentDrafts((prev) => ({ ...prev, [item.id]: v }))}
          onBlur={() => saveTaskComment(item, commentDraft)}
          placeholder="Коментар"
          placeholderTextColor="rgba(255,255,255,0.35)"
          style={styles.commentInput}
          multiline
        />

        {attachments.length > 0 && (
          <View style={styles.attachmentsRow}>
            {attachments.map((a) => (
              <View key={a.id} style={styles.attachmentChip}>
                <Ionicons
                  name={(a.type ?? 'paragraph') === 'image' ? 'image-outline' : 'document-outline'}
                  size={14}
                  color="rgba(255,255,255,0.7)"
                />
                <Text style={styles.attachmentChipText} numberOfLines={1}>
                  {(a.type === 'image' ? a.imageTitle : a.fileTitle || a.fileName) || 'Без назви'}
                </Text>
                <Pressable hitSlop={8} onPress={() => removeAttachment(item, a.id)}>
                  <Ionicons name="close" size={13} color="rgba(255,255,255,0.4)" />
                </Pressable>
              </View>
            ))}
          </View>
        )}
        <Pressable style={styles.attachButton} onPress={() => setAttachTaskId(item.id)}>
          <Ionicons name="attach-outline" size={16} color={accent} />
          <Text style={[styles.attachButtonText, { color: accent }]}>Додати файл або фото</Text>
        </Pressable>

        <Pressable style={styles.attachButton} onPress={() => setRecurrenceTaskId(item.id)}>
          <Ionicons name="repeat-outline" size={16} color={item.recurrence ? accent : 'rgba(255,255,255,0.5)'} />
          <Text style={[styles.attachButtonText, { color: item.recurrence ? accent : 'rgba(255,255,255,0.5)' }]}>
            {item.recurrence ? recurrenceLabel(item.recurrence) : 'Повторення: немає'}
          </Text>
        </Pressable>

        {/* Always here now, whether or not either is set yet - the row's
            own chips (see opts.showProjectChip/showListChip) only show up
            when several projects are mixed on one screen, which left no
            reliable way to assign a project (let alone a list, which
            needs one first) once that stopped being true. */}
        <View style={styles.detailsCapsuleRow}>
          <Pressable onPress={() => openProjectPicker(item.id)}>
            <View style={[styles.chip, project ? { backgroundColor: `${project.color}1A` } : styles.chipEmpty]}>
              <Ionicons name="cube-outline" size={11} color={project ? project.color : 'rgba(255,255,255,0.45)'} />
              <Text style={[styles.chipText, { color: project ? project.color : 'rgba(255,255,255,0.45)' }]}>
                {project ? project.name : 'Вхідні'}
              </Text>
            </View>
          </Pressable>
          {/* A list lives INSIDE a project - tapping it before one is set
              opens the project picker instead, rather than a list picker
              with nothing in it to offer. */}
          <Pressable onPress={() => (item.groupId ? openListPicker(item.id) : openProjectPicker(item.id))}>
            <View style={[styles.chip, list ? { backgroundColor: `${list.color}1A` } : styles.chipEmpty]}>
              <Ionicons name="list-outline" size={11} color={list ? list.color : 'rgba(255,255,255,0.45)'} />
              <Text style={[styles.chipText, { color: list ? list.color : 'rgba(255,255,255,0.45)' }]}>
                {list ? list.name : 'Без списку'}
              </Text>
            </View>
          </Pressable>
          {/* Setting a reminder used to only be reachable from the
              calendar/diary sheet (or a long press on the star, which
              nothing hinted at) - same "always here" treatment as the
              project/list capsules above. */}
          <Pressable onPress={() => openReminderPicker(item.id)}>
            <View style={[styles.chip, item.reminderDate ? { backgroundColor: `${accent}1A` } : styles.chipEmpty]}>
              <Ionicons
                name={item.reminderKind === 'notify' ? 'notifications-outline' : 'alarm-outline'}
                size={11}
                color={item.reminderDate ? accent : 'rgba(255,255,255,0.45)'}
              />
              <Text style={[styles.chipText, { color: item.reminderDate ? accent : 'rgba(255,255,255,0.45)' }]}>
                {formatReminderBadge(item) ?? 'Без дати'}
              </Text>
            </View>
          </Pressable>
        </View>
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
    icon?: 'star' | 'list';
    unfinished: Task[];
    completed: Task[];
    showProjectChip: boolean;
    showListChip: boolean;
    // Only meaningful for a list's own section (icon === 'list') - the
    // description shown right under the name, and its own id so tapping
    // it can open the edit prompt.
    listId?: string;
    description?: string;
  }) {
    const rowOpts = { showProjectChip: section.showProjectChip, showListChip: section.showListChip };
    return (
      <View key={section.key} style={styles.group}>
        {section.title && (
          <>
            <View style={styles.groupHeader}>
              {section.icon === 'star' ? (
                <Ionicons name="star" size={14} color={section.color ?? 'rgba(255,255,255,0.45)'} />
              ) : section.icon === 'list' ? (
                <Ionicons name="list-outline" size={20} color={section.color ?? 'rgba(255,255,255,0.45)'} />
              ) : (
                <View style={[styles.groupDot, { backgroundColor: section.color ?? 'rgba(255,255,255,0.45)' }]} />
              )}
              <Text
                style={[
                  section.icon === 'list' ? styles.groupTitleList : styles.groupTitle,
                  { color: section.color ?? 'rgba(255,255,255,0.45)' },
                ]}
              >
                {section.title}
              </Text>
            </View>
            {/* A list's own short line, above its tasks - the user's own
                ask, tappable to add or change it. */}
            {section.icon === 'list' && section.listId && (
              <Pressable onPress={() => setDescribingListId(section.listId!)} style={styles.listDescriptionTap}>
                <Text style={styles.listDescriptionText} numberOfLines={2}>
                  {section.description || 'Додати опис'}
                </Text>
              </Pressable>
            )}
          </>
        )}
        {section.unfinished.map((task) => renderTaskRow(task, rowOpts))}
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
            {expandedGroups.has(section.key) && section.completed.map((task) => renderTaskRow(task, rowOpts))}
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
    const project = task.groupId ? projectsById[task.groupId] : undefined;
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
              color={task.checked ? accent : 'rgba(255,255,255,0.45)'}
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
            {showProjectChip && (
              <Pressable onPress={() => openProjectPicker(task.id)}>
                <View style={[styles.chip, project ? { backgroundColor: `${project.color}1A` } : styles.chipEmpty]}>
                  <Ionicons
                    name="cube-outline"
                    size={11}
                    color={project ? project.color : 'rgba(255,255,255,0.45)'}
                  />
                  <Text style={[styles.chipText, { color: project ? project.color : 'rgba(255,255,255,0.45)' }]}>
                    {project ? project.name : 'Вхідні'}
                  </Text>
                </View>
              </Pressable>
            )}
            {reminderLabel && (
              <Pressable onPress={() => openReminderPicker(task.id)}>
                <View style={styles.reminderChip}>
                  <Ionicons
                    name={task.reminderKind === 'notify' ? 'notifications-outline' : 'alarm-outline'}
                    size={11}
                    color={accent}
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
        <ActivityIndicator color={accent} />
      </View>
    );
  }

  if (tasks.length === 0) {
    return (
      <View style={styles.container}>
        <View style={styles.emptyState}>
          <View style={styles.emptyIcon}>
            <Ionicons name="checkbox-outline" size={32} color={accent} />
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
              <SortMenuRows sortPref={sortPref} onSelectField={selectSortField} accentColor={accent} />
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

        {!kanbanMode && groups.length > 0 && (
          <ProjectTabsRow
            items={groups}
            selected={projectFilter}
            onSelect={setProjectFilter}
            // Not assigned to a project = in the inbox; the user's own rule.
            unassignedLabel="Вхідні"
            unassignedFirst
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
              showProjectChip,
              showListChip: true,
            })}

          {todayTasks.length > 0 && <View style={styles.todayDivider} />}

          {(() => {
            const rest = filteredTasks.filter((t) => !isTaskToday(t, today));
            // Inside ONE project's own view, its lists stand as section
            // headers - "також в проектах список іде окремим заголовком
            // над справами" - so the per-row chip (redundant with the
            // header) is dropped for these rows. Outside a single
            // project's view a list still only ever makes sense per row,
            // since lists from different projects can't share one header.
            if (!isProjectSpecific) {
              return renderSection({
                key: '__all__',
                title: null,
                color: null,
                unfinished: rest.filter((t) => !t.checked),
                completed: rest.filter((t) => t.checked),
                showProjectChip,
                showListChip: true,
              });
            }
            const listsHere = taskLists.filter((l) => l.groupId === projectFilter);
            const unlisted = rest.filter((t) => !t.listId);
            return (
              <>
                {listsHere.map((l) => {
                  const inList = rest.filter((t) => t.listId === l.id);
                  // Shown even with nothing in it yet - a list is its own
                  // small object now (it can carry a description), not
                  // just a grouping that only exists once something is
                  // filed under it.
                  return renderSection({
                    key: `__list_${l.id}__`,
                    title: l.name,
                    color: l.color,
                    icon: 'list',
                    listId: l.id,
                    description: l.description,
                    unfinished: inList.filter((t) => !t.checked),
                    completed: inList.filter((t) => t.checked),
                    showProjectChip: false,
                    showListChip: false,
                  });
                })}
                {unlisted.length > 0 &&
                  renderSection({
                    key: '__unlisted__',
                    title: listsHere.length > 0 ? 'Без списку' : null,
                    color: null,
                    unfinished: unlisted.filter((t) => !t.checked),
                    completed: unlisted.filter((t) => t.checked),
                    showProjectChip: false,
                    showListChip: false,
                  })}
              </>
            );
          })()}

          {filteredTasks.length === 0 && (
            <Text style={styles.emptyFilterLabel}>Немає справ із цим фільтром</Text>
          )}
        </ScrollView>
        )}

        <GroupPickerSheet
          visible={pickerTaskId !== null}
          kind="task"
          groups={groups}
          onPick={assignGroup}
          onClose={() => setPickerTaskId(null)}
          unassignedLabel="Вхідні"
        />

        {/* Scoped to whichever project the picked task already has -
            a list means nothing without one. */}
        {(() => {
          const listPickerTask = tasks.find((t) => t.id === listPickerTaskId);
          const listPickerGroupId = listPickerTask?.groupId;
          const listsHere = listPickerGroupId
            ? taskLists.filter((l) => l.groupId === listPickerGroupId)
            : [];
          return (
            <Modal
              visible={listPickerTaskId !== null}
              transparent
              animationType="fade"
              onRequestClose={() => setListPickerTaskId(null)}
            >
              <Pressable
                style={[styles.modalBackdrop, { paddingBottom: keyboardHeight }]}
                onPress={() => setListPickerTaskId(null)}
              >
                <Pressable style={styles.modalSheet} onPress={() => {}}>
                  <View style={styles.modalHandle} />
                  <Text style={styles.modalTitle}>Оберіть список</Text>

                  <Pressable style={styles.modalRow} onPress={() => assignTaskList(null)}>
                    <View style={[styles.modalDot, { backgroundColor: 'rgba(255,255,255,0.45)' }]} />
                    <Text style={styles.modalRowText}>Без списку</Text>
                  </Pressable>

                  {listsHere.map((l) =>
                    editingTaskListId === l.id ? (
                      <View key={l.id} style={styles.modalRow}>
                        <View style={[styles.modalDot, { backgroundColor: l.color }]} />
                        <TextInput
                          style={styles.modalRenameInput}
                          value={editingTaskListName}
                          onChangeText={setEditingTaskListName}
                          autoFocus
                          onSubmitEditing={saveEditTaskList}
                          onBlur={saveEditTaskList}
                          returnKeyType="done"
                        />
                      </View>
                    ) : (
                      <View key={l.id} style={styles.modalRow}>
                        <Pressable style={styles.modalRowTap} onPress={() => assignTaskList(l.id)}>
                          <View style={[styles.modalDot, { backgroundColor: l.color }]} />
                          <Text style={styles.modalRowText}>{l.name}</Text>
                        </Pressable>
                        <Pressable hitSlop={8} onPress={() => startEditTaskList(l)}>
                          <Ionicons name="pencil-outline" size={16} color="#9CA3AF" />
                        </Pressable>
                        <Pressable hitSlop={8} onPress={() => confirmDeleteTaskList(l)}>
                          <Ionicons name="close" size={16} color="#9CA3AF" />
                        </Pressable>
                      </View>
                    )
                  )}

                  {listPickerGroupId && (
                    <>
                      <View style={styles.modalDivider} />
                      <View style={styles.modalAddRow}>
                        <TextInput
                          style={styles.modalInput}
                          value={newTaskListName}
                          onChangeText={setNewTaskListName}
                          placeholder="Новий список"
                          placeholderTextColor={theme.ink.faint}
                          onSubmitEditing={() => addTaskList(listPickerGroupId)}
                          returnKeyType="done"
                        />
                        <Pressable hitSlop={8} onPress={() => addTaskList(listPickerGroupId)}>
                          <Ionicons name="add-circle" size={26} color={accent} />
                        </Pressable>
                      </View>
                    </>
                  )}
                </Pressable>
              </Pressable>
            </Modal>
          );
        })()}

        <Modal
          visible={recurrenceTaskId !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setRecurrenceTaskId(null)}
        >
          <Pressable style={styles.modalBackdrop} onPress={() => setRecurrenceTaskId(null)}>
            <Pressable style={styles.modalSheet} onPress={() => {}}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Повторення</Text>
              {(() => {
                const task = tasks.find((t) => t.id === recurrenceTaskId);
                const apply = (r: Recurrence | null) => task && setTaskRecurrence(task, r);
                return (
                  <>
                    <Pressable style={styles.modalRow} onPress={() => apply(null)}>
                      <View style={[styles.modalDot, { backgroundColor: 'rgba(255,255,255,0.45)' }]} />
                      <Text style={styles.modalRowText}>Немає</Text>
                    </Pressable>
                    <Pressable style={styles.modalRow} onPress={() => apply({ freq: 'daily' })}>
                      <View style={[styles.modalDot, { backgroundColor: accent }]} />
                      <Text style={styles.modalRowText}>Щодня</Text>
                    </Pressable>
                    <Pressable style={styles.modalRow} onPress={() => apply({ freq: 'weekly' })}>
                      <View style={[styles.modalDot, { backgroundColor: accent }]} />
                      <Text style={styles.modalRowText}>Щотижня</Text>
                    </Pressable>
                    <Pressable style={styles.modalRow} onPress={() => apply({ freq: 'monthly' })}>
                      <View style={[styles.modalDot, { backgroundColor: accent }]} />
                      <Text style={styles.modalRowText}>Щомісяця</Text>
                    </Pressable>
                    <View style={styles.modalDivider} />
                    <Text style={styles.weekdayHint}>Або щотижня в один день:</Text>
                    <View style={styles.weekdayRow}>
                      {WEEKDAY_FULL.map((label, index) => (
                        <Pressable
                          key={label}
                          style={styles.weekdayButton}
                          onPress={() => apply({ freq: 'weekday', weekday: index })}
                        >
                          <Text style={styles.weekdayButtonText}>{label.slice(0, 2)}</Text>
                        </Pressable>
                      ))}
                    </View>
                  </>
                );
              })()}
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
      <RenamePrompt
        visible={describingListId !== null}
        title="Опис списку"
        initialValue={taskLists.find((l) => l.id === describingListId)?.description ?? ''}
        placeholder="Короткий опис"
        multiline
        allowEmpty
        onCancel={() => setDescribingListId(null)}
        onSave={saveListDescription}
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
      <AddExistingItemModal
        visible={attachTaskId !== null}
        allowedTabs={['file', 'photo']}
        onClose={() => setAttachTaskId(null)}
        onPick={(block) => {
          const task = tasks.find((t) => t.id === attachTaskId);
          setAttachTaskId(null);
          if (task) addAttachment(task, block);
        }}
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
  // A list's own name, not a small-caps label like "СЬОГОДНІ" - it reads
  // as a real heading over its tasks, H2-sized to match the document
  // editor's own heading scale (documentEditorStyles' heading2).
  groupTitleList: {
    fontSize: 21,
    fontFamily: FONT_SEMIBOLD,
    letterSpacing: 0,
  },
  listDescriptionTap: {
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  listDescriptionText: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.5)',
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
  // The whole card - a column now, so the expanded details below share
  // its one continuous background/border rather than standing as a
  // second capsule of their own. `rowMain` carries the row's own old
  // layout (the horizontal strip of checkbox/text/star/chevron).
  row: {
    borderRadius: 16,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.16)',
  },
  rowMain: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
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
  detailsCapsuleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
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
    color: t.sections.tasks,
  },
  rowDelete: {
    padding: 4,
  },
  // Subtasks, comment, attachments - the part of a task only its own
  // chevron ever reveals. A hairline top border is the only thing
  // telling it apart from rowMain above it, since they share one
  // continuous card (see `row`'s own comment).
  details: {
    gap: 8,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: 'rgba(255,255,255,0.12)',
  },
  subtaskRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingLeft: 8,
  },
  subtaskText: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
  },
  subtaskAddRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 8,
  },
  subtaskInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.16)',
  },
  commentInput: {
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
    minHeight: 40,
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  attachmentsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  attachmentChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    maxWidth: 180,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.08)',
  },
  attachmentChipText: {
    flexShrink: 1,
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
  },
  attachButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingVertical: 4,
  },
  attachButtonText: {
    fontSize: 13,
    fontFamily: FONT_MEDIUM,
    fontWeight: '500',
  },
  modalBackdrop: {
    backgroundColor: t.scrim,
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
  weekdayHint: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: 'rgba(255,255,255,0.5)',
    marginBottom: 6,
  },
  weekdayRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 4,
  },
  weekdayButton: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  weekdayButtonText: {
    fontSize: 13,
    fontFamily: FONT_MEDIUM,
    color: t.ink.primary,
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
    borderBottomColor: t.sections.tasks,
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
