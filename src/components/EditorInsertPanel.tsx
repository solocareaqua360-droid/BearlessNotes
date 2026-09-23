import { useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ScrollView } from 'react-native-gesture-handler';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';

// The panel that stands WHERE THE KEYBOARD WAS.
//
// Notion's shape, and the user's own description of it: one scrolling
// list of everything a block can be, cut into named sections, with the
// row of buttons above it jumping between those sections rather than
// each opening a panel of its own. "Щоб не робити безкінечну полосу над
// клавіатурою" - the old bar was fourteen icons in a strip that scrolled
// sideways, and finding anything in it meant dragging until it appeared.
//
// PHONE ONLY. A laptop has room for a real toolbar and gets its own
// project; nothing here is drawn where there is a cursor.
//
// The keyboard is not dismissed to make room for this - see the editor's
// own `softInputDisabled`. Dismissing it would take the focus and the
// TEXT SELECTION with it, and half of what this panel offers (bold,
// italic, colour) acts on a selection. The field keeps focus and simply
// stops asking for the soft keyboard, so the caret and the selection
// stay exactly where they were.

// «B» is gone and «Тт» carries everything to do with text - the user's
// call: "кнопку B можна прибрати та залишити лише Тт, все що пов'язано
// з текстом буде за нею". Bold, colour, highlight and size are four
// groups under one door rather than two doors into the same subject.
export type PanelSection = 'lists' | 'text' | 'rules' | 'insert';

export type PanelItem = {
  key: string;
  label: string;
  // Two families because Ionicons has no numbered-list glyph - see
  // blockActions, where the same split is made for the same reason.
  family?: 'ionicons' | 'material-community';
  icon: string;
  // A swatch instead of an icon: the colour rows.
  swatch?: string;
  onPress: () => void;
  active?: boolean;
};

export type PanelGroup = {
  section: PanelSection;
  title: string;
  items: PanelItem[];
  // Colours are square chips in a row, not full-width tiles with a
  // label - a colour IS its label.
  compact?: boolean;
};

export default function EditorInsertPanel({
  height,
  groups,
  jumpTo,
}: {
  // Exactly what the keyboard had, so nothing moves when one replaces
  // the other.
  height: number;
  groups: PanelGroup[];
  // Set by the bar above when a section button is pressed; cleared by
  // the panel once it has scrolled there.
  jumpTo: { section: PanelSection; at: number } | null;
}) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  const scrollRef = useRef<ScrollView>(null);
  const offsets = useRef(new Map<PanelSection, number>());
  const lastJump = useRef(0);

  // Each section reports where it starts, and the jump is a plain scroll
  // to that offset - one list, not five panels.
  if (jumpTo && jumpTo.at !== lastJump.current) {
    lastJump.current = jumpTo.at;
    const y = offsets.current.get(jumpTo.section);
    if (y !== undefined) {
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ y: Math.max(0, y - 8), animated: true }));
    }
  }

  return (
    <View style={[styles.panel, { height }]}>
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="always"
      >
        {groups.map((group) => (
          <View
            key={group.section + group.title}
            onLayout={(e) => {
              // The FIRST group of a section, not the last. Four groups
              // share «текст» now, and each one overwriting the offset
              // would land the jump on «Розмір» instead of the top of
              // the subject.
              const y = e.nativeEvent.layout.y;
              const known = offsets.current.get(group.section);
              if (known === undefined || y < known) offsets.current.set(group.section, y);
            }}
          >
            <Text style={styles.sectionTitle}>{group.title}</Text>
            <View style={group.compact ? styles.swatchRow : styles.tiles}>
              {group.items.map((item) =>
                group.compact ? (
                  <Pressable
                    key={item.key}
                    style={[styles.swatch, { backgroundColor: item.swatch }, item.active && styles.swatchOn]}
                    onPress={item.onPress}
                    accessibilityLabel={item.label}
                  />
                ) : (
                  <Pressable
                    key={item.key}
                    style={[styles.tile, item.active && styles.tileOn]}
                    onPress={item.onPress}
                  >
                    {item.family === 'material-community' ? (
                      <MaterialCommunityIcons
                        name={item.icon as never}
                        size={19}
                        color={theme.ink.primary}
                      />
                    ) : (
                      <Ionicons name={item.icon as never} size={19} color={theme.ink.primary} />
                    )}
                    <Text style={styles.tileLabel} numberOfLines={2}>
                      {item.label}
                    </Text>
                  </Pressable>
                )
              )}
            </View>
          </View>
        ))}
        {/* The list ends well above the panel's own floor, so the last
            section can be scrolled up to the top like any other - a jump
            to it would otherwise stop short and look broken. */}
        <View style={{ height: Math.max(0, height - 180) }} />
      </ScrollView>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    panel: {
      width: '100%',
      backgroundColor: t.ground,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.edge.hairline,
    },
    content: {
      paddingHorizontal: 12,
      paddingTop: 10,
    },
    sectionTitle: {
      fontSize: 12,
      fontFamily: FONT_SEMIBOLD,
      color: t.ink.faint,
      paddingTop: 10,
      paddingBottom: 8,
      paddingLeft: 4,
    },
    // Two to a row, the way Notion's own sheet lays them out: a label
    // beside its icon needs the width, and one per row would make the
    // list twice as long to scroll.
    tiles: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    tile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      width: '48.4%',
      paddingVertical: 12,
      paddingHorizontal: 12,
      borderRadius: 12,
      backgroundColor: t.field.fill,
    },
    tileOn: {
      backgroundColor: t.edge.strong,
    },
    tileLabel: {
      flexShrink: 1,
      fontSize: 13.5,
      fontFamily: FONT_REGULAR,
      color: t.ink.primary,
    },
    swatchRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 10,
      paddingLeft: 2,
    },
    swatch: {
      width: 34,
      height: 34,
      borderRadius: 17,
      borderWidth: 1,
      borderColor: t.edge.hairline,
    },
    swatchOn: {
      borderWidth: 2,
      borderColor: t.accent,
    },
  });
