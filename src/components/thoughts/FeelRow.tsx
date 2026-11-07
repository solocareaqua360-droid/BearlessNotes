import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSoft } from '../../theme/soft';
import { SOFT_BOLD, SOFT_MEDIUM } from '../../utils/fonts';
import { hapticSnapTick } from '../../utils/haptics';
import { FEELINGS, FEELING_IDS, feelingColor, type Feeling } from './feelings';

// «Яке почуття?» - five round drops, one tap picks, a tap on the picked one takes it back (none is a fine answer).
export default function FeelRow({ value, onChange }: { value: Feeling | null; onChange: (f: Feeling | null) => void }) {
  const S = useSoft();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[styles.label, { color: S.ink3 }]}>Яке почуття?</Text>
      <View style={styles.row}>
        {FEELING_IDS.map((f) => {
          const on = value === f;
          return (
            <Pressable
              key={f}
              onPress={() => {
                hapticSnapTick();
                onChange(on ? null : f);
              }}
              accessibilityLabel={FEELINGS[f].name}
              accessibilityState={{ selected: on }}
              hitSlop={4}
              style={[styles.drop, { backgroundColor: feelingColor(f, on ? 1 : 0.32), borderColor: on ? S.ink : 'transparent' }]}
            />
          );
        })}
        <Text style={[styles.name, { color: value ? S.ink : S.ink3 }]} numberOfLines={1}>
          {value ? FEELINGS[value].name : ''}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { fontSize: 11.5, fontFamily: SOFT_BOLD, letterSpacing: 0.5, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  drop: { width: 30, height: 30, borderRadius: 15, borderWidth: 2 },
  name: { flex: 1, fontSize: 15, fontFamily: SOFT_MEDIUM },
});
