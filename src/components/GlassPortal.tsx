import {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { StyleSheet, View } from 'react-native';

// Draws a sheet at the top of the app instead of where it is declared.
//
// Why that has to exist: on Android the blur needs the content it blurs
// wrapped in a target, and the blur itself must sit OUTSIDE that target -
// a blur inside the picture it is blurring tries to draw itself, which is
// what took the app down. But every sheet is declared inside the screen
// that opens it, and the screens are what the target wraps. So a sheet
// declares itself where it always did and is rendered here, above the
// target, by the host in App.tsx.
//
// Not React DOM's portal: the moved elements take their context from the
// host's place in the tree, not from where they were declared. The host
// therefore sits inside NavigationContainer, so a sheet that navigates
// still can.
type Mount = (id: string, node: ReactNode) => void;
type Unmount = (id: string) => void;

const PortalContext = createContext<{ mount: Mount; unmount: Unmount } | null>(null);

export function GlassPortalHost({ children }: { children: ReactNode }) {
  const [nodes, setNodes] = useState<Map<string, ReactNode>>(new Map());
  const mount = useCallback<Mount>((id, node) => {
    setNodes((prev) => {
      const next = new Map(prev);
      next.set(id, node);
      return next;
    });
  }, []);
  const unmount = useCallback<Unmount>((id) => {
    setNodes((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }, []);
  const value = useMemo(() => ({ mount, unmount }), [mount, unmount]);
  const entries = Array.from(nodes.entries());

  return (
    <PortalContext.Provider value={value}>
      {children}
      {/* Above everything the children drew. box-none: with no sheet open
          this layer must let every touch through to the app under it. */}
      {entries.length > 0 && (
        <View style={styles.host} pointerEvents="box-none">
          {entries.map(([id, node]) => (
            <View key={id} style={StyleSheet.absoluteFill} pointerEvents="box-none">
              {node}
            </View>
          ))}
        </View>
      )}
    </PortalContext.Provider>
  );
}

let nextId = 0;

export function GlassPortal({ children }: { children: ReactNode }) {
  const portal = useContext(PortalContext);
  const idRef = useRef<string | null>(null);
  if (idRef.current === null) idRef.current = `glass-${nextId++}`;
  const id = idRef.current;

  // Layout effect, not effect: the host should have the sheet before the
  // frame is shown, or a sheet flickers in a frame late.
  useLayoutEffect(() => {
    portal?.mount(id, children);
  });
  useLayoutEffect(() => () => portal?.unmount(id), [portal, id]);

  // With no host around (a screen rendered on its own, say) the sheet
  // simply draws in place, as it did before the portal existed.
  return portal ? null : <>{children}</>;
}

const styles = StyleSheet.create({
  host: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 1000,
  },
});
