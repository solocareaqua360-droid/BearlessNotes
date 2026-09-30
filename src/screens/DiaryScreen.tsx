import { useEffect, useState } from 'react';
import { useInnerBack } from '../navigation/innerBack';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { Platform, ScrollView, StyleSheet, View } from 'react-native';
import { requestCalendarDay } from '../navigation/calendarRequest';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTopBack, useTopExtras } from '../navigation/navDock';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { applyLiveRecord, useLiveRecords } from '../hooks/useLiveRecords';
import { DocumentItem } from '../types';
import { RootStackParamList } from '../navigation';
import DocumentCard from '../components/DocumentCard';
import DatabaseChrome from '../components/DatabaseChrome';
import { useDatabaseList } from '../hooks/useDatabaseList';
import { documentMatchesQuery, extractPreview, findBodyMatch, hasNoteContent } from '../utils/documentPreview';
import { formatShortDate, parseDateKey } from '../utils/dateLocale';
import DocumentEditorScreen from './DocumentEditorScreen';
import PlainScreenShell, { shellClear } from '../components/PlainScreenShell';
import TopNavBar, { TOP_NAV_SPACE, useTopNavOn } from '../components/TopNavBar';
import { railClear } from '../constants/rail';
import { withAlpha } from '../utils/color';
import { ask } from '../components/surfaces/Ask';
import { useDensity } from '../hooks/useDensity';
import { openTabWithSequence } from '../navigation/desktopTabs';
import { go } from '../components/DesktopTabs';

type Sheet = DocumentItem & { calendarDate?: string };

