import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRecordColour, useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import {
  BackHandler,
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
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import { hapticButtonDown } from '../utils/haptics';
import Animated, {
  Easing,
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useIsFocused, useNavigation, useRoute } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  query,
  updateDoc,
  where,
} from '../firestore';
import { ownedQuery, setDoc } from '../utils/owned';
import { db } from '../firebase';
import { Block, Recurrence } from '../types';
import { createTaskOnDate } from '../utils/copyToNote';
import { nextRecurrenceDate } from '../utils/recurrence';
import { ReminderKind } from '../utils/reminders';
import { RootStackParamList } from '../navigation';
import DocumentEditorScreen, { DocumentEditorHandle } from './DocumentEditorScreen';
import { hasNoteContent } from '../utils/documentPreview';
import { useDayHistory } from '../hooks/useDayHistory';
import DayHistoryList from '../components/DayHistoryList';
import { useDensity } from '../hooks/useDensity';
import DocumentCard from '../components/DocumentCard';
import DayPageMiniature from '../components/DayPageMiniature';
import { extractPreview } from '../utils/documentPreview';
import { usePublishRailPanel } from '../navigation/navRail';
import { useResponsiveLayout } from '../hooks/useResponsiveLayout';
import { FONT_BOLD, FONT_MEDIUM, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { DockMark, useDockActions, useDockBeads, useDockShowContext, useNavDockFace, useNavDockPublisher, useTopBack } from '../navigation/navDock';
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
import { BlurView } from 'expo-blur';
import { GlassPortal } from '../components/GlassPortal';
import { useBlurTarget } from '../components/GlassTarget';
import SaveRing from '../components/SaveRing';
import GlassDrop, { GlassIcon } from '../components/GlassDrop';
import ScreenBackdrop from '../components/ScreenBackdrop';
import { useDockClearance } from '../navigation/dockGeometry';
import { CAPSULE_DROP, CHROME_TOP, RAIL_RIGHT, RAIL_WIDTH } from '../constants/rail';
import Menu from '../components/surfaces/Menu';
import { listenError } from '../utils/listenError';
import { TOP_NAV_SPACE, useTopNavOn } from '../components/TopNavBar';
import { useGoToPreviousDesk } from '../navigation/deskOrder';

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
// The calendar's own column where a cursor is reading the screen. Half
// the window is what a FINGER needs: there the month grid is the thing
// being touched. With a pointer the day's sheet is the page and the
// month is a reference standing beside it - the user's own words,
// "календар ... повинен знаходитися праворуч від аркуша ... і вони
// повинні бути меншими". 360 fits seven 46px columns and the history
// cards under them without either having to wrap.
const DESKTOP_CALENDAR_WIDTH = 360;
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
// Between "Сьогодні"/the date and the calendar under them.
const HEADER_GAP = 8;
// The "only filled days" strip has no weekday header (its dates aren't a
// real calendar week, so weekday letters would be meaningless) - that
// reclaimed height goes straight into taller day cells instead of just
// being removed, which is also why the two heights sum to the same total
// as WEEK_AREA_HEIGHT + WEEKDAY_HEADER_HEIGHT (see calendarWrapStyle).
const FILLED_ROW_HEIGHT = ROW_HEIGHT + WEEKDAY_HEADER_HEIGHT;

export default function CalendarScreen() {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const accent = theme.sections.calendar;
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
  const { isTwoPane, isThreePane } = useResponsiveLayout();
  const pointerDensity = useDensity() === 'pointer';
  // The calendar's own column, measured rather than assumed: in two panes
  // the window is no longer the space the strip has, and a strip whose
  // pages are sized against the wrong width is exactly how this screen
  // broke twice (see PLATE_MARGIN's comment above).
  const [calendarPaneWidth, setCalendarPaneWidth] = useState(0);
  // Either column can be put away to give the note the room - both at once
  // is "the note full screen", which is what the button on the note itself
  // toggles. Only ever applies while there are columns to hide.
  const [showCalendarPane, setShowCalendarPane] = useState(true);
  const [showHistoryPane, setShowHistoryPane] = useState(true);
  // The plate no longer keeps PLATE_MARGIN on BOTH sides: its right edge
  // is the rail's, so a page sized against 16 twice is 74 too wide and the
  // last day of the week drops off the end - which is exactly the failure
  // PLATE_MARGIN's own comment above describes, arriving a third time.
  // The rail is gone from this screen, so nothing has to stand clear of
  // it - the calendar plate gets the width back.
  const plateRightMargin = 20;
  //
  // While the pane is not yet measured (the first frame, and the frame
  // after a turn) the fallback must be a PANE'S width, not the window's.
  // A child does not shrink in React Native, so a grid laid out to the
  // whole window pushed its pane out to the window's width - and the
  // measurement then recorded that widened pane, which locked it in.
  // That is the "note too narrow until the app is reopened" the user saw
  // lying down.
  //
  // Side by side, the calendar's column is GIVEN a width rather than
  // measured. Flex alone could not hold it: the month grid inside is laid
  // out in exact pixels, and a flex item will not shrink below its
  // content unless every wrapper between them says it may - so the column
  // grew to fit the grid, the grid was sized from the column, and the two
  // fed each other. The note kept whatever was left, which is the narrow
  // sheet the user saw. 1 / (1 + 1.3) is the share the two flex values
  // always meant it to have.
  // Standing up the calendar shares a band with the history instead, and
  // there the measured half is right - so this is the lying-down case
  // only. Spelled out rather than reusing stackedWide, which is declared
  // further down with the rest of the writing state.
  const calendarPaneWidthFixed = !isTwoPane
    ? null
    : pointerDensity
      ? DESKTOP_CALENDAR_WIDTH
      : windowWidth >= windowHeight
        ? Math.floor(windowWidth / 2.3)
        : null;
  const paneFallback = isTwoPane ? windowWidth / 2 : windowWidth;
  const stripWidth =
    (calendarPaneWidthFixed ??
      (isTwoPane && calendarPaneWidth > 0 ? calendarPaneWidth : paneFallback)) -
    PLATE_MARGIN -
    plateRightMargin;
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
  // A pointer gets a FEED instead of a month grid beside the note: every
  // day that holds something, newest first, each drawn as the document
  // card it would be in the documents list - "видно весь контент як на
  // самих великих картках". The fill is then visible without a filter,
  // which is why the filter button is gone on this density: it was a
  // control describing something that can simply be shown.
  const feedMode = pointerDensity && isTwoPane;
  // THE OVERVIEW, on a phone: the day's page zooms out into the same feed
  // of big day cards, newest at the top, the day you were on first in
  // view and the ones before it below. Two ways in, both the user's
  // choice: two fingers pinched together on the page, or a pull on past
  // the end of it. Only filled days; a tap on one opens it.
  const phoneOverview = !isTwoPane && !pointerDensity;
  const [overviewOpen, setOverviewOpen] = useState(false);
  const [dayFeedLoaded, setDayFeedLoaded] = useState(false);
  const [dayFeed, setDayFeed] = useState<
    { key: string; title: string; blocks: Block[]; coverImageUri?: string; coverGradient?: string; coverDriveFileId?: string; updatedAt: number }[]
  >([]);
  // Read AHEAD, while the calendar is on screen on a phone - not only
  // once the overview opens. Read on opening, the days above yours
  // arrived mid-zoom and turned from short cards into pages under the
  // finger, pushing the list about while it was still landing.
  const calendarFocusedForFeed = useIsFocused();
  useEffect(() => {
    if (!feedMode && !overviewOpen && !(phoneOverview && calendarFocusedForFeed)) return;
    // No range on calendarDate. Firestore needs a composite index for an
    // equality and a range on two different fields, and ownedQuery's
    // ownerId is that equality - so `where('calendarDate', ...)` is
    // refused outright with failed-precondition until someone creates
    // one by hand in the console. The days are picked out here instead:
    // this is one person's own documents, tens of them, and reading
    // them all costs less than a backend that has to be set up by hand
    // before the screen works.
    return onSnapshot(
      ownedQuery('documents'),
      (snapshot) => {
        const items = snapshot.docs
          .map((d) => {
            const data = d.data();
            return {
              key: data.calendarDate as string,
              title: (data.title as string) ?? '',
              blocks: (data.blocks as Block[]) ?? [],
              coverImageUri: data.coverImageUri as string | undefined,
              coverGradient: data.coverGradient as string | undefined,
              coverDriveFileId: data.coverDrive?.fileId as string | undefined,
              updatedAt: (data.updatedAt as number) ?? 0,
            };
          })
          .filter((i) => !!i.key && hasNoteContent(i.title, i.blocks))
          .sort((a, b) => (a.key < b.key ? 1 : -1));
        setDayFeed(items);
        setDayFeedLoaded(true);
      },
      () => {
        setDayFeed([]);
        setDayFeedLoaded(true);
      }
    );
  }, [feedMode, overviewOpen, phoneOverview, calendarFocusedForFeed]);
  // 0 = the page, 1 = the overview. The page shrinks toward a card as the
  // feed comes in over it, slightly larger than it will settle - one
  // zoom, drawn by two layers.
  const overviewSV = useSharedValue(0);
  // The fingers' own scale while the page is being pinched; 1 otherwise.
  const pinchScale = useSharedValue(1);
  const overviewOpenRef = useRef(false);
  const overviewScrolledRef = useRef(false);
  const overviewScrollRef = useRef<ScrollView>(null);
  // Where the page stands, so the overview can put the day's miniature
  // exactly where the page shrinks to - the page and its miniature are
  // then one sheet changing, not two things swapping.
  const stackYRef = useRef(0);
  const noteRectRef = useRef<{ y: number; width: number; height: number } | null>(null);
  const containerHRef = useRef(0);
  function updatePageShift() {
    const rect = noteRectRef.current;
    const containerH = containerHRef.current;
    if (!rect || !containerH) return;
    pageShiftSV.value = containerH / 2 - (stackYRef.current + rect.y + rect.height / 2);
  }
  // A MONTH AT A TIME, the way Craft does it: the overview opens on the
  // month of the day you were on, and the next month is drawn only when
  // the list is pulled to its end - where Android's own stretch holds
  // the edge for the moment that takes. Months with nothing in them are
  // skipped: a step is always to the next month that HAS a day.
  const [overviewMonths, setOverviewMonths] = useState<{ older: string; newer: string } | null>(null);
  // For the length of the zoom only the day and its near neighbours are
  // mounted; the rest of the month follows once the page has landed, so
  // a month of real pages is not laid out under a running animation.
  const [overviewWarm, setOverviewWarm] = useState(false);
  function openOverview() {
    if (overviewOpenRef.current) return;
    overviewOpenRef.current = true;
    overviewScrolledRef.current = false;
    setOverviewMonths(null);
    setOverviewWarm(false);
    setTimeout(() => setOverviewWarm(true), 380);
    Keyboard.dismiss();
    setOverviewOpen(true);
    overviewSV.value = withTiming(1, { duration: 300, easing: Easing.out(Easing.cubic) });
  }
  function closeOverview() {
    if (!overviewOpenRef.current) return;
    overviewOpenRef.current = false;
    // Hidden behind a page at exactly the shrunk size, so resetting the
    // fingers' scale here shows nothing; the page then grows from it.
    pinchScale.value = 1;
    overviewSV.value = withTiming(0, { duration: 280, easing: Easing.out(Easing.cubic) }, (done) => {
      if (done) runOnJS(setOverviewOpen)(false);
    });
  }
  const openOverviewRef = useRef(openOverview);
  openOverviewRef.current = openOverview;
  const openOverviewFromGesture = useCallback(() => openOverviewRef.current(), []);
  // Built once per state, not per render - a gesture handed a new
  // configuration on every render is a gesture that never activates.
  const notePinch = useMemo(
    () =>
      Gesture.Pinch()
        .enabled(phoneOverview && !overviewOpen)
        .onUpdate((e) => {
          pinchScale.value = Math.min(1, Math.max(0.6, e.scale));
        })
        .onEnd((e) => {
          if (e.scale < 0.85) runOnJS(openOverviewFromGesture)();
          else pinchScale.value = withTiming(1, { duration: 180 });
        })
        .onFinalize((_e, success) => {
          if (!success) pinchScale.value = withTiming(1, { duration: 180 });
        }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [phoneOverview, overviewOpen]
  );
  const OVERVIEW_PAGE_SCALE = 0.82;
  // How far the page's centre has to travel to the screen's centre,
  // where its miniature stands - "перша картка має бути прям по центру".
  const pageShiftSV = useSharedValue(0);
  // The page SHRINKS the whole way, visibly, and only in the last fifth
  // does it hand over to its miniature ("анімація звужування від цілого
  // полотна до такого вигляду") - it used to be half gone before it was
  // half the size. It travels to the centre in step with its shrinking,
  // so fingers and the pull both land it in the same place.
  // THE HAND-OVER WITHOUT A BLINK: the page stays fully opaque until the
  // miniature above it has fully faded in over it, and only then goes.
  // Fading both at once let the dark ground show through the middle of
  // the crossfade - "перехід відбувається блиманням". Coming back it is
  // the same the other way: the page is whole again the moment the
  // overview starts to leave, and the miniature fades off it.
  const noteZoomStyle = useAnimatedStyle(() => {
    const p = overviewSV.value;
    const shrink = pinchScale.value + (OVERVIEW_PAGE_SCALE - pinchScale.value) * p;
    const toward = Math.min(1, Math.max(0, (1 - shrink) / (1 - OVERVIEW_PAGE_SCALE)));
    return {
      opacity: p >= 0.999 ? 0 : 1,
      transform: [{ translateY: toward * pageShiftSV.value }, { scale: shrink }],
    };
  });
  // The other days come in as the page shrinks...
  // Not from the very start: while the page is still nearly full size
  // its edges reach past where the neighbours stand.
  const overviewEarlyStyle = useAnimatedStyle(() => ({
    opacity: Math.min(1, Math.max(0, (overviewSV.value - 0.4) / 0.6)),
  }));
  // The heading and whatever stands above the page, going as it shrinks.
  const overviewFadeStyle = useAnimatedStyle(() => ({
    opacity: Math.max(0, 1 - overviewSV.value * 1.4),
  }));
  // ...and the day's own miniature only as the page hands over.
  const overviewLateStyle = useAnimatedStyle(() => ({
    opacity: overviewSV.value < 0.8 ? 0 : (overviewSV.value - 0.8) / 0.2,
  }));
  useEffect(() => {
    if (!overviewOpen) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      closeOverview();
      return true;
    });
    return () => sub.remove();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [overviewOpen]);
  const overviewClear = useDockClearance();
  const historyDatesSorted = useMemo(() => Array.from(historyDates).sort(), [historyDates]);
  const activeDatesSorted = compactFilter === 'history' ? historyDatesSorted : filledDatesSorted;
  const [dueReminders, setDueReminders] = useState<
    {
      id: string;
      text: string;
      checked: boolean;
      documentId: string;
      reminderTime?: string;
      reminderDate?: string;
      reminderKind?: ReminderKind;
      groupId?: string;
      listId?: string;
      recurrence?: Recurrence;
    }[]
  >([]);
  // The capsule stands on the rail at the right edge now, drawn through
  // the portal for its blur - so it has to withdraw when the calendar
  // isn't the screen on show.
  const [historyExpanded, setHistoryExpanded] = useState(false);
  // "Сьогодні" and the date sit above the calendar, and the calendar has
  // to start on the capsule's own line - so the row's top padding is
  // whatever is left once its content and the gap under it are taken off
  // that line. Measured from the content itself, which doesn't depend on
  // the padding, rather than from the row, which would chase itself.
  const [headerContentHeight, setHeaderContentHeight] = useState(0);
  const calendarBlurTarget = useBlurTarget();
  const calendarFocused = useIsFocused();
  const calendarInsets = useSafeAreaInsets();
  // The desks bar stands at the top on a phone (TopNavBar): everything
  // here starts below it.
  const topNavOn = useTopNavOn();
  const navSpace = topNavOn ? TOP_NAV_SPACE : 0;
  const capsuleTop = calendarInsets.top + CHROME_TOP + CAPSULE_DROP + navSpace;
  const headerPadTop = Math.max(calendarInsets.top + 8 + navSpace, capsuleTop - headerContentHeight - HEADER_GAP);
  // Mirrors the embedded note editor's own internal state (see
  // DocumentEditorScreen's onSelectModeChange/onSaveStatusChange) so this
  // screen's own header capsule can show the right icon/checkmark for
  // whichever day's note is currently mounted - noteEditorRef is how the
  // header's select button reaches back down to actually toggle it.
  const [noteSelectMode, setNoteSelectMode] = useState(false);
  const [noteSaveStatus, setNoteSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
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
  // With two panes the month is simply always open - the week strip is the
  // collapsed form of the same cells, and there's room for all six rows.
  const monthOpen = isTwoPane || isMonthExpanded;
  // The calendar folds away under the keyboard only when the note is
  // BELOW it. Side by side, typing in the note has no reason to take the
  // calendar off the screen.
  // The Fold's inner screen STANDING UP. Side by side there gives the
  // calendar a column half a phone wide and the note another; the user's
  // own arrangement is better: the calendar and the day's history share
  // the top, level with each other, and the sheet takes the whole width
  // below them. Writing lifts the sheet over both, the way it folds the
  // calendar away on a phone.
  const stackedWide = isTwoPane && windowHeight > windowWidth;
  // Turning the screen makes every measured width a lie until the next
  // layout pass. Dropping it to zero falls back to the window's own width
  // for that one frame, which is wrong by a little; keeping it is wrong by
  // a whole orientation.
  useEffect(() => {
    setCalendarPaneWidth(0);
  }, [windowWidth, windowHeight]);
  // And on every arrival. The calendar is a TAB: it stays mounted, so the
  // width it measured the last time it was on screen outlives the visit -
  // and if the screen changed shape while it was away (another tab in a
  // pane, the app resized), it comes back laid out to a width it no
  // longer has. That is the squeezed month grid the user met on tapping
  // through from the diary, which a turn of the screen put right because
  // a turn is the one thing that already reset this.
  useEffect(() => {
    if (calendarFocused) setCalendarPaneWidth(0);
  }, [calendarFocused]);
  const foldedAway = isWriting && (!isTwoPane || stackedWide);
  const noteFullscreen = !showCalendarPane && (!isThreePane || !showHistoryPane);
  function toggleNoteFullscreen() {
    const goingFull = !noteFullscreen;
    setShowCalendarPane(!goingFull);
    setShowHistoryPane(!goingFull);
  }
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
    }, listenError('CalendarScreen:calendarPrefs'));
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
    // Through ownedQuery, like every other read in the app: the
    // owner-only rules do not FILTER a query, they refuse one that cannot
    // prove it only asks for this account's own documents. Without the
    // ownerId condition Firestore denies the whole thing, the listener
    // throws, and the app goes down with it - which is exactly what
    // happened the first time the rules were published.
    // The range is applied HERE, not in the query. Asked of Firestore it
    // needs a composite index over ownerId and calendarDate that this
    // project never had - so this listener has been failing with
    // failed-precondition and falling into its own error handler, which
    // sets an empty set. The dots a day's note earns have therefore been
    // dark all along, and the screen said "nothing here" instead of
    // "the read was refused". Exactly the trap already written down as
    // firestore_silent_empty, this time sprung by an index rather than
    // by the rules.
    const filledQuery = ownedQuery('documents');
    return onSnapshot(filledQuery, (snapshot) => {
      const filled = new Set<string>();
      snapshot.docs.forEach((docSnapshot) => {
        const data = docSnapshot.data();
        const day = data.calendarDate as string | undefined;
        if (!day || day < monthStartKey || day > monthEndKey) return;
        if (hasNoteContent(data.title ?? '', data.blocks ?? [])) filled.add(day);
      });
      setNoteFilledDates(filled);
    },
    // Every listener needs one of these. A refused read - the rules, an
    // expired session - arrives here; without a handler it is thrown, and
    // an unhandled throw from a listener takes the app down rather than
    // dimming one calendar dot.
    () => setNoteFilledDates(new Set()));
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
    const remindersQuery = ownedQuery(
      'tasks',
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
    },
    () => setReminderFilledDates(new Set()));
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
  // The dock becomes the days - «план навігації», the shape the user
  // asked for in their own words: "зайшов у календар, тобі треба
  // прокрутити якесь число - ти по доку клацаєш". The week strip at the
  // top SHOWS the week; this is for MOVING through the days, under the
  // thumb, which is a different job and belongs at a different end of the
  // screen.
  //
  // SEVEN days are VISIBLE - the user's own correction, and the dock is
  // sized to exactly that. The run itself is the whole month with a week
  // either side, mounted and waiting off the edge, which is what lets the
  // strip SLIDE by a day instead of flicking from one set of seven to the
  // next. It is also exactly the range the two dot queries below already
  // cover, so no day in it can be missing its marks.
  const stripMonth = `${selectedDate.getFullYear()}-${selectedDate.getMonth()}`;
  const stripDays = useMemo(() => {
    const [year, month] = stripMonth.split('-').map(Number);
    const from = addDays(new Date(year, month, 1), -7);
    const to = addDays(new Date(year, month + 1, 0), 7);
    const days: Date[] = [];
    for (let day = from; day <= to; day = addDays(day, 1)) days.push(day);
    return days;
  }, [stripMonth]);
  const todayKey = dateKey(new Date());
  const selectedKeyForDock = dateKey(selectedDate);
  const stripItems = useMemo(
    () =>
      stripDays.map((day) => {
        const key = dateKey(day);
        // The user's own two dots, carried over from the calendar cells
        // with the same meanings and the same colours: ink for a day that
        // holds a note or a reminder, blue for a day something was added
        // on. They are how the user finds their way back to a day worth
        // returning to, so they belong in the navigation dock as much as
        // anywhere.
        const marks: DockMark[] = [];
        if (filledDates.has(key)) marks.push('ink');
        if (historyDates.has(key)) marks.push('accent');
        return {
          key,
          label: String(day.getDate()),
          // Not decoration: "орієнтуюся якраз по днях тижня".
          sub: WEEKDAY_SHORT[mondayIndex(day)],
          // TODAY is what the strip is oriented by - not the day you have
          // scrolled to, which is already in the middle. "Я хочу знати,
          // який справді день, а не до якого я домотав."
          anchor: key === todayKey,
          marks: marks.length ? marks : undefined,
        };
      }),
    [stripDays, todayKey, filledDates, historyDates]
  );
  // The calendar's own rail is gone: search is the left bead, and what
  // was the "…" menu's five switches is the stack's second card. They
  // were rows in a sheet because they are switches - but a switch with
  // its state ON THE ICON is a better switch than a row with a tick, and
  // it costs a press less.
  // Right bead: "today", and it never does two things at once. Away from
  // today, its ONE job is to bring you back - the move the strip cannot
  // make, since that walks a day at a time - and it shows you the day it
  // brought you to. Already on today, it walks a ring of two: the desks
  // and the days, over and over.
  //
  // The options card is deliberately NOT in that ring. The user's own
  // line: the bead is for the two places you go, and options are what
  // the swipe is for.
  // Named once, drawn in one of two places. On a pointer these are NOT
  // published: they stand at the head of the calendar's own column,
  // beside the month they act on, instead of on a toolbar over the sheet
  // they have nothing to do with - the user's call. Published AND drawn
  // would be the same control twice, which is the one thing the dock's
  // whole publish/subscribe shape exists to avoid.
  // The way back - to the desk before this one - stands at the top-left
  // of the desks bar (TopNavBar); search, opening the diary, is on the
  // left bead again.
  const toPreviousDesk = useGoToPreviousDesk('Календар');
  useTopBack(toPreviousDesk);
  const searchBead = calendarFocused
    ? { icon: 'search-outline', onPress: () => navigation.navigate('Diary') }
    : null;
  const todayBead = calendarFocused
      ? {
          icon: 'today-outline',
          active: selectedKeyForDock !== todayKey,
          onPress: () => {
            if (selectedKeyForDock !== todayKey) {
              jumpToToday();
              setDockFace('context');
              return;
            }
            setDockFace(dockFace === 'context' ? 'desks' : 'context');
          },
        }
      : null;
  // THE DOCK IS FOR PICKED BLOCKS NOW, and for nothing else here - the
  // user's own call. «Місяць» is gone: the date at the top of the screen
  // already opens the month, and it says which month it would open.
  // «Фільтр» is gone too: its "only the days that hold something" is
  // what the swipe up now shows, as whole pages. «Вибір» moved up beside
  // the date, opposite it. What is left is the history, which is the one
  // thing that still has nowhere else to stand - see the note below.
  // Nothing at all now. «Історія» was the last of them and it stands
  // under the opened month instead, as its own heading - the user's own
  // answer to where those cards belong: "при розгортанні календаря
  // верхньою кнопкою під ним з'явиться ще одна кнопка(заголовок)
  // розгортання карток історії".
  // THE DOCK'S MIDDLE IS THE CALENDAR'S OWN AGAIN (2026-09-26): the desks
  // went up to the bar at the top and left a hole, and what this screen
  // does goes in it - «Сьогодні» moved in from the right bead, the month,
  // the day's history, and choosing blocks. The right bead does what it
  // does everywhere, makes something - here, text: the pencil starts
  // writing in the day's note. While the note's blocks are being chosen,
  // the note's own actions hold the middle instead.
  const pencilBead = calendarFocused
    ? { icon: 'pencil-outline', onPress: () => noteEditorRef.current?.startWriting() }
    : null;
  const calendarActions =
    calendarFocused && !noteSelectMode
      ? [
          {
            key: 'today',
            icon: 'today-outline',
            label: 'Сьогодні',
            active: selectedKeyForDock !== todayKey,
            onPress: jumpToToday,
          },
          {
            key: 'month',
            icon: 'calendar-outline',
            label: 'Місяць',
            active: isMonthExpanded,
            onPress: () => setIsMonthExpanded((v) => !v),
          },
          {
            key: 'history',
            icon: 'time-outline',
            label: 'Історія',
            active: historyExpanded,
            onPress: () => {
              // The history lives under the opened month.
              if (!isMonthExpanded) setIsMonthExpanded(true);
              setHistoryExpanded((v) => !v);
            },
          },
          {
            key: 'select',
            icon: 'checkmark-circle-outline',
            label: 'Вибір',
            onPress: () => noteEditorRef.current?.toggleSelectMode(),
          },
        ]
      : null;
  useDockBeads(pointerDensity ? null : searchBead, pointerDensity ? null : pencilBead);
  useDockActions(pointerDensity ? null : calendarActions);
  // The same list, for the column head. A bead and an action differ only
  // in where the dock puts them, and this row has no such two places.
  const columnControls: { key: string; icon: string; active?: boolean; onPress: () => void }[] =
    pointerDensity
      ? [
          ...(searchBead ? [{ key: 'search', ...searchBead }] : []),
          ...(todayBead ? [{ key: 'today', ...todayBead }] : []),
          // In feed mode the rest have all gone somewhere better: today
          // to the rail with the month it belongs to, select onto the
          // sheet beside the day it acts on, and the filter nowhere at
          // all. Only search is left, and the user asked for it to stay
          // here - "пошук там залишиться".
          // Nothing else: the dock's own list is empty now (see
          // calendarActions), and everything that was in it either moved
          // beside the thing it acts on or stopped being a button.
        ].filter((c) => !(feedMode && c.key === 'today'))
      : [];
  const showContext = useDockShowContext();
  const [dockFace, setDockFace] = useNavDockFace();
  const publishToDock = useNavDockPublisher();
  const pickDay = useCallback((key: string) => selectDay(parseDateKey(key)), []);
  // NOT on a wide window. The strip is a scrubber for moving day to day
  // when the month grid cannot be on screen - and at this width it IS
  // on screen, right above (see `monthOpen`). Publishing it there put
  // the same control in the dock twice over, which is what the user
  // caught: "календарний вигляд нам в розгорнутому стані не потрібен бо
  // там вже є календар". With no context of its own the calendar's dock
  // becomes what every other screen's is at this width - the desks,
  // with its own actions in the permanent zone beside them.
  // ...and not while the MONTH is open either, for exactly the same
  // reason it is not published in two panes: the grid above is already
  // the days, and a strip of the same week under it says them twice.
  // `monthOpen` covers both (it is two-pane OR expanded), so the strip
  // narrows away behind the dock as the month unfolds and comes back out
  // as it folds - the user's own words for what should happen.
  // THE STRIP OF DAYS IS GONE - "календарну рейку прибираємо взагалі"
  // (2026-09-26). The calendar publishes no context of its own now; the
  // day is picked in the month, or with «Сьогодні».

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
    const next = compactFilter === mode ? 'none' : mode;
    await setDoc(calendarPrefsDoc, { compactFilter: next }, { merge: true });
  }

  // One switch, three states, walked in a ring: every day, then the days
  // that hold something, then the days something was added on.
  // Nothing calls this any more - «Фільтр» left the dock, and the swipe
  // up shows the days that hold something as whole pages instead. Kept
  // because the THIRD state it walked to has no such replacement: "only
  // the days something was added on" is reachable from nowhere now, and
  // this is what a control for it would call.
  async function cycleCompactFilter() {
    const next = compactFilter === 'none' ? 'filled' : compactFilter === 'filled' ? 'history' : 'none';
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
  const monthGrid = useMemo(
    () => getMonthGrid(visibleMonth.year, visibleMonth.month),
    [visibleMonth.year, visibleMonth.month]
  );
  // The grid is always 42 cells, but a month rarely spans all six weeks -
  // September 2026 ends on the fifth, and the sixth was a row of nothing
  // but next month's greyed-out numbers padding the plate out. Draw only
  // the rows this month reaches into.
  const monthRows = useMemo(() => {
    let last = 0;
    monthGrid.forEach((cell, i) => {
      if (cell.inMonth) last = Math.floor(i / 7);
    });
    return last + 1;
  }, [monthGrid]);
  const monthAreaHeight = rowHeight * monthRows;
  const filledRowHeight = rowHeight + WEEKDAY_HEADER_HEIGHT;
  // The band's height, standing up on the inner screen, WORKED OUT rather
  // than measured. Its only children are the calendar plate - whose
  // height is animated, so Yoga is not told about it in time - and the
  // history beside it; left to size itself the band came out a sliver
  // tall, and the sheet below climbed up over the calendar. This is the
  // plate's own arithmetic: its padding and border, the month bar, the
  // weekday header, and the rows of the grid (open, in two panes).
  const bandHeight =
    27 + 32 + 2 + MONTH_NAV_HEIGHT + (onlyFilledDays ? 0 : WEEKDAY_HEADER_HEIGHT) + monthAreaHeight;
  const weekRowHeight = onlyFilledDays ? filledRowHeight : rowHeight;
  // calendarPlate's own border/padding used to be plain (non-animated)
  // styling around calendarWrap - so even once calendarWrap's own height
  // animated down to 0 while writing, this border+padding stayed put as a
  // thin visible bar. Animating them down to 0 too here is what actually
  // makes the whole plate disappear.
  // Closed, the calendar is NOT a thin tray with a month's name in it -
  // it is nothing at all. The name lives in the day's own title above,
  // which already said the month and the year; keeping a second row to
  // repeat them was the same duplication this plan keeps removing, and
  // it was still charging most of the height the week strip used to.
  // ("Тільки заповнені дні" is the exception - its strip is the content,
  // not a month, so the plate stands for it.)
  const calendarPlateStyle = useAnimatedStyle(() => {
    const open = onlyFilledDays ? 1 : expandAmount.value;
    return {
      opacity: visibleAmount.value * open,
      // Padded out to the capsule's own height: 27 + the weekday header
      // (22) + a row (40) + 32 + the border comes to the same 123.
      paddingTop: 27 * visibleAmount.value * open,
      paddingBottom: 32 * visibleAmount.value * open,
      borderWidth: visibleAmount.value * open,
    };
  }, [onlyFilledDays]);
  // Folded no longer means "a week" - it means the month's NAME, and
  // nothing else. The week strip's job (moving from day to day) went to
  // the dock, where it is under the thumb; what is left up here is the
  // month's SHAPE, which the dock cannot show and which the user needs
  // only now and then ("інколи треба подивитись на місяць"). So the
  // month is something you ask for, not a standing charge for the
  // occasions you want it.
  const calendarWrapStyle = useAnimatedStyle(() => {
    // The month's name stands whether the grid is open or not: it is the
    // handle the grid opens from, and the answer to "which month am I
    // looking at" when it is closed.
    const gridHeight = onlyFilledDays ? weekRowHeight : monthAreaHeight * expandAmount.value;
    const weekdayHeight = onlyFilledDays ? 0 : WEEKDAY_HEADER_HEIGHT * expandAmount.value;
    // The month's own bar - its name and the arrows either side - belongs
    // to the GRID: it is how you walk from month to month, and there is
    // nothing to walk while the grid is shut.
    const navHeight = MONTH_NAV_HEIGHT * (onlyFilledDays ? 1 : expandAmount.value);
    return {
      height: (navHeight + weekdayHeight + gridHeight) * visibleAmount.value,
      opacity: visibleAmount.value,
    };
  }, [weekRowHeight, monthAreaHeight, onlyFilledDays]);
  const monthNavStyle = useAnimatedStyle(() => {
    const open = onlyFilledDays ? 1 : expandAmount.value;
    return { height: MONTH_NAV_HEIGHT * open, opacity: open };
  }, [onlyFilledDays]);
  const weekdayHeaderStyle = useAnimatedStyle(() => ({
    height: WEEKDAY_HEADER_HEIGHT * expandAmount.value,
    opacity: expandAmount.value,
    overflow: 'hidden',
  }));
  // Dragged up and down, the calendar folds between its week strip and its
  // month grid - the same value the button moves, moved by the finger.
  //
  // Strictly vertical, and it gives up the moment the movement reads as
  // sideways: there are three gestures on this screen and each has to keep
  // to its own direction - the week strip pages weeks horizontally, the
  // pager carries the tabs, and this folds the calendar.
  const expandAtDragStart = useSharedValue(0);
  const foldGesture = useMemo(
    () =>
      Gesture.Pan()
        // Nothing to fold beside the note (the month is always open
        // there), and nothing to fold in "only filled days" either - that
        // strip is not a real week, so there is no month behind it.
        .enabled(!isTwoPane && !onlyFilledDays)
        .activeOffsetY([-15, 15])
        .failOffsetX([-20, 20])
        .onBegin(() => {
          expandAtDragStart.value = expandAmount.value;
        })
        .onUpdate((e) => {
          // The drag is measured against the height the calendar actually
          // gains, so the grid follows the finger rather than a guess.
          const travel = Math.max(1, monthAreaHeight);
          const next = expandAtDragStart.value + e.translationY / travel;
          expandAmount.value = Math.min(1, Math.max(0, next));
        })
        .onEnd((e) => {
          // Where it lands: past halfway, or thrown hard enough in one
          // direction that stopping at the nearest state would feel like
          // the calendar ignored the throw.
          const open = e.velocityY > 400 ? true : e.velocityY < -400 ? false : expandAmount.value > 0.5;
          expandAmount.value = withTiming(open ? 1 : 0, {
            duration: 220,
            easing: Easing.out(Easing.cubic),
          });
          runOnJS(setIsMonthExpanded)(open);
        }),
    [isTwoPane, onlyFilledDays, monthAreaHeight, weekRowHeight, expandAmount, expandAtDragStart]
  );

  // Held down, the calendar shows the day's history under it; held again,
  // it puts it away. The same plate the fold gesture lives on - the two
  // cannot be confused, since one needs the finger to travel and the
  // other needs it to stay still.
  const historyGesture = useMemo(
    () =>
      Gesture.LongPress()
        .enabled(!isTwoPane)
        .minDuration(400)
        // Plainly on the JS thread. It was handing React's setter an
        // updater FUNCTION through runOnJS, and a function cannot cross
        // to the UI thread and back - so the toggle only ever went one
        // way and a second hold did nothing.
        .runOnJS(true)
        .onStart(() => {
          hapticButtonDown();
          setHistoryExpanded((v) => !v);
        }),
    [isTwoPane]
  );
  const plateGesture = useMemo(
    () => Gesture.Simultaneous(foldGesture, historyGesture),
    [foldGesture, historyGesture]
  );

  // Closed, there is no grid at all any more - only the month's name
  // above it. The "only filled days" strip is the exception: it is not a
  // week and has no month behind it, so it simply stands.
  const gridClipStyle = useAnimatedStyle(() => ({
    height: onlyFilledDays ? weekRowHeight : monthAreaHeight * expandAmount.value,
  }), [weekRowHeight, monthAreaHeight, onlyFilledDays]);
  const weekLayerStyle = useAnimatedStyle(() => ({ opacity: 1 - expandAmount.value }));
  const monthLayerStyle = useAnimatedStyle(() => ({ opacity: expandAmount.value }));

  useEffect(() => {
    if (!isTwoPane) {
      setShowCalendarPane(true);
      setShowHistoryPane(true);
    }
  }, [isTwoPane]);

  // One day's sheet. `primary` is the selected day's - the one the header's
  // save dot and select-mode button drive, and the only one that needs the
  // ref.
  function renderDayNote(key: string, primary: boolean) {
    const zooms = primary && phoneOverview;
    const note = (
      <Animated.View
        onLayout={
          zooms
            ? (e) => {
                const { y, width, height } = e.nativeEvent.layout;
                noteRectRef.current = { y, width, height };
                updatePageShift();
              }
            : undefined
        }
        style={[
          styles.noteArea,
          isTwoPane && styles.notePane,
          stackedWide && styles.noteBelow,
          // The white belongs to the EMBEDDED EDITOR, not to this frame -
          // so a heading added above the editor landed on the app's dark
          // ground, over the page rather than on it. The frame carries
          // the same paper, and the date is on the sheet.
          pointerDensity && styles.notePaper,
          zooms && noteZoomStyle,
        ]}
      >
        {/* The day IS the page's title, so on a pointer it stands ON the
            sheet, where a document's own name stands, instead of in a
            small line floating above it. A daily note has no title of its
            own to collide with - the date is the only name it will ever
            have. */}
        {pointerDensity && primary && (
          <View style={styles.sheetHead}>
            <Text style={styles.sheetDate}>
              {WEEKDAY_SHORT[mondayIndex(selectedDate)]}, {formatBigDate(selectedDate)}
            </Text>
            <SaveRing saving={noteSaveStatus === 'saving'} color={theme.paper.inkMuted} />
            <View style={styles.sheetHeadSpace} />
            {/* Block select, standing opposite the day it acts on. It
                came off the toolbar, and this is now the ONLY way into
                it for a daily note - so it moves in the same step it is
                removed from, never before. */}
            <Pressable
              hitSlop={6}
              style={[styles.sheetSelect, noteSelectMode && styles.sheetSelectOn]}
              onPress={() => {
                if (noteSelectMode) showContext();
                noteEditorRef.current?.toggleSelectMode();
              }}
            >
              <Ionicons
                name={noteSelectMode ? 'close-outline' : 'ellipse-outline'}
                size={16}
                color={theme.paper.inkMuted}
              />
            </Pressable>
          </View>
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
          onPullPastEnd={zooms ? openOverview : undefined}
        />
      </Animated.View>
    );
    return zooms ? <GestureDetector gesture={notePinch}>{note}</GestureDetector> : note;
  }

  const selectedKey = dateKey(selectedDate);
  const dayHistoryCount = historyByDate.get(selectedKey)?.length ?? 0;
  const dailyDocId = `day_${selectedKey}`;
  // Another day picked - from a card here, or from the dock's own days -
  // is that day's page, so the overview gives way to it.
  const overviewDayRef = useRef(selectedKey);
  useEffect(() => {
    if (overviewDayRef.current === selectedKey) return;
    overviewDayRef.current = selectedKey;
    closeOverview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedKey]);
  // EVERY DAY, not only the filled ones - the user's call: a filled day
  // is its page made small, an empty one a short card (the diary search's
  // kind), and either opens the day. So the overview opens on the day you
  // were on, whatever it holds. Newest first: the days after it are above,
  // the ones before it below; nothing later than today (or the day you
  // are on, if that is later still).
  const overviewAnchor: string | null = selectedKey;
  const overviewLastKey = selectedKey > todayKey ? selectedKey : todayKey;
  useEffect(() => {
    if (!overviewOpen || overviewMonths || !overviewAnchor) return;
    const month = overviewAnchor.slice(0, 7);
    setOverviewMonths({ older: month, newer: month });
  }, [overviewOpen, overviewMonths, overviewAnchor]);
  const overviewDays = useMemo(() => {
    if (!overviewMonths) return [];
    const byKey = new Map(dayFeed.map((d) => [d.key, d]));
    const [ny, nm] = overviewMonths.newer.split('-').map(Number);
    const [oy, om] = overviewMonths.older.split('-').map(Number);
    const stop = new Date(oy, om - 1, 1);
    const days: { key: string; day: (typeof dayFeed)[number] | null }[] = [];
    // From the newer month's last day (day 0 of the month after it) down.
    for (let d = new Date(ny, nm, 0); d >= stop; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1)) {
      const key = dateKey(d);
      if (key <= overviewLastKey) days.push({ key, day: byKey.get(key) ?? null });
    }
    return days;
  }, [overviewMonths, dayFeed, overviewLastKey]);
  const overviewAnchorIndex = overviewDays.findIndex((d) => d.key === overviewAnchor);
  // Every day of the loaded months takes its place in the list from the
  // start; before the zoom has landed, only the day and two either side
  // are actually DRAWN, the rest hold their room empty. Adding them later
  // used to push everything down - and the list, already scrolled to your
  // day, was left showing a newer one: "переходить до сьогоднішньої".
  const overviewDrawn = (index: number) => overviewWarm || Math.abs(index - overviewAnchorIndex) <= 2;
  const overviewScrollYRef = useRef(0);
  const overviewFirstKeyRef = useRef<string | null>(null);
  // Every month has days now, so the next one is simply the next one -
  // older without end, newer no further than the last day there is.
  function shiftMonth(month: string, by: number) {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(y, m - 1 + by, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  }
  function extendOverview(direction: 'older' | 'newer') {
    setOverviewMonths((current) => {
      if (!current) return current;
      if (direction === 'older') return { ...current, older: shiftMonth(current.older, -1) };
      const next = shiftMonth(current.newer, 1);
      return next <= overviewLastKey.slice(0, 7) ? { ...current, newer: next } : current;
    });
  }
  // A MONTH HAS TO BE PULLED FOR, not merely scrolled to. Reaching the
  // end used to add the next month by itself, which made the run feel
  // endless and hid the fact that anything was being fetched at all. Now
  // the list ends, and going further means pulling past that end and
  // holding - "треба потягнути і міні затримка ніби витягнути важко".
  // Android's own overscroll stretch is what the finger feels while it
  // does; the wait is what tells you something is coming.
  const [overviewPull, setOverviewPull] = useState<'older' | 'newer' | null>(null);
  const pullHeldRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  function holdPull(direction: 'older' | 'newer') {
    if (pullHeldRef.current) return;
    setOverviewPull(direction);
    pullHeldRef.current = setTimeout(() => {
      pullHeldRef.current = null;
      setOverviewPull(null);
      extendOverview(direction);
    }, OVERVIEW_PULL_MS);
  }
  function releasePull() {
    if (!pullHeldRef.current) return;
    clearTimeout(pullHeldRef.current);
    pullHeldRef.current = null;
    setOverviewPull(null);
  }
  useEffect(() => () => releasePull(), []);
  // Read on every frame of a DRAG, because what it is watching for is
  // the finger holding past the end - not where the list came to rest.
  function checkOverviewPull(e: NativeSyntheticEvent<NativeScrollEvent>) {
    if (!overviewWarm) return;
    const { contentOffset, contentSize, layoutMeasurement } = e.nativeEvent;
    const past = contentOffset.y + layoutMeasurement.height - contentSize.height;
    if (past > OVERVIEW_PULL_PX) {
      holdPull('older');
      return;
    }
    if (contentOffset.y < -OVERVIEW_PULL_PX) {
      holdPull('newer');
      return;
    }
    // Back inside the list: the pull was given up before it counted.
    releasePull();
  }
  const noteRect = noteRectRef.current ?? { y: 120, width: windowWidth - 32, height: windowHeight * 0.7 };
  const miniW = noteRect.width * OVERVIEW_PAGE_SCALE;
  const miniH = noteRect.height * OVERVIEW_PAGE_SCALE;
  // Where the shrunk page's top edge is: scaled about its own centre.
  const miniTop = (containerHRef.current || windowHeight) / 2 - miniH / 2;
  const OVERVIEW_LABEL_H = 30;
  // How far past the end counts as pulling, and how long it has to be
  // held there.
  const OVERVIEW_PULL_PX = 64;
  const OVERVIEW_PULL_MS = 420;
  const OVERVIEW_GAP = 18;
  // Two heights now - a page, or a short card - and still arithmetic, not
  // a measurement to wait for: where any day stands is the sum of the
  // ones above it.
  const OVERVIEW_SHORT_H = 64;
  // A PAGE for every filled day - and for the day you zoomed out FROM,
  // filled or not: the zoom is that very page shrinking into its place in
  // the list, and a short card there left it nowhere to land (it shrank,
  // blinked, and gave way to a card - the user's report). Every other
  // empty day is a short card.
  const overviewIsPage = (item: { key: string; day: unknown }) => !!item.day || item.key === overviewAnchor;
  const overviewHeightOf = (item: { key: string; day: unknown }) =>
    (overviewIsPage(item) ? OVERVIEW_LABEL_H + miniH : OVERVIEW_SHORT_H) + OVERVIEW_GAP;
  const overviewOffsets: number[] = [];
  {
    let y = 0;
    for (const item of overviewDays) {
      overviewOffsets.push(y);
      y += overviewHeightOf(item);
    }
  }
  // Placed once the list's content really is that long - a scrollTo made
  // before that (from a row's own onLayout, as it was) is clamped to the
  // content that exists so far, which is the top of the list: the newest
  // day. And kept in place when a newer month is added above.
  //
  // Placed AGAIN on every change of the content's size, and a frame later
  // too, until the user's own finger first moves the list: one scrollTo
  // on the first change was still landing on the newest day on the
  // device ("я стою на цій даті"), so no single moment is trusted.
  function settleOverviewScroll() {
    const first = overviewDays[0]?.key ?? null;
    if (!overviewScrolledRef.current) {
      if (overviewAnchorIndex < 0) return;
      overviewFirstKeyRef.current = first;
      const y = overviewOffsets[overviewAnchorIndex] ?? 0;
      overviewScrollRef.current?.scrollTo({ y, animated: false });
      requestAnimationFrame(() => {
        if (!overviewScrolledRef.current) overviewScrollRef.current?.scrollTo({ y, animated: false });
      });
      return;
    }
    const previousFirst = overviewFirstKeyRef.current;
    overviewFirstKeyRef.current = first;
    if (!previousFirst || previousFirst === first) return;
    const added = overviewDays.findIndex((d) => d.key === previousFirst);
    if (added > 0) {
      overviewScrollRef.current?.scrollTo({ y: overviewScrollYRef.current + (overviewOffsets[added] ?? 0), animated: false });
    }
  }

  // The month is NAVIGATION - it says which day to look at, it is not
  // the day - so on a pointer it stands in the rail, where this app
  // keeps navigation, beside the folder tree's own place. The history
  // goes with it: it is a list of ways INTO other things, which is the
  // same job.
  usePublishRailPanel(
    feedMode ? (
      <View style={styles.railPanel}>
        <View style={styles.railMonthNav}>
          <Pressable hitSlop={8} onPress={() => changeVisibleMonth(-1)}>
            <Ionicons name="chevron-back" size={16} color={theme.ink.muted} />
          </Pressable>
          <Text style={styles.railMonthLabel}>
            {MONTH_FULL[visibleMonth.month]} {visibleMonth.year}
          </Text>
          <Pressable hitSlop={8} onPress={() => changeVisibleMonth(1)}>
            <Ionicons name="chevron-forward" size={16} color={theme.ink.muted} />
          </Pressable>
        </View>
        <View style={styles.railWeekdays}>
          {WEEKDAY_SHORT.map((d) => (
            <Text key={d} style={styles.railWeekday}>
              {d}
            </Text>
          ))}
        </View>
        {Array.from({ length: monthRows }, (_, row) => (
          <View key={row} style={styles.railWeek}>
            {monthGrid.slice(row * 7, row * 7 + 7).map(({ date, inMonth }) => {
              const key = dateKey(date);
              const here = key === selectedKey;
              return (
                <Pressable
                  key={key}
                  style={[styles.railDay, here && styles.railDayHere]}
                  onPress={() => selectDay(date)}
                >
                  <Text
                    style={[
                      styles.railDayLabel,
                      !inMonth && styles.railDayMuted,
                      key === todayKey && styles.railDayToday,
                      here && styles.railDayLabelHere,
                    ]}
                  >
                    {date.getDate()}
                  </Text>
                  {/* The dot stays even here, where the feed already
                      shows what a day holds: in the grid it is the only
                      thing that says a day is not empty. */}
                  <View style={[styles.railDot, filledDates.has(key) && styles.railDotOn]} />
                </Pressable>
              );
            })}
          </View>
        ))}
        <Pressable style={styles.railToday} onPress={jumpToToday}>
          <Ionicons name="today-outline" size={14} color={theme.ink.primary} />
          <Text style={styles.railTodayLabel}>Сьогодні</Text>
        </Pressable>
        <View style={styles.railHistory}>
          <DayHistoryList items={historyByDate.get(selectedKey) ?? []} fill dense />
        </View>
      </View>
    ) : null
  );

  // The actual tasks due on the selected day (not just whether the day
  // counts as "filled") - a task written in a DIFFERENT document but
  // reminder-dated to this one shows here, on the sheet for the day it's
  // actually due, rather than only being visible back where it was typed.
  useEffect(() => {
    return onSnapshot(ownedQuery('tasks', where('reminderDate', '==', selectedKey)), (snapshot) => {
      setDueReminders(
        snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          text: docSnapshot.data().text,
          checked: !!docSnapshot.data().checked,
          documentId: docSnapshot.data().documentId,
          reminderTime: docSnapshot.data().reminderTime,
          reminderDate: docSnapshot.data().reminderDate,
          reminderKind: docSnapshot.data().reminderKind,
          groupId: docSnapshot.data().groupId,
          listId: docSnapshot.data().listId,
          recurrence: docSnapshot.data().recurrence,
        }))
      );
    }, listenError('CalendarScreen:tasks'));
  }, [selectedKey]);

  // Excludes a task physically written in this same day's own note - that
  // one already renders inline as a checkbox block down in noteArea, so
  // listing it here too would just be a duplicate.
  const dueElsewhere = dueReminders.filter((r) => r.documentId !== dailyDocId);

  async function toggleDueReminder(task: {
    id: string;
    checked: boolean;
    documentId: string;
    text?: string;
    reminderDate?: string;
    reminderTime?: string;
    reminderKind?: ReminderKind;
    groupId?: string;
    listId?: string;
    recurrence?: Recurrence;
  }) {
    const newChecked = !task.checked;
    // Same rule as TasksScreen's own toggleTask: checking a recurring
    // task spins up its next occurrence, one at a time.
    if (newChecked && task.recurrence && task.reminderDate) {
      createTaskOnDate(task.text ?? '', nextRecurrenceDate(task.recurrence, task.reminderDate), {
        groupId: task.groupId,
        listId: task.listId,
        recurrence: task.recurrence,
        reminderTime: task.reminderTime,
        reminderKind: task.reminderKind,
      });
    }
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
    <View style={styles.container} onLayout={(e) => {
        containerHRef.current = e.nativeEvent.layout.height;
        updatePageShift();
      }}>
      {/* The theme's own ground - drawn by hand here before, so it stood
          on the colour theme's brown gradient whatever the setting said.
          The daily-note editor below (`noteArea`) stays white on its own
          regardless - it's the embedded DocumentEditorScreen's own opaque
          white background, painted over this, not a separate override
          here. */}
      <ScreenBackdrop id="calendarBg" />

      {!pointerDensity && (
      <Animated.View style={[styles.headerRow, { paddingTop: headerPadTop }, phoneOverview && overviewFadeStyle]}>
        <View
          style={styles.headerLeft}
          onLayout={(e) => setHeaderContentHeight(e.nativeEvent.layout.height)}
        >
          <Pressable style={styles.todayButton} onPress={jumpToToday}>
            <Text style={styles.todayButtonLabel}>Сьогодні</Text>
          </Pressable>
          {/* The day's own title is where the month opens from. It
              already says the month and the year - a second row below to
              repeat them was a heading and its own echo. While writing it
              keeps its older job (putting the keyboard away), because a
              calendar unfolding under the caret is not what that press
              means then. */}
          <Pressable
            style={styles.headerDateTap}
            disabled={isTwoPane || onlyFilledDays}
            onPress={() => (isWriting ? Keyboard.dismiss() : setIsMonthExpanded((prev) => !prev))}
          >
            <Text style={styles.headerDateLabel} numberOfLines={1}>
              {WEEKDAY_SHORT[mondayIndex(selectedDate)]}, {formatBigDate(selectedDate)}
            </Text>
            {/* The ring went round the rail's capsule, and the rail is
                gone. It belongs here anyway: what it reports is the
                DAY'S note being written, and this is the day. */}
            <SaveRing saving={noteSaveStatus === 'saving'} color={theme.ink.muted} />
            {isWriting ? (
              <Ionicons name="chevron-down" size={12} color={theme.ink.muted} />
            ) : (
              !isTwoPane &&
              !onlyFilledDays && (
                <Ionicons
                  name={monthOpen ? 'chevron-up' : 'chevron-down'}
                  size={13}
                  color={theme.ink.faint}
                />
              )
            )}
          </Pressable>
        </View>
        {/* Opposite the day's own name, which is what it acts on - the
            user's own placement. It was a dock action, and the dock here
            is for the blocks themselves now. */}
        <Pressable
          style={[styles.headerSelect, noteSelectMode && styles.headerSelectOn]}
          hitSlop={8}
          accessibilityLabel={noteSelectMode ? 'Вийти з вибору' : 'Вибір блоків'}
          onPress={() => {
            if (noteSelectMode) showContext();
            noteEditorRef.current?.toggleSelectMode();
          }}
        >
          <Ionicons
            name={noteSelectMode ? 'close-outline' : 'ellipse-outline'}
            size={18}
            color={theme.ink.muted}
          />
        </Pressable>
      </Animated.View>
      )}

      {/* One column on a phone (calendar, then the note under it), two on
          a wide screen (calendar left, note right). Both halves are flex:1
          in the row, so they split the window evenly. */}
      <View
        onLayout={(e) => {
          stackYRef.current = e.nativeEvent.layout.y;
          updatePageShift();
        }}
        style={[
          stackedWide ? styles.stack : isTwoPane ? styles.paneRow : styles.stack,
          // Reversed rather than reordered: the calendar is still the
          // first child, so every measurement, gesture and comment about
          // "this half" goes on meaning what it did. Only which edge it
          // stands against changes.
          !stackedWide && isTwoPane && pointerDensity && styles.paneRowReversed,
          // The header line above used to hold everything off the top of
          // the window. It is gone on a pointer (the date moved onto the
          // sheet), so the room it gave has to be said here instead.
          !stackedWide && isTwoPane && pointerDensity && styles.paneRowTop,
        ]}
      >
        <Animated.View
          style={[
            stackedWide
              ? [styles.topBand, { height: bandHeight }, foldedAway && styles.bandFolded]
              : calendarPaneWidthFixed !== null
                ? [styles.sidePane, { width: calendarPaneWidthFixed, flexGrow: 0, flexShrink: 0, flexBasis: 'auto' }]
                : isTwoPane
                  ? styles.sidePane
                  : null,
            phoneOverview && overviewFadeStyle,
          ]}
        >
          {columnControls.length > 0 && (
            <View style={styles.columnControls}>
              {columnControls.map((c) => (
                <Pressable
                  key={c.key}
                  style={[styles.columnControl, c.active && styles.columnControlOn]}
                  onPress={c.onPress}
                >
                  <Ionicons name={c.icon as never} size={16} color={theme.ink.primary} />
                </Pressable>
              ))}
            </View>
          )}
          {feedMode ? (
            <>
              {/* Newest first, and it just keeps going: the days that
                  hold nothing are not drawn at all, so the column IS the
                  record of what was done. Tapping one opens that day on
                  the sheet beside it. */}
              {dayFeed.length === 0 ? (
                <Text style={styles.feedEmpty}>Ще немає жодного заповненого дня</Text>
              ) : (
                <ScrollView contentContainerStyle={styles.feedContent} showsVerticalScrollIndicator={false}>
                  {dayFeed.map((day) => {
                    const date = parseDateKey(day.key);
                    const preview = extractPreview(day.blocks, day.coverImageUri, undefined, day.coverDriveFileId);
                    return (
                      <DocumentCard
                        key={day.key}
                        id={`day_${day.key}`}
                        // The DAY is the card's name, the same as it is
                        // the sheet's - a daily note has no other.
                        title={`${WEEKDAY_SHORT[mondayIndex(date)]}, ${formatBigDate(date)}`}
                        updatedAt={day.updatedAt}
                        imageUri={preview.imageUri}
                        coverGradient={day.coverGradient}
                        imageDriveFileId={preview.imageDriveFileId}
                        imageUris={preview.imageUris}
                        imageDriveFileIds={preview.imageDriveFileIds}
                        previewText={preview.previewText}
                        previewTail={preview.previewTail}
                        blocks={day.blocks}
                        checklistItems={preview.checklistItems}
                        layout="grid"
                        gridWidth={DESKTOP_CALENDAR_WIDTH - 40}
                        onPress={() => selectDay(date)}
                      />
                    );
                  })}
                </ScrollView>
              )}
            </>
          ) : (
            <>
          {/* The fold gesture lives on the plate only - never on the
              history list under it, where a drag is someone scrolling
              their own past. Off entirely where the month cannot fold:
              beside the note there is room for it always, and in
              "only filled days" the strip is not a real week. */}
          {/* Standing up: the band's row. Side by side: a column that
              fills, because the history lives inside it and takes what the
              plate leaves. On a PHONE neither - there the history, the due
              card and the sheet are siblings BELOW this, and a flex:1 here
              swallowed the whole column and pushed all three off the
              bottom of the screen. */}
          <View style={stackedWide ? styles.topRow : isTwoPane ? styles.topStack : undefined}>
          {/* The ONE thing that measures the calendar's width, whichever
              way the screen is turned. It used to be measured on the band
              in one arrangement and on this half in the other, and the
              handler moved between them as the screen rotated - so on the
              turn neither fired, and the plate kept the width it had
              lying down. This view stretches to the width the plate
              actually has in both, so one handler covers both. */}
          <View
            // Standing up this is one half of the band, so it claims its
            // share of the ROW. Any other way it is just the plate's
            // wrapper and must take the plate's own height: as a flex:1 it
            // took half the column, which left the history sitting at the
            // bottom of the screen with its cards cut off by the edge.
            style={stackedWide ? styles.topHalf : undefined}
            onLayout={(e) => setCalendarPaneWidth(e.nativeEvent.layout.width)}
          >
          <GestureDetector gesture={plateGesture}>
          <Animated.View style={[styles.calendarPlate, isTwoPane && styles.calendarPlatePaned, calendarPlateStyle]}>
          <Animated.View style={[styles.calendarWrap, calendarWrapStyle]}>
            <Animated.View style={[styles.monthNavWrap, monthNavStyle]}>
              <View style={styles.monthNav}>
                <Pressable hitSlop={10} onPress={() => changeVisibleMonth(-1)}>
                  <Ionicons name="chevron-back" size={18} color={theme.ink.muted} />
                </Pressable>
                <Text style={styles.monthNavLabel}>
                  {MONTH_FULL[visibleMonth.month]} {visibleMonth.year}
                </Text>
                <Pressable hitSlop={10} onPress={() => changeVisibleMonth(1)}>
                  <Ionicons name="chevron-forward" size={18} color={theme.ink.muted} />
                </Pressable>
              </View>
            </Animated.View>

            {!onlyFilledDays && (
              // Hidden entirely (not just blanked) while showing only filled
              // days - its dates aren't a real calendar week (they skip straight
              // from one filled day to the next), so weekday letters above them
              // would be meaningless. The reclaimed height goes to bigger day
              // cells instead (see FILLED_ROW_HEIGHT).
              <Animated.View style={[styles.weekdayHeader, weekdayHeaderStyle]}>
                {WEEKDAY_SHORT.map((w) => (
                  <Text key={w} style={styles.weekdayHeaderLabel}>
                    {w}
                  </Text>
                ))}
              </Animated.View>
            )}

            <Animated.View style={[styles.gridClip, gridClipStyle]}>
              {/* The week strip is gone from here - the dock is the week
                  now, under the thumb where moving from day to day
                  belongs. This layer survives for the OTHER strip it also
                  held: "only filled days", which is not a week at all but
                  a run of the days that have something on them, and which
                  the dock does not replace. */}
              {onlyFilledDays && (
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
              )}

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
                  {Array.from({ length: monthRows }, (_, row) => (
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
          </GestureDetector>

          {/* One flex-wrap row for both capsules - the month one always here
              (unless a compact strip is active, same as before), the history
              one only on a day that actually has any (see DayHistoryList,
              which renders nothing at all when it doesn't). Wrapping lets
              the history capsule's own expanded list drop onto its own line
              below both pills instead of squeezing in beside them - see its
              width:'100%' body. */}
          {/* Skipped outright in three columns: the month capsule is gone
              with the month always open, and the history has its own
              column - an empty row would just leave a gap. */}
          {/* Beside the note, the history has the room under the calendar
              and simply takes it: no pill to open, no column of its own.
              On a phone it stays what it was - a list behind a button. */}
          </View>
          {isTwoPane && (
            <View
              style={[
                styles.historyUnderCalendar,
                stackedWide && styles.historyBeside,
                // Standing up the history is NOT clipped to the band's
                // height. It runs on down the screen, behind the sheet -
                // the user's own words: the cards may scroll up off the
                // top edge and may pass under the sheet, as long as the
                // first one starts where it starts now. A height of the
                // whole window is simply more than the screen has, so the
                // list scrolls instead of being cut to three cards. The
                // sheet is drawn after this in the tree, so it paints over
                // whatever runs under it.
                stackedWide && { height: windowHeight },
              ]}
            >
              <DayHistoryList items={historyByDate.get(selectedKey) ?? []} fill dense={pointerDensity} />
            </View>
          )}
          </View>

          {/* THE HISTORY, under the month and only while it is open.
              The day's own note has the screen when the month is folded
              away, and a row of cards with nothing to head it was what
              the dock's «Історія» button used to answer for. */}
          {!foldedAway && !isTwoPane && monthOpen && dayHistoryCount > 0 && (
            <Pressable style={styles.historyHead} onPress={() => setHistoryExpanded((v) => !v)}>
              <Ionicons name="time-outline" size={14} color={theme.ink.muted} />
              <Text style={styles.historyHeadLabel}>Історія</Text>
              <Text style={styles.historyHeadCount}>{dayHistoryCount}</Text>
              <View style={styles.historyHeadSpace} />
              <Ionicons
                name={historyExpanded ? 'chevron-up' : 'chevron-down'}
                size={14}
                color={theme.ink.faint}
              />
            </Pressable>
          )}
          {!foldedAway && !isTwoPane && monthOpen && dayHistoryCount > 0 && (
            <View style={styles.capsuleRow}>
              <DayHistoryList
                items={historyByDate.get(selectedKey) ?? []}
                expanded={historyExpanded}
                onToggleExpanded={() => setHistoryExpanded((v) => !v)}
                hideHeader
              />
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
                      color={task.checked ? accent : '#9CA3AF'}
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
            </>
          )}
        </Animated.View>

        {!(compactFilter === 'history' && noteCollapsed) && renderDayNote(selectedKey, true)}

      </View>

      {phoneOverview && overviewOpen && (
        <View style={StyleSheet.absoluteFill}>
          {/* No ground of its own: the screen's own backdrop is already
              under everything, and the heading and the rest above the page
              fade away by themselves (overviewFadeStyle). A ground laid
              over them faded in over the PAGE as well, and the page, the
              ground and the miniature all half-transparent at once is
              what read as a blink at the hand-over. */}
          {(
            <ScrollView
              ref={overviewScrollRef}
              contentContainerStyle={[
                styles.overviewContent,
                {
                  // The first page, unscrolled, stands where the page
                  // shrinks to; the last can still be scrolled up there.
                  paddingTop: Math.max(calendarInsets.top + navSpace, miniTop - OVERVIEW_LABEL_H),
                  paddingBottom: Math.max(overviewClear, (containerHRef.current || windowHeight) - miniTop - miniH - OVERVIEW_GAP),
                },
              ]}
              showsVerticalScrollIndicator={false}
              onContentSizeChange={settleOverviewScroll}
              // Every frame, not only at rest: the hold past the end is
              // the gesture, and it happens while the finger is down.
              scrollEventThrottle={16}
              // From here on the list is the user's: nothing places it
              // again except a newer month being added above.
              onScrollBeginDrag={() => {
                overviewScrolledRef.current = true;
              }}
              contentOffset={overviewAnchorIndex >= 0 ? { x: 0, y: overviewOffsets[overviewAnchorIndex] ?? 0 } : undefined}
              onLayout={settleOverviewScroll}
              onScroll={(e) => {
                overviewScrollYRef.current = e.nativeEvent.contentOffset.y;
                checkOverviewPull(e);
              }}
              onScrollEndDrag={releasePull}
              onMomentumScrollEnd={releasePull}
            >
              {overviewDays.map((item, index) => {
                const date = parseDateKey(item.key);
                const open = () => {
                  if (item.key === selectedKey) closeOverview();
                  else selectDay(date);
                };
                const label = `${WEEKDAY_SHORT[mondayIndex(date)]}, ${formatBigDate(date)}`;
                return (
                  <Animated.View
                    key={item.key}
                    style={[
                      { height: overviewHeightOf(item) - OVERVIEW_GAP, marginBottom: OVERVIEW_GAP },
                      item.key === overviewAnchor ? overviewLateStyle : overviewEarlyStyle,
                    ]}
                  >
                    {overviewDrawn(index) &&
                      (overviewIsPage(item) ? (
                        <Pressable onPress={open}>
                          <Text style={[styles.overviewDate, { height: OVERVIEW_LABEL_H }]} numberOfLines={1}>
                            {label}
                          </Text>
                          <DayPageMiniature
                            blocks={item.day?.blocks ?? []}
                            pageWidth={noteRect.width}
                            pageHeight={noteRect.height}
                            scale={OVERVIEW_PAGE_SCALE}
                            radius={16 * OVERVIEW_PAGE_SCALE}
                          />
                        </Pressable>
                      ) : (
                        // An empty day: a short card, the diary search's
                        // kind - the date and nothing yet. Opens the day
                        // like a page does.
                        <ShortDayCard id={`day_${item.key}`} label={label} height={OVERVIEW_SHORT_H} onPress={open} />
                      ))}
                  </Animated.View>
                );
              })}
            </ScrollView>
          )}
        </View>
      )}
    </View>
  );
}

// An empty day in the overview: a short card in the colour the day's
// sheet would have, like the diary search's cards, saying only the date.
function ShortDayCard({ id, label, height, onPress }: { id: string; label: string; height: number; onPress: () => void }) {
  const recordColour = useRecordColour();
  const { background, text, textMuted } = recordColour(id);
  return (
    <Pressable onPress={onPress} style={[shortCardStyles.card, { height, backgroundColor: background }]}>
      <Text style={[shortCardStyles.date, { color: text }]} numberOfLines={1}>
        {label}
      </Text>
      <Text style={[shortCardStyles.empty, { color: textMuted }]} numberOfLines={1}>
        Порожній день
      </Text>
    </Pressable>
  );
}

const shortCardStyles = StyleSheet.create({
  card: {
    justifyContent: 'center',
    paddingHorizontal: 14,
    gap: 2,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: 'rgba(176,176,176,0.5)',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 3 },
    elevation: 4,
  },
  date: {
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
  },
  empty: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
  },
});

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
  const styles = useStyles(makeStyles);
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

const makeStyles = (t: Theme) =>
  StyleSheet.create({
  container: {
    flex: 1,
  },
  headerSelect: {
    padding: 7,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: t.edge.hairline,
  },
  headerSelectOn: {
    backgroundColor: t.edge.strong,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    // The same edges the calendar plate under it keeps, so "Сьогодні" and
    // the date start on the plate's own left edge rather than 4px in from
    // it, and neither runs under the rail.
    paddingLeft: 16,
    paddingRight: 20,
    // paddingTop is computed - see headerPadTop.
    paddingBottom: HEADER_GAP,
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
  // Outlined, not filled. Filled it was the heaviest thing on the
  // screen and stood right beside today's own circle, which is also
  // filled - two black blobs competing, and the louder one was the
  // button rather than the state it points at.
  todayButton: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.edge.strong,
    paddingHorizontal: 11,
    paddingVertical: 6,
  },
  todayButtonLabel: {
    fontSize: 11.5,
    fontWeight: '700',
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
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
    color: t.ink.primary,
  },
  // The column the calendar's own controls stand in - same edge, same
  // width, same glass as the documents screen's rail.
  calendarRail: {
    position: 'absolute',
    right: RAIL_RIGHT,
    alignItems: 'center',
    gap: 12,
  },
  // Search (→ DiaryScreen) + "..." (the only-filled-days menu) in one
  // capsule, stood on its end.
  headerButtons: {
    alignItems: 'center',
    gap: 18,
    paddingVertical: 18,
    paddingHorizontal: 19,
  },
  // Turned with the capsule: a rule across it, not down it.
  headerButtonsDivider: {
    width: 20,
    height: 1,
    backgroundColor: 'rgba(255,255,255,0.3)',
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
    backgroundColor: t.raised,
    // The strong edge, not the hairline: on an almost-white ground the
    // plate was held up by its shadow alone and read as unfinished
    // beside the rail capsule's own crisp rim.
    borderColor: t.edge.strong,
    // The capsule's own radius - RAIL_WIDTH is its width, so half of that
    // is the curve its ends are drawn with. Not 999: that would pull the
    // whole plate into one long capsule, and this one keeps straight sides
    // with matching corners.
    borderRadius: RAIL_WIDTH / 2,
    marginLeft: 16,
    // Stops before the rail rather than running under the capsule.
    marginRight: 20,
    overflow: 'hidden',
  },
  // Between the calendar and the note there were two margins (the plate's
  // and the note's) where between the note and the history there is one -
  // so the same gap read wider on the left than on the right. The plate
  // drops its own on that side and both come out at 16.
  calendarPlatePaned: {
    marginRight: 0,
  },
  paneHidden: {
    display: 'none',
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
  monthNavHandle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  monthNavLabel: {
    fontSize: 16,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: t.ink.primary,
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
    color: t.ink.muted,
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
    borderColor: t.edge.strong,
  },
  // The one filled shape in the strip - the brightest ink, inverted, the
  // same pairing as the "Сьогодні" chip and the dock's own selected tab.
  dayCircleToday: {
    backgroundColor: t.ink.primary,
    borderColor: t.ink.primary,
  },
  dayNum: {
    fontSize: 15,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  dayNumCompact: {
    fontSize: 18,
    fontFamily: FONT_REGULAR,
    lineHeight: 21,
  },
  dayMonthCompact: {
    fontSize: 12,
    lineHeight: 14,
    fontFamily: FONT_MEDIUM,
    color: t.ink.muted,
  },
  dayNumMuted: {
    color: t.ink.faint,
  },
  dayNumToday: {
    color: t.ground,
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
    backgroundColor: t.ink.primary,
  },
  filledDotOnToday: {
    backgroundColor: t.ground,
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
  paneRowReversed: {
    flexDirection: 'row-reverse',
  },
  paneRowTop: {
    paddingTop: 14,
  },
  // The date on the sheet. Paper ink, not the screen's: this sits on the
  // note's own white page, not on the app's ground behind it.
  notePaper: {
    backgroundColor: t.paper.fill,
  },
  sheetHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingLeft: 20,
    paddingRight: 20,
    paddingTop: 22,
    paddingBottom: 2,
  },
  sheetDate: {
    fontSize: 26,
    fontWeight: '700',
    fontFamily: FONT_SEMIBOLD,
    color: t.paper.ink,
  },
  // The calendar column's own head: the controls that act on the month
  // and the day, standing over the month.
  columnControls: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 6,
    paddingRight: 20,
    paddingTop: 14,
    paddingBottom: 10,
  },
  sheetHeadSpace: {
    flex: 1,
  },
  sheetSelect: {
    padding: 6,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: t.paper.inkFaint,
  },
  sheetSelectOn: {
    backgroundColor: t.paper.inkFaint,
  },
  // The month, in a 240 column. Every cell is worked out from that
  // width rather than measured: the rail is the one place in this app
  // whose width never changes.
  railPanel: {
    flex: 1,
    paddingHorizontal: 12,
    gap: 2,
  },
  railMonthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 6,
  },
  railMonthLabel: {
    fontSize: 13,
    fontWeight: '700',
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  railWeekdays: {
    flexDirection: 'row',
  },
  railWeekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: 9.5,
    color: t.ink.faint,
  },
  railWeek: {
    flexDirection: 'row',
  },
  railDay: {
    flex: 1,
    height: 26,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 7,
  },
  railDayHere: {
    backgroundColor: t.edge.strong,
  },
  railDayLabel: {
    fontSize: 12,
    color: t.ink.primary,
  },
  railDayLabelHere: {
    fontWeight: '700',
  },
  railDayMuted: {
    color: t.ink.faint,
  },
  railDayToday: {
    color: t.accent,
    fontWeight: '700',
  },
  // Always drawn, so a filled day and an empty one are the same height
  // and the rows do not jump by two pixels as the month changes.
  railDot: {
    width: 3,
    height: 3,
    borderRadius: 2,
    marginTop: 1,
    backgroundColor: 'transparent',
  },
  railDotOn: {
    backgroundColor: t.accent,
  },
  railToday: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 6,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.edge.strong,
  },
  railTodayLabel: {
    fontSize: 12,
    color: t.ink.primary,
  },
  railHistory: {
    flex: 1,
    minHeight: 0,
    marginTop: 10,
  },
  feedContent: {
    gap: 10,
    paddingRight: 20,
    paddingBottom: 24,
  },
  // The phone's overview: the cards run the width the page had.
  overviewContent: {
    alignItems: 'center',
  },
  overviewDate: {
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
    paddingLeft: 4,
  },
  overviewEmpty: {
    paddingHorizontal: 20,
  },
  feedEmpty: {
    paddingRight: 20,
    paddingTop: 8,
    fontSize: 13,
    color: t.ink.faint,
  },
  columnControl: {
    padding: 7,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: t.edge.strong,
  },
  columnControlOn: {
    backgroundColor: t.edge.strong,
  },
  // The calendar and the history take a column each; the note takes a
  // little more, since it's the one column whose content is text being
  // written rather than a grid or a list of cards sized by their own.
  // minWidth 0 with flexShrink: the pane's width is the row's decision,
  // never its content's - see stripWidth's comment.
  sidePane: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
  },
  notePane: {
    flex: 1.3,
  },
  // Standing up on the inner screen: the calendar and the history share a
  // band across the top, the sheet has the rest.
  //
  // The band takes the height it NEEDS, not a share of the screen. As a
  // flex:1 it was given half the height and the calendar filled about two
  // thirds of that, so the sheet started a hand's width below the history
  // with nothing in between.
  topBand: {
    flexGrow: 0,
    flexShrink: 0,
  },
  // Writing lifts the sheet over the band, which is the same thing that
  // happens on a phone - there the calendar folds away above the note.
  bandFolded: {
    display: 'none',
  },
  topRow: {
    flexDirection: 'row',
    gap: 12,
  },
  topStack: {
    flex: 1,
  },
  topHalf: {
    flex: 1,
    minWidth: 0,
    flexShrink: 1,
  },
  // Level with the plate, standing up: its top on the plate's top line (the
  // column's own 8 of margin was what set it lower), and its right edge on
  // the sheet's, below.
  //
  // It used to stop short of the rail. That was the wrong edge to line up
  // with: the sheet under it runs the full width and PASSES under the rail
  // the way the document cards do, so keeping the history clear of the
  // rail left it ending short of everything around it. The cards can pass
  // under the buttons too.
  historyBeside: {
    flex: 1,
    marginTop: 0,
    marginRight: 16,
  },
  noteBelow: {
    // Whatever the band above it did not need.
    flex: 1,
    marginLeft: 16,
    marginTop: 8,
  },
  // Under the calendar, taking whatever height is left in the column.
  historyUnderCalendar: {
    flex: 1,
    marginLeft: 16,
    marginTop: 8,
  },
    historyPane: {
    flex: 1,
    marginRight: 16,
    marginBottom: 8,
  },
  historyHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginLeft: 16,
    marginRight: 20,
    paddingVertical: 8,
  },
  historyHeadLabel: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.muted,
  },
  historyHeadCount: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: t.ink.faint,
  },
  historyHeadSpace: {
    flex: 1,
  },
  capsuleRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'flex-start',
    gap: 8,
    marginLeft: 16,
    marginRight: 20,
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
    backgroundColor: t.scrim,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  monthCapsuleLabel: {
    fontSize: 13,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: 'rgba(255,255,255,0.85)',
  },
  noteArea: {
    flex: 1,
    marginLeft: 16,
    // Back out to the same edge as everything else: the sheet runs the
    // full width and passes UNDER the rail, the way the document cards
    // do. It was stopping short of the rail only because the blocks'
    // drag handles sat against that edge - and those are gone from the
    // daily note now (see BlockRow's hideHandle).
    marginRight: 16,
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
    fontFamily: FONT_REGULAR,
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
