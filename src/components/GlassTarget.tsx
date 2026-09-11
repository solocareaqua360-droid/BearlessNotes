import { createContext, ReactNode, RefObject, useContext, useRef } from 'react';
import { StyleSheet, View } from 'react-native';
import { BlurTargetView } from 'expo-blur';

// What the blur blurs. On Android expo-blur needs to be told WHICH view to
// blur - without that ref it silently falls back to "none", which is a
// semi-transparent rectangle and not a blur at all. That fallback is
// exactly what a sheet looked like before this existed: a dim, with the
// text behind it perfectly readable.
//
// So the whole app is wrapped once, here, and every sheet reaches this ref
// through the context rather than each screen having to arrange its own.
const BlurTargetContext = createContext<RefObject<View | null> | null>(null);

export function GlassTargetProvider({ children }: { children: ReactNode }) {
  const ref = useRef<View>(null);
  return (
    <BlurTargetContext.Provider value={ref}>
      <BlurTargetView ref={ref} style={styles.fill}>
        {children}
      </BlurTargetView>
    </BlurTargetContext.Provider>
  );
}

// null when nothing has been wrapped - a caller then simply doesn't blur.
export function useBlurTarget(): RefObject<View | null> | null {
  return useContext(BlurTargetContext);
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
