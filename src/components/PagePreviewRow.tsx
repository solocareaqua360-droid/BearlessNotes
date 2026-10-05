import { StyleSheet, Text, View } from 'react-native';
import { Ionicons } from './icons/Ionicons';
import FormattedText from './FormattedText';
import { SoftTaskCheck } from './SoftIcon';
import { LINK_BLUE, LINK_BLUE_DARK } from './BlockRow';
import { formatReminderBadge, parseFormattedText, STICKER_INK } from '../utils/documentBlocks';
import { PAGE_H1, PAGE_H2, PAGE_H3, PAGE_TEXT, makeStyles } from './documentEditorStyles';
import { withAlpha } from '../utils/color';
import type { Block } from '../types';
import type { Theme } from '../theme/tokens';

// THE TEXT ROWS OF A PAGE MINIATURE, drawn directly (2026-10-06, the preview
// plan's stage 3). A miniature is laid out at page size and scaled - the
// card IS the page - so every row it draws is a row of the page; drawing
// them through BlockRow meant the editor's whole machinery per row (state,
// refs, effects, measured layouts, gesture wrappers) for a picture. These
// are the SAME styles, in the SAME structure, as BlockRow's resting state,
// so the page looks exactly the same - just without the machinery. Only the
// kinds of row that are text are drawn here; anything else (a picture, a
// table, a sketch, a link card, a card) still goes through BlockRow's own
// preview, so nothing on a card ever looks different from the page.
const TEXT_KINDS = new Set(['paragraph', 'heading', 'bulleted', 'numbered', 'toggle', 'checkbox']);

export function isLightRow(block: Block): boolean {
  return TEXT_KINDS.has(block.type ?? 'paragraph');
}

export default function PagePreviewRow({
  item,
  indented,
  listNumber,
  paperColor,
  searchHighlight,
  styles,
  theme,
  textScale,
}: {
  item: Block;
  indented: boolean;
  listNumber?: number;
  paperColor: { background: string; text: string; textMuted: string } | null;
  searchHighlight?: string;
  styles: ReturnType<typeof makeStyles>;
  theme: Theme;
  textScale: number;
}) {
  const type = item.type ?? 'paragraph';
  const rowPaperColor = item.isSticker ? null : paperColor;
  const headingStyle =
    type === 'heading' ? (item.headingLevel === 1 ? styles.heading1 : item.headingLevel === 3 ? styles.heading3 : styles.heading2) : null;
  const base = type === 'heading' ? (item.headingLevel === 1 ? PAGE_H1 : item.headingLevel === 3 ? PAGE_H3 : PAGE_H2) : PAGE_TEXT;
  const scaledTextStyle = { fontSize: Math.round(base.size * textScale), lineHeight: Math.round(base.line * textScale) };
  const linkInk = theme.scheme === 'dark' ? LINK_BLUE_DARK : LINK_BLUE;

  const textField = (
    <View style={styles.blockInput}>
      <Text style={[styles.blockDisplayText, headingStyle, item.checked && styles.checkedText, scaledTextStyle]}>
        {item.text ? (
          <FormattedText
            segments={parseFormattedText(item.text)}
            defaultColor={item.isSticker ? STICKER_INK : (rowPaperColor?.text ?? theme.paper.ink)}
            search={searchHighlight}
            linkInk={linkInk}
            linkTint={withAlpha(linkInk, 0.14)}
            linkTextStyle={StyleSheet.flatten([styles.blockDisplayText, headingStyle, scaledTextStyle])}
          />
        ) : (
          <Text style={[styles.blockPlaceholder, rowPaperColor && { color: rowPaperColor.textMuted }]}>…</Text>
        )}
      </Text>
    </View>
  );

  let content = textField;
  if (type === 'bulleted' || type === 'numbered') {
    content = (
      <View style={styles.prefixedRow}>
        <Text style={styles.bulletMark}>{type === 'numbered' ? `${listNumber ?? 1}.` : '•'}</Text>
        {textField}
      </View>
    );
  } else if (type === 'toggle') {
    content = (
      <View style={styles.prefixedRow}>
        <Ionicons name={item.collapsed ? 'chevron-forward' : 'chevron-down'} size={18} color={rowPaperColor?.textMuted ?? theme.paper.inkMuted} />
        {textField}
      </View>
    );
  } else if (type === 'checkbox') {
    const reminderLabel = formatReminderBadge(item);
    content = (
      <View style={styles.checkboxBlock}>
        <View style={styles.prefixedRow}>
          <View style={styles.taskCheck}>
            <SoftTaskCheck
              checked={!!item.checked}
              ink={rowPaperColor?.text ?? theme.paper.ink}
              faint={rowPaperColor?.textMuted ?? theme.paper.inkFaint}
              paper={rowPaperColor?.background ?? theme.paper.fill}
            />
          </View>
          {textField}
        </View>
        <View style={styles.checkboxReminderRow}>
          <Ionicons name="alarm-outline" size={11} color={reminderLabel ? theme.accent : theme.paper.inkFaint} />
          <Text style={[styles.checkboxReminderText, !reminderLabel && styles.checkboxReminderTextEmpty]}>
            {reminderLabel ?? 'Нагадування'}
          </Text>
        </View>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.blockRow,
        indented && styles.blockRowIndented,
        item.isSticker && styles.blockRowSticker,
        rowPaperColor && { backgroundColor: 'transparent' },
      ]}
    >
      {content}
    </View>
  );
}
