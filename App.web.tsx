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
import { onAuthStateChanged } from 'firebase/auth';
import RootNavigator from './src/AppNavigator';
import { navigationRef } from './src/navigationRef';
import { AskHost } from './src/components/surfaces/Ask';
import { ThemeProvider, useTheme } from './src/theme/ThemeProvider';
import { GlassTargetProvider } from './src/components/GlassTarget';
import { GlassPortalHost } from './src/components/GlassPortal';
import CrashBoundary from './src/components/CrashBoundary';
import FatalErrorOverlay from './src/components/FatalErrorOverlay';
import ContextDock from './src/components/ContextDock';
import { NavDockProvider } from './src/navigation/navDock';
import { driveTokenError, getDriveToken, hasDriveToken, subscribeToDriveToken } from './src/utils/driveToken.web';

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
  driveBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
    paddingVertical: 8,
    paddingHorizontal: 16,
    backgroundColor: '#171310',
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

  // Not a request - a look in the browser's storage for a token from
  // within the hour. Nothing is asked of Google here, because nothing
  // can be without a click (see driveToken.web); if one is there, the
  // pictures are simply there too.
  useEffect(() => {
    if (user) getDriveToken(false, user.email).then(() => setDrive(hasDriveToken()));
    return subscribeToDriveToken(() => setDrive(hasDriveToken()));
  }, [user]);

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

  if (!fontsLoaded || user === undefined) {
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
        <View style={styles.driveBar}>
          <Text style={styles.driveText}>{user.email ?? 'Акаунт Google'}</Text>
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
          {!drive && (
            <>
              <Text style={styles.driveText}>
                {/* The reason, when there is one. This bar used to say the
                    same sentence whether Drive had never been asked, had
                    refused, or had answered and been ignored - so a
                    failure was indistinguishable from a fresh start, and
                    the only way to find out was to guess. */}
                {driveTokenError() ?? 'Картинки лежать на Google Диску'}
              </Text>
              <Pressable
                style={styles.driveButton}
                onPress={() => getDriveToken(true, user.email).then(() => setDrive(hasDriveToken()))}
              >
                <Text style={styles.driveButtonLabel}>Підключити Диск</Text>
              </Pressable>
            </>
          )}
        </View>
        {/* Below the account bar, not above it: a crash inside the board
            or the editor must still leave a way to change account or sign
            out, and the bar is that way. */}
        <CrashBoundary>
        <ThemedNavigationContainer>
          <NavDockProvider>
          <GlassPortalHost>
            <GlassTargetProvider>
              <AskHost />
              {/* The whole app, not the board alone - the same tree the
                  phone mounts, from src/AppNavigator. What the browser
                  leaves out is chosen file by file (.web siblings), not
                  route by route here. */}
              <RootNavigator />
            </GlassTargetProvider>
            {/* See App.tsx. */}
            <ContextDock />
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
