import { useEffect, useState } from 'react';
import { ActivityIndicator, Keyboard, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import GlassLayer from './GlassLayer';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { SHEET_FRAME, SHEET_WINDOW } from '../constants/glass';
import { extractMapsCoordinates, isMapsUrl } from '../utils/linkPreview';
import {
  formatDecimalLatLng,
  formatMgrs,
  isValidLatLng,
  LatLng,
  mapsUrlForLatLng,
  parseDecimalLatLng,
  parseMgrs,
} from '../utils/geoCoordinates';

type Mode = 'url' | 'decimal' | 'mgrs';

// A geoточка entered by hand, in whichever of the three languages a point
// gets written in - a Maps link, plain decimal degrees, or MGRS - the
// user's own requirement: all three from day one, and picking one fills
// the other two rather than asking three separate questions for one
// point.
//
// One canonical value (`point`, plain lat/lng - see utils/geoCoordinates)
// underneath all three fields. The segmented control at the top says
// which field is EDITABLE right now; the other two are read-only,
// recomputed from `point` on every change to whichever one is live. A
// mode switch never clears what was already entered - it only changes
// which field responds to typing.
export default function GeoPointEntrySheet({
  visible,
  onCancel,
  onSave,
}: {
  visible: boolean;
  onCancel: () => void;
  onSave: (params: { title: string; point: LatLng }) => void;
}) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const [title, setTitle] = useState('');
  const [mode, setMode] = useState<Mode>('decimal');
  const [point, setPoint] = useState<LatLng | null>(null);
  // The field being typed into keeps its own raw text, independent of
  // `point` - so a half-typed, momentarily-invalid number ("55.") is not
  // wiped out from under the finger the instant it stops parsing.
  const [urlText, setUrlText] = useState('');
  const [decimalText, setDecimalText] = useState('');
  const [mgrsText, setMgrsText] = useState('');
  // The Maps URL only resolves against a network for a short "Share"
  // link (see extractMapsCoordinates) - never on every keystroke, only
  // once typing settles.
  const [resolvingUrl, setResolvingUrl] = useState(false);

  useEffect(() => {
    if (!visible) return;
    setTitle('');
    setMode('decimal');
    setPoint(null);
    setUrlText('');
    setDecimalText('');
    setMgrsText('');
    setResolvingUrl(false);
  }, [visible]);

  // Every field but the one just typed into is a MIRROR of `point` - set
  // once here, rather than at each of the three call sites, so the mirror
  // can never fall one edit behind the field that produced it.
  function applyPoint(next: LatLng | null, from: Mode) {
    setPoint(next);
    if (from !== 'decimal') setDecimalText(next ? formatDecimalLatLng(next) : '');
    if (from !== 'mgrs') setMgrsText(next ? (formatMgrs(next) ?? '') : '');
    if (from !== 'url') setUrlText(next ? mapsUrlForLatLng(next) : '');
  }

  function handleDecimalChange(text: string) {
    setDecimalText(text);
    const parsed = parseDecimalLatLng(text);
    if (parsed) applyPoint(parsed, 'decimal');
  }

  function handleMgrsChange(text: string) {
    setMgrsText(text);
    const parsed = parseMgrs(text);
    if (parsed) applyPoint(parsed, 'mgrs');
  }

  function handleUrlChange(text: string) {
    setUrlText(text);
  }

  // A URL is pasted whole, not meaningfully built up one keystroke at a
  // time the way a number is - and extractMapsCoordinates may need a
  // network round trip a short link's redirect - so this resolves once
  // typing/pasting settles rather than on every character.
  async function handleUrlBlur() {
    const url = urlText.trim();
    if (!url || !isMapsUrl(url)) return;
    setResolvingUrl(true);
    try {
      const coords = await extractMapsCoordinates(url);
      if (coords) applyPoint({ lat: coords.lat, lng: coords.lng }, 'url');
    } finally {
      setResolvingUrl(false);
    }
  }

  const canSave = !!point && isValidLatLng(point.lat, point.lng) && title.trim().length > 0;

  const [keyboardHeight, setKeyboardHeight] = useState(0);
  useEffect(() => {
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => setKeyboardHeight(e.endCoordinates.height));
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKeyboardHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  return (
    <GlassLayer visible={visible} onClose={onCancel} intensity={60}>
      <View style={styles.frame} pointerEvents="box-none">
        <View style={[styles.card, { marginBottom: keyboardHeight }]}>
          <Text style={styles.title}>Нова геоточка</Text>
          <TextInput
            value={title}
            onChangeText={setTitle}
            placeholder="Назва"
            placeholderTextColor={theme.ink.faint}
            style={styles.input}
            returnKeyType="next"
          />

          <View style={styles.modeRow}>
            {(
              [
                ['url', 'Посилання'],
                ['decimal', 'Координати'],
                ['mgrs', 'MGRS'],
              ] as [Mode, string][]
            ).map(([m, label]) => (
              <Pressable
                key={m}
                style={[styles.modeTab, mode === m && styles.modeTabActive]}
                onPress={() => setMode(m)}
              >
                <Text style={[styles.modeLabel, mode === m && styles.modeLabelActive]}>{label}</Text>
              </Pressable>
            ))}
          </View>

          {mode === 'url' ? (
            <View style={styles.fieldRow}>
              <TextInput
                autoFocus
                value={urlText}
                onChangeText={handleUrlChange}
                onBlur={handleUrlBlur}
                placeholder="https://maps.google.com/…"
                placeholderTextColor={theme.ink.faint}
                style={styles.input}
                autoCapitalize="none"
                autoCorrect={false}
              />
              {resolvingUrl && <ActivityIndicator style={styles.fieldSpinner} color={theme.ink.muted} />}
            </View>
          ) : (
            <TextInput
              value={urlText}
              editable={false}
              placeholder="—"
              placeholderTextColor={theme.ink.faint}
              style={[styles.input, styles.inputMirror]}
            />
          )}

          {mode === 'decimal' ? (
            <TextInput
              autoFocus
              value={decimalText}
              onChangeText={handleDecimalChange}
              placeholder="55.7558, 37.6173"
              placeholderTextColor={theme.ink.faint}
              style={styles.input}
              keyboardType="numbers-and-punctuation"
            />
          ) : (
            <TextInput
              value={decimalText}
              editable={false}
              placeholder="—"
              placeholderTextColor={theme.ink.faint}
              style={[styles.input, styles.inputMirror]}
            />
          )}

          {mode === 'mgrs' ? (
            <TextInput
              autoFocus
              value={mgrsText}
              onChangeText={handleMgrsChange}
              placeholder="37UDB1234567890"
              placeholderTextColor={theme.ink.faint}
              style={styles.input}
              autoCapitalize="characters"
              autoCorrect={false}
            />
          ) : (
            <TextInput
              value={mgrsText}
              editable={false}
              placeholder="—"
              placeholderTextColor={theme.ink.faint}
              style={[styles.input, styles.inputMirror]}
            />
          )}

          <View style={styles.buttons}>
            <Pressable style={({ pressed }) => [styles.cancelButton, pressed && styles.pressed]} onPress={onCancel}>
              <Text style={styles.cancelLabel}>Скасувати</Text>
            </Pressable>
            <Pressable
              style={({ pressed }) => [styles.saveButton, !canSave && styles.saveButtonDisabled, pressed && styles.pressed]}
              disabled={!canSave}
              onPress={() => point && onSave({ title: title.trim(), point })}
            >
              <Text style={styles.saveLabel}>Зберегти</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </GlassLayer>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  frame: SHEET_FRAME,
  card: {
    ...SHEET_WINDOW,
    backgroundColor: t.raised,
    borderWidth: 1,
    borderColor: t.edge.hairline,
    padding: 20,
    gap: 10,
  },
  title: {
    fontSize: 19,
    fontFamily: FONT_BOLD,
    color: t.ink.primary,
  },
  input: {
    backgroundColor: t.field.fill,
    borderWidth: 1,
    borderColor: t.edge.hairline,
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
  },
  // The two fields not currently being typed into - the same field
  // styling, dimmed, so it reads as "this is filled in for you" rather
  // than as a disabled control nobody can use.
  inputMirror: {
    color: t.ink.muted,
    borderColor: 'transparent',
  },
  fieldRow: {
    position: 'relative',
    justifyContent: 'center',
  },
  fieldSpinner: {
    position: 'absolute',
    right: 14,
  },
  modeRow: {
    flexDirection: 'row',
    backgroundColor: t.field.fill,
    borderRadius: 14,
    padding: 3,
    gap: 3,
    marginTop: 2,
  },
  modeTab: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: 11,
    alignItems: 'center',
  },
  modeTabActive: {
    backgroundColor: t.accent,
  },
  modeLabel: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.muted,
  },
  modeLabelActive: {
    color: t.onAccent,
  },
  buttons: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  pressed: {
    opacity: 0.6,
  },
  cancelButton: {
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 18,
  },
  cancelLabel: {
    fontSize: 16,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.muted,
  },
  saveButton: {
    backgroundColor: t.accent,
    borderRadius: 18,
    minHeight: 46,
    justifyContent: 'center',
    paddingHorizontal: 22,
  },
  saveButtonDisabled: {
    opacity: 0.4,
  },
  saveLabel: {
    fontSize: 16,
    fontFamily: FONT_SEMIBOLD,
    color: t.onAccent,
  },
});
