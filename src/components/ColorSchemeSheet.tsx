import { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Defs, LinearGradient, Path, Rect, Stop } from 'react-native-svg';
import GlassLayer from './GlassLayer';
import GradientSlider from './GradientSlider';
import { useLift } from '../theme/ThemeProvider';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { GLASS_BODY_BLURRED, GLASS_EDGE, GLASS_TEXT, GLASS_TEXT_MUTED, SHEET_FRAME, SHEET_WINDOW } from '../constants/glass';
import { hexToHsl, hslToHex } from '../utils/color';

// Picking a gradient the way Paletton does: one base hue dragged around
// a wheel, and the rest of the stops follow it by a SCHEME rather than
// being chosen one at a time. The user's own ask, and their own two
// answers when asked how far to take it - every stop keeps its own
// saturation and lightness ("хочу керувати ними"), and this replaces
// the per-stop picker rather than sitting beside it ("хочу тільки цей
// новий спосіб").

export type SchemeKind = 'complementary' | 'triad' | 'analogous' | 'mono';

const SCHEMES: { id: SchemeKind; label: string; offsets: number[] }[] = [
  // Four offsets each, used up to whatever the stop count is. A scheme
  // with fewer real angles than stops repeats them deliberately - that
  // is what the per-stop lightness is FOR: two stops on the same hue at
  // different lightness is how Paletton's own extra swatches work.
  { id: 'complementary', label: 'Компліментарна', offsets: [0, 180, 0, 180] },
  { id: 'triad', label: 'Триада', offsets: [0, 120, 240, 120] },
  { id: 'analogous', label: 'Аналогова', offsets: [0, 30, -30, 60] },
  { id: 'mono', label: 'Монохромна', offsets: [0, 0, 0, 0] },
];

const WHEEL = 220;
const RING_OUTER = WHEEL / 2;
const RING_INNER = WHEEL / 2 - 26;
// One wedge every 5 degrees: fine enough that the ring reads as a
// continuous spectrum, coarse enough that it is 72 paths and not 360.
const WEDGE = 5;

function wedgePath(startDeg: number, endDeg: number): string {
  const c = WHEEL / 2;
  const toXY = (deg: number, r: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [c + r * Math.cos(rad), c + r * Math.sin(rad)];
  };
  const [x1, y1] = toXY(startDeg, RING_OUTER);
  const [x2, y2] = toXY(endDeg, RING_OUTER);
  const [x3, y3] = toXY(endDeg, RING_INNER);
  const [x4, y4] = toXY(startDeg, RING_INNER);
  return `M ${x1} ${y1} A ${RING_OUTER} ${RING_OUTER} 0 0 1 ${x2} ${y2} L ${x3} ${y3} A ${RING_INNER} ${RING_INNER} 0 0 0 ${x4} ${y4} Z`;
}

const RING = Array.from({ length: 360 / WEDGE }, (_, i) => ({
  d: wedgePath(i * WEDGE, (i + 1) * WEDGE + 0.5),
  fill: hslToHex(i * WEDGE, 85, 55),
}));

