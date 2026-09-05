import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { collection, onSnapshot, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import { DocumentItem } from '../types';
import { RootStackParamList } from '../navigation';

const ACCENT = '#3B82F6';
const documentsCollection = collection(db, 'documents');

// Pushed as its own stack screen from the search icon on DocumentsScreen -
// searches document titles only (see SearchScreenFull.dc.html). Tag
// browsing lives in the pull-out TagsDrawer now, not here.
export default function SearchScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const [documents, setDocuments] = useState<DocumentItem[]>([]);
  const [query_, setQuery] = useState('');

  useEffect(() => {
    const documentsQuery = query(documentsCollection, orderBy('updatedAt', 'desc'));
    return onSnapshot(documentsQuery, (snapshot) => {
      setDocuments(
        snapshot.docs.map((docSnapshot) => ({
          id: docSnapshot.id,
          title: docSnapshot.data().title,
          updatedAt: docSnapshot.data().updatedAt,
        }))
      );
    });
  }, []);

  const needle = query_.trim().toLowerCase();
  const matches = needle.length === 0 ? [] : documents.filter((d) => (d.title ?? '').toLowerCase().includes(needle));

  return (
    <View style={styles.container}>
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
        {matches.map((item) => (
          <Pressable key={item.id} style={styles.row} onPress={() => navigation.navigate('Editor', { documentId: item.id })}>
            <View style={styles.rowIcon}>
              <Ionicons name="document-text-outline" size={18} color={ACCENT} />
            </View>
            <Text style={styles.rowTitle} numberOfLines={1}>
              {item.title || 'Без назви'}
            </Text>
          </Pressable>
        ))}
      </ScrollView>
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
    color: '#111827',
  },
  list: {
    paddingHorizontal: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
  },
  rowIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  rowTitle: {
    flex: 1,
    fontSize: 16,
    color: '#111827',
  },
});
