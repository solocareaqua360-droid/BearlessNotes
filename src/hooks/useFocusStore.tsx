import { ReactNode, useEffect, useMemo, useSyncExternalStore } from 'react';
import { View, type ViewProps } from 'react-native';
import { useNavigation } from '@react-navigation/native';

// WHETHER THIS SCREEN IS IN FRONT, WITHOUT RE-RENDERING IT (2026-10-06).
// useIsFocused re-renders its screen on every focus and blur - for the
// documents list that is two full renders (and a pass over the portal it
// publishes into) each time a note is opened or closed, measured at ~40 ms
// apiece. The navigation's own focus/blur events fill this store instead,
// and only what is wrapped in <WhenFocused> reads it, so only that piece
// draws again. The store is a plain object, so it also works inside a
// portal, where the navigation context is out of reach.
export type FocusStore = {
  get: () => boolean;
  subscribe: (listener: () => void) => () => void;
  set: (focused: boolean) => void;
};

export function useFocusStore(): FocusStore {
  const navigation = useNavigation();
  const store = useMemo<FocusStore>(() => {
    let focused = navigation.isFocused();
    const listeners = new Set<() => void>();
    return {
      get: () => focused,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      set: (next) => {
        if (next === focused) return;
        focused = next;
        listeners.forEach((l) => l());
      },
    };
  }, [navigation]);
  useEffect(() => {
    store.set(navigation.isFocused());
    const offFocus = navigation.addListener('focus', () => store.set(true));
    const offBlur = navigation.addListener('blur', () => store.set(false));
    return () => {
      offFocus();
      offBlur();
    };
  }, [navigation, store]);
  return store;
}

export function useStoreFocused(store: FocusStore): boolean {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}

// The children are a function of "in front", drawn again alone when it changes.
export function WhenFocused({ store, children }: { store: FocusStore; children: (focused: boolean) => ReactNode }) {
  const focused = useStoreFocused(store);
  return <>{children(focused)}</>;
}

// A View that is display:none while its screen is behind - kept mounted
// (and measured) rather than taken down and built again.
export function FocusHideView({ store, style, children, ...rest }: ViewProps & { store: FocusStore }) {
  const focused = useStoreFocused(store);
  return (
    <View {...rest} style={[style, !focused && { display: 'none' }]}>
      {children}
    </View>
  );
}
