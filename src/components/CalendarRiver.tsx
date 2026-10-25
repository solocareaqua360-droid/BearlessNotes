import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { usePullToSearch } from '../hooks/usePullToSearch';
import { useChromeScrollHandler } from '../navigation/chromeScroll';
import Animated, { Easing, interpolate, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { doc, getDoc, onSnapshot } from '../firestore';
import { db } from '../firebase';
import { ownedQuery, setDoc } from '../utils/owned';
import { listenError } from '../utils/listenError';
import { Ionicons } from './icons/Ionicons';
import { ask, notify } from './surfaces/Ask';
import RenamePrompt from './RenamePrompt';
import { useSoft, type SoftTokens } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';
import { addDays, dateKey, MONTH_FULL, MONTH_SHORT, WEEKDAY_SHORT, mondayIndex, parseDateKey, formatShortDate } from '../utils/dateLocale';
import { extractPreview, hasNoteContent } from '../utils/documentPreview';
import { newBlock } from '../utils/documentBlocks';
import { createTaskOnDate } from '../utils/copyToNote';
import { toggleTaskEverywhere } from '../utils/taskToggle';
import { dayBoardId, ensureDayBoard } from '../utils/dayBoard';
import { groupAppliesTo } from '../utils/groups';
import { isDueToday, isOverdue } from '../utils/taskViews';
import { useDockClearance } from '../navigation/dockGeometry';
import { TOP_NAV_SPACE, useTopNavOn } from './TopNavBar';
import type { Block, Group, Recurrence } from '../types';
import type { ReminderKind } from '../utils/reminders';

// THE DAY RIVER (2026-10-12, the user's: the calendar as Craft draws it). One column of days - today at the top,
// tomorrow and on below it, the past a tap above. A day with something in it shows its NOTE as a card (and its
// BOARD as a circle in the card's corner when it has both: a tap on the circle turns the two round - the circle
// opens out into the card, the card shrinks into the circle), then the tasks set for that day. An empty day is
// one thin line. Every day has «•••»: a note, a board or a task for that date.
//
// Reads, all owner-scoped and filtered here (a `where` on top of the owner's filter would need a composite index):
// the documents (a day's note is `day_<key>` with `calendarDate`), the boards (`day_<key>`), the tasks (a task is
// that day's when `todayMarkedDate` or `reminderDate` is the key; today also gathers the open ones carried over).

const WEEKDAYS = ['понеділок', 'вівторок', 'середа', 'четвер', "п'ятниця", 'субота', 'неділя'];
const SHOWN_TASKS = 7;

type DayNote = { title: string; blocks: Block[] };
type RiverTask = {
  id: string;
  text: string;
  checked: boolean;
  documentId: string;
  groupId?: string;
  listId?: string;
  todayMarkedDate?: string;
  reminderDate?: string;
  reminderTime?: string;
  reminderKind?: ReminderKind;
  recurrence?: Recurrence;
  someday?: boolean;
};

// `plus()`: what the dock's «+» does over the river (the screen owns the dock; the river owns the prompt).
export type CalendarRiverHandle = { plus: () => void };

const CalendarRiver = forwardRef<CalendarRiverHandle, { navigation: unknown }>(function CalendarRiver({ navigation }, ref) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const topNavOn = useTopNavOn();
  const dockClear = useDockClearance();
  const nav = navigation as { navigate: (name: string, params?: object) => void };

  const [notes, setNotes] = useState<Map<string, DayNote>>(new Map());
  const [boards, setBoards] = useState<Set<string>>(new Set());
  const [tasks, setTasks] = useState<RiverTask[]>([]);
  const [groups, setGroups] = useState<Map<string, string>>(new Map());
  useEffect(
    () =>
      onSnapshot(
        ownedQuery('documents'),
        (snap) => {
          const next = new Map<string, DayNote>();
          snap.docs.forEach((d) => {
            const data = d.data();
            const key = data.calendarDate as string | undefined;
            if (!key || data.deletedAt) return;
            // The day's tasks live in its note as checkbox blocks; the river draws them as rows of their own, so
            // the note's card is what is left - a note holding only tasks has no card.
            const blocks = ((data.blocks as Block[]) ?? []).filter((b) => (b.type ?? 'paragraph') !== 'checkbox');
            next.set(key, { title: (data.title as string) ?? '', blocks });
          });
          setNotes(next);
        },
        listenError('CalendarRiver:documents')
      ),
    []
  );
  useEffect(
    () =>
      onSnapshot(
        ownedQuery('boards'),
        (snap) => {
          const next = new Set<string>();
          snap.docs.forEach((d) => {
            const data = d.data();
            const key = data.calendarDate as string | undefined;
            if (key && !data.deletedAt && d.id === dayBoardId(key)) next.add(key);
          });
          setBoards(next);
        },
        listenError('CalendarRiver:boards')
      ),
    []
  );
  useEffect(
    () =>
      onSnapshot(
        ownedQuery('tasks'),
        (snap) => setTasks(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<RiverTask, 'id'>) }))),
        listenError('CalendarRiver:tasks')
      ),
    []
  );
  useEffect(
    () =>
      onSnapshot(
        ownedQuery('groups'),
        (snap) => {
          const next = new Map<string, string>();
          snap.docs.forEach((d) => {
            const g = { id: d.id, ...d.data() } as Group;
            if (groupAppliesTo(g, 'task')) next.set(d.id, g.name);
          });
          setGroups(next);
        },
        listenError('CalendarRiver:groups')
      ),
    []
  );

  // How far the river reaches: today and three weeks ahead (more at the foot). The past is above today as MONTHS
  // of small sheets (the user's, after Craft: «групування старих календарних аркушів»): this month's days so far,
  // and one more month each time the river is pulled down from its very top, «майже як для пошуку».
  const [futureDays, setFutureDays] = useState(21);
  const [monthsBack, setMonthsBack] = useState(0);
  const todayKey = dateKey(new Date());
  const keys = useMemo(() => {
    const out: string[] = [];
    const today = parseDateKey(todayKey);
    for (let i = 0; i <= futureDays; i++) out.push(dateKey(addDays(today, i)));
    return out;
  }, [todayKey, futureDays]);
  // The past, oldest month first: each a title and the days in it that hold a note or a board.
  const pastMonths = useMemo(() => {
    const today = parseDateKey(todayKey);
    const out: { key: string; title: string; days: string[] }[] = [];
    for (let back = monthsBack; back >= 0; back--) {
      const first = new Date(today.getFullYear(), today.getMonth() - back, 1);
      const last = back === 0 ? addDays(today, -1) : new Date(first.getFullYear(), first.getMonth() + 1, 0);
      const days: string[] = [];
      for (let d = new Date(first); d <= last; d = addDays(d, 1)) {
        const k = dateKey(d);
        const n = notes.get(k);
        if ((n && hasNoteContent(n.title, n.blocks)) || boards.has(k)) days.push(k);
      }
      const title =
        back === 0
          ? `1 – ${today.getDate() - 1} ${MONTH_SHORT[today.getMonth()]}`
          : `${MONTH_FULL[first.getMonth()]}${first.getFullYear() !== today.getFullYear() ? ` ${first.getFullYear()}` : ''}`;
      if (back === 0 && today.getDate() === 1) continue;
      out.push({ key: `${first.getFullYear()}-${first.getMonth()}`, title, days });
    }
    return out;
  }, [todayKey, monthsBack, notes, boards]);
  const pull = usePullToSearch(() => setMonthsBack((n) => n + 1), true);
  const chromeScroll = useChromeScrollHandler();
  // Opened on TODAY, not on the past above it - and kept there while the months above arrive (they come after the
  // first frame and push today down), until the hand moves the river itself.
  const scrollRef = useRef<ScrollView>(null);
  const handMoved = useRef(false);
  const { width: windowWidth } = useWindowDimensions();

  const tasksByDay = useMemo(() => {
    const map = new Map<string, RiverTask[]>();
    const push = (key: string, t: RiverTask) => {
      const list = map.get(key) ?? [];
      if (!list.some((x) => x.id === t.id)) list.push(t);
      map.set(key, list);
    };
    tasks.forEach((t) => {
      if (t.todayMarkedDate) push(t.todayMarkedDate, t);
      if (t.reminderDate) push(t.reminderDate, t);
      // Today gathers what is still open from the days before it, as «Сьогодні» in Справи does.
      if (!t.checked && isDueToday(t, todayKey) && isOverdue(t, todayKey)) push(todayKey, t);
    });
    return map;
  }, [tasks, todayKey]);

  const [taskFor, setTaskFor] = useState<string | null>(null);
  useImperativeHandle(ref, () => ({ plus: () => riverPlus({ note: () => openNote(todayKey), task: () => setTaskFor(todayKey) }) }));

  async function openNote(key: string) {
    const id = `day_${key}`;
    try {
      const snap = await getDoc(doc(db, 'documents', id));
      if (!snap.exists()) {
        const now = Date.now();
        await setDoc(doc(db, 'documents', id), { title: '', blocks: [newBlock()], calendarDate: key, createdAt: now, updatedAt: now }, { merge: true });
      }
      nav.navigate('Editor', { documentId: id });
    } catch (e) {
      notify('Не відкрилось', (e as Error).message);
    }
  }
  async function openBoard(key: string) {
    try {
      const boardId = await ensureDayBoard(key, `День · ${formatShortDate(parseDateKey(key))}`);
      nav.navigate('BoardCopy', { boardId });
    } catch (e) {
      notify('Не відкрилось', (e as Error).message);
    }
  }
  async function dayMenu(key: string) {
    const label = dayWords(key, todayKey).date;
    const choice = await ask({
      title: label,
      actions: [
        { id: 'note', label: notes.has(key) ? 'Нотатка дня' : 'Нова нотатка дня', icon: 'document-text-outline' },
        { id: 'board', label: boards.has(key) ? 'Дошка дня' : 'Нова дошка дня', icon: 'easel-outline' },
        { id: 'task', label: `Справа на ${label}`, icon: 'checkbox-outline' },
      ],
    });
    if (choice === 'note') openNote(key);
    else if (choice === 'board') openBoard(key);
    else if (choice === 'task') setTaskFor(key);
  }
  const toggleTask = (task: RiverTask) => toggleTaskEverywhere(task);

  const top = insets.top + 12 + (topNavOn ? TOP_NAV_SPACE : 0);
  const styles = useMemo(() => makeStyles(S), [S]);
  return (
    <>
      <Animated.View style={[StyleSheet.absoluteFill, pull.pullStyle]}>
      <GestureDetector gesture={pull.gesture}>
      <ScrollView
        ref={scrollRef}
        {...pull.listProps}
        onScroll={(e) => {
          pull.listProps.onScroll(e);
          // Only the hand's own scrolling folds the chrome: the river scrolls ITSELF to today on start, and that left
          // the chrome folded on every desk (2026-10-14).
          if (handMoved.current) chromeScroll?.(e);
        }}
        onScrollBeginDrag={() => {
          handMoved.current = true;
        }}
        // The rest position too (see ExplorerScreen): a folded dock must unfold when the list stops at the top.
        onScrollEndDrag={(e) => {
          if (handMoved.current) chromeScroll?.(e);
        }}
        onMomentumScrollEnd={(e) => {
          if (handMoved.current) chromeScroll?.(e);
        }}
        style={StyleSheet.absoluteFill}
        contentContainerStyle={{ paddingTop: top, paddingBottom: dockClear + insets.bottom + 40, paddingHorizontal: 16 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.past}>
          <Ionicons name="arrow-down" size={14} color={S.ink3} />
          <Text style={styles.pastLabel}>Потягніть - попередній місяць</Text>
        </View>
        {pastMonths.map((month) => (
          <MonthGrid
            key={month.key}
            title={month.title}
            days={month.days}
            notes={notes}
            boards={boards}
            width={windowWidth - 32}
            styles={styles}
            S={S}
            onOpen={(k) => (notes.get(k) && hasNoteContent(notes.get(k)!.title, notes.get(k)!.blocks) ? openNote(k) : openBoard(k))}
          />
        ))}
        {keys.map((key) => {
          const note = notes.get(key);
          const hasNote = !!note && hasNoteContent(note.title, note.blocks);
          const hasBoard = boards.has(key);
          const dayTasks = tasksByDay.get(key) ?? [];
          const filled = hasNote || hasBoard || dayTasks.length > 0 || key === todayKey;
          return filled ? (
            <View
              key={key}
              onLayout={
                key === todayKey
                  ? (e) => {
                      if (handMoved.current) return;
                      const y = e.nativeEvent.layout.y - top;
                      if (y > 0) scrollRef.current?.scrollTo({ y, animated: false });
                    }
                  : undefined
              }
            >
            <Day
              dayKey={key}
              todayKey={todayKey}
              note={hasNote ? note : null}
              hasBoard={hasBoard}
              tasks={dayTasks}
              groups={groups}
              styles={styles}
              S={S}
              onOpenNote={() => openNote(key)}
              onOpenBoard={() => openBoard(key)}
              onMenu={() => dayMenu(key)}
              onToggleTask={toggleTask}
            />
            </View>
          ) : (
            <ThinDay key={key} dayKey={key} todayKey={todayKey} styles={styles} S={S} onMenu={() => dayMenu(key)} />
          );
        })}
        <Pressable onPress={() => setFutureDays((n) => n + 21)} style={styles.past} hitSlop={6}>
          <Text style={styles.pastLabel}>Далі</Text>
          <Ionicons name="chevron-down" size={16} color={S.ink3} />
        </Pressable>
      </ScrollView>
      </GestureDetector>
      </Animated.View>
      <RenamePrompt
        visible={taskFor !== null}
        title={taskFor ? `Справа на ${dayWords(taskFor, todayKey).date}` : 'Справа'}
        placeholder="Що зробити"
        initialValue=""
        onCancel={() => {
          setTaskFor(null);
          Keyboard.dismiss();
        }}
        onSave={async (text) => {
          const key = taskFor;
          setTaskFor(null);
          // The prompt goes, the keyboard it raised must go with it (it stayed up over the river).
          Keyboard.dismiss();
          if (!key || !text.trim()) return;
          try {
            await createTaskOnDate(text.trim(), key, {});
          } catch (e) {
            notify('Не збереглося', (e as Error).message);
          }
        }}
      />
    </>
  );
});
export default CalendarRiver;

