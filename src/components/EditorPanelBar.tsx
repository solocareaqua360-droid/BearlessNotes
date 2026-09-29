import { Pressable, StyleSheet, View } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Ionicons } from './icons/Ionicons';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import type { PanelSection } from './EditorInsertPanel';
import type { SoftTokens } from '../theme/soft';
import SoftIcon, { type SoftIconName } from './SoftIcon';

// The short row above the keyboard, on a PHONE.
//
// What it replaces: fourteen icons in a strip that scrolled sideways.
// Everything was in it and nothing could be found without dragging -
// "щоб не робити безкінечну полосу над клавіатурою". Here the row is
// short and fixed, and every button but undo/redo is a DOOR: it opens
// the panel where the keyboard was, scrolled to its own section.
//
// undo and redo open nothing, because they are not doors - they act.
// The close button appears only while the panel is open, for the same
// reason: with the keyboard up there is nothing for it to close, and
// the user said so before it was ever built.
//
// The two database buttons are NOT doors into this panel. They open the
// windows they already open today, over everything - picking a record
// out of a database is a search through hundreds of rows, not a choice
// among eight tiles.

export type PanelBarProps = {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  // null while the panel is closed.
  openSection: PanelSection | null;
  onOpenSection: (section: PanelSection) => void;
  // Back to the keyboard: the panel goes, the keyboard returns.
  onShowKeyboard: () => void;
  // Lower whatever is standing there - the panel, or the keyboard - and
  // stop editing.
  onLowerAll: () => void;
  onPickFromDatabase: () => void;
  onCreateInDatabase: () => void;
  // The soft style (theme/soft): its own icons in ink, one quiet surface
  // lifted off the page by a shadow instead of a hairline.
  soft?: SoftTokens | null;
};

type Door = {
  section: PanelSection;
  softIcon: SoftIconName;
  family: 'ionicons' | 'material-community';
  icon: string;
  label: string;
};

const DOORS: Door[] = [
  { section: 'lists', softIcon: 'list', family: 'material-community', icon: 'format-list-bulleted', label: 'Списки' },
  // One door for text, not two. Bold and size are the same subject, and
  // the row is shorter for it.
  { section: 'text', softIcon: 'text', family: 'material-community', icon: 'format-size', label: 'Текст' },
  { section: 'rules', softIcon: 'rule', family: 'ionicons', icon: 'remove-outline', label: 'Лінії' },
  { section: 'insert', softIcon: 'insert', family: 'ionicons', icon: 'add-circle-outline', label: 'Вставка' },
];

