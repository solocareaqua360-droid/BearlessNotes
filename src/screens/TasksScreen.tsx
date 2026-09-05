import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  orderBy,
  query,
  updateDoc,
} from 'firebase/firestore';
import { db } from '../firebase';
import { Block } from '../types';
import { RootStackParamList } from '../navigation';

const ACCENT = '#3B82F6';
const DANGER = '#EF4444';
const tasksCollection = collection(db, 'tasks');

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

type Task = {
  id: string;
  text: string;
  checked: boolean;
  documentId: string;
};

export default function TasksScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const tasksQuery = query(tasksCollection, orderBy('updatedAt', 'desc'));
    return onSnapshot(tasksQuery, (snapshot) => {
      setTasks(
        snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          text: docSnapshot.data().text,
          checked: docSnapshot.data().checked,
          documentId: docSnapshot.data().documentId,
        }))
      );
      setIsLoading(false);
    });
  }, []);

  // The task doc is a mirror (see DocumentEditorScreen's syncTasksForDocument) -
  // the block inside the source document's own `blocks` array field is the
  // real record, so toggling here has to update both, not just this mirror.
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
      <Text style={styles.header}>Справи</Text>
      <FlatList
        data={tasks}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.row}>
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
            </Pressable>
            <Pressable hitSlop={8} onPress={() => confirmDeleteTask(item)} style={styles.rowDelete}>
              <Ionicons name="trash-outline" size={20} color={DANGER} />
            </Pressable>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 8,
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
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  rowTextTap: {
    flex: 1,
  },
  rowText: {
    fontSize: 16,
    color: '#111827',
  },
  rowTextChecked: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
  rowDelete: {
    padding: 4,
  },
});
