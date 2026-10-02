import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from './icons/Ionicons';
import { useSoft } from '../theme/soft';
import { dockClearance } from '../navigation/dockGeometry';
import { useRecentFolderIds } from '../utils/recentFolders';
import { FONT_SEMIBOLD } from '../utils/fonts';
import type { Tag } from '../types';

// FILING A SELECTION IN ONE TAP (the folders rework, step 2, 2026-10-02:
// "механізм швидкого призначення папок... майже безшовно, щоб не
// виникало плутанини"). While something is selected - photos, files,
// notes, links, records, any database - the folders last put to use
// stand over the dock, the same ones in the same order everywhere
// (utils/recentFolders); a tap files the whole selection in that folder.
// «Інша папка…» is the picker every database already has.
const MAX_SHOWN = 6;

export default function RecentFolderStrip({
  tags,
  onPick,
  onOther,
}: {
  // Every folder there is (useTags) - the recent ids are looked up here,
  // and one deleted since is simply not shown.
  tags: Tag[];
  onPick: (tag: Tag) => void;
  onOther: () => void;
}) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const recent = useRecentFolderIds()
    .map((id) => tags.find((t) => t.id === id))
    .filter((t): t is Tag => !!t)
    .slice(0, MAX_SHOWN);
  const chip = [styles.chip, { backgroundColor: S.card, boxShadow: S.shadow }];
  return (
    <View
      style={[styles.strip, { bottom: insets.bottom + dockClearance(width, 10) }]}
      pointerEvents="box-none"
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row} keyboardShouldPersistTaps="handled">
        {recent.map((tag) => (
          <Pressable key={tag.id} style={chip} onPress={() => onPick(tag)}>
            <Ionicons name="folder" size={16} color={tag.color} />
            <Text style={[styles.label, { color: S.ink }]} numberOfLines={1}>
              {tag.path.split('/').pop()}
            </Text>
          </Pressable>
        ))}
        <Pressable style={chip} onPress={onOther}>
          <Ionicons name="folder-open-outline" size={16} color={S.ink2} />
          <Text style={[styles.label, { color: S.ink2 }]}>{recent.length > 0 ? 'Інша папка…' : 'У папку…'}</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  strip: {
    position: 'absolute',
    left: 0,
    right: 0,
    zIndex: 30,
  },
  row: {
    paddingHorizontal: 16,
    gap: 8,
    paddingVertical: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    maxWidth: 220,
  },
  label: {
    fontSize: 14,
    fontFamily: FONT_SEMIBOLD,
  },
});
