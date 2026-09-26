import { StyleSheet, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import { Ionicons } from '@expo/vector-icons';
import AddExistingItemModal from './AddExistingItemModal';
import GlassDrop, { GlassIcon } from './GlassDrop';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { useReferenceDrag } from '../hooks/useReferenceDrag';
import type { Block } from '../types';

// «Референси» - the user's own idea: browse everything this app already
// knows how to list (files, photos, links, custom databases, and another
// document's own blocks) beside the note, and drag pieces of it in as raw
// material. AddExistingItemModal already IS that browser (opened from the
// "/" menu as «З бази»), so this docks a standing copy of it rather than
// building a second one, and wires ITS rows to useReferenceDrag.
//
// WHERE a drop lands is the caller's business, not this panel's: on the
// canvas it is a point on a surface, on the page it is a gap between two
// blocks. Both are answered asynchronously because both are measured
// against the window (see DocumentCanvasHandle.screenToSurface and
// BlockListHandle.hoverExternal), hence `respond` rather than a return.
export default function ReferencePanel({
  visible,
  onClose,
  onDrop,
  onDragMove,
  onDragFinished,
  hint,
  excludeIds,
}: {
  visible: boolean;
  onClose: () => void;
  onDrop: (block: Block, screenX: number, screenY: number, respond: (accepted: boolean) => void) => void;
  // Every move of the finger while something is in hand, so the target
  // can show where it would land. Left out where there is nothing to
  // show - the canvas takes a drop anywhere on itself.
  onDragMove?: (screenX: number, screenY: number) => void;
  // Nothing in hand any more - see useReferenceDrag's onFinished.
  onDragFinished?: () => void;
  hint: string;
  excludeIds?: Set<string>;
}) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const drag = useReferenceDrag({ onDrop, onMove: onDragMove, onFinished: onDragFinished });

  // Plainly positioned, NOT through useAnimatedStyle - and that is the
  // whole of the white screen this panel opened with.
  //
  // Reanimated collects a worklet's closure by IDENTIFIER: a body that
  // says `drag.ghost` captures `drag`, the whole object this hook
  // returns, and tries to copy every property of it onto the UI thread.
  // One of them is the Pan itself - "[Worklets] Cannot copy value of
  // type `PanGesture`" - thrown asynchronously, so no error boundary saw
  // it and the JS root simply went away, leaving Android's own empty
  // white window and nothing to report. (CardCarryOverlay does the same
  // thing safely because its ghost arrives as a plain prop.)
  //
  // There was nothing to animate here anyway: the ghost's position is JS
  // state that re-renders on every finger move, so a worklet only ever
  // repeated what React had already done.
  const ghost = drag.ghost;

  if (!visible) return null;

  return (
    <>
      <View style={styles.panel}>
        <View style={styles.header}>
          <Ionicons name="albums-outline" size={16} color={theme.ink.muted} />
          <Text style={styles.headerLabel}>Референси</Text>
          <View style={{ flex: 1 }} />
          <Ionicons name="close" size={20} color={theme.ink.muted} onPress={onClose} />
        </View>
        <Text style={styles.hint}>{hint}</Text>
        <GestureDetector gesture={drag.gesture}>
          <View style={{ flex: 1 }}>
            <AddExistingItemModal
              visible
              docked
              excludeIds={excludeIds}
              includeCustomDatabases
              includeDocuments
              rowRef={drag.registerRow}
              onPick={() => {}}
              onClose={() => {}}
            />
          </View>
        </GestureDetector>
      </View>

      {ghost && (
        <View style={[styles.ghostWrap, { left: ghost.x, top: ghost.y }]} pointerEvents="none">
          <GlassDrop radius={16} lift="shadow" style={styles.ghost}>
            <GlassIcon name="albums-outline" size={16} />
            <Text style={styles.ghostLabel} numberOfLines={1}>
              {ghost.label}
            </Text>
          </GlassDrop>
        </View>
      )}
    </>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    // Sized by whoever mounts this - a real side pane on the Fold's wide
    // inner screen, a narrower glass drawer over part of the canvas on a
    // phone. Either way it is never the full screen: the canvas has to
    // stay reachable as the drop target.
    // The THEME'S own ground, not a dark slab. Written as one it was a
    // black panel standing on white paper in the light themes, which is
    // the same mistake the editor's own "/" bar made and was fixed for:
    // this is a surface of its own, not a pill floating on glass, so it
    // wears what every other surface in the app wears.
    panel: {
      flex: 1,
      backgroundColor: t.ground,
      // The edge faces the note, and the note is to the LEFT of this
      // panel now that it docks against the window's right edge - see
      // referencePanelDock. It was on the other side, from when the
      // panel was.
      borderLeftWidth: 1,
      borderLeftColor: t.edge.hairline,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 14,
      paddingTop: 14,
    },
    headerLabel: {
      fontSize: 13,
      fontWeight: '700',
      color: t.ink.primary,
    },
    hint: {
      fontSize: 11,
      color: t.ink.faint,
      paddingHorizontal: 14,
      paddingTop: 2,
      paddingBottom: 8,
    },
    ghostWrap: {
      position: 'absolute',
      transform: [{ scale: 1.04 }],
    },
    ghost: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 8,
      paddingVertical: 10,
      paddingHorizontal: 14,
      shadowColor: '#000',
      shadowOpacity: 0.28,
      shadowRadius: 14,
      shadowOffset: { width: 0, height: 6 },
      elevation: 10,
    },
    ghostLabel: {
      fontSize: 13,
      fontWeight: '600',
      maxWidth: 180,
      color: t.ink.primary,
    },
  });
