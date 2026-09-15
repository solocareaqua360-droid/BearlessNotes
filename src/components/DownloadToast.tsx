import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

export default function DownloadToast({
  fileName,
  onShowInFolder,
  onIgnore,
}: {
  fileName: string;
  onShowInFolder: () => void;
  onIgnore: () => void;
}) {
  return (
    <View style={styles.toast}>
      <Text style={styles.message} numberOfLines={1}>
        Завантажено: {fileName}
      </Text>
      <View style={styles.actions}>
        <Pressable hitSlop={8} onPress={onShowInFolder}>
          <Text style={styles.action}>Показати в папці</Text>
        </Pressable>
        <Pressable hitSlop={8} onPress={onIgnore}>
          <Text style={styles.ignore}>Ігнорувати</Text>
        </Pressable>
      </View>
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
    gap: 10,
  },
  message: {
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: '#fff',
  },
  actions: {
    flexDirection: 'row',
    gap: 20,
  },
  action: {
    fontSize: 14,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: '#60A5FA',
  },
  ignore: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: '#9CA3AF',
  },
});
