import { Pressable, StyleSheet, Text, View } from 'react-native';
import { GLASS_EDGE, GLASS_ISLAND, GLASS_TEXT } from '../constants/glass';
import { FONT_MEDIUM, SOFT_MEDIUM } from '../utils/fonts';
import type { SoftTokens } from '../theme/soft';

type Props = {
  // null/undefined both read as "no project" - a gray chip, same as a
  // tag row's own dashed "+" reads as "nothing chosen yet".
  project: { name: string; color: string } | null | undefined;
  // Left out where the badge only REPORTS. On a card it is how a project
  // is set, but in the note's own corner it is an indicator and nothing
  // else - the dock's «Проект» is where that note's project is chosen,
  // and a second way in, sat in the corner, would be a button people
  // press expecting the same sheet.
  onPress?: () => void;
  // Same reasoning as TagChips' own `glass` prop - a flat tint-of-the-
  // project's-own-color chip would clash on a colourful card fill
  // (Links), so those opt into the frosted-glass look instead.
  glass?: boolean;
  // The soft style (theme/soft): not a chip at all but a quiet word on
  // the date's own line - a dot of the project's colour and its name, as
  // tall as the date and no taller. The chip was the one thing on the
  // card with a height of its own, and on a row whose text fills it that
  // pinned it to the card's bottom edge: "капсула прибита донизу... а
  // вище її не поставиш бо там вже зміст документа".
  soft?: SoftTokens | null;
  // The line's own text size, so the word matches the date beside it.
  softSize?: number;
};

const UNSET_COLOR = '#9CA3AF';

// One project (or none) shown on EVERY card - never conditionally
// hidden the way a tag chip is, since "which project" should read at a
// glance even on a mixed "Всі" list. Same small-pill family as
// TagChips, sat at the card's own date row, in its right corner.
export default function ProjectBadge({ project, onPress, glass, soft, softSize = 12 }: Props) {
  const chipStyle = soft
    ? [styles.softChip]
    : [
        styles.chip,
        glass ? styles.chipGlass : { backgroundColor: project ? `${project.color}1A` : 'rgba(156,163,175,0.14)' },
      ];
  const label = soft ? (
    <>
      {project && <View style={[styles.softDot, { backgroundColor: project.color }]} />}
      <Text style={[styles.softLabel, { fontSize: softSize, color: project ? soft.ink2 : soft.ink3 }]} numberOfLines={1}>
        {project?.name ?? 'Без проекту'}
      </Text>
    </>
  ) : (
    <Text
      style={[styles.chipLabel, glass ? styles.chipLabelGlass : { color: project ? project.color : UNSET_COLOR }]}
      numberOfLines={1}
    >
      {project?.name ?? 'Без проекту'}
    </Text>
  );
  // A plain View where there is nothing to press, rather than a Pressable
  // that swallows the touch and answers with nothing.
  if (!onPress) {
    return (
      <View style={chipStyle} pointerEvents="none">
        {label}
      </View>
    );
  }
  return (
    <Pressable style={chipStyle} onPress={onPress}>
      {label}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  chip: {
    maxWidth: 130,
    borderRadius: 8,
    paddingVertical: 3,
    paddingHorizontal: 8,
  },
  chipLabel: {
    fontSize: 11,
    fontWeight: '500',
    fontFamily: FONT_MEDIUM,
  },
  chipGlass: {
    backgroundColor: GLASS_ISLAND,
    borderWidth: 1,
    borderColor: GLASS_EDGE,
    borderRadius: 999,
  },
  chipLabelGlass: {
    color: GLASS_TEXT,
  },
  softChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    maxWidth: 160,
    flexShrink: 1,
  },
  softDot: {
    width: 7,
    height: 7,
    borderRadius: 3.5,
  },
  softLabel: {
    fontFamily: SOFT_MEDIUM,
    flexShrink: 1,
  },
});
