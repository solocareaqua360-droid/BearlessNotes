import { enableScreens } from 'react-native-screens';
import { MOTION, deskGlass } from './src/theme/desktopTheme';
import { RADIUS } from './src/theme/scale';
import UnderToolbar from './src/components/desktop/UnderToolbar';
import { inShell } from './src/navigation/desktopTabs';
import { softTokens } from './src/theme/soft';
import { IS_POINTER } from './src/utils/pointer';
import { useEffect, useState, type ReactNode } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  useFonts,
  Nunito_400Regular,
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
import { Inter_400Regular, Inter_500Medium, Inter_600SemiBold, Inter_700Bold } from '@expo-google-fonts/inter';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { DefaultTheme, NavigationContainer, Theme as NavTheme } from '@react-navigation/native';
import { auth, ensureSignedIn, signInWithGoogleAccount, signOutEverywhere } from './src/firebase';
// Straight at the web file, not through './src/firebase'. That path is
// resolved by the bundler per platform, so TypeScript reads the PHONE's
// module for it - and this export exists only on the browser side. Both
// specifiers land on the same file here, so it is the same module.
import { signInForHandoff } from './src/firebase.web';
import { onAuthStateChanged } from 'firebase/auth';
import RootNavigator from './src/AppNavigator';
import { navigationRef } from './src/navigationRef';
import { navigateToTarget } from './src/navigation/paneTargetInfo';
import type { PaneTarget } from './src/navigation/paneTarget';
import { AskHost } from './src/components/surfaces/Ask';
import CaptureWindow from './src/components/CaptureWindow';
import BoardPreviewCaptureHost from './src/components/BoardMiniature';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { GlassTargetProvider } from './src/components/GlassTarget';
import { GlassPortalHost } from './src/components/GlassPortal';
import CrashBoundary from './src/components/CrashBoundary';
import FatalErrorOverlay from './src/components/FatalErrorOverlay';
import ContextDock from './src/components/ContextDock';
import DesktopRail from './src/components/DesktopRail';
import RightColumn from './src/components/desktop/RightColumn';
import StartPage, { CreateWatcher } from './src/components/desktop/StartPage';
import { useStartFront } from './src/navigation/desktopTabs';
import { WorkspaceProvider } from './src/navigation/workspace';
import { InnerBackProvider } from './src/navigation/innerBack';
import DesktopToolbar from './src/components/DesktopToolbar';
import DesktopTabs, { TabStepper } from './src/components/DesktopTabs';
import { useDensity } from './src/hooks/useDensity';
import { NavDockProvider } from './src/navigation/navDock';
import {
  adoptDriveToken,
  driveNeeded,
  driveTokenError,
  exportDriveToken,
  getDriveToken,
  hasDriveToken,
  subscribeToDriveToken,
} from './src/utils/driveToken.web';
import { prefetchState, startOfflinePrefetch, subscribeToPrefetch } from './src/utils/offlineCache.web';
import { onDesktopCommand } from './src/utils/desktopCommands';
import {
  HandoffKind,
  handoffRequest,
  isDesktopShell,
  reportToShell,
  requestFromBrowser,
} from './src/utils/desktopBridge.web';

// The browser build: the whole app.
//
// It began as the board and nothing else, on the reasoning that every
// other screen brought a native module with it - the editor a scanner
// and a text recogniser, the file list a quick look, settings a Google
// sign-in module. That reasoning held until each of those got a `.web`
// sibling, at which point the only thing keeping the screens out was a
// navigator here that had never heard of them.
//
// So this mounts the same tree the phone does (src/AppNavigator), and
// what the browser leaves out is decided file by file, in .web siblings,
// never route by route here. What this file owns is the browser's own
// wrapping: the sign-in gate, the account bar, the crash boundary.

