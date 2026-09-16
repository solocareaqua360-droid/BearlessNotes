import { type ReactNode } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, View, type StyleProp, type ViewStyle } from 'react-native';
import { BlurView } from 'expo-blur';
import { Ionicons } from '@expo/vector-icons';
import { useBlurTarget } from './GlassTarget';
import { FONT_REGULAR } from '../utils/fonts';
import { GLASS_ISLAND, GLASS_TEXT, GLASS_TEXT_FAINT, GLASS_TEXT_MUTED } from '../constants/glass';
import { RAIL_CLEARANCE } from '../constants/rail';

// The one search field in the app.
//
// There were three, each written in a different week: a white rounded
// rectangle on the database screens, a glass capsule on the documents
// list, and a flat translucent box in the diary - the user's own count,
// with a screenshot of each. This is the documents one, which was the
// only one already speaking the rail's language (GLASS_ISLAND, fully
// rounded, a hairline of white, its own blur), moved somewhere all three
// can share so they cannot drift again.
//
// What a screen keeps for itself is WHERE the field sits, because that
// differs for a real reason: the rail stands on the right, or on the
// left in a pane, and the field has to stop short of it rather than run
// under the capsule hanging there. `sideOf` is that margin - a MARGIN,
// not padding: the diary asked for its clearance as padding, so the
// pill itself stretched the full width and only its text moved in, and
// the glass ran off the edge of the screen.

export function searchFieldSides(railSide: 'left' | 'right', base: number = 20) {
  return railSide === 'left'
    ? { marginLeft: RAIL_CLEARANCE, marginRight: base }
    : { marginLeft: base, marginRight: RAIL_CLEARANCE };
}

export default function SearchField({
  value,
  onChangeText,
  placeholder,
  onClose,
  onClear,
  leading,
  autoFocus,
  style,
}: {
  value: string;
  onChangeText: (next: string) => void;
  placeholder: string;
  // The way out of searching, drawn on the field itself - while the
  // keyboard is up it is the only control on the screen. A field that is
  // always there (the diary's) has nothing to close, and passes nothing.
  onClose?: () => void;
  // The other shape of the same corner: a screen that IS the search (see
  // SearchScreen) has nothing to close either, so its cross empties the
  // field instead, and only appears once there is something to empty.
  onClear?: () => void;
  // The magnifier, unless the screen puts something else there - the
  // all-databases search carries its own way back in this corner, since
  // that screen is one field and its results and a capsule beside them
  // would be three controls for a screen that has one.
  leading?: ReactNode;
  autoFocus?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const blurTarget = useBlurTarget();
  return (
    <View style={[styles.field, style]}>
      <BlurView
        intensity={60}
        tint="dark"
        blurMethod="dimezisBlurView"
        blurTarget={blurTarget ?? undefined}
        style={StyleSheet.absoluteFill}
        pointerEvents="none"
      />
      {leading ?? <Ionicons name="search-outline" size={19} color={GLASS_TEXT_MUTED} />}
      <TextInput
        autoFocus={autoFocus}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={GLASS_TEXT_FAINT}
        style={styles.input}
      />
      {!!onClose && (
        <Pressable
          hitSlop={8}
          onPress={() => {
            Keyboard.dismiss();
            onClose();
          }}
        >
          <Ionicons name="close-outline" size={19} color={GLASS_TEXT_MUTED} />
        </Pressable>
      )}
      {!!onClear && value.length > 0 && (
        <Pressable hitSlop={8} onPress={onClear}>
          <Ionicons name="close-outline" size={19} color={GLASS_TEXT_MUTED} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 45,
    paddingHorizontal: 16,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: GLASS_ISLAND,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
    padding: 0,
  },
});
