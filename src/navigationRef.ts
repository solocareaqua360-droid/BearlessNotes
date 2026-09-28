import { createNavigationContainerRef } from '@react-navigation/native';
import { RootStackParamList } from './navigation';

// Lets code outside the screen tree (ShareIntentHandler - it renders as a
// sibling of the navigator, not a screen) navigate imperatively, the
// standard React Navigation pattern for that. Only valid once
// NavigationContainer has mounted (isReady()) - App.tsx attaches this as
// its ref, so that's from the very first frame the app's UI is up.
export const navigationRef = createNavigationContainerRef<RootStackParamList>();
