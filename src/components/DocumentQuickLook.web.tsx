import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { FONT_BOLD, FONT_REGULAR } from '../utils/fonts';
import { GLASS_BODY, GLASS_EDGE, GLASS_TEXT, GLASS_TEXT_MUTED } from '../constants/glass';

export type QuickLookKind = 'docx' | 'xlsx' | 'pdf';

export function quickLookKindFor(fileName: string): QuickLookKind | null {
  const name = fileName.toLowerCase().trim();
  if (name.endsWith('.pdf')) return 'pdf';
  if (name.endsWith('.docx')) return 'docx';
  if (name.endsWith('.xlsx')) return 'xlsx';
  return null;
}

// Looking inside a .docx/.xlsx/.pdf without opening another program - in a
// browser, not yet.
//
// The phone's version converts the file to HTML and shows it in a WebView,
// which has no web build; and it reads the file off local storage, which a
// page cannot do either. What it would take here is different work, not a
// port: fetch the bytes from Drive and render them in the page. Worth
// doing, and not what the note editor needed first.
//
// Says so rather than rendering an empty panel, so a file that cannot be
// previewed still looks like a decision instead of a failure.
export default function DocumentQuickLook({
  file,
  onClose,
}: {
  file: { uri: string; name: string; kind: QuickLookKind } | null;
  onClose: () => void;
  onOpenElsewhere: () => void;
  embedded?: boolean;
}) {
  if (!file) return null;
  return (
    <View style={styles.wrap}>
      <Ionicons name="document-outline" size={28} color={GLASS_TEXT_MUTED} />
      <Text style={styles.title} numberOfLines={2}>
        {file.name}
      </Text>
      <Text style={styles.body}>Перегляд таких файлів поки що працює лише в застосунку на телефоні.</Text>
      <Pressable style={styles.button} onPress={onClose}>
        <Text style={styles.buttonLabel}>Закрити</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    padding: 32,
    backgroundColor: GLASS_BODY,
    borderLeftWidth: 1,
    borderLeftColor: GLASS_EDGE,
  },
  title: {
    fontSize: 16,
    fontFamily: FONT_BOLD,
    color: GLASS_TEXT,
    textAlign: 'center',
  },
  body: {
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONT_REGULAR,
    color: GLASS_TEXT_MUTED,
    textAlign: 'center',
    maxWidth: 320,
  },
  button: {
    marginTop: 6,
    borderRadius: 16,
    backgroundColor: '#F5C77E',
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  buttonLabel: {
    fontSize: 15,
    fontFamily: FONT_BOLD,
    color: '#171310',
  },
});
