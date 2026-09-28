import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { toastClear } from '../constants/rail';
import { useTheme } from '../theme/ThemeProvider';
import { FONT_BOLD, FONT_REGULAR } from '../utils/fonts';

// `actionLabel` defaults to "Скасувати" (its original, only job) - Files/
// Photos/Links also reuse this exact shape for "Додано у Файли · Перемістити"
// after a "+" add, which is why the label is a prop rather than baked in.
export default function UndoToast({
  message,
  actionLabel,
  onUndo,
  // Which side the rail stands on, so the action never sits under it -
  // see toastClear. Right on a phone; a screen drawn in a pane says so.
  railSide = 'right',
}: {
  message: string;
  actionLabel?: string;
  onUndo: () => void;
  railSide?: 'left' | 'right';
}) {
  const insets = useSafeAreaInsets();
  // The pill itself stays a fixed dark chip in every theme, matching
  // the ordinary Snackbar convention - it has to read clearly over
  // whatever screen it lands on, light or dark canvas alike, so it does
  // not follow the app's own ground. Only the action text ties to the
  // scheme, the same way a Snackbar's action is usually the app's own
  // brand colour rather than a fixed blue nobody chose.
  const accent = useTheme().accent;
  return (
    <View style={[styles.toast, toastClear(railSide, insets.bottom)]}>
      <Text style={styles.message} numberOfLines={1}>
        {message}
      </Text>
      <Pressable hitSlop={8} onPress={onUndo}>
        <Text style={[styles.undo, { color: accent }]}>{actionLabel ?? 'Скасувати'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  // Where it stands is toastClear's (see constants/rail) - it has to
  // clear the island and the rail, both of which are drawn ABOVE it.
  toast: {
    position: 'absolute',
    backgroundColor: '#111827',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  message: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: '#fff',
  },
  undo: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
  },
});