// «+» of the dock on the river: a task for today, or today's note.
export async function riverPlus(open: { note: () => void; task: () => void }) {
  const choice = await ask({
    title: 'Сьогодні',
    actions: [
      { id: 'task', label: 'Справа', icon: 'checkbox-outline' },
      { id: 'note', label: 'Нотатка дня', icon: 'document-text-outline' },
    ],
  });
  if (choice === 'task') open.task();
  else if (choice === 'note') open.note();
}

function dayWords(key: string, todayKey: string): { date: string; word: string; isToday: boolean } {
  const d = parseDateKey(key);
  const date = `${d.getDate()} ${MONTH_SHORT[d.getMonth()]}`;
  const weekday = WEEKDAYS[mondayIndex(d)];
  const today = parseDateKey(todayKey);
  const diff = Math.round((d.getTime() - today.getTime()) / 86400000);
  const rel = diff === 0 ? 'Сьогодні' : diff === 1 ? 'Завтра' : diff === -1 ? 'Вчора' : '';
  return { date, word: rel ? `${rel} · ${weekday}` : weekday, isToday: diff === 0 };
}

type Styles = ReturnType<typeof makeStyles>;

// A month of the past as small sheets, four to a row (the user's Craft picture): the date, then the first lines of
// the day's note - or its board, when that is all the day has. No tasks here; they are in the note's own block.
function MonthGrid({
  title,
  days,
  notes,
  boards,
  width,
  styles,
  S,
  onOpen,
}: {
  title: string;
  days: string[];
  notes: Map<string, DayNote>;
  boards: Set<string>;
  width: number;
  styles: Styles;
  S: SoftTokens;
  onOpen: (key: string) => void;
}) {
  const GAP = 8;
  const cols = width >= 640 ? 6 : 4;
  const cell = Math.floor((width - GAP * (cols - 1)) / cols);
  return (
    <View style={styles.month}>
      <Text style={styles.monthTitle}>{title}</Text>
      {days.length === 0 ? (
        <Text style={styles.monthEmpty}>Нічого не записано</Text>
      ) : (
        <View style={[styles.monthGrid, { gap: GAP }]}>
          {days.map((k) => {
            const d = parseDateKey(k);
            const note = notes.get(k);
            const text = note ? `${note.title ? `${note.title}\n` : ''}${extractPreview(note.blocks, undefined, 90).previewText}`.trim() : '';
            return (
              <Pressable key={k} onPress={() => onOpen(k)} style={[styles.sheet, { width: cell, height: cell * 1.05 }]}>
                <Text style={styles.sheetDate} numberOfLines={1}>
                  {WEEKDAY_SHORT[mondayIndex(d)]}, {d.getDate()}
                </Text>
                {text ? (
                  <Text style={styles.sheetText} numberOfLines={4}>
                    {text}
                  </Text>
                ) : (
                  <View style={styles.sheetIcon}>
                    <Ionicons name={boards.has(k) ? 'easel-outline' : 'document-outline'} size={20} color={S.ink3} />
                  </View>
                )}
              </Pressable>
            );
          })}
        </View>
      )}
    </View>
  );
}

