import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import { RADIUS, TYPE, useDeskColors } from '../../theme/desktopTheme';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../../utils/fonts';
import { useStyles } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme/tokens';
import type { MenuEntry } from '../surfaces/Menu';

// A SCREEN'S «⋯» AS A LIST IN THE PANEL (the Mac's frame B, 2026-10-20): the same MenuEntry rows the menu draws
// (sections, rules, ticks, counts, a red «Видалити»), drawn in the right panel's own dress - the panel shows what the
// menu used to hide. One renderer for every screen that already publishes its entries.
export default function EntryList({ entries }: { entries: MenuEntry[] }) {
  const styles = useStyles(makeStyles);
  const D = useDeskColors();
  return (
    <View style={styles.host}>
      {entries.map((e, i) => {
        if (e.kind === 'rule') return <View key={`r${i}`} style={[styles.rule, { backgroundColor: D.line }]} />;
        if (e.kind === 'section') {
          return (
            <Text key={`s${i}`} style={[styles.section, { color: D.ink3 }]}>
              {e.label}
            </Text>
          );
        }
        const danger = e.tone === 'danger';
        const ink = danger ? '#B4452F' : D.ink;
        return (
          <Pressable
            key={`${e.label}${i}`}
            onPress={e.onPress}
            style={(state) => [styles.row, (state as { hovered?: boolean }).hovered && { backgroundColor: D.fill }]}
          >
            {!!e.icon && <Ionicons name={e.icon} size={15} color={danger ? ink : D.ink2} />}
            <Text style={[styles.label, { color: ink }]} numberOfLines={1}>
              {e.label}
            </Text>
            {typeof e.count === 'number' && <Text style={[styles.count, { color: D.ink3 }]}>{e.count}</Text>}
            {e.checked && <Ionicons name="checkmark" size={15} color={D.ink} />}
          </Pressable>
        );
      })}
    </View>
  );
}

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    host: { paddingHorizontal: 6 },
    rule: { height: StyleSheet.hairlineWidth, marginVertical: 6, marginHorizontal: 8 },
    section: { fontSize: TYPE.xs, fontFamily: FONT_SEMIBOLD, textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 8, paddingTop: 10, paddingBottom: 2 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, height: 32, paddingHorizontal: 8, borderRadius: RADIUS.control },
    label: { flex: 1, fontSize: TYPE.sm, fontFamily: FONT_REGULAR },
    count: { fontSize: TYPE.xs, fontFamily: FONT_SEMIBOLD },
  });
