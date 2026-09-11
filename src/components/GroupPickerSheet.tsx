import { useEffect, useState } from 'react';
import { Alert, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { addDoc, collection, deleteDoc, doc, updateDoc } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { Group } from '../types';
import { groupKindFields } from '../utils/groups';
import {
  GLASS_BACKDROP,
  GLASS_BODY_BLURRED,
  GLASS_INPUT,
  GLASS_LINE,
  GLASS_TEXT,
  GLASS_TEXT_FAINT,
} from '../constants/glass';
import GlassLayer from './GlassLayer';

const ACCENT = '#3B82F6';
const GROUP_COLORS = ['#3B82F6', '#16A34A', '#8B5CF6', '#F97316', '#EC4899', '#14B8A6', '#EAB308'];
const groupsCollection = collection(db, 'groups');

// A fixed, non-deletable group (like "Всі"/"Без групи", but a real group
// document rather than a pseudo-entry) - every image captured with the
// in-app camera lands here automatically, per PhotosScreen's own
// ensureCameraPhotosGroup. Deleting it would silently strand every camera
// photo's groupId pointing at nothing, so it's exempted from the delete
// button below the same way the two pseudo-entries never had one.
export const CAMERA_PHOTOS_GROUP_ID = 'camera-photos';

// A database identifier a group can belong to - see Group.kinds.
export type GroupKind = string;

type Props = {
  visible: boolean;
  kind: GroupKind;
  groups: Group[];
  onPick: (groupId: string | null) => void;
  onClose: () => void;
};

// Group assignment for Files/Photos/Links - its own `groups` collection,
// separate from Tasks' `projects` (the user was explicit these two
// shouldn't be the same thing), AND separate PER DATABASE TYPE - a group
// made while in Photos must not show up in Files or Links, so every group
// carries a `kind` and every screen only ever queries/creates its own.
export default function GroupPickerSheet({ visible, kind, groups, onPick, onClose }: Props) {
  const [newGroupName, setNewGroupName] = useState('');
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  const [editingGroupName, setEditingGroupName] = useState('');
  // This Android build doesn't resize the window under the keyboard
  // (edge-to-edge delivers it as an inset, not a resize - confirmed on
  // TasksScreen's own project-picker sheet, same bottom-sheet shape as
  // this one), so the "Нова група" input needs the same manual
  // Keyboard-height tracking to stay clear of it.
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  async function addGroup() {
    const name = newGroupName.trim();
    if (!name) return;
    const color = GROUP_COLORS[groups.length % GROUP_COLORS.length];
    await addDoc(groupsCollection, { name, color, ...groupKindFields([kind]) });
    setNewGroupName('');
  }

  function startEditGroup(group: Group) {
    setEditingGroupId(group.id);
    setEditingGroupName(group.name);
  }

  async function saveEditGroup() {
    const name = editingGroupName.trim();
    if (editingGroupId && name) {
      await updateDoc(doc(db, 'groups', editingGroupId), { name });
    }
    setEditingGroupId(null);
  }

  function confirmDeleteGroup(group: Group) {
    Alert.alert('Видалити групу?', `Об'єкти з групою "${group.name}" стануть без групи.`, [
      { text: 'Скасувати', style: 'cancel' },
      { text: 'Видалити', style: 'destructive', onPress: () => deleteDoc(doc(db, 'groups', group.id)) },
    ]);
  }

  return (
    <GlassLayer visible={visible} onClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        <Pressable style={[styles.sheet, { marginBottom: keyboardHeight }]} onPress={() => {}}>
          <View style={styles.handle} />
          <Text style={styles.title}>Групування</Text>

          <Pressable style={styles.row} onPress={() => onPick(null)}>
            <View style={[styles.dot, { backgroundColor: GLASS_TEXT_FAINT }]} />
            <Text style={styles.rowText}>Без групи</Text>
          </Pressable>

          {groups.map((g) =>
            editingGroupId === g.id ? (
              <View key={g.id} style={styles.row}>
                <View style={[styles.dot, { backgroundColor: g.color }]} />
                <TextInput
                  style={styles.renameInput}
                  value={editingGroupName}
                  onChangeText={setEditingGroupName}
                  autoFocus
                  onSubmitEditing={saveEditGroup}
                  onBlur={saveEditGroup}
                  returnKeyType="done"
                />
              </View>
            ) : (
              <View key={g.id} style={styles.row}>
                <Pressable style={styles.rowTap} onPress={() => onPick(g.id)}>
                  <View style={[styles.dot, { backgroundColor: g.color }]} />
                  <Text style={styles.rowText}>{g.name}</Text>
                </Pressable>
                <Pressable hitSlop={8} onPress={() => startEditGroup(g)}>
                  <Ionicons name="pencil-outline" size={16} color={GLASS_TEXT_FAINT} />
                </Pressable>
                {g.id !== CAMERA_PHOTOS_GROUP_ID && (
                  <Pressable hitSlop={8} onPress={() => confirmDeleteGroup(g)}>
                    <Ionicons name="close" size={16} color={GLASS_TEXT_FAINT} />
                  </Pressable>
                )}
              </View>
            )
          )}

          <View style={styles.divider} />

          <View style={styles.addRow}>
            <TextInput
              style={styles.addInput}
              value={newGroupName}
              onChangeText={setNewGroupName}
              placeholder="Нова група"
              onSubmitEditing={addGroup}
              returnKeyType="done"
            />
            <Pressable hitSlop={8} onPress={addGroup}>
              <Ionicons name="add-circle" size={26} color={ACCENT} />
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </GlassLayer>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: GLASS_BODY_BLURRED,
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
    backgroundColor: GLASS_LINE,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 17,
    fontWeight: '700',
    color: GLASS_TEXT,
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
    color: GLASS_TEXT,
  },
  renameInput: {
    flex: 1,
    fontSize: 15,
    color: GLASS_TEXT,
    paddingVertical: 2,
    borderBottomWidth: 1,
    borderBottomColor: ACCENT,
  },
  divider: {
    height: 1,
    backgroundColor: GLASS_LINE,
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
    color: GLASS_TEXT,
    backgroundColor: GLASS_INPUT,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
});