const styles = StyleSheet.create({
  centre: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    padding: 32,
    backgroundColor: '#171310',
  },
  title: {
    fontSize: 28,
    fontFamily: 'Nunito_700Bold',
    color: '#fff',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    fontFamily: 'Nunito_400Regular',
    color: 'rgba(255,255,255,0.62)',
    textAlign: 'center',
    maxWidth: 380,
  },
  error: {
    fontSize: 13,
    fontFamily: 'Nunito_400Regular',
    color: '#FB7185',
    textAlign: 'center',
    maxWidth: 380,
  },
  button: {
    marginTop: 6,
    backgroundColor: '#F5C77E',
    borderRadius: 18,
    paddingVertical: 14,
    paddingHorizontal: 28,
    minWidth: 220,
    alignItems: 'center',
  },
  buttonLabel: {
    fontSize: 16,
    fontFamily: 'Nunito_600SemiBold',
    color: '#171310',
  },
  deskRow: {
    flex: 1,
    flexDirection: 'row',
  },
  deskBody: {
    flex: 1,
    minWidth: 0,
  },
  toolbarOver: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    zIndex: 10,
  },
  driveBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#171310',
  },
  // In the rail it is a column, on the app's own paper rather than the
  // black strip - the black was there to separate a bar from the screen
  // under it, and at the foot of a sidebar there is nothing to separate
  // it from.
  driveBarRail: {
    flexDirection: 'column',
    alignItems: 'stretch',
    justifyContent: 'flex-start',
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 12,
    backgroundColor: 'transparent',
  },
  driveTextRail: {
    fontSize: 13,
    textAlign: 'left',
  },
  driveText: {
    fontSize: 13,
    fontFamily: 'Nunito_400Regular',
    color: 'rgba(255,255,255,0.62)',
  },
  linkButton: {
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  linkLabel: {
    fontSize: 13,
    fontFamily: 'Nunito_600SemiBold',
    color: '#F5C77E',
  },
  driveButton: {
    backgroundColor: '#F5C77E',
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 16,
  },
  driveButtonLabel: {
    fontSize: 13,
    fontFamily: 'Nunito_600SemiBold',
    color: '#171310',
  },
});

// The navigator paints its own card behind every screen, and its default
// theme's is WHITE - see App.tsx, where the same patches showed through
// on a rotation.
// The account strip's words. They were drawn for the phone's dark bar
// (white at 62%, a pale gold link) and vanished on the light sidebar, so
// in the rail they take the theme's own ink instead.
function AccountText({
  rail,
  link,
  lines,
  children,
}: {
  rail: boolean;
  link?: boolean;
  lines?: number;
  children: React.ReactNode;
}) {
  const theme = useTheme();
  const base = link ? styles.linkLabel : styles.driveText;
  return (
    <Text
      style={[base, rail && styles.driveTextRail, rail && { color: link ? theme.accent : theme.ink.muted }]}
      numberOfLines={lines}
    >
      {children}
    </Text>
  );
}

// The browser's own focus ring on a text field - the orange box round the
// block being written in - is not part of the design (there is no active-
// block border anywhere in the editor's styles). It was kept while the web
// editor was being tested (2026-09-14) and is gone now, at the user's word
// (2026-10-01): the caret says where the writing is.
// A tab the navigator is not showing stands BEHIND the one it is, and only
// the front screen's solid ground used to hide it. In the Mac app grounds are
// glass, and the documents list showed through the boards (2026-10-01). With
// react-native-screens switched on, an inactive tab is display: none - the
// navigators already say which one that is.
if (inShell()) enableScreens(true);

