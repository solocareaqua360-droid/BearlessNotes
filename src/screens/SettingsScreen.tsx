import { useEffect, useRef, useState } from 'react';
import { useTheme, useStyles } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as LegacyFileSystem from 'expo-file-system/legacy';
import { backupFileToDrive } from '../utils/googleDrive';
import StockPhotoPicker from '../components/StockPhotoPicker';
import {
  ActivityIndicator,
  Image,
  PanResponder,
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
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
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
import { getGeminiKey, setGeminiKey } from '../utils/geminiKey';
import {
  useThemeChoice,
  useBackdropSettings,
  useFontScaleSettings,
  TEXT_SCALE_RANGE,
  UI_SCALE_RANGE,
  type BackdropOverride,
} from '../theme/ThemeProvider';
import { THEMES, THEME_ORDER, type ThemeKey } from '../theme/tokens';
import { ask, confirm, notify } from '../components/surfaces/Ask';
import RenamePrompt from '../components/RenamePrompt';
import ColorPickerSheet from '../components/ColorPickerSheet';

// The app's own warm action colour (the one RenamePrompt's save button
// and the browser's sign-in use), not the system blue this screen was
// left with.
const ACCENT = '#F5C77E';
const DANGER = '#EF4444';

const SECTION_TITLES: Record<'menu' | 'account' | 'appearance' | 'integrations' | 'about', string> = {
  menu: 'Налаштування',
  account: 'Обліковий запис',
  appearance: 'Зовнішній вигляд',
  integrations: 'Інтеграції',
  about: 'Про застосунок',
};
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

// A plain 0-100 slider - nothing like it exists elsewhere in this app
// yet, so it lives here rather than as a shared component until a
// second caller actually needs one. PanResponder rather than
// gesture-handler: one drag, no competing scroll/swipe to arbitrate
// against, the same reasoning SketchEditor's own toolbar drag uses.
function BlurSlider({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const theme = useTheme();
  const [trackWidth, setTrackWidth] = useState(0);
  const valueRef = useRef(value);
  valueRef.current = value;
  const responder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderMove: (e) => {
        if (trackWidth <= 0) return;
        const x = e.nativeEvent.locationX;
        onChange(Math.round(Math.max(0, Math.min(1, x / trackWidth)) * 100));
      },
    })
  ).current;
  return (
    <View
      style={{ height: 32, justifyContent: 'center' }}
      onLayout={(e) => setTrackWidth(e.nativeEvent.layout.width)}
      {...responder.panHandlers}
    >
      <View style={{ height: 4, borderRadius: 2, backgroundColor: theme.edge.hairline }}>
        <View
          style={{
            height: 4,
            borderRadius: 2,
            width: `${value}%`,
            backgroundColor: theme.ink.primary,
          }}
        />
      </View>
      <View
        pointerEvents="none"
        style={{
          position: 'absolute',
          left: `${value}%`,
          marginLeft: -8,
          width: 16,
          height: 16,
          borderRadius: 8,
          backgroundColor: theme.ink.primary,
        }}
      />
    </View>
  );
}

