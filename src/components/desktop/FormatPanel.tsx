import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import type { BlockAlign } from '../../utils/documentBlocks';
import { Ionicons } from '../icons/Ionicons';
import { RADIUS, TYPE, useDeskColors } from '../../theme/desktopTheme';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../../utils/fonts';
import { useStyles } from '../../theme/ThemeProvider';
import type { Theme } from '../../theme/tokens';
import { HIGHLIGHT_COLORS, TEXT_COLORS } from '../EditorToolbar';

// «ФОРМАТ» - THE NOTE'S RIGHT PANEL SHOWING WHAT STANDS UNDER THE CARET (the Mac's frame B, 2026-10-20, after Craft's
// Format tab): what kind of block this is (the one in force is lit), the four text styles, the colours. A menu cannot show
// «що зараз увімкнено»; this does. Nothing here takes the field's focus (onMouseDown is cancelled): the selection the
// buttons act on must still be there when the click lands.
// The headings are the phone's three levels (the note's own title is the first heading, so the body's start at 2).
export type FormatBlockKind = 'paragraph' | 'h2' | 'h3' | 'h4' | 'bulleted' | 'numbered' | 'checkbox' | 'toggle' | 'code';

const KINDS: { id: FormatBlockKind; label: string }[] = [
  { id: 'paragraph', label: 'Текст' },
  { id: 'h2', label: 'Заголовок 2' },
  { id: 'h3', label: 'Заголовок 3' },
  { id: 'h4', label: 'Заголовок 4' },
  { id: 'bulleted', label: 'Список' },
  { id: 'numbered', label: '1. 2. 3.' },
  { id: 'checkbox', label: 'Чекбокс' },
  { id: 'toggle', label: 'Розділ' },
  { id: 'code', label: 'Код' },
];
const STYLES: { id: 'bold' | 'italic' | 'underline' | 'strike'; label: string; css: object }[] = [
  { id: 'bold', label: 'Ж', css: { fontFamily: FONT_SEMIBOLD, fontWeight: '700' } },
  { id: 'italic', label: 'К', css: { fontStyle: 'italic' } },
  { id: 'underline', label: 'П', css: { textDecorationLine: 'underline' } },
  { id: 'strike', label: 'З', css: { textDecorationLine: 'line-through' } },
];

// The mouse must not move focus off the text field.
const keepFocus = { onMouseDown: (e: { preventDefault: () => void }) => e.preventDefault() } as object;

const ALIGNS: { id: BlockAlign; label: string; icon: string }[] = [
  { id: 'left', label: 'Ліворуч', icon: 'format-align-left' },
  { id: 'center', label: 'По центру', icon: 'format-align-center' },
  { id: 'right', label: 'Праворуч', icon: 'format-align-right' },
  { id: 'justify', label: 'По ширині', icon: 'format-align-justify' },
];

