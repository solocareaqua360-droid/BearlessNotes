import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Keyboard,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Animated, { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { collection, doc, onSnapshot, query, setDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { RootStackParamList } from '../navigation';
import { useTags } from '../hooks/useTags';
import TagsDrawer from '../components/TagsDrawer';
import DocumentEditorScreen from './DocumentEditorScreen';
import { hasNoteContent } from '../utils/documentPreview';
import {
  MONTH_FULL,
  WEEKDAY_FULL,
  WEEKDAY_SHORT,
  addDays,
  dateKey,
  formatBigDate,
  getMonthGrid,
  getWeekDates,
  isSameDay,
  isoWeekNumber,
  mondayIndex,
  mondayOf,
} from '../utils/dateLocale';

const ACCENT = '#3B82F6';
const PAGE_WIDTH = Dimensions.get('window').width;
const documentsCollection = collection(db, 'documents');
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

export default function CalendarScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const today = useMemo(() => new Date(), []);
  const { tags } = useTags();

  const [weekStart, setWeekStart] = useState(() => mondayOf(new Date()));
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [isMonthExpanded, setIsMonthExpanded] = useState(false);
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const d = new Date();
    return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [onlyFilledDays, setOnlyFilledDays] = useState(false);
  const [filledDates, setFilledDates] = useState<Set<string>>(new Set());
  const [menuOpen, setMenuOpen] = useState(false);
  // The calendar folds away entirely while the keyboard is up: on a phone
  // the strip (let alone the month grid) plus the keyboard leaves almost
  // nothing for the note being written.
  const [isWriting, setIsWriting] = useState(false);

  const weekScrollRef = useRef<ScrollView>(null);
  const expandAmount = useSharedValue(0); // 0 = week strip, 1 = month grid
  const visibleAmount = useSharedValue(1); // 0 = folded away (writing)

  useEffect(() => {
    expandAmount.value = withTiming(isMonthExpanded ? 1 : 0, {
      duration: 300,
      easing: Easing.out(Easing.cubic),
    });
  }, [isMonthExpanded, expandAmount]);

  useEffect(() => {
    visibleAmount.value = withTiming(isWriting ? 0 : 1, {
      duration: 200,
      easing: Easing.out(Easing.cubic),
    });
  }, [isWriting, visibleAmount]);

  useEffect(() => {
    return onSnapshot(calendarPrefsDoc, (snapshot) => {
      setOnlyFilledDays(snapshot.data()?.onlyFilledDays ?? false);
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
    weekScrollRef.current?.scrollTo({ x: PAGE_WIDTH, animated: false });
  }, [weekStart]);

  // The month grid follows whichever day is open, so collapsing back to the
  // week strip and expanding again always lands on the right month. Changing
  // months with the arrows doesn't touch selectedDate, so it doesn't fight
  // this.
  useEffect(() => {
    setVisibleMonth({ year: selectedDate.getFullYear(), month: selectedDate.getMonth() });
  }, [selectedDate]);

  // Which days in the visible month already have a real note (the "only
  // filled days" toggle). calendarDate sorts the same as the date it
  // represents (YYYY-MM-DD), so a plain range filter is one month's worth of
  // documents, no composite index needed.
  useEffect(() => {
    const monthStartKey = dateKey(new Date(visibleMonth.year, visibleMonth.month, 1));
    const monthEndKey = dateKey(new Date(visibleMonth.year, visibleMonth.month + 1, 0));
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
      setFilledDates(filled);
    });
  }, [visibleMonth.year, visibleMonth.month]);

  function selectDay(date: Date) {
    setSelectedDate(date);
    setWeekStart(mondayOf(date));
  }

  function handleWeekScrollEnd(e: NativeSyntheticEvent<NativeScrollEvent>) {
    const page = Math.round(e.nativeEvent.contentOffset.x / PAGE_WIDTH);
    if (page === 1) return;
    const deltaDays = (page - 1) * 7;
    setWeekStart((prev) => addDays(prev, deltaDays));
    setSelectedDate((prev) => addDays(prev, deltaDays));
  }

  function changeVisibleMonth(delta: number) {
    setVisibleMonth((prev) => {
      const d = new Date(prev.year, prev.month + delta, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  async function toggleOnlyFilledDays() {
    setMenuOpen(false);
    await setDoc(calendarPrefsDoc, { onlyFilledDays: !onlyFilledDays }, { merge: true });
  }

  const calendarWrapStyle = useAnimatedStyle(() => {
    const navHeight = MONTH_NAV_HEIGHT * expandAmount.value;
    const gridHeight = WEEK_AREA_HEIGHT + (MONTH_AREA_HEIGHT - WEEK_AREA_HEIGHT) * expandAmount.value;
    return {
      height: (navHeight + WEEKDAY_HEADER_HEIGHT + gridHeight) * visibleAmount.value,
      opacity: visibleAmount.value,
    };
  });
  const monthNavStyle = useAnimatedStyle(() => ({
    height: MONTH_NAV_HEIGHT * expandAmount.value,
    opacity: expandAmount.value,
  }));
  const gridClipStyle = useAnimatedStyle(() => ({
    height: WEEK_AREA_HEIGHT + (MONTH_AREA_HEIGHT - WEEK_AREA_HEIGHT) * expandAmount.value,
  }));
  const weekLayerStyle = useAnimatedStyle(() => ({ opacity: 1 - expandAmount.value }));
  const monthLayerStyle = useAnimatedStyle(() => ({ opacity: expandAmount.value }));

  const monthGrid = useMemo(
    () => getMonthGrid(visibleMonth.year, visibleMonth.month),
    [visibleMonth.year, visibleMonth.month]
  );
  const selectedKey = dateKey(selectedDate);
  const dailyDocId = `day_${selectedKey}`;

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.headerTitle}>Календар</Text>
        <Pressable style={styles.menuButton} onPress={() => setMenuOpen((v) => !v)}>
          <Ionicons name="ellipsis-horizontal" size={17} color={ACCENT} />
        </Pressable>
      </View>

      {menuOpen && <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)} />}
      {menuOpen && (
        <View style={styles.menuPanel}>
          <Pressable style={styles.menuRow} onPress={toggleOnlyFilledDays}>
            <Text style={styles.menuRowLabel}>Показувати лише заповнені дні</Text>
            <View style={[styles.switchTrack, onlyFilledDays && styles.switchTrackOn]}>
              <View style={styles.switchKnob} />
            </View>
          </Pressable>
        </View>
      )}

      <Animated.View style={[styles.calendarWrap, calendarWrapStyle]}>
        <Animated.View style={[styles.monthNavWrap, monthNavStyle]}>
          <View style={styles.monthNav}>
            <Pressable hitSlop={10} onPress={() => changeVisibleMonth(-1)}>
              <Ionicons name="chevron-back" size={18} color="#9CA3AF" />
            </Pressable>
            <Text style={styles.monthNavLabel}>
              {MONTH_FULL[visibleMonth.month]} {visibleMonth.year}
            </Text>
            <Pressable hitSlop={10} onPress={() => changeVisibleMonth(1)}>
              <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
            </Pressable>
          </View>
        </Animated.View>

        <View style={styles.weekdayHeader}>
          {WEEKDAY_SHORT.map((w) => (
            <Text key={w} style={styles.weekdayHeaderLabel}>
              {w}
            </Text>
          ))}
        </View>

        <Animated.View style={[styles.gridClip, gridClipStyle]}>
          <Animated.View
            style={[styles.calendarLayer, { height: WEEK_AREA_HEIGHT }, weekLayerStyle]}
            pointerEvents={isMonthExpanded ? 'none' : 'auto'}
          >
            <ScrollView
              ref={weekScrollRef}
              horizontal
              pagingEnabled
              showsHorizontalScrollIndicator={false}
              // RN gives every ScrollView flexGrow: 1, so without a fixed
              // height here the strip stretches over all the free space.
              style={styles.weekScroll}
              contentOffset={{ x: PAGE_WIDTH, y: 0 }}
              onLayout={() => weekScrollRef.current?.scrollTo({ x: PAGE_WIDTH, animated: false })}
              onMomentumScrollEnd={handleWeekScrollEnd}
            >
              {WEEK_PAGE_OFFSETS.map((offset) => (
                <View key={offset} style={styles.weekPage}>
                  {getWeekDates(addDays(weekStart, offset)).map((date) => (
                    <DayCell
                      key={dateKey(date)}
                      date={date}
                      isToday={isSameDay(date, today)}
                      isSelected={dateKey(date) === selectedKey}
                      onPress={() => selectDay(date)}
                    />
                  ))}
                </View>
              ))}
            </ScrollView>
          </Animated.View>

          <Animated.View
            style={[styles.calendarLayer, { height: MONTH_AREA_HEIGHT }, monthLayerStyle]}
            pointerEvents={isMonthExpanded ? 'auto' : 'none'}
          >
            <View style={styles.monthGrid}>
              {monthGrid.map(({ date, inMonth }) => {
                const key = dateKey(date);
                const isToday = isSameDay(date, today);
                return (
                  <DayCell
                    key={key}
                    date={date}
                    isToday={isToday}
                    isSelected={key === selectedKey}
                    muted={!inMonth}
                    hidden={onlyFilledDays && inMonth && !isToday && !filledDates.has(key)}
                    inGrid
                    onPress={() => selectDay(date)}
                  />
                );
              })}
            </View>
          </Animated.View>
        </Animated.View>
      </Animated.View>

      {!isWriting && (
        <View style={styles.expandRow}>
          <Pressable
            style={styles.expandButton}
            hitSlop={10}
            onPress={() => setIsMonthExpanded((prev) => !prev)}
          >
            <Ionicons name={isMonthExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="#9CA3AF" />
          </Pressable>
        </View>
      )}

      {isWriting ? (
        // One compact line while writing - which day this is still has to be
        // visible, but the big date block would eat the space the keyboard
        // already took.
        <Pressable style={styles.compactDate} onPress={() => Keyboard.dismiss()}>
          <Text style={styles.compactDateLabel}>
            {WEEKDAY_FULL[mondayIndex(selectedDate)]}, {formatBigDate(selectedDate)}
          </Text>
          <Ionicons name="chevron-down" size={14} color="#9CA3AF" />
        </Pressable>
      ) : (
        <View style={styles.dateHeader}>
          <View style={styles.weekdayRow}>
            <Text style={styles.weekdayFull}>{WEEKDAY_FULL[mondayIndex(selectedDate)]}</Text>
            {isSameDay(selectedDate, today) && (
              <View style={styles.todayChip}>
                <Text style={styles.todayChipLabel}>Сьогодні</Text>
              </View>
            )}
          </View>
          <View style={styles.dateLine}>
            <Text style={styles.dateBig}>{formatBigDate(selectedDate)}</Text>
            <Text style={styles.weekNum}>Тиждень {isoWeekNumber(selectedDate)}</Text>
          </View>
        </View>
      )}

      <View style={styles.noteArea}>
        <DocumentEditorScreen
          key={dailyDocId}
          embedded
          documentId={dailyDocId}
          navigation={navigation}
          extraFields={{ calendarDate: selectedKey }}
        />
      </View>

      <TagsDrawer tags={tags} activeFilter={null} onSelectFilter={() => {}} />
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
  hidden,
  inGrid,
  onPress,
}: {
  date: Date;
  isToday: boolean;
  isSelected: boolean;
  muted?: boolean;
  hidden?: boolean;
  inGrid?: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable style={inGrid ? styles.gridCell : styles.dayCell} onPress={onPress}>
      <View
        style={[
          styles.dayCircle,
          isSelected && !isToday && styles.dayCircleSelected,
          isToday && styles.dayCircleToday,
        ]}
      >
        {!hidden && (
          <Text style={[styles.dayNum, muted && styles.dayNumMuted, isToday && styles.dayNumToday]}>
            {date.getDate()}
          </Text>
        )}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 8,
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  menuButton: {
    width: 38,
    height: 38,
    borderRadius: 19,
    backgroundColor: '#fff',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
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
    color: '#111827',
  },
  switchTrack: {
    width: 42,
    height: 25,
    borderRadius: 13,
    backgroundColor: '#D1D5DB',
    padding: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  switchTrackOn: {
    backgroundColor: ACCENT,
    justifyContent: 'flex-end',
  },
  switchKnob: {
    width: 21,
    height: 21,
    borderRadius: 11,
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 1,
  },
  calendarWrap: {
    overflow: 'hidden',
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
    color: '#111827',
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
    color: '#9CA3AF',
    fontWeight: '500',
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
    width: PAGE_WIDTH,
    flexDirection: 'row',
    paddingHorizontal: 16,
  },
  dayCell: {
    flex: 1,
    height: ROW_HEIGHT,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
  },
  gridCell: {
    width: `${100 / 7}%`,
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
  },
  dayCircleSelected: {
    borderColor: '#D1D5DB',
  },
  dayCircleToday: {
    backgroundColor: '#EF4444',
    borderColor: '#EF4444',
  },
  dayNum: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111827',
  },
  dayNumMuted: {
    color: '#D1D5DB',
  },
  dayNumToday: {
    color: '#fff',
  },
  expandRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    paddingVertical: 6,
  },
  expandButton: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  compactDate: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 20,
    paddingTop: 4,
    paddingBottom: 6,
  },
  compactDateLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: ACCENT,
  },
  dateHeader: {
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  weekdayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  weekdayFull: {
    fontSize: 15,
    fontWeight: '600',
    color: ACCENT,
  },
  todayChip: {
    backgroundColor: '#EFF6FF',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 2,
  },
  todayChipLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: ACCENT,
  },
  dateLine: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  dateBig: {
    fontSize: 28,
    fontWeight: '800',
    color: '#111827',
  },
  weekNum: {
    fontSize: 14,
    color: '#9CA3AF',
  },
  noteArea: {
    flex: 1,
  },
});
