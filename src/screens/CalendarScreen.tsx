import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Keyboard,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { collection, doc, getDoc, onSnapshot, query, setDoc, updateDoc, where } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { Block } from '../types';
import { RootStackParamList } from '../navigation';
import DocumentEditorScreen, { DocumentEditorHandle } from './DocumentEditorScreen';
import { hasNoteContent } from '../utils/documentPreview';
import { useDayHistory } from '../hooks/useDayHistory';
import DayHistoryList from '../components/DayHistoryList';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout';
import { FONT_REGULAR, FONT_MEDIUM, FONT_SEMIBOLD, FONT_BOLD } from '../utils/fonts';
import {
  MONTH_FULL,
  WEEKDAY_SHORT,
  addDays,
  dateKey,
  formatBigDate,
  getMonthGrid,
  getWeekDates,
  isSameDay,
  mondayIndex,
  mondayOf,
  parseDateKey,
} from '../utils/dateLocale';

const ACCENT = '#3B82F6';
// calendarPlate carries its own marginHorizontal:16 on each side, so the
// week strip's actual scrollable viewport is this much narrower than the
// window - every page inside it (and the paging math that scrolls between
// them) sizes against that, or the ScrollView's real width and its pages'
// assumed width disagree and everything shifts.
//
// Derived per render from useWindowDimensions, NEVER captured once at
// module scope from Dimensions.get(): that value is whatever Android
// happened to report the instant this module was first evaluated, which
// is not always the window the app ends up laid out in (a cold start
// behind the splash, an OTA bundle reload, split screen, a system display-
// size change). When the two disagree, the pages stay their stale width
// while the weekday header above them lays out flexibly against the real
// one - the columns drift apart and the last days of the week fall off
// the right edge, which is exactly how this screen has broken twice.
const PLATE_MARGIN = 16;
const documentsCollection = collection(db, 'documents');
const tasksCollection = collection(db, 'tasks');
const calendarPrefsDoc = doc(db, 'settings', 'calendarPrefs');

// The week strip pages between exactly 3 in-memory weeks (prev/current/next)
// instead of a real windowed list - a plain paging ScrollView already gives
// the "follows your finger, snaps to the next 7 days" feel natively, and
// resetting back to the middle page after each swipe (see the weekStart
// effect below) makes it look infinite without ever holding more than 21
// days of cells. Deliberately NOT the drag-gesture approach tried for the
// tags drawer earlier - that kept losing the touch to Android's own
// edge-back gesture; a plain ScrollView's native paging has none of that.
const WEEK_PAGE_OFFSETS = [-7, 0, 7];

// The week strip and the month grid are the same cells in the same columns,
// so the fold between them is one clipped box whose height is animated
// between one row and six, with the two layers cross-fading inside it. The
// weekday header above stays put through the whole thing, which is what
// makes it read as the calendar growing rather than two views swapping.
// (Reanimated, not LayoutAnimation - LayoutAnimation on Android latches
// onto whatever layout change happens next, which is what was leaving day
// numbers permanently faded out after tapping between days.)
const ROW_HEIGHT = 40;
const WEEK_AREA_HEIGHT = ROW_HEIGHT;
const MONTH_AREA_HEIGHT = ROW_HEIGHT * 6;
const MONTH_NAV_HEIGHT = 36;
const WEEKDAY_HEADER_HEIGHT = 22;
// The "only filled days" strip has no weekday header (its dates aren't a
// real calendar week, so weekday letters would be meaningless) - that
// reclaimed height goes straight into taller day cells instead of just
// being removed, which is also why the two heights sum to the same total
// as WEEK_AREA_HEIGHT + WEEKDAY_HEADER_HEIGHT (see calendarWrapStyle).
const FILLED_ROW_HEIGHT = ROW_HEIGHT + WEEKDAY_HEADER_HEIGHT;