export default function SettingsScreen() {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  // Absent -> the menu; present -> just that section's cards. See
  // navigation.ts's own comment on why this is one screen, not five.
  const section = useRoute<RouteProp<RootStackParamList, 'Settings'>>().params?.section;
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
  // Same shape as the Pexels key just above - a credential only the user
  // can create, device-local for the same reason (see utils/geminiKey).
  // Powers the chat's "Запитати Gemini".
  const [geminiKey, setGeminiKeyState] = useState<string | null | undefined>(undefined);
  const [enteringGeminiKey, setEnteringGeminiKey] = useState(false);
  useEffect(() => {
    getGeminiKey().then(setGeminiKeyState);
  }, []);

  // The custom backdrop - see BackdropOverride (ThemeProvider). Local
  // draft state, same reason RenamePrompt's own field is local: writing
  // every keystroke/drag to Firestore would be both slow and noisy, so
  // this only calls setBackdropSettings when a change is actually
  // finished (a colour chosen, a stop added/removed, a slider released).
  // "Розмір тексту" / "Розмір інтерфейсу" - two independent scales, per
  // the plan discussed and agreed: text (reading surfaces - a note's
  // body, list titles) gets a generous range since those containers
  // simply grow taller; ui (dock/menu chrome - tight, fixed-size rows)
  // gets a narrow one, since that is where an icon stops fitting beside
  // its word. BOTH sliders are 0-100 like BlurSlider already is; the
  // mapping to the real range happens only at the read/write edges.
  const { fontScale, setFontScale } = useFontScaleSettings();
  const toSliderPct = (value: number, range: [number, number]) =>
    Math.round(((value - range[0]) / (range[1] - range[0])) * 100);
  const fromSliderPct = (pct: number, range: [number, number]) =>
    Math.round((range[0] + (pct / 100) * (range[1] - range[0])) * 100) / 100;

  const { backdropSettings, setBackdropSettings } = useBackdropSettings();
  const [backdropMode, setBackdropMode] = useState<'default' | 'gradient' | 'image'>(
    backdropSettings.override?.type ?? 'default'
  );
  const [gradientColors, setGradientColors] = useState<string[]>(
    backdropSettings.override?.type === 'gradient' ? backdropSettings.override.colors : ['#705648', '#69736E']
  );
  const [gradientBlur, setGradientBlur] = useState(
    backdropSettings.override?.type === 'gradient' ? backdropSettings.override.blur : 0
  );
  const [editingStopIndex, setEditingStopIndex] = useState<number | null>(null);
  const [pickingBackdropImage, setPickingBackdropImage] = useState(false);
  const [searchingBackdropImage, setSearchingBackdropImage] = useState(false);
  // The same two doors the note's own cover and the tile board's own
  // backgrounds already open - see StockPhotoPicker/pickCoverImage. A
  // plain effect rather than calling ask() straight from the render
  // body, which would fire a fresh question on every re-render while
  // the flag stayed true.
  useEffect(() => {
    if (!pickingBackdropImage) return;
    ask({
      title: 'Звідки взяти зображення?',
      actions: [
        { id: 'gallery', label: 'Галерея', icon: 'images-outline' },
        { id: 'stock', label: 'Пошук зображень', icon: 'search-outline' },
      ],
    }).then((answer) => {
      setPickingBackdropImage(false);
      if (answer === 'gallery') pickBackdropImageFromGallery();
      else if (answer === 'stock') setSearchingBackdropImage(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pickingBackdropImage]);
  const [backdropBusy, setBackdropBusy] = useState(false);
  // Kept in sync with whatever's already saved, so re-opening Settings
  // shows the real picture rather than the mode's own placeholder.
  useEffect(() => {
    setBackdropMode(backdropSettings.override?.type ?? 'default');
    if (backdropSettings.override?.type === 'gradient') {
      setGradientColors(backdropSettings.override.colors);
      setGradientBlur(backdropSettings.override.blur);
    }
  }, [backdropSettings.override]);

  function toggleBackdropTheme(key: ThemeKey) {
    const appliesTo = backdropSettings.appliesTo.includes(key)
      ? backdropSettings.appliesTo.filter((k) => k !== key)
      : [...backdropSettings.appliesTo, key];
    setBackdropSettings({ ...backdropSettings, appliesTo });
  }

  function saveGradient(colors: string[], blur = gradientBlur) {
    setGradientColors(colors);
    setBackdropSettings({ ...backdropSettings, override: { type: 'gradient', colors, blur } });
  }

  function updateGradientBlur(blur: number) {
    setGradientBlur(blur);
    saveGradient(gradientColors, blur);
  }

  function addGradientStop() {
    if (gradientColors.length >= 4) return;
    saveGradient([...gradientColors, '#8A8A8A']);
  }

  function removeGradientStop() {
    if (gradientColors.length <= 2) return;
    saveGradient(gradientColors.slice(0, -1));
  }

  // Same compress step every image picker in this app already uses
  // (DocumentEditorScreen/PhotosScreen each have their own copy) - a
  // multi-megabyte photo shouldn't sit in Firestore's settings doc at
  // full camera resolution just to be a blurred backdrop.
  async function compressBackdropImage(uri: string, width: number, height: number): Promise<string> {
    const MAX_DIMENSION = 1600;
    try {
      const longest = Math.max(width, height);
      let context = ImageManipulator.manipulate(uri);
      if (longest > MAX_DIMENSION) {
        const scale = MAX_DIMENSION / longest;
        context = context.resize({ width: Math.round(width * scale), height: Math.round(height * scale) });
      }
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
      return saved.uri;
    } catch {
      return uri;
    }
  }

  // A STABLE path, not the picker's own temp file - so useCachedAttachment
  // (ScreenBackdrop) can restore the SAME uri from Drive on a device that
  // never picked an image itself. One file, always this name: a new pick
  // simply overwrites it.
  async function setBackdropImage(sourceUri: string, width: number, height: number) {
    setBackdropBusy(true);
    try {
      const compressed = await compressBackdropImage(sourceUri, width, height);
      const stableUri = `${LegacyFileSystem.documentDirectory}app-backdrop.jpg`;
      await LegacyFileSystem.copyAsync({ from: compressed, to: stableUri }).catch(async () => {
        // copyAsync refuses to overwrite on some platforms - delete first.
        await LegacyFileSystem.deleteAsync(stableUri, { idempotent: true });
        await LegacyFileSystem.copyAsync({ from: compressed, to: stableUri });
      });
      const override: BackdropOverride = {
        type: 'image',
        uri: stableUri,
        blur: backdropSettings.override?.type === 'image' ? backdropSettings.override.blur : 40,
      };
      setBackdropSettings({ ...backdropSettings, override });
      setBackdropMode('image');
      // Backed up quietly, after the picture is already on screen - the
      // same order tile backgrounds and photo uploads already use.
      backupFileToDrive(stableUri, 'app-backdrop.jpg', 'image/jpeg', 'Files').then((uploaded) => {
        if (uploaded) {
          setBackdropSettings({
            ...backdropSettings,
            override: { ...override, driveFileId: uploaded.fileId },
          });
        }
      });
    } catch (e) {
      notify('Не вдалося встановити фон', (e as Error).message);
    } finally {
      setBackdropBusy(false);
    }
  }

  async function pickBackdropImageFromGallery() {
    setPickingBackdropImage(false);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    await setBackdropImage(asset.uri, asset.width, asset.height);
  }

  function updateBackdropBlur(blur: number) {
    if (backdropSettings.override?.type !== 'image') return;
    setBackdropSettings({ ...backdropSettings, override: { ...backdropSettings.override, blur } });
  }

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
          <Text style={styles.header}>{SECTION_TITLES[section ?? 'menu']}</Text>
        </View>

        {/* No section chosen yet - the menu itself, phone-settings style:
            "думаю, що меню це налаштувань треба розділити, як воно вже є
            в телефоні". Each row pushes a SECOND instance of this exact
            screen with its own `section` param - see navigation.ts - so
            the back chevron above returns here for free, no extra
            wiring. */}
        {!section && (
          <View style={styles.menuList}>
            {(
              [
                { id: 'account', icon: 'person-circle-outline', label: 'Обліковий запис' },
                { id: 'appearance', icon: 'color-palette-outline', label: 'Зовнішній вигляд' },
                { id: 'integrations', icon: 'key-outline', label: 'Інтеграції' },
                { id: 'about', icon: 'information-circle-outline', label: 'Про застосунок' },
              ] as const
            ).map((row) => (
              <Pressable
                key={row.id}
                style={styles.menuRow}
                onPress={() => navigation.push('Settings', { section: row.id })}
              >
                <Ionicons name={row.icon} size={22} color={ACCENT} />
                <Text style={styles.menuRowLabel}>{row.label}</Text>
                <Ionicons name="chevron-forward" size={18} color="rgba(255,255,255,0.4)" />
              </Pressable>
            ))}
          </View>
        )}

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
        {section === 'appearance' && (
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
        )}

        {section === 'account' && (
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
        )}

        {section === 'about' && (
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
        )}

        {section === 'integrations' && (
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
        )}

        {section === 'integrations' && (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="sparkles-outline" size={22} color={ACCENT} />
            <Text style={styles.cardTitle}>Gemini у чаті</Text>
          </View>
          {geminiKey ? (
            <>
              <Text style={styles.cardBody}>Ключ Gemini підключено</Text>
              <Text style={styles.cardHint}>
                У «Загальному чаті» довге натискання на повідомлення відкриває «Запитати Gemini» - відповідь
                приходить окремим повідомленням знизу, її теж можна забрати в нотатку.
              </Text>
              <Pressable style={styles.checkButton} onPress={() => setEnteringGeminiKey(true)} disabled={busy}>
                <Text style={styles.checkLabel}>Змінити ключ</Text>
              </Pressable>
              <Pressable
                style={styles.disconnectButton}
                onPress={async () => {
                  const yes = await confirm({
                    title: 'Прибрати ключ Gemini?',
                    message: '«Запитати Gemini» знову проситиме ключ, коли знадобиться.',
                    confirmLabel: 'Прибрати',
                  });
                  if (!yes) return;
                  await setGeminiKey(null);
                  setGeminiKeyState(null);
                }}
              >
                <Text style={styles.disconnectLabel}>Прибрати</Text>
              </Pressable>
            </>
          ) : (
            <>
              <Text style={styles.cardHint}>
                Необовʼязково: додай безкоштовний ключ з aistudio.google.com/apikey, щоб «Загальний чат» міг
                питати Gemini про окреме повідомлення - відповідь прийде повідомленням знизу. Ключ лишається
                тільки на цьому пристрої. Варто самим перевірити умови безкоштовного тарифу щодо навчання моделі
                на тому, що ти надсилаєш - це другий мозок, а не чернетка.
              </Text>
              <Pressable style={styles.connectButton} onPress={() => setEnteringGeminiKey(true)} disabled={busy}>
                <Text style={styles.connectLabel}>Додати ключ Gemini</Text>
              </Pressable>
            </>
          )}
        </View>
        )}

        {/* "хочу можливість вибирати і налаштовувати кольоровий градієнт
            фону від 2 до 4 кольорів переходу. також хочу мати можливість
            поставити свою картинку на фон і задати їй рівень блюру.
            також можна вибрати через галочки в яких з тем застосовувати
            цей фон а в якій залишити стандартний." One override, not one
            per theme - see BackdropOverride/ThemeProvider. */}
        {section === 'appearance' && (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="color-palette-outline" size={22} color={ACCENT} />
            <Text style={styles.cardTitle}>Фон застосунку</Text>
          </View>
          <Text style={styles.cardHint}>
            Свій фон замість того, що дає тема - градієнт із власними кольорами або картинка з розмиттям.
          </Text>
          <View style={{ flexDirection: 'row', gap: 8, marginTop: 10 }}>
            {(
              [
                { id: 'default', label: 'Стандартний' },
                { id: 'gradient', label: 'Градієнт' },
                { id: 'image', label: 'Зображення' },
              ] as const
            ).map((opt) => (
              <Pressable
                key={opt.id}
                style={[styles.themeChip, backdropMode === opt.id && styles.themeChipOn]}
                onPress={() => {
                  setBackdropMode(opt.id);
                  if (opt.id === 'default') {
                    setBackdropSettings({ ...backdropSettings, override: null });
                  } else if (opt.id === 'gradient' && backdropSettings.override?.type !== 'gradient') {
                    saveGradient(gradientColors);
                  }
                }}
              >
                <Text style={[styles.themeChipLabel, backdropMode === opt.id && styles.themeChipLabelOn]}>
                  {opt.label}
                </Text>
              </Pressable>
            ))}
          </View>

          {backdropMode === 'gradient' && (
            <>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, flexWrap: 'wrap' }}>
                {gradientColors.map((c, i) => (
                  <Pressable key={i} onPress={() => setEditingStopIndex(i)}>
                    <View
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: 20,
                        backgroundColor: c,
                        borderWidth: 1,
                        borderColor: 'rgba(255,255,255,0.3)',
                      }}
                    />
                  </Pressable>
                ))}
                <Pressable
                  style={[styles.backdropStopButton, gradientColors.length >= 4 && styles.backdropStopButtonOff]}
                  onPress={addGradientStop}
                  disabled={gradientColors.length >= 4}
                >
                  <Ionicons name="add" size={16} color={theme.ink.primary} />
                </Pressable>
                <Pressable
                  style={[styles.backdropStopButton, gradientColors.length <= 2 && styles.backdropStopButtonOff]}
                  onPress={removeGradientStop}
                  disabled={gradientColors.length <= 2}
                >
                  <Ionicons name="remove" size={16} color={theme.ink.primary} />
                </Pressable>
              </View>
              <Text style={styles.cardHint}>Торкнись кружечка, щоб відкрити вибір кольору. Від 2 до 4 кольорів.</Text>
              <Text style={[styles.cardHint, { marginTop: 14 }]}>Розмиття поверх градієнта (матове скло)</Text>
              <BlurSlider value={gradientBlur} onChange={updateGradientBlur} />
            </>
          )}

          {backdropMode === 'image' && (
            <>
              {backdropSettings.override?.type === 'image' ? (
                <>
                  <Image
                    source={{ uri: backdropSettings.override.uri }}
                    style={styles.backdropImagePreview}
                    resizeMode="cover"
                  />
                  <Text style={[styles.cardHint, { marginTop: 8 }]}>Рівень розмиття (матове скло)</Text>
                  <BlurSlider
                    value={backdropSettings.override.blur}
                    onChange={updateBackdropBlur}
                  />
                  <Pressable
                    style={styles.checkButton}
                    onPress={() => setPickingBackdropImage(true)}
                    disabled={backdropBusy}
                  >
                    <Text style={styles.checkLabel}>Змінити зображення</Text>
                  </Pressable>
                </>
              ) : (
                <Pressable
                  style={styles.connectButton}
                  onPress={() => setPickingBackdropImage(true)}
                  disabled={backdropBusy}
                >
                  {backdropBusy ? (
                    <ActivityIndicator color="#111827" />
                  ) : (
                    <Text style={styles.connectLabel}>Вибрати зображення</Text>
                  )}
                </Pressable>
              )}
            </>
          )}

          {backdropMode !== 'default' && (
            <>
              <Text style={[styles.cardHint, { marginTop: 14 }]}>Застосувати цей фон у темах:</Text>
              <View style={{ gap: 8, marginTop: 6 }}>
                {THEME_ORDER.map((key) => (
                  <Pressable
                    key={key}
                    style={styles.backdropThemeRow}
                    onPress={() => toggleBackdropTheme(key)}
                  >
                    <Ionicons
                      name={backdropSettings.appliesTo.includes(key) ? 'checkbox' : 'square-outline'}
                      size={20}
                      color={backdropSettings.appliesTo.includes(key) ? ACCENT : theme.ink.muted}
                    />
                    <Text style={styles.cardBody}>{THEMES[key].name}</Text>
                  </Pressable>
                ))}
              </View>
            </>
          )}
        </View>
        )}

        {/* "хочу можливість збільшувати шрифти, але не так, щоб у мене
            потім в іконки не влазило... окремо для карток, для меню" -
            two scales, never one, agreed in discussion before this was
            built. See useTextScale/useUiScale. */}
        {section === 'appearance' && (
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Ionicons name="text-outline" size={22} color={ACCENT} />
            <Text style={styles.cardTitle}>Розмір шрифту</Text>
          </View>

          <Text style={styles.cardHint}>Розмір тексту, який ти читаєш - тіло нотатки, назви в списку документів.</Text>
          <Text style={[styles.cardBody, { fontSize: Math.round(16 * fontScale.text), marginTop: 6 }]}>
            Зразок тексту нотатки
          </Text>
          <BlurSlider
            value={toSliderPct(fontScale.text, TEXT_SCALE_RANGE)}
            onChange={(pct) => setFontScale({ ...fontScale, text: fromSliderPct(pct, TEXT_SCALE_RANGE) })}
          />

          <Text style={[styles.cardHint, { marginTop: 16 }]}>
            Розмір інтерфейсу - слова в доку й меню. Діапазон вужчий навмисно, щоб слово не наїжджало на іконку поруч.
          </Text>
          <View style={styles.uiScalePreviewRow}>
            <Ionicons name="search-outline" size={17} color={theme.ink.primary} />
            <Text style={[styles.uiScalePreviewLabel, { fontSize: Math.round(11 * fontScale.ui) }]} numberOfLines={1}>
              Пошук
            </Text>
          </View>
          <BlurSlider
            value={toSliderPct(fontScale.ui, UI_SCALE_RANGE)}
            onChange={(pct) => setFontScale({ ...fontScale, ui: fromSliderPct(pct, UI_SCALE_RANGE) })}
          />
        </View>
        )}
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

      <RenamePrompt
        visible={enteringGeminiKey}
        title="Ключ Gemini"
        initialValue={geminiKey ?? ''}
        placeholder="Встав ключ із aistudio.google.com/apikey"
        onCancel={() => setEnteringGeminiKey(false)}
        onSave={async (value) => {
          setEnteringGeminiKey(false);
          const trimmed = value.trim();
          if (!trimmed) return;
          await setGeminiKey(trimmed);
          setGeminiKeyState(trimmed);
        }}
      />

      <ColorPickerSheet
        visible={editingStopIndex !== null}
        title={`Колір ${(editingStopIndex ?? 0) + 1}`}
        initialColor={editingStopIndex !== null ? gradientColors[editingStopIndex] : '#705648'}
        onCancel={() => setEditingStopIndex(null)}
        onSave={(hex) => {
          const i = editingStopIndex;
          setEditingStopIndex(null);
          if (i === null) return;
          const next = [...gradientColors];
          next[i] = hex;
          saveGradient(next);
        }}
      />

      <StockPhotoPicker
        visible={searchingBackdropImage}
        onClose={() => setSearchingBackdropImage(false)}
        onPicked={(uri) => {
          setSearchingBackdropImage(false);
          Image.getSize(
            uri,
            (width, height) => {
              setBackdropImage(uri, width, height);
            },
            () => notify('Не вдалося встановити фон', 'Не визначився розмір зображення')
          );
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
  backdropStopButton: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.28)',
  },
  backdropStopButtonOff: {
    opacity: 0.35,
  },
  backdropImagePreview: {
    width: '100%',
    height: 100,
    borderRadius: 12,
    marginTop: 10,
    backgroundColor: t.surface,
  },
  backdropThemeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  uiScalePreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 10,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.06)',
  },
  uiScalePreviewLabel: {
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.primary,
  },
  menuList: {
    gap: 10,
    marginBottom: 20,
  },
  menuRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 14,
    backgroundColor: 'rgba(24,21,19,0.42)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  menuRowLabel: {
    flex: 1,
    fontSize: 16,
    fontFamily: FONT_SEMIBOLD,
    color: '#fff',
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
