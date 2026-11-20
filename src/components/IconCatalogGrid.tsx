import { ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { ICON_CATEGORIES } from '../constants/iconCatalog';
import { FONT_SEMIBOLD } from '../utils/fonts';

// THE ICONS, BY THEME (constants/iconCatalog): a heading per theme and its
// icons under it, the same in every place an icon is chosen - a folder, a
// new folder, a database. The search matches a theme's own name (all of
// it) or an icon's name.
export default function IconCatalogGrid({
  query,
  renderCell,
  gridStyle,
  labelColor,
}: {
  query: string;
  renderCell: (name: string) => ReactNode;
  gridStyle?: StyleProp<ViewStyle>;
  labelColor: string;
}) {
  const needle = query.trim().toLowerCase();
  const plain = (name: string) => name.replace(/^lc:/, '').replace(/^logo-/, '').replace(/-outline$/, '');
  const sections = ICON_CATEGORIES.map((category) => ({
    label: category.label,
    icons: !needle || category.label.toLowerCase().includes(needle)
      ? category.icons
      : category.icons.filter((name) => plain(name).includes(needle)),
  })).filter((section) => section.icons.length > 0);
  return (
    <View style={styles.sections}>
      {sections.map((section) => (
        <View key={section.label} style={styles.section}>
          <Text style={[styles.label, { color: labelColor }]}>{section.label}</Text>
          <View style={gridStyle}>{section.icons.map((name) => renderCell(name))}</View>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  sections: {
    gap: 14,
  },
  section: {
    gap: 8,
  },
  label: {
    fontSize: 12,
    fontFamily: FONT_SEMIBOLD,
    letterSpacing: 0.3,
  },
});
