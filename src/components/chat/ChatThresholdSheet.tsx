import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import ChatSheetFrame from '../ChatSheetFrame';
import { useSoft } from '../../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../../utils/fonts';
import { chatColours } from './chatTokens';
import { usd } from './money';

export const THRESHOLDS: (number | null)[] = [0.01, 0.05, 0.1, 0.5, null];

// THE PRICE THRESHOLD (sketch fin9), one for every conversation: a request dearer than it is asked about before it goes.
// `null` = never ask.
export default function ChatThresholdSheet({
  visible,
  value,
  onPick,
  onClose,
}: {
  visible: boolean;
  value: number | null;
  onPick: (v: number | null) => void;
  onClose: () => void;
}) {
  const S = useSoft();
  const C = chatColours(S);
  return (
    <ChatSheetFrame visible={visible} onClose={onClose} top={300}>
      <View style={{ paddingHorizontal: 4 }}>
        <Text style={[styles.title, { color: S.ink }]}>Налаштування розмов</Text>
        <Text style={[styles.sub, { color: S.ink2 }]}>Спільні для всіх розмов</Text>
      </View>
      <View style={[styles.card, { backgroundColor: S.card, boxShadow: S.shadow } as never]}>
        <Text style={[styles.cardTitle, { color: S.ink }]}>Питати перед відправкою, якщо запит дорожчий за</Text>
        <View style={styles.chips}>
          {THRESHOLDS.map((v) => {
            const on = v === value;
            return (
              <Pressable
                key={String(v)}
                onPress={() => onPick(v)}
                style={[styles.chip, on ? { backgroundColor: C.darkBtn } : ({ backgroundColor: S.card, boxShadow: S.shadow } as never)]}
              >
                {on && <Ionicons name="checkmark" size={15} color={C.darkBtnInk} />}
                <Text style={[styles.chipText, { color: on ? C.darkBtnInk : S.ink }]}>{v === null ? 'Не питати' : usd(v)}</Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={[styles.note, { color: S.ink2 }]}>Рахується до відправки, разом із вкладеним. Звичайна відповідь коштує менше за $0,01.</Text>
      </View>
    </ChatSheetFrame>
  );
}

const styles = StyleSheet.create({
  title: { fontSize: 20, fontFamily: SOFT_SEMIBOLD },
  sub: { fontSize: 12.5, fontFamily: SOFT_REGULAR, marginTop: 2 },
  card: { borderRadius: 22, padding: 14, paddingBottom: 16, gap: 12 },
  cardTitle: { fontSize: 14.5, fontFamily: SOFT_SEMIBOLD },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 40, borderRadius: 20, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 6 },
  chipText: { fontSize: 15, fontFamily: SOFT_MEDIUM },
  note: { fontSize: 12.5, lineHeight: 18, fontFamily: SOFT_REGULAR },
});
