import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Tag } from '../types';
import { FONT_MEDIUM, FONT_REGULAR } from '../utils/fonts';

type Props = {
  tags: Tag[];
  onPress: () => void;
  // Frosted-glass pill instead of a flat tint-of-the-tag's-own-color chip -
  // for rows sitting on a colorful card background (Links, whose cards each
  // get their own colorForDocument fill), where a per-tag pastel tint would
  // clash rather than stand out. Files/Photos rows are plain gray, where
  // the original flat-tint chip still reads fine - so this only opts in
  // where asked for, rather than changing the shared default.
  glass?: boolean;
};

// Shared row of tag chips for Files/Photos/Links rows - each existing tag
// as its own icon+color+name chip, plus a dashed "+ Тег" chip always last.
// Every chip (existing or the dashed one) opens the same TagPicker sheet;
// there's no separate "remove" tap target on a chip itself, matching the
// mockup (TagChipsRow.dc.html).
export default function TagChips({ tags, onPress, glass }: Props) {
  return (
    <View style={styles.row}>
      {tags.map((tag) => (
        <Pressable
          key={tag.id}
          style={[styles.chip, glass ? styles.chipGlass : { backgroundColor: `${tag.color}1A` }]}
          onPress={onPress}
        >
          <Ionicons name={tag.icon as keyof typeof Ionicons.glyphMap} size={12} color={glass ? '#fff' : tag.color} />
          <Text style={[styles.chipLabel, glass ? styles.chipLabelGlass : { color: tag.color }]} numberOfLines={1}>
            {tag.path}
          </Text>
        </Pressable>
      ))}
      <Pressable style={[styles.addChip, glass && styles.addChipGlass]} onPress={onPress}>
        <Ionicons name="add" size={12} color={glass ? 'rgba(255,255,255,0.75)' : '#9CA3AF'} />
        <Text style={[styles.addChipLabel, glass && styles.addChipLabelGlass]}>Тег</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 8,
    paddingLeft: 6,
  },
  chipLabel: {
    fontSize: 11,
    fontWeight: '500',
    fontFamily: FONT_MEDIUM,
  },
  chipGlass: {
    backgroundColor: 'rgba(20,20,20,0.35)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 999,
  },
  chipLabelGlass: {
    color: '#fff',
  },
  addChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#D1D5DB',
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  addChipGlass: {
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 999,
  },
  addChipLabelGlass: {
    color: 'rgba(255,255,255,0.75)',
  },
  addChipLabel: {
    fontSize: 11,
    fontFamily: FONT_REGULAR,
    color: '#9CA3AF',
  },
});
