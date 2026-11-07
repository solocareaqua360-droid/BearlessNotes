import { Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import BlockMiniature from './BlockMiniature';
import type { SoftTokens } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';

// «/» ON THE PHONE (2026-10-26, the user's, after Craft's - sketch reports/insert-portion-1-slash.html): a COMPACT window by
// the caret - above it when there is room there, under it otherwise - with the catalogue cut into categories that open with
// «›». Typing after the slash narrows it from the first letter («/з» keeps Заголовок, Зображення, Запис…); ⌫ is a step back
// (a letter, then the submenu, then the window). Scrolls with the finger: the screen is small.
export type SlashKey =
  | 'text'
  | 'h2'
  | 'h3'
  | 'h4'
  | 'code'
  | 'bulleted'
  | 'numbered'
  | 'checkbox'
  | 'toggle'
  | 'rule-solid'
  | 'rule-dotted'
  | 'rule-bold'
  | 'image'
  | 'camera'
  | 'sketch'
  | 'scan'
  | 'file'
  | 'table'
  | 'existing'
  | 'link'
  | 'mention'
  | 'document';

const LABEL: Record<SlashKey, string> = {
  text: 'Текст',
  h2: 'Заголовок 2',
  h3: 'Заголовок 3',
  h4: 'Заголовок 4',
  code: 'Код',
  bulleted: 'Список',
  numbered: 'Нумерований список',
  checkbox: 'Чекбокс',
  toggle: 'Розкривний розділ',
  'rule-solid': 'Суцільна лінія',
  'rule-dotted': 'Пунктирна лінія',
  'rule-bold': 'Жирна лінія',
  image: 'Зображення',
  camera: 'Фото',
  sketch: 'Малюнок',
  scan: 'Сканкопія',
  file: 'Файл',
  table: 'Таблиця',
  existing: 'Запис із бази',
  link: 'Посилання на сайт',
  mention: 'Слово-посилання',
  document: 'Нотатка карткою',
};
// The miniature drawn for each (BlockMiniature's own names).
const MINI: Record<SlashKey, string> = { ...(Object.fromEntries(Object.keys(LABEL).map((k) => [k, k])) as Record<SlashKey, string>), text: 'paragraph' };

const WEB = Platform.OS === 'web';
export const SLASH_CATEGORIES: { key: string; label: string; icon: string; items: SlashKey[] }[] = [
  { key: 'text', label: 'Текст', icon: 'text-outline', items: ['text', 'h2', 'h3', 'h4', 'code'] },
  { key: 'lists', label: 'Списки й завдання', icon: 'list-outline', items: ['bulleted', 'numbered', 'checkbox', 'toggle'] },
  { key: 'rules', label: 'Лінії', icon: 'remove-outline', items: ['rule-solid', 'rule-dotted', 'rule-bold'] },
  { key: 'media', label: 'Медіа й файли', icon: 'image-outline', items: (['image', 'camera', 'sketch', 'scan', 'file'] as SlashKey[]).filter((k) => !WEB || (k !== 'camera' && k !== 'scan')) },
  { key: 'tables', label: 'Таблиці й бази', icon: 'grid-outline', items: ['table', 'existing'] },
  { key: 'links', label: 'Посилання', icon: 'link-outline', items: ['link', 'mention', 'document'] },
];

// From the first letter: any word of the name that starts with what was typed.
export function slashMatches(query: string): SlashKey[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all = SLASH_CATEGORIES.flatMap((c) => c.items);
  return all.filter((k) => {
    const name = LABEL[k].toLowerCase();
    return name.startsWith(q) || name.split(/[\s-]+/).some((w) => w.startsWith(q));
  });
}

export default function SlashMenu({
  query,
  sub,
  onSub,
  onPick,
  place,
  soft,
}: {
  query: string;
  // The open category, or null for the list of categories.
  sub: string | null;
  onSub: (key: string | null) => void;
  onPick: (key: SlashKey) => void;
  // Above the caret (`bottom`) or under it (`top`), and how tall it may grow there.
  place: { top?: number; bottom?: number; maxHeight: number };
  soft: SoftTokens;
}) {
  const typed = query.trim().length > 0;
  const category = sub ? SLASH_CATEGORIES.find((c) => c.key === sub) ?? null : null;
  const found = typed ? slashMatches(query) : [];

  const itemRow = (k: SlashKey, first: boolean) => (
    <Pressable
      key={k}
      onPress={() => onPick(k)}
      style={({ pressed }) => [styles.row, (pressed || first) && { backgroundColor: soft.fill }]}
    >
      <View style={[styles.pic, { backgroundColor: soft.card, borderColor: soft.line }]}>
        <BlockMiniature kind={MINI[k]} width={38} />
      </View>
      <Text style={[styles.label, { color: soft.ink }]} numberOfLines={1}>
        {LABEL[k]}
      </Text>
    </Pressable>
  );

  let body;
  if (typed) {
    body =
      found.length > 0 ? (
        found.map((k, i) => itemRow(k, i === 0))
      ) : (
        <Text style={[styles.empty, { color: soft.ink3 }]}>Такого немає. ⌫ - назад</Text>
      );
  } else if (category) {
    body = (
      <>
        <Pressable onPress={() => onSub(null)} style={styles.row} hitSlop={4}>
          <Ionicons name="chevron-back" size={18} color={soft.ink3} />
          <Text style={[styles.label, { color: soft.ink, fontFamily: SOFT_SEMIBOLD }]}>{category.label}</Text>
          <Text style={[styles.hint, { color: soft.ink3 }]}>⌫ назад</Text>
        </Pressable>
        {category.items.map((k) => itemRow(k, false))}
      </>
    );
  } else {
    body = SLASH_CATEGORIES.map((c) => (
      <Pressable key={c.key} onPress={() => onSub(c.key)} style={({ pressed }) => [styles.row, pressed && { backgroundColor: soft.fill }]}>
        <View style={styles.catIcon}>
          <Ionicons name={c.icon as never} size={20} color={soft.ink} />
        </View>
        <Text style={[styles.label, { color: soft.ink }]} numberOfLines={1}>
          {c.label}
        </Text>
        <Ionicons name="chevron-forward" size={17} color={soft.ink3} />
      </Pressable>
    ));
  }

  return (
    <View
      style={[
        styles.window,
        { backgroundColor: soft.chrome, boxShadow: soft.popShadow, maxHeight: place.maxHeight },
        place.top !== undefined ? { top: place.top } : { bottom: place.bottom },
      ]}
    >
      <ScrollView keyboardShouldPersistTaps="always" showsVerticalScrollIndicator contentContainerStyle={{ padding: 6 }}>
        {body}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  window: { position: 'absolute', left: 12, width: '82%', maxWidth: 340, borderRadius: 18, overflow: 'hidden', zIndex: 50 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, height: 46, paddingHorizontal: 10, borderRadius: 12 },
  catIcon: { width: 30, alignItems: 'center' },
  pic: { width: 42, height: 28, borderRadius: 8, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  label: { flex: 1, fontSize: 15, fontFamily: SOFT_MEDIUM },
  hint: { fontSize: 12, fontFamily: SOFT_REGULAR },
  empty: { fontSize: 14, fontFamily: SOFT_REGULAR, padding: 12 },
});