function ThinDay({ dayKey, todayKey, styles, S, onMenu }: { dayKey: string; todayKey: string; styles: Styles; S: SoftTokens; onMenu: () => void }) {
  const w = dayWords(dayKey, todayKey);
  return (
    <View style={styles.thin}>
      <Text style={styles.thinDate}>{w.date}</Text>
      <Text style={styles.thinWord} numberOfLines={1}>
        {w.word}
      </Text>
      <Pressable hitSlop={10} onPress={onMenu} style={styles.more} accessibilityLabel="Що створити на цей день">
        <Ionicons name="ellipsis-horizontal" size={20} color={S.ink3} />
      </Pressable>
    </View>
  );
}

function Day({
  dayKey,
  todayKey,
  note,
  hasBoard,
  tasks,
  groups,
  styles,
  S,
  onOpenNote,
  onOpenBoard,
  onMenu,
  onToggleTask,
}: {
  dayKey: string;
  todayKey: string;
  note: DayNote | null;
  hasBoard: boolean;
  tasks: RiverTask[];
  groups: Map<string, string>;
  styles: Styles;
  S: SoftTokens;
  onOpenNote: () => void;
  onOpenBoard: () => void;
  onMenu: () => void;
  onToggleTask: (task: RiverTask) => void;
}) {
  const w = dayWords(dayKey, todayKey);
  const [showAll, setShowAll] = useState(false);
  const open = tasks.filter((t) => !t.checked);
  const done = tasks.filter((t) => t.checked);
  const ordered = [...open, ...done];
  const shown = showAll ? ordered : ordered.slice(0, SHOWN_TASKS);
  return (
    <View style={styles.day}>
      <View style={styles.head}>
        <Text style={styles.headDate}>{w.date}</Text>
        <Text style={[styles.headWord, w.isToday && { color: S.accent, fontFamily: SOFT_SEMIBOLD }]} numberOfLines={1}>
          {w.word}
        </Text>
        <Pressable hitSlop={10} onPress={onMenu} style={styles.more} accessibilityLabel="Що створити на цей день">
          <Ionicons name="ellipsis-horizontal" size={20} color={S.ink3} />
        </Pressable>
      </View>
      {note && hasBoard ? (
        <NoteBoardPair note={note} styles={styles} S={S} onOpenNote={onOpenNote} onOpenBoard={onOpenBoard} />
      ) : note ? (
        <Pressable onPress={onOpenNote} style={[styles.card, styles.cardSolo]}>
          <NoteFace note={note} styles={styles} />
        </Pressable>
      ) : hasBoard ? (
        <Pressable onPress={onOpenBoard} style={[styles.card, styles.cardSolo]}>
          <BoardFace styles={styles} S={S} />
        </Pressable>
      ) : (
        <Pressable onPress={onOpenNote} style={styles.ghost}>
          <Ionicons name="add" size={18} color={S.ink3} />
          <Text style={styles.ghostLabel}>нотатка дня</Text>
        </Pressable>
      )}
      {shown.map((t) => (
        <View key={t.id} style={styles.task}>
          <Pressable hitSlop={10} onPress={() => onToggleTask(t)} accessibilityLabel={t.checked ? 'Зняти позначку' : 'Позначити зробленим'}>
            <View style={[styles.box, t.checked && { backgroundColor: S.ink3, borderColor: S.ink3 }]}>
              {t.checked && <Ionicons name="checkmark" size={14} color={S.card} />}
            </View>
          </Pressable>
          <Text style={[styles.taskText, t.checked && styles.taskDone]} numberOfLines={1}>
            {t.text || 'Без назви'}
          </Text>
          <Text style={styles.chip} numberOfLines={1}>
            {(t.groupId && groups.get(t.groupId)) || 'Вхідні'}
          </Text>
          {!!t.reminderTime && <Ionicons name="alarm-outline" size={16} color={S.ink3} />}
          {!!t.recurrence && <Ionicons name="repeat-outline" size={16} color={S.ink3} />}
        </View>
      ))}
      {ordered.length > SHOWN_TASKS && (
        <Pressable onPress={() => setShowAll((v) => !v)} style={styles.moreTasks} hitSlop={6}>
          <View style={styles.moreCount}>
            <Text style={styles.moreCountText}>{showAll ? '−' : ordered.length - SHOWN_TASKS}</Text>
          </View>
          <Text style={styles.moreLabel}>{showAll ? 'Згорнути' : 'ще справи'}</Text>
        </Pressable>
      )}
    </View>
  );
}

