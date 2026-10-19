import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import { CONTROL, RADIUS, TYPE, useDeskColors } from '../../theme/desktopTheme';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../../utils/fonts';
import { useStyles } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme/tokens';
import { useExplorerPath, explorerPlace } from '../../navigation/explorerPlace';
import { UNFILED } from '../../screens/ExplorerScreen';
import { calendarPlace, useCalendarDay } from '../../navigation/calendarPlace';

// THE ONE PLACE TO CREATE on the Mac (frame B, 2026-10-19, after Claude's own composer): a field floating at the
// foot of the main column. It does not make things itself - a click opens the explorer's own quick-create window in
// the folder the explorer stands in (so one window makes everything, as on the phone). Under the field: the kinds
// it can make, and where the thing lands. Shown only where creating makes sense - the explorer; a note is written in
// itself, a base makes its records its own way (for now).
const KINDS: { key: string; label: string }[] = [
  { key: 'document', label: 'Нотатка' },
  { key: 'task', label: 'Справа' },
  { key: 'day', label: 'У щоденник' },
  { key: 'board', label: 'Дошка' },
  { key: 'card', label: 'Картка' },
  { key: 'link', label: 'Посилання' },
];

// In the calendar the same field adds to the day that stands there (the sketch's «Додати до цього дня…»).
const DAY_KINDS: { key: string; label: string }[] = [
  { key: 'task', label: 'Справа' },
  { key: 'day', label: 'У щоденник' },
];

export const COMPOSER_CLEAR = 96;

export default function Composer({ mode = 'explorer' }: { mode?: 'explorer' | 'calendar' }) {
  const styles = useStyles(makeStyles);
  const D = useDeskColors();
  const path = useExplorerPath();
  const day = useCalendarDay();
  const calendar = mode === 'calendar';
  const where = calendar ? day : !path ? 'Нерозкладене' : path === UNFILED ? 'Нерозкладене' : path.split('/').pop() ?? path;
  const open = () => (calendar ? calendarPlace.requestCreate() : explorerPlace.requestCreate());
  const kinds = calendar ? DAY_KINDS : KINDS;
  return (
    <View pointerEvents="box-none" style={styles.host}>
      <View style={[styles.box, { backgroundColor: D.card, borderColor: D.line, boxShadow: D.soft.shadow }]}>
        <Pressable style={styles.row} onPress={open}>
          <Ionicons name="add" size={18} color={D.ink2} />
          <Text style={[styles.placeholder, { color: D.ink3 }]}>{calendar ? 'Додати до цього дня…' : 'Запиши думку, нотатку чи справу…'}</Text>
          <Ionicons name="mic-outline" size={17} color={D.ink3} />
        </Pressable>
        <View style={styles.under}>
          {kinds.map((k, i) => (
            <Pressable key={k.key} onPress={open} style={[styles.chip, { backgroundColor: i === 0 ? D.ink : D.fill }]}>
              <Text style={[styles.chipText, { color: i === 0 ? D.card : D.ink2 }]}>{k.label}</Text>
            </Pressable>
          ))}
          <Text style={[styles.where, { color: D.ink3 }]}>{calendar ? `${where} ⌄` : `у «${where}» ⌄`}</Text>
        </View>
      </View>
    </View>
  );
}

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    host: { position: 'absolute', left: 0, right: 0, bottom: 18, alignItems: 'center', zIndex: 20 },
    box: {
      width: '100%',
      maxWidth: 760,
      marginHorizontal: 30,
      borderRadius: RADIUS.panel,
      borderWidth: StyleSheet.hairlineWidth,
      paddingHorizontal: 14,
      paddingTop: 10,
      paddingBottom: 9,
      gap: 9,
    },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10, height: CONTROL.button },
    placeholder: { flex: 1, fontSize: TYPE.md, fontFamily: FONT_REGULAR },
    under: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
    chip: { borderRadius: 999, paddingHorizontal: 10, height: 24, justifyContent: 'center' },
    chipText: { fontSize: TYPE.xs, fontFamily: FONT_SEMIBOLD },
    where: { marginLeft: 'auto' as never, fontSize: TYPE.xs, fontFamily: FONT_REGULAR },
  });
