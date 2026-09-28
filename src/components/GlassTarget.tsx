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
// Whether the thing asking is standing INSIDE the target. A blur drawn
// inside the very view it blurs recurses natively and takes the app down
// - not a red screen, not something an error boundary sees, the process
// simply ends. That is what "щоденник вилітає" was: the diary's search
// field was the one drop not drawn through the portal, so it sat inside
// the target and blurred itself. Everything that blurs asks this first.
const InsideTargetContext = createContext(false);

export function GlassTargetProvider({ children }: { children: ReactNode }) {
  const ref = useRef<View>(null);
  return (
    <BlurTargetContext.Provider value={ref}>
      <InsideTargetContext.Provider value={true}>
        <BlurTargetView ref={ref} style={styles.fill}>
          {children}
        </BlurTargetView>
      </InsideTargetContext.Provider>
    </BlurTargetContext.Provider>
  );
}

// null when nothing has been wrapped - a caller then simply doesn't blur.
export function useBlurTarget(): RefObject<View | null> | null {
  return useContext(BlurTargetContext);
}

// true where a blur MUST NOT be drawn against the target - see above.
export function useInsideBlurTarget(): boolean {
  return useContext(InsideTargetContext);
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
  // The host is outside the target - that is the whole reason the portal
  // exists - so what it draws may blur again.
  return (
    <BlurTargetContext.Provider value={value}>
      <InsideTargetContext.Provider value={false}>{children}</InsideTargetContext.Provider>
    </BlurTargetContext.Provider>
  );
}

const styles = StyleSheet.create({
  fill: {
    flex: 1,
  },
});
