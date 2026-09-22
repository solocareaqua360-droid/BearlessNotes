import { Ionicons } from '@expo/vector-icons';
import { StyleSheet, Text, View } from 'react-native';
import { Block } from '../types';
import { stripFormatting } from '../utils/documentPreview';
import AttachmentImage from './AttachmentImage';
import { useStyles } from '../theme/ThemeProvider';
import type { Theme } from '../theme/tokens';

// A card that is a MINIATURE of the note, not a summary of it.
//
// What it replaces: a card showed one of three things - its checklist,
// or a strip of its photos, or a flattened line of all its text. One of
// them, never a mix, and always out of order. A note with two tasks and
// six paragraphs showed two tasks; a note that opens with a heading
// showed that heading run together with everything under it.
//
// This draws the blocks IN ORDER, each as a small version of itself, and
// lets the card's own fixed height cut the page off wherever it reaches -
// which is what makes a wall of cards readable at a glance: the shape of
// a note is as recognisable as its words. Craft's own cards, and the
// user's ask: "прям реальне відображення картки як в крафт".
//
// Deliberately NOT the real renderer. A block on the page carries its
// editing, its gestures, its live records and its own error boundaries;
// a card must stay cheap enough that forty of them scroll. So this is a
// second, flat reading of the same blocks - text, a rule, a thumbnail, a
// chip - and nothing here is interactive.

// Past this nothing can be visible on even the tallest card, and every
// one costs a row to lay out.
const MAX_BLOCKS = 16;

export default function CardPreview({
  blocks,
  color,
  mutedColor,
}: {
  blocks: Block[];
  // The card's own ink: these cards are tinted per record, so the
  // preview cannot carry colours of its own.
  color: string;
  mutedColor: string;
}) {
  const styles = useStyles(makeStyles);
  const shown = blocks.slice(0, MAX_BLOCKS);
  let numbered = 0;

  return (
    <View style={styles.page}>
      {shown.map((block) => {
        const type = block.type ?? 'paragraph';
        const text = stripFormatting(block.text ?? '').trim();
        if (type !== 'numbered') numbered = 0;

        switch (type) {
          case 'heading': {
            const level = block.headingLevel ?? 2;
            return (
              <Text
                key={block.id}
                numberOfLines={2}
                style={[
                  styles.heading,
                  level === 1 && styles.heading1,
                  level === 3 && styles.heading3,
                  { color },
                ]}
              >
                {text}
              </Text>
            );
          }
          case 'checkbox':
            return (
              <View key={block.id} style={styles.row}>
                <Ionicons
                  name={block.checked ? 'checkbox' : 'square-outline'}
                  size={10}
                  color={mutedColor}
                />
                <Text
                  numberOfLines={1}
                  style={[styles.text, styles.rowText, { color: mutedColor }, block.checked && styles.done]}
                >
                  {text}
                </Text>
              </View>
            );
          case 'bulleted':
            return (
              <View key={block.id} style={styles.row}>
                <Text style={[styles.bullet, { color: mutedColor }]}>•</Text>
                <Text numberOfLines={1} style={[styles.text, styles.rowText, { color: mutedColor }]}>
                  {text}
                </Text>
              </View>
            );
          case 'numbered': {
            numbered += 1;
            return (
              <View key={block.id} style={styles.row}>
                <Text style={[styles.bullet, { color: mutedColor }]}>{numbered}.</Text>
                <Text numberOfLines={1} style={[styles.text, styles.rowText, { color: mutedColor }]}>
                  {text}
                </Text>
              </View>
            );
          }
          case 'divider':
            return <View key={block.id} style={[styles.divider, { borderBottomColor: mutedColor }]} />;
          case 'image':
            return (
              <AttachmentImage
                key={block.id}
                uri={block.imageUri ?? ''}
                driveFileId={block.driveFileId}
                style={styles.image}
              />
            );
          case 'file':
            return (
              <Chip
                key={block.id}
                icon="document-outline"
                label={block.fileTitle || block.fileName || 'Файл'}
                color={color}
                mutedColor={mutedColor}
                styles={styles}
              />
            );
          case 'link':
            return (
              <Chip
                key={block.id}
                icon="link-outline"
                label={block.linkTitle || block.linkUrl || 'Посилання'}
                color={color}
                mutedColor={mutedColor}
                styles={styles}
              />
            );
          case 'sketch':
            return (
              <Chip
                key={block.id}
                icon="brush-outline"
                label={text || 'Малюнок'}
                color={color}
                mutedColor={mutedColor}
                styles={styles}
              />
            );
          case 'table':
            return (
              <Chip
                key={block.id}
                icon="grid-outline"
                label={text || 'Таблиця'}
                color={color}
                mutedColor={mutedColor}
                styles={styles}
              />
            );
          case 'dbRow':
          case 'dbView':
            return (
              <Chip
                key={block.id}
                icon="server-outline"
                label={block.dbRowTitle || text || 'Запис бази'}
                color={color}
                mutedColor={mutedColor}
                styles={styles}
              />
            );
          case 'docRef':
            return (
              <Chip
                key={block.id}
                icon="document-text-outline"
                label={block.docRefTitle || text || 'Нотатка'}
                color={color}
                mutedColor={mutedColor}
                styles={styles}
              />
            );
          case 'code':
            return (
              <Text key={block.id} numberOfLines={2} style={[styles.code, { color: mutedColor }]}>
                {text}
              </Text>
            );
          default:
            // An empty paragraph is a blank line the author left, and on
            // a card it is worth exactly what it is worth on the page:
            // the space between two thoughts. Drawn as a small gap
            // rather than a full empty row, which on a short card would
            // cost a real line of content.
            if (!text) return <View key={block.id} style={styles.gap} />;
            // Generous rather than tight: the page below is clipped by
            // the card's own height, so a cap here can only ever cut a
            // paragraph SHORT of the room there is. Three lines left a
            // third of a tall card blank while the note went on.
            return (
              <Text key={block.id} numberOfLines={8} style={[styles.text, { color: mutedColor }]}>
                {text}
              </Text>
            );
        }
      })}
    </View>
  );
}

