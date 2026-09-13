import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  PixelRatio,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
// Safe to import here: the native module is already in every build of this
// app (that's what makes OTA updates work at all), so this adds nothing
// native and ships over the air like any other change.
import * as Updates from 'expo-updates';
import { doc, onSnapshot } from '@react-native-firebase/firestore';
import { auth, db, signInWithGoogleAccount } from '../firebase';
import {
  connectGoogleDrive,
  disconnectGoogleDrive,
  DriveStorageQuota,
  getConnectedEmail,
  getDriveStorageQuota,
  isDriveConnected,
  runDriveDiagnostics,
} from '../utils/googleDrive';
import ContentColumn from '../components/ContentColumn';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { claimExistingData } from '../utils/claimOwnership';
import { backfillDriveCopies } from '../utils/backfillDrive';
import { STALE_AFTER_DAYS, localAttachmentUsage } from '../utils/attachmentCache';
import { chooseDownloadFolder, currentDownloadFolder } from '../utils/downloadToFolder';
import { confirm, notify } from '../components/surfaces/Ask';

const ACCENT = '#3B82F6';
const DANGER = '#EF4444';
const driveStatsDoc = doc(db, 'settings', 'driveStats');

// 0 decimals under 10 (looks odd as "3.0 МБ"), 1 decimal otherwise - matches
// how file sizes read most naturally at this app's typical attachment sizes.
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes / 1024 < 10 ? 1 : 0)} КБ`;
  const mb = bytes / (1024 * 1024);
  if (mb < 1024) return `${mb.toFixed(mb < 10 ? 1 : 0)} МБ`;
  return `${(mb / 1024).toFixed(2)} ГБ`;
}

// dd.MM, HH:mm - enough to tell two updates published the same day apart,
// which is the whole question this card answers.
function formatUpdateTime(date: Date | null): string {
  if (!date) return '—';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(date.getDate())}.${pad(date.getMonth() + 1)}, ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export default function SettingsScreen() {
  const [accountEmail, setAccountEmail] = useState<string | null>(auth.currentUser?.email ?? null);
  const [authBusy, setAuthBusy] = useState(false);
  const [claimStatus, setClaimStatus] = useState('');
  // "Is the change I just published actually on this phone?" - by default
  // nothing in the app answers that: expo-updates downloads a new bundle on
  // a cold start and only applies it on the NEXT one, silently. This card
  // shows which bundle is running and forces the whole cycle on demand.
  const [updateBusy, setUpdateBusy] = useState(false);
  // The actual layout size of this window, in the units every breakpoint in
  // this app is written in. Spec sheets quote pixels, and a phone's own
  // "screen zoom" setting changes the density those pixels divide by - so
  // the only way to know which side of a breakpoint a device really falls
  // on is to read it off the device.
  const { width: windowWidth, height: windowHeight } = useWindowDimensions();
  const [email, setEmail] = useState<string | null>(() => (isDriveConnected() ? getConnectedEmail() : null));
  const [busy, setBusy] = useState(false);
  const [backfillProgress, setBackfillProgress] = useState<{ done: number; total: number } | null>(null);
  const [local, setLocal] = useState<{ count: number; bytes: number; withoutDrive: number } | null>(null);
  const [downloadFolder, setDownloadFolder] = useState<{ uri: string; label: string } | null>(null);
  useEffect(() => {
    currentDownloadFolder().then(setDownloadFolder).catch(() => {});
  }, []);
  useEffect(() => {
    localAttachmentUsage().then(setLocal).catch(() => {});
  }, [backfillProgress]);
  const [stats, setStats] = useState<{ totalBytesStored: number; fileCount: number } | null>(null);
  const [quota, setQuota] = useState<DriveStorageQuota | null>(null);
  const [quotaLoading, setQuotaLoading] = useState(false);

  useEffect(() => {
    return onSnapshot(driveStatsDoc, (snapshot) => {
      const data = snapshot.data();
      setStats(data ? { totalBytesStored: data.totalBytesStored ?? 0, fileCount: data.fileCount ?? 0 } : null);
    });
  }, []);

  async function loadQuota() {
    setQuotaLoading(true);
    try {
      setQuota(await getDriveStorageQuota());
    } finally {
      setQuotaLoading(false);
    }
  }

  // Real account-wide usage only means anything once connected - re-fetched
  // whenever the connected account changes (including on connect).
  useEffect(() => {
    if (email) loadQuota();
    else setQuota(null);
  }, [email]);

  async function handleCheckUpdate() {
    setUpdateBusy(true);
    try {
      const check = await Updates.checkForUpdateAsync();
      if (!check.isAvailable) {
        notify('Оновлень немає', 'Встановлена версія - найновіша.');
        return;
      }
      await Updates.fetchUpdateAsync();
      confirm({
        title: 'Оновлення завантажено',
        message: 'Перезапустити застосунок зараз?',
        confirmLabel: 'Перезапустити',
        tone: 'primary',
      }).then((yes) => {
        if (!yes) return;
        Updates.reloadAsync();
      });
    } catch (e) {
      // The usual one: a build running from Metro can't check for updates
      // at all, and says so in its own words.
      notify('Не вдалося перевірити', e instanceof Error ? e.message : String(e));
    } finally {
      setUpdateBusy(false);
    }
  }

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
  // Only the device that still has the bytes can do this, and it says so
  // plainly: anything it cannot find locally is counted and left exactly
  // as it was, never deleted.
  async function handleBackfill() {
    setBusy(true);
    setBackfillProgress({ done: 0, total: 0 });
    try {
      const result = await backfillDriveCopies((done, total) => setBackfillProgress({ done, total }));
      notify('Перенесення завершено', `Вивантажено: ${result.uploaded}\n` +
          `Немає на цьому пристрої: ${result.missing}\n` +
          (result.failed > 0 ? `Не вдалося: ${result.failed}` : '').trim());
    } catch (error) {
      notify('Не вдалося перенести', (error as Error).message);
    } finally {
      setBackfillProgress(null);
      setBusy(false);
    }
  }

  async function handleCheckConnection() {
    setBusy(true);
    try {
      const result = await runDriveDiagnostics();
      notify('Перевірка з\'єднання', result);
    } finally {
      setBusy(false);
    }
  }

  function handleDisconnect() {
    confirm({
      title: 'Відключити Google Drive?',
      message: 'Нові файли й фото більше не копіюватимуться на Диск.',
      confirmLabel: 'Відключити',
    }).then(async (yes) => {
      if (!yes) return;
      setBusy(true);
      try {
        await disconnectGoogleDrive();
        setEmail(null);
      } finally {
        setBusy(false);
      }
    });
  }

  async function handleGoogleSignIn() {
    setAuthBusy(true);
    setClaimStatus('');
    try {
      const result = await signInWithGoogleAccount();
      setAccountEmail(result.email);
      if (result.hadToSwitch) {
        notify('Увійшли в наявний акаунт', 'Цим акаунтом уже входили раніше, тож прив\'язати до нього дані цього пристрою не вийшло - вони лишились під попередньою анонімною особою.');
      }
      // Stamping ownership is what makes owner-only rules possible later.
      // Safe to re-run: it only touches documents that have no owner yet.
      setClaimStatus('Позначаю дані...');
      const claimed = await claimExistingData(result.uid, (p) =>
        setClaimStatus(`${p.collection}: ${p.claimed}/${p.total}`)
      );
      setClaimStatus(claimed > 0 ? `Позначено записів: ${claimed}` : 'Усі дані вже позначені');
    } catch (error) {
      const message = (error as { message?: string }).message ?? 'Не вдалося увійти';
      notify('Вхід не вдався', message);
      setClaimStatus('');
    } finally {
      setAuthBusy(false);
    }
  }

  return (
    <View style={styles.container}>
      <ContentColumn>
        {/* Scrolls: on a narrow screen the three cards are taller than the
            window, and without this the last of them - and every button on
            it - simply could not be reached. */}
        <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          <Text style={styles.header}>Налаштування</Text>
        </View>

        {/* The account everything belongs to. Above the version card
            deliberately: it is the one thing here that decides what the app
            can see at all. */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="person-circle-outline" size={22} color={ACCENT} />
            <Text style={styles.cardTitle}>Обліковий запис</Text>
          </View>
          <Text style={styles.cardBody}>
            {accountEmail ? accountEmail : 'Без входу - дані прив\'язані лише до цього пристрою'}
          </Text>
          <Text style={styles.cardHint}>
            {accountEmail
              ? 'Ці нотатки належать цьому акаунту. Увійди ним і на інших пристроях, щоб вони бачили те саме.'
              : 'Поки входу немає, кожен пристрій - сам по собі. Вхід через Google робить їх одним цілим і дає доступ до файлів на Диску.'}
          </Text>
          {claimStatus !== '' && <Text style={styles.cardHint}>{claimStatus}</Text>}
          <Pressable style={styles.checkButton} onPress={handleGoogleSignIn} disabled={authBusy}>
            {authBusy ? (
              <ActivityIndicator color={ACCENT} />
            ) : (
              <Text style={styles.checkLabel}>{accountEmail ? 'Змінити акаунт' : 'Увійти через Google'}</Text>
            )}
          </Pressable>
        </View>

        <View style={[styles.card, styles.updateCard]}>
          <View style={styles.cardHeader}>
            <Ionicons name="cloud-download-outline" size={22} color={ACCENT} />
            <Text style={styles.cardTitle}>Версія застосунку</Text>
          </View>
          <Text style={styles.cardBody}>
            {Updates.isEmbeddedLaunch
              ? 'Працює версія з APK (жодного оновлення ще не застосовано)'
              : `Оновлення ${(Updates.updateId ?? '').slice(0, 8)} від ${formatUpdateTime(Updates.createdAt)}`}
          </Text>
          <Text style={styles.cardHint}>
            Нові версії приходять по повітрю: застосунок завантажує їх при запуску, а застосовує при наступному. Кнопка
            нижче робить обидва кроки одразу.
          </Text>
          <View style={styles.trafficRow}>
          <Ionicons name="phone-landscape-outline" size={15} color="#6B7280" />
          <Text style={styles.trafficLabel}>
            Екран: {Math.round(windowWidth)} × {Math.round(windowHeight)} dp (щільність {PixelRatio.get()})
          </Text>
        </View>
        <Pressable style={styles.checkButton} onPress={handleCheckUpdate} disabled={updateBusy}>
            {updateBusy ? (
              <ActivityIndicator color={ACCENT} />
            ) : (
              <Text style={styles.checkLabel}>Перевірити оновлення</Text>
            )}
          </Pressable>
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
              <View style={styles.trafficRow}>
                <Ionicons name="server-outline" size={15} color="#6B7280" />
                {quotaLoading && !quota ? (
                  <ActivityIndicator size="small" color="#6B7280" />
                ) : quota ? (
                  <Text style={styles.trafficLabel}>
                    Диск: {formatBytes(quota.usage)}
                    {quota.limit != null
                      ? ` з ${formatBytes(quota.limit)} (${Math.round((quota.usage / quota.limit) * 100)}%)`
                      : ' (без обмеження)'}
                  </Text>
                ) : (
                  <Text style={styles.trafficLabel}>Не вдалося отримати дані про Диск</Text>
                )}
                <Pressable onPress={loadQuota} disabled={quotaLoading} hitSlop={8}>
                  <Ionicons name="refresh-outline" size={15} color={ACCENT} />
                </Pressable>
              </View>
              {!!stats && stats.fileCount > 0 && (
                <View style={styles.trafficRow}>
                  <Ionicons name="cloud-upload-outline" size={15} color="#6B7280" />
                  <Text style={styles.trafficLabel}>
                    Завантажено застосунком: {formatBytes(stats.totalBytesStored)} ({stats.fileCount}{' '}
                    {stats.fileCount === 1 ? 'файл' : 'файлів'})
                  </Text>
                </View>
              )}
              {/* What the attachments take up here, and the rule that keeps
                  it from growing forever: bytes nobody has opened in three
                  months go, records stay, Drive brings them back. */}
              {local && (
                <View style={styles.trafficRow}>
                  <Ionicons name="phone-portrait-outline" size={15} color="#6B7280" />
                  <Text style={styles.trafficLabel}>
                    На пристрої: {formatBytes(local.bytes)} ({local.count}{' '}
                    {local.count === 1 ? 'файл' : 'файлів'}
                    {local.withoutDrive > 0 ? `, ${local.withoutDrive} без копії на Диску` : ''})
                  </Text>
                </View>
              )}
              <Text style={styles.cardHint}>
                Копії файлів, які не відкривали {STALE_AFTER_DAYS} днів, прибираються з пристрою самі - але лише тих,
                що є на Диску. Записи лишаються; при наступному відкритті файл повертається.
              </Text>
              {/* Everything saved before there was a Drive backup has its
                  bytes on ONE device only - a card with nothing behind it
                  anywhere else. This sends whatever this device still
                  holds, so the other one can finally fetch it. */}
              {/* One folder for everything the app saves out - photos and
                  files alike. Asked for once, at the first download, and
                  changed here. */}
              <View style={styles.trafficRow}>
                <Ionicons name="folder-outline" size={15} color="#6B7280" />
                <Text style={styles.trafficLabel} numberOfLines={1}>
                  Завантаження: {downloadFolder ? downloadFolder.label : 'спитаю при першому'}
                </Text>
                <Pressable
                  hitSlop={8}
                  onPress={async () => {
                    const picked = await chooseDownloadFolder();
                    if (picked) setDownloadFolder(picked);
                  }}
                >
                  <Text style={styles.inlineAction}>Змінити</Text>
                </Pressable>
              </View>
              <Pressable style={styles.checkButton} onPress={handleBackfill} disabled={busy}>
                {backfillProgress ? (
                  <Text style={styles.checkLabel}>
                    Переношу: {backfillProgress.done} з {backfillProgress.total}
                  </Text>
                ) : (
                  <Text style={styles.checkLabel}>Перенести старі вкладення на Диск</Text>
                )}
              </Pressable>
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
        </ScrollView>
      </ContentColumn>

    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  content: {
    paddingBottom: 48,
  },
  headerRow: {
    paddingHorizontal: 20,
    paddingTop: 56,
    paddingBottom: 12,
  },
  header: {
    fontSize: 22,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: '#111827',
  },
  updateCard: {
    marginBottom: 14,
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
    fontFamily: FONT_SEMIBOLD,
    color: '#111827',
  },
  cardBody: {
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: '#111827',
  },
  emailText: {
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
  },
  cardHint: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: '#6B7280',
  },
  trafficRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  inlineAction: {
    fontSize: 13,
    fontFamily: FONT_SEMIBOLD,
    color: ACCENT,
  },
  trafficLabel: {
    flex: 1,
    fontSize: 13,
    fontFamily: FONT_REGULAR,
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
    fontFamily: FONT_SEMIBOLD,
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
    fontFamily: FONT_SEMIBOLD,
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
    fontFamily: FONT_SEMIBOLD,
    fontSize: 15,
  },
});
