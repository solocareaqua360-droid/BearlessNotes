import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import GlassLayer from './GlassLayer';
import GradientSlider from './GradientSlider';
import ColorWheel from './ColorWheel';
import { useLift } from '../theme/ThemeProvider';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { GLASS_BODY_BLURRED, GLASS_EDGE, GLASS_TEXT, GLASS_TEXT_MUTED, SHEET_FRAME, SHEET_WINDOW } from '../constants/glass';
import { hexToHsl, hslToHex, toneCorrectedLightness } from '../utils/color';
import type { SchemeKind } from '../theme/scheme';

// Picking a gradient the way Paletton does: one base hue dragged around
// a wheel, and the rest of the stops follow it by a SCHEME rather than
// being chosen one at a time. The user's own ask, and their own two
// answers when asked how far to take it - every stop keeps its own
// saturation and lightness ("хочу керувати ними"), and this replaces
// the per-stop picker rather than sitting beside it ("хочу тільки цей
// новий спосіб").

// Declared with the theme rather than here: the same four families now
// also drive the whole interface's colour (themeFromScheme), and one
// list of them is the point.
export type { SchemeKind };

const SCHEMES: { id: SchemeKind; label: string; offsets: number[] }[] = [
  // Four offsets each, used up to whatever the stop count is. A scheme
  // with fewer real angles than stops repeats them deliberately - that
  // is what the per-stop lightness is FOR: two stops on the same hue at
  // different lightness is how Paletton's own extra swatches work.
  { id: 'complementary', label: 'Компліментарна', offsets: [0, 180, 0, 180] },
  { id: 'split', label: 'Роздільна', offsets: [0, 150, 210, 150] },
  { id: 'triad', label: 'Триада', offsets: [0, 120, 240, 120] },
  { id: 'square', label: 'Тетрадна', offsets: [0, 90, 180, 270] },
  { id: 'analogous', label: 'Аналогова', offsets: [0, 30, -30, 60] },
  { id: 'mono', label: 'Монохромна', offsets: [0, 0, 0, 0] },
];

// How far a single stop may step from the shared tone. Small on
// purpose: enough for a gradient to travel light-to-dark, not enough
// for one stop to leave the family.
const DEV_LIMIT = 20;
const clampDev = (v: number) => Math.max(-DEV_LIMIT, Math.min(DEV_LIMIT, Math.round(v)));

