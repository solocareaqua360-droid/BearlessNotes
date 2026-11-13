import type { ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSoft } from '../../theme/soft';
import { SOFT_REGULAR, SOFT_SEMIBOLD } from '../../utils/fonts';
import { chatColours } from './chatTokens';

// A choice as a picture with its name and a line under it - the empty conversation's starters and the «+» sheet.
export default function PictureTile({ picture, title, sub, onPress }: { picture: ReactNode; title: string; sub: string; onPress: () => void }) {
  const S = useSoft();
  const C = chatColours(S);
  return (
    <Pressable onPress={onPress} accessibilityLabel={title} style={[styles.tile, { backgroundColor: S.card, boxShadow: S.shadow } as never]}>
      <View style={[styles.ground, { backgroundColor: C.tileGround }]}>{picture}</View>
      <View style={styles.words}>
        <Text numberOfLines={1} style={[styles.title, { color: S.ink }]}>
          {title}
        </Text>
        <Text numberOfLines={1} style={[styles.sub, { color: S.ink2 }]}>
          {sub}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  tile: { flex: 1, minWidth: 0, borderRadius: 20, padding: 10, gap: 8 },
  ground: { height: 64, borderRadius: 14, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  words: { gap: 2, paddingHorizontal: 2 },
  title: { fontSize: 14, fontFamily: SOFT_SEMIBOLD },
  sub: { fontSize: 11.5, fontFamily: SOFT_REGULAR },
});
