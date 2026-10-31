import { useEffect, useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Animated, { LinearTransition } from 'react-native-reanimated';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { topBarFrame } from './TopNavBar';
import { useSoft } from '../theme/soft';
import { Ionicons } from './icons/Ionicons';
import BlockMiniature from './BlockMiniature';
import { useTheme } from '../theme/ThemeProvider';
import { FONT_MEDIUM, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

// THE SHEETS OVER THE SELECT-MODE DOCK (2026-10-31, the user's grouping, sketched and agreed): the dock is Вийти · Дії · Формат ·
// Вигляд · ШІ · Видалити, and three of them open a sheet here.
//   «Дії»          - what to do with the chosen blocks (copy, cut, into a note, cards, a link to the block, choose all).
//   «Форматування» - the text blocks among the chosen: a sheet of GROUPS (Текст, Заголовок ›, Список ›, Код, Відступ ›,
//                    Розташування ›, Оформлення ›, Шрифт ›); a group with › is FALLEN INTO - the sheet's content becomes its
//                    choices with «‹ group» at the top, it does not grow a row (the user: «провалюється всередину»). The sheet
//                    takes the height of what it shows, and changes it smoothly (LinearTransition).
//   «Вигляд»       - the cards among the chosen (a note as a word in the line or as a card).
// The sheet is the dock's width, its corner a step rounder than the dock's own (the user: «радіуси різні, але вигляд схожий»).
export type LookKind = 'paragraph' | 'h1' | 'h2' | 'h3' | 'toggle' | 'bulleted' | 'numbered' | 'checkbox' | 'code';
export type SelectSheet = 'actions' | 'format' | 'look';
export type MoreItem = { key: string; label: string; icon: string; onPress: () => void; keepOpen?: boolean };
// A look that is not a block type: a note shown as a word in the line or as a card. `active` = how it stands now.
export type ExtraLook = { key: string; label: string; mini: string; active?: boolean; onPress: () => void };
export type FormatApi = {
  // How the chosen text blocks stand now, for the tiles that say so (null where they differ).
  kind: LookKind | null;
  align: 'left' | 'center' | 'right' | 'justify' | null;
  font: string | null;
  // The block fonts, when the note is set to a font per block (else the group is not shown).
  fonts: { id: string; label: string; family?: string }[] | null;
  colors: string[];
  onLook: (kind: LookKind) => void;
  onIndent: (delta: 1 | -1) => void;
  onAlign: (align: 'left' | 'center' | 'right' | 'justify') => void;
  onMark: (mark: '**' | '*' | '~~') => void;
  onColor: (hex: string | null) => void;
  onFont: (id: string) => void;
};

type Props = {
  open: SelectSheet | null;
  count: number;
  // How many text blocks / cards are among the chosen (the heads say so).
  textCount: number;
  cardCount: number;
  bottom: number;
  // The dock's buttons, for the sheet's width.
  buttons: number;
  onClose: () => void;
  actions: MoreItem[];
  format: FormatApi;
  extraLooks?: ExtraLook[];
};

const DOCK_BUTTON_W = 84;
const PAD = 10;
// The dock's corner is 16 (ContextDock, squareStrip); the sheet's a step rounder.
const RADIUS = 22;
const TILE_R = 12;

const blocksWord = (n: number) => (n === 1 ? 'блок' : n < 5 ? 'блоки' : 'блоків');

type Level = 'root' | 'heading' | 'list' | 'indent' | 'align' | 'marks' | 'color' | 'font';
const LEVEL_TITLE: Record<Exclude<Level, 'root'>, string> = {
  heading: 'Заголовок',
  list: 'Список',
  indent: 'Відступ',
  align: 'Розташування',
  marks: 'Оформлення',
  color: 'Колір',
  font: 'Шрифт',
};

export default function SelectModeSheet({ open, count, textCount, cardCount, bottom, buttons, onClose, actions, format, extraLooks = [] }: Props) {
  const theme = useTheme();
  const soft = useSoft();
  const { width: windowW } = useWindowDimensions();
  const [level, setLevel] = useState<Level>('root');
  // A new sheet starts at its top level.
  useEffect(() => setLevel('root'), [open]);
  if (!open) return null;
  const frame = topBarFrame(windowW);
  const stripW = Math.min(DOCK_BUTTON_W, Math.floor(frame.width / Math.max(1, buttons))) * Math.max(1, buttons);
  const left = frame.left + (frame.width - stripW) / 2;
  const card = { backgroundColor: soft.chrome, boxShadow: soft.shadow, borderRadius: RADIUS };
  const ink = theme.ink.primary;

  // One tile: a picture (a glyph, an icon or a block miniature) over its word; `into` marks a group that is fallen into.
  const tile = (key: string, label: string, face: ReactNode, onPress: () => void, opts: { active?: boolean; into?: boolean; danger?: boolean } = {}) => (
    <Pressable key={key} focusable={false} style={styles.tile} onPress={onPress} accessibilityLabel={label}>
      <View
        style={[
          styles.tileFace,
          {
            backgroundColor: soft.card,
            borderRadius: TILE_R,
            borderColor: opts.active ? soft.ink : theme.edge.hairline,
            borderWidth: opts.active ? 1.5 : StyleSheet.hairlineWidth,
          },
        ]}
      >
        {face}
        {opts.into && <Text style={[styles.into, { color: soft.ink3 }]}>›</Text>}
      </View>
      <Text style={[styles.tileLabel, { color: opts.danger ? '#B3412E' : ink }]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
  const icon = (name: string, mc = false) =>
    mc ? (
      <MaterialCommunityIcons name={name as keyof typeof MaterialCommunityIcons.glyphMap} size={22} color={ink} />
    ) : (
      <Ionicons name={name as never} size={21} color={ink} />
    );
  const mini = (kind: string) => <BlockMiniature kind={kind} width={58} />;
  const glyph = (text: string, style?: object) => <Text style={[{ fontSize: 20, color: ink, fontFamily: FONT_MEDIUM }, style]}>{text}</Text>;
  // Picked and done: the sheet closes (a look); picked and maybe again: it stays (indent, marks).
  const thenClose = (fn: () => void) => () => {
    fn();
    onClose();
  };

  const head = (title: string, back?: Level) => (
    <View style={styles.headRow}>
      {back ? (
        <Pressable hitSlop={10} focusable={false} onPress={() => setLevel(back)} style={styles.back} accessibilityLabel="Назад">
          <Ionicons name="chevron-back" size={18} color={ink} />
          <Text style={[styles.head, { color: ink }]}>{title}</Text>
        </Pressable>
      ) : (
        <Text style={[styles.head, { color: ink }]}>{title}</Text>
      )}
      <Pressable hitSlop={10} focusable={false} onPress={onClose} accessibilityLabel="Закрити">
        <Ionicons name="close" size={18} color={soft.ink3} />
      </Pressable>
    </View>
  );

  let body: ReactNode;
  if (open === 'actions') {
    body = (
      <>
        {head(`Дії · ${count} ${blocksWord(count)}`)}
        <View style={styles.grid}>
          {actions.map((a) => tile(a.key, a.label, icon(a.icon), a.keepOpen ? a.onPress : thenClose(a.onPress)))}
        </View>
      </>
    );
  } else if (open === 'look') {
    body = (
      <>
        {head(`Вигляд · ${cardCount} ${cardCount === 1 ? 'картка' : cardCount < 5 ? 'картки' : 'карток'}`)}
        <View style={styles.grid}>
          {extraLooks.map((l) => tile(l.key, l.label, mini(l.mini), thenClose(l.onPress), { active: l.active }))}
        </View>
      </>
    );
  } else {
    const f = format;
    const textHead = `Форматування · ${textCount} ${blocksWord(textCount)}`;
    if (level === 'root') {
      body = (
        <>
          {head(textHead)}
          <View style={styles.grid}>
            {tile('paragraph', 'Текст', mini('paragraph'), thenClose(() => f.onLook('paragraph')), { active: f.kind === 'paragraph' })}
            {tile('heading', 'Заголовок', mini('h2'), () => setLevel('heading'), { into: true, active: f.kind === 'h1' || f.kind === 'h2' || f.kind === 'h3' })}
            {tile('list', 'Список', mini('bulleted'), () => setLevel('list'), {
              into: true,
              active: f.kind === 'bulleted' || f.kind === 'numbered' || f.kind === 'checkbox' || f.kind === 'toggle',
            })}
            {tile('code', 'Код', mini('code'), thenClose(() => f.onLook('code')), { active: f.kind === 'code' })}
            {tile('indent', 'Відступ', icon('format-indent-increase', true), () => setLevel('indent'), { into: true })}
            {tile('align', 'Розташування', icon(`format-align-${f.align ?? 'left'}`, true), () => setLevel('align'), { into: true })}
            {tile('marks', 'Оформлення', glyph('Ж', { fontFamily: FONT_SEMIBOLD }), () => setLevel('marks'), { into: true })}
            {f.fonts && tile('font', 'Шрифт', glyph('Аа'), () => setLevel('font'), { into: true })}
          </View>
        </>
      );
    } else if (level === 'heading') {
      body = (
        <>
          {head(LEVEL_TITLE.heading, 'root')}
          <View style={styles.grid}>
            {tile('h1', 'Заголовок 2', mini('h2'), thenClose(() => f.onLook('h1')), { active: f.kind === 'h1' })}
            {tile('h2', 'Заголовок 3', mini('h3'), thenClose(() => f.onLook('h2')), { active: f.kind === 'h2' })}
            {tile('h3', 'Заголовок 4', mini('h4'), thenClose(() => f.onLook('h3')), { active: f.kind === 'h3' })}
          </View>
        </>
      );
    } else if (level === 'list') {
      body = (
        <>
          {head(LEVEL_TITLE.list, 'root')}
          <View style={styles.grid}>
            {tile('bulleted', 'Маркований', mini('bulleted'), thenClose(() => f.onLook('bulleted')), { active: f.kind === 'bulleted' })}
            {tile('numbered', 'Нумерований', mini('numbered'), thenClose(() => f.onLook('numbered')), { active: f.kind === 'numbered' })}
            {tile('checkbox', 'Чекбокс', mini('checkbox'), thenClose(() => f.onLook('checkbox')), { active: f.kind === 'checkbox' })}
            {tile('toggle', 'Розкривний', mini('toggle'), thenClose(() => f.onLook('toggle')), { active: f.kind === 'toggle' })}
          </View>
        </>
      );
    } else if (level === 'indent') {
      body = (
        <>
          {head(LEVEL_TITLE.indent, 'root')}
          <View style={styles.grid}>
            {tile('less', 'Менше', icon('format-indent-decrease', true), () => f.onIndent(-1))}
            {tile('more', 'Більше', icon('format-indent-increase', true), () => f.onIndent(1))}
          </View>
        </>
      );
    } else if (level === 'align') {
      body = (
        <>
          {head(LEVEL_TITLE.align, 'root')}
          <View style={styles.grid}>
            {(
              [
                ['left', 'Ліворуч'],
                ['center', 'Центр'],
                ['right', 'Праворуч'],
                ['justify', 'По ширині'],
              ] as const
            ).map(([a, label]) => tile(a, label, icon(`format-align-${a}`, true), () => f.onAlign(a), { active: f.align === a }))}
          </View>
        </>
      );
    } else if (level === 'marks') {
      body = (
        <>
          {head(LEVEL_TITLE.marks, 'root')}
          <View style={styles.grid}>
            {tile('bold', 'Жирний', glyph('Ж', { fontFamily: FONT_SEMIBOLD }), () => f.onMark('**'))}
            {tile('italic', 'Курсив', glyph('К', { fontStyle: 'italic' }), () => f.onMark('*'))}
            {tile('strike', 'Закреслений', glyph('З', { textDecorationLine: 'line-through' }), () => f.onMark('~~'))}
            {tile('color', 'Колір', icon('palette-outline', true), () => setLevel('color'), { into: true })}
          </View>
        </>
      );
    } else if (level === 'color') {
      body = (
        <>
          {head(LEVEL_TITLE.color, 'marks')}
          <View style={styles.grid}>
            {tile('none', 'Без кольору', glyph('Аа'), thenClose(() => f.onColor(null)))}
            {f.colors.map((hex) =>
              tile(hex, 'Колір', <View style={[styles.swatch, { backgroundColor: hex }]} />, thenClose(() => f.onColor(hex)))
            )}
          </View>
        </>
      );
    } else {
      body = (
        <>
          {head(LEVEL_TITLE.font, 'root')}
          <View style={styles.grid}>
            {(f.fonts ?? []).map((font) =>
              tile(font.id, font.label, glyph('Аа', font.family ? { fontFamily: font.family } : undefined), thenClose(() => f.onFont(font.id)), {
                active: f.font === font.id,
              })
            )}
          </View>
        </>
      );
    }
  }

  return (
    <View style={[StyleSheet.absoluteFill, { zIndex: 40 }]} pointerEvents="box-none">
      {/* Nothing here takes focus: a focused piece removed hands the focus on, and Samsung then rings the bar capsule in black. */}
      <Pressable focusable={false} style={StyleSheet.absoluteFill} onPress={onClose} accessibilityLabel="Закрити" />
      <Animated.View layout={LinearTransition.duration(220)} style={[styles.card, card, { bottom, left, width: stripW }]}>
        {body}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { position: 'absolute', overflow: 'hidden', paddingHorizontal: PAD, paddingTop: 12, paddingBottom: PAD, gap: 10 },
  headRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4 },
  head: { fontFamily: FONT_SEMIBOLD, fontSize: 14 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', rowGap: 10 },
  tile: { width: '25%', alignItems: 'center', gap: 5, paddingHorizontal: 3 },
  tileFace: { alignSelf: 'stretch', height: 54, alignItems: 'center', justifyContent: 'center' },
  into: { position: 'absolute', top: 2, right: 7, fontSize: 15, fontFamily: FONT_REGULAR },
  tileLabel: { fontFamily: FONT_MEDIUM, fontSize: 10.5 },
  swatch: { width: 24, height: 24, borderRadius: 12 },
});
