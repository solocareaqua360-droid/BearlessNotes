import { useEffect, useState } from 'react';
import { ActivityIndicator, View } from 'react-native';
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
import { ensureSignedIn } from './src/firebase';
import BoardsListScreen from './src/screens/BoardsListScreen';
import BoardScreen from './src/screens/BoardScreen';
import { AskHost } from './src/components/surfaces/Ask';
import { GlassTargetProvider } from './src/components/GlassTarget';
import { GlassPortalHost } from './src/components/GlassPortal';
import { BoardsStackParamList } from './src/navigation';

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

export default function App() {
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

  if (!fontsLoaded || !signedIn) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#171310' }}>
        <ActivityIndicator color="#F5C77E" />
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
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
      </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}
