import { createContext, ReactNode, useContext } from 'react';
import { StyleSheet, Text } from 'react-native';
import { useTheme } from '../theme/ThemeProvider';
import { FONT_REGULAR } from '../utils/fonts';

// THE LABEL OF A MENU ROW (2026-10-24). The base menus' rows (DatabaseChrome's menuStyles) were written for a dark glass popup,
// so their label was a fixed white - and on the Mac the same rows stand in the right panel, on a LIGHT card, where the label
// was invisible: a bare trash icon under «ЩЕ» in Стікери, a row with no name in Файли/Фото/Посилання. Inside the panel (which
// sets MenuOnLight) the label takes the theme's ink; everywhere else it is white, as it always was.
export const MenuOnLight = createContext(false);

export default function MenuLabel({ children }: { children: ReactNode }) {
  const theme = useTheme();
  const onLight = useContext(MenuOnLight);
  return <Text style={[styles.label, onLight && { color: theme.ink.primary }]}>{children}</Text>;
}

const styles = StyleSheet.create({
  label: { flex: 1, fontSize: 14, fontFamily: FONT_REGULAR, color: '#fff' },
});