export default function FormatPanel({
  kind,
  hasSelection,
  onKind,
  onStyle,
  onColor,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  align,
  onAlign,
  onIndent,
}: {
  kind: FormatBlockKind | null;
  hasSelection: boolean;
  onKind: (k: FormatBlockKind) => void;
  onStyle: (s: 'bold' | 'italic' | 'underline' | 'strike') => void;
  onColor: (which: 'c' | 'h', hex: string) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  // Where the lines stand, and a step in or out (Block.align / Block.indent) - for the block the caret is in.
  align?: BlockAlign | null;
  onAlign?: (a: BlockAlign) => void;
  onIndent?: (delta: 1 | -1) => void;
}) {
  const styles = useStyles(makeStyles);
  const D = useDeskColors();
  const head = (label: string) => <Text style={[styles.head, { color: D.ink3 }]}>{label}</Text>;
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={styles.content}>
      <View style={styles.styleRow}>
        <Pressable onPress={onUndo} {...keepFocus} style={[styles.styleBtn, { backgroundColor: D.card, borderColor: D.line, flexDirection: 'row', gap: 6 }, !canUndo && { opacity: 0.45 }]}>
          <Ionicons name="arrow-undo-outline" size={16} color={D.ink} />
          <Text style={[{ fontSize: TYPE.sm, color: D.ink }]}>Скасувати</Text>
        </Pressable>
        <Pressable onPress={onRedo} {...keepFocus} style={[styles.styleBtn, { backgroundColor: D.card, borderColor: D.line, flexDirection: 'row', gap: 6 }, !canRedo && { opacity: 0.45 }]}>
          <Ionicons name="arrow-redo-outline" size={16} color={D.ink} />
          <Text style={[{ fontSize: TYPE.sm, color: D.ink }]}>Повторити</Text>
        </Pressable>
      </View>
      {kind === null && <Text style={[styles.hint, { color: D.ink3 }]}>Постав каретку в текст — тут буде видно, що під нею.</Text>}
      {head('Блок')}
      <View style={styles.kinds}>
        {KINDS.map((k) => {
          const on = kind === k.id;
          return (
            <Pressable
              key={k.id}
              onPress={() => onKind(k.id)}
              {...keepFocus}
              style={[styles.kind, { backgroundColor: on ? D.ink : D.card, borderColor: on ? D.ink : D.line }]}
            >
              <Text style={[styles.kindText, { color: on ? D.card : D.ink }]}>{k.label}</Text>
            </Pressable>
          );
        })}
      </View>
      {onAlign && head('Розташування')}
      {onAlign && (
        <View style={[styles.styleRow, kind === null && { opacity: 0.45 }]}>
          {ALIGNS.map((a) => {
            const on = align === a.id;
            return (
              <Pressable key={a.id} onPress={() => onAlign(a.id)} {...keepFocus} accessibilityLabel={a.label} style={[styles.styleBtn, { backgroundColor: on ? D.ink : D.card, borderColor: on ? D.ink : D.line }]}>
                <MaterialCommunityIcons name={a.icon as never} size={18} color={on ? D.card : D.ink} />
              </Pressable>
            );
          })}
        </View>
      )}
      {onIndent && head('Відступ · Tab / ⇧Tab')}
      {onIndent && (
        <View style={[styles.styleRow, kind === null && { opacity: 0.45 }]}>
          <Pressable onPress={() => onIndent(-1)} {...keepFocus} accessibilityLabel="Відступ менше" style={[styles.styleBtn, { backgroundColor: D.card, borderColor: D.line, flexDirection: 'row', gap: 6 }]}>
            <MaterialCommunityIcons name="format-indent-decrease" size={18} color={D.ink} />
            <Text style={[{ fontSize: TYPE.sm, color: D.ink }]}>Менше</Text>
          </Pressable>
          <Pressable onPress={() => onIndent(1)} {...keepFocus} accessibilityLabel="Відступ більше" style={[styles.styleBtn, { backgroundColor: D.card, borderColor: D.line, flexDirection: 'row', gap: 6 }]}>
            <MaterialCommunityIcons name="format-indent-increase" size={18} color={D.ink} />
            <Text style={[{ fontSize: TYPE.sm, color: D.ink }]}>Більше</Text>
          </Pressable>
        </View>
      )}
      {head('Текст')}
      <View style={[styles.styleRow, !hasSelection && { opacity: 0.45 }]}>
        {STYLES.map((s) => (
          <Pressable key={s.id} onPress={() => hasSelection && onStyle(s.id)} {...keepFocus} style={[styles.styleBtn, { backgroundColor: D.card, borderColor: D.line }]}>
            <Text style={[{ fontSize: 15, color: D.ink }, s.css]}>{s.label}</Text>
          </Pressable>
        ))}
      </View>
      {!hasSelection && <Text style={[styles.hint, { color: D.ink3 }]}>Виділи слово — стилі й кольори запрацюють.</Text>}
      {head('Колір тексту')}
      <View style={[styles.swatches, !hasSelection && { opacity: 0.45 }]}>
        {TEXT_COLORS.map((hex) => (
          <Pressable key={hex} onPress={() => hasSelection && onColor('c', hex)} {...keepFocus} style={[styles.swatch, { backgroundColor: hex, borderColor: D.line }]} accessibilityLabel={hex} />
        ))}
      </View>
      {head('Виділення')}
      <View style={[styles.swatches, !hasSelection && { opacity: 0.45 }]}>
        {HIGHLIGHT_COLORS.map((hex) => (
          <Pressable key={hex} onPress={() => hasSelection && onColor('h', hex)} {...keepFocus} style={[styles.swatch, { backgroundColor: hex, borderColor: D.line }]} accessibilityLabel={hex} />
        ))}
      </View>
    </ScrollView>
  );
}

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    content: { paddingHorizontal: 14, paddingTop: 12, paddingBottom: 24, gap: 10 },
    head: { fontSize: TYPE.xs, fontFamily: FONT_SEMIBOLD, textTransform: 'uppercase', letterSpacing: 0.4, paddingHorizontal: 2, paddingTop: 6 },
    hint: { fontSize: TYPE.xs, fontFamily: FONT_REGULAR },
    kinds: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    kind: { height: 30, paddingHorizontal: 12, borderRadius: 999, borderWidth: StyleSheet.hairlineWidth, justifyContent: 'center' },
    kindText: { fontSize: TYPE.sm, fontFamily: FONT_REGULAR },
    styleRow: { flexDirection: 'row', gap: 6 },
    styleBtn: { flex: 1, height: 34, borderRadius: RADIUS.control, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
    swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    swatch: { width: 28, height: 28, borderRadius: 14, borderWidth: StyleSheet.hairlineWidth },
  });
