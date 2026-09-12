import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { collection, onSnapshot, orderBy, query } from '@react-native-firebase/firestore';
import { db } from '../firebase';
import { DocumentItem } from '../types';
import { RootStackParamList } from '../navigation';
import DocumentCard from '../components/DocumentCard';
import { documentMatchesQuery, extractPreview, findBodyMatch, findTitleMatch } from '../utils/documentPreview';
import ContentColumn from '../components/ContentColumn';
import { FONT_REGULAR } from '../utils/fonts';

const documentsCollection = collection(db, 'documents');

// Pushed as its own stack screen from the search icon on DocumentsScreen -
// searches document titles AND body text, highlighting the matched
// fragment (title match takes priority; otherwise the first body snippet
// containing the match is shown, Bear-style). Tag browsing lives in the
// pull-out TagsDrawer now, not here.
export default function SearchScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [query_, setQuery] = useState('');

  useEffect(() => {
    const documentsQuery = query(documentsCollection, orderBy('updatedAt', 'desc'));
    return onSnapshot(documentsQuery, (snapshot) => {
      setDocuments(
        snapshot.docs
          // Daily notes (CalendarScreen) live in this same collection but
          // aren't part of this document search.
          .filter((docSnapshot) => !docSnapshot.data().calendarDate)
          .map((docSnapshot) => ({
            id: docSnapshot.id,
            title: docSnapshot.data().title,
            updatedAt: docSnapshot.data().updatedAt,
            blocks: docSnapshot.data().blocks ?? [],
            coverImageUri: docSnapshot.data().coverImageUri,
          }))
      );
    });
  }, []);

  const needle = query_.trim();
  const matches = needle.length === 0 ? [] : documents.filter((d) => documentMatchesQuery(d.title ?? '', d.blocks, needle));

  return (
    <View style={styles.container}>
      <ContentColumn>
        <View style={styles.headerRow}>
          <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={22} color="#111827" />
          </Pressable>
        </View>

        <View style={styles.searchRow}>
          <Ionicons name="search" size={16} color="#9CA3AF" />
          <TextInput
            autoFocus
            value={query_}
            onChangeText={setQuery}
            placeholder="Пошук документів"
            placeholderTextColor="#9CA3AF"
            style={styles.searchInput}
          />
        </View>

        <ScrollView contentContainerStyle={styles.list}>
          {matches.map((item) => {
            const titleMatch = findTitleMatch(item.title ?? '', needle);
            const bodyMatch = titleMatch ? null : findBodyMatch(item.blocks, needle);
            const { imageUri, previewText } = extractPreview(item.blocks, item.coverImageUri);
            return (
              <DocumentCard
                key={item.id}
                id={item.id}
                title={item.title}
                updatedAt={item.updatedAt}
                imageUri={imageUri}
                previewText={previewText}
                titleMatch={titleMatch}
                bodyMatch={bodyMatch}
                onPress={() => navigation.navigate('Editor', { documentId: item.id })}
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
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
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
