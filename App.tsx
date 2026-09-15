import { useEffect, useState } from 'react';
import { View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
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
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { ShareIntentProvider } from 'expo-share-intent';
import { NavigationContainer } from '@react-navigation/native';
import { ensureSignedIn } from './src/firebase';
import RootNavigator from './src/AppNavigator';
import ShareIntentHandler from './src/components/ShareIntentHandler';
import * as SplashScreen from 'expo-splash-screen';
import { sweepIfDue } from './src/utils/attachmentCache';
import { migrateBoardShapes } from './src/utils/boardMigration';
import { navigationRef } from './src/navigationRef';
import { GlassTargetProvider } from './src/components/GlassTarget';
import { GlassPortalHost } from './src/components/GlassPortal';
import { AskHost } from './src/components/surfaces/Ask';
import AlarmRingOverlay from './src/components/AlarmRingOverlay';

// The screens themselves - every route, and the tab navigator they sit
// behind - live in src/AppNavigator, shared with the browser build. What
// this file owns is the phone's own wrapping: the splash, the fonts, the
// keyboard provider, the share-intent handler.

// Android dismisses the splash as soon as the app draws its first frame,
// and this app's first frame is a stand-in view that appears almost at
// once - so the icon-to-app morph was cut off just as it began. Held here
// instead, and let go below once the fonts and the sign-in have resolved,
// which is when there is really something to show.
SplashScreen.preventAutoHideAsync().catch(() => {});

export default function App() {
  // Only the redesigned surfaces (Documents/Calendar and the components
  // they share) reference these family names in their own styles - the
  // rest of the app keeps the system font, matching how this whole visual
  // pass has stayed scoped rather than becoming an app-wide reskin.
  const [fontsLoaded] = useFonts({
    Nunito_400Regular,
    Nunito_500Medium,
    Nunito_600SemiBold,
    Nunito_700Bold,
    Nunito_800ExtraBold,
  });
  const [signedIn, setSignedIn] = useState(false);
  useEffect(() => {
    ensureSignedIn().then(() => setSignedIn(true));
  }, []);
  const ready = fontsLoaded && signedIn;
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => {});
    // The bytes of files nobody has opened in three months go, quietly,
    // once a day - their records stay, and they come back from Drive on
    // the next open. See attachmentCache.
    if (ready) sweepIfDue();
    // One pass, once, and then never a write again - see
    // migrateBoardShapes. Deliberately not awaited and deliberately
    // silent: nothing on screen depends on it, and a board it cannot
    // reach today it converts on the next launch.
    if (ready) migrateBoardShapes().catch(() => {});
  }, [ready]);

  // ShareIntentProvider wraps BOTH branches below as one stable instance
  // (rather than each branch mounting its own) - a share can arrive while
  // the app is still on the splash view, and the provider needs to keep
  // holding it across the splash -> ready transition, not capture it once
  // and then get remounted from scratch right as ShareIntentHandler
  // (which only renders once signedIn, since it writes to Firestore)
  // would otherwise need to read it.
  return (
    <ShareIntentProvider>
      {!ready ? (
        // The splash's own colour, not white and no longer the gradient's
        // brown: the splash is still up while this stands behind it, and
        // two different grounds handing over to each other is exactly the
        // flash this is meant to avoid.
        <View style={{ flex: 1, backgroundColor: '#0F1839' }} />
      ) : (
        <GestureHandlerRootView style={{ flex: 1 }}>
        {/* At the root, so the pieces mounted here - the question
            window below - can read the insets too. Every screen gets
            its own from the navigator; nothing above it did. */}
        <SafeAreaProvider>
          {/* Feeds the document editor per-frame keyboard progress (see
              DocumentEditorScreen's useKeyboardHandler), so the block being
              edited can ride up in the same motion as the keyboard instead of
              jumping after it has finished. */}
          <KeyboardProvider>
          <NavigationContainer ref={navigationRef}>
          {/* The glass, in two halves that must stay in this order. The
              portal host is where every sheet is actually drawn - inside
              NavigationContainer, so a sheet that navigates still can, and
              OUTSIDE the blur target below, because a blur inside the
              picture it blurs tries to draw itself. The target wraps only
              the screens: that is what a sheet blurs. */}
          <GlassPortalHost>
            <StatusBar style="auto" />
            <GlassTargetProvider>
            {/* «Питання» - every confirmation in the app, drawn once here
                so that asking is a function call anywhere else. INSIDE the
                blur target: what it blurs is the screens, and from outside
                them expo-blur quietly falls back to a flat dim. */}
            <AskHost />
            {/* A ringing alarm is its own Modal too, for the same reason -
                see AlarmRingOverlay. */}
            <AlarmRingOverlay />
            {/* Inside the target too: it raises the naming dialog. */}
            <ShareIntentHandler />
            <RootNavigator />
            </GlassTargetProvider>
          </GlassPortalHost>
          </NavigationContainer>
          </KeyboardProvider>
        </SafeAreaProvider>
        </GestureHandlerRootView>
      )}
    </ShareIntentProvider>
  );
}