if (typeof document !== 'undefined') {
  // In the Mac app the window is transparent (vibrancy - see desktop/main.js):
  // the page leaves its own ground unpainted, so what is not painted by a
  // screen shows the macOS material. Only the rail leaves it showing.
  if (inShell()) {
    const clear = document.createElement('style');
    clear.textContent =
      'html, body, #root { background: transparent !important; }' +
      // The window is moved by its empty top (the tab row, the toolbar's
      // band, a panel's header - see DRAG where they are drawn), and in a
      // region that moves the window nothing is clickable unless it says
      // so. Everything that can be clicked or typed in says so here, once.
      ' [role="button"], [role="link"], [tabindex], button, a, input, textarea, select { -webkit-app-region: no-drag; }';
    document.head.appendChild(clear);
  }
  const noRing = document.createElement('style');
  noRing.textContent =
    'textarea:focus, input:focus, textarea:focus-visible, input:focus-visible { outline: none !important; }' +
    // Soft, not sudden (2026-10-01, "тіні і підсвічування з'являються
    // різко"): a hover's fill, a picked block's tint, a tab coming to the
    // front, a shadow - every change of tone eases in and out. Only colour
    // and shadow: position and size are the animations' own business.
    (IS_POINTER
      ? ' div, span { transition: background-color 180ms ease, box-shadow 220ms ease, border-color 180ms ease, color 160ms ease, opacity 180ms ease; }' +
        // THE SOFT MOTION, stage 1 (see desktopTheme's MOTION):
        // - a card (data-lift) rises two points under the pointer and settles
        //   a hair smaller while pressed; a button settles too. Only where no
        //   inline transform is already moving it (a drag, a FLIP);
        // - what APPEARS (a menu, an alert, a sheet - data-fade-in) grows out
        //   of where it came from, and what LEAVES (data-fade-out) shrinks
        //   back and fades, a little quicker.
        ` [data-lift]:not([style*="transform"]) { transition: transform ${MOTION.base}ms ${MOTION.ease}, background-color 180ms ease, box-shadow ${MOTION.base}ms ease, opacity 180ms ease; }` +
        ' [data-lift]:not([style*="transform"]):hover { transform: translateY(-2px); }' +
        ` [data-lift]:not([style*="transform"]):active { transform: translateY(0) scale(0.985); transition-duration: ${MOTION.fast}ms; }` +
        ` [tabindex="0"]:not([data-lift]):not([style*="transform"]) { transition: transform ${MOTION.fast}ms ${MOTION.ease}, background-color 180ms ease, box-shadow 220ms ease, color 160ms ease, opacity 180ms ease; }` +
        ' [tabindex="0"]:not([data-lift]):not([style*="transform"]):active { transform: scale(0.96); }' +
        ` @keyframes mindevaFadeIn { from { opacity: 0; transform: scale(0.96) translateY(-3px); } to { opacity: 1; transform: none; } }` +
        ` @keyframes mindevaFadeOut { from { opacity: 1; transform: none; } to { opacity: 0; transform: scale(0.97) translateY(-2px); } }` +
        ` [data-fade-in] { animation: mindevaFadeIn ${MOTION.base}ms ${MOTION.ease}; transform-origin: top left; }` +
        ` [data-fade-out] { animation: mindevaFadeOut ${MOTION.out}ms ease-in forwards; transform-origin: top left; pointer-events: none; }` +
        ' [data-fade-in][data-origin="center"], [data-fade-out][data-origin="center"] { transform-origin: center; }' +
        // Stage 2 - the arrangement moves (utils/viewTransition): every named
        // piece goes from where it was to where it is on the one curve; the
        // main pane and the panels are never stretched on the way (their
        // pictures stay anchored at the top left and are clipped), a panel
        // that arrives slides in from the right, one that goes slides out.
        ` ::view-transition-group(*) { animation-duration: ${MOTION.slow}ms; animation-timing-function: ${MOTION.ease}; }` +
        ` ::view-transition-old(*), ::view-transition-new(*) { animation-duration: ${MOTION.base}ms; }` +
        ' ::view-transition-old(desk-main), ::view-transition-new(desk-main), ::view-transition-old(desk-panels), ::view-transition-new(desk-panels), ::view-transition-old(*.panel), ::view-transition-new(*.panel) { height: 100%; width: auto; object-fit: none; object-position: left top; }' +
        ' ::view-transition-group(desk-main), ::view-transition-group(desk-panels), ::view-transition-group(*.panel) { overflow: clip; }' +
        ` @keyframes mindevaPanelIn { from { opacity: 0; transform: translateX(28px); } }` +
        ` @keyframes mindevaPanelOut { to { opacity: 0; transform: translateX(28px); } }` +
        ` ::view-transition-new(*.panel):only-child { animation: mindevaPanelIn ${MOTION.slow}ms ${MOTION.ease}; }` +
        ` ::view-transition-old(*.panel):only-child { animation: mindevaPanelOut ${MOTION.base}ms ease-in forwards; }` +
        // The card that becomes the page (utils/morph): both pictures keep
        // the width of the moving piece and their own proportions, so the
        // page arrives as the card's miniature growing to full size; the
        // piece keeps a card's corner all the way and clips the tall page.
        ` ::view-transition-group(morph) { border-radius: ${RADIUS.card}px; overflow: clip; }` +
        // Not a cross-fade: any two pictures of different scale seen through
        // each other read as doubled text (tried both ways, 2026-10-01).
        // A container transform instead - the leaving picture fades in the
        // first fifth, a plain card of the page's own colour (--morph-fill,
        // set by utils/morph) goes on growing, and the arriving picture
        // comes up in it. Never two texts at once.
        ` ::view-transition-group(morph) { background: var(--morph-fill, transparent); box-shadow: 0 6px 28px rgba(0, 0, 0, 0.08); }` +
        ' ::view-transition-image-pair(morph) { isolation: auto; }' +
        ' ::view-transition-old(morph), ::view-transition-new(morph) { mix-blend-mode: normal; }' +
        ' @keyframes mindevaMorphOld { 0% { opacity: 1; } 20%, 100% { opacity: 0; } }' +
        ' @keyframes mindevaMorphNew { 0%, 20% { opacity: 0; } 55%, 100% { opacity: 1; } }' +
        ` ::view-transition-old(morph) { animation: mindevaMorphOld ${MOTION.slow}ms linear both; }` +
        ` ::view-transition-new(morph) { animation: mindevaMorphNew ${MOTION.slow}ms ease-out both; }` +
        ' @media (prefers-reduced-motion: reduce) { div, span { transition: none !important; } [data-fade-in], [data-fade-out] { animation: none !important; } [data-lift]:hover, [data-lift]:active, [tabindex]:active { transform: none !important; } ::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation: none !important; } }'
      : '');
  document.head.appendChild(noRing);
}

