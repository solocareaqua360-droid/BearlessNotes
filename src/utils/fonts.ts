import { Platform } from 'react-native';
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

// Inter - the soft style's face (theme/soft), tried on the Documents
// desk first. Chosen over Nunito on 2026-09-28 as a deliberate reversal:
// Nunito's rounded geometry (like Onest's) sits close to Google Sans,
// Android's own face, which was part of what made the soft mockups read
// as Android; Inter is the closest free relative of the neo-grotesque
// Craft is set in. Checked: it carries ґ.
export const SOFT_REGULAR = 'Inter_400Regular';
export const SOFT_MEDIUM = 'Inter_500Medium';
export const SOFT_SEMIBOLD = 'Inter_600SemiBold';
export const SOFT_BOLD = 'Inter_700Bold';

// The system's own monospaced family - no font file, so this ships over
// the air like everything else. Android names it "monospace"; the
// browser and iOS take the generic keyword.
export const FONT_MONO = Platform.OS === 'android' ? 'monospace' : 'Menlo';
