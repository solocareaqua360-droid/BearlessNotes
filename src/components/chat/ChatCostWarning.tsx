import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import { useSoft } from '../../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../../utils/fonts';
import { chatColours } from './chatTokens';
import { tokensText, usd } from './money';

export type CostRow = { kind: 'photo' | 'file' | 'note' | 'folder' | 'text'; label: string; tokens: number };

const ICON: Record<CostRow['kind'], 'images-outline' | 'document-outline' | 'document-text-outline' | 'folder-outline' | 'chatbubble-outline'> = {
  photo: 'images-outline',
  file: 'document-outline',
  note: 'document-text-outline',
  folder: 'folder-outline',
  text: 'chatbubble-outline',
};

// «БАГАТО ТЕКСТУ» (sketch fin7): a request dearer than the threshold is asked about before it goes - what it costs, what weighs
// the most, and the two ways on.
export default function ChatCostWarning({
  visible,
  cost,
  threshold,
  rows,
  onCancel,
  onSend,
}: {
  visible: boolean;
  cost: number;
  threshold: number;
  rows: CostRow[];
  onCancel: () => void;
  onSend: () => void;
}) {
  const S = useSoft();
  const C = chatColours(S);
  if (!visible) return null;
  const heaviest = [...rows].sort((a, b) => b.tokens - a.tokens)[0];
  const weighs = heaviest ? (heaviest.kind === 'folder' ? 'папка' : heaviest.kind === 'photo' ? 'фото' : heaviest.kind === 'note' ? 'нотатка' : heaviest.kind === 'file' ? 'файл' : 'текст') : '';
  return (
    <View style={StyleSheet.absoluteFill} pointerEvents="box-none">
      <Pressable style={[StyleSheet.absoluteFill, { backgroundColor: S.dark ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.25)' }]} onPress={onCancel} accessibilityLabel="Скасувати" />
      <View style={[styles.card, { backgroundColor: S.card, borderColor: S.line, boxShadow: S.popShadow } as never]}>
        <View style={styles.head}>
          <View style={[styles.badge, { backgroundColor: C.wash }]}>
            <Ionicons name="warning-outline" size={20} color={S.accent} />
          </View>
          <Text style={[styles.title, { color: S.ink }]}>Багато тексту</Text>
        </View>
        <Text style={[styles.body, { color: S.ink }]}>
          {'Цей запит ≈ '}
          <Text style={styles.bold}>{usd(cost)}</Text>
          {'. Це більше за твій поріг '}
          <Text style={styles.bold}>{usd(threshold)}</Text>
          {weighs ? `. Найбільше важить ${weighs}.` : '.'}
        </Text>
        <View>
          {rows.map((r, i) => (
            <View key={`${r.label}${i}`} style={[styles.row, { borderTopColor: S.line }]}>
              <View style={[styles.rowIcon, { backgroundColor: C.wash }]}>
                <Ionicons name={ICON[r.kind]} size={15} color={S.accent} />
              </View>
              <Text numberOfLines={1} style={[styles.rowLabel, { color: S.ink }]}>
                {r.label}
              </Text>
              <Text style={[styles.rowTokens, { color: S.ink2 }]}>{tokensText(r.tokens)}</Text>
            </View>
          ))}
        </View>
        <View style={styles.buttons}>
          <Pressable onPress={onCancel} style={[styles.side, { borderColor: S.line }]}>
            <Text style={[styles.sideText, { color: S.ink }]}>Скасувати</Text>
          </Pressable>
          <Pressable onPress={onSend} style={[styles.main, { backgroundColor: C.darkBtn }]}>
            <Text style={[styles.mainText, { color: C.darkBtnInk }]}>{`Надіслати за ${usd(cost)}`}</Text>
          </Pressable>
        </View>
        <Text style={[styles.foot, { color: S.ink2 }]}>Поріг змінюється в меню розмови</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', left: 22, right: 22, top: 150, borderRadius: 26, borderWidth: StyleSheet.hairlineWidth, padding: 18, paddingBottom: 14, gap: 10 },
  head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  badge: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 18, fontFamily: SOFT_SEMIBOLD },
  body: { fontSize: 14.5, lineHeight: 21, fontFamily: SOFT_REGULAR },
  bold: { fontFamily: SOFT_SEMIBOLD },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 7, borderTopWidth: StyleSheet.hairlineWidth },
  rowIcon: { width: 28, height: 28, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  rowLabel: { flex: 1, fontSize: 13.5, fontFamily: SOFT_MEDIUM },
  rowTokens: { fontSize: 12.5, fontFamily: SOFT_MEDIUM },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 4 },
  side: { flex: 1, height: 44, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  sideText: { fontSize: 14.5, fontFamily: SOFT_SEMIBOLD },
  main: { flex: 1.4, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  mainText: { fontSize: 14.5, fontFamily: SOFT_SEMIBOLD },
  foot: { textAlign: 'center', fontSize: 12.5, fontFamily: SOFT_MEDIUM },
});
