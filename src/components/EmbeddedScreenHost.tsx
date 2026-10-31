import { ReactNode, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { NavigationContext, NavigationRouteContext } from '@react-navigation/native';
import { SafeAreaInsetsContext } from 'react-native-safe-area-context';
import { NavDockProvider } from '../navigation/navDock';
import { LayoutFrameContext } from '../hooks/useResponsiveLayout';
import { navigationRef } from '../navigationRef';

// A SCREEN LIVING INSIDE A WINDOW that is not a navigator: the AI chat's board (ChatBoardWindow). The same hand-made
// surroundings desktop/PaneScreen gives a screen in a side panel, minimum of them:
//  - a navigation object whose goBack closes the window and whose navigate goes to the real navigator (an editor opened
//    from a card still opens, over the chat);
//  - a route, since the screen reads its params from it;
//  - its own dock (NavDockProvider): everything the screen publishes to the dock and the top bar lands there, where
//    nothing draws it, and never on the real dock under the window;
//  - the frame it really has (LayoutFrameContext), so it never decides on a two-pane layout from the window's width;
//  - no safe-area insets: a window sits inside the screen, whose own insets are already spent.
// Sheets the screen opens are NOT given a host of their own: they rise over the whole screen, which is what a small
// window needs (PaneScreen keeps them inside its panel because a panel is large).
const NO_INSETS = { top: 0, bottom: 0, left: 0, right: 0 };

export default function EmbeddedScreenHost({
  routeName,
  params,
  onClose,
  children,
}: {
  routeName: string;
  params: Record<string, unknown>;
  onClose: () => void;
  children: ReactNode;
}) {
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);
  const route = useMemo(() => ({ key: `embedded-${routeName}`, name: routeName, params }), [routeName, params]);
  const navigation = useMemo(() => {
    const noop = () => {};
    const go = (name: string, p?: Record<string, unknown>) => {
      if (navigationRef.isReady()) (navigationRef.navigate as (n: string, q?: unknown) => void)(name, p);
    };
    return {
      navigate: go,
      push: go,
      replace: go,
      goBack: onClose,
      pop: onClose,
      popToTop: onClose,
      canGoBack: () => true,
      isFocused: () => true,
      addListener: () => noop,
      removeListener: noop,
      setOptions: noop,
      setParams: noop,
      dispatch: noop,
      reset: noop,
      getParent: () => undefined,
      getState: () => ({ index: 0, routes: [route] }),
    };
  }, [onClose, route]);

  return (
    <View style={styles.fill} onLayout={(e) => setFrame({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}>
      {frame && (
        <NavDockProvider>
          <SafeAreaInsetsContext.Provider value={NO_INSETS}>
            <NavigationContext.Provider value={navigation as never}>
              <NavigationRouteContext.Provider value={route as never}>
                <LayoutFrameContext.Provider value={frame}>
                  <View style={styles.fill}>{children}</View>
                </LayoutFrameContext.Provider>
              </NavigationRouteContext.Provider>
            </NavigationContext.Provider>
          </SafeAreaInsetsContext.Provider>
        </NavDockProvider>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
});
