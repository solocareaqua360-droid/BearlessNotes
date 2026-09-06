import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  getConnectedEmail,
  isDriveConnected,
  runDriveDiagnostics,
} from '../utils/googleDrive';

const ACCENT = '#3B82F6';
const DANGER = '#EF4444';

export default function SettingsScreen() {
  const [email, setEmail] = useState<string | null>(() => (isDriveConnected() ? getConnectedEmail() : null));
  const [busy, setBusy] = useState(false);

  async function handleConnect() {
    setBusy(true);
    try {
      const connectedEmail = await connectGoogleDrive();
      setEmail(connectedEmail);
    } catch {
      // Cancelled or failed - nothing to show, the button just stays as is.
    } finally {
      setBusy(false);
    }
  }

  // The automatic backup is deliberately silent (a failed backup must never
  // block attaching a file), so this is the only place the actual reason a
  // backup isn't landing on Drive becomes visible.
  async function handleCheckConnection() {
    setBusy(true);
    try {
      const result = await runDriveDiagnostics();
      Alert.alert('Перевірка з\'єднання', result);
    } finally {
      setBusy(false);
    }
  }

  function handleDisconnect() {
    Alert.alert('Відключити Google Drive?', 'Нові файли й фото більше не копіюватимуться на Диск.', [
      { text: 'Скасувати', style: 'cancel' },
      {
        text: 'Відключити',
        style: 'destructive',
        onPress: async () => {
          setBusy(true);
          try {
            await disconnectGoogleDrive();
            setEmail(null);
          } finally {
            setBusy(false);
          }
        },
      },
    ]);
  }

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <Text style={styles.header}>Налаштування</Text>
      </View>

      <View style={styles.card}>
        <View style={styles.cardHeader}>
          <Ionicons name="cloud-outline" size={22} color={ACCENT} />
          <Text style={styles.cardTitle}>Google Drive</Text>
        </View>
        {email ? (
          <>
            <Text style={styles.cardBody}>
              Підключено: <Text style={styles.emailText}>{email}</Text>
            </Text>
            <Text style={styles.cardHint}>
              Нові файли й фото автоматично копіюються в папку "Bearless Notes" на Диску.
            </Text>
            <Pressable style={styles.checkButton} onPress={handleCheckConnection} disabled={busy}>
              {busy ? <ActivityIndicator color={ACCENT} /> : <Text style={styles.checkLabel}>Перевірити з'єднання</Text>}
            </Pressable>
            <Pressable style={styles.disconnectButton} onPress={handleDisconnect} disabled={busy}>
              <Text style={styles.disconnectLabel}>Відключити</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.cardHint}>
              Підключи Google-акаунт, щоб нові файли й фото автоматично копіювались на твій Google Диск.
            </Text>
            <Pressable style={styles.connectButton} onPress={handleConnect} disabled={busy}>
              {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.connectLabel}>Підключити</Text>}
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  headerRow: {
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111827',
  },
  card: {
    marginHorizontal: 20,
    backgroundColor: '#F9FAFB',
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111827',
  },
  cardBody: {
    fontSize: 14,
    color: '#111827',
  },
  emailText: {
    fontWeight: '600',
  },
  cardHint: {
    fontSize: 13,
    color: '#6B7280',
  },
  connectButton: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  connectLabel: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 15,
  },
  checkButton: {
    borderWidth: 1,
    borderColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  checkLabel: {
    color: ACCENT,
    fontWeight: '600',
    fontSize: 15,
  },
  disconnectButton: {
    borderWidth: 1,
    borderColor: DANGER,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  disconnectLabel: {
    color: DANGER,
    fontWeight: '600',
    fontSize: 15,
  },
});
