import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Sheet from './surfaces/Sheet';
import { Ionicons } from './icons/Ionicons';
import { useTheme } from '../theme/ThemeProvider';
import { onSnapshot } from '../firestore';
import { ownedQuery } from '../utils/owned';
import { listenError } from '../utils/listenError';
import { CARD_COLORS, CARD_SIZES, FOLDER_CARD_SIZES, type CardSize } from '../constants/cardPalette';
import type { Group, Tag } from '../types';

// Two windows a FOLDER can be asked for (its hold menu, FolderHoldMenu):
//  - which projects it belongs to - several, explicit, nothing inherited;
//  - how its card looks on the project screen - size, one of the legal
//    swatches, an outer description and an inner one.
// Neither changes how a folder behaves anywhere else.

export function FolderProjectsSheet({
  visible,
  folderName,
  selected,
  onSave,
  onClose,
}: {
  visible: boolean;
  folderName: string;
  selected: string[];
  onSave: (groupIds: string[]) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [groups, setGroups] = useState<Group[]>([]);
  const [picked, setPicked] = useState<string[]>(selected);
  useEffect(() => {
    if (visible) setPicked(selected);
  }, [visible, selected]);
  useEffect(
    () =>
      onSnapshot(
        ownedQuery('groups'),
        (snapshot) =>
          setGroups(
            snapshot.docs
              .map((d) => ({ id: d.id, ...(d.data() as Omit<Group, 'id'>) }))
              .filter((g) => !g.archived)
              .sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')))
          ),
        listenError('FolderProjectsSheet:groups')
      ),
    []
  );
  const toggle = (id: string) => setPicked((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  return (
    <Sheet visible={visible} onClose={onClose} title="Проєкти папки" subtitle={folderName}>
      {groups.length === 0 && <Text style={[styles.hint, { color: theme.ink.faint }]}>Проєктів ще немає. Створи їх у будь-якій базі, у виборі проєкту.</Text>}
      <ScrollView style={styles.listBox} showsVerticalScrollIndicator={false}>
      {groups.map((g) => {
        const on = picked.includes(g.id);
        return (
          <Pressable key={g.id} style={styles.row} onPress={() => toggle(g.id)}>
            <View style={[styles.box, { borderColor: on ? theme.accent : theme.ink.faint }, on && { backgroundColor: theme.accent }]}>
              {on && <Ionicons name="checkmark" size={15} color={theme.onAccent} />}
            </View>
            <View style={[styles.dot, { backgroundColor: g.color }]} />
            <Text style={[styles.rowText, { color: theme.ink.primary }]} numberOfLines={1}>
              {g.name}
            </Text>
          </Pressable>
        );
      })}
      </ScrollView>
      <Text style={[styles.hint, { color: theme.ink.faint }]}>
        Папка потрапляє лише в позначені проєкти. Папки всередині неї не успадковують їх, їм проєкт призначають окремо.
      </Text>
      <View style={styles.buttons}>
        <Pressable onPress={onClose} style={[styles.button, { borderColor: theme.edge.hairline, borderWidth: 1.5 }]}>
          <Text style={[styles.buttonText, { color: theme.ink.primary }]}>Скасувати</Text>
        </Pressable>
        <Pressable onPress={() => onSave(picked)} style={[styles.button, { backgroundColor: theme.accent }]}>
          <Text style={[styles.buttonText, { color: theme.onAccent }]}>Готово</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const PATTERNS: { id: NonNullable<NonNullable<Tag['card']>['pattern']>; label: string }[] = [
  { id: 'none', label: 'Немає' },
  { id: 'light', label: 'Рідкий' },
  { id: 'normal', label: 'Звичайний' },
  { id: 'dense', label: 'Щільний' },
];

export function FolderCardSheet({
  visible,
  folderName,
  card,
  onSave,
  onClose,
  collection = false,
}: {
  visible: boolean;
  folderName: string;
  card: Tag['card'];
  // A collection (photos / points / videos): its face is its content - the face choice, no colour or pattern.
  collection?: boolean;
  onSave: (card: Tag['card'] | null) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const scheme = theme.scheme;
  const [size, setSize] = useState<CardSize>('M');
  const [color, setColor] = useState<string | undefined>(undefined);
  const [pattern, setPattern] = useState<NonNullable<NonNullable<Tag['card']>['pattern']>>('normal');
  const [outer, setOuter] = useState('');
  const [inner, setInner] = useState('');
  const [face, setFace] = useState<'stack' | 'spread' | undefined>(undefined);
  useEffect(() => {
    if (!visible) return;
    setFace(card?.face);
    setSize(collection ? card?.size ?? 'M' : card?.size === 'S' ? 'S' : 'M');
    setColor(card?.color);
    setPattern(card?.pattern ?? 'normal');
    setOuter(card?.outer ?? '');
    setInner(card?.inner ?? '');
  }, [visible, card]);
  return (
    <Sheet visible={visible} onClose={onClose} title="Вигляд картки" subtitle={folderName}>
      <Text style={[styles.label, { color: theme.ink.faint }]}>РОЗМІР</Text>
      <View style={[styles.seg, { backgroundColor: theme.surface }]}>
        {(collection ? CARD_SIZES : FOLDER_CARD_SIZES).map((s) => (
          <Pressable key={s.id} style={[styles.segItem, size === s.id && { backgroundColor: theme.raised }]} onPress={() => setSize(s.id)}>
            <Text style={[styles.segText, { color: size === s.id ? theme.ink.primary : theme.ink.faint }]}>{s.label}</Text>
          </Pressable>
        ))}
      </View>
      {collection && (
        <>
          <Text style={[styles.label, { color: theme.ink.faint }]}>У СПИСКУ Й СІТЦІ</Text>
          <View style={[styles.seg, { backgroundColor: theme.surface }]}>
            {(
              [
                { id: 'stack', label: 'Стос' },
                { id: 'spread', label: 'Розкладка' },
              ] as const
            ).map((f) => {
              const on = (face ?? '') === f.id;
              return (
                <Pressable key={f.id} style={[styles.segItem, on && { backgroundColor: theme.raised }]} onPress={() => setFace(f.id)}>
                  <Text style={[styles.segText, { color: on ? theme.ink.primary : theme.ink.faint }]}>{f.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={[styles.hint, { color: theme.ink.faint }]}>
            Стос: фото стосом у списку, роздруківки в сітці. Розкладка: перші фото в ряд у списку, мозаїка в сітці.
          </Text>
        </>
      )}
      {!collection && (
      <>
      <Text style={[styles.label, { color: theme.ink.faint }]}>
        {`КОЛІР${color ? ` · ${CARD_COLORS.find((c) => c.id === color)?.name?.toUpperCase() ?? ''}` : ''}`}
      </Text>
      <View style={styles.swatches}>
        {CARD_COLORS.map((c) => (
          <Pressable key={c.id} onPress={() => setColor(c.id)}>
            <View style={[styles.swatch, { backgroundColor: c[scheme].bg, borderColor: color === c.id ? theme.accent : theme.edge.hairline, borderWidth: color === c.id ? 2.5 : 1 }]}>
              <Text style={{ color: c[scheme].ink, fontSize: 13, fontWeight: '700' }}>Аа</Text>
            </View>
          </Pressable>
        ))}
      </View>
      <Text style={[styles.label, { color: theme.ink.faint }]}>ВІЗЕРУНОК З ІКОНОК ВМІСТУ</Text>
      <View style={[styles.seg, { backgroundColor: theme.surface }]}>
        {PATTERNS.map((p) => (
          <Pressable key={p.id} style={[styles.segItem, pattern === p.id && { backgroundColor: theme.raised }]} onPress={() => setPattern(p.id)}>
            <Text style={[styles.segText, { color: pattern === p.id ? theme.ink.primary : theme.ink.faint }]}>{p.label}</Text>
          </Pressable>
        ))}
      </View>
      </>
      )}
      {/* A collection's card draws no description - no fields for one. */}
      {!collection && (
      <>
      <Text style={[styles.label, { color: theme.ink.faint }]}>ЗОВНІШНІЙ ОПИС (НА КАРТЦІ)</Text>
      <TextInput
        style={[styles.input, { backgroundColor: theme.surface, color: theme.ink.primary }]}
        value={outer}
        onChangeText={setOuter}
        placeholder="Коротко, що тут"
        placeholderTextColor={theme.ink.faint}
        maxLength={90}
      />
      <Text style={[styles.label, { color: theme.ink.faint }]}>ВНУТРІШНІЙ ОПИС (ВСЕРЕДИНІ ПАПКИ)</Text>
      <TextInput
        style={[styles.input, styles.inputTall, { backgroundColor: theme.surface, color: theme.ink.primary }]}
        value={inner}
        onChangeText={setInner}
        placeholder="Довший вступ до вмісту"
        placeholderTextColor={theme.ink.faint}
        multiline
        maxLength={600}
      />
      </>
      )}
      <View style={styles.buttons}>
        <Pressable onPress={() => onSave(null)} style={[styles.button, { borderColor: theme.edge.hairline, borderWidth: 1.5 }]}>
          <Text style={[styles.buttonText, { color: theme.ink.primary }]}>Скинути</Text>
        </Pressable>
        <Pressable onPress={() => onSave({ size, color, pattern, outer: outer.trim() || undefined, inner: inner.trim() || undefined, face })} style={[styles.button, { backgroundColor: theme.accent }]}>
          <Text style={[styles.buttonText, { color: theme.onAccent }]}>Готово</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  listBox: { maxHeight: 360 },
  hint: { fontSize: 12, lineHeight: 17, marginTop: 8 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 48 },
  box: { width: 22, height: 22, borderRadius: 7, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 12, height: 12, borderRadius: 6 },
  rowText: { flex: 1, fontSize: 15.5 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginTop: 12, marginBottom: 6 },
  seg: { flexDirection: 'row', borderRadius: 14, padding: 3, gap: 3 },
  segItem: { flex: 1, alignItems: 'center', paddingVertical: 9, borderRadius: 11 },
  segText: { fontSize: 12, fontWeight: '600' },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  swatch: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  input: { borderRadius: 14, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14 },
  inputTall: { minHeight: 64, textAlignVertical: 'top' },
  buttons: { flexDirection: 'row', gap: 8, marginTop: 14, marginBottom: 4 },
  button: { flex: 1, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  buttonText: { fontSize: 14, fontWeight: '600' },
});

// WHICH FOLDERS ARE IN THE PROJECT - picked from the whole tree, from inside
// the project's own page, so assigning never needs the explorer. Indented by
// depth; ticks are the explicit assignments (nothing inherited).
export function FolderPickSheet({
  visible,
  tags,
  groupId,
  onSave,
  onClose,
}: {
  visible: boolean;
  tags: Tag[];
  groupId: string;
  onSave: (changes: { tag: Tag; assign: boolean }[]) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (visible) setPicked(new Set(tags.filter((t) => t.groupIds?.includes(groupId)).map((t) => t.id)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);
  const sorted = [...tags].sort((a, b) => a.path.localeCompare(b.path));
  const toggle = (id: string) =>
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  return (
    <Sheet visible={visible} onClose={onClose} title="Папки проєкту">
      {sorted.length === 0 && <Text style={[styles.hint, { color: theme.ink.faint }]}>Папок ще немає. Створи їх у провіднику будь-якої бази.</Text>}
      <ScrollView style={styles.listBox} showsVerticalScrollIndicator={false}>
        {sorted.map((t) => {
          const on = picked.has(t.id);
          const depth = t.path.split('/').length - 1;
          return (
            <Pressable key={t.id} style={[styles.row, { paddingLeft: depth * 18 }]} onPress={() => toggle(t.id)}>
              <View style={[styles.box, { borderColor: on ? theme.accent : theme.ink.faint }, on && { backgroundColor: theme.accent }]}>
                {on && <Ionicons name="checkmark" size={15} color={theme.onAccent} />}
              </View>
              <Text style={[styles.rowText, { color: theme.ink.primary }]} numberOfLines={1}>
                {t.path.split('/').pop()}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>
      <Text style={[styles.hint, { color: theme.ink.faint }]}>Позначай кожну папку окремо: вкладені не підтягуються самі.</Text>
      <View style={styles.buttons}>
        <Pressable onPress={onClose} style={[styles.button, { borderColor: theme.edge.hairline, borderWidth: 1.5 }]}>
          <Text style={[styles.buttonText, { color: theme.ink.primary }]}>Скасувати</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            const before = new Set(tags.filter((t) => t.groupIds?.includes(groupId)).map((t) => t.id));
            const changes = tags
              .filter((t) => before.has(t.id) !== picked.has(t.id))
              .map((t) => ({ tag: t, assign: picked.has(t.id) }));
            onSave(changes);
          }}
          style={[styles.button, { backgroundColor: theme.accent }]}
        >
          <Text style={[styles.buttonText, { color: theme.onAccent }]}>Готово</Text>
        </Pressable>
      </View>
    </Sheet>
  );
}
