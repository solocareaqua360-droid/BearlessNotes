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

// Hands the target to a piece of the tree that is drawn somewhere else.
//
// GlassPortal moves its children to the host in App.tsx, and a moved
// element reads context from where it is DRAWN, not from where it was
// written - so everything portalled found no target and quietly stopped
// blurring. That is what "скло прозоре, без блюра" was: not a weak blur,
// but none at all, since expo-blur's Android path falls back to a plain
// translucent rectangle when it is not told what to blur. The portal
// captures the target where the glass is declared and puts it back
// around the children with this.
export function BlurTargetBridge({
  value,
  children,
}: {
  value: RefObject<View | null> | null;
  children: ReactNode;
}) {
  return <BlurTargetContext.Provider value={value}>{children}</BlurTargetContext.Provider>;
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
