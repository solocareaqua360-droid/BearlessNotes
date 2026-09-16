import { useEffect, useState } from 'react';
import { useTheme, useStyles } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
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
import Svg, { Defs, LinearGradient, Stop, Rect } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
// Safe to import here: the native module is already in every build of this
// app (that's what makes OTA updates work at all), so this adds nothing
// native and ships over the air like any other change.
import * as Updates from 'expo-updates';
import { doc, onSnapshot } from '../firestore';
import { auth, db, signInWithGoogleAccount } from '../firebase';
import {
  adoptSignedInAccountForDrive,
  connectGoogleDrive,
  disconnectGoogleDrive,
  DriveStorageQuota,
  getConnectedEmail,
  getDriveStorageQuota,
  isDriveConnected,
  runDriveDiagnostics,
} from '../utils/googleDrive';
import ContentColumn from '../components/ContentColumn';
import { RootStackParamList } from '../navigation';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { claimExistingData } from '../utils/claimOwnership';
import { backfillDriveCopies } from '../utils/backfillDrive';
import { STALE_AFTER_DAYS, localAttachmentUsage } from '../utils/attachmentCache';
import { chooseDownloadFolder, currentDownloadFolder } from '../utils/downloadToFolder';
import { getPexelsKey, setPexelsKey } from '../utils/pexelsKey';
import { useThemeChoice } from '../theme/ThemeProvider';
import { THEMES, THEME_ORDER } from '../theme/tokens';
import { confirm, notify } from '../components/surfaces/Ask';
import RenamePrompt from '../components/RenamePrompt';

// The app's own warm action colour (the one RenamePrompt's save button
// and the browser's sign-in use), not the system blue this screen was
// left with.
const ACCENT = '#F5C77E';
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
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { themeKey, setThemeKey } = useThemeChoice();
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
  // The one free-image key the app can use but cannot ship with (see
  // utils/pexelsKey) - undefined until it has been read once.
  const [pexelsKey, setPexelsKeyState] = useState<string | null | undefined>(undefined);
  const [enteringPexelsKey, setEnteringPexelsKey] = useState(false);
  useEffect(() => {
    getPexelsKey().then(setPexelsKeyState);
  }, []);

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
      // The same sign-in already carries Drive - see
      // adoptSignedInAccountForDrive. Said here so the Drive card stops
      // asking for something it has: one sign-in, not two.
      setEmail(await adoptSignedInAccountForDrive().catch(() => null));
      if (result.hadToSwitch) {
        notify('Увійшли в наявний акаунт', 'Цим акаунтом уже входили раніше, тож прив\'язати до нього дані цього пристрою не вийшло - вони лишились під попередньою анонімною особою.');
      }
      // Stamping ownership is what makes owner-only rules possible later.
      // Safe to re-run, and it now takes over documents left under some
      // other uid as well - an anonymous browser session had quietly
      // become the owner of three of them, «Дошка 1» included. See
      // claimExistingData for why that happens and why it must not stand.
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
      {/* The same gradient GroupsScreen is painted on - this screen is not
          a database and has no colour of its own, so it borrows the one
          the app's plain screens already share rather than inventing a
          third. */}
      <Svg
        width={windowWidth + 2}
        height={windowHeight + 2}
        style={[StyleSheet.absoluteFill, { top: -1, left: -1 }]}
        pointerEvents="none"
      >
        <Defs>
          <LinearGradient id="settingsBg" x1="0" y1="0" x2="0" y2="1">
            <Stop offset="0.03" stopColor="#705648" />
            <Stop offset="0.52" stopColor="#69736E" />
            <Stop offset="1" stopColor="#000000" />
          </LinearGradient>
        </Defs>
        <Rect width={windowWidth + 2} height={windowHeight + 2} fill="url(#settingsBg)" />
      </Svg>
      <ContentColumn>
        {/* Scrolls: on a narrow screen the three cards are taller than the
            window, and without this the last of them - and every button on
            it - simply could not be reached. */}
        <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.headerRow}>
          {/* This screen had no way out at all. On the phone the hardware
              back button hid that; in a browser there is no such button,
              no swipe-back gesture either, and the page was a dead end.
              Every other pushed screen carries this chevron - this one and
              TagManageScreen were the two that did not. */}
          <Pressable hitSlop={8} onPress={() => navigation.goBack()}>
            <Ionicons name="chevron-back" size={24} color="#fff" />
          </Pressable>
          <Text style={styles.header}>Налаштування</Text>
        </View>

        {/* The account everything belongs to - and, in the same card, the
            files that belong to it. These were two cards, "Обліковий
            запис" and "Google Drive", each naming the same email and
            each with its own button. Removing the duplicated email was
            not enough: two boxes still read as two things to sign into,
            which is what was being reported. There is one Google session
            on this device, so there is one card.

            First here deliberately: it is the one thing that decides what
            the app can see at all. */}
        {/* The theme. Three, and the choice follows the account rather
            than the device - see ThemeProvider. Slice 1 of the
            conversion: the switch works and is remembered; the screens
            themselves are converted to the contract after it, one weight
            at a time. */}
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="color-filter-outline" size={22} color={ACCENT} />
            <Text style={styles.cardTitle}>Тема</Text>
          </View>
          <View style={styles.themeRow}>
            {THEME_ORDER.map((key) => (
              <Pressable
                key={key}
                style={[styles.themeChip, themeKey === key && styles.themeChipOn]}
                onPress={() => setThemeKey(key)}
              >
                <Text style={[styles.themeChipLabel, themeKey === key && styles.themeChipLabelOn]}>
                  {THEMES[key].name}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.cardHint}>
            Кольорова - сьогоднішній вигляд. Біла й чорна поки що тільки вибираються: екрани
            переводяться на них зрізами, і кожен зріз я показую окремо.
          </Text>
        </View>

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
          {/* The one account, said once, and what the Drive part of this
              card is about. */}
          {!!accountEmail && (
            <View style={styles.trafficRow}>
              <Ionicons
                name={email ? 'cloud-done-outline' : 'cloud-offline-outline'}
                size={15}
                color="#6B7280"
              />
              <Text style={styles.trafficLabel}>
                {email ? 'Google Диск підключено цим же входом' : 'Диск не підключений'}
              </Text>
            </View>
          )}
          {claimStatus !== '' && <Text style={styles.cardHint}>{claimStatus}</Text>}
          <Pressable style={styles.checkButton} onPress={handleGoogleSignIn} disabled={authBusy}>
            {authBusy ? (
              <ActivityIndicator color={ACCENT} />
            ) : (
              <Text style={styles.checkLabel}>{accountEmail ? 'Змінити акаунт' : 'Увійти через Google'}</Text>
            )}
          </Pressable>
          {email ? (
            <>
              {/* The files half. No account named here - it is stated
                  once, at the top of this same card. */}
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
                Диск підключається тим самим входом - окремо входити не треба. Кнопка нижче потрібна лише тоді, коли
                дозвіл на файли чомусь не видали.
              </Text>
              <Pressable style={styles.connectButton} onPress={handleConnect} disabled={busy}>
                {busy ? <ActivityIndicator color="#fff" /> : <Text style={styles.connectLabel}>Дозволити доступ до файлів</Text>}
              </Pressable>
            </>
          )}
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
            <Ionicons name="image-outline" size={22} color={ACCENT} />
            <Text style={styles.cardTitle}>Пошук зображень</Text>
          </View>
          {pexelsKey ? (
            <>
              <Text style={styles.cardBody}>Ключ Pexels підключено</Text>
              <Text style={styles.cardHint}>
                Пошук фонів для плиток тепер має дві бібліотеки на вибір: відкриту (без ключа) і Pexels - фотографії
                там дібрані вручну, тому виглядають рівніше.
              </Text>
              <Pressable style={styles.checkButton} onPress={() => setEnteringPexelsKey(true)} disabled={busy}>
                <Text style={styles.checkLabel}>Змінити ключ</Text>
              </Pressable>
              <Pressable
                style={styles.disconnectButton}
                onPress={async () => {
                  const yes = await confirm({
                    title: 'Прибрати ключ Pexels?',
                    message: 'Пошук лишиться - але тільки на відкритій бібліотеці, без дібраних фотографій Pexels.',
                    confirmLabel: 'Прибрати',
                  });
                  if (!yes) return;
                  await setPexelsKey(null);
                  setPexelsKeyState(null);
                }}
              >
                <Text style={styles.disconnectLabel}>Прибрати</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.cardHint}>
                Пошук фонів для плиток уже працює без жодного ключа - на відкритій бібліотеці (суспільне надбання).
                Ключ Pexels не обовʼязковий: він додає другу бібліотеку, де фотографії дібрані вручну. Безкоштовно на
                pexels.com/api.
              </Text>
              <Pressable style={styles.connectButton} onPress={() => setEnteringPexelsKey(true)} disabled={busy}>
                <Text style={styles.connectLabel}>Додати ключ Pexels</Text>
              </Pressable>
            </>
          )}
        </View>
        </ScrollView>
      </ContentColumn>

      <RenamePrompt
        visible={enteringPexelsKey}
        title="Ключ Pexels"
        initialValue={pexelsKey ?? ''}
        placeholder="Встав ключ із pexels.com/api"
        onCancel={() => setEnteringPexelsKey(false)}
        onSave={async (value) => {
          setEnteringPexelsKey(false);
          const trimmed = value.trim();
          if (!trimmed) return;
          await setPexelsKey(trimmed);
          setPexelsKeyState(trimmed);
        }}
      />
    </View>
  );
}

