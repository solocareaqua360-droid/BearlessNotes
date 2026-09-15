import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FONT_BOLD, FONT_REGULAR } from '../utils/fonts';

// `actionLabel` defaults to "Скасувати" (its original, only job) - Files/
// Photos/Links also reuse this exact shape for "Додано у Файли · Перемістити"
// after a "+" add, which is why the label is a prop rather than baked in.
export default function UndoToast({
  message,
  actionLabel,
  onUndo,
}: {
  message: string;
  actionLabel?: string;
  onUndo: () => void;
}) {
  return (
    <View style={styles.toast}>
      <Text style={styles.message} numberOfLines={1}>
        {message}
      </Text>
      <Pressable hitSlop={8} onPress={onUndo}>
        <Text style={styles.undo}>{actionLabel ?? 'Скасувати'}</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  toast: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 24,
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
    color: '#60A5FA',
  },
});
