import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RootStackParamList } from '../navigation';

const ACCENT = '#3B82F6';

// Same look as FloatingIslandTabBar, for screens pushed OUTSIDE the Tab
// navigator (Files/Photos/Links/Tasks - see App.tsx) which would otherwise
// lose the tab bar entirely once opened. "Документи"/"Календар" jump
// straight to that tab; "Бази даних" (shown active, since being on this bar
// at all means being inside one) always steps back to the databases hub -
// from Документи/Календар, FloatingIslandTabBar's own "Більше" button
// instead jumps into whichever database this bar was last shown on (see
// utils/lastDatabaseRoute).
export default function DatabaseIslandBar() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();

  return (
    <View style={styles.wrap} pointerEvents="box-none">
      <View style={styles.island}>
        <Pressable style={styles.button} onPress={() => navigation.navigate('Tabs', { screen: 'Документи' })}>
          <Ionicons name="document-text-outline" size={20} color="#6B7280" />
        </Pressable>
        <Pressable style={styles.button} onPress={() => navigation.navigate('Tabs', { screen: 'Календар' })}>
          <Ionicons name="calendar-outline" size={20} color="#6B7280" />
        </Pressable>
        <Pressable
          style={[styles.button, styles.buttonActive]}
          onPress={() => navigation.navigate('Tabs', { screen: 'Більше' })}
        >
          <Ionicons name="ellipsis-horizontal-outline" size={20} color={ACCENT} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 24,
    alignItems: 'center',
  },
  island: {
    flexDirection: 'row',
    gap: 6,
    backgroundColor: '#fff',
    borderRadius: 30,
    padding: 8,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 6 },
    elevation: 6,
  },
  button: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  buttonActive: {
    backgroundColor: '#EFF6FF',
  },
});
