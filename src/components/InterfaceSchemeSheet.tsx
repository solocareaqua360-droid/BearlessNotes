import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import type { Theme } from '../theme/tokens';
import GlassLayer from './GlassLayer';
import GradientSlider from './GradientSlider';
import ColorWheel from './ColorWheel';
import { useLift, useStyles } from '../theme/ThemeProvider';
import {
  DEFAULT_SCHEME,
  SCHEME_LUM_RANGE,
  SCHEME_SAT_RANGE,
  themeFromScheme,
  type ColourScheme,
  type SchemeKind,
} from '../theme/scheme';
import { hslToHex } from '../utils/color';
import { contrastTextColor } from '../utils/documentColor';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { SHEET_FRAME } from '../constants/glass';

// Picking the colour of the WHOLE interface, not of a gradient.
//
// Deliberately a small set of controls: a wheel, four harmonies, two
// sliders. Everything else - which surface is how light, which section
// gets which hue, what colour the ink on a button has to be - is
// decided by themeFromScheme and is not reachable from here. That is
// the design, not a shortcut: ugliness comes from unvetted
// combinations of independent knobs, so there are only three knobs and
// they are all clamped.
//
// The strip at the bottom is the honest part. It draws the ground, the
// accent and all eleven section colours the scheme ACTUALLY produces,
// straight out of themeFromScheme, so what is previewed is what is
// applied.

const SCHEMES: { id: SchemeKind; label: string; anchors: number[] }[] = [
  { id: 'complementary', label: 'Компліментарна', anchors: [0, 180] },
  { id: 'split', label: 'Роздільна', anchors: [0, 150, 210] },
  { id: 'triad', label: 'Триада', anchors: [0, 120, 240] },
  { id: 'square', label: 'Тетрадна', anchors: [0, 90, 180, 270] },
  { id: 'analogous', label: 'Аналогова', anchors: [0, 30, -30, 60] },
  { id: 'mono', label: 'Монохромна', anchors: [0] },
];

const range = (v: number, [lo, hi]: [number, number]) => (v - lo) / (hi - lo);
const unrange = (t: number, [lo, hi]: [number, number]) => Math.round(lo + t * (hi - lo));

