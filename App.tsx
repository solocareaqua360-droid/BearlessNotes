import { useEffect, useState } from 'react';
import { View } from 'react-native';
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
import { DefaultTheme, NavigationContainer, Theme as NavTheme } from '@react-navigation/native';
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
import CaptureWindow from './src/components/CaptureWindow';
import { ThemeProvider, ThemedStatusBar, useTheme } from './src/theme/ThemeProvider';
import CrashBoundary from './src/components/CrashBoundary';
import FatalErrorOverlay from './src/components/FatalErrorOverlay';
import MetricsBanner from './src/components/MetricsBanner';
import ContextDock from './src/components/ContextDock';
import { NavDockProvider } from './src/navigation/navDock';
import AlarmRingOverlay from './src/components/AlarmRingOverlay';
import { useStickerDeepLink } from './src/hooks/useStickerDeepLink';

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

// The navigator paints its own card behind every screen, and its default
// theme's is WHITE - which is what showed through as small white patches
// while the screens re-measured themselves on a rotation. It has to be
// the app's own ground instead, and from inside ThemeProvider so it
// follows the theme like everything else.
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
  // A tap on the sticker widget opens straight into that sticker - see
  // the hook itself for why this needs both a cold-start and a
  // while-running case.
  useStickerDeepLink();
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
    // Outside everything that draws: the theme is read from the local
    // cache on the first frame, so the app opens already in the right
    // one rather than repainting itself a moment later.
    <ThemeProvider>
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
          <ThemedNavigationContainer>
          {/* The glass, in two halves that must stay in this order. The
              portal host is where every sheet is actually drawn - inside
              NavigationContainer, so a sheet that navigates still can, and
              OUTSIDE the blur target below, because a blur inside the
              picture it blurs tries to draw itself. The target wraps only
              the screens: that is what a sheet blurs. */}
          {/* Wraps BOTH the portal host and the screens: one side
              publishes where it is, the other draws it. */}
          <NavDockProvider>
          <GlassPortalHost>
            <ThemedStatusBar />
            <GlassTargetProvider>
            {/* «Питання» - every confirmation in the app, drawn once here
                so that asking is a function call anywhere else. INSIDE the
                blur target: what it blurs is the screens, and from outside
                them expo-blur quietly falls back to a flat dim. */}
            <AskHost />
            {/* «Загальний чат» - the window the dock's long press
                opens, already listening. Inside the blur target,
                like every other sheet. */}
            <CaptureWindow
              onOpenChat={() => {
                if (navigationRef.isReady()) navigationRef.navigate('Chat');
              }}
            />
            {/* A ringing alarm is its own Modal too, for the same reason -
                see AlarmRingOverlay. */}
            <AlarmRingOverlay />
            {/* Inside the target too: it raises the naming dialog. */}
            <ShareIntentHandler />
            {/* A render that throws used to take the whole app down on the
                phone - "вилітає" is the only report anyone can make, and
                it is the same report for every possible cause. The
                browser build has had this since the day it went white;
                the phone should have had it too. */}
            <CrashBoundary>
              <RootNavigator />
            </CrashBoundary>
            {/* The dock - see components/ContextDock. Declared INSIDE the
                blur target, like the tags drawer and every sheet, and
                drawn outside it by its own GlassPortal. Declared outside,
                it found no target to blur and expo-blur quietly fell back
                to a flat translucent rectangle: the light, unblurred dock
                the user set beside the drawer and asked whether the two
                could possibly be the same material. */}
            <ContextDock />
            </GlassTargetProvider>
          </GlassPortalHost>
          </NavDockProvider>
          {/* Above the portal host, and outside every boundary:
              what it reports is the error class that leaves NOTHING
              on the screen - see src/utils/fatalErrors.ts. */}
          <FatalErrorOverlay />
          {/* TEMPORARY - see MetricsBanner. Above everything, because the
              screen it is for cannot be read well enough to navigate. */}
          <MetricsBanner />
          </ThemedNavigationContainer>
          </KeyboardProvider>
        </SafeAreaProvider>
        </GestureHandlerRootView>
      )}
    </ShareIntentProvider>
    </ThemeProvider>
  );
}
