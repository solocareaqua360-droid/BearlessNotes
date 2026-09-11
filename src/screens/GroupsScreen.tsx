import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { CustomDatabase, CustomDatabaseRow, Group } from '../types';
import { RootStackParamList } from '../navigation';
import RenamePrompt from '../components/RenamePrompt';
import GroupImportSheet from '../components/GroupImportSheet';
import { createBoardForGroup, importGroupToBoard } from '../utils/importGroupToBoard';
import { hapticSuccess } from '../utils/haptics';
import { groupKindFields, kindsOf, labelForKind } from '../utils/groups';
import { rowTitleOf } from '../utils/customRowDisplay';
import ContentColumn from '../components/ContentColumn';
import { GroupItem, useGroupItems } from '../hooks/useGroupItems';

const ACCENT = '#3B82F6';
const DANGER = '#EF4444';

// The temporary, cross-database side of this app's two filing systems (see
// the Group type): a group is whatever period of life is current, gathering
// items of every type for as long as it lasts, then archived once its
// contents have been filed away with tags. This screen is where a group is
// seen whole - every item it holds, across every database at once - which
// no single database screen can show.
export default function GroupsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // Gathering a group's contents is shared with the board, which can pull
  // a group onto itself directly - see useGroupItems.
  const {
    groups,
    itemsByGroup,
    customDatabases,
    customDatabaseNames,
    isLoading,
    titleForItem,
  } = useGroupItems();
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [renamingGroup, setRenamingGroup] = useState<Group | null>(null);
  const [kindsEditorGroup, setKindsEditorGroup] = useState<Group | null>(null);
  const [importingGroup, setImportingGroup] = useState<Group | null>(null);

  const activeGroups = groups.filter((g) => !g.archived);
  const archivedGroups = groups.filter((g) => g.archived);
  const openGroup = openGroupId ? groups.find((g) => g.id === openGroupId) ?? null : null;
  const openItems = openGroupId ? itemsByGroup[openGroupId] ?? [] : [];

  async function setArchived(group: Group, archived: boolean) {
    await updateDoc(doc(db, 'groups', group.id), { archived });
  }

  async function renameGroup(group: Group, name: string) {
    setRenamingGroup(null);
    await updateDoc(doc(db, 'groups', group.id), { name });
  }

  // Deleting a group never touches the items filed under it - they simply
  // stop being grouped, exactly as when a group is deleted from a database
  // screen's own picker.
  function confirmDelete(group: Group) {
    Alert.alert('Видалити групу?', `"${group.name}" — самі елементи залишаться на місці.`, [
      { text: 'Скасувати', style: 'cancel' },
      {
        text: 'Видалити',
        style: 'destructive',
        onPress: async () => {
          setOpenGroupId(null);
          await deleteDoc(doc(db, 'groups', group.id));
        },
      },
    ]);
  }

  async function toggleKind(group: Group, kind: string) {
    const current = kindsOf(group);
    const next = current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind];
    await updateDoc(doc(db, 'groups', group.id), groupKindFields(next));
    setKindsEditorGroup({ ...group, ...groupKindFields(next) });
  }

  async function runImport(
    group: Group,
    selected: GroupItem[],
    target: { boardId: string } | { newBoard: true }
  ) {
    setImportingGroup(null);
    const boardId = 'boardId' in target ? target.boardId : await createBoardForGroup(group.name);
    const added = await importGroupToBoard(
      boardId,
      group,
      selected.map((item) => ({
        id: item.id,
        kind: item.kind,
        title: titleForItem(item),
        databaseId: item.databaseId,
        data: item.data,
      })),
      (kind) => labelForKind(kind, customDatabaseNames)
    );
    setOpenGroupId(null);
    if (added > 0) hapticSuccess();
    Alert.alert(
      'Готово',
      added === 0
        ? 'Ці елементи вже є на дошці.'
        : `На дошку додано ${added} карток. Кожен тип — окремою колонкою.`
    );
  }

  function openItem(item: GroupItem) {
    if (item.kind === 'document') {
      navigation.navigate('Editor', { documentId: item.id });
    } else if (item.kind === 'photo') {
      navigation.navigate('Photos');
    } else if (item.kind === 'file') {
      navigation.navigate('Files');
    } else if (item.kind.startsWith('link-')) {
      const category = item.kind === 'link-video' ? 'video' : item.kind === 'link-geo' ? 'geo' : 'other';
      navigation.navigate('Links', { category });
    } else if (item.databaseId) {
      navigation.navigate('CustomDatabase', { databaseId: item.databaseId, openRowId: item.id });
    }
  }

  function renderGroupRow(group: Group) {
    const items = itemsByGroup[group.id] ?? [];
    const kinds = kindsOf(group);
    return (
      <Pressable key={group.id} style={styles.row} onPress={() => setOpenGroupId(group.id)}>
        <View style={[styles.colorDot, { backgroundColor: group.color || ACCENT }]} />
        <View style={styles.rowBody}>
          <Text style={styles.rowTitle} numberOfLines={1}>
            {group.name}
          </Text>
          <Text style={styles.rowMeta} numberOfLines={1}>
            {items.length === 0 ? 'Порожня' : `${items.length} елементів`}
            {kinds.length > 0 && ` · ${kinds.map((k) => labelForKind(k, customDatabaseNames)).join(', ')}`}
          </Text>
        </View>
        <Ionicons name="chevron-forward" size={16} color="rgba(255,255,255,0.5)" />
      </Pressable>
    );
  }

  return (
    <View style={styles.container}>
      <Svg
        width={windowWidth + 2}
        height={windowHeight + 2}
        style={[StyleSheet.absoluteFill, { top: -1, left: -1 }]}
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="groupsBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.03" stopColor="#705648" />
            <Stop offset="0.52" stopColor="#69736E" />
            <Stop offset="1" stopColor="#000000" />
          </LinearGradient>
        </Defs>
        <Rect width={windowWidth + 2} height={windowHeight + 2} fill="url(#groupsBg)" />
      </Svg>
      <ContentColumn>
        <View style={styles.headerRow}>
          <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.header}>Групи</Text>
        </View>

        {isLoading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : (
          <ScrollView contentContainerStyle={styles.list}>
            {activeGroups.length === 0 ? (
              <Text style={styles.emptyHint}>
                Групи створюються там, де ви їх використовуєте — у документах, фото, файлах чи власній базі.
              </Text>
            ) : (
              activeGroups.map(renderGroupRow)
            )}

            {archivedGroups.length > 0 && (
              <>
                <Pressable style={styles.archiveToggle} onPress={() => setShowArchived((v) => !v)}>
                  <Ionicons
                    name={showArchived ? 'chevron-down' : 'chevron-forward'}
                    size={15}
                    color="rgba(255,255,255,0.6)"
                  />
                  <Text style={styles.archiveToggleLabel}>Архівні ({archivedGroups.length})</Text>
                </Pressable>
                {showArchived && archivedGroups.map(renderGroupRow)}
              </>
            )}
          </ScrollView>
        )}

        <Modal visible={openGroup !== null} transparent animationType="fade" onRequestClose={() => setOpenGroupId(null)}>
          <View style={styles.backdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpenGroupId(null)} />
            <View style={styles.sheet}>
              <View style={styles.handle} />
              {openGroup && (
                <>
                  <View style={styles.sheetTitleRow}>
                    <View style={[styles.colorDot, { backgroundColor: openGroup.color || ACCENT }]} />
                    <Text style={styles.sheetTitle} numberOfLines={1}>
                      {openGroup.name}
                    </Text>
                  </View>

                  <View style={styles.actionRow}>
                    <Pressable style={styles.action} onPress={() => setRenamingGroup(openGroup)}>
                      <Ionicons name="pencil-outline" size={16} color="#111827" />
                      <Text style={styles.actionLabel}>Перейменувати</Text>
                    </Pressable>
                    <Pressable style={styles.action} onPress={() => setImportingGroup(openGroup)}>
                      <Ionicons name="apps-outline" size={16} color="#111827" />
                      <Text style={styles.actionLabel}>На дошку</Text>
                    </Pressable>
                    <Pressable style={styles.action} onPress={() => setKindsEditorGroup(openGroup)}>
                      <Ionicons name="albums-outline" size={16} color="#111827" />
                      <Text style={styles.actionLabel}>Бази</Text>
                    </Pressable>
                    <Pressable style={styles.action} onPress={() => setArchived(openGroup, !openGroup.archived)}>
                      <Ionicons
                        name={openGroup.archived ? 'arrow-undo-outline' : 'archive-outline'}
                        size={16}
                        color="#111827"
                      />
                      <Text style={styles.actionLabel}>{openGroup.archived ? 'Повернути' : 'Архівувати'}</Text>
                    </Pressable>
                    <Pressable style={styles.action} onPress={() => confirmDelete(openGroup)}>
                      <Ionicons name="trash-outline" size={16} color={DANGER} />
                      <Text style={[styles.actionLabel, { color: DANGER }]}>Видалити</Text>
                    </Pressable>
                  </View>

                  <ScrollView style={styles.itemList} keyboardShouldPersistTaps="handled">
                    {openItems.length === 0 ? (
                      <Text style={styles.sheetEmpty}>У цій групі поки нічого немає.</Text>
                    ) : (
                      openItems.map((item) => (
                        <Pressable
                          key={`${item.kind}:${item.id}`}
                          style={styles.itemRow}
                          onPress={() => {
                            setOpenGroupId(null);
                            openItem(item);
                          }}
                        >
                          <View style={styles.itemIcon}>
                            <Ionicons name={item.icon} size={16} color={ACCENT} />
                          </View>
                          <View style={styles.rowBody}>
                            <Text style={styles.itemTitle} numberOfLines={1}>
                              {titleForItem(item)}
                            </Text>
                            <Text style={styles.itemKind} numberOfLines={1}>
                              {labelForKind(item.kind, customDatabaseNames)}
                            </Text>
                          </View>
                        </Pressable>
                      ))
                    )}
                  </ScrollView>
                </>
              )}
            </View>
          </View>
        </Modal>

        <Modal
          visible={kindsEditorGroup !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setKindsEditorGroup(null)}
        >
          <View style={styles.backdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setKindsEditorGroup(null)} />
            <View style={styles.sheet}>
              <View style={styles.handle} />
              <Text style={styles.sheetTitle}>У яких базах показувати</Text>
              <ScrollView style={styles.itemList}>
                {[
                  'document',
                  'photo',
                  'file',
                  'link-video',
                  'link-geo',
                  'link-other',
                  ...customDatabases.map((d) => `customRow:${d.id}`),
                ].map((kind) => {
                  const on = kindsEditorGroup ? kindsOf(kindsEditorGroup).includes(kind) : false;
                  return (
                    <Pressable
                      key={kind}
                      style={styles.itemRow}
                      onPress={() => kindsEditorGroup && toggleKind(kindsEditorGroup, kind)}
                    >
                      <Ionicons
                        name={on ? 'checkbox' : 'square-outline'}
                        size={18}
                        color={on ? ACCENT : '#9CA3AF'}
                      />
                      <Text style={styles.itemTitle}>{labelForKind(kind, customDatabaseNames)}</Text>
                    </Pressable>
                  );
                })}
              </ScrollView>
            </View>
          </View>
        </Modal>

        <GroupImportSheet
          visible={importingGroup !== null}
          groupName={importingGroup?.name ?? ''}
          items={importingGroup ? (itemsByGroup[importingGroup.id] ?? []) : []}
          labelForKind={(kind) => labelForKind(kind, customDatabaseNames)}
          titleForItem={(item) => titleForItem(item as GroupItem)}
          onCancel={() => setImportingGroup(null)}
          onConfirm={(selected, target) => {
            if (importingGroup) runImport(importingGroup, selected as GroupItem[], target);
          }}
        />

        <RenamePrompt
          visible={renamingGroup !== null}
          title="Назва групи"
          initialValue={renamingGroup?.name ?? ''}
          onCancel={() => setRenamingGroup(null)}
          onSave={(name) => {
            if (renamingGroup) renameGroup(renamingGroup, name);
          }}
        />
      </ContentColumn>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 90,
    paddingBottom: 12,
  },
  header: {
    fontSize: 40,
    fontWeight: '700',
    color: '#fff',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyHint: {
    fontSize: 14,
    color: 'rgba(255,255,255,0.6)',
    textAlign: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 120,
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: 'rgba(20,20,20,0.35)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    padding: 14,
  },
  colorDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },
  rowMeta: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
  },
  archiveToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    marginTop: 8,
  },
  archiveToggleLabel: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.6)',
    fontWeight: '600',
  },
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
    maxHeight: '80%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  sheetTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  sheetTitle: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    flexShrink: 1,
  },
  actionRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 12,
    marginBottom: 4,
  },
  action: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#F9FAFB',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  actionLabel: {
    fontSize: 13,
    color: '#111827',
  },
  itemList: {
    flexShrink: 1,
    marginTop: 8,
  },
  sheetEmpty: {
    fontSize: 13,
    color: '#9CA3AF',
    paddingVertical: 16,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  itemIcon: {
    width: 32,
    height: 32,
    borderRadius: 8,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemTitle: {
    fontSize: 15,
    color: '#111827',
    flexShrink: 1,
  },
  itemKind: {
    fontSize: 12,
    color: '#9CA3AF',
  },
});
