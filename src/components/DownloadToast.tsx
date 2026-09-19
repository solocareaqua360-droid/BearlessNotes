import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { toastClear } from '../constants/rail';
import { useTheme } from '../theme/ThemeProvider';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

export default function DownloadToast({
  fileName,
  onShowInFolder,
  onIgnore,
  railSide = 'right',
}: {
  fileName: string;
  onShowInFolder: () => void;
  onIgnore: () => void;
  railSide?: 'left' | 'right';
}) {
  const insets = useSafeAreaInsets();
  // Same reasoning as UndoToast: the pill stays fixed dark, the action
  // ties to the scheme.
  const accent = useTheme().accent;
  return (
    <View style={[styles.toast, toastClear(railSide, insets.bottom)]}>
      <Text style={styles.message} numberOfLines={1}>
        Завантажено: {fileName}
      </Text>
      <View style={styles.actions}>
        <Pressable hitSlop={8} onPress={onShowInFolder}>
          <Text style={[styles.action, { color: accent }]}>Показати в папці</Text>
        </Pressable>
        <Pressable hitSlop={8} onPress={onIgnore}>
          <Text style={styles.ignore}>Ігнорувати</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  // Same footing as every other toast - see toastClear.
  toast: {
    position: 'absolute',
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
  },
  ignore: {
    fontSize: 14,
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    color: '#9CA3AF',
  },
});
