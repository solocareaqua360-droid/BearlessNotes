import { useState } from 'react';
import { ActivityIndicator, Modal, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSoft } from './sketch/theme';
import { SOFT_MEDIUM, SOFT_SEMIBOLD } from './sketch/fonts';
import { buildInfo, checkAndFetchUpdate, restartApp } from './updates';
import appJson from '../app.json';

type Status = 'idle' | 'busy' | 'latest' | 'ready' | 'disabled' | 'error';

const MESSAGE: Record<Status, string> = {
  idle: '',
  busy: 'Перевіряю…',
  latest: 'У тебе вже остання версія.',
  ready: 'Нова версія завантажена. Перезапусти, щоб її побачити.',
  disabled: 'У цій збірці оновлення вимкнені (режим розробки).',
  error: 'Не вдалося оновити. Перевір інтернет і спробуй ще раз.',
};

export default function SettingsSheet({ visible, onClose }: { visible: boolean; onClose: () => void }) {
  const S = useSoft();
  const insets = useSafeAreaInsets();
  const [status, setStatus] = useState<Status>('idle');
  const info = buildInfo(appJson.expo.version);

  const update = () => {
    setStatus('busy');
    checkAndFetchUpdate().then(setStatus, () => setStatus('error'));
  };
  const close = () => {
    setStatus('idle');
    onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={close} statusBarTranslucent>
      <Pressable style={styles.backdrop} onPress={close} />
      <View style={[styles.sheet, { backgroundColor: S.chrome, paddingBottom: insets.bottom + 20, boxShadow: S.popShadow }]}>
        <View style={[styles.grip, { backgroundColor: S.line }]} />
        <Text style={[styles.title, { color: S.ink }]}>Налаштування</Text>

        <View style={[styles.row, { borderColor: S.line }]}>
          <Text style={[styles.label, { color: S.ink2 }]}>Версія</Text>
          <Text style={[styles.value, { color: S.ink }]}>{info.version}</Text>
        </View>
        <View style={[styles.row, { borderColor: S.line }]}>
          <Text style={[styles.label, { color: S.ink2 }]}>Збірка</Text>
          <Text style={[styles.value, { color: S.ink }]}>{info.update}</Text>
        </View>
        {info.date && (
          <View style={[styles.row, { borderColor: S.line }]}>
            <Text style={[styles.label, { color: S.ink2 }]}>Оновлено</Text>
            <Text style={[styles.value, { color: S.ink }]}>{info.date}</Text>
          </View>
        )}

        {status === 'ready' ? (
          <Pressable onPress={restartApp} style={[styles.button, { backgroundColor: S.accent }]}>
            <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>Перезапустити</Text>
          </Pressable>
        ) : (
          <Pressable onPress={update} disabled={status === 'busy'} style={[styles.button, { backgroundColor: S.ink }]}>
            {status === 'busy' ? (
              <ActivityIndicator color={S.chrome} />
            ) : (
              <Text style={[styles.buttonText, { color: S.chrome }]}>Оновити</Text>
            )}
          </Pressable>
        )}
        <Text style={[styles.message, { color: S.ink2 }]}>{MESSAGE[status]}</Text>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  sheet: { borderTopLeftRadius: 28, borderTopRightRadius: 28, paddingHorizontal: 20, paddingTop: 10 },
  grip: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 14 },
  title: { fontSize: 22, fontFamily: SOFT_SEMIBOLD, marginBottom: 8 },
  row: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 14, borderBottomWidth: StyleSheet.hairlineWidth },
  label: { fontSize: 15, fontFamily: SOFT_MEDIUM },
  value: { fontSize: 15, fontFamily: SOFT_MEDIUM },
  button: { height: 52, borderRadius: 26, alignItems: 'center', justifyContent: 'center', marginTop: 20 },
  buttonText: { fontSize: 16, fontFamily: SOFT_SEMIBOLD },
  message: { fontSize: 14, fontFamily: SOFT_MEDIUM, textAlign: 'center', marginTop: 12, minHeight: 20 },
});
