import { useState } from 'react';
import { useSoft } from '../theme/soft';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import ScreenGround from '../components/ScreenGround';
import { Ionicons } from '../components/icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation';
import ContentColumn from '../components/ContentColumn';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { TextMatch } from '../utils/documentPreview';
import { SearchHit, SearchTarget, groupHits, useGlobalSearch } from '../hooks/useGlobalSearch';

// One search over every database (see useGlobalSearch) - reached from the
// capsule on the databases screen. Results come back grouped by the
// database they live in, in the same order the menu lists them.
export default function SearchScreen() {
  const S = useSoft();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
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
        navigation.navigate('CustomDatabase', { databaseId: target.databaseId, openRowId: target.rowId });
        return;
      case 'board':
        // Pushed on its own, not through the boards' desk: that desk is
        // the user's to close now (see navigation/desks).
        navigation.navigate('BoardCopy', { boardId: target.boardId });
    }
  }

  return (
    <View style={styles.container}>
      {/* THE SOFT STYLE, as every desk now wears it (the user's, 2026-10-04:
          the old glass field with its highlights stood out): a flat ground,
          the field a quiet capsule with the way back in it, results as
          soft cards. */}
      <ScreenGround color={S.bg} />

      <ContentColumn>
        <View style={[styles.field, { marginTop: insets.top + 12, backgroundColor: S.chrome, boxShadow: S.shadow }]}>
          <Pressable hitSlop={10} onPress={() => navigation.goBack()} accessibilityLabel="Назад">
            <Ionicons name="chevron-back" size={24} color={S.ink} />
          </Pressable>
          <TextInput
            autoFocus
            value={needle}
            onChangeText={setNeedle}
            placeholder="Пошук по всіх базах"
            placeholderTextColor={S.ink3}
            style={[styles.input, { color: S.ink }]}
            returnKeyType="search"
          />
          {needle.length > 0 && (
            <Pressable hitSlop={10} onPress={() => setNeedle('')} accessibilityLabel="Очистити">
              <Ionicons name="close-circle" size={20} color={S.ink3} />
            </Pressable>
          )}
        </View>

        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">
          {needle.trim().length > 0 && groups.length === 0 && (
            <Text style={[styles.empty, { color: S.ink3 }]}>Нічого не знайдено</Text>
          )}

          {renderGroups(documentGroups)}

          {otherGroups.length > 0 && (
            <Pressable style={styles.otherToggle} onPress={() => setShowOthers((v) => !v)}>
              <Ionicons name={othersOpen ? 'chevron-down' : 'chevron-forward'} size={16} color={S.ink2} />
              <Text style={[styles.otherToggleLabel, { color: S.ink2 }]}>
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
          <Text style={[styles.groupCount, { color: S.ink3 }]}>{group.hits.length}</Text>
        </View>
        {group.hits.map((hit: SearchHit) => (
          <Pressable
            key={hit.key}
            style={[styles.row, { backgroundColor: S.card, boxShadow: S.shadow }]}
            onPress={() => open(hit.target)}
          >
            <View style={[styles.rowIcon, { backgroundColor: S.fill }]}>
              <Ionicons name={group.section.icon} size={16} color={group.section.color} />
            </View>
            <View style={styles.rowText}>
              <Text style={[styles.rowTitle, { color: S.ink }]} numberOfLines={1}>
                {hit.title || 'Без назви'}
              </Text>
              {hit.match && <Highlighted match={hit.match} ink={S.ink} muted={S.ink2} />}
            </View>
          </Pressable>
        ))}
      </View>
    ));
  }
}

// The matched fragment, lit up inside the line it was found in.
function Highlighted({ match, ink, muted }: { match: TextMatch; ink: string; muted: string }) {
  return (
    <Text style={[styles.rowSnippet, { color: muted }]} numberOfLines={1}>
      {match.before}
      <Text style={[styles.rowHighlight, { color: ink }]}>{match.match}</Text>
      {match.after}
    </Text>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    height: 56,
    marginHorizontal: 16,
    marginBottom: 14,
    paddingHorizontal: 16,
    borderRadius: 28,
  },
  input: {
    flex: 1,
    height: '100%',
    paddingVertical: 0,
    fontSize: 16,
    fontFamily: SOFT_REGULAR,
  },
  list: {
    paddingHorizontal: 16,
    paddingBottom: 40,
  },
  empty: {
    marginTop: 40,
    textAlign: 'center',
    fontSize: 14,
    fontFamily: SOFT_MEDIUM,
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
    fontFamily: SOFT_SEMIBOLD,
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
    fontFamily: SOFT_SEMIBOLD,
    letterSpacing: 0.06,
    textTransform: 'uppercase',
  },
  groupCount: {
    fontSize: 12,
    fontFamily: SOFT_MEDIUM,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    marginBottom: 8,
    borderRadius: 18,
  },
  rowIcon: {
    width: 36,
    height: 36,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    flex: 1,
    gap: 2,
  },
  rowTitle: {
    fontSize: 15,
    fontFamily: SOFT_SEMIBOLD,
  },
  rowSnippet: {
    fontSize: 13,
    fontFamily: SOFT_REGULAR,
  },
  rowHighlight: {
    fontFamily: SOFT_SEMIBOLD,
  },
});
