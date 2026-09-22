import { useMemo, useState } from 'react';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import type { ComponentProps } from 'react';
import { Ionicons } from '@expo/vector-icons';
import Sheet from './surfaces/Sheet';
import { FONT_REGULAR } from '../utils/fonts';

export type PickableDocument = { id: string; title: string };

type Props = {
  visible: boolean;
  // «Де вставлено» is where this began - the answer to "this photo is in
  // more than one note, which did you mean". Choosing a note to link to
  // is the same window asking a different question, so it says so.
  title?: string;
  subtitle?: string;
  // What each row is. A note by default; a board when this is picking
  // one of those - the list itself is the same either way.
  icon?: ComponentProps<typeof Ionicons>['name'];
  documents: PickableDocument[];
  onPick: (documentId: string) => void;
  onClose: () => void;
};

// Always, now. It was eight - "below this a search box is in the way" -
// and that reasoning was about the BOX, not about the person: someone
// who has just been shown a list looks for the field whether there are
// three rows in it or seventy, and not finding it reads as the window
// being unfinished rather than as the list being short.
const SEARCH_FROM = 1;

// Choosing a document. Two of them: the one that answers "which note did
// you mean" for an object that is in several, and the one that picks a
// note to link to.
//
// It scrolls and it is capped, and it did neither until 2026-09-22: with
// a dozen notes the difference does not show, and with seventy the sheet
// grew past the screen and the rows below the fold could not be reached
// at all. Both are one word each to the sheet - the trap is not that
// they are hard, it is that nothing says they are missing until the list
// gets long.
export default function DocumentPickerModal({
  visible,
  title = 'Де вставлено',
  subtitle,
  icon = 'document-text-outline',
  documents,
  onPick,
  onClose,
}: Props) {
  const theme = useTheme();
  const accent = theme.accent;
  const styles = useStyles(makeStyles);
  const [query, setQuery] = useState('');

  const searchable = documents.length >= SEARCH_FROM;
  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return documents;
    return documents.filter((d) => d.title.toLowerCase().includes(needle));
  }, [documents, query]);

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      subtitle={subtitle}
      scroll
      maxHeight="70%"
      header={
        searchable ? (
          <View style={styles.search}>
            <Ionicons name="search" size={16} color={theme.field.placeholder} />
            <TextInput
              style={styles.searchInput}
              value={query}
              onChangeText={setQuery}
              placeholder="Пошук"
              placeholderTextColor={theme.field.placeholder}
              autoCorrect={false}
              returnKeyType="search"
            />
            {query.length > 0 && (
              <Pressable hitSlop={8} onPress={() => setQuery('')}>
                <Ionicons name="close-circle" size={16} color={theme.field.placeholder} />
              </Pressable>
            )}
          </View>
        ) : undefined
      }
    >
      {shown.length === 0 ? (
        <Text style={styles.empty}>Нічого не знайшлося</Text>
      ) : (
        shown.map((d) => (
          <Pressable key={d.id} style={styles.row} onPress={() => onPick(d.id)}>
            <View style={styles.docIcon}>
              <Ionicons name={icon} size={16} color={accent} />
            </View>
            <Text style={styles.rowText} numberOfLines={1}>
              {d.title}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={theme.ink.faint} />
          </Pressable>
        ))
      )}
    </Sheet>
  );
}

const makeStyles = (t: Theme) => StyleSheet.create({
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: t.field.fill,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: t.field.edge,
    paddingHorizontal: 12,
    height: 40,
    marginBottom: 4,
  },
  searchInput: {
    flex: 1,
    fontSize: 15,
    fontFamily: FONT_REGULAR,
    color: t.field.ink,
    padding: 0,
  },
  empty: {
    fontSize: 14,
    fontFamily: FONT_REGULAR,
    color: t.ink.faint,
    paddingVertical: 20,
    textAlign: 'center',
  },
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
