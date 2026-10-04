import { Alert } from 'react-native';
import * as Updates from 'expo-updates';

// App-only (not part of src/sketch): the in-app «Оновити» button. Checks
// the EAS Update channel, downloads, and restarts into the new bundle.
export async function checkAndApplyUpdate(): Promise<void> {
  if (!Updates.isEnabled) {
    Alert.alert('Оновлення', 'У цій збірці оновлення вимкнені (режим розробки).');
    return;
  }
  try {
    const check = await Updates.checkForUpdateAsync();
    if (!check.isAvailable) {
      Alert.alert('Оновлення', 'У тебе вже остання версія.');
      return;
    }
    await Updates.fetchUpdateAsync();
    Alert.alert('Оновлення', 'Нова версія завантажена.', [
      { text: 'Пізніше', style: 'cancel' },
      { text: 'Перезапустити', onPress: () => Updates.reloadAsync() },
    ]);
  } catch (e) {
    Alert.alert('Не вдалося оновити', e instanceof Error ? e.message : String(e));
  }
}
