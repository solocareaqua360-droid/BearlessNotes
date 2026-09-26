import { type ReactNode } from 'react';
import { Keyboard, Pressable, StyleSheet, TextInput, type StyleProp, type ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import GlassDrop, { GlassIcon } from './GlassDrop';
import { useTheme } from '../theme/ThemeProvider';
import { FONT_REGULAR } from '../utils/fonts';

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

export function searchFieldSides(_railSide: 'left' | 'right', base: number = 20) {
  return { marginHorizontal: base };
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
  const theme = useTheme();
  return (
    <GlassDrop style={[styles.field, style]}>
      {leading ?? <GlassIcon name="search-outline" size={19} tone="muted" />}
      <TextInput
        autoFocus={autoFocus}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.ink.faint}
        style={[styles.input, { color: theme.ink.primary }]}
      />
      {!!onClose && (
        <Pressable
          hitSlop={8}
          onPress={() => {
            Keyboard.dismiss();
            onClose();
          }}
        >
          <GlassIcon name="close-outline" size={19} tone="muted" />
        </Pressable>
      )}
      {!!onClear && value.length > 0 && (
        <Pressable hitSlop={8} onPress={onClear}>
          <GlassIcon name="close-outline" size={19} tone="muted" />
        </Pressable>
      )}
    </GlassDrop>
  );
}

const styles = StyleSheet.create({
  // The shape; the glass is GlassDrop's.
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 45,
    paddingHorizontal: 16,
  },
  input: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    padding: 0,
  },
});
