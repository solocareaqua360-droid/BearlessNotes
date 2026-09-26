import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Tag } from '../types';
import { useStyles } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { GLASS_EDGE, GLASS_ISLAND, GLASS_TEXT, GLASS_TEXT_MUTED } from '../constants/glass';
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
  // Show at most this many chips, and then one "+N" for the rest. A card
  // is a card, not a list of folders: the user's rule is the first
  // folder's name and a count of what else it is in.
  max?: number;
};

// Shared row of tag chips for Files/Photos/Links rows - each existing tag
// as its own icon+color+name chip, plus a dashed "+ папка" chip always
// last. «Папка», not «Тег»: the two are one thing here and the app calls
// it a folder everywhere else - the drawer, the explorer, a note's own
// row. These cards were the last place still saying the old word.
// Every chip (existing or the dashed one) opens the same TagPicker sheet;
// there's no separate "remove" tap target on a chip itself, matching the
// mockup (TagChipsRow.dc.html).
export default function TagChips({ tags, onPress, glass, max }: Props) {
  const styles = useStyles(makeStyles);
  const shown = max === undefined ? tags : tags.slice(0, max);
  const hidden = tags.length - shown.length;
  return (
    <View style={styles.row}>
      {shown.map((tag) => (
        <Pressable
          key={tag.id}
          style={[styles.chip, glass ? styles.chipGlass : { backgroundColor: `${tag.color}1A` }]}
          onPress={onPress}
        >
          <Ionicons
            name={tag.icon as keyof typeof Ionicons.glyphMap}
            size={12}
            color={glass ? GLASS_TEXT : tag.color}
          />
          <Text style={[styles.chipLabel, glass ? styles.chipLabelGlass : { color: tag.color }]} numberOfLines={1}>
            {tag.path.split('/').pop()}
          </Text>
        </Pressable>
      ))}
      {hidden > 0 && (
        <Pressable style={[styles.chip, glass ? styles.chipGlass : styles.chipMore]} onPress={onPress}>
          <Text style={[styles.chipLabel, glass ? styles.chipLabelGlass : styles.chipMoreLabel]}>+{hidden}</Text>
        </Pressable>
      )}
      <Pressable style={[styles.addChip, glass && styles.addChipGlass]} onPress={onPress}>
        <Ionicons name="add" size={12} color={glass ? GLASS_TEXT_MUTED : styles.addChipLabel.color} />
        <Text style={[styles.addChipLabel, glass && styles.addChipLabelGlass]}>папка</Text>
      </Pressable>
    </View>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  chipMore: {
    backgroundColor: t.edge.hairline,
  },
  chipMoreLabel: {
    color: t.ink.muted,
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
  // The dark-glass look shared with every other floating capsule
  // (GlassLayer sheets, the dock) - offered for rows sitting on a
  // colourful card fill, where a per-tag pastel would clash. GLASS_*
  // rather than the app theme's own `glass` role, matching the sheets
  // this same look is drawn from - see constants/glass.ts.
  chipGlass: {
    backgroundColor: GLASS_ISLAND,
    borderWidth: 1,
    borderColor: GLASS_EDGE,
    borderRadius: 999,
  },
  chipLabelGlass: {
    color: GLASS_TEXT,
  },
  addChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: t.edge.strong,
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  addChipGlass: {
    borderColor: GLASS_EDGE,
    borderRadius: 999,
  },
  addChipLabelGlass: {
    color: GLASS_TEXT_MUTED,
  },
  addChipLabel: {
    fontSize: 11,
    fontFamily: FONT_REGULAR,
    color: t.ink.faint,
  },
});
