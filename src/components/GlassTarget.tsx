import { createContext, ReactNode, RefObject, useContext } from 'react';
import { View } from 'react-native';

// What the blur blurs. On Android expo-blur needs to be told WHICH view to
// blur - without that ref it silently falls back to "none", which is a
// semi-transparent rectangle and not a blur at all. That fallback is
// exactly what a sheet looked like before this existed: a dim, with the
// text behind it perfectly readable.
//
// So the whole app is wrapped once, here, and every sheet reaches this ref
// through the context rather than each screen having to arrange its own.
const BlurTargetContext = createContext<RefObject<View | null> | null>(null);

// DISABLED: wrapping the app in BlurTargetView crashed it on launch, so
// the provider hands out nothing and every BlurView falls back to its
// translucent fill - the app works, the glass is a dim. Re-enable only
// with a way to see the crash, which needs the phone on a cable.
export function GlassTargetProvider({ children }: { children: ReactNode }) {
  return <BlurTargetContext.Provider value={null}>{children}</BlurTargetContext.Provider>;
}

// null when nothing has been wrapped - a caller then simply doesn't blur.
export function useBlurTarget(): RefObject<View | null> | null {
  return useContext(BlurTargetContext);
}
