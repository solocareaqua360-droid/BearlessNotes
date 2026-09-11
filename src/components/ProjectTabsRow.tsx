import { RefObject } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { BlurView } from 'expo-blur';
import { GLASS_ISLAND } from '../constants/glass';

// Sentinel for "no group/project assigned" - an id string, since a real
// document's id (a Firestore auto-id) can never collide with it. `null`
// itself means "Всі" (no filter).
export const UNASSIGNED_ID = '__none__';

const MUTED = '#6B7280';

type Item = { id: string; name: string; color: string };

type Props = {
  items: Item[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  // Tasks' own projects and Files/Photos/Links' groups are two entirely
  // separate collections (the user was explicit: grouping in the database
  // screens is its own thing, not the same "project" tasks have) - this
  // component only draws the pill row, so it doesn't care which; the
  // caller supplies the right wording for its "unassigned" tab.
  unassignedLabel?: string;
  // Documents/Calendar/Databases sit on the dark gradient background
  // instead of these screens' plain white - the dark-glass treatment
  // already used for their own header capsules, applied here too so the
  // pills stay legible instead of nearly invisible gray-on-dark.
  dark?: boolean;
  // A real blur behind every pill, for the screens where the content
  // scrolls under this row. Only pass it where the row itself is drawn
  // OUTSIDE the blur target (Documents draws it through the portal) - a
  // blur inside the view it blurs takes the app down.
  blurTarget?: RefObject<View | null> | null;
};

// Horizontal row of pills (see the videobookmark reference the user showed:
// "Всі / Робота / Дім / Навчання") - a plain filter, not a toggle into
// grouped sections.
export default function ProjectTabsRow({
  items,
  selected,
  onSelect,
  unassignedLabel = 'Без проєкту',
  dark,
  blurTarget,
}: Props) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      // RN gives every ScrollView flexGrow: 1 by default - without pinning
      // it to 0 here, this row competes for height with the list/grid
      // ScrollView below it and can end up claiming half the screen, which
      // then stretches every pill tall to match (row's default cross-axis
      // alignItems is 'stretch'). Same bug, same fix, as the calendar's own
      // week strip.
      style={styles.scroll}
      contentContainerStyle={styles.row}
    >
      <Tab
        label="Всі"
        color={MUTED}
        active={selected === null}
        onPress={() => onSelect(null)}
        dark={dark}
        blurTarget={blurTarget}
      />
      {items.map((p) => (
        <Tab
          key={p.id}
          label={p.name}
          color={p.color}
          active={selected === p.id}
          onPress={() => onSelect(p.id)}
          dark={dark}
          blurTarget={blurTarget}
        />
      ))}
      <Tab
        label={unassignedLabel}
        color={MUTED}
        active={selected === UNASSIGNED_ID}
        onPress={() => onSelect(UNASSIGNED_ID)}
        dark={dark}
        blurTarget={blurTarget}
      />
    </ScrollView>
  );
}

function Tab({
  label,
  color,
  active,
  onPress,
  dark,
  blurTarget,
}: {
  label: string;
  color: string;
  active: boolean;
  onPress: () => void;
  dark?: boolean;
  blurTarget?: RefObject<View | null> | null;
}) {
  // On the dark gradient, an active tab inverts to a solid white pill with
  // dark text (matching CalendarScreen's own "Сьогодні" button) rather than
  // just swapping to a barely-brighter glass tint - the light-glass screens
  // keep their own subtler active treatment (the group's own color).
  return (
    <Pressable
      style={[styles.tab, dark && styles.tabDark, dark && active && styles.tabDarkActive]}
      onPress={onPress}
    >
      {/* No blur under the active pill - it is a solid white one, and
          there would be nothing to see through it. */}
      {dark && !active && !!blurTarget && (
        <BlurView
          intensity={60}
          tint="dark"
          blurMethod="dimezisBlurView"
          blurTarget={blurTarget}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      )}
      {active && <View style={[styles.dot, { backgroundColor: dark ? '#171310' : color }]} />}
      <Text
        style={[
          styles.tabLabel,
          dark
            ? { color: active ? '#171310' : 'rgba(255,255,255,0.75)' }
            : { color: active ? color : '#374151' },
        ]}
        numberOfLines={1}
      >
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  scroll: {
    flexGrow: 0,
    // Without this, a screen with more stacked siblings above the list
    // than this component was originally tried on (Documents: header +
    // this row + the tag-filter row, all before the list) can leave Yoga
    // short on space and shrink this ScrollView below its own content
    // height instead of shrinking the list below it - squishing every
    // pill and clipping their text. flexGrow: 0 alone only stops it from
    // stretching taller, not from being squeezed shorter.
    flexShrink: 0,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingBottom: 10,
  },
  // Frosted-glass capsule for every tab, active or not - a soft
  // translucent fill and border rather than a flat color-tint/gray one.
  // These screens have a plain white background (not the dark gradient
  // Documents/Calendar/Databases got), so this is the light-glass variant
  // of that same treatment: still translucent and bordered, just legible
  // against white instead of a dark backdrop.
  tab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 7,
    paddingHorizontal: 13,
    borderRadius: 999,
    backgroundColor: 'rgba(120,120,120,0.08)',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.08)',
  },
  // In the rail's glass, but NOT at the rail's width: the pills went up
  // with the capsule to 64 and that was too much for a row of them.
  tabDark: {
    height: 45,
    // Keeps each pill's blur inside its own rounded shape, so the edge
    // stays a clean line.
    overflow: 'hidden',
    paddingHorizontal: 16,
    backgroundColor: GLASS_ISLAND,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  tabDarkActive: {
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderColor: 'transparent',
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  tabLabel: {
    fontSize: 13,
    fontWeight: '600',
  },
});
