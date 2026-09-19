import { useEffect, useRef, useState } from 'react';
import { PanResponder, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Svg, { Defs, LinearGradient, Rect, Stop } from 'react-native-svg';
import GlassLayer from './GlassLayer';
import { useLift } from '../theme/ThemeProvider';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { GLASS_BODY_BLURRED, GLASS_EDGE, GLASS_TEXT, GLASS_TEXT_MUTED, SHEET_FRAME, SHEET_WINDOW } from '../constants/glass';
import { hexToHsl, hslToHex, isValidHex } from '../utils/color';
import { useKeyboardHeight } from '../hooks/useKeyboardHeight';

// "мені треба і числовий ввід кольору і повзунком вибрати" - a proper
// picker, not the hex-only field this replaces. Three sliders (hue,
// saturation, lightness) and a hex field that both read and write the
// SAME colour, so a drag and a typed value never disagree.

// One slider, its track painted as a gradient of whatever colours the
// caller hands it - a rainbow strip for hue, grey-to-colour for
// saturation, black-to-colour-to-white for lightness. Same touch-to-
// value mapping BlurSlider (Settings) uses; this is the general version
// it was always going to need a second caller to justify.
function GradientSlider({
  value,
  stops,
  onChange,
}: {
  // 0 to 1.
  value: number;
  // 2 or more CSS colours, evenly spaced across the track.
  stops: string[];
  onChange: (v: number) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (e) => {
        if (trackWidth <= 0) return;
        const x = e.nativeEvent.locationX;
        onChange(Math.max(0, Math.min(1, x / trackWidth)));
      },
    })
  ).current;
  return (
    <View
      style={styles.sliderTrack}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      {...responder.panHandlers}
    >
      {trackWidth > 0 && (
        <Svg width={trackWidth} height={28} style={StyleSheet.absoluteFill}>
          <Defs>
            <LinearGradient id="track" x1="0" y1="0" x2="1" y2="0">
              {stops.map((c, i) => (
                <Stop key={i} offset={i / (stops.length - 1)} stopColor={c} />
              ))}
            </LinearGradient>
          </Defs>
          <Rect width={trackWidth} height={28} rx={14} fill="url(#track)" />
        </Svg>
      )}
      <View pointerEvents="none" style={[styles.sliderThumb, { left: `${value * 100}%` }]} />
    </View>
  );
}

export default function ColorPickerSheet({
  visible,
  initialColor,
  title = 'Колір',
  onCancel,
  onSave,
}: {
  visible: boolean;
  initialColor: string;
  title?: string;
  onCancel: () => void;
  onSave: (hex: string) => void;
}) {
  const lift = useLift();
  const keyboardHeight = useKeyboardHeight();
  const [hsl, setHsl] = useState(() => hexToHsl(initialColor));
  const [hexText, setHexText] = useState(initialColor.toUpperCase());
  // The hex field is the odd one out - a slider drag always describes a
  // valid colour, but a hex field is being typed one character at a
  // time, and "#7" is not a colour yet. So sliders write straight into
  // `hsl`; the hex field only writes back once a full, valid value has
  // actually been typed.
  useEffect(() => {
    if (!visible) return;
    const h = hexToHsl(initialColor);
    setHsl(h);
    setHexText(initialColor.toUpperCase());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible, initialColor]);

  const hex = hslToHex(hsl.h, hsl.s, hsl.l);

  function setFromSlider(next: Partial<typeof hsl>) {
    const merged = { ...hsl, ...next };
    setHsl(merged);
    setHexText(hslToHex(merged.h, merged.s, merged.l));
  }

  function setFromHexInput(value: string) {
    const withHash = value.startsWith('#') ? value : `#${value}`;
    setHexText(withHash.toUpperCase());
    if (isValidHex(withHash)) setHsl(hexToHsl(withHash));
  }

  // The saturation and lightness tracks are drawn AT this hue - dragging
  // hue while looking at either one shows exactly what will happen to
  // the colour, not a generic rainbow that has nothing to do with it.
  const pureHue = hslToHex(hsl.h, 100, 50);

  return (
    <GlassLayer visible={visible} onClose={onCancel} intensity={60}>
      <View style={[SHEET_FRAME, { paddingBottom: keyboardHeight }]} pointerEvents="box-none">
        <View style={[styles.card, lift]}>
          <Text style={styles.title}>{title}</Text>

          <View style={styles.previewRow}>
            <View style={[styles.swatch, { backgroundColor: hex }]} />
            <TextInput
              value={hexText}
              onChangeText={setFromHexInput}
              placeholder="#RRGGBB"
              placeholderTextColor={GLASS_TEXT_MUTED}
              autoCapitalize="characters"
              autoCorrect={false}
              maxLength={7}
              style={styles.hexInput}
            />
          </View>

          <Text style={styles.label}>Відтінок</Text>
          <GradientSlider
            value={hsl.h / 360}
            stops={['#FF0000', '#FFFF00', '#00FF00', '#00FFFF', '#0000FF', '#FF00FF', '#FF0000']}
            onChange={(v) => setFromSlider({ h: Math.round(v * 360) })}
          />

          <Text style={styles.label}>Насиченість</Text>
          <GradientSlider
            value={hsl.s / 100}
            stops={[hslToHex(hsl.h, 0, hsl.l), pureHue]}
            onChange={(v) => setFromSlider({ s: Math.round(v * 100) })}
          />

          <Text style={styles.label}>Світлота</Text>
          <GradientSlider
            value={hsl.l / 100}
            stops={['#000000', pureHue, '#FFFFFF']}
            onChange={(v) => setFromSlider({ l: Math.round(v * 100) })}
          />

          <View style={styles.buttons}>
            <Pressable style={styles.button} onPress={onCancel}>
              <Text style={styles.buttonLabel}>Скасувати</Text>
            </Pressable>
            <Pressable style={[styles.button, styles.buttonPrimary]} onPress={() => onSave(hex)}>
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
    padding: 20,
    gap: 4,
  },
  title: {
    fontSize: 19,
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
    marginBottom: 10,
  },
  previewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 16,
  },
  swatch: {
    width: 44,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: GLASS_EDGE,
  },
  hexInput: {
    flex: 1,
    height: 44,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: GLASS_EDGE,
    paddingHorizontal: 12,
    color: GLASS_TEXT,
    fontFamily: FONT_SEMIBOLD,
    fontSize: 16,
    letterSpacing: 1,
  },
  label: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
    marginTop: 10,
    marginBottom: 6,
  },
  sliderTrack: {
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
  },
  sliderThumb: {
    position: 'absolute',
    top: -2,
    width: 4,
    height: 32,
    marginLeft: -2,
    borderRadius: 2,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: 'rgba(0,0,0,0.4)',
  },
  buttons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 20,
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
