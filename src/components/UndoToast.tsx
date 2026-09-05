import { Pressable, StyleSheet, Text, View } from 'react-native';

export default function UndoToast({ message, onUndo }: { message: string; onUndo: () => void }) {
  return (
    <View style={styles.toast}>
      <Text style={styles.message} numberOfLines={1}>
        {message}
      </Text>
      <Pressable hitSlop={8} onPress={onUndo}>
        <Text style={styles.undo}>Скасувати</Text>
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
    color: '#fff',
  },
  undo: {
    fontSize: 14,
    fontWeight: '700',
    color: '#60A5FA',
  },
});
