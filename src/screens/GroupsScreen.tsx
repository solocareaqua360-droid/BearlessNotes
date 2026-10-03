import { useEffect, useMemo, useRef, useState } from 'react';
import { useTheme, useStyles } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
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
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  cancelAnimation,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
  type SharedValue,
} from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ScreenGround from '../components/ScreenGround';
import EdgeFade from '../components/EdgeFade';
import { CHROME_TOP } from '../constants/rail';
import { SoftSurfaceContext, useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';
import { useDockClearance } from '../navigation/dockGeometry';
import { Ionicons } from '../components/icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { collection, deleteDoc, doc, onSnapshot, orderBy, query, updateDoc } from '../firestore';
import { SHEET_BACKDROP, SHEET_WINDOW, PHONE_ONLY } from '../constants/glass';
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

const DANGER = '#EF4444';
const SIDE = 12;
const GAP = 6;
const MIN_NARROW = 40;
const MAX_NARROW = 64;
const NAME_H = 18;

function widthOf(i: number, focus: number, wide: number, narrow: number): number {
  'worklet';
  const t = Math.max(0, 1 - Math.abs(focus - i));
  return narrow + (wide - narrow) * t;
}

function elementsWord(count: number): string {
  const ten = count % 10;
  const hundred = count % 100;
  if (ten === 1 && hundred !== 11) return 'елемент';
  if (ten >= 2 && ten <= 4 && (hundred < 12 || hundred > 14)) return 'елементи';
  return 'елементів';
}

// The project's own colour, lighter - the far end of its card's gradient
// until a project can carry a picture of its own.
function lighten(hex: string, amount: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const v = parseInt(m[1], 16);
  const mix = (c: number) => Math.round(c + (255 - c) * amount);
  const r = mix((v >> 16) & 255);
  const g = mix((v >> 8) & 255);
  const b = mix(v & 255);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`;
}

// The temporary, cross-database side of this app's two filing systems (see
// the Group type, now shown everywhere as "Проект"): a project is whatever
// period of life is current, gathering items of every type for as long as
// it lasts, then archived once its contents have been filed away with
// tags. This screen is where a project is seen whole - every item it
// holds, across every database at once - which no single database screen
// can show.
export default function GroupsScreen({ inPane }: { inPane?: boolean } = {}) {
  const theme = useTheme();
  const accent = theme.sections.groups;
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
  const [renamingGroup, setRenamingGroup] = useState<Group | null>(null);
  const [kindsEditorGroup, setKindsEditorGroup] = useState<Group | null>(null);
  const [importingGroup, setImportingGroup] = useState<Group | null>(null);

  const activeGroups = groups.filter((g) => !g.archived);
  const archivedGroups = groups.filter((g) => g.archived);
  const openGroup = openGroupId ? groups.find((g) => g.id === openGroupId) ?? null : null;

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
      title: 'Видалити проект?',
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

  // THE ACCORDION (2026-10-04, the user's design, after the desks panel's
  // one): every project a tall card in a row, the one in front wide and the
  // others narrow with their names turned up; under it, the project's
  // contents by category. One number, `focus` (0..n-1, fractional while a
  // finger is on the row), drives both - the cards' widths and the pages
  // underneath, which move sideways one whole page per project. Swiping
  // the row is the only sideways move; the pages only scroll down.
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const dockClear = useDockClearance();
  const shownGroups = showArchived ? archivedGroups : activeGroups;
  const n = shownGroups.length;
  // Its OWN width (a pane is half a window) - from a frame that never
  // moves, so it is read once, not every swipe.
  const [W, setW] = useState(windowWidth);
  const focus = useSharedValue(0);
  const focusAtStart = useSharedValue(0);
  // The project the row has settled on: its page and its two neighbours
  // are drawn, the rest wait - mounting a page's cards mid-swipe is what
  // stutters.
  const [centre, setCentre] = useState(0);
  const settle = (index: number) => setCentre(index);
  // A swipe that ends over a card is not a tap on it (the browser's
  // pointer still finishes as a click there).
  const swipedAt = useRef(0);
  const markSwiped = () => {
    swipedAt.current = Date.now();
  };
  // A new list (archived shown or hidden): back to its first project.
  useEffect(() => {
    cancelAnimation(focus);
    focus.value = 0;
    setCentre(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);
  // A project gone (deleted, archived) - the focus stays on one there is.
  useEffect(() => {
    if (n > 0 && focus.value > n - 1) {
      focus.value = n - 1;
      setCentre(n - 1);
    }
  }, [n, focus]);

  const inner = W - SIDE * 2;
  const narrow = n > 1 ? Math.min(MAX_NARROW, Math.max(MIN_NARROW, (inner * 0.42 - n * GAP) / (n - 1))) : 0;
  const wide = n > 1 ? Math.max(150, inner - (n - 1) * (narrow + GAP)) : inner;
  const step = Math.max(70, wide - narrow + GAP);
  const cardH = Math.round(Math.min(280, Math.max(190, windowHeight * 0.28)));

  const scrub = useMemo(
    () =>
      Gesture.Pan()
        .enabled(n > 1)
        .activeOffsetX([-8, 8])
        .failOffsetY([-14, 14])
        .onBegin(() => {
          cancelAnimation(focus);
          focusAtStart.value = focus.value;
        })
        .onStart(() => {
          runOnJS(markSwiped)();
        })
        .onUpdate((e) => {
          focus.value = Math.min(n - 1, Math.max(0, focusAtStart.value - e.translationX / step));
        })
        .onEnd((e) => {
          runOnJS(markSwiped)();
          const target = Math.min(n - 1, Math.max(0, Math.round(focus.value - e.velocityX / (step * 6))));
          focus.value = withTiming(target, { duration: 260, easing: Easing.out(Easing.cubic) }, (done) => {
            if (done) runOnJS(settle)(target);
          });
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [n, step]
  );
  const goToCard = (index: number) => {
    focus.value = withTiming(index, { duration: 260, easing: Easing.out(Easing.cubic) }, (done) => {
      if (done) runOnJS(settle)(index);
    });
  };
  const centreRef = useRef(centre);
  centreRef.current = centre;

  // More projects than fit: the row moves along so the open one stays in view.
  const rowStyle = useAnimatedStyle(() => {
    let x = 0;
    let middle = 0;
    for (let i = 0; i < n; i++) {
      const w = widthOf(i, focus.value, wide, narrow);
      const t = Math.max(0, 1 - Math.abs(focus.value - i));
      middle += t * (x + w / 2);
      x += w + GAP;
    }
    const total = x - GAP;
    const shift = Math.max(0, Math.min(total - inner, middle - inner / 2));
    return { transform: [{ translateX: -shift }] };
  });
  const pagesStyle = useAnimatedStyle(() => ({ transform: [{ translateX: -focus.value * W }] }));

  const top = insets.top + CHROME_TOP + 8;
  return (
    <SoftSurfaceContext.Provider value={S}>
      <View style={styles.container} onLayout={(e) => setW(Math.round(e.nativeEvent.layout.width))}>
        <ScreenGround color={S.bg} />
        {isLoading ? (
          <View style={styles.emptyState}>
            <ActivityIndicator color={S.ink3} />
          </View>
        ) : (
          <View style={[styles.container, { paddingTop: top }]}>
            {n === 0 ? (
              <Text style={[styles.emptyHint, { color: S.ink3 }]}>
                {showArchived
                  ? 'Архівних проєктів немає.'
                  : 'Проекти створюються там, де ви їх використовуєте — у документах, фото, файлах, дошках чи власній базі.'}
              </Text>
            ) : (
              <GestureDetector gesture={scrub}>
                <View style={[styles.accordion, { height: cardH, marginHorizontal: SIDE }]} collapsable={false}>
                  <Animated.View style={[styles.accRow, rowStyle]}>
                    {shownGroups.map((group, i) => (
                      <ProjectCard
                        key={group.id}
                        index={i}
                        group={group}
                        count={(itemsByGroup[group.id] ?? []).length}
                        focus={focus}
                        wide={wide}
                        narrow={narrow}
                        height={cardH}
                        fallback={accent}
                        onTap={() => {
                          if (Date.now() - swipedAt.current < 350) return;
                          if (i === centreRef.current && Math.abs(focus.value - i) < 0.05) setOpenGroupId(group.id);
                          else goToCard(i);
                        }}
                      />
                    ))}
                  </Animated.View>
                </View>
              </GestureDetector>
            )}

            <View style={styles.dotsRow}>
              <View style={styles.dots}>
                {n > 1 && shownGroups.map((group, i) => <Dot key={group.id} index={i} focus={focus} color={S.ink} />)}
              </View>
              {(archivedGroups.length > 0 || showArchived) && (
                <Pressable
                  onPress={() => setShowArchived((v) => !v)}
                  style={({ pressed }) => [styles.archivePill, { backgroundColor: pressed || showArchived ? S.fill : 'transparent' }]}
                  accessibilityLabel={showArchived ? 'Активні проєкти' : 'Архівні проєкти'}
                >
                  <Ionicons name={showArchived ? 'arrow-undo-outline' : 'archive-outline'} size={15} color={S.ink2} />
                  <Text style={[styles.archivePillLabel, { color: S.ink2 }]}>
                    {showArchived ? 'Активні' : archivedGroups.length}
                  </Text>
                </Pressable>
              )}
            </View>

            <View style={styles.pagesClip}>
              <Animated.View style={[styles.pages, { width: W * Math.max(1, n) }, pagesStyle]}>
                {shownGroups.map((group, i) => (
                  <View key={group.id} style={{ width: W }}>
                    {Math.abs(i - centre) <= 1 && (
                      <ScrollView
                        contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: dockClear + insets.bottom + 24 }}
                        showsVerticalScrollIndicator={false}
                      >
                        {(itemsByGroup[group.id] ?? []).length === 0 ? (
                          <Text style={[styles.pageEmpty, { color: S.ink3 }]}>У цьому проєкті ще нічого немає.</Text>
                        ) : (
                          <GroupSections
                            groupId={group.id}
                            // Nothing is "the current database" here.
                            currentKind=""
                            tags={tags}
                            items={itemsByGroup[group.id] ?? []}
                            databases={customDatabases}
                          />
                        )}
                      </ScrollView>
                    )}
                  </View>
                ))}
              </Animated.View>
            </View>
            <EdgeFade edge="bottom" color={S.bg} height={Math.round((dockClear + insets.bottom) * 0.85)} />
          </View>
        )}
        <EdgeFade edge="top" color={S.bg} height={insets.top + CHROME_TOP} />

        <Modal visible={openGroup !== null} transparent animationType="fade" onRequestClose={() => setOpenGroupId(null)}>
          <View style={styles.backdrop}>
            <Pressable style={StyleSheet.absoluteFill} onPress={() => setOpenGroupId(null)} />
            <View style={styles.sheet}>
              <View style={styles.handle} />
              {openGroup && (
                <>
                  <View style={styles.sheetTitleRow}>
                    <View style={[styles.colorDot, { backgroundColor: openGroup.color || accent }]} />
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
                  'board',
                  'task',
                  'flashcard',
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
                        color={on ? accent : theme.ink.faint}
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
          title="Назва проекту"
          initialValue={renamingGroup?.name ?? ''}
          onCancel={() => setRenamingGroup(null)}
          onSave={(name) => {
            if (renamingGroup) renameGroup(renamingGroup, name);
          }}
        />
      </View>
    </SoftSurfaceContext.Provider>
  );
}

function ProjectCard({
  index,
  group,
  count,
  focus,
  wide,
  narrow,
  height,
  fallback,
  onTap,
}: {
  index: number;
  group: Group;
  count: number;
  focus: SharedValue<number>;
  wide: number;
  narrow: number;
  height: number;
  fallback: string;
  onTap: () => void;
}) {
  const color = group.color || fallback;
  const gradientId = `project${group.id.replace(/[^A-Za-z0-9]/g, '')}`;
  const cardStyle = useAnimatedStyle(() => ({ width: widthOf(index, focus.value, wide, narrow) }));
  const shadeStyle = useAnimatedStyle(() => {
    const t = Math.max(0, 1 - Math.abs(focus.value - index));
    return { opacity: 0.32 - 0.25 * t };
  });
  const countStyle = useAnimatedStyle(() => ({ opacity: Math.max(0, 1 - Math.abs(focus.value - index)) }));
  // Horizontal on the open card, turned up on its edge as it shuts - see
  // DeskSwitcher's same name.
  const nameStyle = useAnimatedStyle(() => {
    const t = Math.max(0, 1 - Math.abs(focus.value - index));
    const w = widthOf(index, focus.value, wide, narrow);
    const shut = (w + NAME_H) / 2;
    // As long as the card is tall once turned up, as wide as the card
    // while it lies flat - a long name ends in "…", not under the edge.
    return {
      left: 14 + (1 - t) * (shut - 14),
      width: (height - 28) * (1 - t) + Math.max(0, w - 28) * t,
      transform: [{ rotate: `${-90 * (1 - t)}deg` }],
    };
  });
  return (
    <Animated.View style={[cardStyles.card, { height }, cardStyle]}>
      <Pressable style={StyleSheet.absoluteFill} onPress={onTap} accessibilityLabel={group.name}>
        {/* A fixed-width picture, centred: a narrow card is a slit onto it. */}
        <View style={[cardStyles.picture, { width: wide, marginLeft: -wide / 2 }]} pointerEvents="none">
          <Svg width="100%" height="100%">
            <Defs>
              <LinearGradient id={gradientId} x1="0" y1="0" x2="0.55" y2="1">
                <Stop offset="0" stopColor={color} />
                <Stop offset="1" stopColor={lighten(color, 0.45)} />
              </LinearGradient>
            </Defs>
            <Rect width="100%" height="100%" fill={`url(#${gradientId})`} />
          </Svg>
        </View>
        <Animated.View style={[StyleSheet.absoluteFill, cardStyles.shade, shadeStyle]} pointerEvents="none" />
        <Animated.Text style={[cardStyles.count, countStyle]} numberOfLines={1} pointerEvents="none">
          {count === 0 ? 'Порожній' : `${count} ${elementsWord(count)}`}
        </Animated.Text>
        <Animated.View style={[cardStyles.name, nameStyle]} pointerEvents="none">
          <Text style={cardStyles.nameText} numberOfLines={1}>
            {group.name}
          </Text>
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

function Dot({ index, focus, color }: { index: number; focus: SharedValue<number>; color: string }) {
  const style = useAnimatedStyle(() => {
    const t = Math.max(0, 1 - Math.abs(focus.value - index));
    return { width: 5 + 9 * t, opacity: 0.3 + 0.6 * t };
  });
  return <Animated.View style={[cardStyles.dot, { backgroundColor: color }, style]} />;
}

const cardStyles = StyleSheet.create({
  card: { borderRadius: 22, overflow: 'hidden' },
  picture: { position: 'absolute', top: 0, bottom: 0, left: '50%' },
  shade: { backgroundColor: '#000' },
  count: {
    position: 'absolute',
    left: 14,
    top: 12,
    right: 14,
    color: 'rgba(255,255,255,0.92)',
    fontSize: 12.5,
    fontFamily: SOFT_MEDIUM,
  },
  // A long box of its own (the card's height), anchored at the bottom-left
  // corner: turned up, the name runs up the card's edge from there.
  name: { position: 'absolute', left: 14, bottom: 14, transformOrigin: 'left bottom' } as never,
  nameText: {
    color: '#fff',
    fontSize: 16,
    lineHeight: NAME_H,
    fontFamily: SOFT_SEMIBOLD,
    textShadowColor: 'rgba(0,0,0,0.35)',
    textShadowRadius: 4,
    textShadowOffset: { width: 0, height: 1 },
  },
  dot: { height: 5, borderRadius: 3 },
});

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
  accordion: {
    overflow: 'hidden',
  },
  accRow: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 0,
    flexDirection: 'row',
    gap: GAP,
  },
  dotsRow: {
    height: 34,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dots: {
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
  },
  archivePill: {
    position: 'absolute',
    right: SIDE,
    top: 3,
    height: 28,
    paddingHorizontal: 10,
    borderRadius: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  archivePillLabel: {
    fontSize: 13,
    fontFamily: SOFT_MEDIUM,
  },
  pagesClip: {
    flex: 1,
    overflow: 'hidden',
  },
  pages: {
    flexDirection: 'row',
    flex: 1,
  },
  pageEmpty: {
    fontSize: 14,
    fontFamily: SOFT_MEDIUM,
    paddingVertical: 30,
    paddingHorizontal: 4,
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
    backgroundColor: t.scrim,
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
    backgroundColor: t.scrim,
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
    ...PHONE_ONLY,
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