// The same visual language the rest of the app already speaks - see
// GroupsScreen, which this is copied from rather than reinvented: a
// gradient the screen is painted on, a big white title with the back
// chevron beside it, and cards that are dark glass with a hairline
// edge. Settings was the last screen still wearing the default white
// card and system blue, which is why it read as a different app.
const makeStyles = (t: Theme) =>
  StyleSheet.create({
  container: {
    flex: 1,
  },
  content: {
    paddingBottom: 48,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 90,
    paddingBottom: 12,
  },
  header: {
    fontSize: 40,
    fontWeight: '700',
    fontFamily: FONT_BOLD,
    color: '#fff',
  },
  updateCard: {
    marginBottom: 14,
  },
  card: {
    marginHorizontal: 20,
    backgroundColor: 'rgba(20,20,20,0.35)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.18)',
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
    color: t.ink.primary,
  },
  cardBody: {
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
  },
  cardHint: {
    fontSize: 13,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
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
    color: t.ink.muted,
  },
  connectButton: {
    backgroundColor: ACCENT,
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  connectLabel: {
    color: '#171310',
    fontWeight: '600',
    fontFamily: FONT_SEMIBOLD,
    fontSize: 15,
  },
  themeRow: {
    flexDirection: 'row',
    gap: 8,
  },
  themeChip: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  themeChipOn: {
    borderColor: ACCENT,
    backgroundColor: 'rgba(245,199,126,0.16)',
  },
  themeChipLabel: {
    fontSize: 14,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.muted,
  },
  themeChipLabelOn: {
    color: t.ink.primary,
  },
  checkButton: {
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
    borderRadius: 10,
    paddingVertical: 10,
    alignItems: 'center',
    marginTop: 4,
  },
  checkLabel: {
    color: t.ink.primary,
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
