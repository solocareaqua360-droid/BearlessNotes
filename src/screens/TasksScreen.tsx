import { useEffect, useMemo, useState } from 'react';
import { GLASS_TEXT_FAINT, SHEET_BACKDROP, SHEET_WINDOW } from '../constants/glass';
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
import { addDoc, ownedQuery } from '../utils/owned';
import { db } from '../firebase';
import { Block, Project } from '../types';
import { hapticToggle } from '../utils/haptics';
import { RootStackParamList } from '../navigation';
import ProjectTabsRow, { UNASSIGNED_ID } from '../components/ProjectTabsRow';
import ReminderSheet from '../components/ReminderSheet';
import SortMenuRows from '../components/SortMenuRows';
import { useMultiSelect } from '../hooks/useMultiSelect';
import { useSortPref } from '../hooks/useSortPref';
import { cancelReminder, scheduleReminder, type ReminderKind } from '../utils/reminders';
import { formatShortDate, parseDateKey } from '../utils/dateLocale';
import { sortItems } from '../utils/sortItems';
import ContentColumn from '../components/ContentColumn';
import { BlurView } from 'expo-blur';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenBackdrop from '../components/ScreenBackdrop';
import RailCapsule from '../components/RailCapsule';
import Menu from '../components/surfaces/Menu';
import { GlassPortal } from '../components/GlassPortal';
import { useBlurTarget } from '../components/GlassTarget';
import { useRail } from '../hooks/useRail';
import {
  CAPSULE_HEIGHT,
  CAPSULE_HEIGHT_1,
  CHROME_TOP,
  CAPSULE_DROP,
  RAIL_CLEARANCE,
  RAIL_RIGHT,
} from '../constants/rail';
import { GLASS_BODY_BLURRED, GLASS_CARD, GLASS_ISLAND, GLASS_LINE, GLASS_TEXT, GLASS_TEXT_MUTED } from '../constants/glass';
import { FONT_BOLD, FONT_MEDIUM, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { confirm } from '../components/surfaces/Ask';

const ACCENT = '#4E9A6B';
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
  const railBlurTarget = useBlurTarget();
  const insets = useSafeAreaInsets();
  // Every piece of this rail is drawn through the portal, and the portal
  // reaches over the WHOLE app - so a screen pushed on top of this one
  // (a document opened from a task) had these capsules still floating
  // above it, overlapping its own. A screen's rail belongs to the screen
  // that is actually on show.
  const isFocused = useIsFocused();
  // One button at the top (the way out), what this list can be DONE to
  // under it, and choosing in its own capsule. This screen is PUSHED over
  // the tabs, so there is no island at its foot, and tasks are made inside
  // a document, so there is no "+" either.
  const rail = useRail(CAPSULE_HEIGHT_1, CAPSULE_HEIGHT, 0, CAPSULE_HEIGHT_1, false);
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
    });
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
    // Sorted once here rather than per-section below - every downstream
    // .filter() (today/unfinished/completed/kanban column) preserves
    // relative order, so this one sort is what all of them end up showing.
    return sortItems(
      byProject,
      sortPref,
      (t) => t.text || 'Без назви',
      (t) => t.createdAt,
      (t) => t.updatedAt
    );
  }, [tasks, projectFilter, sortPref]);

  // The task doc is a mirror (see DocumentEditorScreen's syncTasksForDocument) -
  // the block inside the source document's own `blocks` array field is the
  // real record, so every change here has to update both, not just this mirror.
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

  // Steps a task one column left/right (the card's two arrow buttons -
  // no drag-and-drop, decided against as its own multi-column drop-target
  // problem on top of everything already fought to get a working
  // drag-to-reorder in the editor). Crossing the "Готово" boundary either
  // way carries the checkbox with it: entering it checks the task,
  // leaving it unchecks - the checkbox and the column stay in sync with
  // each other for that one boundary, in both directions.
  async function moveTaskColumn(task: Task, delta: number) {
    const currentIndex = KANBAN_COLUMNS.findIndex((c) => c.key === (task.kanbanStatus ?? 'inbox'));
    const newIndex = currentIndex + delta;
    if (newIndex < 0 || newIndex >= KANBAN_COLUMNS.length) return;
    const newStatus = KANBAN_COLUMNS[newIndex].key;
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
                  {project ? project.name : 'Без проекту'}
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
    return (
      <View key={task.id} style={styles.kanbanCard}>
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
                  {project ? project.name : 'Без проекту'}
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
              <Ionicons name="chevron-back" size={16} color={columnIndex === 0 ? 'rgba(255,255,255,0.25)' : GLASS_TEXT_MUTED} />
            </Pressable>
            <Pressable
              style={styles.kanbanArrowButton}
              disabled={columnIndex === KANBAN_COLUMNS.length - 1}
              onPress={() => moveTaskColumn(task, 1)}
            >
              <Ionicons
                name="chevron-forward"
                size={16}
                color={columnIndex === KANBAN_COLUMNS.length - 1 ? 'rgba(255,255,255,0.25)' : GLASS_TEXT_MUTED}
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
      <ScrollView
        horizontal
        style={styles.kanbanBoardScroll}
        pagingEnabled={false}
        snapToInterval={kanbanColumnWidth + KANBAN_COLUMN_GAP}
        decelerationRate="fast"
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.kanbanBoard}
      >
        {KANBAN_COLUMNS.map((column, columnIndex) => {
          const columnTasks = todayTasks.filter((t) => (t.kanbanStatus ?? 'inbox') === column.key);
          return (
            <View key={column.key} style={{ width: kanbanColumnWidth }}>
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
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <ScreenBackdrop id="tasksBg" colors={['#705648', '#69736E', '#000000']} />

      {/* The way out, in the top capsule where it is on every database. */}
      {isFocused && (
      <GlassPortal>
        <View style={[styles.railTop, { top: insets.top + CHROME_TOP + CAPSULE_DROP }]} pointerEvents="box-none">
          <View style={styles.topCapsule}>
            <BlurView
              intensity={60}
              tint="dark"
              blurMethod="dimezisBlurView"
              blurTarget={railBlurTarget ?? undefined}
              style={StyleSheet.absoluteFill}
              pointerEvents="none"
            />
            <Pressable hitSlop={8} onPress={() => (kanbanMode ? setKanbanMode(false) : navigation.goBack())}>
              <Ionicons name="arrow-back-outline" size={24} color="#fff" />
            </Pressable>
          </View>
        </View>
      </GlassPortal>
      )}

      {/* What shape the list takes, and what order it is in. */}
      {isFocused && (
      <RailCapsule
        bottom={rail.actionsBottom}
        buttons={[
          {
            icon: kanbanMode ? 'albums-outline' : 'reorder-four-outline',
            onPress: () =>
              setKanbanMode((v) => {
                const next = !v;
                if (next) clearSelection();
                return next;
              }),
          },
          { icon: 'filter-outline', onPress: () => setMenuOpen((v) => !v), active: menuOpen },
        ]}
      />
      )}
      {isFocused && (
      <RailCapsule
        bottom={rail.historyBottom}
        buttons={[
          {
            icon: isSelectMode ? 'close-outline' : 'checkmark-circle-outline',
            onPress: () => {
              if (!isSelectMode) setKanbanMode(false);
              toggleSelectMode();
            },
            active: isSelectMode,
          },
        ]}
      />
      )}

      <ContentColumn>
        {/* The band the status bar and the rail's top capsule stand in.
            It was the header row's own top padding until the header went. */}
        <View style={{ height: insets.top + CHROME_TOP + 8 }} />
        {/* No header row any more. Its title said the name of the screen
            you had just tapped to reach, and its three buttons were a
            light capsule of this screen's own invention - the one screen
            in the app that was still white. They are on the rail now,
            each in the place it has everywhere else. */}
        {/* Ordering hangs off the button that opens it, on the rail. */}
        {menuOpen && (
          <>
            <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)} />
            <View style={[styles.menuPanel, { bottom: rail.actionsBottom }]}>
              <SortMenuRows sortPref={sortPref} onSelectField={selectSortField} accentColor={ACCENT} />
            </View>
          </>
        )}

        {!kanbanMode && projects.length > 0 && (
          <ProjectTabsRow items={projects} selected={projectFilter} onSelect={setProjectFilter} />
        )}

        {kanbanMode ? (
          renderKanbanBoard()
        ) : (
        <ScrollView contentContainerStyle={styles.list}>
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

        {isSelectMode && selectedIds.size > 0 && (
          <View style={styles.selectionBar}>
            <Text style={styles.selectionCount}>{selectedIds.size}</Text>
            <Pressable style={styles.selectionDeleteBtn} onPress={confirmBulkDeleteTasks}>
              <Ionicons name="trash-outline" size={18} color={DANGER} />
              <Text style={styles.selectionDeleteLabel}>Видалити</Text>
            </Pressable>
          </View>
        )}

        <Modal visible={pickerTaskId !== null} transparent animationType="fade" onRequestClose={() => setPickerTaskId(null)}>
          <Pressable style={[styles.modalBackdrop, { paddingBottom: keyboardHeight }]} onPress={() => setPickerTaskId(null)}>
            <Pressable style={styles.modalSheet} onPress={() => {}}>
              <View style={styles.modalHandle} />
              <Text style={styles.modalTitle}>Оберіть проект</Text>

              <Pressable style={styles.modalRow} onPress={() => assignProject(null)}>
                <View style={[styles.modalDot, { backgroundColor: 'rgba(255,255,255,0.45)' }]} />
                <Text style={styles.modalRowText}>Без проекту</Text>
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
                  placeholderTextColor={GLASS_TEXT_FAINT}
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

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  railTop: {
    position: 'absolute',
    right: RAIL_RIGHT,
    alignItems: 'center',
    zIndex: 20,
  },
  // The same capsule every other screen's top one is - 19 of padding
  // around a 24px icon, inside a hairline border.
  topCapsule: {
    alignItems: 'center',
    paddingVertical: 18,
    paddingHorizontal: 19,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: GLASS_ISLAND,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
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
    // Beside the button that opens it, which is on the rail now - the
    // `bottom` comes from the rail at the call site.
    right: RAIL_CLEARANCE,
    width: 200,
    backgroundColor: GLASS_BODY_BLURRED,
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
    backgroundColor: GLASS_BODY_BLURRED,
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
    color: GLASS_TEXT,
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
    color: GLASS_TEXT,
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
    // The rail stands at the right edge; the rows stop short of it rather
    // than running under it, as they do on every other list.
    paddingRight: RAIL_CLEARANCE,
  },
  group: {
    gap: 8,
    marginBottom: 8,
  },
  todayDivider: {
    height: 1,
    backgroundColor: GLASS_LINE,
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
    color: GLASS_TEXT,
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
    backgroundColor: GLASS_BODY_BLURRED,
    ...SHEET_WINDOW,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: GLASS_LINE,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
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
    color: GLASS_TEXT,
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
    color: GLASS_TEXT,
    paddingVertical: 6,
  },
  modalRenameInput: {
    flex: 1,
    fontSize: 16,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: ACCENT,
  },
  kanbanBoardScroll: {
    flex: 1,
  },
  kanbanBoard: {
    paddingLeft: 16,
    // Clear of the rail, like every other list on this screen.
    paddingRight: RAIL_CLEARANCE,
    paddingBottom: 16,
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
    color: GLASS_TEXT_MUTED,
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
    backgroundColor: GLASS_CARD,
    borderRadius: 12,
    padding: 10,
    gap: 6,
    shadowColor: '#000',
    shadowOpacity: 0.06,
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
    color: GLASS_TEXT,
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
