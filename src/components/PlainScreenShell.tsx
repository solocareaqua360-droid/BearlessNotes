import { ReactNode } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useIsFocused } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import ContentColumn from './ContentColumn';
import ScreenBackdrop from './ScreenBackdrop';
import RailCapsule, { RailButton } from './RailCapsule';
import { GlassPortal } from './GlassPortal';
import { useBlurTarget } from './GlassTarget';
import { CAPSULE_DROP, CAPSULE_HEIGHT_1, CHROME_TOP, RAIL_CLEARANCE } from '../constants/rail';
import { useRail } from '../hooks/useRail';
import { GLASS_ISLAND } from '../constants/glass';

// The frame the three registry screens share - the diary, the groups and
// the tags.
//
// They are not databases of records the way Files or Photos are: there is
// nothing to sort, group or put in folders, so DatabaseChrome (which is
// built around useDatabaseList) has nothing to work with. But they had
// nothing at all either - two of them stood on plain white with a
// hand-built header, which read as another app. This is the smallest
// thing that makes them part of this one: the app's backdrop, the way
// out in the top capsule where it is on every other screen, and an
// optional capsule of the screen's own actions.
export default function PlainScreenShell({
  id,
  onBack,
  actions,
  // Drawn inside another screen's LEFT pane, the rail stands on the
  // window's outer edge - see RailCapsule.
  railSide = 'right',
  hasIsland = true,
  children,
}: {
  id: string;
  onBack: () => void;
  actions?: RailButton[];
  railSide?: 'left' | 'right';
  hasIsland?: boolean;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const isFocused = useIsFocused();
  const blurTarget = useBlurTarget();
  const rail = useRail(CAPSULE_HEIGHT_1, actions?.length ? CAPSULE_HEIGHT_1 : 0, 0, 0, hasIsland);

  return (
    <View style={styles.container}>
      <ScreenBackdrop id={id} colors={['#705648', '#69736E', '#000000']} />

      {/* Everything that floats withdraws when this screen is not the one
          on show - the portal reaches the whole app. */}
      {isFocused && (
        <GlassPortal>
          <View
            style={[
              styles.railTop,
              railSide === 'left' ? styles.railTopLeft : styles.railTopRight,
              { top: insets.top + CHROME_TOP + CAPSULE_DROP },
            ]}
            pointerEvents="box-none"
          >
            <View style={styles.topCapsule}>
              <BlurView
                intensity={60}
                tint="dark"
                blurMethod="dimezisBlurView"
                blurTarget={blurTarget ?? undefined}
                style={StyleSheet.absoluteFill}
                pointerEvents="none"
              />
              <Pressable hitSlop={8} onPress={onBack}>
                <Ionicons name="arrow-back-outline" size={24} color="#fff" />
              </Pressable>
            </View>
          </View>
        </GlassPortal>
      )}

      {isFocused && !!actions?.length && (
        <RailCapsule bottom={rail.actionsBottom} buttons={actions} side={railSide} />
      )}

      <ContentColumn>
        {/* The band the status bar and the top capsule stand in. */}
        <View style={{ height: insets.top + CHROME_TOP + 8 }} />
        {children}
      </ContentColumn>
    </View>
  );
}

// What a list inside the shell keeps clear of, so the rows do not run
// under the buttons - the side the rail is actually on.
export function shellClear(railSide: 'left' | 'right', base: number) {
  return railSide === 'left'
    ? { paddingLeft: RAIL_CLEARANCE, paddingRight: base }
    : { paddingLeft: base, paddingRight: RAIL_CLEARANCE };
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  railTop: {
    position: 'absolute',
    alignItems: 'center',
  },
  railTopRight: {
    right: 20,
  },
  railTopLeft: {
    left: 20,
  },
  topCapsule: {
    alignItems: 'center',
    gap: 18,
    paddingVertical: 18,
    paddingHorizontal: 19,
    borderRadius: 999,
    overflow: 'hidden',
    backgroundColor: GLASS_ISLAND,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
  },
});
