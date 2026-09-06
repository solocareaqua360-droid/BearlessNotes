import { useState } from 'react';
import { Alert, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { addDoc, collection, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { Project } from '../types';

const ACCENT = '#3B82F6';
const PROJECT_COLORS = ['#3B82F6', '#16A34A', '#8B5CF6', '#F97316', '#EC4899', '#14B8A6', '#EAB308'];
const projectsCollection = collection(db, 'projects');

type Props = {
  visible: boolean;
  projects: Project[];
  onPick: (projectId: string | null) => void;
  onClose: () => void;
};

// Same bottom sheet TasksScreen already has inline for a single task's
// project, pulled out so Files/Photos/Links can assign a project to a
// selection too (see BulkActionBar) - manages the shared `projects`
// collection itself (create/rename/delete), same as the original.
export default function ProjectPickerSheet({ visible, projects, onPick, onClose }: Props) {
  const [newProjectName, setNewProjectName] = useState('');
  const [editingProjectId, setEditingProjectId] = useState<string | null>(null);
  const [editingProjectName, setEditingProjectName] = useState('');

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
    Alert.alert('Видалити проєкт?', `Об'єкти з проєктом "${project.name}" стануть без проєкту.`, [
      { text: 'Скасувати', style: 'cancel' },
      { text: 'Видалити', style: 'destructive', onPress: () => deleteDoc(doc(db, 'projects', project.id)) },
    ]);
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>Оберіть проєкт</Text>

          <Pressable style={styles.row} onPress={() => onPick(null)}>
            <View style={[styles.dot, { backgroundColor: '#9CA3AF' }]} />
            <Text style={styles.rowText}>Без проєкту</Text>
          </Pressable>

          {projects.map((p) =>
            editingProjectId === p.id ? (
              <View key={p.id} style={styles.row}>
                <View style={[styles.dot, { backgroundColor: p.color }]} />
                <TextInput
                  style={styles.renameInput}
                  value={editingProjectName}
                  onChangeText={setEditingProjectName}
                  autoFocus
                  onSubmitEditing={saveEditProject}
                  onBlur={saveEditProject}
                  returnKeyType="done"
                />
              </View>
            ) : (
              <View key={p.id} style={styles.row}>
                <Pressable style={styles.rowTap} onPress={() => onPick(p.id)}>
                  <View style={[styles.dot, { backgroundColor: p.color }]} />
                  <Text style={styles.rowText}>{p.name}</Text>
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

          <View style={styles.divider} />

          <View style={styles.addRow}>
            <TextInput
              style={styles.addInput}
              value={newProjectName}
              onChangeText={setNewProjectName}
              placeholder="Новий проєкт"
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
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(17,24,39,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: '70%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 8,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
  },
  rowTap: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  rowText: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
  },
  renameInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: ACCENT,
  },
  divider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 8,
  },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  addInput: {
    flex: 1,
    fontSize: 15,
    color: '#111827',
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
