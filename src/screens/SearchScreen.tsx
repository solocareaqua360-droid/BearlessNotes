import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation';
import ContentColumn from '../components/ContentColumn';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { GLASS_CARD, GLASS_INPUT, GLASS_TEXT, GLASS_TEXT_FAINT, GLASS_TEXT_MUTED } from '../constants/glass';
import { TextMatch } from '../utils/documentPreview';
import { SearchHit, SearchTarget, groupHits, useGlobalSearch } from '../hooks/useGlobalSearch';

// One search over every database (see useGlobalSearch) - reached from the
// capsule on the databases screen. Results come back grouped by the
// database they live in, in the same order the menu lists them.
export default function SearchScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [needle, setNeedle] = useState('');
  const hits = useGlobalSearch(needle);
  const groups = groupHits(hits);
  // Documents are the priority: a search for a common word turns up a
  // dozen links and buries the three notes that were actually wanted. So
  // documents stand on their own, and every other database waits behind
  // one line until asked for - unless nothing was found in documents at
  // all, in which case there is nothing to bury and the rest opens itself.
  const documentGroups = groups.filter((g) => g.section.key === 'documents');
  const otherGroups = groups.filter((g) => g.section.key !== 'documents');
  const otherCount = otherGroups.reduce((sum, g) => sum + g.hits.length, 0);
  const [showOthers, setShowOthers] = useState(false);
  const othersOpen = showOthers || documentGroups.length === 0;

  function open(target: SearchTarget) {
    switch (target.kind) {
      case 'document':
        navigation.navigate('Editor', { documentId: target.documentId });
        return;
      case 'links':
        navigation.navigate('Links', { category: target.category });
        return;
      case 'screen':
        navigation.navigate(target.route);
        return;
      case 'customDatabase':
        navigation.navigate('CustomDatabase', { databaseId: target.databaseId });
        return;
      case 'board':
        navigation.navigate('Tabs', {
          screen: 'Дошки',
          params: { screen: 'Board', params: { boardId: target.boardId } },
        });
    }
  }

  return (
    <View style={styles.container}>
      {/* The same fixed gradient every other screen stands on. */}
      <Svg
        width={windowWidth + 2}
        height={windowHeight + 2}
        style={[StyleSheet.absoluteFill, { top: -1, left: -1 }]}
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="searchBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.03" stopColor="#705648" />
            <Stop offset="0.52" stopColor="#69736E" />
            <Stop offset="1" stopColor="#000000" />
          </LinearGradient>
        </Defs>
        <Rect width={windowWidth + 2} height={windowHeight + 2} fill="url(#searchBg)" />
      </Svg>

      <ContentColumn>
        {/* The way back sits in the search row itself: this screen is one
            field and its results, and a capsule of its own beside them
            would be three controls for a screen that has one. */}
        <View style={[styles.searchRow, { marginTop: insets.top + 12 }]}>
          <Pressable hitSlop={10} onPress={() => navigation.goBack()}>
            <Ionicons name="arrow-back-outline" size={22} color={GLASS_TEXT} />
          </Pressable>
          <TextInput
            autoFocus
            value={needle}
            onChangeText={setNeedle}
            placeholder="Пошук по всіх базах"
            placeholderTextColor={GLASS_TEXT_FAINT}
            style={styles.searchInput}
          />
          {needle.length > 0 && (
            <Pressable hitSlop={10} onPress={() => setNeedle('')}>
              <Ionicons name="close-outline" size={20} color={GLASS_TEXT_MUTED} />
            </Pressable>
          )}
        </View>

        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {needle.trim().length > 0 && groups.length === 0 && (
            <Text style={styles.empty}>Нічого не знайдено</Text>
          )}

          {renderGroups(documentGroups)}

          {otherGroups.length > 0 && (
            <Pressable style={styles.otherToggle} onPress={() => setShowOthers((v) => !v)}>
              <Ionicons
                name={othersOpen ? 'chevron-down' : 'chevron-forward'}
                size={16}
                color={GLASS_TEXT_MUTED}
              />
              <Text style={styles.otherToggleLabel}>
                {othersOpen ? 'Інші бази' : `Ще ${otherCount} в інших базах`}
              </Text>
            </Pressable>
          )}

          {othersOpen && renderGroups(otherGroups)}
        </ScrollView>
      </ContentColumn>
    </View>
  );

  function renderGroups(shown: ReturnType<typeof groupHits>) {
    return shown.map((group) => (
      <View key={group.section.key} style={styles.group}>
        <View style={styles.groupHeader}>
          <Ionicons name={group.section.icon} size={15} color={group.section.color} />
          <Text style={[styles.groupLabel, { color: group.section.color }]}>{group.section.label}</Text>
          <Text style={styles.groupCount}>{group.hits.length}</Text>
        </View>
        {group.hits.map((hit: SearchHit) => (
          <Pressable key={hit.key} style={styles.row} onPress={() => open(hit.target)}>
            <View style={[styles.rowIcon, { backgroundColor: `${group.section.color}22` }]}>
              <Ionicons name={group.section.icon} size={16} color={group.section.color} />
            </View>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle} numberOfLines={1}>
                {hit.title || 'Без назви'}
              </Text>
              {hit.match && <Highlighted match={hit.match} />}
            </View>
          </Pressable>
        ))}
      </View>
    ));
  }
}

// The matched fragment, lit up inside the line it was found in.
function Highlighted({ match }: { match: TextMatch }) {
  return (
    <Text style={styles.rowSnippet} numberOfLines={1}>
      {match.before}
      <Text style={styles.rowHighlight}>{match.match}</Text>
      {match.after}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 20,
    marginBottom: 12,
    backgroundColor: GLASS_INPUT,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
    padding: 0,
  },
  list: {
    paddingHorizontal: 20,
    paddingBottom: 40,
  },
  empty: {
    marginTop: 40,
    textAlign: 'center',
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
  },
  group: {
    marginBottom: 18,
  },
  // The one line every other database waits behind.
  otherToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 4,
    marginBottom: 6,
  },
  otherToggleLabel: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT_MUTED,
  },
  groupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingLeft: 4,
    paddingBottom: 8,
  },
  groupLabel: {
    fontSize: 12,
    fontFamily: FONT_BOLD,
    letterSpacing: 0.06,
    textTransform: 'uppercase',
  },
  groupCount: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_FAINT,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 10,
    marginBottom: 6,
    borderRadius: 14,
    backgroundColor: GLASS_CARD,
  },
  rowIcon: {
    width: 34,
    height: 34,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 14,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT,
  },
  rowSnippet: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
  },
  rowHighlight: {
    color: GLASS_TEXT,
    fontFamily: FONT_SEMIBOLD,
  },
});
