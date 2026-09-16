import { ReactNode } from 'react';
import { useTheme } from '../../theme/ThemeProvider';
import { Pressable, ScrollView, StyleSheet, Text, View, ViewStyle, useWindowDimensions } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { useIsFocused } from '@react-navigation/native';
import { useBlurTarget } from '../GlassTarget';
import { GlassPortal } from '../GlassPortal';
import { FONT_BOLD, FONT_REGULAR } from '../../utils/fonts';
import { GLASS_DANGER, GLASS_ISLAND, GLASS_LINE, GLASS_TEXT, GLASS_TEXT_FAINT } from '../../constants/glass';

// «Меню» - a short list of commands, beside the thing it acts on.
//
// Every screen had grown its own: the documents list had this one, in
// glass; the calendar had a flat black slab with square corners; the
// custom database another; the boards list a sheet stuck to the bottom
// edge. Same purpose, four looks - which is what the user saw in one
// quick pass through the app.
//
// This is the documents one, made shared. It draws the panel and the
// backdrop that closes it; WHERE it sits is the caller's business, since
// a menu belongs beside whatever opened it - so `style` must place it
// ABSOLUTELY, in the screen's own coordinates.
//
// Absolutely, because it is drawn through the portal, and that is not a
// detail: on Android the blur is told which view to blur, and that view
// is every screen. A BlurView left where it was declared therefore sits
// INSIDE the picture it is blurring and tries to draw itself - which
// does not look wrong, it takes the whole app down. The first version of
// this crashed the calendar the moment the menu opened, exactly that
// way. The portal lifts it out, above the target, where the documents
// menu has always been.

export type MenuEntry =
  | { kind: 'section'; label: string }
  | { kind: 'rule' }
  | {
      kind?: 'row';
      label: string;
      icon?: keyof typeof Ionicons.glyphMap;
      // A tick on the right: this is the option in force.
      checked?: boolean;
      tone?: 'normal' | 'danger';
      onPress: () => void;
    };

export const MENU_WIDTH = 210;

export default function Menu({
  visible,
  onClose,
  entries,
  style,
  maxHeight,
  width = MENU_WIDTH,
  accent,
  children,
}: {
  visible: boolean;
  onClose: () => void;
  entries: MenuEntry[];
  // Where the panel goes - usually absolute, against the rail.
  style?: ViewStyle | ViewStyle[];
  maxHeight?: number;
  width?: number;
  // The colour of the tick, which is the screen's own.
  accent?: string;
  // Anything the rows cannot express (a row of colours, a slider).
  children?: ReactNode;
}) {
  const theme = useTheme();
  const blurTarget = useBlurTarget();
  // Read at render, never captured at module scope - a stale window size
  // is what broke the calendar's week strip twice before.
  const { height: windowHeight } = useWindowDimensions();
  // Drawn through the portal, which reaches over the WHOLE app - so a menu
  // left open on one screen went on floating above the next one the user
  // swiped to, and two of them could stack. Every rail piece is already
  // behind its own isFocused; this is the same rule, made once here rather
  // than at each of the six places a menu is opened.
  const isFocused = useIsFocused();
  if (!visible || !isFocused) return null;
  return (
    <GlassPortal>
      <Pressable style={styles.backdrop} onPress={onClose} />
      <View style={[styles.panel, { width }, { maxHeight: maxHeight ?? windowHeight * 0.6 }, style]}>
        <BlurView
          intensity={60}
          tint="dark"
          blurMethod="dimezisBlurView"
          blurTarget={blurTarget ?? undefined}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {entries.map((entry, index) => {
            if (entry.kind === 'section') {
              return (
                <Text key={`s${index}`} style={styles.sectionLabel}>
                  {entry.label}
                </Text>
              );
            }
            if (entry.kind === 'rule') return <View key={`r${index}`} style={styles.rule} />;
            const danger = entry.tone === 'danger';
            return (
              <Pressable
                key={`${entry.label}${index}`}
                style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
                onPress={() => {
                  // Closed first, always: a menu that stays up while the
                  // screen changes under it is the thing that made these
                  // feel homemade.
                  onClose();
                  entry.onPress();
                }}
              >
                {!!entry.icon && (
                  <Ionicons name={entry.icon} size={17} color={danger ? GLASS_DANGER : theme.ink.primary} />
                )}
                <Text style={[styles.rowLabel, danger && styles.rowLabelDanger]} numberOfLines={1}>
                  {entry.label}
                </Text>
                {entry.checked && (
                  <Ionicons name="checkmark-outline" size={18} color={accent ?? theme.ink.primary} />
                )}
              </Pressable>
            );
          })}
          {children}
        </ScrollView>
      </View>
    </GlassPortal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    zIndex: 5,
  },
  panel: {
    backgroundColor: GLASS_ISLAND,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.4)',
    borderRadius: 20,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 20,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
    zIndex: 6,
  },
  scroll: {
    padding: 6,
  },
  sectionLabel: {
    fontSize: 11,
    fontFamily: FONT_BOLD,
    letterSpacing: 0.04,
    textTransform: 'uppercase',
    color: GLASS_TEXT_FAINT,
    paddingHorizontal: 8,
    paddingTop: 4,
    paddingBottom: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderRadius: 12,
  },
  rowPressed: {
    backgroundColor: 'rgba(255,255,255,0.10)',
  },
  rowLabel: {
    flex: 1,
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT,
  },
  rowLabelDanger: {
    color: GLASS_DANGER,
  },
  rule: {
    height: 1,
    backgroundColor: GLASS_LINE,
    marginVertical: 6,
  },
});
