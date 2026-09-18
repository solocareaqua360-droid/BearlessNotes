import { useEffect, useState } from 'react';
import { useTheme, useStyles } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import PlainScreenShell, { shellClear } from '../components/PlainScreenShell';
import { useDockLeave } from '../navigation/navDock';
import { useIsFocused } from '@react-navigation/native';
import {
  ActivityIndicator,
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
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from '../firestore';
import { SHEET_BACKDROP, SHEET_WINDOW } from '../constants/glass';
import { db } from '../firebase';
import { CustomDatabase, CustomDatabaseRow, Group } from '../types';
import { RootStackParamList } from '../navigation';
import RenamePrompt from '../components/RenamePrompt';
import GroupImportSheet from '../components/GroupImportSheet';
import { createBoardForGroup, importGroupToBoard } from '../utils/importGroupToBoard';
import { hapticSuccess } from '../utils/haptics';
import { groupKindFields, kindsOf, labelForKind } from '../utils/groups';
import { rowTitleOf } from '../utils/customRowDisplay';
import { GroupItem, useGroupItems } from '../hooks/useGroupItems';
import GroupSections from '../components/GroupSections';
import { useTags } from '../hooks/useTags';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { confirm, notify } from '../components/surfaces/Ask';

const ACCENT = '#69736E';
const DANGER = '#EF4444';

// The temporary, cross-database side of this app's two filing systems (see
// the Group type): a group is whatever period of life is current, gathering
// items of every type for as long as it lasts, then archived once its
// contents have been filed away with tags. This screen is where a group is
// seen whole - every item it holds, across every database at once - which
// no single database screen can show.
export default function GroupsScreen({ inPane }: { inPane?: boolean } = {}) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
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
  // Only for the chips the cards carry - the drawer's own tag tree is a
  // different thing entirely.
  const { tags } = useTags();
  const isFocused = useIsFocused();
  useDockLeave('albums-outline', () => navigation.goBack(), isFocused);
  const [openGroupId, setOpenGroupId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const railSide = inPane ? ('left' as const) : ('right' as const);
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
    confirm({
      title: 'Видалити групу?',
      message: `"${group.name}" — самі елементи залишаться на місці.`,
      confirmLabel: 'Видалити',
    }).then(async (yes) => {
      if (!yes) return;
      setOpenGroupId(null);
      await deleteDoc(doc(db, 'groups', group.id));
    });
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
    notify('Готово', added === 0
        ? 'Ці елементи вже є на дошці.'
        : `На дошку додано ${added} карток. Кожен тип — окремою колонкою.`);
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
    <PlainScreenShell id="groupsBg">
        {isLoading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color="#fff" />
          </View>
        ) : (
          <ScrollView contentContainerStyle={[styles.list, shellClear(railSide, 4)]}>
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
                      <Ionicons name="pencil-outline" size={16} color={theme.ink.primary} />
                      <Text style={styles.actionLabel}>Перейменувати</Text>
                    </Pressable>
                    <Pressable style={styles.action} onPress={() => setImportingGroup(openGroup)}>
                      <Ionicons name="apps-outline" size={16} color={theme.ink.primary} />
                      <Text style={styles.actionLabel}>На дошку</Text>
                    </Pressable>
                    <Pressable style={styles.action} onPress={() => setKindsEditorGroup(openGroup)}>
                      <Ionicons name="albums-outline" size={16} color={theme.ink.primary} />
                      <Text style={styles.actionLabel}>Бази</Text>
                    </Pressable>
                    <Pressable style={styles.action} onPress={() => setArchived(openGroup, !openGroup.archived)}>
                      <Ionicons
                        name={openGroup.archived ? 'arrow-undo-outline' : 'archive-outline'}
                        size={16}
                        color={theme.ink.primary}
                      />
                      <Text style={styles.actionLabel}>{openGroup.archived ? 'Повернути' : 'Архівувати'}</Text>
                    </Pressable>
                    <Pressable style={styles.action} onPress={() => confirmDelete(openGroup)}>
                      <Ionicons name="trash-outline" size={16} color={DANGER} />
                      <Text style={[styles.actionLabel, { color: DANGER }]}>Видалити</Text>
                    </Pressable>
                  </View>

                  {/* What is in the group, drawn as the cards each
                      database draws at home - see GroupSections. It was a
                      column of grey rows with a generic icon each, which
                      said the kind of thing and nothing about the thing
                      itself. */}
                  <ScrollView style={styles.itemList} keyboardShouldPersistTaps="handled">
                    {openItems.length === 0 ? (
                      <Text style={styles.sheetEmpty}>У цій групі поки нічого немає.</Text>
                    ) : (
                      <GroupSections
                        groupId={openGroupId}
                        // Nothing is "the current database" here: this is
                        // the group's own view, so every section belongs.
                        currentKind=""
                        tags={tags}
                        onOpen={() => setOpenGroupId(null)}
                      />
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
                        color={on ? ACCENT : theme.ink.faint}
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
    </PlainScreenShell>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
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
    fontFamily: FONT_BOLD,
    color: '#fff',
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyHint: {
    fontSize: 14,
    fontFamily: FONT_REGULAR,
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
    fontFamily: FONT_SEMIBOLD,
    color: '#fff',
  },
  rowMeta: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
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
    fontFamily: FONT_SEMIBOLD,
  },
  backdrop: {
    backgroundColor: 'rgba(17,24,39,0.45)',
    ...SHEET_BACKDROP,
  },
  sheet: {
    backgroundColor: t.surface,
    ...SHEET_WINDOW,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
    maxHeight: '80%',
  },
  handle: {
    width: 36,
    height: 4,
    backgroundColor: 'rgba(255,255,255,0.3)',
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
    fontFamily: FONT_BOLD,
    color: t.ink.primary,
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
    backgroundColor: t.surface,
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  actionLabel: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
  },
  itemList: {
    flexShrink: 1,
    marginTop: 8,
  },
  sheetEmpty: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
    paddingVertical: 16,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 10,
  },
  itemTitle: {
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
    flexShrink: 1,
  },
  });
