import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector, ScrollView } from 'react-native-gesture-handler';
import Animated, { runOnJS, useAnimatedStyle, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from './icons/Ionicons';
import CustomRowBlockCard from './CustomRowBlockCard';
import { doc, onSnapshot } from '../firestore';
import { db } from '../firebase';
import { ownedQuery } from '../utils/owned';
import { listenError } from '../utils/listenError';
import { rowTitleOf } from '../utils/customRowDisplay';
import { blockFromCustomRow } from '../utils/copyToNote';
import { useDensity } from '../hooks/useDensity';
import { useReferenceDrag } from '../hooks/useReferenceDrag';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';
import { BoardFieldsContext } from './boardFieldsContext';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import type { Block, BoardDbWindow, CustomDatabase, CustomDatabaseRow, FieldDef } from '../types';

// A DATABASE, HELD OPEN ON A BOARD - the user's own design (2026-09-29):
// "розмістити на дошці вікно, з якої можна просто робити копію на дошці",
// so the database itself is never moved about and scattered.
//
// A floating window over the board (screen space: it does not scale with
// the canvas), that can be dragged by its header, folded into a circle and
// opened again. What it lists is chosen by hand - a filter by a field, then
// ticks - and kept on the board. A record leaves it as a COPY: held and
// dragged onto the canvas (or into a column), or tapped «+».
//
// It is a catalogue, not an original: the first card a record gets on the
// board becomes that record's original there (see BoardScreen's origin
// lines), and each row says how many times it is already placed - a tap on
// that count lights those cards up.

const WIDTH = 300;
// A pinned window is a side panel: a little wider, the whole height.
const DOCKED_WIDTH = 340;
const CIRCLE = 56;

export type BoardWindowProps = {
  win: BoardDbWindow;
  // recordId -> how many cards of it are on the board.
  placed: Map<string, number>;
  onChange: (patch: Partial<BoardDbWindow>) => void;
  onClose: () => void;
  // A record put on the board: at a screen point (a drop), or with none -
  // the middle of what is on screen (the «+»).
  onPlace: (block: Block, at: { x: number; y: number } | null, respond?: (accepted: boolean) => void) => void;
  // "Show me where this record stands on the board."
  onFind: (recordId: string) => void;
  // Called every move of a carried row (so the board can light the column
  // it would fall into) and when it ends.
  onCarryMove?: (screenX: number, screenY: number) => void;
  onCarryEnd?: () => void;
  // The board's own size. A window is placed inside the board, which on a
  // laptop is not the whole window (the sidebar takes a third of it), so
  // the window's size would put it off the right edge.
  bounds?: { width: number; height: number };
};

export default function BoardDatabaseWindow({ win, placed, onChange, onClose, onPlace, onFind, onCarryMove, onCarryEnd, bounds }: BoardWindowProps) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const dims = useWindowDimensions();
  const windowW = bounds?.width ?? dims.width;
  const windowH = bounds?.height ?? dims.height;
  const [database, setDatabase] = useState<CustomDatabase | null>(null);
  const [rows, setRows] = useState<CustomDatabaseRow[]>([]);
  const [settings, setSettings] = useState(false);
  // The settings have two pages: which records are listed, and which fields
  // the cards show - here and on the board.
  const [settingsTab, setSettingsTab] = useState<'records' | 'fields'>('records');
  const [fieldId, setFieldId] = useState<string | null>(null);
  const [valueId, setValueId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  // Find by name in the list itself - "листати список, поки там машин 60,
  // ... просто підійметься клавіатура, знайшов, додав".
  const [listQuery, setListQuery] = useState('');
  const keyboardH = useKeyboardHeight();

  useEffect(
    () =>
      onSnapshot(
        doc(db, 'customDatabases', win.databaseId),
        (snapshot) =>
          setDatabase(snapshot.exists() ? ({ id: snapshot.id, ...(snapshot.data() as Omit<CustomDatabase, 'id'>) } as CustomDatabase) : null),
        listenError('BoardDatabaseWindow:database')
      ),
    [win.databaseId]
  );
  useEffect(
    () =>
      onSnapshot(
        ownedQuery('customDatabaseRows'),
        (snapshot) =>
          setRows(
            snapshot.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<CustomDatabaseRow, 'id'>) }))
              .filter((r) => r.databaseId === win.databaseId)
          ),
        listenError('BoardDatabaseWindow:rows')
      ),
    [win.databaseId]
  );

  const titled = useMemo(
    () => rows.map((row) => ({ row, title: rowTitleOf(database, row) })).sort((a, b) => a.title.localeCompare(b.title)),
    [rows, database]
  );
  const chosen = useMemo(() => (win.chosen ? new Set(win.chosen) : null), [win.chosen]);
  const listNeedle = listQuery.trim().toLowerCase();
  const shown = titled.filter(
    ({ row, title }) => (!chosen || chosen.has(row.id)) && (!listNeedle || title.toLowerCase().includes(listNeedle))
  );

  // Held and dragged out: the block is the record; the board makes the
  // card where it is let go.
  const drag = useReferenceDrag({
    onDrop: (block, x, y, respond) => onPlace(block, { x, y }, respond),
    onMove: onCarryMove,
    onFinished: onCarryEnd,
  });

  // ---- the window's own place -------------------------------------------
  const startX = Math.max(8, Math.min(win.x, windowW - (win.collapsed ? CIRCLE : WIDTH) - 8));
  const startY = Math.max(insets.top + 8, win.y);
  const posX = useSharedValue(startX);
  const posY = useSharedValue(startY);
  const baseX = useSharedValue(startX);
  const baseY = useSharedValue(startY);
  useEffect(() => {
    posX.value = startX;
    posY.value = startY;
    baseX.value = startX;
    baseY.value = startY;
  }, [startX, startY, win.collapsed, posX, posY, baseX, baseY]);
  const moved = useCallback(
    (x: number, y: number) => onChange({ x: Math.round(x), y: Math.round(y) }),
    [onChange]
  );
  const pointer = useDensity() === 'pointer';
  const collapsed = !!win.collapsed;
  const docked = pointer && !!win.docked && !collapsed;
  const toggleDocked = useCallback(() => onChange({ docked: !win.docked }), [onChange, win.docked]);
  const toggleCollapsed = useCallback(() => onChange({ collapsed: !collapsed }), [onChange, collapsed]);
  const maxX = windowW - (collapsed ? CIRCLE : WIDTH) - 8;
  const maxY = windowH - (collapsed ? CIRCLE : 120) - 8;
  const pan = Gesture.Pan()
    .enabled(!docked)
    .minDistance(6)
    .onChange((e) => {
      posX.value = Math.max(8, Math.min(maxX, posX.value + e.changeX));
      posY.value = Math.max(8, Math.min(maxY, posY.value + e.changeY));
    })
    .onEnd(() => {
      runOnJS(moved)(posX.value, posY.value);
    });
  const tap = Gesture.Tap().onEnd((_e, success) => {
    if (success && collapsed) runOnJS(toggleCollapsed)();
  });
  const headerGesture = Gesture.Race(pan, tap);
  // With the keyboard up the window goes to the top of the screen and takes
  // only the room above the keyboard, so the list and the search field are
  // both in sight.
  const lifted = keyboardH > 0 && !collapsed;
  const liftedTop = insets.top + 8;
  const frameStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: posX.value }, { translateY: lifted ? liftedTop : posY.value }],
  }));

  const totalPlaced = [...placed.values()].reduce((a, b) => a + b, 0);
  const baseHeight = Math.min(Math.round(windowH * 0.5), 440);
  const height = lifted ? Math.max(200, Math.min(windowH - keyboardH - liftedTop - 8, windowH * 0.9)) : baseHeight;

  // ---- settings: the filter and the ticks ------------------------------------
  const filterFields: FieldDef[] = (database?.fields ?? []).filter(
    (f, index) => index > 0 && (f.type === 'select' || f.type === 'multiSelect') && (f.options?.length ?? 0) > 0
  );
  const activeField = filterFields.find((f) => f.id === fieldId) ?? null;
  const matchesValue = (row: CustomDatabaseRow) => {
    if (!activeField || !valueId) return true;
    const value = row.values?.[activeField.id];
    return Array.isArray(value) ? value.includes(valueId) : value === valueId;
  };
  const needle = query.trim().toLowerCase();
  const listed = titled.filter(({ row, title }) => matchesValue(row) && (!needle || title.toLowerCase().includes(needle)));
  const allIds = titled.map(({ row }) => row.id);
  const currentIds = win.chosen ?? allIds;
  const listedIds = listed.map(({ row }) => row.id);
  const setChosen = (ids: string[]) => onChange({ chosen: ids.length === allIds.length ? null : ids });
  const toggleOne = (id: string) => {
    const set = new Set(currentIds);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    setChosen([...set]);
  };

  const chip = (label: string, active: boolean, onPress: () => void, key: string, color?: string) => (
    <Pressable
      key={key}
      onPress={onPress}
      style={[styles.chip, { backgroundColor: active ? S.ink : S.fillSolid }]}
    >
      {color ? <View style={[styles.dot, { backgroundColor: color }]} /> : null}
      <Text style={[styles.chipLabel, { color: active ? S.bg : S.ink2 }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );

  // Fields of the database that can be shown on a card (not the name - it
  // is always there - and not the layout-only kinds).
  const cardFields: FieldDef[] = (database?.fields ?? []).filter((f, index) => index > 0 && f.type !== 'section');
  const hiddenNow = win.hiddenFieldIds ?? cardFields.filter((f) => f.hidden).map((f) => f.id);
  const setHiddenFields = (ids: string[]) => onChange({ hiddenFieldIds: ids });
  const toggleField = (id: string) =>
    setHiddenFields(hiddenNow.includes(id) ? hiddenNow.filter((x) => x !== id) : [...hiddenNow, id]);

  const ghost = drag.ghost;

  return (
    <>
      <Animated.View
        style={[
          styles.frame,
          collapsed
            ? { width: CIRCLE, height: CIRCLE, borderRadius: CIRCLE / 2, backgroundColor: S.chrome, boxShadow: S.popShadow }
            : docked
              ? { width: DOCKED_WIDTH, left: 'auto', right: 8, top: insets.top + 8, bottom: 8, borderRadius: 26, backgroundColor: S.card, boxShadow: S.popShadow }
              : { width: WIDTH, height, borderRadius: 26, backgroundColor: S.card, boxShadow: S.popShadow },
          !docked && frameStyle,
        ]}
      >
        {collapsed ? (
          <GestureDetector gesture={headerGesture}>
            <View style={styles.circle} accessibilityLabel={database?.name ?? 'База'}>
              <Ionicons name={((database?.icon as never) ?? 'grid-outline') as never} size={24} color={S.ink} />
              {totalPlaced > 0 && (
                <View style={[styles.badge, { backgroundColor: S.accent }]}>
                  <Text style={styles.badgeText}>{totalPlaced}</Text>
                </View>
              )}
            </View>
          </GestureDetector>
        ) : (
          <>
            <GestureDetector gesture={headerGesture}>
              <View style={styles.header}>
                <Ionicons name={((database?.icon as never) ?? 'grid-outline') as never} size={18} color={S.ink2} />
                <Text style={[styles.title, { color: S.ink }]} numberOfLines={1}>
                  {database?.name ?? 'База'}
                </Text>
                <Text style={[styles.count, { color: S.ink3 }]}>
                  {shown.length}
                  {chosen ? `/${titled.length}` : ''}
                </Text>
                {pointer && (
                  <Pressable hitSlop={8} onPress={toggleDocked} style={styles.headerButton} accessibilityLabel={docked ? 'Відкріпити' : 'Закріпити збоку'}>
                    <Ionicons name="pin" size={19} color={docked ? S.accent : S.ink2} />
                  </Pressable>
                )}
                <Pressable hitSlop={8} onPress={() => setSettings((v) => !v)} style={styles.headerButton} accessibilityLabel="Параметри вікна">
                  <Ionicons name={settings ? 'checkmark' : 'options-outline'} size={20} color={settings ? S.accent : S.ink2} />
                </Pressable>
                <Pressable hitSlop={8} onPress={toggleCollapsed} style={styles.headerButton} accessibilityLabel="Згорнути">
                  <Ionicons name="remove" size={20} color={S.ink2} />
                </Pressable>
                <Pressable hitSlop={8} onPress={onClose} style={styles.headerButton} accessibilityLabel="Закрити вікно">
                  <Ionicons name="close" size={20} color={S.ink2} />
                </Pressable>
              </View>
            </GestureDetector>

            {settings ? (
              <View style={styles.body}>
                <View style={styles.tabs}>
                  {chip('Записи', settingsTab === 'records', () => setSettingsTab('records'), 'tab-records')}
                  {chip('Поля на картках', settingsTab === 'fields', () => setSettingsTab('fields'), 'tab-fields')}
                </View>
                {settingsTab === 'fields' ? (
                  <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
                    <Text style={[styles.hint, { color: S.ink3 }]}>
                      Що показувати на картках - у цьому вікні й на дошці. У самій базі це не міняється.
                    </Text>
                    {cardFields.map((f) => {
                      const on = !hiddenNow.includes(f.id);
                      return (
                        <Pressable key={f.id} style={styles.tickRow} onPress={() => toggleField(f.id)}>
                          <View style={[styles.tick, on ? { backgroundColor: S.accent, borderColor: S.accent } : { borderColor: S.ink3 }]}>
                            {on && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                          </View>
                          <Text style={[styles.tickLabel, { color: S.ink }]} numberOfLines={1}>
                            {f.name}
                          </Text>
                        </Pressable>
                      );
                    })}
                    <View style={styles.bulk}>
                      <Pressable style={[styles.bulkButton, { backgroundColor: S.fillSolid }]} onPress={() => setHiddenFields([])}>
                        <Text style={[styles.bulkLabel, { color: S.ink }]}>Усі</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.bulkButton, { backgroundColor: S.fillSolid }]}
                        onPress={() => setHiddenFields(cardFields.map((f) => f.id))}
                      >
                        <Text style={[styles.bulkLabel, { color: S.ink }]}>Лише назва</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.bulkButton, { backgroundColor: S.fillSolid }]}
                        onPress={() => onChange({ hiddenFieldIds: undefined })}
                      >
                        <Text style={[styles.bulkLabel, { color: S.ink }]}>Як у базі</Text>
                      </Pressable>
                    </View>
                  </ScrollView>
                ) : (
                <>
                {filterFields.length > 0 && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
                    {chip('Усі', activeField === null, () => {
                      setFieldId(null);
                      setValueId(null);
                    }, '__all__')}
                    {filterFields.map((f) => chip(f.name, activeField?.id === f.id, () => {
                      setFieldId(f.id);
                      setValueId(null);
                    }, f.id))}
                  </ScrollView>
                )}
                {activeField && (
                  <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipScroll} contentContainerStyle={styles.chipRow}>
                    {(activeField.options ?? []).map((option) =>
                      chip(option.label, valueId === option.id, () => setValueId(valueId === option.id ? null : option.id), option.id, option.color)
                    )}
                  </ScrollView>
                )}
                <View style={[styles.search, { backgroundColor: S.fill }]}>
                  <Ionicons name="search" size={16} color={S.ink3} />
                  <TextInput
                    value={query}
                    onChangeText={setQuery}
                    placeholder="Знайти"
                    placeholderTextColor={S.ink3}
                    style={[styles.searchInput, { color: S.ink }]}
                  />
                </View>
                <View style={styles.bulk}>
                  <Pressable style={[styles.bulkButton, { backgroundColor: S.fillSolid }]} onPress={() => setChosen(listedIds)}>
                    <Text style={[styles.bulkLabel, { color: S.ink }]}>Лише ці</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.bulkButton, { backgroundColor: S.fillSolid }]}
                    onPress={() => setChosen([...new Set([...currentIds, ...listedIds])])}
                  >
                    <Text style={[styles.bulkLabel, { color: S.ink }]}>Додати ці</Text>
                  </Pressable>
                  <Pressable
                    style={[styles.bulkButton, { backgroundColor: S.fillSolid }]}
                    onPress={() => {
                      const drop = new Set(listedIds);
                      setChosen(currentIds.filter((id) => !drop.has(id)));
                    }}
                  >
                    <Text style={[styles.bulkLabel, { color: S.ink }]}>Прибрати ці</Text>
                  </Pressable>
                </View>
                <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
                  {listed.map(({ row, title }) => {
                    const on = currentIds.includes(row.id);
                    return (
                      <Pressable key={row.id} style={styles.tickRow} onPress={() => toggleOne(row.id)}>
                        <View style={[styles.tick, on ? { backgroundColor: S.accent, borderColor: S.accent } : { borderColor: S.ink3 }]}>
                          {on && <Ionicons name="checkmark" size={14} color="#FFFFFF" />}
                        </View>
                        <Text style={[styles.tickLabel, { color: S.ink }]} numberOfLines={1}>
                          {title}
                        </Text>
                      </Pressable>
                    );
                  })}
                  {listed.length === 0 && <Text style={[styles.empty, { color: S.ink3 }]}>Нічого не знайдено</Text>}
                </ScrollView>
                </>
                )}
              </View>
            ) : (
              <GestureDetector gesture={drag.gesture}>
                <View style={styles.body}>
                  <View style={[styles.search, { backgroundColor: S.fill }]}>
                    <Ionicons name="search" size={16} color={S.ink3} />
                    <TextInput
                      value={listQuery}
                      onChangeText={setListQuery}
                      placeholder="Пошук за назвою"
                      placeholderTextColor={S.ink3}
                      style={[styles.searchInput, { color: S.ink }]}
                      returnKeyType="search"
                    />
                    {listQuery.length > 0 && (
                      <Pressable hitSlop={8} onPress={() => setListQuery('')} accessibilityLabel="Очистити пошук">
                        <Ionicons name="close" size={16} color={S.ink3} />
                      </Pressable>
                    )}
                  </View>
                  {!listQuery && !lifted && (
                    <Text style={[styles.hint, { color: S.ink3 }]}>Затисни картку й перетягни на дошку, або тапни «+»</Text>
                  )}
                  <ScrollView style={styles.list} contentContainerStyle={styles.listContent} keyboardShouldPersistTaps="handled">
                    {shown.map(({ row, title }) => {
                      const block = blockFromCustomRow({ id: row.id, databaseId: win.databaseId, title, createdAt: row.createdAt });
                      const times = placed.get(row.id) ?? 0;
                      return (
                        <View key={row.id} style={styles.rowWrap}>
                          <View ref={drag.registerRow(`win-${win.id}-${row.id}`, () => block, title)} collapsable={false}>
                            <View pointerEvents="none">
                              <BoardFieldsContext.Provider value={win.hiddenFieldIds ? { [win.databaseId]: win.hiddenFieldIds } : {}}>
                                <CustomRowBlockCard databaseId={win.databaseId} rowId={row.id} fallbackTitle={title} tags={[]} onOpen={() => {}} />
                              </BoardFieldsContext.Provider>
                            </View>
                          </View>
                          <View style={styles.rowTools}>
                            {times > 0 && (
                              <Pressable
                                hitSlop={6}
                                onPress={() => onFind(row.id)}
                                style={[styles.timesPill, { backgroundColor: S.accent }]}
                                accessibilityLabel="Де вона на дошці"
                              >
                                <Text style={styles.timesText}>×{times}</Text>
                              </Pressable>
                            )}
                            <Pressable
                              hitSlop={6}
                              onPress={() => onPlace(block, null)}
                              style={[styles.plus, { backgroundColor: S.ink }]}
                              accessibilityLabel="Додати на дошку"
                            >
                              <Ionicons name="add" size={18} color={S.bg} />
                            </Pressable>
                          </View>
                        </View>
                      );
                    })}
                    {shown.length === 0 && (
                      <Text style={[styles.empty, { color: S.ink3 }]}>
                        {titled.length === 0
                          ? 'У базі ще немає записів'
                          : listNeedle
                            ? 'Нічого не знайдено'
                            : 'Нічого не вибрано - відкрий параметри'}
                      </Text>
                    )}
                  </ScrollView>
                </View>
              </GestureDetector>
            )}
          </>
        )}
      </Animated.View>

      {/* The card in hand, pinned to the finger. */}
      {ghost && (
        <View style={[styles.ghostWrap, { left: ghost.x, top: ghost.y }]} pointerEvents="none">
          <View style={[styles.ghost, { backgroundColor: S.card, boxShadow: S.popShadow }]}>
            <Ionicons name="grid-outline" size={16} color={S.ink2} />
            <Text style={[styles.ghostLabel, { color: S.ink }]} numberOfLines={1}>
              {ghost.label}
            </Text>
          </View>
        </View>
      )}
    </>
  );
}

