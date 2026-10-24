import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from '../utils/fonts';
import type { Group } from '../types';
import { NO_PROJECT } from './ProjectsBand';

// THE PROJECTS, SIMPLY (2026-10-25, the user: «режим проєктів замінюємо на більш простий з капсулами і їх прокруткою та
// натисканням вгорі»): one row of capsules under the top bar that scrolls sideways - «Без проєкту» first, then every
// project with its colour; a tap puts that project in front, a hold opens its settings. It replaces the accordion band
// (components/ProjectsBand, archived behind FEATURES.projectsAccordion: it worked well, it was not needed).
export default function ProjectCapsules({
  groups,
  focusId,
  onFocus,
  onHold,
}: {
  groups: Group[];
  focusId: string;
  onFocus: (id: string) => void;
  onHold?: (projectId: string) => void;
}) {
  const S = useSoft();
  const stops = [{ id: NO_PROJECT, name: 'Без проєкту', color: null as string | null }, ...groups.map((g) => ({ id: g.id, name: g.name, color: g.color ?? null }))];
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
      {stops.map((p) => {
        const on = p.id === focusId;
        return (
          <Pressable
            key={p.id || 'none'}
            onPress={() => onFocus(p.id)}
            onLongPress={p.id !== NO_PROJECT && onHold ? () => onHold(p.id) : undefined}
            accessibilityLabel={p.name}
            style={[styles.capsule, { backgroundColor: on ? S.ink : S.card, boxShadow: on ? undefined : S.shadow } as never]}
          >
            {!!p.color && <View style={[styles.dot, { backgroundColor: p.color }]} />}
            <Text numberOfLines={1} style={[styles.name, { color: on ? S.card : S.ink, fontFamily: on ? SOFT_SEMIBOLD : SOFT_MEDIUM }]}>
              {p.name}
            </Text>
          </Pressable>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: { paddingHorizontal: 16, gap: 8, paddingVertical: 4 },
  capsule: { height: 38, borderRadius: 19, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot: { width: 9, height: 9, borderRadius: 5 },
  name: { fontSize: 14.5, maxWidth: 200 },
});
