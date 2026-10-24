import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSoft } from '../../theme/soft';
import { SOFT_SEMIBOLD } from '../../utils/fonts';
import { chatColours } from './chatTokens';
import HintPicture, { type HintKind } from './HintPicture';

// One hint: its picture on a quiet ground, the word under it.
export default function HintTile({ kind, label, onPress, width = 100 }: { kind: HintKind; label: string; onPress: () => void; width?: number }) {
  const S = useSoft();
  const C = chatColours(S);
  return (
    <Pressable onPress={onPress} accessibilityLabel={label} style={[styles.tile, { width, backgroundColor: S.card, boxShadow: S.shadow } as never]}>
      <View style={[styles.ground, { backgroundColor: C.tileGround }]}>
        <HintPicture kind={kind} />
      </View>
      <Text numberOfLines={1} style={[styles.label, { color: S.ink }]}>
        {label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { borderRadius: 18, paddingTop: 8, paddingBottom: 9, paddingHorizontal: 4, alignItems: 'center', gap: 6 },
  ground: { width: 92, height: 58, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  label: { fontSize: 12.5, fontFamily: SOFT_SEMIBOLD },
});