export default function ColorSchemeSheet({
  visible,
  initialColors,
  onCancel,
  onSave,
}: {
  visible: boolean;
  initialColors: string[];
  onCancel: () => void;
  onSave: (colors: string[]) => void;
}) {
  const lift = useLift();
  const [scheme, setScheme] = useState<SchemeKind>('complementary');
  const [baseHue, setBaseHue] = useState(205);
  const [count, setCount] = useState(2);
  // ONE tone for the whole scheme, not one per stop. The user's own
  // read, and it is right: "насиченість та світлота повинні бути
  // пов'язані... інакше гармонія рушиться" - free per-stop values are
  // the hole through which a set stops being a family and becomes
  // random colours.
  const [tone, setTone] = useState({ s: 70, l: 52 });
  // What is left per stop, and all that is: how much LIGHTER or darker
  // this one sits than the shared tone, clamped hard. A gradient needs
  // that travel or it reads flat and muddy where two stops meet (the
  // same "light goes one way" the canvas ladder settled on) - but
  // bounded, so it can never wander out of the family.
  const [dev, setDev] = useState<number[]>([0, -12, 12, -20]);
  const [selected, setSelected] = useState(0);

  // Opening on whatever the gradient already is: its first colour sets
  // the base hue, and every stop keeps its own saturation/lightness, so
  // the wheel starts from the picture on screen rather than a default.
  useEffect(() => {
    if (!visible || initialColors.length === 0) return;
    const parsed = initialColors.map(hexToHsl);
    setBaseHue(parsed[0].h);
    setCount(Math.max(2, Math.min(4, parsed.length)));
    // The tone is what the existing stops AVERAGE to; each stop's own
    // distance from that average becomes its deviation, clamped. So
    // reopening on a gradient made before this model keeps the picture
    // on screen instead of jumping to a default.
    const avgS = Math.round(parsed.reduce((sum, c) => sum + c.s, 0) / parsed.length);
    const avgL = Math.round(parsed.reduce((sum, c) => sum + c.l, 0) / parsed.length);
    setTone({ s: avgS, l: avgL });
    setDev((prev) => prev.map((old, i) => (parsed[i] ? clampDev(parsed[i].l - avgL) : old)));
    setSelected(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const offsets = SCHEMES.find((s) => s.id === scheme)!.offsets;
  const hueAt = (i: number) => ((baseHue + offsets[i]) % 360 + 360) % 360;
  // Shared saturation, shared lightness, the stop's own small step, and
  // then the per-hue correction that makes "one tone" true to the eye
  // rather than only to the numbers - see toneCorrectedLightness.
  const colorAt = (i: number) =>
    hslToHex(hueAt(i), tone.s, toneCorrectedLightness(hueAt(i), tone.l + dev[i]));
  const colors = Array.from({ length: count }, (_, i) => colorAt(i));

  function setDeviation(next: number) {
    setDev((prev) => prev.map((v, i) => (i === selected ? clampDev(next) : v)));
  }

  const pureHue = hslToHex(hueAt(selected), 100, 50);

  return (
    <GlassLayer visible={visible} onClose={onCancel} intensity={60}>
      <View style={SHEET_FRAME} pointerEvents="box-none">
        <View style={[styles.card, lift]}>
          <Text style={styles.title}>Схема кольорів</Text>

          {/* Scrolls, and the buttons below it do NOT - the wheel plus
              four scheme chips plus three sliders is taller than a
              phone, and without this the whole footer sat off the
              bottom of the screen: "я не бачу кнопки застосування". */}
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
          <View style={styles.wheelWrap}>
            {/* Every stop as a dot ON the ring, at its own hue - the
                whole point of a wheel over a strip is seeing the
                angles between them at a glance. */}
            <ColorWheel
              dots={colors.map((c, i) => ({ hue: hueAt(i), color: c, active: i === selected }))}
              onHue={setBaseHue}
            />
          </View>

          <View style={styles.schemeRow}>
            {SCHEMES.map((s) => (
              <Pressable
                key={s.id}
                style={[styles.schemeChip, scheme === s.id && styles.schemeChipOn]}
                onPress={() => setScheme(s.id)}
              >
                <Text style={[styles.schemeLabel, scheme === s.id && styles.schemeLabelOn]} numberOfLines={1}>
                  {s.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {/* The gradient as it will actually be, not a row of separate
              swatches - this is what the screen gets. */}
          <Svg width="100%" height={26} style={styles.preview}>
            <Defs>
              <LinearGradient id="schemePreview" x1="0" y1="0" x2="1" y2="0">
                {colors.map((c, i) => (
                  <Stop key={i} offset={colors.length > 1 ? i / (colors.length - 1) : 0} stopColor={c} />
                ))}
              </LinearGradient>
            </Defs>
            <Rect width="100%" height={26} rx={8} fill="url(#schemePreview)" />
          </Svg>

          <View style={styles.stopsRow}>
            {colors.map((c, i) => (
              <Pressable key={i} onPress={() => setSelected(i)}>
                <View style={[styles.stopSwatch, { backgroundColor: c }, i === selected && styles.stopSwatchOn]} />
              </Pressable>
            ))}
            <Pressable
              style={[styles.countButton, count >= 4 && styles.countButtonOff]}
              disabled={count >= 4}
              onPress={() => setCount((n) => Math.min(4, n + 1))}
            >
              <Text style={styles.countLabel}>+</Text>
            </Pressable>
            <Pressable
              style={[styles.countButton, count <= 2 && styles.countButtonOff]}
              disabled={count <= 2}
              onPress={() => {
                setCount((n) => Math.max(2, n - 1));
                setSelected((i) => Math.min(i, count - 2));
              }}
            >
              <Text style={styles.countLabel}>−</Text>
            </Pressable>
          </View>

          {/* TWO shared sliders, one per-stop. The tone belongs to the
              whole scheme; only the step away from it is the single
              colour's own. */}
          <Text style={styles.label}>Насиченість схеми</Text>
          <GradientSlider
            value={tone.s / 100}
            stops={[hslToHex(hueAt(0), 0, tone.l), hslToHex(hueAt(0), 100, tone.l)]}
            onChange={(v) => setTone((t) => ({ ...t, s: Math.round(v * 100) }))}
          />

          <Text style={styles.label}>Світлота схеми</Text>
          <GradientSlider
            value={tone.l / 100}
            stops={['#000000', pureHue, '#FFFFFF']}
            onChange={(v) => setTone((t) => ({ ...t, l: Math.round(v * 100) }))}
          />

          <Text style={styles.label}>
            Колір {selected + 1}: {dev[selected] > 0 ? `світліший на ${dev[selected]}` : dev[selected] < 0 ? `темніший на ${-dev[selected]}` : 'за тоном схеми'}
          </Text>
          <GradientSlider
            value={(dev[selected] + DEV_LIMIT) / (DEV_LIMIT * 2)}
            stops={[
              hslToHex(hueAt(selected), tone.s, toneCorrectedLightness(hueAt(selected), tone.l - DEV_LIMIT)),
              hslToHex(hueAt(selected), tone.s, toneCorrectedLightness(hueAt(selected), tone.l + DEV_LIMIT)),
            ]}
            onChange={(v) => setDeviation(v * DEV_LIMIT * 2 - DEV_LIMIT)}
          />
          </ScrollView>

          <View style={styles.buttons}>
            <Pressable style={styles.button} onPress={onCancel}>
              <Text style={styles.buttonLabel}>Скасувати</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.buttonPrimary]} onPress={() => onSave(colors)}>
              <Text style={[styles.buttonLabel, styles.buttonLabelPrimary]}>Застосувати</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </GlassLayer>
  );
}

const styles = StyleSheet.create({
  card: {
    ...SHEET_WINDOW,
    maxHeight: '88%',
    backgroundColor: GLASS_BODY_BLURRED,
    borderWidth: 1,
    borderColor: GLASS_EDGE,
    padding: 18,
  },
  // flexShrink, not flex:1 - the sheet is only as tall as it needs to
  // be until it hits maxHeight, and only then does the body scroll.
  body: {
    flexGrow: 0,
    flexShrink: 1,
  },
  bodyContent: {
    paddingBottom: 4,
  },
  title: {
    fontSize: 19,
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
    marginBottom: 10,
  },
  wheelWrap: {
    alignSelf: 'center',
  },
  schemeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
    marginTop: 14,
  },
  schemeChip: {
    paddingVertical: 7,
    paddingHorizontal: 10,
    borderRadius: 9,
    borderWidth: 1,
    borderColor: GLASS_EDGE,
  },
  schemeChipOn: {
    borderColor: '#F5C77E',
    backgroundColor: 'rgba(245,199,126,0.16)',
  },
  schemeLabel: {
    fontSize: 12,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT_MUTED,
  },
  schemeLabelOn: {
    color: GLASS_TEXT,
  },
  preview: {
    marginTop: 14,
  },
  stopsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 14,
  },
  stopSwatch: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.3)',
  },
  stopSwatchOn: {
    borderWidth: 3,
    borderColor: '#fff',
  },
  countButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: GLASS_EDGE,
  },
  countButtonOff: {
    opacity: 0.35,
  },
  countLabel: {
    fontSize: 16,
    color: GLASS_TEXT,
    fontFamily: FONT_SEMIBOLD,
  },
  label: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
    marginTop: 12,
    marginBottom: 6,
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 18,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: GLASS_EDGE,
  },
  buttonPrimary: {
    backgroundColor: '#F5C77E',
    borderColor: '#F5C77E',
  },
  buttonLabel: {
    fontSize: 15,
    fontFamily: FONT_SEMIBOLD,
    color: GLASS_TEXT,
  },
  buttonLabelPrimary: {
    color: '#111827',
  },
});
