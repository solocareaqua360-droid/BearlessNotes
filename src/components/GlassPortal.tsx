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
import { BlurTargetBridge, useBlurTarget } from './GlassTarget';

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
// Which floating layer stands over which. Everything drawn here floats
// over the app, so "above" among THEMSELVES cannot be left to the order
// they happened to mount in - the dock mounts with the tabs and a carry
// overlay mounts with a screen, and which of those comes first is an
// accident of the navigator. A carried card has to ride over the dock:
// it is the thing in your hand.
type Mount = (id: string, node: ReactNode, priority: number) => void;
type Unmount = (id: string) => void;

const PortalContext = createContext<{ mount: Mount; unmount: Unmount } | null>(null);

export function GlassPortalHost({ children }: { children: ReactNode }) {
  const [nodes, setNodes] = useState<Map<string, { node: ReactNode; priority: number }>>(new Map());
  const mount = useCallback<Mount>((id, node, priority) => {
    setNodes((prev) => {
      const next = new Map(prev);
      next.set(id, { node, priority });
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
  // Stable sort: same priority keeps mount order, which is what every
  // sheet has always relied on.
  const entries = Array.from(nodes.entries()).sort((a, b) => a[1].priority - b[1].priority);

  return (
    <PortalContext.Provider value={value}>
      {children}
      {/* Above everything the children drew. box-none: with no sheet open
          this layer must let every touch through to the app under it. */}
      {entries.length > 0 && (
        <View style={styles.host} pointerEvents="box-none">
          {entries.map(([id, entry]) => (
            <View key={id} style={StyleSheet.absoluteFill} pointerEvents="box-none">
              {entry.node}
            </View>
          ))}
        </View>
      )}
    </PortalContext.Provider>
  );
}

let nextId = 0;

export function GlassPortal({ children, priority = 0 }: { children: ReactNode; priority?: number }) {
  const portal = useContext(PortalContext);
  // Captured HERE, where the glass is written - inside the target - and
  // carried to the host, which is outside it. Without this every
  // portalled drop asked for the target at the host's place in the tree,
  // found none, and drew a flat translucent rectangle instead of a blur.
  const blurTarget = useBlurTarget();
  const idRef = useRef<string | null>(null);
  if (idRef.current === null) idRef.current = `glass-${nextId++}`;
  const id = idRef.current;

  // Layout effect, not effect: the host should have the sheet before the
  // frame is shown, or a sheet flickers in a frame late.
  useLayoutEffect(() => {
    portal?.mount(id, <BlurTargetBridge value={blurTarget}>{children}</BlurTargetBridge>, priority);
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
