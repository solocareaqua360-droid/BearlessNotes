import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
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

const ACCENT = '#3B82F6';
const DANGER = '#EF4444';
const NO_PROJECT_KEY = '__none__';
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

type Task = {
  id: string;
  text: string;
  checked: boolean;
  documentId: string;
  projectId?: string;
  todayMarkedDate?: string;
};

export default function TasksScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [groupByProject, setGroupByProject] = useState(false);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
  const [pickerTaskId, setPickerTaskId] = useState<string | null>(null);
  const [newProjectName, setNewProjectName] = useState('');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState('');
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
  const groups = useMemo(() => {
    if (!groupByProject) return [];
    const byKey = new Map<string, { key: string; project: Project | null; tasks: Task[] }>();
    tasks.forEach((t) => {
      const project = t.projectId ? projectsById[t.projectId] : undefined;
      const key = project ? project.id : NO_PROJECT_KEY;
      if (!byKey.has(key)) byKey.set(key, { key, project: project ?? null, tasks: [] });
      byKey.get(key)!.tasks.push(t);
    });
    return Array.from(byKey.values())
      .map((g) => ({
        key: g.key,
        project: g.project,
        unfinished: g.tasks.filter((t) => !t.checked),
        completed: g.tasks.filter((t) => t.checked),
      }))
      .sort((a, b) => {
        if (!a.project) return 1;
        if (!b.project) return -1;
        return a.project.name.localeCompare(b.project.name);
      });
  }, [groupByProject, tasks, projectsById]);

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

  async function toggleToday(task: Task) {
    const isToday = task.todayMarkedDate === today;
    const newValue = isToday ? null : today;
    updateDoc(doc(db, 'tasks', task.id), { todayMarkedDate: newValue ?? deleteField() });
    const documentRef = doc(db, 'documents', task.documentId);
    const snapshot = await getDoc(documentRef);
    const data = snapshot.data();
    if (!data) return;
    const blocks: Block[] = data.blocks ?? [];
    const updatedBlocks = blocks.map((b) => {
      if (b.id !== task.id) return b;
      if (newValue) return { ...b, todayMarkedDate: newValue };
      const { todayMarkedDate: _drop, ...rest } = b;
      return rest;
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
  // block from its source document too, not just this mirror, and the
  // warning names that one document instead of a list of mentions.
  function confirmDeleteTask(task: Task) {
    Alert.alert('Видалити справу?', 'Чекбокс також зникне з документа, де його написано.', [
      { text: 'Скасувати', style: 'cancel' },
      { text: 'Видалити', style: 'destructive', onPress: () => deleteTask(task) },
    ]);
  }

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

  function renderTaskRow(item: Task) {
    const project = item.projectId ? projectsById[item.projectId] : undefined;
    const isToday = item.todayMarkedDate === today;
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
          onPress={() => navigation.navigate('Editor', { documentId: item.documentId })}
        >
          <Text style={[styles.rowText, item.checked && styles.rowTextChecked]} numberOfLines={2}>
            {item.text}
          </Text>
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
        </Pressable>
        <Pressable hitSlop={8} onPress={() => toggleToday(item)}>
          <Ionicons name={isToday ? 'star' : 'star-outline'} size={20} color={isToday ? '#F59E0B' : '#9CA3AF'} />
        </Pressable>
        <Pressable hitSlop={8} onPress={() => confirmDeleteTask(item)} style={styles.rowDelete}>
          <Ionicons name="trash-outline" size={20} color={DANGER} />
        </Pressable>
      </View>
    );
  }

  // Одна й та сама секція-рендерер для "Сьогодні" (завжди пришпилена
  // зверху, якщо там щось є), кожного проекту в групованому вигляді, і
  // єдиного суцільного списку в негрупованому - справа може одночасно
  // з'являтися і в "Сьогодні", і у своєму проекті/загальному списку нижче,
  // це не взаємовиключні місця.
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

  const todayTasks = tasks.filter((t) => t.todayMarkedDate === today);

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
        <Text style={styles.header}>Справи</Text>
        <Pressable style={styles.groupToggle} onPress={() => setGroupByProject((v) => !v)}>
          <Ionicons name="albums-outline" size={18} color={groupByProject ? ACCENT : '#6B7280'} />
          <Text style={[styles.groupToggleLabel, groupByProject && { color: ACCENT }]}>Групувати</Text>
        </Pressable>
      </View>

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

        {groupByProject
          ? groups.map((group) =>
              renderSection({
                key: group.key,
                title: group.project ? group.project.name.toUpperCase() : 'БЕЗ ПРОЕКТУ',
                color: group.project?.color ?? '#9CA3AF',
                unfinished: group.unfinished,
                completed: group.completed,
              })
            )
          : renderSection({
              key: '__all__',
              title: null,
              color: null,
              unfinished: tasks.filter((t) => !t.checked),
              completed: tasks.filter((t) => t.checked),
            })}
      </ScrollView>

      <Modal visible={pickerTaskId !== null} transparent animationType="fade" onRequestClose={() => setPickerTaskId(null)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setPickerTaskId(null)}>
          <Pressable style={styles.modalSheet} onPress={() => {}}>
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
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  groupToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  groupToggleLabel: {
    fontSize: 14,
    color: '#6B7280',
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
});
