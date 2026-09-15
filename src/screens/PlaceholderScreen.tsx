import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FONT_REGULAR } from '../utils/fonts';

export default function PlaceholderScreen({
  icon,
  label,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}) {
  return (
    <View style={styles.container}>
      <Ionicons name={icon} size={32} color="#9CA3AF" />
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    gap: 12,
  },
  label: {
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: '#9CA3AF',
  },
});
