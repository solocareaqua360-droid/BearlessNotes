import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import GlassLayer from './GlassLayer';
import ArticleBody, { type ArticleBodyHandle } from './ArticleBody';
import { FONT_BOLD, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import { SHEET_FRAME, SHEET_WINDOW } from '../constants/glass';
import { watchArticle, type SavedArticle } from '../utils/articleReader';
import { buildReaderHtml } from '../utils/readerHtml';

// A saved article, read. Select any piece of it - a word, a sentence,
// several paragraphs - and "Додати фрагмент" puts that piece on the
// link's own card; from the card it can go on into a note. The page is
// the article's own cleaned text only (see articleReader), so it reads
// with no connection.
export default function LinkReaderSheet({
  link,
  onClose,
  onAddFragment,
}: {
  link: { id: string; url: string; title?: string } | null;
  onClose: () => void;
  onAddFragment: (text: string) => Promise<void>;
}) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const bodyRef = useRef<ArticleBodyHandle>(null);
  const [article, setArticle] = useState<SavedArticle | null | undefined>(undefined);
  const [selection, setSelection] = useState('');
  const [added, setAdded] = useState(false);

  useEffect(() => {
    if (!link) return;
    setArticle(undefined);
    setSelection('');
    return watchArticle(link.id, setArticle);
  }, [link?.id]);

  useEffect(() => {
    if (!added) return;
    const timer = setTimeout(() => setAdded(false), 1600);
    return () => clearTimeout(timer);
  }, [added]);

  const html = useMemo(
    () =>
      article
        ? buildReaderHtml(article, {
            background: theme.paper.fill,
            ink: theme.paper.ink,
            muted: theme.paper.inkMuted,
            accent: theme.accent,
          })
        : '',
    [article, theme]
  );

  const handleSelection = useCallback((text: string) => setSelection(text), []);

  async function addSelection() {
    const text = selection;
    if (!text) return;
    await onAddFragment(text);
    bodyRef.current?.clearSelection();
    setSelection('');
    setAdded(true);
  }

  return (
    <GlassLayer visible={link !== null} onClose={onClose} intensity={60}>
      <View style={styles.frame} pointerEvents="box-none">
        <View style={styles.card}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {article?.title || link?.title || 'Стаття'}
            </Text>
            {!!link && (
              <Pressable hitSlop={8} onPress={() => Linking.openURL(link.url).catch(() => {})}>
                <Ionicons name="open-outline" size={20} color={theme.ink.muted} />
              </Pressable>
            )}
            <Pressable hitSlop={8} onPress={onClose}>
              <Ionicons name="close" size={22} color={theme.ink.muted} />
            </Pressable>
          </View>
          <View style={styles.body}>
            {article === undefined ? (
              <ActivityIndicator color={theme.ink.muted} style={styles.centered} />
            ) : article === null ? (
              <Text style={styles.empty}>Статтю не знайдено - збережіть її ще раз із картки посилання.</Text>
            ) : (
              <ArticleBody ref={bodyRef} html={html} onSelectionChange={handleSelection} />
            )}
          </View>
          {selection ? (
            <Pressable style={({ pressed }) => [styles.addButton, pressed && styles.pressed]} onPress={addSelection}>
              <Ionicons name="bookmark-outline" size={17} color={theme.onAccent} />
              <Text style={styles.addButtonText}>Додати фрагмент</Text>
            </Pressable>
          ) : (
            <Text style={styles.hint}>
              {added ? 'Фрагмент додано до картки' : 'Виділіть текст, щоб додати фрагмент до картки'}
            </Text>
          )}
        </View>
      </View>
    </GlassLayer>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
    frame: SHEET_FRAME,
    card: {
      ...SHEET_WINDOW,
      height: '94%',
      backgroundColor: t.paper.fill,
      borderWidth: 1,
      borderColor: t.edge.hairline,
      paddingTop: 16,
      paddingBottom: 14,
      overflow: 'hidden',
      gap: 8,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      paddingHorizontal: 20,
    },
    title: {
      flex: 1,
      fontSize: 15,
      fontFamily: FONT_BOLD,
      color: t.paper.ink,
    },
    body: {
      flex: 1,
    },
    centered: {
      marginTop: 40,
    },
    empty: {
      marginTop: 40,
      paddingHorizontal: 24,
      textAlign: 'center',
      fontSize: 14,
      fontFamily: FONT_REGULAR,
      color: t.paper.inkMuted,
    },
    addButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      marginHorizontal: 20,
      minHeight: 48,
      borderRadius: 18,
      backgroundColor: t.accent,
    },
    addButtonText: {
      fontSize: 15,
      fontFamily: FONT_SEMIBOLD,
      color: t.onAccent,
    },
    hint: {
      minHeight: 48,
      textAlign: 'center',
      textAlignVertical: 'center',
      lineHeight: 48,
      fontSize: 13,
      fontFamily: FONT_REGULAR,
      color: t.paper.inkMuted,
    },
    pressed: {
      opacity: 0.7,
    },
  });
