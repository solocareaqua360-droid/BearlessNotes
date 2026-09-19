import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FONT_BOLD, FONT_REGULAR } from '../utils/fonts';
import { installFatalErrorReporter, onFatalError } from '../utils/fatalErrors';

// CrashBoundary, for the half of the errors a boundary cannot reach - see
// src/utils/fatalErrors.ts. Mounted ABOVE the boundary and outside the
// navigator on purpose: what it reports is precisely the kind of error
// that used to leave nothing at all on the screen.
export default function FatalErrorOverlay() {
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    installFatalErrorReporter();
    return onFatalError(setError);
  }, []);

  if (!error) return null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>Помилка поза екраном</Text>
      <Text style={styles.body}>{error.message || String(error)}</Text>
      <ScrollView style={styles.stackBox}>
        <Text style={styles.stack}>{error.stack ?? ''}</Text>
      </ScrollView>
      <Pressable style={styles.button} onPress={() => setError(null)}>
        <Text style={styles.buttonLabel}>Закрити</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 2000,
    elevation: 2000,
    gap: 12,
    padding: 28,
    paddingTop: 64,
    backgroundColor: '#171310',
  },
  title: { fontSize: 20, fontFamily: FONT_BOLD, color: '#fff' },
  body: { fontSize: 15, lineHeight: 21, fontFamily: FONT_REGULAR, color: '#FB7185' },
  stackBox: { flex: 1, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.06)', padding: 12 },
  stack: { fontSize: 11, lineHeight: 16, fontFamily: FONT_REGULAR, color: 'rgba(255,255,255,0.62)' },
  button: {
    alignSelf: 'flex-start',
    borderRadius: 16,
    backgroundColor: '#F5C77E',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  buttonLabel: { fontSize: 15, fontFamily: FONT_BOLD, color: '#171310' },
});
