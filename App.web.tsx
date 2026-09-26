import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  useFonts,
  Nunito_400Regular,
  Nunito_500Medium,
  Nunito_600SemiBold,
  Nunito_700Bold,
  Nunito_800ExtraBold,
} from '@expo-google-fonts/nunito';
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
import { AskHost } from './src/components/surfaces/Ask';
import CaptureWindow from './src/components/CaptureWindow';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { GlassTargetProvider } from './src/components/GlassTarget';
import { GlassPortalHost } from './src/components/GlassPortal';
import CrashBoundary from './src/components/CrashBoundary';
import FatalErrorOverlay from './src/components/FatalErrorOverlay';
import ContextDock from './src/components/ContextDock';
import DesktopRail from './src/components/DesktopRail';
import DesktopToolbar from './src/components/DesktopToolbar';
import DesktopTabs from './src/components/DesktopTabs';
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
    fontSize: 11,
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
    <View style={[styles.driveBar, pointer && styles.driveBarRail]}>
      <Text style={[styles.driveText, pointer && styles.driveTextRail]} numberOfLines={1}>
        {user.email ?? 'Акаунт Google'}
      </Text>
      {/* In the corner with the account, not across the middle: it
          repeats, it is nobody's business most of the time, and it
          goes away by itself when the folder is full. */}
      {prefetch.running && prefetch.total > 0 && (
        <Text style={[styles.driveText, pointer && styles.driveTextRail]}>
          {`Готую офлайн: ${prefetch.done} з ${prefetch.total}`}
        </Text>
      )}
      <Pressable
        style={styles.linkButton}
        onPress={async () => {
          await signOutEverywhere();
          await signInWithGoogleAccount().catch(() => {});
        }}
      >
        <Text style={styles.linkLabel}>Змінити акаунт</Text>
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
          <Text style={[styles.driveText, pointer && styles.driveTextRail]} numberOfLines={2}>
            {/* The reason, when there is one. This bar used to say the
                same sentence whether Drive had never been asked, had
                refused, or had answered and been ignored - so a
                failure was indistinguishable from a fresh start, and
                the only way to find out was to guess. */}
            {driveTokenError() ?? 'Картинки лежать на Google Диску'}
          </Text>
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
                <View style={styles.deskRow}>
                  <DesktopRail footer={accountStrip} />
                  <View style={styles.deskBody}>
                    {/* The dock, unrolled - the path on the left and
                        what this screen can do on the right, off the
                        same publications the dock reads. */}
                    {/* Above everything the screen says about itself:
                        the tabs are what you are switching BETWEEN, the
                        toolbar is about whichever one is in front. */}
                    <DesktopTabs />
                    <DesktopToolbar />
                    <View style={styles.deskBody}>
                      <RootNavigator />
                    </View>
                  </View>
                </View>
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
