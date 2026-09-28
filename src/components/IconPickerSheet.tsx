import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Sheet from './surfaces/Sheet';
import { TAG_ICONS } from '../constants/tags';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { FONT_REGULAR } from '../utils/fonts';

// An icon for something the user made - a database of their own, first:
// every one of them stood on the board under the same grid glyph ("зараз
// вони всі однакові"). The same curated set tags and views choose from,
// with a search over their names.
export default function IconPickerSheet({
  visible,
  title,
  selected,
  onPick,
  onClose,
}: {
  visible: boolean;
  title: string;
  selected?: string;
  onPick: (icon: string) => void;
  onClose: () => void;
}) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const [query, setQuery] = useState('');
  useEffect(() => {
    if (visible) setQuery('');
  }, [visible]);
  const needle = query.trim().toLowerCase();
  const icons = needle ? TAG_ICONS.filter((name) => name.includes(needle)) : TAG_ICONS;

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title={title}
      scroll
      maxHeight="70%"
      header={
        <View style={styles.search}>
          <Ionicons name="search" size={15} color={theme.field.placeholder} />
          <TextInput
            value={query}
            onChangeText={setQuery}
            placeholder="Пошук іконки"
            placeholderTextColor={theme.field.placeholder}
            style={styles.searchInput}
          />
        </View>
      }
    >
      <View style={styles.grid}>
        {icons.map((name) => {
          const active = selected === name;
          return (
            <Pressable key={name} onPress={() => onPick(name)} style={[styles.cell, active && styles.cellActive]}>
              <Ionicons
                name={name as keyof typeof Ionicons.glyphMap}
                size={22}
                color={active ? theme.onAccent : theme.ink.primary}
              />
            </Pressable>
          );
        })}
      </View>
    </Sheet>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    search: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: t.field.fill,
      borderRadius: 12,
      paddingHorizontal: 12,
      marginBottom: 12,
    },
    searchInput: {
      flex: 1,
      paddingVertical: 10,
      fontSize: 15,
      fontFamily: FONT_REGULAR,
      color: t.field.ink,
    },
    grid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    cell: {
      width: 48,
      height: 48,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
    },
    cellActive: {
      backgroundColor: t.accent,
    },
  });
