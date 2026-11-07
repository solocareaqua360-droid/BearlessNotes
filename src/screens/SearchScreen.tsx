import { useState } from 'react';
import { useSoft } from '../theme/soft';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SoftSearchField } from '../components/ContextDock';
import { useKeyboardRide } from '../hooks/useKeyboardRide';
import { DOCK_BOTTOM } from '../navigation/dockGeometry';
import ScreenGround from '../components/ScreenGround';
import { Ionicons } from '../components/icons/Ionicons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { RootStackParamList } from '../navigation';
import ContentColumn from '../components/ContentColumn';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { TextMatch, extractPreview, findBodyMatch, findTitleMatch, EXPANDED_PREVIEW_LENGTH } from '../utils/documentPreview';
import DocumentCard from '../components/DocumentCard';
import { useTags } from '../hooks/useTags';
import { SearchHit, SearchTarget, groupHits, useGlobalSearch } from '../hooks/useGlobalSearch';

// One search over every database (see useGlobalSearch) - reached from the
// capsule on the databases screen. Results come back grouped by the
// database they live in, in the same order the menu lists them.
export default function SearchScreen() {
  const S = useSoft();
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const insets = useSafeAreaInsets();
  const [needle, setNeedle] = useState('');
  // Where the dock rests on other desks, and how far the keyboard lifts it.
  const restBottom = DOCK_BOTTOM + insets.bottom + 6;
  const keyboard = useKeyboardRide();
  const ride = useAnimatedStyle(() => ({
    transform: [{ translateY: Math.min(0, keyboard.height.value - 10 + restBottom) }],
  }));
  const hits = useGlobalSearch(needle);
  const { tags } = useTags();
  const { width: screenWidth } = useWindowDimensions();
  const cardWidth = Math.max(220, Math.min(screenWidth, 640) - 32);
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

  function open(target: SearchTarget, query?: string) {
    switch (target.kind) {
      case 'document':
        // The note opens on the first found place, the words marked.
        navigation.navigate('Editor', { documentId: target.documentId, ...(query ? { searchQuery: query } : {}) });
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
        <ScrollView
          contentContainerStyle={[styles.list, { paddingTop: insets.top + 16, paddingBottom: restBottom + FIELD_H + 40 }]}
          keyboardShouldPersistTaps="handled"
        >
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

      {/* THE FIELD LIVES AT THE BOTTOM, where search is on every other desk
          (the user's, 2026-10-04): the dock's own capsule, riding up with
          the keyboard frame by frame, and the way back as the round button
          at its end. */}
      <Animated.View pointerEvents="box-none" style={[styles.dock, { bottom: restBottom }, ride]}>
        <SoftSearchField
          search={{
            placeholder: 'Пошук по всіх базах',
            initialQuery: '',
            onChangeQuery: setNeedle,
            onClose: () => navigation.goBack(),
          }}
          soft={S}
          height={FIELD_H}
        />
        <Pressable
          onPress={() => navigation.goBack()}
          accessibilityLabel="Назад"
          style={[styles.back, { backgroundColor: S.chrome, boxShadow: S.shadow }]}
        >
          <Ionicons name="chevron-back" size={22} color={S.ink} />
        </Pressable>
      </Animated.View>
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
        {group.hits.map((hit: SearchHit) =>
          hit.doc ? (
            // A note is the same card as in the Documents base: its page, the found words marked on it.
            (() => {
              const doc = hit.doc;
              const q = needle.trim();
              const titleMatch = findTitleMatch(hit.title, q);
              const bodyMatch = titleMatch ? null : findBodyMatch(doc.blocks, q);
              const preview = extractPreview(doc.blocks, doc.coverImageUri, EXPANDED_PREVIEW_LENGTH, doc.coverDriveFileId);
              return (
                <DocumentCard
                  key={hit.key}
                  id={hit.target.kind === 'document' ? hit.target.documentId : hit.key}
                  title={hit.title}
                  updatedAt={hit.updatedAt}
                  imageUri={preview.imageUri}
                  imageDriveFileId={preview.imageDriveFileId}
                  imageUris={preview.imageUris}
                  imageDriveFileIds={preview.imageDriveFileIds}
                  previewText={preview.previewText}
                  previewTail={preview.previewTail}
                  blocks={doc.blocks}
                  checklistItems={preview.checklistItems}
                  titleMatch={titleMatch}
                  bodyMatch={bodyMatch}
                  search={q}
                  onPress={() => open(hit.target, q)}
                  layout="grid"
                  wide
                  gridWidth={cardWidth}
                  flush
                  page={{
                    tagIds: doc.tagIds,
                    tags,
                    coverImageUri: doc.coverImageUri,
                    coverDriveFileId: doc.coverDriveFileId,
                    coverFrame: doc.coverFrame as never,
                    paperColorEnabled: doc.paperColorEnabled,
                  }}
                  soft={S}
                />
              );
            })()
          ) : (
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
          )
        )}
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

// The dock's own height (ContextDock's TWO_BEAD).
const FIELD_H = 56;

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  dock: {
    position: 'absolute',
    left: 14,
    right: 14,
    flexDirection: 'row',
    gap: 10,
  },
  back: {
    width: FIELD_H,
    height: FIELD_H,
    borderRadius: FIELD_H / 2,
    alignItems: 'center',
    justifyContent: 'center',
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