export default function EditorPanelBar({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  openSection,
  onOpenSection,
  onShowKeyboard,
  onLowerAll,
  onPickFromDatabase,
  onCreateInDatabase,
  soft,
}: PanelBarProps) {
  const styles = useStyles(makeStyles);
  const theme = useTheme();
  // The theme's own ink, not the glass ink: this bar is no longer a
  // pill floating on the page, it is a surface of its own.
  const ink = soft ? soft.ink : theme.ink.primary;
  const inkMuted = soft ? soft.ink3 : theme.ink.faint;
  // One glyph, in whichever set this bar is drawn in.
  const glyph = (softName: SoftIconName, fallback: React.ReactNode, color = ink) =>
    soft ? <SoftIcon name={softName} size={22} color={color} /> : fallback;

  return (
    <View
      style={[
        styles.row,
        soft && {
          backgroundColor: soft.card,
          borderTopWidth: 0,
          height: 50,
          paddingHorizontal: 10,
          // Lifted UP off the page: the shadow falls above the bar.
          boxShadow: soft.dark ? '0px -1px 0px rgba(255,255,255,0.06)' : '0px -8px 20px -12px rgba(30,30,28,0.22)',
        },
      ]}
    >
      <Pressable style={[styles.button, soft && styles.softButton]} hitSlop={4} disabled={!canUndo} onPress={onUndo}>
        {glyph('undo', <Ionicons name="arrow-undo-outline" size={20} color={canUndo ? ink : inkMuted} />, canUndo ? ink : inkMuted)}
      </Pressable>
      <Pressable style={[styles.button, soft && styles.softButton]} hitSlop={4} disabled={!canRedo} onPress={onRedo}>
        {glyph('redo', <Ionicons name="arrow-redo-outline" size={20} color={canRedo ? ink : inkMuted} />, canRedo ? ink : inkMuted)}
      </Pressable>

      <View style={[styles.divider, { backgroundColor: inkMuted }, soft && { opacity: 0.35 }]} />

      {DOORS.map((door) => (
        <Pressable
          key={door.section}
          style={[
            styles.button,
            soft && styles.softButton,
            openSection === door.section && (soft ? { backgroundColor: soft.fill } : styles.buttonOn),
          ]}
          hitSlop={4}
          accessibilityLabel={door.label}
          onPress={() => onOpenSection(door.section)}
        >
          {glyph(
            door.softIcon,
            door.family === 'material-community' ? (
              <MaterialCommunityIcons name={door.icon as never} size={20} color={ink} />
            ) : (
              <Ionicons name={door.icon as never} size={20} color={ink} />
            )
          )}
        </Pressable>
      ))}

      <View style={[styles.divider, { backgroundColor: inkMuted }, soft && { opacity: 0.35 }]} />

      <Pressable style={[styles.button, soft && styles.softButton]} hitSlop={4} accessibilityLabel="З бази даних" onPress={onPickFromDatabase}>
        {glyph('search', <Ionicons name="search-outline" size={20} color={ink} />)}
      </Pressable>
      <Pressable
        style={[styles.button, soft && styles.softButton]}
        hitSlop={4}
        accessibilityLabel="Створити в базі"
        onPress={onCreateInDatabase}
      >
        {glyph('databaseAdd', <MaterialCommunityIcons name="database-plus-outline" size={20} color={ink} />)}
      </Pressable>

      {/* Two slots at the right edge that are ALWAYS there, so nothing
          in the row moves when the panel opens. The close button used to
          appear only with the panel, and space-between handed its width
          out of the other buttons as it arrived - the whole row shifted
          under the finger. "Місце під кнопку опускання цієї панелі
          повинно бути завжди."

          ⌨ goes back to the keyboard. With the keyboard already up it
          has nothing to do, so its slot is held empty at the same size
          rather than taken away.

          ⌄ lowers whatever is standing there and ends the editing - the
          panel without bringing the keyboard back, or the keyboard
          itself. */}
      {openSection !== null ? (
        <Pressable style={[styles.button, soft && styles.softButton]} hitSlop={4} accessibilityLabel="Клавіатура" onPress={onShowKeyboard}>
          {glyph('keyboard', <MaterialCommunityIcons name="keyboard-outline" size={21} color={ink} />)}
        </Pressable>
      ) : (
        <View style={[styles.button, styles.slotHeld, soft && styles.softButton]} />
      )}
      <Pressable style={[styles.button, soft && styles.softButton]} hitSlop={4} accessibilityLabel="Опустити" onPress={onLowerAll}>
        {glyph('down', <Ionicons name="chevron-down" size={22} color={ink} />)}
      </Pressable>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    // Nine or ten buttons across a phone: each takes what it needs and
    // the row shares what is left, so nothing has to scroll.
    // Edge to edge, on its own ground. It used to inherit the pinned
    // toolbar's centred glass pill and carried no background of its
    // own, so the note's text showed straight through it and it sat in
    // the middle of the screen rather than across it - "занадто
    // прозора і його можна рівномірно розтягнути по всій ширині".
    //
    // It is one piece with the panel below: the same ground, and a
    // hairline only on top, so the two read as one surface standing
    // where the keyboard stood.
    row: {
      width: '100%',
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 12,
      height: 46,
      backgroundColor: t.ground,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: t.edge.hairline,
    },
    button: {
      paddingHorizontal: 6,
      paddingVertical: 6,
      borderRadius: 9,
    },
    // The same footprint as an icon button, holding the slot open.
    slotHeld: {
      width: 33,
      height: 33,
    },
    // Soft: a round seat the same size for every button, so the open
    // section's tint is a circle rather than a rounded box.
    softButton: {
      width: 38,
      height: 38,
      padding: 0,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
    },
    buttonOn: {
      backgroundColor: t.edge.strong,
    },
    divider: {
      width: StyleSheet.hairlineWidth,
      height: 18,
      opacity: 0.5,
    },
  });