// "Щоденник" - calendar sheets (CalendarScreen's daily notes) as a
// database like the others: the bar with its name, search on the dock's
// left bead, the list's look and order in "⋯". It is where days are
// SEARCHED now - the calendar's own layer carries no search of its own
// ("прибираємо пошук саме зі шторки ... доробити базу щоденника як
// робочу версію з пошуком").
//
// A sheet appears here once it has real content (hasNoteContent - the
// test the "filled days" dots use). No tags and no projects: calendar
// days deliberately carry neither.
export default function DiaryScreen({ inPane }: { inPane?: boolean } = {}) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const topNavOn = useTopNavOn();
  const [sheets, setSheets] = useState<Sheet[]>([]);
  // Records as they are now - see DocumentsScreen's same line.
  const liveRecords = useLiveRecords(sheets.length > 0);
  const railSide = inPane ? ('left' as const) : ('right' as const);
  // The sheet being read, IN THIS WINDOW - the next day is one step back
  // and one tap away, instead of a trip to the calendar and back.
  const [openDate, setOpenDate] = useState<string | null>(null);
  const isFocused = useIsFocused();
  const accent = theme.sections.calendar;

  useEffect(() => {
    // "Has a calendarDate" is filtered here, not in the query: ownedQuery's
    // ownerId equality plus a range on another field needs a composite
    // index built by hand.
    return onSnapshot(
      ownedQuery('documents'),
      (snapshot) => {
        setSheets(
          snapshot.docs
            .map((docSnapshot) => ({
              id: docSnapshot.id,
              title: docSnapshot.data().title,
              updatedAt: docSnapshot.data().updatedAt,
              blocks: docSnapshot.data().blocks ?? [],
              calendarDate: docSnapshot.data().calendarDate as string | undefined,
            }))
            .filter((d) => !!d.calendarDate && hasNoteContent(d.title ?? '', d.blocks))
        );
      },
      // Never optional: under the owner-only rules a refused read THROWS.
      () => setSheets([])
    );
  }, []);

  // The laptop's right button: the day in a tab of its own, whose arrows
  // step through the days shown here - the filled ones, the only ones the
  // diary lists - in the calendar's order: ← the day before, → the day after.
  const pointer = useDensity() === 'pointer';
  function holdDay(item: Sheet) {
    if (!item.calendarDate) return;
    const date = item.calendarDate;
    ask({
      title: dateLabel(item),
      actions: [{ id: 'tab', label: 'Відкрити в новій вкладці', icon: 'browsers-outline' }],
    }).then((answer) => {
      if (answer !== 'tab') return;
      const days = list.displayed.flatMap((d) => (d.calendarDate ? [d.calendarDate] : [])).sort();
      go(openTabWithSequence('note', `day_${date}`, days.map((d) => `day_${d}`)));
    });
  }

  const dateLabel = (item: Sheet) =>
    item.calendarDate ? formatShortDate(parseDateKey(item.calendarDate)) : item.title || 'Без назви';

  const list = useDatabaseList<Sheet>({
    prefsKey: 'diaryPrefs',
    groupKind: 'diary',
    tagKind: 'diary',
    items: sheets,
    tagIdsOf: () => [],
    groupIdOf: () => undefined,
    titleOf: dateLabel,
    // The day itself is when a sheet was "made" - so "by date" is the
    // calendar's own order, not the order they happened to be typed in.
    createdAtOf: (item) => (item.calendarDate ? parseDateKey(item.calendarDate).getTime() : undefined),
    updatedAtOf: (item) => item.updatedAt ?? 0,
    matchesSearch: (item, needle) => documentMatchesQuery(item.title ?? '', item.blocks, needle),
    searchIgnoresFilters: true,
  });

  // AN OPEN DAY: its own bar - the date, the way back to the list, and
  // "⋯ → У календарі" for the day in its place among the others.
  useTopBack(() => setOpenDate(null), !!openDate && topNavOn);
  // The laptop's one way back: the open day back to the list of days.
  useInnerBack(openDate ? () => setOpenDate(null) : null);
  useTopExtras(
    openDate
      ? [
          {
            label: 'Відкрити в календарі',
            icon: 'calendar-outline',
            onPress: () => {
              // The phone's calendar is the layer beside the desks; the
              // browser's is still a desk of its own.
              if (Platform.OS === 'web') {
                navigation.navigate('Tabs', { screen: 'Календар', params: { jumpToDate: openDate } });
                return;
              }
              navigation.navigate('Tabs');
              requestCalendarDay(openDate);
            },
          },
        ]
      : null,
    null,
    !!openDate && topNavOn && isFocused
  );

  if (openDate) {
    return (
      <PlainScreenShell id="diaryBg">
        {topNavOn && isFocused && (
          <TopNavBar title={{ icon: 'book-outline', label: formatShortDate(parseDateKey(openDate)) }} />
        )}
        <View style={{ height: topNavOn ? TOP_NAV_SPACE - 8 : 0 }} />
        {/* The calendar's own sheet, the same editor it draws - the
            document is `day_<key>`, so this is that day, not a copy. */}
        <View style={[styles.sheetBody, shellClear(railSide, 0), { marginBottom: 16 + insets.bottom }]}>
          <DocumentEditorScreen
            key={`day_${openDate}`}
            embedded
            documentId={`day_${openDate}`}
            navigation={navigation}
            extraFields={{ calendarDate: openDate }}
          />
        </View>
      </PlainScreenShell>
    );
  }

  const grid = list.viewMode === 'grid';
  return (
    <DatabaseChrome
      list={list}
      accent={accent}
      accentGlass={withAlpha(accent, 0.55)}
      onBack={() => navigation.goBack()}
      leaveIcon="book-outline"
      navTitle={inPane ? undefined : { icon: 'book-outline', label: 'Щоденник' }}
      railSide={railSide}
      searchPlaceholder="Пошук у щоденнику"
      hideDrawer
      shape={{
        icon: grid ? 'grid-outline' : 'reorder-four-outline',
        onToggle: () => list.changeViewMode(grid ? 'list' : 'grid'),
      }}
    >
      {(listTopPad, listProps, listWidth) => (
        <ScrollView
          {...listProps}
          contentContainerStyle={[
            grid ? styles.grid : styles.list,
            railClear(railSide, grid ? 20 : 0),
            { paddingTop: listTopPad },
          ]}
        >
          {list.displayed.map((item) => {
            // The card's title is always the date, never the raw title
            // field, so a match is shown as a body snippet.
            const bodyMatch = list.needle ? findBodyMatch(item.blocks, list.needle) : null;
            const { imageUri, imageDriveFileId, previewText } = extractPreview(
              (item.blocks ?? []).map((b) => applyLiveRecord(b, liveRecords))
            );
            return (
              <DocumentCard
                key={item.id}
                id={item.id}
                title={dateLabel(item)}
                updatedAt={item.updatedAt}
                imageUri={imageUri}
                imageDriveFileId={imageDriveFileId}
                previewText={previewText}
                bodyMatch={bodyMatch}
                search={list.needle || undefined}
                layout={grid ? 'grid' : 'list'}
                gridWidth={grid ? Math.floor((listWidth - 20 - 12) / 2) : undefined}
                onPress={() => item.calendarDate && setOpenDate(item.calendarDate)}
                onLongPress={pointer && item.calendarDate ? () => holdDay(item) : undefined}
              />
            );
          })}
        </ScrollView>
      )}
    </DatabaseChrome>
  );
}

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    list: {
      paddingBottom: 120,
      gap: 10,
    },
    grid: {
      paddingBottom: 120,
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 12,
    },
    // The editor paints its own paper, so it gets a rounded window of its
    // own rather than bleeding into the backdrop.
    sheetBody: {
      flex: 1,
      borderRadius: 18,
      overflow: 'hidden',
    },
  });
