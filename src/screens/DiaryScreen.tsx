import { useEffect, useState } from 'react';
import { useStyles } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useIsFocused, useNavigation } from '@react-navigation/native';
import { useDockActions, useDockLeave } from '../navigation/navDock';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { applyLiveRecord, useLiveRecords } from '../hooks/useLiveRecords';
import { DocumentItem } from '../types';
import { RootStackParamList } from '../navigation';
import DocumentCard from '../components/DocumentCard';
import { documentMatchesQuery, extractPreview, findBodyMatch, hasNoteContent } from '../utils/documentPreview';
import { formatShortDate, parseDateKey } from '../utils/dateLocale';
import { FONT_SEMIBOLD } from '../utils/fonts';
import DocumentEditorScreen from './DocumentEditorScreen';
import PlainScreenShell, { shellClear } from '../components/PlainScreenShell';
import SearchField, { searchFieldSides } from '../components/SearchField';


// "Щоденник" - calendar sheets (CalendarScreen's daily notes) as their own
// browsable, searchable database. A sheet only appears here at all once it
// has real content (hasNoteContent - the exact test the "filled days" dots
// already use); an empty day a user merely opened never shows up. No tags
// here on purpose - calendar days deliberately don't have them (the user
// was explicit: keeps the day-flipping simple), so unlike every other
// database screen there's no TagsDrawer/filter row.
export default function DiaryScreen({ inPane }: { inPane?: boolean } = {}) {
  const styles = useStyles(makeStyles);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [sheets, setSheets] = useState<DocumentItem[]>([]);
  // Records as they are now - see DocumentsScreen's same line.
  const liveRecords = useLiveRecords(sheets.length > 0);
  const [query_, setQuery] = useState('');
  // In another screen's pane the rail stands on the window's outer edge -
  // the left one.
  const railSide = inPane ? ('left' as const) : ('right' as const);
  // The sheet being read, IN THIS WINDOW. Tapping one used to jump to the
  // Calendar tab, which threw the list away - to look at a second day you
  // had to walk back. The sheet opens here instead and the way out in the
  // top capsule returns to the list, where the next day is one tap away.
  const [openDate, setOpenDate] = useState<string | null>(null);
  const isFocused = useIsFocused();
  // Two depths, one bead: leaving a day goes back to the LIST, not out of
  // the diary - the same "step up one level" the explorer's own crumbs
  // use, so the icon stays the diary's own either way.
  useDockLeave('book-outline', () => (openDate ? setOpenDate(null) : navigation.goBack()), isFocused);
  useDockActions(
    isFocused && openDate
      ? [
          {
            key: 'jump',
            icon: 'calendar-outline',
            onPress: () => navigation.navigate('Tabs', { screen: 'Календар', params: { jumpToDate: openDate } }),
          },
        ]
      : null
  );

  useEffect(() => {
    // "Has a calendarDate" used to be a range filter, and the sort used to
    // be the query's. Both moved here when ownedQuery started adding an
    // equality filter to every read: an equality filter with a range on
    // another field is the one combination Firestore will not serve
    // without a composite index built by hand.
    return onSnapshot(ownedQuery('documents'), (snapshot) => {
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
          .sort((a, b) => (b.calendarDate ?? '').localeCompare(a.calendarDate ?? ''))
      );
    },
    // Never optional here: under the owner-only rules a refused read
    // THROWS, and an unhandled one takes the screen down with it - which
    // is exactly what "the app quits when I open the diary" looks like.
    () => setSheets([]));
  }, []);

  const needle = query_.trim();
  const visible = needle.length === 0 ? sheets : sheets.filter((d) => documentMatchesQuery(d.title ?? '', d.blocks, needle));

  function openSheet(calendarDate: string | undefined) {
    if (!calendarDate) return;
    setOpenDate(calendarDate);
  }

  if (openDate) {
    return (
      <PlainScreenShell id="diaryBg">
        <View style={[styles.sheetHead, shellClear(railSide, 4)]}>
          <Text style={styles.sheetDate}>{formatShortDate(parseDateKey(openDate))}</Text>
        </View>
        {/* The calendar's own sheet, the same editor it draws - the
            document is `day_<key>`, so this is that day, not a copy. */}
        <View style={[styles.sheetBody, shellClear(railSide, 0)]}>
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

  return (
    <PlainScreenShell id="diaryBg">
      <SearchField
        value={query_}
        onChangeText={setQuery}
        placeholder="Пошук у щоденнику"
        style={[styles.searchRow, searchFieldSides(railSide)]}
      />

      <ScrollView contentContainerStyle={[styles.list, shellClear(railSide, 0)]}>
        {visible.map((item) => {
          const dateLabel = item.calendarDate
            ? formatShortDate(parseDateKey(item.calendarDate))
            : item.title || 'Без назви';
          // The card's title is always the date, never the raw title
          // field, so a title match (which would highlight a fragment of
          // the raw field, not the date shown) doesn't apply here - every
          // match is shown as a body/embedded-name snippet instead.
          const bodyMatch = needle ? findBodyMatch(item.blocks, needle) : null;
          const { imageUri, imageDriveFileId, previewText } = extractPreview(
            (item.blocks ?? []).map((b) => applyLiveRecord(b, liveRecords))
          );
          return (
            <DocumentCard
              key={item.id}
              id={item.id}
              title={dateLabel}
              updatedAt={item.updatedAt}
              imageUri={imageUri}
              imageDriveFileId={imageDriveFileId}
              previewText={previewText}
              bodyMatch={bodyMatch}
              // A sheet belongs to the calendar, and that is where it is
              // edited - the user's own call: jump there rather than open
              // it beside the list.
              onPress={() => openSheet(item.calendarDate)}
            />
          );
        })}
      </ScrollView>
    </PlainScreenShell>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
  // Only where it sits - the pill itself is SearchField's.
  searchRow: {
    marginBottom: 14,
  },
  list: {
    paddingBottom: 120,
    gap: 10,
  },
  sheetHead: {
    paddingBottom: 8,
  },
  sheetDate: {
    fontSize: 20,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  // The editor paints its own white paper, so it gets a rounded window
  // of its own rather than bleeding into the backdrop.
  sheetBody: {
    flex: 1,
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 16,
  },
  });
