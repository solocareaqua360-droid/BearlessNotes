import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { collection, onSnapshot, orderBy, query, where } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { DocumentItem } from '../types';
import { RootStackParamList } from '../navigation';
import DocumentCard from '../components/DocumentCard';
import { documentMatchesQuery, extractPreview, findBodyMatch, hasNoteContent } from '../utils/documentPreview';
import { formatShortDate, parseDateKey } from '../utils/dateLocale';
import ContentColumn from '../components/ContentColumn';
import { FONT_BOLD, FONT_REGULAR } from '../utils/fonts';

const documentsCollection = collection(db, 'documents');

// "Щоденник" - calendar sheets (CalendarScreen's daily notes) as their own
// browsable, searchable database. A sheet only appears here at all once it
// has real content (hasNoteContent - the exact test the "filled days" dots
// already use); an empty day a user merely opened never shows up. No tags
// here on purpose - calendar days deliberately don't have them (the user
// was explicit: keeps the day-flipping simple), so unlike every other
// database screen there's no TagsDrawer/filter row.
export default function DiaryScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [sheets, setSheets] = useState<DocumentItem[]>([]);
  const [query_, setQuery] = useState('');

  useEffect(() => {
    // calendarDate sorts the same as the date it represents (YYYY-MM-DD),
    // so ordering by it directly needs no composite index - ordering by
    // updatedAt instead would (a range filter and an orderBy on two
    // different fields).
    const sheetsQuery = query(documentsCollection, where('calendarDate', '>', ''), orderBy('calendarDate', 'desc'));
    return onSnapshot(sheetsQuery, (snapshot) => {
      setSheets(
        snapshot.docs
          .map((docSnapshot) => ({
            id: docSnapshot.id,
            title: docSnapshot.data().title,
            updatedAt: docSnapshot.data().updatedAt,
            blocks: docSnapshot.data().blocks ?? [],
            calendarDate: docSnapshot.data().calendarDate as string,
          }))
          .filter((d) => hasNoteContent(d.title ?? '', d.blocks))
      );
    });
  }, []);

  const needle = query_.trim();
  const visible = needle.length === 0 ? sheets : sheets.filter((d) => documentMatchesQuery(d.title ?? '', d.blocks, needle));

  function openSheet(calendarDate: string | undefined) {
    if (!calendarDate) return;
    navigation.navigate('Tabs', { screen: 'Календар', params: { jumpToDate: calendarDate } });
  }

  return (
    <View style={styles.container}>
      <ContentColumn>
        <View style={styles.headerRow}>
          <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={22} color="#111827" />
          </Pressable>
          <Text style={styles.header}>Щоденник</Text>
        </View>

        <View style={styles.searchRow}>
          <Ionicons name="search" size={16} color="#9CA3AF" />
          <TextInput
            value={query_}
            onChangeText={setQuery}
            placeholder="Пошук у щоденнику"
            placeholderTextColor="#9CA3AF"
            style={styles.searchInput}
          />
        </View>

        <ScrollView contentContainerStyle={styles.list}>
          {visible.map((item) => {
            const dateLabel = item.calendarDate ? formatShortDate(parseDateKey(item.calendarDate)) : (item.title || 'Без назви');
            // The card's title is always the date, never the raw title
            // field, so a title match (which would highlight a fragment of
            // the raw field, not the date shown) doesn't apply here - every
            // match is shown as a body/embedded-name snippet instead.
            const bodyMatch = needle ? findBodyMatch(item.blocks, needle) : null;
            const { imageUri, previewText } = extractPreview(item.blocks);
            return (
              <DocumentCard
                key={item.id}
                id={item.id}
                title={dateLabel}
                updatedAt={item.updatedAt}
                imageUri={imageUri}
                previewText={previewText}
                bodyMatch={bodyMatch}
                onPress={() => openSheet(item.calendarDate)}
              />
            );
          })}
        </ScrollView>
      </ContentColumn>

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
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: '#111827',
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 16,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: '#111827',
  },
  list: {
    paddingHorizontal: 0,
  },
});
