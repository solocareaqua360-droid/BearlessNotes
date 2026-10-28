import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import GlassLayer from './GlassLayer';
import { useBottomSheet } from './surfaces/bottomSheet';
import { Ionicons } from './icons/Ionicons';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { SHEET_FRAME } from '../constants/glass';

// «ВИГЛЯД ПАПОК» (the user, 2026-10-25: «треба якесь загальне меню з перемикачами виглядів у всіх папках»): every folder
// in one list, each with its two views side by side - a list or a grid. The canvas is not here: it shows all the folders
// at once, so it is one view for the whole explorer («⋯» → «Вигляд»). A folder with no view of its own follows that one.

export type FolderViewRow = { path: string; name: string; depth: number; view?: 'list' | 'grid' | 'rows' };

export default function FolderViewsSheet({
  visible,
  folders,
  fallback,
  onSet,
  onSetAll,
  onClose,
}: {
  visible: boolean;
  folders: FolderViewRow[];
  // What a folder with no view of its own shows (the explorer's list or grid).
  fallback: 'list' | 'grid' | 'rows';
  onSet: (path: string, view: 'list' | 'grid' | 'rows') => void;
  onSetAll: (view: 'list' | 'grid' | 'rows') => void;
  onClose: () => void;
}) {
  const S = useSoft();
  const b = useBottomSheet(visible, onClose);
  const allAre = (v: 'list' | 'grid' | 'rows') => folders.length > 0 && folders.every((f) => (f.view ?? fallback) === v);
  const pair = (current: 'list' | 'grid' | 'rows' | null, set: (v: 'list' | 'grid' | 'rows') => void, label: string) => (
    <View style={[styles.pair, { backgroundColor: S.fill }]}>
      {(['list', 'grid', 'rows'] as const).map((v) => {
        const on = current === v;
        return (
          <Pressable
            key={v}
            onPress={() => set(v)}
            hitSlop={4}
            accessibilityLabel={`${label}: ${v === 'list' ? 'список' : v === 'grid' ? 'сітка' : 'рядки'}`}
            style={[styles.seg, on && { backgroundColor: S.card, boxShadow: S.shadow } as never]}
          >
            <Ionicons name={v === 'list' ? 'reorder-four-outline' : v === 'grid' ? 'grid-outline' : 'list-outline'} size={18} color={on ? S.ink : S.ink3} />
          </Pressable>
        );
      })}
    </View>
  );
  return (
    <GlassLayer visible={visible} onClose={onClose} intensity={60} rise={b.on}>
      <View style={[SHEET_FRAME, b.frame]} pointerEvents="box-none">
        <Animated.View style={[styles.card, { backgroundColor: S.card }, b.window, b.padBottom(14)]}>
          {b.fill}
          {b.grab}
          {b.on && <View style={{ height: 12 }} />}
          <Text style={[styles.title, { color: S.ink }]}>Вигляд папок</Text>
          <Text style={[styles.hint, { color: S.ink3 }]}>Полотно - одне для всіх папок, воно в «⋯» → «Вигляд».</Text>
          <View style={styles.row}>
            <Text style={[styles.allLabel, { color: S.ink }]}>Усі папки</Text>
            {pair(allAre('list') ? 'list' : allAre('grid') ? 'grid' : allAre('rows') ? 'rows' : null, onSetAll, 'Усі папки')}
          </View>
          <View style={[styles.rule, { backgroundColor: S.line }]} />
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ paddingBottom: 8 }}>
            {folders.map((f) => (
              <View key={f.path} style={[styles.row, { paddingLeft: 4 + f.depth * 18 }]}>
                <Ionicons name="folder-outline" size={18} color={S.ink3} />
                <Text style={[styles.name, { color: S.ink }]} numberOfLines={1}>
                  {f.name}
                </Text>
                {pair(f.view ?? fallback, (v) => onSet(f.path, v), f.name)}
              </View>
            ))}
          </ScrollView>
        </Animated.View>
      </View>
    </GlassLayer>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', maxWidth: 440, maxHeight: '86%', borderRadius: 26, paddingTop: 18, paddingHorizontal: 18 },
  title: { fontSize: 20, fontFamily: SOFT_SEMIBOLD, letterSpacing: -0.3, paddingHorizontal: 4 },
  hint: { fontSize: 13.5, fontFamily: SOFT_REGULAR, paddingHorizontal: 4, marginTop: 4, marginBottom: 10 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 50, paddingRight: 2 },
  allLabel: { flex: 1, fontSize: 16, fontFamily: SOFT_SEMIBOLD, paddingLeft: 4 },
  name: { flex: 1, fontSize: 15.5, fontFamily: SOFT_MEDIUM },
  rule: { height: StyleSheet.hairlineWidth, marginVertical: 4 },
  pair: { flexDirection: 'row', borderRadius: 14, padding: 3, gap: 2 },
  seg: { width: 42, height: 32, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
});
