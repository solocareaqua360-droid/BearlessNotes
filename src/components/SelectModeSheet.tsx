import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { topBarFrame } from './TopNavBar';
import { useSoft } from '../theme/soft';
import { Ionicons } from './icons/Ionicons';
import BlockMiniature from './BlockMiniature';
import { useTheme } from '../theme/ThemeProvider';
import { FONT_MEDIUM, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

// THE TWO CARDS OVER THE SELECT-MODE DOCK (2026-10-23, the user's sketch V8yysG1eFMHLTRBXWYJA7T, «підходить»): the dock had
// sixteen buttons in a scrolling row; now it has six, and two of them open these. «Вигляд» - what the chosen blocks become,
// as pictures of the result (BlockMiniature), the three heading sizes each their own tile; no lines here (a line must not
// replace typed text - those live in «/» on an empty row). «Ще» - the rarer things to do with the chosen blocks.
export type LookKind = 'paragraph' | 'h1' | 'h2' | 'h3' | 'toggle' | 'bulleted' | 'numbered' | 'checkbox' | 'code';

const LOOKS: { kind: LookKind; label: string; mini: string }[] = [
  { kind: 'paragraph', label: 'Текст', mini: 'paragraph' },
  { kind: 'h1', label: 'Заголовок 1', mini: 'h2' },
  { kind: 'h2', label: 'Заголовок 2', mini: 'h3' },
  { kind: 'h3', label: 'Заголовок 3', mini: 'h4' },
  { kind: 'toggle', label: 'Випадаючий', mini: 'toggle' },
  { kind: 'bulleted', label: 'Список', mini: 'bulleted' },
  { kind: 'numbered', label: 'Нумерація', mini: 'numbered' },
  { kind: 'checkbox', label: 'Чекбокс', mini: 'checkbox' },
  { kind: 'code', label: 'Код', mini: 'code' },
];

export type MoreItem = { key: string; label: string; hint?: string; icon: string; onPress: () => void };

type Props = {
  open: 'look' | 'more' | null;
  count: number;
  // How far above the screen's bottom the cards stand (the dock's own clearance).
  bottom: number;
  onClose: () => void;
  onLook: (kind: LookKind) => void;
  more: MoreItem[];
};

// The dock's own strip (ContextDock's short soft strip): six buttons of at most 84, centred on the top bar's frame, a
// 56-tall capsule. The cards take its width, its material and its corner (the user: wider than the dock, and the same
// radius looked different on a different size) - so the card reads as grown out of the dock, not laid over it.
const DOCK_BUTTONS = 6;
const DOCK_BUTTON_W = 84;
const DOCK_H = 56;
const PAD = 10;

export default function SelectModeSheet({ open, count, bottom, onClose, onLook, more }: Props) {
  const theme = useTheme();
  const soft = useSoft();
  const { width: windowW } = useWindowDimensions();
  if (!open) return null;
  const frame = topBarFrame(windowW);
  const stripW = Math.min(DOCK_BUTTON_W, Math.floor(frame.width / DOCK_BUTTONS)) * DOCK_BUTTONS;
  const left = frame.left + (frame.width - stripW) / 2;
  // Concentric with the dock below it: the card's corner is the capsule's, the tiles' is that less the padding.
  const radius = DOCK_H / 2;
  const card = { backgroundColor: soft.chrome, boxShadow: soft.shadow, borderRadius: radius };
  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 40 }]} pointerEvents="box-none">
      <Pressable style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Закрити" />
      {open === 'look' ? (
        <View style={[styles.card, styles.look, card, { bottom, left, width: stripW }]}>
          <Text style={[styles.head, { color: soft.ink }]}>
            Вигляд · {count} {count === 1 ? 'блок' : count < 5 ? 'блоки' : 'блоків'}
          </Text>
          <View style={styles.grid}>
            {LOOKS.map((l) => (
              <Pressable
                key={l.kind}
                style={styles.tile}
                onPress={() => {
                  onLook(l.kind);
                  onClose();
                }}
              >
                <View style={[styles.tileFace, { borderColor: theme.edge.hairline, backgroundColor: soft.card, borderRadius: radius - PAD }]}>
                  <BlockMiniature kind={l.mini} width={62} />
                </View>
                <Text style={[styles.tileLabel, { color: theme.ink.primary }]} numberOfLines={1}>
                  {l.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : (
        <View style={[styles.card, styles.more, card, { bottom, left: left + stripW - 280 }]}>
          {more.map((m) => (
            <Pressable
              key={m.key}
              style={styles.row}
              onPress={() => {
                onClose();
                m.onPress();
              }}
            >
              <Ionicons name={m.icon as never} size={20} color={theme.ink.primary} />
              <View style={{ flex: 1 }}>
                <Text style={[styles.rowLabel, { color: theme.ink.primary }]}>{m.label}</Text>
                {!!m.hint && <Text style={[styles.rowHint, { color: theme.ink.muted }]}>{m.hint}</Text>}
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', overflow: 'hidden' },
  look: { paddingHorizontal: PAD, paddingTop: 14, paddingBottom: PAD, gap: 12 },
  more: { width: 280, padding: 6 },
  head: { fontFamily: FONT_SEMIBOLD, fontSize: 14, paddingLeft: 4 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 12 },
  tile: { width: '20%', alignItems: 'center', gap: 6, paddingHorizontal: 3 },
  tileFace: { alignSelf: 'stretch', height: 58, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontFamily: FONT_MEDIUM, fontSize: 10.5 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 11, paddingHorizontal: 12, borderRadius: DOCK_H / 2 - 6 },
  rowLabel: { fontFamily: FONT_MEDIUM, fontSize: 15 },
  rowHint: { fontFamily: FONT_REGULAR, fontSize: 12, marginTop: 2 },
});