const styles = StyleSheet.create({
  frame: {
    position: 'absolute',
    left: 0,
    top: 0,
    zIndex: 40,
    overflow: 'hidden',
  },
  circle: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: 2,
    right: 2,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontFamily: SOFT_SEMIBOLD,
    color: '#FFFFFF',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 52,
    paddingLeft: 16,
    paddingRight: 8,
  },
  title: {
    flex: 1,
    fontSize: 16,
    fontFamily: SOFT_SEMIBOLD,
    letterSpacing: -0.2,
  },
  count: {
    fontSize: 13,
    fontFamily: SOFT_MEDIUM,
  },
  headerButton: {
    width: 32,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: {
    flex: 1,
    paddingHorizontal: 12,
    paddingBottom: 12,
  },
  hint: {
    fontSize: 12,
    fontFamily: SOFT_REGULAR,
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  list: {
    flex: 1,
  },
  listContent: {
    gap: 10,
    paddingBottom: 4,
  },
  rowWrap: {
    position: 'relative',
  },
  rowTools: {
    position: 'absolute',
    right: 8,
    top: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  timesPill: {
    height: 26,
    paddingHorizontal: 9,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timesText: {
    fontSize: 13,
    fontFamily: SOFT_SEMIBOLD,
    color: '#FFFFFF',
  },
  plus: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    fontSize: 14,
    fontFamily: SOFT_REGULAR,
    textAlign: 'center',
    paddingVertical: 24,
  },
  tabs: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 8,
  },
  chipScroll: {
    flexGrow: 0,
    marginBottom: 8,
  },
  chipRow: {
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 13,
    borderRadius: 17,
  },
  chipLabel: {
    fontSize: 13.5,
    fontFamily: SOFT_MEDIUM,
    maxWidth: 140,
  },
  dot: {
    width: 9,
    height: 9,
    borderRadius: 4.5,
  },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 38,
    paddingHorizontal: 12,
    borderRadius: 19,
    marginBottom: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: SOFT_REGULAR,
    paddingVertical: 0,
  },
  bulk: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 6,
  },
  bulkButton: {
    flex: 1,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bulkLabel: {
    fontSize: 12.5,
    fontFamily: SOFT_MEDIUM,
  },
  tickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 46,
    paddingHorizontal: 4,
  },
  tick: {
    width: 22,
    height: 22,
    borderRadius: 7,
    borderWidth: 1.8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickLabel: {
    flex: 1,
    fontSize: 16,
    fontFamily: SOFT_REGULAR,
  },
  ghostWrap: {
    position: 'absolute',
    zIndex: 60,
    transform: [{ scale: 1.04 }],
  },
  ghost: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 18,
    alignSelf: 'flex-start',
  },
  ghostLabel: {
    fontSize: 14,
    fontFamily: SOFT_SEMIBOLD,
    maxWidth: 180,
  },
});