export default function CalendarScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // Nested-navigator params from DiaryScreen's "open this sheet" - see
  // navigation.ts's Tabs type. Not typed through the tab navigator itself
  // (created untyped, like the rest of this app's tab bar), so read
  // loosely here rather than threading a param-list generic through it.
  const route = useRoute();
  const jumpToDate = (route.params as { jumpToDate?: string } | undefined)?.jumpToDate;
  // See DocumentsScreen - react-native-svg's own "100%" doesn't reliably
  // re-measure on a runtime window resize (a Fold unfolding), so the
  // gradient's canvas is sized from this instead.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  // Two panes on a wide screen (a Fold's inner screen, a tablet, DeX): the
  // calendar on the left with the month already open, the day's note on
  // the right. Same 840dp threshold as the documents list, and the same
  // reason it's a width and not an orientation - the inner screen is
  // nearly square, so the split earns its keep in portrait too.
  // Two columns from 840dp (calendar | note), three from 960 (calendar and
  // its reminders | note | the day's history). The history is what gains
  // most: under the calendar it's a pill that drops a 360px-tall list,
  // which is exactly the cramped feeling a column of its own removes.
  const { isTwoPane } = useResponsiveLayout();
  // The calendar's own column, measured rather than assumed: in two panes
  // the window is no longer the space the strip has, and a strip whose
  // pages are sized against the wrong width is exactly how this screen
  // broke twice (see PLATE_MARGIN's comment above).
  const [calendarPaneWidth, setCalendarPaneWidth] = useState(0);
  // On a wide screen there are exactly two layouts, and one button between
  // them. 'pages' is what unfolding the phone opens: two day sheets filling
  // the screen like a document, with only a narrow week strip above them to
  // pick the date by. 'columns' narrows that to a single sheet on the right
  // and gives the left to the calendar opened out, with the day's history
  // and its reminders under it.
  //
  // Four independent toggles lived here before - hide the calendar, hide
  // the history, note full screen, spread - and between them they made more
  // arrangements than anyone could hold in their head. These two are the
  // ones worth having.
  const [wideLayout, setWideLayout] = useState<'pages' | 'columns'>('pages');
  const stripWidth = (isTwoPane && calendarPaneWidth > 0 ? calendarPaneWidth : windowWidth) - PLATE_MARGIN * 2;
  const today = useMemo(() => new Date(), []);

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [isMonthExpanded, setIsMonthExpanded] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  // Which of the two "only X days" compact strips is active, if either -
  // mutually exclusive (one strip, one criterion at a time), stored under
  // the same calendarPrefsDoc the old plain boolean used. `isCompactMode`
  // is what most of the surrounding layout code actually cares about
  // (is the pill strip showing at all), regardless of which criterion.
  const [compactFilter, setCompactFilterState] = useState<'none' | 'filled' | 'history'>('none');
  const onlyFilledDays = compactFilter !== 'none';
  const [noteFilledDates, setNoteFilledDates] = useState<Set<string>>(new Set());
  const [reminderFilledDates, setReminderFilledDates] = useState<Set<string>>(new Set());
  // A day counts as "filled" either because it has a real note or because
  // a task's reminder is due that day (Варіант A - no synthetic diary
  // documents get created for a reminder-only day, this merge is purely at
  // render time) - the two queries below are independent live snapshots,
  // so they're kept as separate sets and unioned here rather than one
  // written into the other, which would risk one source's update wiping
  // the other's entries for that render.
  const filledDates = useMemo(
    () => new Set([...noteFilledDates, ...reminderFilledDates]),
    [noteFilledDates, reminderFilledDates]
  );
  const { historyByDate, historyDates } = useDayHistory(
    visibleMonth.year,
    visibleMonth.month,
    compactFilter === 'history'
  );
  // Sorted view of whichever set the active compact strip shows - date keys
  // (YYYY-MM-DD) sort lexicographically the same as chronologically.
  const filledDatesSorted = useMemo(() => Array.from(filledDates).sort(), [filledDates]);
  const historyDatesSorted = useMemo(() => Array.from(historyDates).sort(), [historyDates]);
  const activeDatesSorted = compactFilter === 'history' ? historyDatesSorted : filledDatesSorted;
  const [dueReminders, setDueReminders] = useState<
    { id: string; text: string; checked: boolean; documentId: string; reminderTime?: string }[]
  >([]);
  const [menuOpen, setMenuOpen] = useState(false);
  // Mirrors the embedded note editor's own internal state (see
  // DocumentEditorScreen's onSelectModeChange/onSaveStatusChange) so this
  // screen's own header capsule can show the right icon/checkmark for
  // whichever day's note is currently mounted - noteEditorRef is how the
  // header's select button reaches back down to actually toggle it.
  const [noteSelectMode, setNoteSelectMode] = useState(false);
  const [noteSaveStatus, setNoteSaveStatus] = useState<'saved' | 'saving'>('saved');
  const noteEditorRef = useRef<DocumentEditorHandle>(null);
  // The calendar folds away entirely while the keyboard is up: on a phone
  // the strip (let alone the month grid) plus the keyboard leaves almost
  // nothing for the note being written.
  const [isWriting, setIsWriting] = useState(false);
  // Only meaningful in the "history" compact strip (see the collapse row
  // near noteArea below) - reset whenever that strip isn't the active one,
  // so leaving it and coming back never starts pre-collapsed for no reason.
  const [noteCollapsed, setNoteCollapsed] = useState(false);
  useEffect(() => {
    if (compactFilter !== 'history') setNoteCollapsed(false);
  }, [compactFilter]);
  // Index into filledDatesSorted of the first cell of the currently shown
  // page of the "only filled days" strip - same 3-page sliding-window idea
  // as weekStart/WEEK_PAGE_OFFSETS below, just stepping by array index
  // instead of calendar days, since these dates aren't a contiguous week.
  const [filledPageStart, setFilledPageStart] = useState(0);
  // Once the user has manually scrolled the strip, stop re-centering it on
  // selectedDate every time the live filledDatesSorted list updates (e.g. a
  // note is added elsewhere) - only the initial "jump to today's spot" on
  // turning the toggle on should move the strip out from under them.
  const userAdjustedFilledPageRef = useRef(false);
  const filledScrollRef = useRef<ScrollView>(null);

  const weekScrollRef = useRef<ScrollView>(null);
  // Two day sheets side by side with the week strip above them - the
  // layout unfolding the phone opens. A narrow screen never sees either of
  // the two: folded shut, everything is exactly as it was.
  const twoPages = isTwoPane && wideLayout === 'pages';
  // The month is opened out only where it has a column to itself; in the
  // two-page layout the calendar is that narrow strip and nothing more.
  const monthOpen = (isTwoPane && wideLayout === 'columns') || isMonthExpanded;
  // The calendar folds away under the keyboard only when the note is
  // BELOW it. Side by side, typing in the note has no reason to take the
  // calendar off the screen.
  const foldedAway = isWriting && !isTwoPane;
  const spread = twoPages;
  const expandAmount = useSharedValue(0); // 0 = week strip, 1 = month grid
  const visibleAmount = useSharedValue(1); // 0 = folded away (writing)

  useEffect(() => {
    expandAmount.value = withTiming(monthOpen ? 1 : 0, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    });
  }, [monthOpen, expandAmount]);

  useEffect(() => {
    visibleAmount.value = withTiming(foldedAway ? 0 : 1, {
      duration: 200,
      easing: Easing.out(Easing.cubic),
    });
  }, [foldedAway, visibleAmount]);

  useEffect(() => {
    return onSnapshot(calendarPrefsDoc, (snapshot) => {
      const data = snapshot.data();
      // Reads both the new field and the old plain boolean it replaces, so
      // whatever was saved before this update still means the same thing.
      const stored = data?.compactFilter as 'none' | 'filled' | 'history' | undefined;
      setCompactFilterState(stored ?? (data?.onlyFilledDays ? 'filled' : 'none'));
    });
  }, []);

  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', () => setIsWriting(true));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setIsWriting(false));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Recenters the 3-page week strip on the (possibly new) current week.
  useEffect(() => {
    weekScrollRef.current?.scrollTo({ x: stripWidth, animated: false });
  }, [weekStart, stripWidth]);

  // Same recentring for the "only filled days" strip's own 3-page window.
  useEffect(() => {
    filledScrollRef.current?.scrollTo({ x: stripWidth, animated: false });
  }, [filledPageStart, stripWidth]);

  // Jumps the strip to whichever 7-slot page contains the selected day (or
  // the next filled day after it, if the selected day itself has no note)
  // the moment the toggle turns on or the list first loads - never again
  // after the user has scrolled it themselves.
  // Switching which criterion the compact strip uses (filled <-> history)
  // is as much a fresh start as turning it on from "none" - the previous
  // scroll position belonged to a completely different set of dates.
  useEffect(() => {
    userAdjustedFilledPageRef.current = false;
  }, [compactFilter]);

  useEffect(() => {
    if (!onlyFilledDays) {
      userAdjustedFilledPageRef.current = false;
      return;
    }
    if (userAdjustedFilledPageRef.current || activeDatesSorted.length === 0) return;
    const key = dateKey(selectedDate);
    let idx = activeDatesSorted.findIndex((k) => k >= key);
    if (idx === -1) idx = activeDatesSorted.length - 1;
    setFilledPageStart(Math.max(0, idx - (idx % 7)));
  }, [onlyFilledDays, activeDatesSorted, selectedDate]);

  // The month grid can never be reached while showing only filled days (see
  // the expand button being hidden below) - if it was already open when the
  // toggle turns on, fold it back to the strip instead of leaving it stuck.
  useEffect(() => {
    if (onlyFilledDays) setIsMonthExpanded(false);
  }, [onlyFilledDays]);

  // The month grid follows whichever day is open, so collapsing back to the
  // week strip and expanding again always lands on the right month. Changing
  // months with the arrows doesn't touch selectedDate, so it doesn't fight
  // this.
  useEffect(() => {
    setVisibleMonth({ year: selectedDate.getFullYear(), month: selectedDate.getMonth() });
  }, [selectedDate]);

  // Which days already have a real note (the dot indicator, and the "only
  // filled days" toggle) - padded a week past either end of the visible
  // month so the week strip's own boundary stays correct even for a week
  // that spans two months. calendarDate sorts the same as the date it
  // represents (YYYY-MM-DD), so a plain range filter covers this with no
  // composite index needed. While the "only filled days" strip is active
  // there's no single "visible month" to bound the query by anymore (the
  // strip can be scrolled arbitrarily far into the past/future) - it widens
  // to effectively unbounded instead. A personal note history is small
  // enough that this is still one cheap query, not real pagination.
  useEffect(() => {
    // Only THIS strip's own criterion widens the range to unbounded - the
    // history strip widens useDayHistory's own query instead (see its
    // `unbounded` param above), independently.
    const unbounded = compactFilter === 'filled';
    const monthStartKey = unbounded
      ? '0001-01-01'
      : dateKey(addDays(new Date(visibleMonth.year, visibleMonth.month, 1), -7));
    const monthEndKey = unbounded
      ? '9999-12-31'
      : dateKey(addDays(new Date(visibleMonth.year, visibleMonth.month + 1, 0), 7));
    const filledQuery = query(
      documentsCollection,
      where('calendarDate', '>=', monthStartKey),
      where('calendarDate', '<=', monthEndKey)
    );
    return onSnapshot(filledQuery, (snapshot) => {
      const filled = new Set<string>();
      snapshot.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data();
        if (hasNoteContent(data.title ?? '', data.blocks ?? [])) filled.add(data.calendarDate as string);
      });
      setNoteFilledDates(filled);
    });
  }, [visibleMonth.year, visibleMonth.month, compactFilter]);

  // Same range, same reasoning, but against tasks' own reminderDate - a day
  // with a task due on it counts as "filled" too (see filledDates above),
  // without writing an actual (empty) diary document for it.
  useEffect(() => {
    const unbounded = compactFilter === 'filled';
    const monthStartKey = unbounded
      ? '0001-01-01'
      : dateKey(addDays(new Date(visibleMonth.year, visibleMonth.month, 1), -7));
    const monthEndKey = unbounded
      ? '9999-12-31'
      : dateKey(addDays(new Date(visibleMonth.year, visibleMonth.month + 1, 0), 7));
    const remindersQuery = query(
      tasksCollection,
      where('reminderDate', '>=', monthStartKey),
      where('reminderDate', '<=', monthEndKey)
    );
    return onSnapshot(remindersQuery, (snapshot) => {
      const filled = new Set<string>();
      snapshot.docs.forEach((docSnapshot) => {
        const reminderDate = docSnapshot.data().reminderDate;
        if (reminderDate) filled.add(reminderDate as string);
      });
      setReminderFilledDates(filled);
    });
  }, [visibleMonth.year, visibleMonth.month, compactFilter]);

  function selectDay(date: Date) {
    setSelectedDate(date);
    setWeekStart(mondayOf(date));
  }

  // The "Сьогодні" button is always visible now (not just when already on
  // today), specifically so it can pull the week strip/month grid back
  // after they've been paged away with a swipe - selectDay already resets
  // both weekStart (recentres the week strip) and, via the effect watching
  // selectedDate, visibleMonth too.
  function jumpToToday() {
    selectDay(new Date());
  }

  // Jump straight to a day opened from DiaryScreen. Guarded by a ref (not
  // just the effect's own dep array) so re-focusing this tab later - with
  // the same still-current param, since nothing clears it - doesn't jump
  // again and fight whatever day the user has since navigated to on their
  // own.
  const handledJumpRef = useRef<string | null>(null);
  useEffect(() => {
    if (jumpToDate && jumpToDate !== handledJumpRef.current) {
      handledJumpRef.current = jumpToDate;
      selectDay(parseDateKey(jumpToDate));
    }
  }, [jumpToDate]);

  function handleWeekScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const page = Math.round(e.nativeEvent.contentOffset.x / stripWidth);
    if (page === 1) return;
    const deltaDays = (page - 1) * 7;
    setWeekStart((prev) => addDays(prev, deltaDays));
    setSelectedDate((prev) => addDays(prev, deltaDays));
  }

  function handleFilledScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const page = Math.round(e.nativeEvent.contentOffset.x / stripWidth);
    if (page === 1) return;
    userAdjustedFilledPageRef.current = true;
    setFilledPageStart((prev) => Math.max(0, prev + (page - 1) * 7));
  }

  function changeVisibleMonth(delta: number) {
    setVisibleMonth((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  async function toggleCompactFilter(mode: 'filled' | 'history') {
    setMenuOpen(false);
    const next = compactFilter === mode ? 'none' : mode;
    await setDoc(calendarPrefsDoc, { compactFilter: next }, { merge: true });
  }

  // The row height that isn't the month grid - WEEK_AREA_HEIGHT normally,
  // or the taller FILLED_ROW_HEIGHT (weekday header's space folded in) for
  // the "only filled days" strip. Total calendarWrap height is unaffected
  // either way - only how it's split between the header row and this one.
  // In a column of its own the month is about 250dp wide, and 40dp rows
  // make it a tall rectangle over a square grid of days. Shorter rows put
  // it back in proportion with its own width.
  const rowHeight = isTwoPane ? 32 : ROW_HEIGHT;
  const monthAreaHeight = rowHeight * 6;
  const filledRowHeight = rowHeight + WEEKDAY_HEADER_HEIGHT;
  const weekRowHeight = onlyFilledDays ? filledRowHeight : rowHeight;
  // calendarPlate's own border/padding used to be plain (non-animated)
  // styling around calendarWrap - so even once calendarWrap's own height
  // animated down to 0 while writing, this border+padding stayed put as a
  // thin visible bar. Animating them down to 0 too here is what actually
  // makes the whole plate disappear.
  const calendarPlateStyle = useAnimatedStyle(() => ({
    opacity: visibleAmount.value,
    paddingTop: 6 * visibleAmount.value,
    paddingBottom: 10 * visibleAmount.value,
    borderWidth: visibleAmount.value,
  }));
  const calendarWrapStyle = useAnimatedStyle(() => {
    const navHeight = MONTH_NAV_HEIGHT * expandAmount.value;
    const gridHeight = weekRowHeight + (monthAreaHeight - weekRowHeight) * expandAmount.value;
    const weekdayHeight = onlyFilledDays ? 0 : WEEKDAY_HEADER_HEIGHT;
    return {
      height: (navHeight + weekdayHeight + gridHeight) * visibleAmount.value,
      opacity: visibleAmount.value,
    };
  }, [weekRowHeight, monthAreaHeight, onlyFilledDays]);
  const monthNavStyle = useAnimatedStyle(() => ({
    height: MONTH_NAV_HEIGHT * expandAmount.value,
    opacity: expandAmount.value,
  }));
  const gridClipStyle = useAnimatedStyle(() => ({
    height: weekRowHeight + (monthAreaHeight - weekRowHeight) * expandAmount.value,
  }), [weekRowHeight, monthAreaHeight]);
  const weekLayerStyle = useAnimatedStyle(() => ({ opacity: 1 - expandAmount.value }));
  const monthLayerStyle = useAnimatedStyle(() => ({ opacity: expandAmount.value }));

  // Folding the phone shut comes back to the two pages, which is what
  // unfolding it should open with again.
  useEffect(() => {
    if (!isTwoPane) setWideLayout('pages');
  }, [isTwoPane]);

  // The calendar itself. Drawn in two different places depending on the
  // layout - full width above two day sheets, or at the top of its own
  // column beside one - so it lives in a function rather than being
  // written out twice and drifting apart.
  function renderCalendarPlate() {
    return (
      <>
        <Animated.View style={[styles.calendarPlate, isTwoPane && !twoPages && styles.calendarPlatePaned, calendarPlateStyle]}>
        <Animated.View style={[styles.calendarWrap, calendarWrapStyle]}>
          <Animated.View style={[styles.monthNavWrap, monthNavStyle]}>
            <View style={styles.monthNav}>
              <Pressable hitSlop={10} onPress={() => changeVisibleMonth(-1)}>
                <Ionicons name="chevron-back" size={18} color="rgba(255,255,255,0.7)" />
              </Pressable>
              <Text style={styles.monthNavLabel}>
                {MONTH_FULL[visibleMonth.month]} {visibleMonth.year}
              </Text>
              <Pressable hitSlop={10} onPress={() => changeVisibleMonth(1)}>
                <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.7)" />
              </Pressable>
            </View>
          </Animated.View>

          {!onlyFilledDays && (
            // Hidden entirely (not just blanked) while showing only filled
            // days - its dates aren't a real calendar week (they skip straight
            // from one filled day to the next), so weekday letters above them
            // would be meaningless. The reclaimed height goes to bigger day
            // cells instead (see FILLED_ROW_HEIGHT).
            <View style={styles.weekdayHeader}>
              {WEEKDAY_SHORT.map((w) => (
                <Text key={w} style={styles.weekdayHeaderLabel}>
                  {w}
                </Text>
              ))}
            </View>
          )}

          <Animated.View style={[styles.gridClip, gridClipStyle]}>
            <Animated.View
              style={[styles.calendarLayer, { height: weekRowHeight }, weekLayerStyle]}
              pointerEvents={monthOpen ? 'none' : 'auto'}
            >
              {onlyFilledDays ? (
                <ScrollView
                  ref={filledScrollRef}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  style={[styles.weekScroll, { height: filledRowHeight }]}
                  contentOffset={{ x: stripWidth, y: 0 }}
                  onLayout={() => filledScrollRef.current?.scrollTo({ x: stripWidth, animated: false })}
                  onMomentumScrollEnd={handleFilledScrollEnd}
                >
                  {WEEK_PAGE_OFFSETS.map((offset) => (
                    <View key={offset} style={[styles.weekPage, { width: stripWidth }]}>
                      {Array.from({ length: 7 }, (_, i) => {
                        const idx = filledPageStart + offset + i;
                        const dateStr = activeDatesSorted[idx];
                        if (!dateStr) return <View key={i} style={styles.filledDayCell} />;
                        const date = parseDateKey(dateStr);
                        const isToday = isSameDay(date, today);
                        return (
                          <DayCell
                            key={dateStr}
                            date={date}
                            isToday={isToday}
                            isSelected={dateStr === selectedKey}
                            height={filledRowHeight}
                            compact
                            onPress={() => selectDay(date)}
                          />
                        );
                      })}
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <ScrollView
                  ref={weekScrollRef}
                  horizontal
                  pagingEnabled
                  showsHorizontalScrollIndicator={false}
                  // RN gives every ScrollView flexGrow: 1, so without a fixed
                  // height here the strip stretches over all the free space.
                  style={styles.weekScroll}
                  contentOffset={{ x: stripWidth, y: 0 }}
                  onLayout={() => weekScrollRef.current?.scrollTo({ x: stripWidth, animated: false })}
                  onMomentumScrollEnd={handleWeekScrollEnd}
                >
                  {WEEK_PAGE_OFFSETS.map((offset) => (
                    <View key={offset} style={[styles.weekPage, { width: stripWidth }]}>
                      {getWeekDates(addDays(weekStart, offset)).map((date) => {
                        const key = dateKey(date);
                        const isToday = isSameDay(date, today);
                        return (
                          <DayCell
                            key={key}
                            date={date}
                            isToday={isToday}
                            isSelected={key === selectedKey}
                            filled={filledDates.has(key)}
                            hasHistory={historyDates.has(key)}
                            height={rowHeight}
                            onPress={() => selectDay(date)}
                          />
                        );
                      })}
                    </View>
                  ))}
                </ScrollView>
              )}
            </Animated.View>

            <Animated.View
              style={[styles.calendarLayer, { height: monthAreaHeight }, monthLayerStyle]}
              pointerEvents={monthOpen ? 'auto' : 'none'}
            >
              <View style={styles.monthGrid}>
                {/* One explicit row per week, each cell flex:1 - not a single
                    flexWrap container with hardcoded `100/7%` cell widths.
                    Yoga rounds each cell's percentage width to a whole pixel,
                    and on most screen widths 7 * round(100/7%) overshoots the
                    row by a pixel, so the 7th cell (Sunday) wrapped onto the
                    next visual row instead of staying in this one - the same
                    flex:1-per-row technique the week strip below already uses
                    safely (dayCell), just applied per week instead of once. */}
                {Array.from({ length: 6 }, (_, row) => (
                  <View key={row} style={styles.monthGridRow}>
                    {monthGrid.slice(row * 7, row * 7 + 7).map(({ date, inMonth }) => {
                      const key = dateKey(date);
                      const isToday = isSameDay(date, today);
                      return (
                        <DayCell
                          key={key}
                          date={date}
                          isToday={isToday}
                          isSelected={key === selectedKey}
                          muted={!inMonth}
                          filled={filledDates.has(key)}
                          hasHistory={historyDates.has(key)}
                          height={rowHeight}
                          inGrid
                          onPress={() => selectDay(date)}
                        />
                      );
                    })}
                  </View>
                ))}
              </View>
            </Animated.View>
          </Animated.View>
        </Animated.View>
        </Animated.View>
      </>
    );
  }

  // One day's sheet. `primary` is the selected day's - the one the header's
  // save dot and select-mode button drive, and the only one that needs the
  // ref. The second page carries a date label because, unlike the first,
  // the header above doesn't name it.
  function renderDayNote(key: string, date: Date, primary: boolean) {
    return (
      <View style={[styles.noteArea, isTwoPane && styles.notePane]}>
        {spread && (
          <Text style={styles.pageDateLabel}>
            {WEEKDAY_SHORT[mondayIndex(date)]}, {formatBigDate(date)}
          </Text>
        )}
        <DocumentEditorScreen
          key={`day_${key}`}
          ref={primary ? noteEditorRef : undefined}
          embedded
          documentId={`day_${key}`}
          navigation={navigation}
          extraFields={{ calendarDate: key }}
          onSelectModeChange={primary ? setNoteSelectMode : undefined}
          onSaveStatusChange={primary ? setNoteSaveStatus : undefined}
        />
      </View>
    );
  }

  const monthGrid = useMemo(
    () => getMonthGrid(visibleMonth.year, visibleMonth.month),
    [visibleMonth.year, visibleMonth.month]
  );
  const selectedKey = dateKey(selectedDate);
  const dailyDocId = `day_${selectedKey}`;
  // The right-hand page of the spread is always the day after the selected
  // one, the way a paper diary opens: picking a date moves the whole
  // spread rather than one page of it, so there's never a question of
  // which page a tap on the calendar changes.
  const nextDate = addDays(selectedDate, 1);
  const nextKey = dateKey(nextDate);

  // The actual tasks due on the selected day (not just whether the day
  // counts as "filled") - a task written in a DIFFERENT document but
  // reminder-dated to this one shows here, on the sheet for the day it's
  // actually due, rather than only being visible back where it was typed.
  useEffect(() => {
    const dueQuery = query(tasksCollection, where('reminderDate', '==', selectedKey));
    return onSnapshot(dueQuery, (snapshot) => {
      setDueReminders(
        snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          text: docSnapshot.data().text,
          checked: !!docSnapshot.data().checked,
          documentId: docSnapshot.data().documentId,
          reminderTime: docSnapshot.data().reminderTime,
        }))
      );
    });
  }, [selectedKey]);

  // Excludes a task physically written in this same day's own note - that
  // one already renders inline as a checkbox block down in noteArea, so
  // listing it here too would just be a duplicate.
  const dueElsewhere = dueReminders.filter((r) => r.documentId !== dailyDocId);

  async function toggleDueReminder(task: { id: string; checked: boolean; documentId: string }) {
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

  return (
    <View style={styles.container}>
      {/* Same fixed gradient as DocumentsScreen. The daily-note editor
          below (`noteArea`) stays white on its own - it's the embedded
          DocumentEditorScreen's own opaque white background, painted over
          this gradient, not a separate override here. */}
      {/* 1px bled past every edge - windowWidth/Height can round to a hair
          less than the actual screen, leaving a sliver of the default
          white background visible at an edge otherwise. */}
      <Svg
        width={windowWidth + 2}
        height={windowHeight + 2}
        style={[StyleSheet.absoluteFill, { top: -1, left: -1 }]}
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="calendarBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.03" stopColor="#705648" />
            <Stop offset="0.52" stopColor="#69736E" />
            <Stop offset="1" stopColor="#000000" />
          </LinearGradient>
        </Defs>
        <Rect width={windowWidth + 2} height={windowHeight + 2} fill="url(#calendarBg)" />
      </Svg>

      <View style={styles.headerRow}>
        <View style={styles.headerLeft}>
          <Pressable style={styles.todayButton} onPress={jumpToToday}>
            <Text style={styles.todayButtonLabel}>Сьогодні</Text>
          </Pressable>
          <Pressable
            style={styles.headerDateTap}
            disabled={!isWriting}
            onPress={() => Keyboard.dismiss()}
          >
            <Text style={styles.headerDateLabel} numberOfLines={1}>
              {WEEKDAY_SHORT[mondayIndex(selectedDate)]}, {formatBigDate(selectedDate)}
            </Text>
            {isWriting && <Ionicons name="chevron-down" size={12} color="rgba(255,255,255,0.7)" />}
          </Pressable>
        </View>
        <View style={styles.headerRightGroup}>
          {/* A separate circle, not a 4th icon inside the capsule - folded
              into the pill it read as just another button, which it isn't
              (nothing happens when you tap it). */}
          <View style={[styles.saveDot, noteSaveStatus === 'saved' && styles.saveDotSaved]}>
            <Ionicons name="checkmark" size={17} color={noteSaveStatus === 'saved' ? '#171310' : '#fff'} />
          </View>
          <View style={styles.headerButtons}>
            {/* The one wide-screen switch: two day sheets, or a single
                sheet with the calendar opened out beside it. */}
            {isTwoPane && (
              <>
                <Pressable hitSlop={6} onPress={() => setWideLayout((v) => (v === 'pages' ? 'columns' : 'pages'))}>
                  <Ionicons name={twoPages ? 'contract-outline' : 'expand-outline'} size={17} color="#fff" />
                </Pressable>
                <View style={styles.headerButtonsDivider} />
              </>
            )}
            <Pressable hitSlop={6} onPress={() => navigation.navigate('Diary')}>
              <Ionicons name="search" size={17} color="#fff" />
            </Pressable>
            <View style={styles.headerButtonsDivider} />
            <Pressable hitSlop={6} onPress={() => setMenuOpen((v) => !v)}>
              <Ionicons name="ellipsis-horizontal" size={17} color="#fff" />
            </Pressable>
            <View style={styles.headerButtonsDivider} />
            <Pressable hitSlop={6} onPress={() => noteEditorRef.current?.toggleSelectMode()}>
              <Ionicons name={noteSelectMode ? 'close' : 'ellipse-outline'} size={17} color="#fff" />
            </Pressable>
          </View>
        </View>
      </View>

      {menuOpen && <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)} />}
      {menuOpen && (
        <View style={styles.menuPanel}>
          <Pressable style={styles.menuRow} onPress={() => toggleCompactFilter('filled')}>
            <Ionicons name="filter-outline" size={17} color="#111827" />
            <Text style={styles.menuRowLabel}>Лише заповнені дні</Text>
            {compactFilter === 'filled' && <Ionicons name="checkmark" size={18} color={ACCENT} />}
          </Pressable>
          <Pressable style={styles.menuRow} onPress={() => toggleCompactFilter('history')}>
            <Ionicons name="time-outline" size={17} color="#111827" />
            <Text style={styles.menuRowLabel}>Лише дні з історією</Text>
            {compactFilter === 'history' && <Ionicons name="checkmark" size={18} color={ACCENT} />}
          </Pressable>
        </View>
      )}

      {/* Two layouts, nothing in between. Two day sheets with the week
          strip above them, or a single sheet with the calendar opened out
          beside it. On a narrow screen neither applies and the page below
          is the one it always was. */}
      {twoPages && <View onLayout={(e) => setCalendarPaneWidth(e.nativeEvent.layout.width)}>{renderCalendarPlate()}</View>}

      <View style={isTwoPane ? styles.paneRow : styles.stack}>
        {!twoPages && (
          <View
            style={isTwoPane ? styles.sidePane : undefined}
            onLayout={(e) => setCalendarPaneWidth(e.nativeEvent.layout.width)}
          >
            {renderCalendarPlate()}
            {/* One flex-wrap row for both capsules - the month one always here
                (unless a compact strip is active, same as before), the history
                one only on a day that actually has any (see DayHistoryList,
                which renders nothing at all when it doesn't). Wrapping lets
                the history capsule's own expanded list drop onto its own line
                below both pills instead of squeezing in beside them - see its
                width:'100%' body. */}
            {/* Narrow screens only: on a wide one the month is already open
                (so its capsule would toggle nothing) and the history is the
                list further down this column. */}
            {!foldedAway && !isTwoPane && (
              <View style={[styles.capsuleRow, isTwoPane && styles.calendarPlatePaned]}>
                {/* The month capsule IS the expand button, named after the month
                    it opens - with two panes the month is already open and it
                    would toggle nothing, so it goes away and the nav row inside
                    the plate (arrows + month name) carries the month instead. */}
                {!onlyFilledDays && !isTwoPane && (
                  <Pressable style={styles.monthCapsule} onPress={() => setIsMonthExpanded((prev) => !prev)}>
                    <Ionicons name="calendar-outline" size={14} color="rgba(255,255,255,0.75)" />
                    <Text style={styles.monthCapsuleLabel}>{MONTH_FULL[visibleMonth.month]}</Text>
                    <Ionicons name={isMonthExpanded ? 'chevron-up' : 'chevron-down'} size={14} color="rgba(255,255,255,0.6)" />
                  </Pressable>
                )}
                <DayHistoryList items={historyByDate.get(selectedKey) ?? []} />
              </View>
            )}

            {!foldedAway && dueElsewhere.length > 0 && (
              <View style={[styles.dueCard, isTwoPane && styles.calendarPlatePaned]}>
                {dueElsewhere.map((task, index) => (
                  <Pressable
                    key={task.id}
                    style={[styles.dueRow, index > 0 && styles.dueRowDivider]}
                    onPress={() => navigation.navigate('Editor', { documentId: task.documentId })}
                  >
                    <Pressable hitSlop={6} onPress={() => toggleDueReminder(task)}>
                      <Ionicons
                        name={task.checked ? 'checkbox' : 'square-outline'}
                        size={18}
                        color={task.checked ? ACCENT : '#9CA3AF'}
                      />
                    </Pressable>
                    <Text
                      style={[styles.dueReminderText, task.checked && styles.dueReminderTextChecked]}
                      numberOfLines={1}
                    >
                      {task.text}
                    </Text>
                  </Pressable>
                ))}
              </View>
            )}

            {/* Collapsing the note only makes sense while browsing "days with
                history" - that's the one strip where the note itself is often
                not the point of looking at the day at all, and having more
                history entries visible at once matters more than the note. */}
            {/* Collapsing the note only makes sense when it sits below the
                calendar - beside it, there's nothing to make room for. */}
            {!foldedAway && !isTwoPane && compactFilter === 'history' && (
              <Pressable style={styles.collapseNoteRow} onPress={() => setNoteCollapsed((v) => !v)}>
                <Ionicons name={noteCollapsed ? 'chevron-down' : 'chevron-up'} size={14} color="rgba(255,255,255,0.6)" />
                <Text style={styles.collapseNoteLabel}>{noteCollapsed ? 'Показати нотатку дня' : 'Згорнути нотатку дня'}</Text>
              </Pressable>
            )}

            {/* The day's history lives under the calendar, in the same
                column - there is no third column any more. */}
            {isTwoPane && (
              <View style={styles.historyUnderCalendar}>
                <DayHistoryList items={historyByDate.get(selectedKey) ?? []} fill />
              </View>
            )}
            </View>
        )}

        {!(compactFilter === 'history' && noteCollapsed) && renderDayNote(selectedKey, selectedDate, true)}
        {twoPages && renderDayNote(nextKey, nextDate, false)}
      </View>

    </View>
  );
}