function dotPosition(hue: number): { x: number; y: number } {
  const c = WHEEL / 2;
  const r = (RING_OUTER + RING_INNER) / 2;
  const rad = ((hue - 90) * Math.PI) / 180;
  return { x: c + r * Math.cos(rad), y: c + r * Math.sin(rad) };
}

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
  // Saturation and lightness per stop, the part the scheme does NOT
  // decide - the hues rotate together, these stay where they were put.
  const [sl, setSl] = useState<{ s: number; l: number }[]>([
    { s: 70, l: 55 },
    { s: 70, l: 45 },
    { s: 60, l: 65 },
    { s: 55, l: 35 },
  ]);
  const [selected, setSelected] = useState(0);

  // Opening on whatever the gradient already is: its first colour sets
  // the base hue, and every stop keeps its own saturation/lightness, so
  // the wheel starts from the picture on screen rather than a default.
  useEffect(() => {
    if (!visible || initialColors.length === 0) return;
    const parsed = initialColors.map(hexToHsl);
    setBaseHue(parsed[0].h);
    setCount(Math.max(2, Math.min(4, parsed.length)));
    setSl((prev) => prev.map((old, i) => (parsed[i] ? { s: parsed[i].s, l: parsed[i].l } : old)));
    setSelected(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  const offsets = SCHEMES.find((s) => s.id === scheme)!.offsets;
  const hueAt = (i: number) => ((baseHue + offsets[i]) % 360 + 360) % 360;
  const colors = Array.from({ length: count }, (_, i) => hslToHex(hueAt(i), sl[i].s, sl[i].l));

  // Dragging anywhere on the wheel turns the WHOLE scheme: the angle
  // under the finger becomes the base hue and every other stop keeps
  // its offset from it. That is the thing a wheel is for - the
  // relationships hold while the whole set rotates.
  const setHueFromTouch = useRef((x: number, y: number) => {});
  setHueFromTouch.current = (x: number, y: number) => {
    const c = WHEEL / 2;
    const deg = (Math.atan2(y - c, x - c) * 180) / Math.PI + 90;
    setBaseHue(Math.round(((deg % 360) + 360) % 360));
  };
  const wheelResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: (e) => setHueFromTouch.current(e.nativeEvent.locationX, e.nativeEvent.locationY),
      onPanResponderMove: (e) => setHueFromTouch.current(e.nativeEvent.locationX, e.nativeEvent.locationY),
    })
  ).current;

  function setStop(patch: Partial<{ s: number; l: number }>) {
    setSl((prev) => prev.map((v, i) => (i === selected ? { ...v, ...patch } : v)));
  }

  const current = sl[selected];
  const pureHue = hslToHex(hueAt(selected), 100, 50);

  return (
    <GlassLayer visible={visible} onClose={onCancel} intensity={60}>
      <View style={SHEET_FRAME} pointerEvents="box-none">
        <View style={[styles.card, lift]}>
          <Text style={styles.title}>Схема кольорів</Text>

          <View style={styles.wheelWrap} {...wheelResponder.panHandlers}>
            <Svg width={WHEEL} height={WHEEL}>
              {RING.map((w, i) => (
                <Path key={i} d={w.d} fill={w.fill} />
              ))}
              {/* Every stop as a dot ON the ring, at its own hue - the
                  whole point of a wheel over a strip is seeing the
                  angles between them at a glance. */}
              {colors.map((c, i) => {
                const p = dotPosition(hueAt(i));
                return (
                  <Circle
                    key={i}
                    cx={p.x}
                    cy={p.y}
                    r={i === selected ? 11 : 8}
                    fill={c}
                    stroke={i === selected ? '#fff' : 'rgba(0,0,0,0.45)'}
                    strokeWidth={i === selected ? 3 : 1.5}
                  />
                );
              })}
            </Svg>
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

          <Text style={styles.label}>Насиченість (колір {selected + 1})</Text>
          <GradientSlider
            value={current.s / 100}
            stops={[hslToHex(hueAt(selected), 0, current.l), pureHue]}
            onChange={(v) => setStop({ s: Math.round(v * 100) })}
          />

          <Text style={styles.label}>Світлота (колір {selected + 1})</Text>
          <GradientSlider
            value={current.l / 100}
            stops={['#000000', pureHue, '#FFFFFF']}
            onChange={(v) => setStop({ l: Math.round(v * 100) })}
          />

          <View style={styles.buttons}>
            <Pressable style={styles.button} onPress={onCancel}>
              <Text style={styles.buttonLabel}>Скасувати</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.buttonPrimary]} onPress={() => onSave(colors)}>
              <Text style={[styles.buttonLabel, styles.buttonLabelPrimary]}>Зберегти</Text>
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
    backgroundColor: GLASS_BODY_BLURRED,
    borderWidth: 1,
    borderColor: GLASS_EDGE,
    padding: 18,
  },
  title: {
    fontSize: 19,
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
    marginBottom: 10,
  },
  wheelWrap: {
    width: WHEEL,
    height: WHEEL,
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
