import { ReactNode, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { NavigationContext, NavigationRouteContext } from '@react-navigation/native';
import { GlassPortalHost } from '../GlassPortal';
import { GlassTargetProvider } from '../GlassTarget';
import DesktopToolbar from '../DesktopToolbar';
import { NavDockProvider } from '../../navigation/navDock';
import { LayoutFrameContext } from '../../hooks/useResponsiveLayout';
import { navigationRef } from '../../navigationRef';
import { useWorkspace, type Panel } from '../../navigation/workspace';
import ChatScreen from '../../screens/ChatScreen';
import CustomDatabaseScreen from '../../screens/CustomDatabaseScreen';
import DatabasesScreen from '../../screens/DatabasesScreen';

// A SCREEN LIVING IN A SIDE PANEL. Everything a screen takes for granted
// inside the navigator is given it here by hand:
//
//  - a navigation object of its own, whose goBack closes the panel and
//    whose navigate opens a database in a panel and sends anything else to
//    the main pane;
//  - a route, since some screens read their params from it;
//  - its own dock (NavDockProvider), so what it publishes - view, sort, new
//    record - lands in the toolbar drawn at the top of THIS panel and never
//    fights the main pane's over the toolbar above them;
//  - its own portal host and blur target, so its sheets stay inside it;
//  - the frame it really has (LayoutFrameContext), so nothing in it decides
//    its layout from the width of the window.
export default function PaneScreen({ panel }: { panel: Panel }) {
  const workspace = useWorkspace();
  const [frame, setFrame] = useState<{ width: number; height: number } | null>(null);

  const route = useMemo(
    () => ({ key: panel.id, name: panel.kind, params: { databaseId: panel.databaseId } }),
    [panel.id, panel.kind, panel.databaseId]
  );
  const navigation = useMemo(() => {
    const close = () => workspace?.close(panel.id);
    const go = (name: string, params?: { databaseId?: string }) => {
      if (name === 'CustomDatabase' && params?.databaseId) {
        workspace?.open({ kind: 'database', databaseId: params.databaseId });
      } else if (name === 'Chat') {
        workspace?.open({ kind: 'chat' });
      } else if (navigationRef.isReady()) {
        (navigationRef.navigate as (n: string, p?: unknown) => void)(name, params);
      }
    };
    const noop = () => {};
    return {
      navigate: go,
      push: go,
      replace: go,
      goBack: close,
      pop: close,
      popToTop: close,
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
  }, [workspace, panel.id, route]);

  let screen: ReactNode = null;
  if (panel.kind === 'chat') screen = <ChatScreen />;
  else if (panel.kind === 'database' && panel.databaseId) screen = <CustomDatabaseScreen databaseId={panel.databaseId} inPane />;
  else if (panel.kind === 'databases') screen = <DatabasesScreen />;

  return (
    <View
      style={styles.fill}
      onLayout={(e) => setFrame({ width: e.nativeEvent.layout.width, height: e.nativeEvent.layout.height })}
    >
      {frame && (
        <NavDockProvider>
          <GlassPortalHost>
            <GlassTargetProvider>
              <NavigationContext.Provider value={navigation as never}>
                <NavigationRouteContext.Provider value={route as never}>
                  <LayoutFrameContext.Provider value={frame}>
                    <DesktopToolbar compact />
                    <View style={styles.fill}>{screen}</View>
                  </LayoutFrameContext.Provider>
                </NavigationRouteContext.Provider>
              </NavigationContext.Provider>
            </GlassTargetProvider>
          </GlassPortalHost>
        </NavDockProvider>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1, minHeight: 0 },
});
