import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '../icons/Ionicons';
import { useInnerBackNow } from '../../navigation/innerBack';
import { useSoft } from '../../theme/soft';

// The one back arrow of a window - see navigation/innerBack. Its place is
// kept whether it shows or not, so nothing beside it moves when it comes
// and goes. `fallback`: the level above the screen itself, when the screen
// has no step of its own left.
export default function UpButton({ fallback, size = 28 }: { fallback: (() => void) | null; size?: number }) {
  const S = useSoft();
  const inner = useInnerBackNow();
  const run = inner ?? fallback;
  return (
    <View style={{ width: size, height: size }}>
      {run && (
        <Pressable
          onPress={run}
          accessibilityLabel="Назад"
          style={(state) => [
            styles.button,
            { width: size, height: size, borderRadius: size / 2 },
            (state as { hovered?: boolean }).hovered && { backgroundColor: S.fill },
          ]}
        >
          <Ionicons name="chevron-back" size={18} color={S.ink} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  button: { alignItems: 'center', justifyContent: 'center' },
});
