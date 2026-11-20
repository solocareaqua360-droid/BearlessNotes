import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import * as Updates from 'expo-updates';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';

// THE APP'S FACE (the user, 2026-10-25: «в налаштування вибір шрифту: M PLUS Rounded 1c, Inter» - the soft style wants
// rounded ends; Inter's are cut square). Every soft screen names its face by the family names in utils/fonts
// (SOFT_* = 'Inter_400Regular'...); the choice LOADS a different file under those same names, so no screen changes and
// the setting reaches every one of them. A face is taken once, at start: a change reloads the app.
// M PLUS Rounded 1c is cut down to Latin + Cyrillic + symbols (assets/fonts, ~270 KB a weight instead of 3.5 MB of
// Japanese); it has no 600, so SemiBold takes its Bold and Bold its ExtraBold.

export type AppFont = 'inter' | 'mplus';
export const APP_FONTS: { id: AppFont; label: string; hint: string }[] = [
  { id: 'mplus', label: 'M PLUS Rounded 1c', hint: 'М\'який, з круглими кінцями літер' },
  { id: 'inter', label: 'Inter', hint: 'Чіткий, з прямими кінцями' },
];
const KEY = 'appFont';

export async function readAppFont(): Promise<AppFont> {
  try {
    const v = await AsyncStorage.getItem(KEY);
    return v === 'mplus' ? 'mplus' : 'inter';
  } catch {
    return 'inter';
  }
}

export function appFontFiles(font: AppFont): Record<string, number> {
  if (font === 'mplus') {
    return {
      Inter_400Regular: require('../../assets/fonts/MPLUSRounded1c-Regular.ttf'),
      Inter_500Medium: require('../../assets/fonts/MPLUSRounded1c-Medium.ttf'),
      Inter_600SemiBold: require('../../assets/fonts/MPLUSRounded1c-Bold.ttf'),
      Inter_700Bold: require('../../assets/fonts/MPLUSRounded1c-ExtraBold.ttf'),
    };
  }
  return { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold };
}

export async function chooseAppFont(font: AppFont): Promise<void> {
  try {
    await AsyncStorage.setItem(KEY, font);
  } catch {
    // Not kept - the next start shows the old face.
  }
  if (Platform.OS === 'web') {
    window.location.reload();
    return;
  }
  await Updates.reloadAsync().catch(() => {});
}
