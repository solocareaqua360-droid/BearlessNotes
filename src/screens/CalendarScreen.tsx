import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  LayoutAnimation,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  UIManager,
  View,
} from 'react-native';
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

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

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

  const weekScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    return onSnapshot(calendarPrefsDoc, (snapshot) => {
      setOnlyFilledDays(snapshot.data()?.onlyFilledDays ?? false);
    });
  }, []);

  // Recenters the 3-page week strip on the (possibly new) current week every
  // time it changes - including the very first render, so the initial
  // contentOffset prop below and this agree instead of racing.
  useEffect(() => {
    weekScrollRef.current?.scrollTo({ x: PAGE_WIDTH, animated: false });
  }, [weekStart]);

  // Which days in the visible month already have a real note - only
  // queried while the month grid is open, since it's the only place this
  // is shown (the "only filled days" toggle). calendarDate sorts the same
  // as the date it represents (YYYY-MM-DD), so a plain range filter is a
  // full month's worth of documents, no composite index needed.
  useEffect(() => {
    if (!isMonthExpanded) return;
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
  }, [isMonthExpanded, visibleMonth.year, visibleMonth.month]);

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

  function toggleMonthExpanded() {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    if (!isMonthExpanded) {
      setVisibleMonth({ year: selectedDate.getFullYear(), month: selectedDate.getMonth() });
    }
    setIsMonthExpanded((prev) => !prev);
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

      {isMonthExpanded ? (
        <View>
          <View style={styles.monthNav}>
            <Pressable hitSlop={8} onPress={() => changeVisibleMonth(-1)}>
              <Ionicons name="chevron-back" size={18} color="#9CA3AF" />
            </Pressable>
            <Text style={styles.monthNavLabel}>
              {MONTH_FULL[visibleMonth.month]} {visibleMonth.year}
            </Text>
            <Pressable hitSlop={8} onPress={() => changeVisibleMonth(1)}>
              <Ionicons name="chevron-forward" size={18} color="#9CA3AF" />
            </Pressable>
          </View>

          <View style={styles.weekdayHeader}>
            {WEEKDAY_SHORT.map((w) => (
              <Text key={w} style={styles.weekdayHeaderLabel}>
                {w}
              </Text>
            ))}
          </View>

          <View style={styles.monthGrid}>
            {monthGrid.map(({ date, inMonth }) => {
              const key = dateKey(date);
              const isToday = isSameDay(date, today);
              const isSelected = !isToday && key === selectedKey;
              const hideNumber = onlyFilledDays && inMonth && !isToday && !filledDates.has(key);
              return (
                <Pressable key={key} style={styles.gridCell} onPress={() => selectDay(date)}>
                  {!hideNumber && (
                    <Text
                      style={[
                        styles.gridNum,
                        !inMonth && styles.gridNumMuted,
                        isSelected && styles.gridNumSelected,
                        isToday && styles.gridNumToday,
                      ]}
                    >
                      {date.getDate()}
                    </Text>
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>
      ) : (
        <ScrollView
          ref={weekScrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          contentOffset={{ x: PAGE_WIDTH, y: 0 }}
          onMomentumScrollEnd={handleWeekScrollEnd}
        >
          {WEEK_PAGE_OFFSETS.map((offset) => (
            <View key={offset} style={{ width: PAGE_WIDTH }}>
              <View style={styles.weekRow}>
                {getWeekDates(addDays(weekStart, offset)).map((date) => {
                  const key = dateKey(date);
                  const isToday = isSameDay(date, today);
                  const isSelected = !isToday && key === selectedKey;
                  return (
                    <Pressable key={key} style={styles.dayCell} onPress={() => selectDay(date)}>
                      <Text style={styles.dayAbbr}>{WEEKDAY_SHORT[mondayIndex(date)]}</Text>
                      <Text
                        style={[styles.dayNum, isSelected && styles.dayNumSelected, isToday && styles.dayNumToday]}
                      >
                        {date.getDate()}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>
          ))}
        </ScrollView>
      )}

      <View style={styles.expandRow}>
        <Pressable style={styles.expandButton} onPress={toggleMonthExpanded}>
          <Ionicons name={isMonthExpanded ? 'chevron-up' : 'chevron-down'} size={16} color="#9CA3AF" />
        </Pressable>
      </View>

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

      <View style={{ flex: 1 }}>
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
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  dayCell: {
    flex: 1,
    alignItems: 'center',
    gap: 6,
  },
  dayAbbr: {
    fontSize: 12,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  dayNum: {
    width: 34,
    height: 34,
    borderRadius: 17,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 16,
    fontWeight: '500',
    color: '#111827',
  },
  dayNumSelected: {
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    fontWeight: '700',
  },
  dayNumToday: {
    backgroundColor: '#EF4444',
    color: '#fff',
    fontWeight: '700',
  },
  monthNav: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 18,
    paddingTop: 4,
    paddingBottom: 10,
  },
  monthNavLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: '#111827',
  },
  weekdayHeader: {
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
  monthGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  gridCell: {
    width: `${100 / 7}%`,
    alignItems: 'center',
    paddingVertical: 3,
  },
  gridNum: {
    width: 34,
    height: 34,
    borderRadius: 17,
    textAlign: 'center',
    textAlignVertical: 'center',
    fontSize: 15,
    fontWeight: '500',
    color: '#111827',
  },
  gridNumMuted: {
    color: '#D1D5DB',
  },
  gridNumSelected: {
    borderWidth: 1.5,
    borderColor: '#D1D5DB',
    fontWeight: '700',
  },
  gridNumToday: {
    backgroundColor: '#EF4444',
    color: '#fff',
    fontWeight: '700',
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
});