// The main pane's own ground, painted here: in the Mac app the window itself
// is transparent (vibrancy - desktop/main.js), and only the rail is meant to
// let the desktop show through. Inside the theme, to read its scheme.
function DeskGround({ children }: { children: ReactNode }) {
  // In the Mac app, the main ground's glass - the clearest of the window's.
  const ground = deskGlass(softTokens(useTheme().scheme)).main;
  // Named, so a change of the arrangement moves it (see utils/viewTransition).
  return <View style={[styles.deskBody, { backgroundColor: ground }, { viewTransitionName: 'desk-main' } as never]}>{children}</View>;
}

function StartPageHost() {
  const front = useStartFront();
  return (
    <>
      <CreateWatcher />
      {front && <StartPage />}
    </>
  );
}

function ThemedNavigationContainer({ children }: { children: React.ReactNode }) {
  const theme = useTheme();
  const navTheme: NavTheme = {
    ...DefaultTheme,
    dark: theme.scheme === 'dark',
    colors: { ...DefaultTheme.colors, background: theme.ground, card: theme.surface, text: theme.ink.primary },
  };
  return (
    <NavigationContainer ref={navigationRef} theme={navTheme}>
      {children}
    </NavigationContainer>
  );
}

// The browser half of the desktop handoff, and the whole of what that
// tab is for. It is not the app: the shell opened this window with one
// job, and when the job is done the window says so and can be closed.
//
// Why a button rather than starting on its own: signing in opens
// Google's own window, and a browser opens one only in answer to a
// click. Arriving here and immediately asking would be blocked, and the
// blocking is silent.
function HandoffScreen({ request }: { request: { kind: HandoffKind; hint: string | null } }) {
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      if (request.kind === 'signin') {
        const { idToken, email } = await signInForHandoff();
        // Drive in the same trip. It is a separate grant from a separate
        // Cloud project (see driveToken.web), so it is a second window -
        // but the account has just been chosen, and carrying it as a
        // hint leaves that window nothing to ask but permission.
        await getDriveToken(true, email).catch(() => null);
        await reportToShell({ kind: 'signin', idToken, email, driveToken: exportDriveToken() });
      } else {
        await getDriveToken(true, request.hint);
        const granted = exportDriveToken();
        if (!granted) throw new Error(driveTokenError() ?? 'Диск не відповів');
        await reportToShell({ kind: 'drive', driveToken: granted });
      }
      setDone(true);
    } catch (e) {
      const message = (e as Error).message;
      setError(message);
      // The application is waiting, and a failure it never hears about
      // leaves it waiting the full three minutes for nothing.
      await reportToShell({ kind: request.kind, error: message }).catch(() => false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.centre}>
      <Text style={styles.title}>mindEva</Text>
      {done ? (
        <Text style={styles.body}>
          Готово. Повернись у програму mindEva - вона вже підхопила вхід. Цю вкладку можна закрити.
        </Text>
      ) : (
        <Text style={styles.body}>
          {request.kind === 'signin'
            ? 'Програма для Mac не може показати вікно Google у себе всередині - Google цього не дозволяє. Тому вхід відбувається тут, у твоєму браузері, а програма отримає готовий результат.'
            : 'Підтверди доступ до Google Диска тут, у браузері - програма отримає результат сама.'}
        </Text>
      )}
      {!!error && <Text style={styles.error}>{error}</Text>}
      {!done && (
        <Pressable style={styles.button} disabled={busy} onPress={run}>
          {busy ? (
            <ActivityIndicator color="#171310" />
          ) : (
            <Text style={styles.buttonLabel}>
              {request.kind === 'signin' ? 'Увійти через Google' : 'Підключити Диск'}
            </Text>
          )}
        </Pressable>
      )}
    </View>
  );
}

