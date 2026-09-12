// Nunito (Google Fonts, loaded in App.tsx via @expo-google-fonts/nunito).
// React Native has no variable-weight fontFamily - each weight is its own
// loaded font file, so a style that used to say just fontWeight now needs
// the matching family name here alongside it.
//
// Nunito in place of Inter: rounded terminals rather than Inter's
// deliberately squared-off ones. Its Cyrillic covers cyrillic-ext, which
// is where Ukrainian's ґ (U+0491) lives - the letter most "Cyrillic"
// fonts quietly leave out.
export const FONT_REGULAR = 'Nunito_400Regular';
export const FONT_MEDIUM = 'Nunito_500Medium';
export const FONT_SEMIBOLD = 'Nunito_600SemiBold';
export const FONT_BOLD = 'Nunito_700Bold';
export const FONT_EXTRABOLD = 'Nunito_800ExtraBold';
