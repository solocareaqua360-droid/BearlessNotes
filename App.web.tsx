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
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { auth, ensureSignedIn, signInWithGoogleAccount, signOutEverywhere } from './src/firebase';
import { onAuthStateChanged } from 'firebase/auth';
import BoardsListScreen from './src/screens/BoardsListScreen';
import BoardScreen from './src/screens/BoardScreen';
import { AskHost } from './src/components/surfaces/Ask';
import { GlassTargetProvider } from './src/components/GlassTarget';
import { GlassPortalHost } from './src/components/GlassPortal';
import CrashBoundary from './src/components/CrashBoundary';
import { BoardsStackParamList } from './src/navigation';
import { driveTokenError, getDriveToken, hasDriveToken, subscribeToDriveToken } from './src/utils/driveToken.web';

// The browser build: the board, and nothing else.
//
// Not a smaller copy of the app - a different, deliberate slice of it.
// The board is the thing worth using on two screens at once, and it is
// also the one big screen that needs no native module of its own. Every
// other screen brings one: the editor a scanner and a text recogniser,
// the file list a quick look, settings a Google sign-in module. Leaving
// them out is not a limitation to apologise for here, it is what makes
// this build exist at all.
//
// Same code as the phone, though - the same BoardScreen file, reading
// the same database through the same seam (see src/firestore.ts). What
// differs is chosen file by file, in .web siblings, not branched inside
// the screens.
const Stack = createNativeStackNavigator<BoardsStackParamList>();

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

  // Asked for silently on the way in: once this account has granted the
  // scope, the token comes back with nothing appearing on screen, and the
  // pictures are simply there.
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
          {/* Signing in grants Drive in the same window now, so this
              should never appear. It stays for the one case where it
              still can: a sign-in that fell back to the Firebase popup,
              which proves who you are and grants nothing. Better a
              button than pictures that quietly never load. */}
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
        <NavigationContainer>
          <GlassPortalHost>
            <GlassTargetProvider>
              <AskHost />
              <Stack.Navigator screenOptions={{ headerShown: false }}>
                <Stack.Screen name="BoardsList" component={BoardsListScreen} />
                <Stack.Screen name="Board" component={BoardScreen} />
              </Stack.Navigator>
            </GlassTargetProvider>
          </GlassPortalHost>
        </NavigationContainer>
        </CrashBoundary>
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
