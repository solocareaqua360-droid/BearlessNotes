import { StyleSheet, View } from 'react-native';
import HintPicture, { type HintKind } from './HintPicture';
import PictureTile from './PictureTile';

export const STARTERS: { kind: HintKind; title: string; sub: string }[] = [
  { kind: 'board', title: 'Розкласти тему', sub: 'дошкою з карток' },
  { kind: 'research', title: 'Дослідити', sub: 'з джерелами' },
  { kind: 'sum', title: 'Підсумувати', sub: 'вкладене чи розмову' },
  { kind: 'adapt', title: 'Адаптувати думку', sub: 'під читача' },
];

// THE EMPTY CONVERSATION'S FOUR WAYS IN (sketch fin1): pictures of what each does, two by two.
export default function ChatStarterTiles({ onPick }: { onPick: (kind: HintKind) => void }) {
  const tile = (i: number) => (
    <PictureTile key={STARTERS[i].kind} picture={<HintPicture kind={STARTERS[i].kind} width={120} height={60} />} title={STARTERS[i].title} sub={STARTERS[i].sub} onPress={() => onPick(STARTERS[i].kind)} />
  );
  return (
    <View style={styles.grid}>
      <View style={styles.row}>
        {tile(0)}
        {tile(1)}
      </View>
      <View style={styles.row}>
        {tile(2)}
        {tile(3)}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  grid: { gap: 10 },
  row: { flexDirection: 'row', gap: 10 },
});
