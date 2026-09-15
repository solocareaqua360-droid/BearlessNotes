import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { applyLiveRecord, useLiveRecords } from '../hooks/useLiveRecords';
import { DocumentItem } from '../types';
import { RootStackParamList } from '../navigation';
import DocumentCard from '../components/DocumentCard';
import { documentMatchesQuery, extractPreview, findBodyMatch, hasNoteContent } from '../utils/documentPreview';
import { formatShortDate, parseDateKey } from '../utils/dateLocale';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import DocumentEditorScreen from './DocumentEditorScreen';
import PlainScreenShell, { shellClear } from '../components/PlainScreenShell';
import { GLASS_TEXT, GLASS_TEXT_MUTED } from '../constants/glass';


// "Щоденник" - calendar sheets (CalendarScreen's daily notes) as their own
// browsable, searchable database. A sheet only appears here at all once it
// has real content (hasNoteContent - the exact test the "filled days" dots
// already use); an empty day a user merely opened never shows up. No tags
// here on purpose - calendar days deliberately don't have them (the user
// was explicit: keeps the day-flipping simple), so unlike every other
// database screen there's no TagsDrawer/filter row.
export default function DiaryScreen({ inPane }: { inPane?: boolean } = {}) {
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
    });
  }, []);

  const needle = query_.trim();
  const visible = needle.length === 0 ? sheets : sheets.filter((d) => documentMatchesQuery(d.title ?? '', d.blocks, needle));

  function openSheet(calendarDate: string | undefined) {
    if (!calendarDate) return;
    setOpenDate(calendarDate);
  }

  if (openDate) {
    return (
      <PlainScreenShell
        id="diaryBg"
        // Back means back to the LIST, not out of the diary.
        onBack={() => setOpenDate(null)}
        railSide={railSide}
        hasIsland={!inPane}
        actions={[
          {
            icon: 'calendar-outline',
            onPress: () =>
              navigation.navigate('Tabs', { screen: 'Календар', params: { jumpToDate: openDate } }),
          },
        ]}
      >
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
    <PlainScreenShell id="diaryBg" onBack={() => navigation.goBack()} railSide={railSide} hasIsland={!inPane}>
      <View style={[styles.searchRow, shellClear(railSide, 20)]}>
        <Ionicons name="search" size={16} color={GLASS_TEXT_MUTED} />
        <TextInput
          value={query_}
          onChangeText={setQuery}
          placeholder="Пошук у щоденнику"
          placeholderTextColor={GLASS_TEXT_MUTED}
          style={styles.searchInput}
        />
      </View>

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

const styles = StyleSheet.create({
  // Glass, like the field on every other database - it stood on white
  // with a grey fill, which is what made this screen read as another app.
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 14,
    backgroundColor: 'rgba(255,255,255,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
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
    color: GLASS_TEXT,
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
