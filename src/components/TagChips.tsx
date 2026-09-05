import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Tag } from '../types';

type Props = {
  tags: Tag[];
  onPress: () => void;
};

// Shared row of tag chips for Files/Photos/Links rows - each existing tag
// as its own icon+color+name chip, plus a dashed "+ Тег" chip always last.
// Every chip (existing or the dashed one) opens the same TagPicker sheet;
// there's no separate "remove" tap target on a chip itself, matching the
// mockup (TagChipsRow.dc.html).
export default function TagChips({ tags, onPress }: Props) {
  return (
    <View style={styles.row}>
      {tags.map((tag) => (
        <Pressable key={tag.id} style={[styles.chip, { backgroundColor: `${tag.color}1A` }]} onPress={onPress}>
          <Ionicons name={tag.icon as keyof typeof Ionicons.glyphMap} size={12} color={tag.color} />
          <Text style={[styles.chipLabel, { color: tag.color }]} numberOfLines={1}>
            {tag.path}
          </Text>
        </Pressable>
      ))}
      <Pressable style={styles.addChip} onPress={onPress}>
        <Ionicons name="add" size={12} color="#9CA3AF" />
        <Text style={styles.addChipLabel}>Тег</Text>
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
  addChipLabel: {
    fontSize: 11,
    color: '#9CA3AF',
  },
});
