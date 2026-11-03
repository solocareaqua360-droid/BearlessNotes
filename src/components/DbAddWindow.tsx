import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Keyboard, Pressable, StyleSheet, Text, useWindowDimensions, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScrollView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import TextInput from './AppTextInput';
import GlassLayer from './GlassLayer';
import { Ionicons } from './icons/Ionicons';
import { BELOW, useBottomSheet } from './surfaces/bottomSheet';
import { SHEET_FRAME } from '../constants/glass';
import { useSoft } from '../theme/soft';
import { SOFT_BOLD, SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { pickPhotosFromDevice, type NewPhoto } from '../utils/photoLibrary';
import type { CustomDatabase, DbTableSettings, FieldDef } from '../types';
import { addLabel, askedFields, effectiveDefaults, titleFieldOf, valueLabel } from '../utils/dbAddButton';

// THE WINDOW OF A TABLE'S ADD BUTTON (2026-11-03): built from the base's own fields - the typed line goes to the field the
// table's settings name (the base's name by default), «Подробиці» and the rest are the fields it was set to ask, pictures come
// from the gallery - and what the table's filter implies is not asked, only said. Nothing here is written to the base until
// «Додати»: the pictures picked are made into Photos records only then, so cancelling leaves nothing behind.

export type AddPicked = Record<string, string | string[]>;
export type AddPicture = NewPhoto;

const dateKey = (offsetDays: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function DbAddWindow({
  visible,
  database,
  settings,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  database: CustomDatabase;
  settings: DbTableSettings;
  onClose: () => void;
  // The typed line, the values picked (a picture field holds the ids the pictures will get) and the pictures themselves.
  onSubmit: (typed: string, picked: AddPicked, pictures: Record<string, AddPicture[]>) => Promise<void>;
}) {
  const S = useSoft();
  const b = useBottomSheet(visible, onClose);
  const [typed, setTyped] = useState('');
  const [picked, setPicked] = useState<AddPicked>({});
  const [pictures, setPictures] = useState<Record<string, AddPicture[]>>({});
  const [busy, setBusy] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  // The sheet is lifted by the keyboard (the window is edge to edge), so its own height must be what is LEFT above the
  // keyboard - else the top, where the typing starts, rides off the screen (the user, 2026-11-04, on the phone).
  const { height: winH } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const room = Math.max(240, winH - keyboardHeight - insets.top - 12);
  useEffect(() => {
    const show = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hide = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  useEffect(() => {
    if (!visible) return;
    setTyped('');
    setPicked({});
    setPictures({});
    setBusy(false);
  }, [visible]);

  const title = titleFieldOf(settings.addButton, database);
  const asked = askedFields(settings, database);
  const defaults = effectiveDefaults(settings, database);
  const defaultChips = Object.entries(defaults)
    .map(([id, v]) => {
      const f = database.fields.find((x) => x.id === id);
      return f ? `${f.name}: ${valueLabel(f, v)}` : null;
    })
    .filter((t): t is string => !!t);
  const anyPicture = Object.values(pictures).some((list) => list.length > 0);
  const ready = (typed.trim().length > 0 || anyPicture) && !busy;

  const toggle = (field: FieldDef, optionId: string) =>
    setPicked((prev) => {
      const now = prev[field.id];
      if (field.type === 'multiSelect') {
        const list = Array.isArray(now) ? now : [];
        return { ...prev, [field.id]: list.includes(optionId) ? list.filter((x) => x !== optionId) : [...list, optionId] };
      }
      return { ...prev, [field.id]: now === optionId ? '' : optionId };
    });

  async function addPictures(field: FieldDef) {
    const got = await pickPhotosFromDevice('gallery', { record: false });
    if (got.length === 0) return;
    setPictures((prev) => ({ ...prev, [field.id]: field.multiple ? [...(prev[field.id] ?? []), ...got] : [got[0]] }));
  }

  async function submit() {
    if (!ready) return;
    setBusy(true);
    try {
      const ids: AddPicked = { ...picked };
      for (const [fieldId, list] of Object.entries(pictures)) if (list.length) ids[fieldId] = list.map((p) => p.id);
      await onSubmit(typed, ids, pictures);
    } finally {
      setBusy(false);
    }
  }

  const label = (text: string) => <Text style={[st.label, { color: S.ink2 }]}>{text}</Text>;
  const chip = (text: string, on: boolean, press: () => void, key?: string) => (
    <Pressable key={key ?? text} onPress={press} style={[st.chip, { backgroundColor: on ? S.ink : S.fill }]}>
      <Text style={[st.chipText, { color: on ? S.card : S.ink }]}>{text}</Text>
    </Pressable>
  );

  return (
    <GlassLayer visible={visible} onClose={onClose} intensity={60} rise={b.on}>
      <View style={[SHEET_FRAME, b.frame]} pointerEvents="box-none">
        <Animated.View style={[st.sheet, { backgroundColor: S.card }, b.window, { marginBottom: keyboardHeight - (b.on ? BELOW : 0), maxHeight: room }, b.padBottom(16)]}>
          {b.fill}
          {b.grab}
          {b.on && <View style={{ height: 8 }} />}
          <View style={st.head}>
            <Text style={[st.title, { color: S.ink }]} numberOfLines={1}>
              {addLabel(settings, database)}
            </Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityLabel="Закрити">
              <Ionicons name="close" size={22} color={S.ink2} />
            </Pressable>
          </View>
          <ScrollView style={{ flexGrow: 0, flexShrink: 1 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
            <TextInput
              autoFocus
              multiline
              value={typed}
              onChangeText={setTyped}
              placeholder={title?.name ?? 'Назва'}
              placeholderTextColor={S.ink3}
              style={[st.input, { backgroundColor: S.fill, color: S.ink, minHeight: keyboardHeight > 0 ? 56 : 84 }]}
            />
            {asked.map((f) => (
              <View key={f.id} style={{ marginTop: 14 }}>
                {label(f.name)}
                {f.type === 'text' && (
                  <TextInput
                    multiline
                    value={(picked[f.id] as string) ?? ''}
                    onChangeText={(t) => setPicked((prev) => ({ ...prev, [f.id]: t }))}
                    placeholder={f.name}
                    placeholderTextColor={S.ink3}
                    style={[st.input, { backgroundColor: S.fill, color: S.ink, minHeight: 56 }]}
                  />
                )}
                {f.type === 'number' && (
                  <TextInput
                    value={(picked[f.id] as string) ?? ''}
                    onChangeText={(t) => setPicked((prev) => ({ ...prev, [f.id]: t }))}
                    keyboardType="numeric"
                    placeholder={f.name}
                    placeholderTextColor={S.ink3}
                    style={[st.input, { backgroundColor: S.fill, color: S.ink }]}
                  />
                )}
                {f.type === 'date' && (
                  <View style={st.chips}>
                    {chip('Сьогодні', picked[f.id] === dateKey(0), () => setPicked((p) => ({ ...p, [f.id]: p[f.id] === dateKey(0) ? '' : dateKey(0) })))}
                    {chip('Завтра', picked[f.id] === dateKey(1), () => setPicked((p) => ({ ...p, [f.id]: p[f.id] === dateKey(1) ? '' : dateKey(1) })))}
                  </View>
                )}
                {(f.type === 'select' || f.type === 'multiSelect') && (
                  <View style={st.chips}>
                    {(f.options ?? []).map((o) =>
                      chip(
                        o.label,
                        f.type === 'multiSelect' ? Array.isArray(picked[f.id]) && (picked[f.id] as string[]).includes(o.id) : picked[f.id] === o.id,
                        () => toggle(f, o.id),
                        o.id
                      )
                    )}
                  </View>
                )}
                {f.type === 'relation' && (
                  <View style={st.tiles}>
                    {(pictures[f.id] ?? []).map((p) => (
                      <View key={p.id} style={[st.tile, { backgroundColor: S.fill }]}>
                        <Image source={{ uri: p.imageUri }} style={st.tileImage} resizeMode="cover" />
                        <Pressable
                          onPress={() => setPictures((prev) => ({ ...prev, [f.id]: (prev[f.id] ?? []).filter((x) => x.id !== p.id) }))}
                          hitSlop={6}
                          style={st.tileX}
                          accessibilityLabel="Прибрати"
                        >
                          <Ionicons name="close" size={13} color="#FFFFFF" />
                        </Pressable>
                      </View>
                    ))}
                    {(f.multiple || (pictures[f.id] ?? []).length === 0) && (
                      <Pressable onPress={() => addPictures(f)} style={[st.tile, st.tileAdd, { borderColor: S.ink3 }]} accessibilityLabel="Додати зі стрічки">
                        <Ionicons name="images-outline" size={22} color={S.ink2} />
                        <Text style={[st.tileAddText, { color: S.ink2 }]}>Зі стрічки</Text>
                      </Pressable>
                    )}
                  </View>
                )}
              </View>
            ))}
            {defaultChips.length > 0 && (
              <Text style={[st.hint, { color: S.ink2 }]}>{`${defaultChips.join(' · ')} - проставиться саме.`}</Text>
            )}
          </ScrollView>
          <Pressable
            onPress={submit}
            disabled={!ready}
            style={[st.submit, { backgroundColor: S.ink, opacity: ready ? 1 : 0.35 }, keyboardHeight > 0 && { height: 46, marginTop: 8 }]}
            accessibilityLabel="Додати"
          >
            {busy ? <ActivityIndicator color={S.card} /> : <Text style={[st.submitText, { color: S.card }]}>Додати</Text>}
          </Pressable>
        </Animated.View>
      </View>
    </GlassLayer>
  );
}

const st = StyleSheet.create({
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 6, maxHeight: '88%' as never, maxWidth: 560, alignSelf: 'center', width: '100%' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40, marginBottom: 6 },
  title: { fontSize: 20, fontFamily: SOFT_BOLD, flex: 1 },
  input: { borderRadius: 16, paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, fontFamily: SOFT_REGULAR, textAlignVertical: 'top' },
  label: { fontSize: 13, fontFamily: SOFT_MEDIUM, marginBottom: 6 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { height: 38, paddingHorizontal: 14, borderRadius: 19, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontSize: 14, fontFamily: SOFT_MEDIUM },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  tile: { width: 70, height: 96, borderRadius: 12, overflow: 'hidden' },
  tileImage: { width: '100%', height: '100%' },
  tileX: { position: 'absolute', top: 3, right: 3, width: 22, height: 22, borderRadius: 11, backgroundColor: 'rgba(30,30,28,0.7)', alignItems: 'center', justifyContent: 'center' },
  tileAdd: { borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 4 },
  tileAddText: { fontSize: 11.5, fontFamily: SOFT_MEDIUM },
  hint: { fontSize: 13, lineHeight: 18, marginTop: 14, fontFamily: SOFT_REGULAR },
  submit: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  submitText: { fontSize: 16, fontFamily: SOFT_SEMIBOLD },
});
