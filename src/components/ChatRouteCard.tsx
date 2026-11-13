import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';

// «СХОЖЕ НА ТВОЮ РОЗМОВУ» (sketch chatq, 2026-10-24): after the first message of a new conversation, when the AI finds it continues
// an existing one, the answer waits for the person's choice - continue there, or keep it here. Quiet, never a dialog.
export default function ChatRouteCard({
  title,
  onContinue,
  onStay,
  style,
}: {
  title: string;
  onContinue: () => void;
  onStay: () => void;
  style?: object;
}) {
  const S = useSoft();
  return (
    <View style={[styles.card, { backgroundColor: S.card, boxShadow: S.shadow } as never, style]}>
      <View style={styles.head}>
        <View style={[styles.icon, { backgroundColor: S.dark ? '#534034' : '#F9EAE0' }]}>
          <Ionicons name="chatbubble-outline" size={20} color={S.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={[styles.small, { color: S.ink2 }]}>Схоже на твою розмову</Text>
          <Text style={[styles.title, { color: S.ink }]} numberOfLines={1}>
            {title}
          </Text>
        </View>
      </View>
      <View style={styles.row}>
        <Pressable onPress={onContinue} style={[styles.main, { backgroundColor: S.ink }]} accessibilityLabel="Продовжити в тій розмові">
          <Text style={[styles.mainText, { color: S.card }]}>Продовжити там</Text>
        </Pressable>
        <Pressable onPress={onStay} style={[styles.side, { borderColor: S.line }]} accessibilityLabel="Лишити тут">
          <Text style={[styles.sideText, { color: S.ink }]}>Лишити тут</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 22, padding: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  icon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  small: { fontSize: 14, fontFamily: SOFT_REGULAR },
  title: { fontSize: 15.5, fontFamily: SOFT_SEMIBOLD },
  row: { flexDirection: 'row', gap: 8 },
  main: { height: 40, borderRadius: 20, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  mainText: { fontSize: 15, fontFamily: SOFT_MEDIUM },
  side: { height: 40, borderRadius: 20, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderWidth: 1 },
  sideText: { fontSize: 15, fontFamily: SOFT_MEDIUM },
});