function NoteFace({ note, styles }: { note: DayNote; styles: Styles }) {
  const preview = extractPreview(note.blocks, undefined, 140).previewText;
  return (
    <>
      <Text style={styles.cardLabel}>Нотатка дня</Text>
      <Text style={styles.cardText} numberOfLines={3}>
        {note.title ? `${note.title}${preview ? `\n${preview}` : ''}` : preview || ' '}
      </Text>
    </>
  );
}

function BoardFace({ styles, S }: { styles: Styles; S: SoftTokens }) {
  return (
    <>
      <Text style={styles.cardLabel}>Дошка дня</Text>
      <View style={styles.boardHint}>
        <Ionicons name="easel-outline" size={22} color={S.ink2} />
        <Text style={styles.cardText}>Відкрити дошку</Text>
      </View>
    </>
  );
}

// The note and the board of one day: one is the card, the other a circle in its corner. A tap on the circle
// turns them round through one motion (`p`: 0 the note in front, 1 the board); a tap on the card opens it.
// Taps are gesture-handler's, not Pressables: a Pressable on a moving view measures where it USED to be and
// drops a finger's drift (see the memory note on stale measuring after a slide).
const CARD_H = 118;
const DOT = 46;
const DOT_INSET = 10;
function NoteBoardPair({
  note,
  styles,
  S,
  onOpenNote,
  onOpenBoard,
}: {
  note: DayNote;
  styles: Styles;
  S: SoftTokens;
  onOpenNote: () => void;
  onOpenBoard: () => void;
}) {
  const [width, setWidth] = useState(0);
  const [front, setFront] = useState<'note' | 'board'>('note');
  const p = useSharedValue(0);
  const busy = useRef(false);
  const flip = () => {
    if (busy.current) return;
    busy.current = true;
    const next = front === 'note' ? 'board' : 'note';
    setFront(next);
    p.value = withTiming(next === 'board' ? 1 : 0, { duration: 420, easing: Easing.out(Easing.cubic) }, () => {
      busy.current = false;
    });
    setTimeout(() => {
      busy.current = false;
    }, 500);
  };
  const W = width;
  const big = { x: 0, y: 0, w: W, h: CARD_H, r: 22 };
  const small = { x: W - DOT - DOT_INSET, y: DOT_INSET, w: DOT, h: DOT, r: DOT / 2 };
  const noteStyle = useAnimatedStyle(() => ({
    left: interpolate(p.value, [0, 1], [big.x, small.x]),
    top: interpolate(p.value, [0, 1], [big.y, small.y]),
    width: interpolate(p.value, [0, 1], [big.w, small.w]),
    height: interpolate(p.value, [0, 1], [big.h, small.h]),
    borderRadius: interpolate(p.value, [0, 1], [big.r, small.r]),
  }));
  const boardStyle = useAnimatedStyle(() => ({
    left: interpolate(p.value, [0, 1], [small.x, big.x]),
    top: interpolate(p.value, [0, 1], [small.y, big.y]),
    width: interpolate(p.value, [0, 1], [small.w, big.w]),
    height: interpolate(p.value, [0, 1], [small.h, big.h]),
    borderRadius: interpolate(p.value, [0, 1], [small.r, big.r]),
  }));
  const noteFull = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.45], [1, 0], 'clamp') }));
  const noteDot = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0.55, 1], [0, 1], 'clamp') }));
  const boardFull = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0.55, 1], [0, 1], 'clamp') }));
  const boardDot = useAnimatedStyle(() => ({ opacity: interpolate(p.value, [0, 0.45], [1, 0], 'clamp') }));
  const noteTap = Gesture.Tap()
    .maxDistance(20)
    .runOnJS(true)
    .onEnd((_e, ok) => {
      if (!ok) return;
      if (front === 'note') onOpenNote();
      else flip();
    });
  const boardTap = Gesture.Tap()
    .maxDistance(20)
    .runOnJS(true)
    .onEnd((_e, ok) => {
      if (!ok) return;
      if (front === 'board') onOpenBoard();
      else flip();
    });
  return (
    <View style={{ height: CARD_H, marginBottom: 12 }} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      {width > 0 && (
        <>
          <GestureDetector gesture={noteTap}>
            <Animated.View
              style={[styles.pairItem, noteStyle, { zIndex: front === 'note' ? 1 : 2, backgroundColor: front === 'note' ? S.card : S.fill }]}
            >
              <Animated.View style={[styles.pairFull, noteFull]} pointerEvents="none">
                <NoteFace note={note} styles={styles} />
              </Animated.View>
              <Animated.View style={[styles.pairDot, noteDot]} pointerEvents="none">
                <Ionicons name="document-text-outline" size={22} color={S.ink2} />
              </Animated.View>
            </Animated.View>
          </GestureDetector>
          <GestureDetector gesture={boardTap}>
            <Animated.View
              style={[styles.pairItem, boardStyle, { zIndex: front === 'board' ? 1 : 2, backgroundColor: front === 'board' ? S.card : S.fill }]}
            >
              <Animated.View style={[styles.pairFull, boardFull]} pointerEvents="none">
                <BoardFace styles={styles} S={S} />
              </Animated.View>
              <Animated.View style={[styles.pairDot, boardDot]} pointerEvents="none">
                <Ionicons name="easel-outline" size={22} color={S.ink2} />
              </Animated.View>
            </Animated.View>
          </GestureDetector>
        </>
      )}
    </View>
  );
}

