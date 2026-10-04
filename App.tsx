import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFonts, Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import Svg from 'react-native-svg';
import SketchEditor from './src/sketch/SketchEditor';
import SketchLayer from './src/sketch/SketchLayer';
import { Ionicons } from './src/sketch/icons/Ionicons';
import { useSoft, useTheme } from './src/sketch/theme';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from './src/sketch/fonts';
import type { SketchFile } from './src/sketch/format';
import { deleteSketch, exportSketch, importSketch, listSketches, newSketch, saveSketch } from './src/store';

// SKETCHEVA: mindEva's drawing editor as an app of its own, to grow it
// freely and bring back to mindEva what proves itself (see CLAUDE.md and
// docs/MINDEVA_COMPAT.md). One screen for now: the drawings, newest first;
// a tap opens one in the editor, a hold offers export and delete.
export default function App() {
  const [fontsLoaded] = useFonts({ Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold });
  if (!fontsLoaded) return null;
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <Home />
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}

function Home() {
  const S = useSoft();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [sketches, setSketches] = useState<SketchFile[]>([]);
  const [open, setOpen] = useState<SketchFile | null>(null);

  const reload = useCallback(() => {
    listSketches().then(setSketches).catch(() => setSketches([]));
  }, []);
  useEffect(reload, [reload]);

  const holdMenu = (file: SketchFile) =>
    Alert.alert(file.title, undefined, [
      { text: 'Експортувати', onPress: () => exportSketch(file).catch((e) => Alert.alert('Не вийшло', String(e))) },
      {
        text: 'Видалити',
        style: 'destructive',
        onPress: () =>
          Alert.alert('Видалити малюнок?', `«${file.title}» зникне з цього телефона.`, [
            { text: 'Скасувати', style: 'cancel' },
            { text: 'Видалити', style: 'destructive', onPress: () => deleteSketch(file.id).then(reload) },
          ]),
      },
      { text: 'Скасувати', style: 'cancel' },
    ]);

  const importOne = () =>
    importSketch()
      .then((file) => file && reload())
      .catch((e) => Alert.alert('Не вийшло імпортувати', e instanceof Error ? e.message : String(e)));

  return (
    <View style={[styles.fill, { backgroundColor: S.bg }]}>
      <StatusBar style={S.dark ? 'light' : 'dark'} />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 16, paddingBottom: insets.bottom + 110, paddingHorizontal: 16 }}>
        <Text style={[styles.title, { color: S.ink }]}>sketchEva</Text>
        {sketches.length === 0 && (
          <Text style={[styles.empty, { color: S.ink3 }]}>Ще немає малюнків. Натисни «+», щоб почати.</Text>
        )}
        <View style={styles.grid}>
          {sketches.map((file) => (
            <Pressable
              key={file.id}
              onPress={() => setOpen(file)}
              onLongPress={() => holdMenu(file)}
              style={[styles.card, { backgroundColor: S.card, boxShadow: S.shadow }]}
            >
              <View style={[styles.preview, { backgroundColor: theme.paper.fill }]}>
                {file.width > 0 && (
                  <Svg width="100%" height="100%" viewBox={`0 0 ${file.width} ${file.height}`} preserveAspectRatio="xMidYMid meet">
                    <SketchLayer elements={file.elements} ink={theme.paper.ink} />
                  </Svg>
                )}
              </View>
              <Text style={[styles.cardTitle, { color: S.ink }]} numberOfLines={1}>
                {file.title}
              </Text>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      <View style={[styles.dock, { bottom: insets.bottom + 16 }]}>
        <Pressable onPress={importOne} style={[styles.round, { backgroundColor: S.chrome, boxShadow: S.shadow }]} accessibilityLabel="Імпортувати">
          <Ionicons name="download-outline" size={22} color={S.ink} />
        </Pressable>
        <Pressable
          onPress={() => setOpen(newSketch())}
          style={[styles.round, { backgroundColor: S.ink }]}
          accessibilityLabel="Новий малюнок"
        >
          <Ionicons name="add" size={26} color={S.chrome} />
        </Pressable>
      </View>

      <SketchEditor
        visible={open !== null}
        initialElements={open?.elements ?? []}
        onClose={() => setOpen(null)}
        onSave={(elements, width, height) => {
          if (!open) return;
          const file = { ...open, elements, width, height, updatedAt: Date.now() };
          setOpen(null);
          saveSketch(file).then(reload);
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  title: { fontSize: 30, fontFamily: SOFT_SEMIBOLD, marginBottom: 16, marginLeft: 4 },
  empty: { fontSize: 15, fontFamily: SOFT_MEDIUM, marginTop: 40, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  card: { flexBasis: '46%', flexGrow: 1, borderRadius: 20, overflow: 'hidden' },
  preview: { aspectRatio: 0.75 },
  cardTitle: { fontSize: 14, fontFamily: SOFT_MEDIUM, paddingHorizontal: 12, paddingVertical: 10 },
  dock: { position: 'absolute', right: 16, flexDirection: 'row', gap: 12 },
  round: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
});
