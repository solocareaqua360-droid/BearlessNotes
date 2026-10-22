import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import Sheet from './surfaces/Sheet';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { FONT_MEDIUM, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

// The cell's menu on the phone: a sheet from below (sketch 2026-10-22, the user: «на ескізах нормально, мені подобається»).
// Three big actions on top, then sections with an icon on every line, and the deleting apart, in red. «Вставити», «Пересунути» and «Виділити»
// open one more step (which row, which column), with a way back. On the laptop the same choices stay a popover (ask) beside the dots.
//
// What happens is the table's business: this only says WHICH answer was picked (the same ids the table already acts on).
export type CellMenuMode = 'cell' | 'row' | 'col';

type Props = {
  visible: boolean;
  onClose: () => void;
  mode: CellMenuMode;
  title: string;
  hint?: string;
  headerRow: boolean;
  headerColumn: boolean;
  canUp: boolean;
  canDown: boolean;
  canLeft: boolean;
  canRight: boolean;
  canDelRow: boolean;
  canDelCol: boolean;
  onPick: (id: string) => void;
};

type Step = 'main' | 'insert' | 'move' | 'select';
type IconName = 'plus' | 'move' | 'select' | 'row' | 'col' | 'head' | 'sum' | 'width' | 'clear' | 'trash' | 'up' | 'down' | 'left' | 'right' | 'chev' | 'back';

export default function TableCellMenu(props: Props) {
  const { visible, onClose, mode, title, hint, headerRow, headerColumn, canUp, canDown, canLeft, canRight, canDelRow, canDelCol, onPick } = props;
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const [step, setStep] = useState<Step>('main');
  useEffect(() => {
    if (visible) setStep('main');
  }, [visible]);

  const pick = (id: string) => {
    onPick(id);
    onClose();
  };

  type Item = { id: string; label: string; icon: IconName; danger?: boolean; switchOn?: boolean; chevron?: boolean; go?: Step };
  const tile = (it: Item) => (
    <Pressable
      key={it.id}
      style={({ pressed }) => [styles.tile, pressed && styles.pressed]}
      onPress={() => (it.go ? setStep(it.go) : pick(it.id))}
    >
      <Icon name={it.icon} size={22} color={theme.ink.primary} />
      <Text style={styles.tileLabel}>{it.label}</Text>
    </Pressable>
  );
  const rowItem = (it: Item, last: boolean) => (
    <Pressable
      key={it.id}
      style={({ pressed }) => [styles.item, !last && styles.itemRule, pressed && styles.pressed]}
      onPress={() => (it.go ? setStep(it.go) : pick(it.id))}
    >
      <Icon name={it.icon} size={18} color={it.danger ? theme.danger : theme.ink.muted} />
      <Text style={[styles.itemLabel, it.danger && { color: theme.danger }]}>{it.label}</Text>
      {it.switchOn !== undefined && (
        <View style={[styles.switch, it.switchOn && { backgroundColor: theme.ink.primary }]}>
          <View style={[styles.knob, it.switchOn && { left: 14 }]} />
        </View>
      )}
      {it.chevron && <Icon name="chev" size={16} color={theme.ink.faint} />}
    </Pressable>
  );
  const group = (items: Item[]) => (
    <View style={styles.group}>{items.map((it, i) => rowItem(it, i === items.length - 1))}</View>
  );

  const del: Item[] = [
    ...(canDelRow ? [{ id: 'delRow', label: 'Видалити рядок', icon: 'trash' as IconName, danger: true }] : []),
    ...(canDelCol ? [{ id: 'delCol', label: 'Видалити колонку', icon: 'trash' as IconName, danger: true }] : []),
  ];
  const moves: Item[] = [
    ...(mode !== 'col' && canUp ? [{ id: 'up', label: 'Рядок вгору', icon: 'up' as IconName }] : []),
    ...(mode !== 'col' && canDown ? [{ id: 'down', label: 'Рядок вниз', icon: 'down' as IconName }] : []),
    ...(mode !== 'row' && canLeft ? [{ id: 'left', label: 'Колонку ліворуч', icon: 'left' as IconName }] : []),
    ...(mode !== 'row' && canRight ? [{ id: 'right', label: 'Колонку праворуч', icon: 'right' as IconName }] : []),
  ];

  let body;
  if (step === 'insert') {
    body = group([
      { id: 'rowAbove', label: 'Рядок вище', icon: 'up' },
      { id: 'rowBelow', label: 'Рядок нижче', icon: 'down' },
      { id: 'colLeft', label: 'Колонку ліворуч', icon: 'left' },
      { id: 'colRight', label: 'Колонку праворуч', icon: 'right' },
    ]);
  } else if (step === 'move') {
    body = group(moves.length ? moves : [{ id: 'none', label: 'Нікуди пересувати', icon: 'move' }]);
  } else if (step === 'select') {
    body = group([
      { id: 'selRow', label: 'Виділити рядок', icon: 'row' },
      { id: 'selCol', label: 'Виділити колонку', icon: 'col' },
    ]);
  } else if (mode === 'row') {
    body = (
      <>
        <View style={styles.tiles}>
          {tile({ id: 'rowAbove', label: 'Вставити вище', icon: 'up' })}
          {tile({ id: 'rowBelow', label: 'Вставити нижче', icon: 'down' })}
          {tile({ id: 'move', label: 'Пересунути', icon: 'move', go: 'move' })}
        </View>
        {group([
          { id: 'clearRow', label: 'Очистити рядок', icon: 'clear' },
          { id: 'selCol', label: 'Виділити колонку', icon: 'col', chevron: true },
          ...del,
        ])}
      </>
    );
  } else if (mode === 'col') {
    body = (
      <>
        <View style={styles.tiles}>
          {tile({ id: 'colLeft', label: 'Вставити ліворуч', icon: 'left' })}
          {tile({ id: 'colRight', label: 'Вставити праворуч', icon: 'right' })}
          {tile({ id: 'move', label: 'Пересунути', icon: 'move', go: 'move' })}
        </View>
        {group([
          { id: 'clearCol', label: 'Очистити колонку', icon: 'clear' },
          { id: 'selRow', label: 'Виділити рядок', icon: 'row', chevron: true },
          ...del,
        ])}
      </>
    );
  } else {
    body = (
      <>
        <View style={styles.tiles}>
          {tile({ id: 'insert', label: 'Вставити', icon: 'plus', go: 'insert' })}
          {tile({ id: 'move', label: 'Пересунути', icon: 'move', go: 'move' })}
          {tile({ id: 'select', label: 'Виділити', icon: 'select', go: 'select' })}
        </View>
        <Text style={styles.section}>Таблиця</Text>
        {group([
          { id: 'headerRow', label: 'Перший рядок — шапка', icon: 'head', switchOn: headerRow },
          { id: 'headerCol', label: 'Перша колонка — шапка', icon: 'col', switchOn: headerColumn },
          { id: 'sum', label: 'Рядок підсумків', icon: 'sum' },
          { id: 'resetWidths', label: 'Скинути ширину колонок', icon: 'width' },
        ])}
        {group([{ id: 'clearCell', label: 'Очистити клітинку', icon: 'clear' }, ...del])}
      </>
    );
  }

  return (
    <Sheet visible={visible} onClose={onClose} anchor="bottom" scroll maxHeight="75%" priority={100}>
      <View style={styles.head}>
        {step !== 'main' ? (
          <Pressable onPress={() => setStep('main')} hitSlop={10} style={styles.back} accessibilityLabel="Назад">
            <Icon name="back" size={18} color={theme.ink.muted} />
            <Text style={styles.headText}>{title}</Text>
          </Pressable>
        ) : (
          <Text style={styles.headText}>{title}</Text>
        )}
        {!!hint && step === 'main' && <Text style={styles.headText}>{hint}</Text>}
      </View>
      <View style={styles.body}>{body}</View>
    </Sheet>
  );
}

// Line icons (the same set as the sketch), drawn here: the app's icon set has no «row», «column» or «header».
const PATHS: Record<IconName, string[]> = {
  plus: ['M12 5v14M5 12h14'],
  move: ['M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4'],
  select: ['M9 12l2 2 4-4'],
  row: ['M3 10h18M3 14.5h18'],
  col: ['M9 5v14M15 5v14'],
  head: ['M3 10h18'],
  sum: ['M17 5H7l6 7-6 7h10'],
  width: ['M4 12h16M8 8l-4 4 4 4M16 8l4 4-4 4'],
  clear: ['M7 21h10M5 15l8-10 6 5-7 9z'],
  trash: ['M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3'],
  up: ['M12 19V5M6 11l6-6 6 6'],
  down: ['M12 5v14M6 13l6 6 6-6'],
  left: ['M19 12H5M11 6l-6 6 6 6'],
  right: ['M5 12h14M13 6l6 6-6 6'],
  chev: ['M9 6l6 6-6 6'],
  back: ['M15 6l-6 6 6 6'],
};
const FRAMED: IconName[] = ['row', 'col', 'head'];

function Icon({ name, size, color }: { name: IconName; size: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      {FRAMED.includes(name) && <Rect x={3} y={5} width={18} height={14} rx={2} />}
      {name === 'select' && <Rect x={4} y={4} width={16} height={16} rx={3} strokeDasharray="3 3" />}
      {PATHS[name].map((d) => (
        <Path key={d} d={d} />
      ))}
    </Svg>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    head: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingBottom: 10 },
    back: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    headText: { fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: t.ink.faint, fontFamily: FONT_MEDIUM },
    body: { gap: 10 },
    tiles: { flexDirection: 'row', gap: 8 },
    tile: {
      flex: 1,
      alignItems: 'center',
      gap: 7,
      paddingVertical: 14,
      paddingHorizontal: 4,
      borderRadius: 16,
      backgroundColor: t.field.fill,
    },
    tileLabel: { fontSize: 13, color: t.ink.primary, fontFamily: FONT_SEMIBOLD, textAlign: 'center' },
    section: { fontSize: 11, letterSpacing: 0.8, textTransform: 'uppercase', color: t.ink.faint, fontFamily: FONT_MEDIUM, paddingHorizontal: 4, marginBottom: -4 },
    group: { borderRadius: 16, backgroundColor: t.field.fill, overflow: 'hidden' },
    item: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, height: 48 },
    itemRule: { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: t.edge.hairline },
    itemLabel: { flex: 1, fontSize: 15, color: t.ink.primary, fontFamily: FONT_REGULAR },
    pressed: { opacity: 0.6 },
    switch: { width: 34, height: 20, borderRadius: 10, backgroundColor: t.edge.hairline },
    knob: { position: 'absolute', left: 3, top: 3, width: 14, height: 14, borderRadius: 7, backgroundColor: t.raised },
  });
