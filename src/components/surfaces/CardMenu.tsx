import { useLayoutEffect, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import { useTheme } from '../../theme/ThemeProvider';
import { useSoft } from '../../theme/soft';
import { useDensity } from '../../hooks/useDensity';
import { SHEET_BACKDROP, SHEET_WINDOW, PHONE_ONLY } from '../../constants/glass';
import { FONT_REGULAR, SOFT_MEDIUM } from '../../utils/fonts';
import { takeRecentClickPoint, takeRecentContextPoint, type ContextPoint } from '../../utils/contextPoint';

// THE MENU OF A CARD ("...", a hold, a right click). One thing, two shapes:
// on a phone the white sheet with its grab bar that a card's menu has
// always been; at a pointer a small menu beside the click that opened it,
// as a right click's own menu stands - rows 30 tall, Esc or a click away
// closes it. The screens only say WHAT the rows are.
export type CardMenuRow = {
  icon: string;
  label: string;
  onPress: () => void;
  danger?: boolean;
};

const MENU_W = 244;

export default function CardMenu({
  visible,
  onClose,
  rows,
}: {
  visible: boolean;
  onClose: () => void;
  rows: CardMenuRow[];
}) {
  const theme = useTheme();
  const S = useSoft();
  const pointer = useDensity() === 'pointer';
  const { width, height } = useWindowDimensions();
  // Where the click that opened it was - read the moment it opens, while
  // it is still "just now" (see contextPoint).
  const [anchor, setAnchor] = useState<ContextPoint | null>(null);
  useLayoutEffect(() => {
    if (visible && pointer) setAnchor(takeRecentContextPoint() ?? takeRecentClickPoint());
  }, [visible, pointer]);

  if (pointer) {
    const estimate = rows.length * 30 + 12;
    const left = anchor ? Math.max(8, Math.min(anchor.x, width - MENU_W - 8)) : Math.max(8, (width - MENU_W) / 2);
    const top = anchor ? Math.max(8, Math.min(anchor.y, height - estimate - 8)) : Math.max(8, (height - estimate) / 2);
    const danger = S.dark ? '#FF7A6E' : '#C8452F';
    return (
      <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
        <Pressable
          style={[styles.scrim, !anchor && { backgroundColor: 'rgba(0,0,0,0.12)' }]}
          onPress={onClose}
          {...({ onContextMenu: (e: { preventDefault: () => void }) => e.preventDefault() } as object)}
        >
          <View
            style={[
              styles.popover,
              { left, top, width: MENU_W, backgroundColor: S.card, borderColor: S.line, boxShadow: S.popShadow },
            ]}
          >
            {rows.map((row) => (
              <Pressable
                key={row.label}
                onPress={row.onPress}
                style={(state) => [styles.popRow, (state as { hovered?: boolean }).hovered && { backgroundColor: S.fill }]}
              >
                <Ionicons name={row.icon as never} size={15} color={row.danger ? danger : S.ink2} />
                <Text style={[styles.popLabel, { color: row.danger ? danger : S.ink }]} numberOfLines={1}>
                  {row.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </Pressable>
      </Modal>
    );
  }

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={[SHEET_BACKDROP, { backgroundColor: theme.scrim }]} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.handle} />
          {rows.map((row) => (
            <Pressable key={row.label} style={styles.row} onPress={row.onPress}>
              <Ionicons name={row.icon as never} size={18} color={row.danger ? '#EF4444' : '#111827'} />
              <Text style={[styles.rowLabel, row.danger && { color: '#EF4444' }]}>{row.label}</Text>
            </Pressable>
          ))}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: { flex: 1 },
  popover: { position: 'absolute', borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: 5 },
  popRow: { flexDirection: 'row', alignItems: 'center', gap: 9, height: 30, paddingHorizontal: 10, borderRadius: 8 },
  popLabel: { flex: 1, fontSize: 13.5, fontFamily: SOFT_MEDIUM },
  sheet: {
    backgroundColor: '#fff',
    ...SHEET_WINDOW,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 28,
  },
  handle: {
    ...PHONE_ONLY,
    width: 36,
    height: 4,
    backgroundColor: '#E5E7EB',
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 12,
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
  rowLabel: { fontSize: 15, fontFamily: FONT_REGULAR, color: '#111827' },
});
