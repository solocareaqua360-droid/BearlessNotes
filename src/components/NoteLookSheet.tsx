import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import Animated from 'react-native-reanimated';
import GlassLayer from './GlassLayer';
import { useBottomSheet } from './surfaces/bottomSheet';
import { Ionicons } from './icons/Ionicons';
import { COVER_GRADIENTS, CoverGradientView } from '../theme/covers';
import { useSoft } from '../theme/soft';
import { SOFT_MEDIUM, SOFT_REGULAR, SOFT_SEMIBOLD } from '../utils/fonts';
import { SHEET_FRAME } from '../constants/glass';
import {
  FONT_GLYPH_FAMILY,
  NOTE_FONT_MODES,
  NOTE_FONTS,
  type NoteFont,
  type NoteFontMode,
} from '../utils/noteFont';

// «ВИГЛЯД СТОРІНКИ» (the user, 2026-10-25, with sketches): the old window of the note's «⋯» → «Вигляд» was a dark popup that also held the
// project, the export, «Вибрати» and the delete - all of which the «⋯» menu already has. This one is only about how the page LOOKS: the
// cover, the paper's colour, and the font in three modes - «Системний» (the app's face), «Свій» (one face for the note) and «По блоках»
// (each block its own, chosen over the keyboard in the «Тт» panel; the choices stay on the blocks when the mode is left and come back to).
export default function NoteLookSheet({
  visible,
  onClose,
  coverImage,
  coverGradient,
  onCoverImage,
  onGradient,
  paperColor,
  onPaperColor,
  mode,
  onMode,
  noteFont,
  onNoteFont,
  blocksWithFont,
  blocksTotal,
}: {
  visible: boolean;
  onClose: () => void;
  coverImage: boolean;
  coverGradient: string | undefined;
  onCoverImage: () => void;
  onGradient: (id: string | undefined) => void;
  paperColor: boolean;
  onPaperColor: (on: boolean) => void;
  mode: NoteFontMode;
  onMode: (m: NoteFontMode) => void;
  noteFont: NoteFont;
  onNoteFont: (f: NoteFont) => void;
  blocksWithFont: number;
  blocksTotal: number;
}) {
  const S = useSoft();
  const b = useBottomSheet(visible, onClose);
  return (
    <GlassLayer visible={visible} onClose={onClose} intensity={60} rise={b.on}>
      <View style={[SHEET_FRAME, b.frame]} pointerEvents="box-none">
        <Animated.View style={[styles.card, { backgroundColor: S.card }, b.window, b.padBottom(14)]}>
          {b.fill}
          {b.grab}
          {b.on && <View style={{ height: 12 }} />}
          <Text style={[styles.title, { color: S.ink }]}>Вигляд сторінки</Text>
          <ScrollView style={{ flexGrow: 0 }} showsVerticalScrollIndicator={false}>
            <Text style={[styles.section, { color: S.ink3 }]}>Заставка</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.swatches}>
              <Pressable onPress={onCoverImage} style={[styles.swatch, styles.swatchAdd, { borderColor: S.ink3 }]} accessibilityLabel={coverImage ? 'Змінити зображення' : 'Додати зображення'}>
                <Ionicons name={coverImage ? 'image' : 'add'} size={22} color={S.ink2} />
              </Pressable>
              {COVER_GRADIENTS.map((g) => {
                const on = coverGradient === g.id;
                return (
                  <Pressable key={g.id} onPress={() => onGradient(on ? undefined : g.id)} style={[styles.swatch, on && { boxShadow: `0px 0px 0px 2px ${S.card}, 0px 0px 0px 4px ${S.ink}` } as never]}>
                    <CoverGradientView gradient={g} style={StyleSheet.absoluteFill} />
                  </Pressable>
                );
              })}
            </ScrollView>

            <View style={styles.line}>
              <Text style={[styles.lineLabel, { color: S.ink }]}>Колір паперу</Text>
              <Switch value={paperColor} onValueChange={onPaperColor} />
            </View>

            <Text style={[styles.section, { color: S.ink3, marginTop: 4 }]}>Шрифт</Text>
            <View style={[styles.seg, { backgroundColor: S.fill }]}>
              {NOTE_FONT_MODES.map((m) => {
                const on = m.id === mode;
                return (
                  <Pressable key={m.id} onPress={() => onMode(m.id)} style={[styles.segItem, on && { backgroundColor: S.card, boxShadow: S.shadow } as never]}>
                    <Text style={[styles.segLabel, { color: on ? S.ink : S.ink3, fontFamily: on ? SOFT_SEMIBOLD : SOFT_MEDIUM }]}>{m.label}</Text>
                  </Pressable>
                );
              })}
            </View>
            {mode === 'system' ? (
              <Text style={[styles.hint, { color: S.ink2 }]}>Шрифт застосунку (з налаштувань). Свій шрифт нотатки й шрифти блоків збережені: вони знову запрацюють, коли оберете «Свій» чи «По блоках».</Text>
            ) : (
              <View style={styles.faces}>
                {NOTE_FONTS.map((f) => {
                  const on = f.id === noteFont;
                  return (
                    <Pressable key={f.id} onPress={() => onNoteFont(f.id)} style={[styles.face, { backgroundColor: on ? S.card : S.fill }, on && { boxShadow: `inset 0px 0px 0px 2px ${S.ink}` } as never]}>
                      <Text style={[styles.faceAa, { color: S.ink, fontFamily: FONT_GLYPH_FAMILY[f.id], fontSize: f.id === 'hand' ? 34 : 26 }]}>Аа</Text>
                      <Text style={[styles.faceName, { color: S.ink2 }]} numberOfLines={1}>
                        {f.id === 'default' ? 'Системний' : f.label}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            )}
            {mode === 'blocks' && (
              <Text style={[styles.hint, { color: S.ink2 }]}>
                Шрифт блока обираєш над клавіатурою, у панелі «Тт». Блок без свого вибору бере шрифт вище. Зараз свій шрифт мають блоків: {blocksWithFont} з {blocksTotal}.
              </Text>
            )}
          </ScrollView>
        </Animated.View>
      </View>
    </GlassLayer>
  );
}

const styles = StyleSheet.create({
  card: { width: '100%', maxWidth: 480, maxHeight: '86%', borderRadius: 28, paddingTop: 18, paddingHorizontal: 18 },
  title: { fontSize: 21, fontFamily: SOFT_SEMIBOLD, letterSpacing: -0.3, marginBottom: 6 },
  section: { fontSize: 12, fontFamily: SOFT_SEMIBOLD, letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 10, marginBottom: 8 },
  swatches: { gap: 8, paddingBottom: 4, paddingRight: 8 },
  swatch: { width: 46, height: 46, borderRadius: 14, overflow: 'hidden' },
  swatchAdd: { borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  line: { flexDirection: 'row', alignItems: 'center', height: 52 },
  lineLabel: { flex: 1, fontSize: 16, fontFamily: SOFT_MEDIUM },
  seg: { flexDirection: 'row', borderRadius: 16, padding: 3, gap: 2 },
  segItem: { flex: 1, alignItems: 'center', justifyContent: 'center', height: 38, borderRadius: 13 },
  segLabel: { fontSize: 14 },
  faces: { flexDirection: 'row', gap: 8, marginTop: 10 },
  face: { flex: 1, borderRadius: 16, paddingTop: 10, paddingBottom: 8, alignItems: 'center' },
  faceAa: { lineHeight: 36 },
  faceName: { fontSize: 11.5, fontFamily: SOFT_MEDIUM, marginTop: 2 },
  hint: { fontSize: 13.5, lineHeight: 19, fontFamily: SOFT_REGULAR, marginTop: 10, marginBottom: 4 },
});
