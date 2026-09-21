import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Sheet from './surfaces/Sheet';
import { FONT_REGULAR } from '../utils/fonts';


export type PickableDocument = { id: string; title: string };

type Props = {
  visible: boolean;
  subtitle?: string;
  documents: PickableDocument[];
  onPick: (documentId: string) => void;
  onClose: () => void;
};

// Shown when an object (link/photo/file) is used in more than one document -
// its "go to document" icon opens this instead of navigating straight there.
//
// The window itself is «Аркуш» now (surfaces/Sheet) rather than this
// file's own copy of the backdrop, the frame, the handle and the title.
export default function DocumentPickerModal({ visible, subtitle, documents, onPick, onClose }: Props) {
  const theme = useTheme();
  const accent = theme.accent;
  const styles = useStyles(makeStyles);
  return (
    <Sheet visible={visible} onClose={onClose} title="Де вставлено" subtitle={subtitle}>
      {documents.map((d) => (
        <Pressable key={d.id} style={styles.row} onPress={() => onPick(d.id)}>
          <View style={styles.docIcon}>
            <Ionicons name="document-text-outline" size={16} color={accent} />
          </View>
          <Text style={styles.rowText} numberOfLines={1}>
            {d.title}
          </Text>
          <Ionicons name="chevron-forward" size={16} color={theme.ink.faint} />
        </Pressable>
      ))}
    </Sheet>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  docIcon: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: t.selected,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowText: {
    fontSize: 16,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
    flex: 1,
  },
});
