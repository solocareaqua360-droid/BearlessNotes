import { StyleSheet, Text, View } from 'react-native';
import { useStyles, useTheme } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';
import { Ionicons } from '@expo/vector-icons';
import AttachmentImage from './AttachmentImage';
import { FONT_BOLD, FONT_MONO, FONT_REGULAR, FONT_SEMIBOLD } from '../utils/fonts';
import type { Block } from '../types';

// One block of another document, drawn to be READ.
//
// The reference panel's first version listed blocks the way every other
// tab lists records: an icon and one clipped line. The user's answer was
// the whole point of the feature - "я хочу прочитати, впевнитись, що це
// воно, і закинути на дошку". A first line cannot be recognised, only
// guessed at, and guessing is exactly the work the panel exists to
// remove. So a block is drawn here as itself: a heading looks like a
// heading, a list keeps its markers, a picture is the picture, and text
// runs as long as it runs.
//
// Read-only and deliberately dumb: nothing here writes, opens or edits.
// It renders in glass ink, since the panel it lives in stands on the
// sheet's own dark ground rather than on the note's paper.
export default function ReferenceBlockPreview({ block, index }: { block: Block; index?: number }) {
  // The THEME'S ink, not the glass's white. This preview is read on the
  // references panel, which is a surface of the app now rather than a
  // dark sheet floating on glass - white on beige could not be read.
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  const type = block.type ?? 'paragraph';
  const text = block.text ?? '';

  if (type === 'image' || type === 'sketch') {
    if (!block.imageUri) return <IconLine icon="image-outline" label="Зображення" />;
    return (
      <View style={styles.imageWrap}>
        <AttachmentImage
          uri={block.imageUri}
          driveFileId={block.driveFileId}
          style={styles.image}
          resizeMode="cover"
        />
        {!!block.imageTitle && <Text style={styles.caption}>{block.imageTitle}</Text>}
      </View>
    );
  }
  if (type === 'divider') return <View style={styles.divider} />;
  if (type === 'file') {
    return <IconLine icon="document-outline" label={block.fileTitle || block.fileName || 'Файл'} />;
  }
  if (type === 'link') {
    return <IconLine icon="link-outline" label={text || block.linkUrl || 'Посилання'} />;
  }
  if (type === 'dbRow' || type === 'dbView') {
    return <IconLine icon="albums-outline" label={text || 'База даних'} />;
  }
  if (type === 'table') {
    return <IconLine icon="grid-outline" label={text || 'Таблиця'} />;
  }
  if (type === 'code') {
    // The one block where every newline is the author's own - so it keeps
    // them, and it is the one place a clip is right: a hundred lines of
    // code is not what anyone is reading the panel for.
    return (
      <View style={styles.codeWrap}>
        <Text style={styles.code} numberOfLines={12}>
          {text}
        </Text>
      </View>
    );
  }
  if (type === 'heading') {
    const level = block.headingLevel ?? 1;
    return (
      <Text style={[styles.heading, level === 2 && styles.heading2, level >= 3 && styles.heading3]}>
        {text || 'Заголовок'}
      </Text>
    );
  }
  if (type === 'bulleted' || type === 'numbered') {
    return (
      <View style={styles.listRow}>
        <Text style={styles.marker}>{type === 'bulleted' ? '•' : `${(index ?? 0) + 1}.`}</Text>
        <Text style={styles.text}>{text}</Text>
      </View>
    );
  }
  if (type === 'checkbox') {
    return (
      <View style={styles.listRow}>
        <Ionicons
          name={block.checked ? 'checkbox' : 'square-outline'}
          size={17}
          color={block.checked ? theme.ink.muted : theme.ink.faint}
        />
        <Text style={[styles.text, block.checked && styles.textDone]}>{text}</Text>
      </View>
    );
  }
  // Paragraph, and anything saved before block types existed.
  return <Text style={styles.text}>{text || ' '}</Text>;
}

function IconLine({ icon, label }: { icon: keyof typeof Ionicons.glyphMap; label: string }) {
  const theme = useTheme();
  const styles = useStyles(makeStyles);
  return (
    <View style={styles.listRow}>
      <Ionicons name={icon} size={17} color={theme.ink.muted} />
      <Text style={styles.text}>{label}</Text>
    </View>
  );
}

const makeStyles = (t: Theme) =>
  StyleSheet.create({
  text: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: FONT_REGULAR,
    color: t.ink.primary,
  },
  textDone: {
    color: t.ink.muted,
    textDecorationLine: 'line-through',
  },
  heading: {
    fontSize: 19,
    lineHeight: 25,
    fontFamily: FONT_BOLD,
    fontWeight: '700',
    color: t.ink.primary,
  },
  heading2: { fontSize: 17, lineHeight: 23 },
  heading3: { fontSize: 15, lineHeight: 21, fontFamily: FONT_SEMIBOLD, fontWeight: '600' },
  listRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  marker: {
    fontSize: 14,
    lineHeight: 20,
    minWidth: 16,
    fontFamily: FONT_SEMIBOLD,
    color: t.ink.muted,
  },
  divider: {
    height: 1,
    marginVertical: 6,
    backgroundColor: t.edge.hairline,
  },
  imageWrap: { gap: 6 },
  image: {
    width: '100%',
    height: 150,
    borderRadius: 10,
    backgroundColor: t.edge.hairline,
  },
  caption: {
    fontSize: 12,
    fontFamily: FONT_REGULAR,
    color: t.ink.muted,
  },
  codeWrap: {
    borderRadius: 8,
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.05)',
  },
  code: {
    fontSize: 12,
    lineHeight: 17,
    fontFamily: FONT_MONO,
    color: t.ink.primary,
  },
});