// The circle is a View and the number a plain Text inside it, and the border
// is always there (transparent when it shouldn't show) - a Text that itself
// carries the background/border and changes them between states is what
// Android renders unreliably, and it also keeps selecting a day from
// changing any measurement.
function DayCell({
  date,
  isToday,
  isSelected,
  muted,
  filled,
  hasHistory,
  inGrid,
  compact,
  height,
  onPress,
}: {
  date: Date;
  isToday: boolean;
  isSelected: boolean;
  muted?: boolean;
  // Real note or reminder on this day - shown as a small white dot under
  // the number. Not meaningful in `compact` mode (both compact strips only
  // ever show days that already match their own criterion to begin with).
  filled?: boolean;
  // Something (file/photo/link/document/board/task/sticker/database row or
  // view) was added this day - a second, blue dot, independent of `filled`:
  // a day can have history with no note of its own, or a note with nothing
  // else added.
  hasHistory?: boolean;
  inGrid?: boolean;
  // The "only filled days" strip's own cell shape: a day.month pill instead
  // of a plain day-number circle, since these dates jump around freely and
  // a bare "8" would be ambiguous about which month it's in.
  compact?: boolean;
  // The row height this cell has to fill - it shrinks when the calendar
  // sits in a column (see rowHeight above), and the two must agree or the
  // grid's own clipped height and its cells drift apart.
  height?: number;
  onPress: () => void;
}) {
  const numColor = isToday ? styles.dayNumToday : muted ? styles.dayNumMuted : null;
  return (
    <Pressable
      style={[
        compact ? styles.filledDayCell : inGrid ? styles.gridCell : styles.dayCell,
        height !== undefined && { height },
      ]}
      onPress={onPress}
    >
      <View
        style={[
          styles.dayCircle,
          compact && styles.dayPill,
          isSelected && !isToday && styles.dayCircleSelected,
          isToday && styles.dayCircleToday,
        ]}
      >
        {compact ? (
          <>
            <Text style={[styles.dayNum, styles.dayNumCompact, numColor]}>
              {String(date.getDate()).padStart(2, '0')}
            </Text>
            <Text style={[styles.dayMonthCompact, numColor]}>
              .{String(date.getMonth() + 1).padStart(2, '0')}
            </Text>
          </>
        ) : (
          <Text style={[styles.dayNum, numColor]}>{date.getDate()}</Text>
        )}
        {!compact && (filled || hasHistory) && (
          <View style={styles.dotsRow}>
            {filled && <View style={[styles.filledDot, isToday && styles.filledDotOnToday]} />}
            {hasHistory && <View style={styles.historyDot} />}
          </View>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    paddingHorizontal: 20,
    // Matches DocumentsScreen's own header capsule's vertical position.
    paddingTop: 90,
    paddingBottom: 8,
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flexShrink: 1,
  },
  // Always visible (not just when already on today) - its job now is
  // pulling the week strip/month grid back after paging away with a swipe,
  // which only makes sense if it's there to tap regardless of where the
  // calendar currently is.
  todayButton: {
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  todayButtonLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    fontFamily: FONT_SEMIBOLD,
    color: '#171310',
  },
  headerDateTap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    flexShrink: 1,
  },
  headerDateLabel: {
    fontSize: 14.5,
    fontWeight: '700',
    fontFamily: FONT_SEMIBOLD,
    color: '#fff',
  },
  headerRightGroup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  // Search (→ DiaryScreen) + "..." (the only-filled-days menu) merged into
  // one elongated glass capsule, same as DocumentsScreen's headerButtons.
  headerButtons: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 38,
    borderRadius: 19,
    paddingHorizontal: 14,
    backgroundColor: 'rgba(20,20,20,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  headerButtonsDivider: {
    width: 1,
    height: 16,
    backgroundColor: 'rgba(255,255,255,0.3)',
  },
  // Dark-glass circle while saving (matching the capsule beside it), solid
  // white once saved - diameter equals the capsule's own height so the two
  // shapes read as a matched pair, not a stray small dot next to a much
  // taller pill.
  saveDot: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(20,20,20,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  saveDotSaved: {
    backgroundColor: '#fff',
    borderColor: 'transparent',
  },
  menuBackdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 5,
  },
  menuPanel: {
    position: 'absolute',
    top: 96,
    right: 20,
    width: 260,
    backgroundColor: '#fff',
    borderRadius: 14,
    padding: 6,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    zIndex: 6,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 8,
  },
  menuRowLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: '#111827',
  },
  // The glass plate under the calendar's numbers - a separate, unanimated
  // wrapper (see calendarPlate below) rather than styling this directly:
  // calendarWrap's own height is animated (week strip <-> month grid), and
  // padding added here would eat into that fixed height's content area
  // instead of sitting outside it.
  calendarWrap: {
    overflow: 'hidden',
  },
  // Flush with the header above (square top), rounded only at the bottom.
  calendarPlate: {
    backgroundColor: 'rgba(20,20,20,0.25)',
    borderColor: 'rgba(255,255,255,0.25)',
    borderRadius: 22,
    marginHorizontal: 16,
    overflow: 'hidden',
  },
  // Between the calendar and the note there were two margins (the plate's
  // and the note's) where between the note and the history there is one -
  // so the same gap read wider on the left than on the right. The plate
  // drops its own on that side and both come out at 16.
  calendarPlatePaned: {
    marginRight: 0,
  },
  monthNavWrap: {
    overflow: 'hidden',
  },
  monthNav: {
    height: MONTH_NAV_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
  },
  monthNavLabel: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: '#fff',
  },
  weekdayHeader: {
    height: WEEKDAY_HEADER_HEIGHT,
    flexDirection: 'row',
    paddingHorizontal: 16,
  },
  weekdayHeaderLabel: {
    flex: 1,
    textAlign: 'center',
    fontSize: 12,
    color: '#fff',
    fontWeight: '500',
    fontFamily: FONT_MEDIUM,
  },
  gridClip: {
    overflow: 'hidden',
  },
  calendarLayer: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
  },
  weekScroll: {
    flexGrow: 0,
    height: WEEK_AREA_HEIGHT,
  },
  weekPage: {
    flexDirection: 'row',
    paddingHorizontal: 16,
  },
  dayCell: {
    flex: 1,
    height: ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  // The "only filled days" strip's own cell - taller, using the row height
  // reclaimed from the hidden weekday header (see FILLED_ROW_HEIGHT).
  filledDayCell: {
    flex: 1,
    height: FILLED_ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthGrid: {
    paddingHorizontal: 16,
  },
  monthGridRow: {
    flexDirection: 'row',
  },
  gridCell: {
    flex: 1,
    height: ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayCircle: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
    position: 'relative',
  },
  // The "only filled days" strip's cell - a rounded rect wide enough for
  // "08" over ".09" instead of the plain week/month circle.
  dayPill: {
    width: 42,
    height: 54,
    borderRadius: 14,
  },
  dayCircleSelected: {
    borderColor: '#D1D5DB',
  },
  dayCircleToday: {
    backgroundColor: '#fff',
    borderColor: '#fff',
  },
  dayNum: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: '#fff',
  },
  dayNumCompact: {
    fontSize: 18,
    lineHeight: 21,
  },
  dayMonthCompact: {
    fontSize: 12,
    lineHeight: 14,
    fontFamily: FONT_MEDIUM,
    color: 'rgba(255,255,255,0.7)',
  },
  dayNumMuted: {
    // Was a light gray for "faint against white" - on the now-dark
    // gradient that read backwards (brighter than the regular white
    // dayNum), so muted is dim translucent white instead.
    color: 'rgba(255,255,255,0.35)',
  },
  dayNumToday: {
    color: '#111827',
  },
  // A day with a real note or reminder - a small dot under its number,
  // inside the same circle (there's no spare row height to place it below
  // the circle without growing ROW_HEIGHT). White to match the ordinary
  // white day number it sits under; on today's own white-filled circle the
  // number is dark instead, so the dot switches to match it there too -
  // otherwise it would vanish against that white background.
  // Holds both dots side by side (rather than each absolutely positioned
  // on its own) so having both never overlaps them into one blob.
  dotsRow: {
    position: 'absolute',
    bottom: 4,
    flexDirection: 'row',
    gap: 3,
  },
  filledDot: {
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: '#fff',
  },
  filledDotOnToday: {
    backgroundColor: '#111827',
  },
  // A saturated blue reads clearly against both the plain dark cell and
  // today's white circle, so unlike filledDot this one never needs a
  // second on-today variant.
  historyDot: {
    width: 3.5,
    height: 3.5,
    borderRadius: 2,
    backgroundColor: '#60A5FA',
  },
  // The column/row that holds the calendar and the note - see the comment
  // at its own JSX.
  stack: {
    flex: 1,
  },
  paneRow: {
    flex: 1,
    flexDirection: 'row',
  },
  // Under the calendar, lined up with it: same left margin, same dropped
  // right one, so this column has one straight edge on each side.
  historyUnderCalendar: {
    flex: 1,
    marginLeft: 16,
    marginRight: 0,
    marginTop: 10,
  },
  pageDateLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9CA3AF',
    paddingHorizontal: 16,
    paddingTop: 10,
  },
  // The calendar's column against the sheet beside it: the sheet takes a
  // little more, since it's the half whose content is text being written
  // rather than a grid and a list of cards that size themselves.
  sidePane: {
    flex: 1,
  },
  notePane: {
    flex: 1.3,
  },
  capsuleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 8,
    marginHorizontal: 16,
    // Equal above and below: the calendar plate sits flush on top of this
    // row (its height is exactly its own rows, no bottom padding), so
    // without the top margin the capsules hug the calendar while keeping a
    // gap to the note sheet under them.
    marginTop: 8,
    marginBottom: 8,
  },
  // Same frosted-glass pill every capsule on this dark background uses
  // (ProjectTabsRow's tabs, the database screens' own controls) - named
  // for whichever month it would expand into, so the label itself says
  // what tapping it does.
  monthCapsule: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 999,
    backgroundColor: 'rgba(20,20,20,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  monthCapsuleLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: 'rgba(255,255,255,0.85)',
  },
  noteArea: {
    flex: 1,
    marginHorizontal: 16,
    borderRadius: 16,
    overflow: 'hidden',
  },
  collapseNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    alignSelf: 'flex-start',
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 4,
  },
  collapseNoteLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.6)',
  },
  dueCard: {
    backgroundColor: '#fff',
    borderRadius: 16,
    marginHorizontal: 16,
    marginTop: 10,
    marginBottom: 4,
    paddingVertical: 2,
  },
  dueRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  dueRowDivider: {
    borderTopWidth: 1,
    borderStyle: 'dashed',
    borderTopColor: '#E5E1D8',
  },
  dueReminderText: {
    flex: 1,
    fontSize: 13.5,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: '#111827',
  },
  dueReminderTextChecked: {
    textDecorationLine: 'line-through',
    opacity: 0.5,
  },
});