function makeStyles(S: SoftTokens) {
  return StyleSheet.create({
    past: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 10 },
    month: { marginBottom: 22 },
    monthTitle: { fontFamily: SOFT_SEMIBOLD, fontSize: 22, color: S.ink, marginHorizontal: 4, paddingBottom: 8, marginBottom: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: S.line },
    monthEmpty: { fontFamily: SOFT_MEDIUM, fontSize: 14, color: S.ink3, marginHorizontal: 4 },
    monthGrid: { flexDirection: 'row', flexWrap: 'wrap' },
    sheet: { backgroundColor: S.card, borderRadius: 14, boxShadow: S.shadow, paddingHorizontal: 8, paddingVertical: 8, overflow: 'hidden' } as never,
    sheetDate: { fontFamily: SOFT_SEMIBOLD, fontSize: 13, color: S.ink, marginBottom: 4 },
    sheetText: { fontFamily: SOFT_MEDIUM, fontSize: 10.5, lineHeight: 14, color: S.ink2 },
    sheetIcon: { flex: 1, alignItems: 'center', justifyContent: 'center' },
    pastLabel: { fontFamily: SOFT_MEDIUM, fontSize: 14, color: S.ink3 },
    day: { marginBottom: 20 },
    head: { flexDirection: 'row', alignItems: 'baseline', gap: 8, marginHorizontal: 4, marginBottom: 10 },
    headDate: { fontFamily: SOFT_SEMIBOLD, fontSize: 26, color: S.ink, letterSpacing: -0.3 },
    headWord: { flex: 1, fontFamily: SOFT_MEDIUM, fontSize: 16, color: S.ink3 },
    more: { paddingHorizontal: 4, alignSelf: 'center' },
    card: { backgroundColor: S.card, borderRadius: 22, boxShadow: S.shadow, paddingHorizontal: 18, paddingVertical: 14 } as never,
    cardSolo: { minHeight: 96, marginBottom: 12 },
    cardLabel: { fontFamily: SOFT_SEMIBOLD, fontSize: 13, color: S.ink3, marginBottom: 6 },
    cardText: { fontFamily: SOFT_MEDIUM, fontSize: 15, lineHeight: 21, color: S.ink },
    boardHint: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    pairItem: { position: 'absolute', overflow: 'hidden', boxShadow: S.shadow } as never,
    pairFull: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, paddingHorizontal: 18, paddingVertical: 14, paddingRight: DOT + DOT_INSET + 12 },
    pairDot: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, alignItems: 'center', justifyContent: 'center' },
    task: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 42, paddingHorizontal: 4 },
    box: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.8, borderColor: S.ink3, alignItems: 'center', justifyContent: 'center' },
    taskText: { flex: 1, minWidth: 0, fontFamily: SOFT_MEDIUM, fontSize: 16, color: S.ink },
    taskDone: { color: S.ink3, textDecorationLine: 'line-through' },
    chip: { maxWidth: 110, fontFamily: SOFT_MEDIUM, fontSize: 13, color: S.ink2, backgroundColor: S.fill, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 3, overflow: 'hidden' },
    moreTasks: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 4, paddingTop: 6 },
    moreCount: { minWidth: 24, height: 24, borderRadius: 12, backgroundColor: S.fill, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 },
    moreCountText: { fontFamily: SOFT_SEMIBOLD, fontSize: 12, color: S.ink2 },
    moreLabel: { fontFamily: SOFT_MEDIUM, fontSize: 15, color: S.ink3 },
    ghost: { flexDirection: 'row', alignItems: 'center', gap: 8, borderWidth: 1.5, borderStyle: 'dashed', borderColor: S.line, borderRadius: 18, paddingHorizontal: 14, height: 46, marginBottom: 8 },
    ghostLabel: { fontFamily: SOFT_MEDIUM, fontSize: 15, color: S.ink3 },
    thin: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 48, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: S.line, paddingHorizontal: 4 },
    thinDate: { minWidth: 78, fontFamily: SOFT_SEMIBOLD, fontSize: 17, color: S.ink },
    thinWord: { flex: 1, fontFamily: SOFT_MEDIUM, fontSize: 15, color: S.ink3 },
  });
}