export default function App() {
  const [fontsLoaded] = useFonts({
    Nunito_400Regular,
    Nunito_500Medium,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
    // The soft style's face (see theme/soft), tried on the Documents
    // desk first.
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  // Three states, not two: still asking, signed in, and signed out. The
  // browser has no identity of its own to fall back on - see firebase.web.
  const [user, setUser] = useState<{ email: string | null } | null | undefined>(undefined);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drive, setDrive] = useState(hasDriveToken());
  // In the macOS shell the bar waits until something has actually wanted
  // Drive - a picture that is not kept on this machine, or an upload
  // with nowhere to go. Attachments come off the disk there, so an
  // expired token usually means nothing at all, and the bar used to
  // come back every hour to ask for something the app did not need. In
  // an ordinary browser tab there is no disk, so it still asks at once.
  const [needsDrive, setNeedsDrive] = useState(!isDesktopShell());
  const [prefetch, setPrefetch] = useState(prefetchState());
  const pointer = useDensity() === 'pointer';
  // The strip in the rail's own dress wherever a mouse is; in a narrow rail it
  // opens from an icon (see DesktopRail).
  const railStrip = pointer;

  // Not a request - a look in the browser's storage for a token from
  // within the hour. Nothing is asked of Google here, because nothing
  // can be without a click (see driveToken.web); if one is there, the
  // pictures are simply there too.
  useEffect(() => {
    if (user) getDriveToken(false, user.email).then(() => setDrive(hasDriveToken()));
    return subscribeToDriveToken(() => {
      setDrive(hasDriveToken());
      setNeedsDrive(!isDesktopShell() || driveNeeded());
    });
  }, [user]);

  // Pull the whole library down in the background, once there is
  // someone to pull it for. See offlineCache.web: it is what makes a
  // note opened for the FIRST time on a train have its pictures.
  useEffect(() => {
    if (!user) return;
    const stopWatching = startOfflinePrefetch();
    const stopListening = subscribeToPrefetch(() => setPrefetch(prefetchState()));
    return () => {
      stopWatching();
      stopListening();
    };
  }, [user]);

  // A NEW WINDOW (the right button on a database: «Відкрити в новому вікні»)
  // is this same app at an address that says what to open. Once the
  // navigator is up, the main pane goes there - and the address is cleaned,
  // so a reload does not do it again.
  useEffect(() => {
    if (!user) return;
    let target: PaneTarget | null = null;
    try {
      const raw = new URLSearchParams(window.location.search).get('open');
      target = raw ? (JSON.parse(raw) as PaneTarget) : null;
    } catch {
      target = null;
    }
    if (!target) return;
    const wanted = target;
    const timer = setInterval(() => {
      if (!navigationRef.isReady()) return;
      clearInterval(timer);
      navigateToTarget(wanted);
      window.history.replaceState(null, '', `${window.location.pathname}?desktop=1`);
    }, 150);
    return () => clearInterval(timer);
  }, [user]);

  // The two menu commands that are only a navigation. «Новий документ»
  // is NOT here: it belongs to the list that knows which folder and
  // which project it is standing in - see DocumentsScreen.
  useEffect(() => {
    const go = (screen: 'Search' | 'Settings') => () => {
      if (navigationRef.isReady()) navigationRef.navigate(screen);
    };
    const stopSearch = onDesktopCommand('search', go('Search'));
    const stopSettings = onDesktopCommand('settings', go('Settings'));
    return () => {
      stopSearch();
      stopSettings();
    };
  }, []);

  useEffect(() => {
    ensureSignedIn();
    // An ANONYMOUS session does not count as signed in here, and that is
    // the whole point: the browser had one already - kept in the page's
    // own storage from before this screen existed - and it is exactly the
    // identity the owner-only rules must not accept. Having one is the
    // hole, not a way through it.
    return onAuthStateChanged(auth, (next) =>
      setUser(next && !next.isAnonymous ? { email: next.email } : null)
    );
  }, []);

  if (!fontsLoaded) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color="#F5C77E" />
      </View>
    );
  }

  // Opened by the macOS shell to do one thing and hand back the answer.
  // Checked before the session is: this tab has no session of its own
  // to wait for, and waiting for one would leave a spinner where the
  // button belongs. Not a hook, so it can sit below the ones above.
  const handoff = handoffRequest();
  if (handoff) return <HandoffScreen request={handoff} />;

  if (user === undefined) {
    return (
      <View style={styles.centre}>
        <ActivityIndicator color="#F5C77E" />
      </View>
    );
  }

  if (user === null) {
    return (
      <View style={styles.centre}>
        <Text style={styles.title}>mindEva</Text>
        <Text style={styles.body}>
          Увійди тим самим акаунтом Google, що й на телефоні - дошка та сама, дані ті самі.
        </Text>
        {!!error && <Text style={styles.error}>{error}</Text>}
        <Pressable
          style={styles.button}
          disabled={busy}
          onPress={async () => {
            setBusy(true);
            setError(null);
            try {
              await signInWithGoogleAccount();
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? (
            <ActivityIndicator color="#171310" />
          ) : (
            <Text style={styles.buttonLabel}>Увійти через Google</Text>
          )}
        </Pressable>
      </View>
    );
  }

  // The account strip, built once and placed twice: across the top
  // under a finger, at the foot of the rail under a cursor. Forty
  // points of full-width chrome for something looked at once a month
  // earns its place on a phone, which has no rail to put it in, and
  // does not on a Mac, where every sidebar in the world keeps the
  // account at the bottom.
  const accountStrip = (
    <View style={[styles.driveBar, railStrip && styles.driveBarRail]}>
      <AccountText rail={railStrip} lines={1}>
        {user.email ?? 'Акаунт Google'}
      </AccountText>
      {/* In the corner with the account, not across the middle: it
          repeats, it is nobody's business most of the time, and it
          goes away by itself when the folder is full. */}
      {prefetch.running && prefetch.total > 0 && (
        <AccountText rail={railStrip}>{`Готую офлайн: ${prefetch.done} з ${prefetch.total}`}</AccountText>
      )}
      <Pressable
        style={styles.linkButton}
        onPress={async () => {
          await signOutEverywhere();
          await signInWithGoogleAccount().catch(() => {});
        }}
      >
        <AccountText rail={railStrip} link>
          Змінити акаунт
        </AccountText>
      </Pressable>
      {/* The one click Drive costs in a browser, and it is a real
          cost rather than a leftover: Google's token client opens a
          popup, a browser allows a popup only from a click, and the
          token it gives lasts an hour. So this appears on a fresh
          browser, and again once an hour - and with the consent
          already given, the window it opens closes in the same
          moment. See driveToken.web for why there is no quieter way
          without a server, and the storage decision that was parked
          rather than made. */}
      {!drive && needsDrive && (
        <>
          <AccountText rail={railStrip} lines={2}>
            {/* The reason, when there is one. This bar used to say the
                same sentence whether Drive had never been asked, had
                refused, or had answered and been ignored - so a
                failure was indistinguishable from a fresh start, and
                the only way to find out was to guess. */}
            {driveTokenError() ?? 'Картинки лежать на Google Диску'}
          </AccountText>
          <Pressable
            style={styles.driveButton}
            onPress={async () => {
              // Same wall as signing in: inside the shell, Google
              // will not finish a grant in a window an application
              // drew. So the browser is asked and the token is
              // carried back - see desktopBridge.web.
              if (isDesktopShell()) {
                const granted = await requestFromBrowser('drive', user.email).catch(() => null);
                if (granted?.driveToken) adoptDriveToken(granted.driveToken);
              } else {
                await getDriveToken(true, user.email);
              }
              setDrive(hasDriveToken());
            }}
          >
            <Text style={styles.driveButtonLabel}>Підключити Диск</Text>
          </Pressable>
        </>
      )}
    </View>
  );

  return (
    // Same place the phone mounts it - see App.tsx.
    <ThemeProvider>
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        {/* Whose data this is, said out loud. It has to be: every read is
            narrowed to the owner now, so signing in as the wrong Google
            account - easy to do on a machine with two of them, since the
            popup used to pick one without asking - looks like an app with
            no boards in it rather than a mistake. An empty screen must
            never be the only way to find that out. */}
        {!pointer && accountStrip}
        {/* Below the account bar, not above it: a crash inside the board
            or the editor must still leave a way to change account or sign
            out, and the bar is that way. */}
        <CrashBoundary>
        <ThemedNavigationContainer>
          <NavDockProvider>
          <GlassPortalHost>
            <GlassTargetProvider>
              <AskHost />
            {/* «Загальний чат» - the window the dock's long press
                opens, already listening. Inside the blur target,
                like every other sheet. */}
            <CaptureWindow
              onOpenChat={() => {
                if (navigationRef.isReady()) navigationRef.navigate('Chat');
              }}
            />
            {/* See App.tsx: mounted once, here, so a board's own
                leave-time capture never races this side's navigation
                either. */}
            <BoardPreviewCaptureHost />
              {/* The whole app, not the board alone - the same tree the
                  phone mounts, from src/AppNavigator. What the browser
                  leaves out is chosen file by file (.web siblings), not
                  route by route here.

                  Beside a rail where a cursor is pointing, and the dock
                  stands down there: the dock is a bar at the bottom of
                  the screen, which is where a thumb rests and where a
                  cursor never goes. Where there is a finger, nothing
                  about this changes - see hooks/useDensity. */}
              {pointer ? (
                <WorkspaceProvider>
                <InnerBackProvider>
                <View style={styles.deskRow}>
                  <DesktopRail footer={accountStrip} />
                  <DeskGround>
                    {/* The dock, unrolled - the path on the left and
                        what this screen can do on the right, off the
                        same publications the dock reads. */}
                    {/* Above everything the screen says about itself:
                        the tabs are what you are switching BETWEEN, the
                        toolbar is about whichever one is in front. */}
                    <DesktopTabs />
                    <View style={styles.deskBody}>
                      <UnderToolbar>
                        <RootNavigator />
                      </UnderToolbar>
                      {/* Over the content, not above it - see UnderToolbar. */}
                      <View style={styles.toolbarOver} pointerEvents="box-none">
                        <DesktopToolbar />
                      </View>
                      {/* The new tab's page, over the navigator AND its
                          toolbar while it is the tab in front - see
                          StartPage. */}
                      <StartPageHost />
                      <TabStepper />
                    </View>
                  </DeskGround>
                  <RightColumn />
                </View>
                </InnerBackProvider>
                </WorkspaceProvider>
              ) : (
                <RootNavigator />
              )}
              {/* See App.tsx: inside the target, drawn by its own portal. */}
              {!pointer && <ContextDock />}
            </GlassTargetProvider>
          </GlassPortalHost>
          </NavDockProvider>
        </ThemedNavigationContainer>
        </CrashBoundary>
        {/* See App.tsx: the errors no boundary can catch. */}
        <FatalErrorOverlay />
      </GestureHandlerRootView>
    </SafeAreaProvider>
    </ThemeProvider>
  );
}