function Chip({
  icon,
  label,
  color,
  mutedColor,
  styles,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  color: string;
  mutedColor: string;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={[styles.chip, { borderColor: mutedColor }]}>
      <Ionicons name={icon} size={10} color={mutedColor} />
      <Text numberOfLines={1} style={[styles.chipLabel, { color }]}>
        {label}
      </Text>
    </View>
  );
}

const makeStyles = (_t: Theme) =>
  StyleSheet.create({
    // The page itself clips. Nothing here counts lines or measures
    // anything: the card has a fixed height, the blocks run down it in
    // order, and whatever does not fit is simply not seen - the same
    // way a page of paper ends.
    page: {
      flex: 1,
      overflow: 'hidden',
      gap: 3,
    },
    heading: {
      flexShrink: 0,
      fontSize: 12,
      fontWeight: '700',
      lineHeight: 15,
    },
    heading1: {
      fontSize: 13.5,
      lineHeight: 17,
    },
    heading3: {
      fontSize: 11.5,
      lineHeight: 14,
    },
    // NEVER shrinks. This same style is used twice: standing alone in
    // the column, and inside a row. In a row, flexShrink means "give up
    // width" - which is what a long task title needs. In the COLUMN it
    // means "give up HEIGHT", and Yoga took it: once the blocks added
    // up to more than the card, it squeezed every line into a few
    // pixels and the card became a stack of sliced glyphs. That is what
    // the user saw as "артефакти замість тексту".
    //
    // Nothing here may shrink. The page is supposed to OVERFLOW and be
    // clipped - that is how a card shows the top of a note - and a
    // child that shrinks instead of overflowing destroys itself trying
    // to fit.
    text: {
      flexShrink: 0,
      fontSize: 11,
      lineHeight: 14,
    },
    // Sideways only, and only inside a row.
    rowText: {
      flexShrink: 1,
    },
    done: {
      textDecorationLine: 'line-through',
    },
    row: {
      flexShrink: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
    },
    bullet: {
      fontSize: 10,
      lineHeight: 14,
      minWidth: 9,
    },
    divider: {
      flexShrink: 0,
      borderBottomWidth: StyleSheet.hairlineWidth,
      marginVertical: 2,
      opacity: 0.5,
    },
    image: {
      flexShrink: 0,
      width: '100%',
      height: 54,
      borderRadius: 6,
    },
    gap: {
      flexShrink: 0,
      height: 4,
    },
    chip: {
      flexShrink: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      alignSelf: 'flex-start',
      maxWidth: '100%',
      paddingHorizontal: 6,
      paddingVertical: 3,
      borderRadius: 7,
      borderWidth: StyleSheet.hairlineWidth,
    },
    chipLabel: {
      flexShrink: 1,
      fontSize: 10.5,
    },
    code: {
      flexShrink: 0,
      fontSize: 10,
      lineHeight: 13,
      fontFamily: 'monospace',
    },
  });
