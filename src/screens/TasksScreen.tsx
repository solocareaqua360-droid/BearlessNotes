import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
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
  addDoc,
  collection,
  deleteDoc,
  deleteField,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Block, Project } from '../types';
import { RootStackParamList } from '../navigation';
import ProjectTabsRow, { UNASSIGNED_ID } from '../components/ProjectTabsRow';
import ReminderSheet from '../components/ReminderSheet';
import { useMultiSelect } from '../hooks/useMultiSelect';
import { cancelReminder, scheduleReminder } from '../utils/reminders';
import { formatShortDate, parseDateKey } from '../utils/dateLocale';

const ACCENT = '#3B82F6';
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
  reminderNotificationId?: string;
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
    const tasksQuery = query(tasksCollection, orderBy('updatedAt', 'desc'));
    return onSnapshot(tasksQuery, (snapshot) => {
      const loaded = snapshot.docs.map((docSnapshot) => ({
        id: docSnapshot.id,
        text: docSnapshot.data().text,
        checked: docSnapshot.data().checked,
        documentId: docSnapshot.data().documentId,
        projectId: docSnapshot.data().projectId,
        todayMarkedDate: docSnapshot.data().todayMarkedDate,
        kanbanStatus: docSnapshot.data().kanbanStatus,
        reminderDate: docSnapshot.data().reminderDate,
        reminderTime: docSnapshot.data().reminderTime,
        reminderNotificationId: docSnapshot.data().reminderNotificationId,
      }));
      loaded.sort((a, b) => Number(a.checked) - Number(b.checked));
      setTasks(loaded);
      setIsLoading(false);
    });
  }, []);

  useEffect(() => {
    const projectsQuery = query(projectsCollection, orderBy('name'));
    return onSnapshot(projectsQuery, (snapshot) => {
      setProjects(
        snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          name: docSnapshot.data().name,
          color: docSnapshot.data().color,
        }))
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
    if (projectFilter === null) return tasks;
    if (projectFilter === UNASSIGNED_ID) return tasks.filter((t) => !t.projectId);
    return tasks.filter((t) => t.projectId === projectFilter);
  }, [tasks, projectFilter]);

  // The task doc is a mirror (see DocumentEditorScreen's syncTasksForDocument) -
  // the block inside the source document's own `blocks` array field is the
  // real record, so every change here has to update both, not just this mirror.
  async function toggleTask(task: Task) {
    const newChecked = !task.checked;
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
        ? { reminderDate: deleteField(), reminderTime: deleteField(), reminderNotificationId: deleteField() }
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
      const { todayMarkedDate: _d1, reminderDate: _d2, reminderTime: _d3, reminderNotificationId: _d4, ...rest } = b;
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
  async function saveTaskReminder(reminderDate: string, reminderTime: string | null) {
    const taskId = reminderTaskId;
    const task = tasks.find((t) => t.id === taskId);
    setReminderTaskId(null);
    if (!task) return;
    await cancelReminder(task.reminderNotificationId);
    const notificationId = reminderTime ? await scheduleReminder(task.text, reminderDate, reminderTime) : undefined;
    const becomesToday = reminderDate === today;
    updateDoc(doc(db, 'tasks', task.id), {
      reminderDate,
      reminderTime: reminderTime ?? deleteField(),
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
      if (reminderTime) next.reminderTime = reminderTime;
      else delete next.reminderTime;
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
      reminderNotificationId: deleteField(),
    });
    const documentRef = doc(db, 'documents', task.documentId);
    const snapshot = await getDoc(documentRef);
    const data = snapshot.data();
    if (!data) return;
    const blocks: Block[] = data.blocks ?? [];
    const updatedBlocks = blocks.map((b) => {
      if (b.id !== task.id) return b;
      const { reminderDate: _d1, reminderTime: _d2, reminderNotificationId: _d3, ...rest } = b;
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
    Alert.alert(
      'Видалити проект?',
      `Справи з проектом "${project.name}" стануть без проекту.`,
      [
        { text: 'Скасувати', style: 'cancel' },
        { text: 'Видалити', style: 'destructive', onPress: () => deleteDoc(doc(db, 'projects', project.id)) },
      ]
    );
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
    Alert.alert(
      isSingle ? 'Видалити справу?' : `Видалити справи (${count})?`,
      isSingle
        ? 'Чекбокс також зникне з документа, де його написано.'
        : 'Чекбокси також зникнуть з документів, де їх написано.',
      [
        { text: 'Скасувати', style: 'cancel' },
        {
          text: 'Видалити',
          style: 'destructive',
          onPress: () => {
            tasks.filter((t) => selectedIds.has(t.id)).forEach((t) => deleteTask(t));
            clearSelection();
          },
        },
      ]
    );
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
            color={item.checked ? ACCENT : '#9CA3AF'}
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
                <Text style={[styles.chipText, { color: project ? project.color : '#9CA3AF' }]}>
                  {project ? project.name : 'Без проекту'}
                </Text>
              </View>
            </Pressable>
            {reminderLabel && (
              <Pressable onPress={() => openReminderPicker(item.id)}>
                <View style={styles.reminderChip}>
                  <Ionicons name="alarm-outline" size={11} color={ACCENT} />
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
          <Ionicons name={isToday ? 'star' : 'star-outline'} size={20} color={isToday ? '#F59E0B' : '#9CA3AF'} />
        </Pressable>
        {isSelectMode && (
          <Pressable hitSlop={8} onPress={() => toggleSelected(item.id)} style={styles.rowDelete}>
            <Ionicons
              name={isSelected ? 'checkbox' : 'square-outline'}
              size={20}
              color={isSelected ? ACCENT : '#9CA3AF'}
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
              <Ionicons name="star" size={14} color={section.color ?? '#9CA3AF'} />
            ) : (
              <View style={[styles.groupDot, { backgroundColor: section.color ?? '#9CA3AF' }]} />
            )}
            <Text style={[styles.groupTitle, { color: section.color ?? '#9CA3AF' }]}>{section.title}</Text>
          </View>
        )}
        {section.unfinished.map((task) => renderTaskRow(task))}
        {section.completed.length > 0 && (
          <>
            <Pressable style={styles.collapseToggle} onPress={() => toggleGroupExpanded(section.key)}>
              <Ionicons
                name={expandedGroups.has(section.key) ? 'chevron-down' : 'chevron-forward'}
                size={16}
                color="#9CA3AF"
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
              color={task.checked ? ACCENT : '#9CA3AF'}
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
                <Text style={[styles.chipText, { color: project ? project.color : '#9CA3AF' }]}>
                  {project ? project.name : 'Без проекту'}
                </Text>
              </View>
            </Pressable>
            {reminderLabel && (
              <Pressable onPress={() => openReminderPicker(task.id)}>
                <View style={styles.reminderChip}>
                  <Ionicons name="alarm-outline" size={11} color={ACCENT} />
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
              <Ionicons name="chevron-back" size={16} color={columnIndex === 0 ? '#D1D5DB' : '#6B7280'} />
            </Pressable>
            <Pressable
              style={styles.kanbanArrowButton}
              disabled={columnIndex === KANBAN_COLUMNS.length - 1}
              onPress={() => moveTaskColumn(task, 1)}
            >
              <Ionicons
                name="chevron-forward"
                size={16}
                color={columnIndex === KANBAN_COLUMNS.length - 1 ? '#D1D5DB' : '#6B7280'}
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
      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Pressable
            hitSlop={8}
            onPress={() => (kanbanMode ? setKanbanMode(false) : navigation.goBack())}
          >
            <Ionicons name="chevron-back" size={22} color="#111827" />
          </Pressable>
          <Text style={styles.header}>{kanbanMode ? 'Справи на сьогодні' : 'Справи'}</Text>
        </View>
        <View style={styles.headerButtonsCapsule}>
          <Pressable
            style={styles.headerButtonsCapsuleBtn}
            hitSlop={6}
            onPress={() =>
              setKanbanMode((v) => {
                const next = !v;
                if (next) clearSelection();
                return next;
              })
            }
            accessibilityLabel="Канбан"
          >
            <Ionicons
              name={kanbanMode ? 'list-outline' : 'albums-outline'}
              size={18}
              color={kanbanMode ? '#111827' : '#6B7280'}
            />
          </Pressable>
          <View style={styles.headerButtonsCapsuleDivider} />
          <Pressable
            style={styles.headerButtonsCapsuleBtn}
            hitSlop={6}
            onPress={() => {
              if (!isSelectMode) setKanbanMode(false);
              toggleSelectMode();
            }}
            accessibilityLabel="Виділити"
          >
            <Ionicons
              name={isSelectMode ? 'close' : 'checkmark-circle-outline'}
              size={18}
              color={isSelectMode ? '#111827' : '#6B7280'}
            />
          </Pressable>
        </View>
      </View>

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
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerTaskId(null)}>
          <Pressable style={[styles.modalSheet, { marginBottom: keyboardHeight }]} onPress={() => {}}>
            <View style={styles.modalHandle} />
            <Text style={styles.modalTitle}>Оберіть проект</Text>

            <Pressable style={styles.modalRow} onPress={() => assignProject(null)}>
              <View style={[styles.modalDot, { backgroundColor: '#9CA3AF' }]} />
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
        onClose={() => setReminderTaskId(null)}
        onSave={saveTaskReminder}
        onClear={clearTaskReminder}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    // 56, not 16 - this screen has no native header (headerShown: false on
    // the stack), so its own top padding is what clears the status bar,
    // matching DocumentEditorScreen's header for the same reason.
    paddingTop: 56,
    paddingBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  // Icon-only, frosted glass - this screen's own background is plain
  // white (not the dark gradient Documents/Calendar/Databases got), so
  // this is the same light-glass variant ProjectTabsRow's pills use:
  // still translucent and bordered, just legible on white.
  headerButtonsCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(120,120,120,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
    overflow: 'hidden',
  },
  headerButtonsCapsuleBtn: {
    width: 40,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerButtonsCapsuleDivider: {
    width: 1,
    height: 16,
    backgroundColor: 'rgba(0,0,0,0.08)',
  },
  selectionBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
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
    color: '#111827',
  },
  selectionDeleteBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  selectionDeleteLabel: {
    fontSize: 15,
    fontWeight: '600',
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
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyLabel: {
    marginTop: 16,
    fontSize: 15,
    color: '#111827',
  },
  emptyFilterLabel: {
    textAlign: 'center',
    marginTop: 24,
    fontSize: 14,
    color: '#9CA3AF',
  },
  emptyHint: {
    marginTop: 6,
    fontSize: 13,
    color: '#9CA3AF',
    textAlign: 'center',
  },
  list: {
    paddingVertical: 8,
  },
  group: {
    marginBottom: 8,
  },
  todayDivider: {
    height: 1,
    backgroundColor: '#E5E7EB',
    marginHorizontal: 20,
    marginBottom: 4,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
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
    letterSpacing: 0.5,
  },
  collapseToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingVertical: 10,
  },
  collapseLabel: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  rowTextTap: {
    flex: 1,
    gap: 5,
  },
  rowText: {
    fontSize: 16,
    color: '#111827',
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
    backgroundColor: '#F3F4F6',
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D1D5DB',
  },
  chipText: {
    fontSize: 12,
    fontWeight: '500',
  },
  reminderChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
  },
  reminderChipText: {
    fontSize: 11.5,
    fontWeight: '600',
    color: ACCENT,
  },
  rowDelete: {
    padding: 4,
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  modalHandle: {
    width: 36,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
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
    color: '#111827',
    flexGrow: 1,
  },
  modalDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
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
    color: '#111827',
    paddingVertical: 6,
  },
  modalRenameInput: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: ACCENT,
  },
  kanbanBoardScroll: {
    flex: 1,
  },
  kanbanBoard: {
    paddingHorizontal: 16,
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
    letterSpacing: 0.4,
    textTransform: 'uppercase',
    color: '#6B7280',
  },
  kanbanColumnCount: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9CA3AF',
    backgroundColor: '#F3F4F6',
    borderRadius: 8,
    paddingHorizontal: 7,
    paddingVertical: 1,
  },
  kanbanColumnBody: {
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
  },
  kanbanColumnBodyContent: {
    padding: 8,
    gap: 8,
    minHeight: 200,
  },
  kanbanCard: {
    backgroundColor: '#fff',
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
    color: '#111827',
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
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