export default function InterfaceSchemeSheet({
  visible,
  initial,
  onCancel,
  onSave,
  onReset,
}: {
  visible: boolean;
  initial: ColourScheme | null;
  onCancel: () => void;
  onSave: (scheme: ColourScheme) => void;
  // Back to the theme as it ships - a separate answer from cancelling,
  // which is why it is its own button: "хотілось би кнопку застосувати
  // і повернутись до стандартного".
  onReset: () => void;
}) {
  const styles = useStyles(makeStyles);
  const lift = useLift();
  const [scheme, setScheme] = useState<ColourScheme>(initial ?? DEFAULT_SCHEME);

  // Opens on what is applied right now, not on a default - the same
  // rule the gradient picker follows.
  useEffect(() => {
    if (visible) setScheme(initial ?? DEFAULT_SCHEME);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const anchors = SCHEMES.find((s) => s.id === scheme.kind)!.anchors;
  const preview = themeFromScheme(scheme);
  const sections = Object.values(preview.sections);

  return (
    <GlassLayer visible={visible} onClose={onCancel} intensity={60}>
      <View style={SHEET_FRAME} pointerEvents="box-none">
        <View style={[styles.card, lift]}>
          <Text style={styles.title}>Кольори інтерфейсу</Text>

          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <View style={styles.wheelWrap}>
              <ColorWheel
                dots={anchors.map((a, i) => ({
                  hue: ((scheme.hue + a) % 360 + 360) % 360,
                  color: hslToHex(((scheme.hue + a) % 360 + 360) % 360, scheme.sat, scheme.lum),
                  active: i === 0,
                }))}
                onHue={(hue) => setScheme((s) => ({ ...s, hue }))}
              />
            </View>

            <View style={styles.schemeRow}>
              {SCHEMES.map((s) => (
                <Pressable
                  key={s.id}
                  style={[styles.schemeChip, scheme.kind === s.id && styles.schemeChipOn]}
                  onPress={() => setScheme((prev) => ({ ...prev, kind: s.id }))}
                >
                  <Text
                    style={[styles.schemeLabel, scheme.kind === s.id && styles.schemeLabelOn]}
                    numberOfLines={1}
                    adjustsFontSizeToFit
                  >
                    {s.label}
                  </Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.sliderLabel}>Насиченість</Text>
            <GradientSlider
              value={range(scheme.sat, SCHEME_SAT_RANGE)}
              stops={[
                hslToHex(scheme.hue, SCHEME_SAT_RANGE[0], scheme.lum),
                hslToHex(scheme.hue, SCHEME_SAT_RANGE[1], scheme.lum),
              ]}
              onChange={(t) => setScheme((s) => ({ ...s, sat: unrange(t, SCHEME_SAT_RANGE) }))}
            />

            <Text style={styles.sliderLabel}>Світлота акценту</Text>
            <GradientSlider
              value={range(scheme.lum, SCHEME_LUM_RANGE)}
              stops={[
                hslToHex(scheme.hue, scheme.sat, SCHEME_LUM_RANGE[0]),
                hslToHex(scheme.hue, scheme.sat, SCHEME_LUM_RANGE[1]),
              ]}
              onChange={(t) => setScheme((s) => ({ ...s, lum: unrange(t, SCHEME_LUM_RANGE) }))}
            />

            {/* What the scheme actually builds, drawn on its own
                ground. The eleven chips are the sections in the order
                the scheme hands hues out, so the effect of switching
                harmony is visible before it is applied. */}
            <Text style={styles.sliderLabel}>Що вийде</Text>
            <View style={[styles.preview, { backgroundColor: preview.ground }]}>
              <View style={[styles.previewAccent, { backgroundColor: preview.accent }]}>
                <Text style={[styles.previewAccentLabel, { color: preview.onAccent }]}>Акцент</Text>
              </View>
              <View style={styles.previewChips}>
                {sections.map((c) => (
                  <View key={c} style={[styles.previewChip, { backgroundColor: c }]} />
                ))}
              </View>
              {/* The card fills, drawn as cards rather than as chips:
                  they are the largest colour masses in the app and the
                  only honest way to judge them is at something like
                  their real size, with their own ink on them. */}
              <View style={styles.previewCards}>
                {preview.cards.map((c) => (
                  <View key={c} style={[styles.previewCard, { backgroundColor: c }]}>
                    <Text style={[styles.previewCardLabel, { color: contrastTextColor(c) }]}>Аа</Text>
                  </View>
                ))}
              </View>
            </View>
            <Text style={styles.hint}>
              Світлота поверхонь не змінюється - її задає тема, а не повзунки. Ви обираєте, де на
              колі стоїть застосунок; читабельність перевіряється автоматично.
            </Text>
          </ScrollView>

          <View style={styles.footer}>
            <Pressable style={styles.footerButton} onPress={onReset}>
              <Text style={styles.footerLabel}>Стандартна</Text>
            </Pressable>
            <Pressable style={styles.footerButton} onPress={onCancel}>
              <Text style={styles.footerLabel}>Скасувати</Text>
            </Pressable>
            <Pressable style={[styles.footerButton, styles.footerPrimary]} onPress={() => onSave(scheme)}>
              <Text style={[styles.footerLabel, styles.footerPrimaryLabel]}>Застосувати</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </GlassLayer>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  card: {
    width: '100%',
    maxWidth: 420,
    maxHeight: '86%',
    borderRadius: 26,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.edge.hairline,
    paddingTop: 18,
    paddingBottom: 14,
    paddingHorizontal: 18,
  },
  title: { fontFamily: FONT_BOLD, fontSize: 18, color: t.ink.primary, marginBottom: 12 },
  body: { flexGrow: 0 },
  bodyContent: { paddingBottom: 12 },
  wheelWrap: { alignItems: 'center', marginBottom: 14 },
  // Two rows of three: six harmonies do not fit across a phone at a
  // readable size, and shrinking the type further is not a trade worth
  // making for one row.
  schemeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 16 },
  schemeChip: {
    flexBasis: '31%',
    flexGrow: 1,
    paddingVertical: 8,
    paddingHorizontal: 4,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.edge.hairline,
    alignItems: 'center',
  },
  schemeChipOn: { backgroundColor: 'rgba(255,255,255,0.14)' },
  schemeLabel: { fontFamily: FONT_REGULAR, fontSize: 11, color: t.ink.muted },
  schemeLabelOn: { fontFamily: FONT_SEMIBOLD, color: t.ink.primary },
  sliderLabel: {
    fontFamily: FONT_SEMIBOLD,
    fontSize: 12,
    color: t.ink.muted,
    marginBottom: 6,
    marginTop: 4,
  },
  preview: { borderRadius: 16, padding: 12, gap: 10, marginTop: 2 },
  previewAccent: { alignSelf: 'flex-start', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 7 },
  previewAccentLabel: { fontFamily: FONT_SEMIBOLD, fontSize: 13 },
  previewChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  previewChip: { width: 26, height: 26, borderRadius: 8 },
  previewCards: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  previewCard: { width: 46, height: 34, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  previewCardLabel: { fontFamily: FONT_SEMIBOLD, fontSize: 12 },
  hint: { fontFamily: FONT_REGULAR, fontSize: 11, color: t.ink.muted, lineHeight: 16, marginTop: 10 },
  footer: {
    flexDirection: 'row',
    gap: 8,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: t.edge.hairline,
  },
  footerButton: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: 13,
    alignItems: 'center',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: t.edge.hairline,
  },
  footerPrimary: { backgroundColor: 'rgba(255,255,255,0.16)' },
  footerLabel: { fontFamily: FONT_SEMIBOLD, fontSize: 13, color: t.ink.muted },
  footerPrimaryLabel: { color: t.ink.primary },
});
