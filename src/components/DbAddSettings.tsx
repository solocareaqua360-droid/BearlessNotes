import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import Animated from 'react-native-reanimated';
import GlassLayer from './GlassLayer';
import { Ionicons } from './icons/Ionicons';
import { useBottomSheet } from './surfaces/bottomSheet';
import { SHEET_FRAME } from '../constants/glass';
import { useSoft } from '../theme/soft';
import { SOFT_BOLD, SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import type { CustomDatabase, DbAddButtonSettings, DbTableSettings } from '../types';
import { addLabel, askable, autoDefaults, effectiveDefaults, titleFieldOf, valueLabel } from '../utils/dbAddButton';

// «КНОПКА ДОДАВАННЯ» of a table (2026-11-03): shown or not, what it is called, what a new record gets without being asked, which
// fields the window asks and where the typed line goes. All of it is the table's own setting (DbTableSettings.addButton) - see
// utils/dbAddButton. The questions that need a list (which field, which value) are asked by the table (the callbacks).
export default function DbAddSettings({
  visible,
  database,
  settings,
  onChange,
  onClose,
  onLabel,
  onAddDefault,
  onTitleField,
}: {
  visible: boolean;
  database: CustomDatabase;
  settings: DbTableSettings;
  onChange: (patch: Partial<DbAddButtonSettings>) => void;
  onClose: () => void;
  onLabel: () => void;
  onAddDefault: () => void;
  onTitleField: () => void;
}) {
  const S = useSoft();
  const b = useBottomSheet(visible, onClose);
  const ab = settings.addButton ?? {};
  const defaults = effectiveDefaults(settings, database);
  const auto = autoDefaults(settings.source === 'manual' ? [] : settings.filters, database);
  const title = titleFieldOf(ab, database);
  const asked = new Set(ab.ask ?? []);
  const candidates = database.fields.filter((f) => askable(f) && f.id !== title?.id && defaults[f.id] === undefined);

  const removeDefault = (fieldId: string) => {
    const own = { ...(ab.defaults ?? {}) };
    delete own[fieldId];
    onChange({ defaults: own, noAuto: auto[fieldId] !== undefined ? [...new Set([...(ab.noAuto ?? []), fieldId])] : ab.noAuto });
  };
  const toggleAsk = (fieldId: string) => onChange({ ask: asked.has(fieldId) ? (ab.ask ?? []).filter((x) => x !== fieldId) : [...(ab.ask ?? []), fieldId] });

  const row = (children: React.ReactNode, press?: () => void) => (
    <Pressable onPress={press} disabled={!press} style={[st.row, { borderBottomColor: S.line }]}>
      {children}
    </Pressable>
  );

  return (
    <GlassLayer visible={visible} onClose={onClose} intensity={60} rise={b.on}>
      <View style={[SHEET_FRAME, b.frame]} pointerEvents="box-none">
        <Animated.View style={[st.sheet, { backgroundColor: S.card }, b.window, b.padBottom(14)]}>
          {b.fill}
          {b.grab}
          {b.on && <View style={{ height: 8 }} />}
          <View style={st.head}>
            <Text style={[st.title, { color: S.ink }]}>Кнопка додавання</Text>
            <Pressable onPress={onClose} hitSlop={10}>
              <Text style={[st.done, { color: S.accent }]}>Готово</Text>
            </Pressable>
          </View>
          <ScrollView style={{ flexGrow: 0 }} showsVerticalScrollIndicator={false}>
            {row(
              <>
                <Text style={[st.rowText, { color: S.ink }]}>Показувати</Text>
                <Switch value={!!ab.on} onValueChange={(on) => onChange({ on })} trackColor={{ true: S.ink, false: S.fill }} thumbColor="#FFFFFF" />
              </>
            )}
            {row(
              <>
                <Text style={[st.rowText, { color: S.ink }]}>Підпис</Text>
                <View style={st.value}>
                  <Text style={[st.rowValue, { color: S.ink2 }]} numberOfLines={1}>
                    {addLabel(settings, database)}
                  </Text>
                  <Ionicons name="chevron-forward" size={16} color={S.ink3} />
                </View>
              </>,
              onLabel
            )}

            <Text style={[st.section, { color: S.ink2 }]}>Нові записи отримують</Text>
            <View style={st.chips}>
              {Object.entries(defaults).map(([id, v]) => {
                const f = database.fields.find((x) => x.id === id);
                if (!f) return null;
                return (
                  <Pressable key={id} onPress={() => removeDefault(id)} style={[st.chip, { backgroundColor: 'rgba(217,121,63,0.14)' }]} accessibilityLabel={`Прибрати: ${f.name}`}>
                    <Text style={[st.chipText, { color: '#8F4719' }]}>{`${f.name} = ${valueLabel(f, v)}`}</Text>
                    <Ionicons name="close" size={14} color="#8F4719" />
                  </Pressable>
                );
              })}
              <Pressable onPress={onAddDefault} style={[st.chip, st.chipAdd, { borderColor: S.ink3 }]}>
                <Text style={[st.chipText, { color: S.ink2 }]}>+ Значення</Text>
              </Pressable>
            </View>
            <Text style={[st.hint, { color: S.ink2 }]}>
              {Object.keys(auto).length > 0 ? 'Підказано умовою таблиці. Натисніть значення, щоб прибрати його.' : 'Нічого не проставляється: умова таблиці не називає одного значення.'}
            </Text>

            <Text style={[st.section, { color: S.ink2 }]}>У вікні питати</Text>
            {row(
              <>
                <Text style={[st.rowText, { color: S.ink }]}>
                  {title?.name ?? 'Назва'} <Text style={{ color: S.ink2, fontSize: 13 }}>· рядок тексту</Text>
                </Text>
                <View style={st.value}>
                  <Ionicons name="checkbox" size={22} color={S.ink3} />
                </View>
              </>,
              onTitleField
            )}
            {candidates.map((f) =>
              row(
                <>
                  <Text style={[st.rowText, { color: S.ink }]} numberOfLines={1}>
                    {f.name}
                    {f.type === 'relation' ? <Text style={{ color: S.ink2, fontSize: 13 }}> · картинки</Text> : null}
                  </Text>
                  <Ionicons name={asked.has(f.id) ? 'checkbox' : 'square-outline'} size={22} color={asked.has(f.id) ? S.ink : S.ink3} />
                </>,
                () => toggleAsk(f.id)
              )
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </GlassLayer>
  );
}

const st = StyleSheet.create({
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 6, maxHeight: '88%' as never, maxWidth: 560, alignSelf: 'center', width: '100%' },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 44 },
  title: { fontSize: 20, fontFamily: SOFT_BOLD },
  done: { fontSize: 15, fontFamily: SOFT_SEMIBOLD },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 50, borderBottomWidth: StyleSheet.hairlineWidth, gap: 12 },
  rowText: { fontSize: 15, fontFamily: SOFT_REGULAR, flexShrink: 1 },
  rowValue: { fontSize: 15, fontFamily: SOFT_REGULAR, maxWidth: 180 },
  value: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  section: { fontSize: 12, fontFamily: SOFT_SEMIBOLD, letterSpacing: 0.5, textTransform: 'uppercase', marginTop: 18, marginBottom: 8 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, height: 36, paddingHorizontal: 14, borderRadius: 18 },
  chipAdd: { borderWidth: 1.5, borderStyle: 'dashed' },
  chipText: { fontSize: 14, fontFamily: SOFT_MEDIUM },
  hint: { fontSize: 13, lineHeight: 18, marginTop: 8, fontFamily: SOFT_REGULAR },
});
