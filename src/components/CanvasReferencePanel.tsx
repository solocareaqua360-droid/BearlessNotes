import { StyleSheet, Text, View } from 'react-native';
import { GestureDetector } from 'react-native-gesture-handler';
import Animated, { useAnimatedStyle } from 'react-native-reanimated';
import { Ionicons } from '@expo/vector-icons';
import AddExistingItemModal from './AddExistingItemModal';
import GlassDrop, { GlassIcon } from './GlassDrop';
import { useTheme, useStyles } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { useReferenceDrag } from '../hooks/useReferenceDrag';
import type { Block } from '../types';
import type { DocumentCanvasHandle } from './DocumentCanvas';

// «Референси» in canvas mode - the user's own idea: browse everything
// this app already knows how to list (files, photos, links, custom
// databases, and now another document's own blocks) beside the canvas,
// and drag pieces of it onto the board as raw material. AddExistingItemModal
// already IS that browser (opened today from the canvas's own "+"), so
// this docks a standing copy of it rather than building a second one, and
// wires ITS rows to useReferenceDrag - a drop lands wherever it is let
// go, read off the finger, not aimed at anything in particular.
export default function CanvasReferencePanel({
  visible,
  onClose,
  canvasRef,
  onInsertBlock,
  excludeIds,
}: {
  visible: boolean;
  onClose: () => void;
  canvasRef: React.RefObject<DocumentCanvasHandle | null>;
  // A dropped block, and where it landed in the CANVAS'S OWN surface
  // coordinates (already converted - see DocumentCanvasHandle.screenToSurface).
  onInsertBlock: (block: Block, at: { x: number; y: number }) => void;
  excludeIds?: Set<string>;
}) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const drag = useReferenceDrag({
    onDrop: (block, screenX, screenY, respond) => {
      canvasRef.current?.screenToSurface(screenX, screenY, (at) => {
        if (at) onInsertBlock(block, at);
        respond(!!at);
      }) ?? respond(false);
    },
  });

  const ghostStyle = useAnimatedStyle(() =>
    drag.ghost ? { left: drag.ghost.x, top: drag.ghost.y, opacity: 1 } : { left: 0, top: 0, opacity: 0 }
  );

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
        <Text style={styles.hint}>Затисни й перетягни на полотно</Text>
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

      {drag.ghost && (
        <Animated.View style={[styles.ghostWrap, ghostStyle]} pointerEvents="none">
          <GlassDrop radius={16} lift="shadow" style={styles.ghost}>
            <GlassIcon name="albums-outline" size={16} />
            <Text style={[styles.ghostLabel, { color: theme.glass.ink }]} numberOfLines={1}>
              {drag.ghost.label}
            </Text>
          </GlassDrop>
        </Animated.View>
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
    panel: {
      flex: 1,
      backgroundColor: t.surface,
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
    },
  });
